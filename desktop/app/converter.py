# -*- coding: utf-8 -*-
"""把 GPT Master / ChatGPT 导出的静态 HTML 转成可交互离线页。

导出的文件有三个问题：
  1. <meta http-equiv="Content-Security-Policy" content="default-src 'none'">
     禁止一切脚本
  2. 交互组件（练习题、悬浮演示、案例切换）被转义成纯文本，如 &lt;box ...&gt;
  3. 同一个组件常被空行拆散到多个 <p> 里

本模块负责：合并碎片 -> 换成占位容器 -> 注入组件运行时重新渲染。
纯函数，不做任何 IO 之外的事情，方便被 GUI / 命令行复用。
"""
from __future__ import annotations

import html as htmllib
import json
import os
import re
import tempfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import List, NamedTuple, Tuple
from urllib.parse import quote, urlsplit

from runtime_embed import runtime_source

from dslsyntax import (  # noqa: E402  （app 目录已在 sys.path 上）
    balance as tag_balance,
    brace_spans,
    closing_tail,
    directive_balance,
    escaped_re,
    is_balanced,
    open_re,
    start_re,
    tag_pattern,
)

_OPEN_RE = open_re()


def _normalize_inline_template_code(source: str) -> str:
    """把导出器塞进 `{...}` 表达式里的 <code> 换回模板字符串的反引号。

    导出时模板字符串里的反引号会被 markdown 当成行内代码，于是
    `width={`${x}%`}` 变成 `width={<code>${x}%</code>}`，甚至被拆成
    `<code>A</code>B<code>C</code>` 几段。反引号原本成对，所以
    「<code> / </code> 各自还原成一个反引号」正好能拼回嵌套模板原样。
    只在花括号表达式内部替换，正文里的行内代码（如 `<code>@Autowired</code>`）不受影响。
    """
    if "<code>" not in source and "<em>" not in source:
        return source

    out = []
    last = 0
    for start, end in brace_spans(source):
        span = source[start:end]
        fixed = span.replace("<code>", "`").replace("</code>", "`")
        # Markdown 可能把 each 表达式中成对的乘号变成强调标签。
        if span.startswith("{#each"):
            fixed = fixed.replace("<em>", "*").replace("</em>", "*")
        if fixed == span:
            continue
        out.append(source[last:start])
        out.append(fixed)
        last = end
    if not out:
        return source
    out.append(source[last:])
    return "".join(out)

# 一个组件块的起始特征（由 dslsyntax.START_TAGS 派生）
_START_RE = start_re()

# 组件内部夹着的真实 HTML 里，这些标签意味着「组件已经结束」，不能并进来
_GAP_BREAK_RE = re.compile(r"<(?:h[1-6]|hr|table|blockquote|article)\b", re.I)

# ChatGPT 引用标记（<Cite refs={[...]}/> 或成对标签），与交互无关，直接剥掉
_CITE_RE = re.compile(
    r"&lt;Cite\b[\s\S]*?(?:/&gt;|&lt;/Cite&gt;)|<Cite\b[\s\S]*?(?:/>|</Cite>)", re.I
)

# 只处理正文中的转义 Link；代码、脚本和真实 HTML 属性保持原样。
_LINK_PART_RE = re.compile(
    r'<(pre|code|script|style)\b[^>]*>[\s\S]*?</\1\s*>|<[^>]*>|&lt;Link\b(?:(?!&gt;)[\s\S])*?/&gt;',
    re.I,
)


def _fix_links(doc: str) -> str:
    def repl(match: re.Match) -> str:
        raw = match.group(0)
        if not raw.lower().startswith('&lt;link'):
            return raw
        class LinkParser(HTMLParser):
            attrs = None

            def handle_startendtag(self, tag, attrs):
                if tag == 'link':
                    self.attrs = dict(attrs)

        parser = LinkParser(convert_charrefs=True)
        try:
            parser.feed(raw.replace('&lt;', '<').replace('&gt;', '>')
                        .replace('&quot;', '"').replace('&#x27;', "'"))
            attrs = parser.attrs or {}
            url = attrs.get('url') or ''
            title = attrs.get('title') or url
            parsed = urlsplit(url)
            if parsed.scheme.lower() not in ('http', 'https') or not parsed.netloc:
                return raw
        except (ValueError, AssertionError):
            return raw
        return '<a href="%s">%s</a>' % (
            htmllib.escape(url, quote=True), htmllib.escape(title, quote=False))

    return _LINK_PART_RE.sub(repl, doc)

_CSP_META_RE = re.compile(
    r"<meta[^>]+http-equiv=[\"']Content-Security-Policy[\"'][^>]*>", re.I
)

# 导出器自带的 Chrome：顶部「Save as PDF」提示条、底部「Exported from ChatGPT」页脚
_CHROME_RES = (
    re.compile(r"<div class=\"banner\">[\s\S]*?</div>\s*", re.I),
    re.compile(r"<div class=\"footer\">[\s\S]*?</div>\s*", re.I),
    re.compile(r"<div class=\"notice\">[\s\S]*?</div>\s*", re.I),
)

# 导出时 <CodeBlock language="x" editable>…</CodeBlock> 会被打散成多个 <p>、
# 标签全部转义成 &lt;CodeBlock&gt;，结果既不是代码块也不是组件，整段裸文本显示。
# 这里把它重新拼回一个 <pre><code>。内容跨 <p> 边界，用懒惰匹配跨段捕获。
_CODEBLOCK_RUN_RE = re.compile(
    r"<p>\s*&lt;CodeBlock\b((?:(?!&gt;).)*?)&gt;((?:(?!&lt;CodeBlock\b)[\s\S])*?)&lt;/CodeBlock&gt;\s*</p>"
)


def _fix_codeblocks(html: str) -> str:
    """把被导出器打散的 CodeBlock 段落合并成真正的代码块。"""

    def repl(m: re.Match) -> str:
        attrs, raw = m.group(1), m.group(2)
        lang_m = re.search(r'language=&quot;([^&]*)&quot;', attrs) or re.search(
            r'language="([^"]*)"', attrs
        )
        lang = (lang_m.group(1) if lang_m else "") or ""
        # 段落边界标签不是代码内容，剥掉。导出有两种形态：
        #   a) 真标签 </p><p>；b) 双重转义的 &lt;/p&gt;&lt;p&gt;（按「闭合+开标签成对」还原成换行）
        #    真标签同时保留成空行：后续 _indent_flat_python 靠它判断段落（块）边界
        raw = re.sub(r"</\s*p\s*>\s*<p\s*>", "\n\n", raw)
        raw = re.sub(r"</?\s*p\s*>", "", raw)
        raw = re.sub(r"&lt;/p&gt;\s*&lt;p&gt;", "\n", raw)
        raw = re.sub(r"(?m)^\s*&lt;/?p&gt;\s*$", "", raw)
        code = htmllib.unescape(raw).strip("\n")
        return '<pre data-language="%s"><code>%s</code></pre>' % (
            lang,
            htmllib.escape(code, quote=False),
        )

    return _CODEBLOCK_RUN_RE.sub(repl, html)


# ---- 被压平的 Python 代码块：按结构推断缩进 ----
# 场景：模型直写 <CodeBlock> 时，导出器把它拆成多个 <p>，每行行首空白全部丢失。
# 这里只能靠语法结构猜：段内 `:` 结尾进一级，else/elif/except/finally 同级，
# 圆括号/方括号/花括号未闭合时续行再进一级；空行（原 <p> 边界）视作软段落边界。
_FLAT_PY_RE = re.compile(
    r'(<pre\b[^>]*\bdata-language=["\'](?:python|py|python3)["\'][^>]*>\s*<code\b[^>]*>)([\s\S]*?)(</code\s*>\s*</pre>)',
    re.I,
)


def _strip_py_literals(s: str, triple):
    """剥掉字符串字面量与注释，只留结构字符。返回 (代码, 新的三引号状态)。"""
    out = []
    i, n = 0, len(s)
    while i < n:
        if triple:
            j = s.find(triple, i)
            if j < 0:
                return "".join(out), triple
            i = j + 3
            triple = None
            continue
        c = s[i]
        if c == "#":
            break
        if s.startswith('"""', i) or s.startswith("'''", i):
            triple = s[i : i + 3]
            i += 3
            continue
        if c in "\"'":
            q, i = c, i + 1
            while i < n:
                if s[i] == "\\":
                    i += 2
                    continue
                if s[i] == q:
                    i += 1
                    break
                i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out), triple


def _lead_closers(cp: str) -> int:
    n = 0
    for ch in cp:
        if ch in ")]}":
            n += 1
        else:
            break
    return n


def _indent_flat_python(code: str, step: int = 4) -> str:
    """给每行都没有缩进的 Python 代码重新排出缩进。已经有缩进就原样返回。"""
    lines = code.split("\n")
    body = [l for l in lines if l.strip()]
    if not body or any(l[:1].isspace() for l in body):
        return code

    out = []
    depth = 0
    paren = 0
    paren_kind = None      # 多行签名属于 def 还是 class
    triple = None
    class_body = None      # 最近一个 class 的体深度，用来定位跨段落的成员
    last_kind = None       # 上一个自己打开的块是 class / def / other
    at_seg_start = True
    term_pending = False   # 多行 return/raise：等括号闭合后再回退
    blanks = 0             # 连续空行数（来自 <p> 段落边界）

    for raw in lines:
        line = raw.strip()
        if not line:
            out.append("")
            blanks += 1
            at_seg_start = True
            continue
        prev_blanks = blanks
        blanks = 0

        was_triple = triple
        code_part, triple = _strip_py_literals(line, triple)
        cp = code_part.strip()

        if was_triple:
            out.append(" " * (step * (depth + (1 if paren else 0))) + line)
            continue

        if at_seg_start and paren == 0:
            is_member = bool(re.match(r"^(?:@|async\s+def\b|def\b)", cp))
            if re.match(r"^(?:async\s+)?class\b", cp):
                depth = 0                 # 顶层 class；嵌套 class 极罕见，先按顶层算
            elif is_member:
                depth = class_body if class_body is not None else 0
            elif last_kind == "def":
                # 上一个块是 def：深度还在成员级或函数体第一层时，说明 class 已结束
                if class_body is not None and depth <= class_body + 1:
                    depth = 0
            else:
                depth = 0                 # class 已结束 / 本来就是顶层
            # 导出器把连续空行压成一个段落间隔；顶层定义前按 PEP8 补回第二个
            if depth == 0 and prev_blanks == 1 and re.match(r"^(?:@|class\b|def\b|async\b)", cp):
                out.append("")
            at_seg_start = False

        lead = _lead_closers(cp) if paren else 0
        if paren:
            # 括号内续行：层数越多缩进越深，闭合行退回到对应的起始层
            indent = depth + max(0, paren - lead)
        else:
            if re.match(r"^(?:elif|else|except|finally|case)\b", cp) and depth > 0:
                depth -= 1
            indent = depth

        out.append(" " * (step * indent) + line)

        opens = sum(cp.count(c) for c in "([{")
        closes = sum(cp.count(c) for c in ")]}")
        if paren == 0 and opens > closes:
            m = re.search(r"\b(class|def)\b", cp)
            paren_kind = m.group(1) if m else None
        paren = max(0, paren + opens - closes)

        if paren == 0 and cp.rstrip().endswith(":") and not cp.rstrip().endswith("::"):
            kind = paren_kind or ""
            if not kind:
                if re.match(r"^(?:async\s+)?class\b", cp):
                    kind = "class"
                elif re.match(r"^(?:async\s+)?def\b", cp):
                    kind = "def"
                else:
                    kind = "other"
            last_kind = kind
            depth = indent + 1
            if kind == "class":
                class_body = depth
            paren_kind = None
        elif re.match(r"^(?:raise|return|break|continue|pass)\b", cp):
            # 终止语句：这一块不会再有同级语句，paren 归零后回退一级
            if paren == 0:
                depth = max(0, depth - 1)
            else:
                term_pending = True

        if term_pending and paren == 0:
            depth = max(0, depth - 1)
            term_pending = False
    return "\n".join(out)


def _restore_flat_python(html: str) -> str:
    def repl(m: re.Match) -> str:
        code = htmllib.unescape(m.group(2))
        restored = _indent_flat_python(code)
        if restored == code:
            return m.group(0)
        return m.group(1) + htmllib.escape(restored, quote=False) + m.group(3)

    return _FLAT_PY_RE.sub(repl, html)


_FLAT_VUE_RE = re.compile(
    r'(<pre\b[^>]*\bdata-language=["\']vue["\'][^>]*>\s*<code\b[^>]*>)([\s\S]*?)(</code>\s*</pre>)',
    re.I,
)
_VUE_TAG_RE = re.compile(r'<(/?)([\w.-]+)\b(?:[^>"\']|"[^"]*"|\'[^\']*\')*(/?)>')
_JS_QUOTED_RE = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//.*$')


def _indent_flat_vue(code: str) -> str:
    """恢复导出器丢掉全部行首空格的简单 Vue 单文件组件。"""
    lines = code.splitlines()
    nonempty = [line for line in lines if line.strip()]
    if (not nonempty or any(line[:1].isspace() for line in nonempty)
            or nonempty[0] != '<template>'
            or not any(re.match(r'<script\b', line) for line in nonempty)
            or re.search(r'<(?:pre|textarea)\b|<!--|/\*|`', code, re.I)):
        return code
    depth = 0
    in_script = False
    pending_tag = False
    out = []
    for line in lines:
        if not line:
            out.append(line)
            continue
        if in_script and not line.startswith('</script'):
            clean = _JS_QUOTED_RE.sub('', line)
            leading = re.match(r'^[}\]]+', clean)
            before = len(leading.group(0)) if leading else 0
            indent = max(0, depth - before)
            out.append('  ' * indent + line)
            depth = max(0, depth + clean.count('{') + clean.count('[')
                        - clean.count('}') - clean.count(']'))
            continue
        if pending_tag:
            end = line.endswith('>')
            out.append('  ' * (depth + (0 if end and line.startswith('/>') else 1)) + line)
            if end:
                pending_tag = False
                if not line.endswith('/>'):
                    depth += 1
            continue
        closing = bool(re.match(r'</[\w.-]+', line))
        if closing:
            depth = max(0, depth - 1)
        out.append('  ' * depth + line)
        tags = list(_VUE_TAG_RE.finditer(line))
        if not tags and re.match(r'<[\w.-]+\b', line) and not line.endswith('>'):
            pending_tag = True
        else:
            opens = sum(1 for m in tags if not m.group(1) and not m.group(0).endswith('/>')
                        and m.group(2).lower() not in {'br', 'hr', 'img', 'input', 'meta', 'link'})
            closes = sum(1 for m in tags if m.group(1))
            depth = max(0, depth + opens - closes + int(closing))
        if re.match(r'<script\b', line):
            in_script = True
            depth = max(0, depth - 1)
        elif line.startswith('</script'):
            in_script = False
    return '\n'.join(out) + ('\n' if code.endswith('\n') else '')


def _restore_flat_vue(html: str) -> str:
    def repl(m: re.Match) -> str:
        code = htmllib.unescape(m.group(2))
        restored = _indent_flat_vue(code)
        if restored == code:
            return m.group(0)
        return m.group(1) + htmllib.escape(restored, quote=False) + m.group(3)
    return _FLAT_VUE_RE.sub(repl, html)


# 导出器有时把组件后半截当成 markdown 列表的续行，塞进 <li> 里并整体转义。
# 这些转义片段就是「组件源码」，需要从列表里提出来（标签集合见 dslsyntax）。
_LIST_DSL_RE = escaped_re()
_UL_RE = re.compile(r"<ul\b[^>]*>[\s\S]*?</ul>", re.I)
_CODE_EXAMPLE_RE = re.compile(r'<(?:code|pre)\b[^>]*>[\s\S]*?</(?:code|pre)\s*>', re.I)
_RAW_INLINE_CODE_RE = re.compile(
    r'(<code\b[^>]*>\s*)(<(?:title|script|style|textarea|xmp|iframe|noembed|noframes|plaintext)\b[^>]*>)(\s*</code>)', re.I)


def _repair_raw_inline_code(doc: str) -> str:
    """修复旧版误反转义的行内标签示例，避免浏览器吞掉后续正文。"""
    def repair_article(article: re.Match) -> str:
        return _RAW_INLINE_CODE_RE.sub(
            lambda m: m.group(1) + htmllib.escape(m.group(2), quote=False) + m.group(3),
            article.group(0))
    return _ARTICLE_RE.sub(repair_article, doc)


def _has_list_dsl(text: str) -> bool:
    return bool(_LIST_DSL_RE.search(_CODE_EXAMPLE_RE.sub('', text)))


def _repair_list_spill(html: str) -> str:
    """把被塞进 <li> 的组件源码还原成独立段落。

    典型形态：`<box …>` 开在某个 <p> 里，但 `</box>` 和它后面的兄弟节点
    被 markdown 当成了列表项的续行，于是 `<li>调整作息 &lt;text/&gt; &lt;/box&gt;
    &lt;grid-item&gt; …</li>` —— 组件永远闭合不了，整块变成一坨裸文本。
    这里把这类 <li> 的内容提出来放到 <p> 里（其余纯文本项仍留在 <ul>），
    让原来的段落合并逻辑接着把它们拼回组件。
    """
    def repl(m: re.Match) -> str:
        block = m.group(0)
        if not _has_list_dsl(block):
            return block
        open_end = block.index(">") + 1
        close_at = block.lower().rindex("</ul>")
        inner = block[open_end:close_at]
        parts = re.split(r"(<li\b[^>]*>)", inner, flags=re.I)
        out: List[str] = []
        buf: List[str] = []

        def flush() -> None:
            if buf:
                out.append("<ul>" + "".join(buf) + "</ul>")
                del buf[:]

        if parts[0].strip():
            out.append(parts[0])
        for k in range(1, len(parts), 2):
            open_tag = parts[k]
            rest = parts[k + 1] if k + 1 < len(parts) else ""
            low = rest.lower()
            if "</li>" in low:
                pos = low.index("</li>")
                body, tail = rest[:pos], rest[pos + 5:]
            else:
                body, tail = rest, ""
            if _has_list_dsl(body):
                flush()
                out.append("<p>" + body.strip() + "</p>")
                if tail.strip():
                    out.append(tail.strip())
            else:
                buf.append(open_tag + body + "</li>")
        flush()
        return "".join(out)

    return _UL_RE.sub(repl, html)


_EXTRA_CSS = """
.wb-widget { margin: 1.4rem 0; }
.wb-widget:empty { display: none; }
.wb-widget input.wb-slider { appearance: none; -webkit-appearance: none; height: 24px;
  border-radius: 999px; background: #f1f3f5; cursor: pointer; }
.wb-widget input.wb-slider::-webkit-slider-thumb { appearance: none; -webkit-appearance: none;
  width: 20px; height: 20px; border: 1px solid #dce1e5; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.14); }
.wb-widget input.wb-slider::-moz-range-thumb { width: 18px; height: 18px;
  border: 1px solid #dce1e5; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,.14); }
.wb-widget input.wb-slider:focus-visible { outline: 2px solid #409eff; outline-offset: 2px; }
.wb-widget input.wb-slider:disabled { opacity: .55; cursor: not-allowed; }
.wb-genui { margin: -6px 0 1.4rem; padding: 10px 14px; border-left: 3px solid #2563eb;
            background: #eff6ff; color: #1e3a8a; border-radius: 0 8px 8px 0; font-size: 14px; }
.wb-writing { margin: 1rem 0; padding: 0.8rem 1rem; background: #f8fafb;
             border: 1px solid #e4e7eb; border-left: 3px solid #10a37f; border-radius: 6px; }
.wb-md-table { border-collapse: collapse; width: 100%; margin: 0.6rem 0; font-size: 0.9em; }
.wb-md-table th, .wb-md-table td { border: 1px solid #d4d4d4; padding: 0.35rem 0.55rem;
                                   text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.wb-md-table th { background: #f6f6f6; }

.wb-toast { position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%);
            background: #111827; color: #fff; padding: 10px 18px; border-radius: 9px;
            font-size: 14px; z-index: 99; box-shadow: 0 6px 20px rgba(0,0,0,.18); }
.wb-toast-bad { background: #b91c1c; }
.wb-err { border: 1px dashed #f0b429; background: #fffbeb; color: #92400e;
          padding: 10px 12px; border-radius: 8px; font-size: 13px; }
.wb-mermaid { margin: 1em 0; overflow-x: auto; text-align: center; }
.wb-mermaid svg { max-width: 100%; height: auto; }
pre.wb-copyable { position: relative; padding-top: 38px; }
.wb-copy-code { position: absolute; z-index: 1; top: 6px; right: 10px;
  padding: 3px 9px; border: 1px solid #d1d5db; border-radius: 5px;
  background: #fff; color: #374151; font: 12px sans-serif; cursor: pointer; }
.wb-copy-code:hover { background: #f3f4f6; }
pre[data-language] { position: relative; padding-top: 36px; }
pre[data-language]::before {
  content: "</> " attr(data-language);
  position: absolute; top: 0; left: 0; right: 0;
  padding: 8px 14px 6px; font-size: 12px; color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  border-bottom: 1px solid rgba(128,128,128,.15);
  background: rgba(128,128,128,.06);
}
pre code.hljs { background: transparent; padding: 0; }
.wb-widget pre[data-language] {
  background: #e7e7e7; border: 1px solid #d6d6d6; border-radius: 20px;
  padding: 44px 16px 16px; white-space: pre; overflow-x: auto;
  line-height: 1.55;
}
.wb-widget pre[data-language]::before {
  background: transparent; border: 0; top: 8px; left: 16px;
  padding: 0; font-weight: 600; color: #111827;
}
html { scroll-behavior: smooth; }
@media (min-width: 1100px) { body.wb-with-toc { padding-right: 272px; } }
/* 宽屏（≥1320px）时主内容相对整个窗口居中：目录栏浮在右侧，不挤压正文。
   防重叠下限：W/2 + 46rem/2 ≤ W - 260px - 间隙，取 1320px 留出约 30px 间距；
   padding-right 恢复 1rem 与左侧对称，否则 margin:auto 会整体右偏半格。 */
@media (min-width: 1320px) { body.wb-with-toc { padding-right: 1rem; } }
.wb-toc { display: none; }
@media (min-width: 1100px) {
  .wb-toc {
    display: block; position: fixed; top: 0; right: 0; width: 260px;
    height: 100vh; overflow-y: auto; padding: 26px 18px 48px;
    border-left: 1px solid #ececec; background: #fcfcfc;
    font-size: 13px; line-height: 1.55; z-index: 30;
  }
}
.wb-toc-t { font-size: 14px; font-weight: 700; color: #111827; line-height: 1.45;
            margin: 0 0 12px; padding-bottom: 10px; border-bottom: 1px solid #ececec; }
.wb-toc a { display: block; padding: 5px 9px; margin: 1px 0; border-radius: 7px;
            color: #4b5563; text-decoration: none; cursor: pointer;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-toc a:hover { background: #eef2f7; color: #111827; }
.wb-toc a.lv1 { font-weight: 600; color: #1f2937; margin-top: 10px; }
.wb-toc a.lv2 { padding-left: 21px; font-weight: 400; color: #6b7280; font-size: 12.5px; }
.wb-toc a.on { background: #e6efff; color: #1a56db; font-weight: 600; }
.wb-toc-empty { color: #9ca3af; font-size: 12px; padding: 4px 9px; }
@media print { .wb-toc { display: none !important; } body.wb-with-toc { padding-right: 0; } }
"""

# 右侧目录：提问和回答中各级标题，点击平滑滚动，滚动时高亮。
_TOC_JS = r"""
(function(){
  function clean(t){ return (t||'').replace(/\s+/g,' ').trim(); }
  function cut(t,n){ return t.length > n ? t.slice(0,n) + '\u2026' : t; }
  function build(){
    var turns = document.querySelectorAll('article.turn');
    if (!turns.length) return;
    var ti = document.querySelector('h1.doc-title') || document.querySelector('h1');
    var title = clean(ti && ti.textContent) || clean(document.title) || '对话';
    var nav = document.createElement('nav');
    nav.className = 'wb-toc';
    var head = document.createElement('div');
    head.className = 'wb-toc-t';
    head.textContent = title;
    nav.appendChild(head);

    var items = [], n = 0;
    function add(el, text, lv){
      if (!el || !text) return;
      n += 1;
      var id = el.id;
      if (!id) {
        id = 'wb-sec-' + n;
        while (document.getElementById(id)) id += '-x';
        el.setAttribute('id', id);
      }
      var a = document.createElement('a');
      a.className = 'lv' + lv;
      if (lv > 2) a.style.paddingLeft = Math.min(9 + (lv - 1) * 12, 69) + 'px';
      a.textContent = cut(text, lv === 1 ? 34 : 28);
      a.title = text;
      a.setAttribute('data-target', id);
      nav.appendChild(a);
      items.push({ a: a, el: el });
    }
    for (var i = 0; i < turns.length; i++) {
      var t = turns[i];
      var body = t.querySelector('.body');
      if (t.className.indexOf('user') >= 0) {
        add(t, clean(body && body.textContent), 1);
      } else {
        var hs = Array.from((body || t).querySelectorAll('h1, h2, h3, h4, h5, h6'))
          .filter(function(h){ return !h.closest('pre, .wb-widget'); });
        var minLevel = hs.reduce(function(min, h){ return Math.min(min, Number(h.tagName.slice(1))); }, 6);
        for (var j = 0; j < hs.length; j++) {
          var level = 2 + Number(hs[j].tagName.slice(1)) - minLevel;
          add(hs[j], clean(hs[j].textContent), level);
        }
      }
    }
    if (!items.length) {
      var p = document.createElement('div');
      p.className = 'wb-toc-empty';
      p.textContent = '\uff08\u672c\u9875\u6ca1\u6709\u5206\u8282\u6807\u9898\uff09';
      nav.appendChild(p);
    }
    document.body.appendChild(nav);
    document.body.className += ' wb-with-toc';

    nav.addEventListener('click', function(e){
      var t = e.target, a = t && t.closest ? t.closest('a') : null;
      if (!a) return;
      e.preventDefault();
      var el = document.getElementById(a.getAttribute('data-target'));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    var raf = 0;
    function spy(){
      raf = 0;
      var y = window.scrollY + 130, cur = items.length ? 0 : -1;
      for (var i = 0; i < items.length; i++) {
        if (items[i].el.getBoundingClientRect().top + window.scrollY <= y) cur = i;
      }
      for (var k = 0; k < items.length; k++) items[k].a.classList.toggle('on', k === cur);
    }
    window.addEventListener('scroll', function(){ if (!raf) raf = requestAnimationFrame(spy); }, { passive: true });
    window.addEventListener('resize', spy);
    spy();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
"""

# 已知的坏组件：{@body} 里写了 JSX，运行时 new Function 无法编译 → 换成纯字符串拼接
_BAD_PAD = (
    "const padSyntax = padValues.every((v)=>v===padValues[0]) ? <code>${padValues[0]}px</code> "
    ": padValues[0]===padValues[2] && padValues[1]===padValues[3] ? <code>${padValues[0]}px ${padValues[1]}px</code> "
    ": padValues[1]===padValues[3] ? <code>${padValues[0]}px ${padValues[1]}px ${padValues[2]}px</code> "
    ": <code>${padValues[0]}px ${padValues[1]}px ${padValues[2]}px ${padValues[3]}px</code>"
)
_GOOD_PAD = (
    "const pv = padValues; "
    "const padSyntax = (pv.every((v)=>v===pv[0]) ? [pv[0]] "
    ": (pv[0]===pv[2] && pv[1]===pv[3]) ? [pv[0],pv[1]] "
    ": (pv[1]===pv[3]) ? [pv[0],pv[1],pv[2]] "
    ": [pv[0],pv[1],pv[2],pv[3]]).map((n)=>n+\"px\").join(\" \")"
)


@dataclass
class Audit:
    widgets: int = 0
    codeblocks: int = 0
    unresolved: int = 0
    issues: List[str] = field(default_factory=list)


@dataclass
class Result:
    ok: bool
    widgets: int = 0
    message: str = ""
    output: str = ""
    skipped: bool = False
    parts: int = 0
    outputs: List[str] = field(default_factory=list)
    audit: Audit | None = None
    extra: dict = field(default_factory=dict)


_RAW_DSL_RE = re.compile(r"<(?:%s)\b|\{@body\b|\{#(?:each|if)\b" % tag_pattern())


class _VisibleDslScanner(HTMLParser):
    _IGNORED = {"script", "style", "pre", "code", "textarea"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: List[str] = []
        self.unresolved = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        self.stack.append(tag)

    def handle_startendtag(self, tag: str, attrs) -> None:
        pass

    def handle_endtag(self, tag: str) -> None:
        if tag in self.stack:
            self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]

    def handle_data(self, data: str) -> None:
        if not self._IGNORED.intersection(self.stack):
            self.unresolved += len(_RAW_DSL_RE.findall(data))


def audit_html(doc: str) -> Audit:
    """验收可见正文：发现仍以文本显示的 DSL 和失效的组件索引。"""
    scanner = _VisibleDslScanner()
    scanner.feed(doc)
    audit = Audit(
        widgets=len(re.findall(r'<div class="wb-widget"\s+data-w="\d+"', doc)),
        codeblocks=len(re.findall(r'<pre\b[^>]*data-language=', doc, re.I)),
        unresolved=scanner.unresolved,
    )
    if audit.unresolved:
        audit.issues.append("仍有 %d 处组件源码显示在正文中" % audit.unresolved)
    indices = [int(x) for x in re.findall(r'<div class="wb-widget"\s+data-w="(\d+)"', doc)]
    payload = _WIDGET_JSON_RE.search(doc)
    if indices and not payload:
        audit.issues.append("组件数据缺失")
    elif payload:
        try:
            sources = json.loads(payload.group(2))
            if any(i >= len(sources) for i in indices):
                audit.issues.append("组件索引与数据不匹配")
        except ValueError:
            audit.issues.append("组件数据无法解析")
    return audit


def looks_like_export(html: str) -> bool:
    """判断是不是这类导出文件，避免误伤普通网页。"""
    return (
        "Exported from ChatGPT" in html
        or 'class="turn assistant"' in html
        or "&lt;box" in html
        or 'class="role">Assistant' in html
    )


def already_converted(html: str) -> bool:
    return "wb-widget-data" in html


_ASSET_DIR = os.path.dirname(os.path.abspath(__file__))
_hljs_cache: dict = {}
_mermaid_cache: dict = {}
_MERMAID_RE = re.compile(r'(?:data-language\s*=\s*["\']mermaid["\']|class\s*=\s*["\'][^"\']*\blanguage-mermaid\b)', re.I)


def _mermaid_source() -> str:
    if "js" not in _mermaid_cache:
        try:
            with open(os.path.join(_ASSET_DIR, "mermaid.min.js"), encoding="utf-8") as f:
                _mermaid_cache["js"] = f.read()
        except OSError:
            _mermaid_cache["js"] = ""
    return _mermaid_cache["js"]


def _hljs_assets() -> Tuple[str, str]:
    """离线语法高亮资产：(highlight.js 源码, 主题 CSS)。缺文件时返回空串，仅丢失高亮。"""
    if "js" not in _hljs_cache:
        try:
            with open(os.path.join(_ASSET_DIR, "hljs.min.js"), "r", encoding="utf-8") as f:
                js = f.read()
            with open(os.path.join(_ASSET_DIR, "hljs-github.min.css"), "r", encoding="utf-8") as f:
                css = f.read()
        except OSError:
            js = css = ""
        _hljs_cache["js"], _hljs_cache["css"] = js, css
    return _hljs_cache["js"], _hljs_cache["css"]


def _relax_csp(html: str) -> str:
    """放行内联脚本；运行时需要用 new Function 编译模板，所以还要 unsafe-eval。"""

    def repl(m: re.Match) -> str:
        tag = m.group(0)
        # 注意：content 的值里本身带单引号（'none'），必须按引号配对取值，
        # 不能用 [^"']* —— 那会在第一个单引号处截断。
        content_m = re.search(r"content=([\"'])(.*?)\1", tag, re.I | re.S)
        if not content_m:
            return ""
        content = content_m.group(2)
        directives = [part.strip() for part in content.split(";") if part.strip()]
        for name, value in (("script-src", "'unsafe-inline' 'unsafe-eval'"),
                            ("script-src-elem", "'unsafe-inline'"),
                            ("img-src", "'self' data: blob: https: http: file:")):
            for i, directive in enumerate(directives):
                if directive.split(None, 1)[0].lower() == name:
                    directives[i] = name + " " + value
                    break
            else:
                directives.append(name + " " + value)
        content = "; ".join(directives) + ";"
        return tag[: content_m.start(2)] + content + tag[content_m.end(2):]

    return _CSP_META_RE.sub(repl, html)


def _strip_chrome(html: str) -> str:
    """去掉导出器自带的打印提示条和导出页脚，只留正文。"""
    for rx in _CHROME_RES:
        html = rx.sub("", html)
    return html


class _Block(NamedTuple):
    """助手消息里的一个顶层块：要么是 <p>（可能含组件源码），要么是 <pre>。"""

    start: int
    end: int
    source: str        # 反解义后的候选组件源码
    is_paragraph: bool


_BLOCK_RE = re.compile(r"<p>(.*?)</p>|<pre\b[^>]*>.*?</pre>", re.S | re.I)
_ARTICLE_RE = re.compile(r'<article class="turn assistant"[^>]*>.*?</article>', re.S)


def _iter_blocks(article: str, base: int) -> List[_Block]:
    blocks: List[_Block] = []
    for m in _BLOCK_RE.finditer(article):
        if m.group(1) is None:
            # <pre> 原样保留，交给 {@html:...} 指令渲染
            blocks.append(_Block(base + m.start(), base + m.end(),
                                 "{@html:" + quote(m.group(0), safe="") + "}", False))
        else:
            blocks.append(_Block(
                base + m.start(), base + m.end(),
                _normalize_inline_template_code(htmllib.unescape(m.group(1))),
                True,
            ))
    return blocks


def _needs_more(acc: str, starts_with_body: bool, has_component: bool) -> bool:
    """当前累积的源码是否还需要继续往后合并。"""
    return (tag_balance(acc) != 0
            or directive_balance(acc) != 0
            or (starts_with_body and not has_component))


def _merge_component(html: str, blocks: List[_Block], i: int) -> "tuple[int, str] | None":
    """从第 i 个块开始，把属于同一个组件的块合并起来。

    返回 (末块下标, 组件源码)；判定为「不是组件」时返回 None。
    """
    acc = blocks[i].source
    starts_with_body = acc.lstrip().startswith("{@body")
    has_component = bool(_OPEN_RE.search(acc))
    truncated = False
    j = i

    while _needs_more(acc, starts_with_body, has_component) and j + 1 < len(blocks):
        nxt = blocks[j + 1]
        gap = html[blocks[j].end:nxt.start]
        if gap.strip():
            # 组件内部常夹着真实 HTML（<ul>、<strong>、<br> 等）。只要它不含
            # 标题/表格这类「组件已结束」的标志，就作为 {@html:...} 指令并进组件源，
            # 而不是把组件腰斩。
            if _GAP_BREAK_RE.search(gap):
                truncated = True
                break
            acc += "\n{@html:" + quote(gap.strip(), safe="") + "}\n" + nxt.source
        else:
            acc += "\n" + nxt.source
        j += 1
        has_component = has_component or bool(_OPEN_RE.search(nxt.source))

    forced = False
    ran_out = j + 1 >= len(blocks)
    if has_component and not is_balanced(acc) and (truncated or ran_out):
        # 组件尾部被导出器截断（或被 markdown 列表吃掉）：补上闭合标签先交出去。
        # 宁可少一层容器，也不要把 DSL 裸文本漏到正文。
        acc += "\n" + closing_tail(acc)
        forced = True

    if forced or (is_balanced(acc) and (not starts_with_body or has_component)):
        return j, acc.strip()
    return None


def _collect_regions(html: str) -> List[Tuple[int, int, str]]:
    """找出所有组件所在的区间 [(start, end, 源码)]，供后续替换成占位容器。"""
    regions: List[Tuple[int, int, str]] = []
    for art in _ARTICLE_RE.finditer(html):
        blocks = _iter_blocks(art.group(0), art.start())
        i = 0
        while i < len(blocks):
            head = blocks[i]
            if not head.is_paragraph or not _START_RE.match(head.source):
                i += 1
                continue
            merged = _merge_component(html, blocks, i)
            if merged is None:
                i += 1
                continue
            last, source = merged
            regions.append((head.start, blocks[last].end, source))
            i = last + 1
    return regions


def _normalize(html: str) -> "tuple[str, bool]":
    """把所有会改变字符串长度的改写集中做掉，之后才能安全地按偏移量切割。

    顺序有依赖，别随手调换：
      1. 放开 CSP、去掉导出器自带的横幅与页脚
      2. 剥掉 <Cite> 引用标记
      3. 把被拆散的 CodeBlock 拼回 <pre><code>
      4. 把转义的 Link 还原成链接，并捞回被列表吞掉的组件源码
    返回 (处理后的 HTML, 是否修过代码块或链接)。
    """
    repaired = _repair_raw_inline_code(html)
    inline_fixed = repaired != html
    html = repaired
    html = _relax_csp(html)
    html = _strip_chrome(html)
    html = _CITE_RE.sub("", html)
    fixed = _restore_flat_python(_restore_flat_vue(_fix_codeblocks(html)))
    changed = inline_fixed or fixed != html
    linked = _fix_links(fixed)
    return _repair_list_spill(linked), changed or linked != fixed


def _build_inject(payload: str, include_mermaid: bool = False) -> str:
    """生成注入到 </body> 前的样式 / 数据 / 运行时脚本。"""
    hljs_js, hljs_css = _hljs_assets()
    highlight_boot = (
        "(function(){function run(){var cs=document.querySelectorAll('pre[data-language]>code');"
        "for(var i=0;i<cs.length;i++){var c=cs[i],lang=c.parentElement.getAttribute('data-language');"
        "if(lang&&lang.toLowerCase()==='mermaid')continue;"
        "if(window.hljs){if(lang&&hljs.getLanguage(lang))c.classList.add('language-'+lang);"
        "c.classList.add('hljs');try{hljs.highlightElement(c);}catch(e){}}}}"
        "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();})();"
    )
    mermaid_js = _mermaid_source() if include_mermaid else ""
    copy_boot = r"""
(function () {
  function fallback(text) {
    var input = document.createElement('textarea');
    input.value = text;
    input.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(input);
    input.select();
    try { return document.execCommand('copy'); }
    finally { input.remove(); }
  }
  function add(pre) {
    if (pre.classList.contains('wb-copyable')) return;
    var code = pre.querySelector(':scope > code');
    if (!code) return;
    pre.classList.add('wb-copyable');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-copy-code';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码');
    button.addEventListener('click', async function () {
      var ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(code.textContent);
          ok = true;
        }
      } catch (_) {}
      if (!ok) { try { ok = fallback(code.textContent); } catch (_) {} }
      button.textContent = ok ? '已复制' : '复制失败';
      setTimeout(function () { button.textContent = '复制'; }, 1800);
    });
    pre.appendChild(button);
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.tagName === 'PRE') add(root);
    root.querySelectorAll('pre').forEach(add);
  }
  function run() {
    scan(document.body);
    new MutationObserver(function (records) {
      records.forEach(function (record) { record.addedNodes.forEach(scan); });
    }).observe(document.body, {childList: true, subtree: true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
"""
    mermaid_boot = r"""
(function () {
  async function run() {
    if (!window.mermaid) return;
    mermaid.initialize({startOnLoad: false, securityLevel: 'strict'});
    var blocks = document.querySelectorAll('pre[data-language] > code, pre > code.language-mermaid');
    var index = 0;
    for (var code of blocks) {
      var pre = code.parentElement;
      if ((pre.getAttribute('data-language') || '').toLowerCase() !== 'mermaid' &&
          !code.classList.contains('language-mermaid')) continue;
      try {
        var id = 'wb-mermaid-' + index++;
        while (document.getElementById(id)) id += '-x';
        var result = await mermaid.render(id, code.textContent);
        var figure = document.createElement('div');
        figure.className = 'wb-mermaid';
        figure.innerHTML = result.svg;
        pre.replaceWith(figure);
      } catch (err) {
        console.warn('Mermaid render failed:', err);
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
"""
    return (
        "\n<style>%s\n%s</style>\n"
        '<script id="wb-widget-data" type="application/json">%s</script>\n'
        "<script>\n%s\n</script>\n"
        "<script>%s</script>\n<script>%s</script>\n"
        % (hljs_css, _EXTRA_CSS, payload, runtime_source(), hljs_js, highlight_boot)
        + ("<script>" + mermaid_js + "</script>\n<script>" + mermaid_boot + "</script>\n" if mermaid_js else "")
        + "<script>" + copy_boot + "</script>\n"
        + '<script id="wb-toc-script">' + _TOC_JS + "</script>\n"
    )


def convert_html(html: str, allow_empty: bool = False) -> Result:
    """把导出 HTML 字符串转成可交互版本。

    allow_empty=True 时，即使一段交互组件都没有也照常返回（拆分纯文字对话时需要）。
    """
    if already_converted(html):
        restored = _repair_raw_inline_code(_restore_flat_vue(html))
        # 新增支持的组件可能仍留在旧页面正文里；保留原编号并补充转换。
        regions = _collect_regions(restored)
        if regions:
            data_re = re.compile(r'(<script\s+id="wb-widget-data"\s+type="application/json">)([\s\S]*?)(</script>)', re.I)
            data_match = data_re.search(restored)
            if data_match:
                sources = json.loads(data_match.group(2))
                offset = len(sources)
                for index in range(len(regions) - 1, -1, -1):
                    start, end, source = regions[index]
                    restored = restored[:start] + '<div class="wb-widget" data-w="%d"></div>' % (offset + index) + restored[end:]
                sources.extend(source.replace(_BAD_PAD, _GOOD_PAD) for _, _, source in regions)
                payload = json.dumps(sources, ensure_ascii=False).replace('</', '<\\/')
                restored = data_re.sub(lambda m: m.group(1) + payload + m.group(3), restored, count=1)
        # 旧文件中的组件数据仍在，替换内嵌运行时即可应用修复。
        runtime_re = re.compile(
            r'(<script\s+id="wb-widget-data"\s+type="application/json">[\s\S]*?</script>\s*<script>\n)'
            r'([\s\S]*?)(\n</script>)', re.I)
        restored = runtime_re.sub(lambda m: m.group(1) + runtime_source() + m.group(3),
                                  restored, count=1)
        toc_re = re.compile(
            r'<script(?:\s+id="wb-toc-script")?>\s*\(function\(\)\{\s*function clean\(t\)'
            r'[\s\S]*?</script>', re.I)
        restored = toc_re.sub(lambda m: '<script id="wb-toc-script">' + _TOC_JS + '</script>',
                              restored, count=1)
        if restored == html:
            return Result(ok=True, skipped=True, message="文件已经是可交互版，跳过")
        audit = audit_html(restored)
        return Result(ok=True, widgets=audit.widgets, message="已更新可交互页面",
                      audit=audit, extra={"doc": restored})

    if not looks_like_export(html):
        return Result(ok=False, message="看起来不是 ChatGPT / GPT Master 导出的文件")

    html, content_fixed = _normalize(html)
    regions = _collect_regions(html)
    has_mermaid = bool(_MERMAID_RE.search(html))
    has_code = bool(re.search(r'<pre\b[^>]*>\s*<code\b', html, re.I))
    if not regions and not content_fixed and not has_mermaid and not has_code and not allow_empty:
        audit = audit_html(html)
        message = audit.issues[0] if audit.issues else "没找到可还原的交互组件"
        return Result(ok=False, message=message, audit=audit)

    # 把每个组件区间换成占位容器，源码单独收进 JSON
    chunks: List[str] = []
    sources: List[str] = []
    cursor = 0
    for idx, (start, end, source) in enumerate(regions):
        chunks.append(html[cursor:start])
        chunks.append('<div class="wb-widget" data-w="%d"></div>' % idx)
        sources.append(source)
        cursor = end
    chunks.append(html[cursor:])
    doc = "".join(chunks)

    payload = json.dumps([s.replace(_BAD_PAD, _GOOD_PAD) for s in sources],
                         ensure_ascii=False).replace("</", "<\\/")
    inject = _build_inject(payload, include_mermaid=has_mermaid)
    if "</body>" in doc:
        doc = doc.replace("</body>", inject + "</body>", 1)
    else:
        doc += inject

    audit = audit_html(doc)
    message = "转换完成" if not audit.issues else "转换完成，需检查：" + "；".join(audit.issues)
    return Result(ok=True, widgets=len(sources), message=message, audit=audit, extra={"doc": doc})


def output_path_for(src: str) -> str:
    """输出到同目录的 xxx-可交互.html，绝不覆盖原文件。"""
    stem, _ = os.path.splitext(src)
    return stem + "-可交互.html"


# ---------------------------------------------------------------- 按对话拆分
_TURN_END = "</article>"
# 整块识别 turn 的开标签（user / assistant 都算），这样切出来的每页不会丢 <article>
_TURN_OPEN_RE = re.compile(r'<article class="turn (user|assistant)"[^>]*>')
_BODY_RE = re.compile(r'<div class="body" dir="auto">(.*?)</div>', re.S)
_WIDGET_JSON_RE = re.compile(
    r'(<script id="wb-widget-data" type="application/json">)(.*?)(</script>)', re.S
)


def _split_path(src: str, outdir: str, index: int, title: str) -> str:
    """拆分文件直接放在目标目录，重名时递增后缀。"""
    stem = _safe_name(os.path.splitext(os.path.basename(src))[0], limit=48)
    name = "%s-%02d-%s" % (stem, index + 1, _safe_name(title))
    path = os.path.join(outdir, name + ".html")
    suffix = 2
    while os.path.exists(path):
        path = os.path.join(outdir, "%s-%d.html" % (name, suffix))
        suffix += 1
    return path


def _plain_text(fragment: str) -> str:
    """把一段 HTML 压成纯文本，用来生成标题。"""
    text = re.sub(r"<[^>]+>", " ", fragment)
    text = htmllib.unescape(htmllib.unescape(text))
    text = re.sub(r"[#*`>]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _short_title(question: str) -> str:
    """从提问里提炼短标题：去掉寒暄词，取第一个分句。"""
    title = re.split(r"\s+-\s+|：|（|\(|，", question)[0].strip()
    for prefix in ("给我讲一下", "给我讲下", "给我讲讲", "给我讲", "接下来是", "接下来"):
        if title.startswith(prefix):
            title = title[len(prefix):].strip()
            break
    for suffix in ("给我讲一下", "给我讲下", "给我讲讲", "讲一下", "是什么", "怎么用", "怎么实现"):
        if title.endswith(suffix) and len(title) > len(suffix) + 4:
            title = title[: -len(suffix)].strip()
            break
    return title.strip(" \"'`。？！!?")


def _safe_name(text: str, limit: int = 24) -> str:
    """把标题变成安全的文件名片段：非字母数字/汉字一律压成 '-'，按词边界截断。"""
    text = re.sub(r"[^\w\u4e00-\u9fff]+", "-", text, flags=re.U)
    text = re.sub(r"-{2,}", "-", text).strip(" -._")
    if len(text) > limit:
        cut = text[:limit]
        if "-" in cut[limit // 2:]:
            cut = cut[: cut.rindex("-")]
        text = cut.strip(" -._")
    return text or "conversation"


def split_html(doc: str) -> List[Tuple[str, str]]:
    """把（已转成可交互的）文档按「一问一答」切开，返回 [(标题, 单页文档)]。

    每页保留原有样式、页脚与组件运行时；组件数据按页裁剪并重排 data-w 索引，
    所以拆出来的文件单独打开也能正常渲染。
    """
    opens = list(_TURN_OPEN_RE.finditer(doc))
    user_starts = [m.start() for m in opens if m.group(1) == "user"]
    if not user_starts:
        return []

    final_close = doc.rfind(_TURN_END)
    if final_close < user_starts[-1]:
        return []
    body_end = final_close + len(_TURN_END)
    head = doc[:user_starts[0]]
    tail = doc[body_end:]

    bounds = user_starts + [body_end]
    chunks = []
    for i in range(len(user_starts)):
        chunk = doc[bounds[i]:bounds[i + 1]].strip()
        if chunk:
            chunks.append(chunk)

    sources = None
    m = _WIDGET_JSON_RE.search(doc)
    if m:
        try:
            sources = json.loads(m.group(2))
        except ValueError:
            sources = None

    pages: List[Tuple[str, str]] = []
    total = len(chunks)
    for i, chunk in enumerate(chunks, 1):
        page = head + chunk + tail

        qm = _BODY_RE.search(chunk)
        q = _plain_text(qm.group(1)) if qm else ""
        title = _short_title(q)
        label = "%d/%d%s" % (i, total, (" · " + htmllib.escape(title)) if title else "")
        page = re.sub(r'(<h1 class="doc-title"[^>]*>)(.*?)(</h1>)',
                      lambda mm: mm.group(1) + mm.group(2) + " · " + label + mm.group(3),
                      page, count=1)

        if sources is not None:
            used = [int(x) for x in re.findall(r'data-w="(\d+)"', chunk)]
            if used:
                mapping = {old: new for new, old in enumerate(used)}
                page = re.sub(r'data-w="(\d+)"',
                              lambda mm: 'data-w="%d"' % mapping[int(mm.group(1))], page)
            payload = json.dumps([sources[u] for u in used if u < len(sources)],
                                 ensure_ascii=False).replace("</", "<\\/")
            page = _WIDGET_JSON_RE.sub(
                lambda mm: mm.group(1) + payload + mm.group(3), page, count=1
            )

        pages.append((title or str(i), page))
    return pages


def write_split_pages(src: str, pages: List[Tuple[str, str]],
                      selected_indices: List[int] | None = None,
                      outdir: str | None = None) -> Result:
    """只写选中的原始段落编号；文件名保留原来的顺序。"""
    if not pages:
        return Result(ok=False, message="没找到对话轮次，无法拆分")
    indices = list(range(len(pages))) if selected_indices is None else sorted(set(selected_indices))
    if not indices or any(i < 0 or i >= len(pages) for i in indices):
        return Result(ok=False, message="没有选择有效的拆分段落")

    outdir = outdir or os.path.dirname(os.path.abspath(src))
    try:
        os.makedirs(outdir, exist_ok=True)
        outputs = []
        audits = []
        for index in indices:
            title, page = pages[index]
            path = _split_path(src, outdir, index, title)
            with open(path, "w", encoding="utf-8") as f:
                f.write(page)
            outputs.append(path)
            audits.append(audit_html(page))
    except OSError as e:
        return Result(ok=False, message="写入失败：%s" % e)

    unresolved = sum(a.unresolved for a in audits)
    other_issues = list(dict.fromkeys(
        issue for a in audits for issue in a.issues
        if not issue.startswith("仍有 ")
    ))
    audit = Audit(
        widgets=sum(a.widgets for a in audits),
        codeblocks=sum(a.codeblocks for a in audits),
        unresolved=unresolved,
        issues=(["仍有 %d 处组件源码显示在正文中" % unresolved] if unresolved else [])
        + other_issues,
    )
    return Result(ok=True, message="已保存 %d / %d 段" % (len(outputs), len(pages)),
                  output=outdir, parts=len(outputs), outputs=outputs, audit=audit)


def split_file(src: str, doc: str, selected_indices: List[int] | None = None,
               outdir: str | None = None) -> Result:
    return write_split_pages(src, split_html(doc), selected_indices, outdir)


def prepare_file(src: str, allow_empty: bool = False) -> Result:
    """读取、转换并验收，供手动选择拆分段落时先预览。"""
    try:
        with open(src, "r", encoding="utf-8", errors="replace") as f:
            html = f.read()
    except OSError as e:
        return Result(ok=False, message="读取失败：%s" % e)
    return convert_html(html, allow_empty=allow_empty)


def convert_file(src: str, dst: str | None = None, split: bool = False,
                 split_indices: List[int] | None = None,
                 split_outdir: str | None = None) -> Result:
    """转换单个文件。split=True 时只输出拆分后的各段，不再生成整份可交互版。"""
    res = prepare_file(src, allow_empty=split)
    if not res.ok or res.skipped:
        return res

    doc = res.extra.get("doc", "")

    if split:
        sub = split_file(src, doc, split_indices, split_outdir)
        if not sub.ok:
            return sub
        res.parts = sub.parts
        res.outputs = sub.outputs
        res.output = sub.output
        res.audit = sub.audit
        res.message = sub.message
        return res

    dst = dst or output_path_for(src)
    temporary = None
    try:
        if os.path.normcase(os.path.abspath(dst)) == os.path.normcase(os.path.abspath(src)):
            # 先完整写入同目录的临时文件，再替换原文件，避免写入失败损坏原文件。
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False,
                                             dir=os.path.dirname(os.path.abspath(dst)),
                                             prefix=".export-enhancer-", suffix=".tmp") as f:
                temporary = f.name
                f.write(doc)
            os.replace(temporary, dst)
            temporary = None
        else:
            with open(dst, "w", encoding="utf-8") as f:
                f.write(doc)
    except OSError as e:
        return Result(ok=False, message="写入失败：%s" % e)
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass

    res.output = dst
    return res
