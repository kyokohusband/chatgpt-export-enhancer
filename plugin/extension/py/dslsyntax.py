# -*- coding: utf-8 -*-
"""组件 DSL 的词法工具：标签集合、标签扫描、平衡计算。

为什么单独抽出来：导出文件的三种变形（转义成文本、被 <li> 吞掉、被 <p> 拆散）
都要反复做同一件事——「数一数这段文本里的 DSL 标签开合」。以前这段逻辑用正则实现，
碰到属性里的箭头函数（`onChange={v=>setDone(...)}` 里的 `>`）就会数错，
于是组件永远闭合不了、整块变成裸文本。这里改成逐字符扫描，一处实现，全流程复用。

纯函数、无 IO、不依赖 converter，方便单测。
"""
from __future__ import annotations

import re
from typing import Iterator, List, NamedTuple

# ---------------------------------------------------------------- 标签集合
# 唯一数据源。新增运行时组件时只改这里，正则和判定都会自动跟上。
DSL_TAGS = frozenset(
    """
    box row col column grid grid-item list list-item table table-row table-cell text title caption divider badge icon
    pressable button radio-group radio checkbox input textarea select option date-picker slider label
    svg rect path circle line polyline polygon ellipse g defs
    """.split()
)

# 可以作为「组件起始」的标签。刻意收窄：像 icon/divider/badge/radio 这类
# 在正文里极少出现在段首，放进来只会增加误判。
START_TAGS = (
    "box row col column grid list table text title caption label pressable button "
    "checkbox input textarea select date-picker slider svg"
).split()

# 这些标签永远没有闭合标签，不参与嵌套栈
VOID_TAGS = frozenset({"input", "br", "hr", "img"})

# 标签名后面允许的字符（用于切出标签名）
_NAME_CHARS = re.compile(r"[\w-]")


def tag_pattern() -> str:
    """把 DSL_TAGS 拼成正则里的候选分支（长名在前，避免 `grid` 抢先匹配 `grid-item`）。"""
    ordered = sorted(DSL_TAGS, key=len, reverse=True)
    return "|".join(re.escape(t) for t in ordered)


_OPEN_RE = re.compile(r"<(?:%s)\b" % tag_pattern())
_CLOSE_RE = re.compile(r"</(?:%s)\s*>" % tag_pattern())
_ESCAPED_RE = re.compile(r"&lt;\s*/?\s*(?:%s)\b" % tag_pattern())
_START_RE = re.compile(
    r"^\s*(?:<(%s)\b|\{@body\b|\{#each\b)" % "|".join(re.escape(t) for t in START_TAGS)
)


def open_re() -> "re.Pattern[str]":
    return _OPEN_RE


def close_re() -> "re.Pattern[str]":
    return _CLOSE_RE


def escaped_re() -> "re.Pattern[str]":
    """匹配仍以 `&lt;box` 形式存在的（即被转义成文本的）DSL 标签。"""
    return _ESCAPED_RE


def start_re() -> "re.Pattern[str]":
    """匹配「这一段是不是组件的开头」。"""
    return _START_RE


# ---------------------------------------------------------------- 标签扫描
class TagToken(NamedTuple):
    kind: str          # 'open' | 'close'
    name: str          # 小写标签名
    start: int         # '<' 的下标
    end: int           # '>' 之后的下标
    self_close: bool   # 是否以 '/>' 收尾


def _tag_end(text: str, i: int) -> int:
    """从属性区起点往后找真正的 '>'，跳过引号字符串和 `{...}` 表达式里的 '>'。"""
    n = len(text)
    depth = 0
    quote = None
    while i < n:
        c = text[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c == "{":
            depth += 1
        elif c == "}":
            if depth:
                depth -= 1
        elif c == ">" and depth == 0:
            return i
        i += 1
    return n


def iter_tags(text: str) -> Iterator[TagToken]:
    """按出现顺序产出 DSL 标签。普通 HTML 标签（p/strong/ul…）直接跳过。"""
    i = 0
    n = len(text)
    while i < n:
        lt = text.find("<", i)
        if lt < 0:
            return
        j = lt + 1
        if j < n and text[j] == "/":
            k = j + 1
            name = []
            while k < n and _NAME_CHARS.match(text[k]):
                name.append(text[k])
                k += 1
            gt = text.find(">", k)
            stop = (gt + 1) if gt >= 0 else n
            low = "".join(name).lower()
            if low in DSL_TAGS:
                yield TagToken("close", low, lt, stop, False)
            i = stop
            continue
        if j >= n or not text[j].isalpha():
            i = lt + 1
            continue
        k = j
        name = []
        while k < n and _NAME_CHARS.match(text[k]):
            name.append(text[k])
            k += 1
        end = _tag_end(text, k)
        low = "".join(name).lower()
        if low in DSL_TAGS:
            yield TagToken("open", low, lt, min(end + 1, n), text[k:end].rstrip().endswith("/"))
        i = end + 1


def count(text: str) -> "tuple[int, int, int]":
    """(开标签数, 闭标签数, 自闭合数)。自闭合不计入开标签。"""
    opens = closes = selfcloses = 0
    for tok in iter_tags(text):
        if tok.kind == "close":
            closes += 1
        elif tok.self_close:
            selfcloses += 1
        else:
            opens += 1
    return opens, closes, selfcloses


def balance(text: str) -> int:
    """正数表示还有多少个标签没闭合。"""
    opens, closes, _ = count(text)
    return opens - closes


def directive_balance(text: str) -> int:
    """`{#if}` / `{#each}` 的开合差（`{:else if}` 不算，它不改变嵌套层数）。"""
    return len(re.findall(r"\{#(?:each|if)\b", text)) - len(re.findall(r"\{/(?:each|if)\}", text))


_DIRECTIVE_RE = re.compile(r"\{#(if|each)\b|\{/(if|each)\}")


def is_balanced(text: str) -> bool:
    return balance(text) == 0 and directive_balance(text) == 0


def closing_tail(text: str) -> str:
    """算出还需要补哪些闭合标签 / 结束指令（按逆序）。

    导出器有时把组件尾部的 `</box>`、`</grid>` 丢掉（被 markdown 列表吃掉），
    补回去之后运行时仍能正确嵌套渲染，比把 DSL 裸文本漏到正文好得多。
    """
    stack: List[str] = []
    for tok in iter_tags(text):
        if tok.kind == "open":
            if not tok.self_close and tok.name not in VOID_TAGS:
                stack.append(tok.name)
        elif tok.name in stack:
            del stack[len(stack) - 1 - stack[::-1].index(tok.name)]

    dirs: List[str] = []
    for m in _DIRECTIVE_RE.finditer(text):
        if m.group(1):
            dirs.append(m.group(1))
        else:
            kind = m.group(2)
            for k in range(len(dirs) - 1, -1, -1):
                if dirs[k] == kind:
                    del dirs[k]
                    break

    return "".join("</%s>" % t for t in reversed(stack)) + "".join(
        "{/%s}" % d for d in reversed(dirs)
    )


# ---------------------------------------------------------------- 花括号
def brace_spans(text: str) -> Iterator["tuple[int, int]"]:
    """产出每个配平的 `{...}` 的 (左括号下标, 右括号下标+1)，跳过字符串里的括号。"""
    i = 0
    n = len(text)
    while i < n:
        if text[i] != "{":
            i += 1
            continue
        depth = 0
        j = i
        quote = None
        while j < n:
            ch = text[j]
            if quote:
                if ch == "\\":
                    j += 2
                    continue
                if ch == quote:
                    quote = None
            elif ch in "\"'`":
                quote = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        end = (j + 1) if j < n else n
        yield i, end
        i = end
