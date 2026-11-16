/* ==========================================================================
 * Markdown -> HTML
 *
 * 这个文件是 GPT Master 2.51.0（导出扩展）里 HTML 导出所用的 Markdown 渲染规则的
 * 等价实现。之所以要照它的规则来，是因为「导出增强器」桌面端只认这种结构：
 *
 *     <article class="turn assistant">
 *       <div class="role">Assistant &middot; 2026-11-03 11:35 GMT+8</div>
 *       <div class="body" dir="auto">…<pre data-language="python"><code>…</code></pre>…</div>
 *     </article>
 *
 * 要点（都来自原实现，别随手改）：
 *   · 标题降 2 级（正文里的 # 变 h3），最多到 h6
 *   · 段落内的单个换行**保留**，由 .body p { white-space: pre-wrap } 呈现
 *   · 代码块输出 <pre data-language="lang"><code>转义后的原文</code></pre>
 *   · 表格、列表（嵌套 + start 序号）、引用、分隔线都要还原
 *   · 行内：`code`、**粗**、*斜*、~~删除线~~、[链接](url)（带 data-host）
 * ========================================================================== */

(function () {
  const C = (window.__CEX__ = window.__CEX__ || {});
  if (C.markdown) return;

  const escapeHtml = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  /* --------------------------------------------------------------- 块级正则 */

  const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
  const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
  const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
  const QUOTE = /^ {0,3}>\s?(.*)$/;
  const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
  const TABLE_MAX_COLS = 64;

  /* 写作块标记：<WritingBlock id="..." variant="..."> ... </WritingBlock>。
     模型/站点有时会在消息里夹这种自定义标签，导出时标签本身要去掉，
     内容渲染成 .wb-writing 卡片。标签可能跨段落，所以在块级循环里按区域处理。 */
  const WRITING_CLOSE = /^(.*?)<\/WritingBlock>\s*(.*)$/i;

  const fenceCloser = (marker) =>
    new RegExp('^\\s*' + marker[0] + '{' + marker.length + ',}\\s*$');

  const isTableStart = (lines, i) =>
    lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]);

  function splitRow(line) {
    return line
      .trim()
      .replace(/^\|/, '')
      .replace(/(?<!\\)\|$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'));
  }

  /* ------------------------------------------------------- 组件块（DSL 源码） */

  /* 模型有时直接写组件源码，例如：
   *
   *     <box border padding={3}>
   *     <CodeBlock language="python">
   *     class Person:
   *         def __init__(self):        ← 这几个空格是代码缩进，不能动
   *     </CodeBlock>
   *     </box>
   *
   * 这些行在 Markdown 里是**连续段落**，而段落是按行 trim 的（为了让 pre-wrap 不显示
   * 源码缩进）。一 trim 就把代码缩进吃掉了，转换器再把它拼回 <pre> 时已经是平的。
   * 所以组件块要原样保留空白，只去掉整块的公共缩进。
   */

  const COMPONENT_START = new RegExp(
    '^(\\s*)<(' +
      [
        'box', 'row', 'column', 'grid', 'grid-item', 'list', 'list-item',
        'text', 'title', 'caption', 'label', 'pressable', 'button',
        'radio-group', 'radio', 'checkbox', 'input', 'textarea', 'svg',
        'CodeBlock'
      ].join('|') +
      ')\\b'
  );

  const TAG_TOKEN = /<([A-Za-z][\w-]*)\b[^>]*?(\/?)>|<\/([A-Za-z][\w-]*)>/g;

  /** 从 i 开始量一个组件块的范围：标签配平后的最后一行下标 */
  function componentSpan(lines, i) {
    let depth = 0;
    let opened = 0;
    for (let j = i; j < lines.length; j++) {
      TAG_TOKEN.lastIndex = 0;
      let m;
      let closedHere = 0;
      while ((m = TAG_TOKEN.exec(lines[j]))) {
        if (m[3]) {
          depth -= 1;
          closedHere += 1;
        } else if (m[2] !== '/') {
          depth += 1;
          opened += 1;
        }
      }
      if (opened && depth <= 0) return j;
      // 单行里既开又闭（<row>…</row>）：本行就是结尾
      if (j === i && closedHere && depth <= 0) return j;
    }
    return -1;
  }

  /** 去掉整块公共缩进；空行保持为空行 */
  function dedentLines(lines) {
    let min = Infinity;
    for (const line of lines) {
      if (!line.trim()) continue;
      const lead = /^[ \t]*/.exec(line)[0].length;
      if (lead < min) min = lead;
    }
    if (!isFinite(min) || min === 0) return lines;
    return lines.map((line) => (line.trim() ? line.slice(min) : ''));
  }

  const isComponentStart = (line) => COMPONENT_START.test(line);

  /* --------------------------------------------------------------- 行内渲染 */

  // 行内代码 / 链接先换成占位符，躲过转义和强调处理，最后再换回来
  const CODE_SPAN = /`([^`]+)`/g;
  const IMAGE = /!\[([^\[\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
  const LINK = /(?:(?<![\w!])!)?\[([^[\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
  const STAR_EM = /(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g;
  const ATTACH_EM = /_(\[[^\]\n]{0,300}\])_/g;

  const HOLD_A = '\u0001';
  const HOLD_B = '\u0002';
  const PH_CODE = (i) => HOLD_A + 'c' + i + HOLD_B;
  const PH_LINK = (i) => HOLD_A + 'l' + i + HOLD_B;
  const PH_IMAGE = (i) => HOLD_A + 'i' + i + HOLD_B;
  const PH_MATH = (i) => HOLD_A + 'm' + i + HOLD_B;
  const PH_BADGE = (i) => HOLD_A + 'b' + i + HOLD_B;
  const BADGE = /<badge\b([^<>]*)>([^<\u0001]*)<\/badge>/gi;
  const BADGE_COLORS = {
    default: ['#f3f4f6', '#374151'], info: ['#dbeafe', '#1d4ed8'],
    success: ['#dcfce7', '#15803d'], warning: ['#fef3c7', '#b45309'],
    danger: ['#fee2e2', '#b91c1c'], discovery: ['#ede9fe', '#6d28d9']
  };

  function mathHtml(tex, display) {
    const source = String(tex || '').trim();
    if (!source) return '';
    if (!window.katex) return escapeHtml(display ? '$$' + source + '$$' : '$' + source + '$');
    try {
      return '<span class="cex-math' + (display ? ' cex-math-display' : '') + '">' +
        window.katex.renderToString(source, { displayMode: !!display, throwOnError: false, trust: false, output: 'htmlAndMathml' }) +
        '</span>';
    } catch (_) {
      return escapeHtml(display ? '$$' + source + '$$' : '$' + source + '$');
    }
  }

  const INLINE_MATH = /\\\((.+?)\\\)|(?<!\\)\$(?!\$|\s)([^\n$]+?)(?<!\\)\$(?!\$|[\p{L}\p{N}])/gu;

  const isSpace = (ch) => /\s/.test(ch);

  /**
   * 把 token 包裹的内容换成 open/close。
   * 只处理「token 左右都不是空白」的成对情况，避免把 `a * b * c` 当成强调。
   */
  function wrapToken(text, token, open, close) {
    const n = token.length;
    let out = '';
    let last = 0;
    let start = text.indexOf(token);
    while (start !== -1) {
      const next = text[start + n];
      if (next === undefined || isSpace(next)) {
        start = text.indexOf(token, start + 1);
        continue;
      }
      let end = text.indexOf(token, start + n + 1);
      while (end !== -1 && isSpace(text[end - 1])) end = text.indexOf(token, end + 1);
      if (end === -1) break;
      out += text.slice(last, start) + open + text.slice(start + n, end) + close;
      last = end + n;
      start = text.indexOf(token, last);
    }
    return out + text.slice(last);
  }

  function applyEmphasis(escaped) {
    let out = wrapToken(wrapToken(escaped, '***', '<strong><em>', '</em></strong>'), '**', '<strong>', '</strong>');
    out = wrapToken(out, '~~', '<del>', '</del>');
    out = out.replace(STAR_EM, '$1<em>$2</em>');
    return out.replace(ATTACH_EM, '<em>$1</em>');
  }

  function safeHref(raw) {
    try {
      const u = new URL(raw);
      if (u.username || u.password) return null;
      if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return u.href;
      return null;
    } catch (e) {
      return null;
    }
  }

  function safeImageHref(raw) {
    try {
      const url = new URL(raw, location.href);
      if (url.username || url.password) return null;
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function hostOf(href) {
    try {
      const u = new URL(href);
      return u.host || u.pathname;
    } catch (e) {
      return href;
    }
  }

  /* ------------------------------------------------ ChatGPT DSL 叶子组件归一化 */

  /* ChatGPT 的后端接口（2026-11 起）会直接在消息 Markdown 里返回它前端渲染用的
   * DSL 组件，联网搜索结果卡片就是典型：
   *
   *     <AsyncImage query="AHA Music song identifier logo" aspectRatio="1:1" maxWidth="64px"/>
   *     **1. <Entity value="AHA Music" category="software" disambig="…"/>** <badge color="success">优先推荐</badge>
   *     <Link ref="turn676783search7" title="打开 AHA Music 上传页面"/>
   *
   * 这些自闭合标签的内容只存在于属性里（value / title），没有子节点。运行时对
   * 未知标签按通用元素渲染，自闭合标签渲染出来就是空元素 —— 实体名、链接标题
   * 整个丢失；「**1. <Entity/>**」的粗体还会被标签拆成两个配不上对的 **，裸露在页面上。
   * 归一化（在组件块判别与行内渲染之前做）：
   *     Entity     → value 属性文本
   *     Link       → title 属性文本 + ' ↗'（还原原页面的外链提示）
   *     AsyncImage → 原位提示（按 query 取图，导出侧无法复现）
   * 其它首字母大写的自闭合标签 → 提取 value/title/label/name/text 属性，都没有就删除。
   * 配对标签（<X>…</X>）不动：运行时会渲染其子节点，删了反而丢内容。
   * 必须跳过围栏代码块与行内 code —— 用户可能正在讨论这套 DSL 语法本身。
   */

  const DSL_VOID_TAG = /<([A-Z][A-Za-z0-9]*)\b([^<>]*?)\/>/g;
  const DSL_LEAF_ATTRS = {
    Entity: ['value'],
    Link: ['title', 'value'],
    AsyncImage: []
  };
  const DSL_FALLBACK_ATTRS = ['value', 'title', 'label', 'name', 'text'];

  const dslAttr = (attrs, name) => {
    const m = new RegExp('(?:^|\\s)' + name + '=("[^"]*"|\'[^\']*\')').exec(attrs);
    return m ? m[1].slice(1, -1) : null;
  };

  function normalizeDslInText(text) {
    if (!/<[A-Z]/.test(text)) return text;
    return text.replace(DSL_VOID_TAG, (m, tag, attrs) => {
      const names = Object.prototype.hasOwnProperty.call(DSL_LEAF_ATTRS, tag)
        ? DSL_LEAF_ATTRS[tag]
        : DSL_FALLBACK_ATTRS;
      if (tag === 'Link') {
        for (const name of names) {
          const v = dslAttr(attrs, name);
          if (v && v.trim()) return v.trim() + ' \u2197';
        }
        return '';
      }
      if (tag === 'AsyncImage') return '[图片未导出，请到原会话查看]';
      for (const name of names) {
        const v = dslAttr(attrs, name);
        if (v && v.trim()) return v;
      }
      return '';
    });
  }

  /** 整段 Markdown 的行级归一化：跳过围栏代码块 */
  function normalizeDslLeaves(markdown) {
    if (!/<[A-Z]/.test(markdown)) return markdown;
    const lines = markdown.split('\n');
    let fence = null;
    let touched = false;
    for (let i = 0; i < lines.length; i++) {
      const f = FENCE.exec(lines[i]);
      if (f) {
        fence = fence === f[2] ? null : (fence || f[2]);
        continue;
      }
      if (fence) continue;
      const replaced = normalizeDslInText(lines[i]);
      if (replaced !== lines[i]) {
        lines[i] = replaced;
        touched = true;
      }
    }
    return touched ? lines.join('\n') : markdown;
  }

  function renderInline(text) {
    const codes = [];
    const links = [];
    const images = [];
    const maths = [];
    const badges = [];

    let out = String(text == null ? '' : text).replace(CODE_SPAN, (m, code) => {
      codes.push(code);
      return PH_CODE(codes.length - 1);
    });

    /* 行内出现的 DSL 叶子组件同样归一化（行内 code 已换成占位符，不受影响） */
    out = normalizeDslInText(out);

    out = out.replace(INLINE_MATH, (m, paren, dollar) => {
      maths.push(mathHtml(paren === undefined ? dollar : paren, false));
      return PH_MATH(maths.length - 1);
    });
    out = out.replace(/\\\$/g, '$');

    out = out.replace(IMAGE, (m, alt, href) => {
      const safe = safeImageHref(href);
      if (!safe) return m;
      images.push({ alt, href: safe });
      return PH_IMAGE(images.length - 1);
    });

    out = out.replace(LINK, (m, label, href) => {
      const safe = safeHref(href);
      if (!safe) return m;
      const shown = label.trim();
      links.push({
        href: safe,
        label: shown || safe,
        bare: !shown || shown === safe || shown + '/' === safe
      });
      return PH_LINK(links.length - 1);
    });

    out = out.replace(BADGE, (m, attrs, label) => {
      const colorAttr = /\bcolor\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(attrs);
      const color = colorAttr && (colorAttr[1] || colorAttr[2] || colorAttr[3]);
      badges.push({
        label,
        colors: Object.prototype.hasOwnProperty.call(BADGE_COLORS, color) ? BADGE_COLORS[color] : BADGE_COLORS.default
      });
      return PH_BADGE(badges.length - 1);
    });

    out = applyEmphasis(escapeHtml(out));

    out = out.replace(/\u0001l(\d+)\u0002/g, (m, i) => {
      const link = links[Number(i)];
      if (!link) return '';
      const bare = link.bare ? ' class="bare"' : '';
      const host = ' data-host="' + escapeHtml(hostOf(link.href)) + '"';
      return '<a href="' + escapeHtml(link.href) + '"' + host + bare + '>' + escapeHtml(link.label) + '</a>';
    });

    out = out.replace(/\u0001i(\d+)\u0002/g, (m, i) => {
      const image = images[Number(i)];
      return image ? '<img src="' + escapeHtml(image.href) + '" alt="' + escapeHtml(image.alt) + '" loading="lazy">' : '';
    });

    return out.replace(/\u0001c(\d+)\u0002/g, (m, i) => '<code>' + escapeHtml(codes[Number(i)] == null ? '' : codes[Number(i)]) + '</code>')
      .replace(/\u0001m(\d+)\u0002/g, (m, i) => maths[Number(i)] || '')
      .replace(/\u0001b(\d+)\u0002/g, (m, i) => {
        const badge = badges[Number(i)];
        if (!badge) return '';
        return '<span class="cex-badge" style="display:inline-block;vertical-align:baseline;padding:2px 8px;' +
          'border-radius:999px;white-space:nowrap;line-height:1.5;font-size:.78em;font-weight:600;' +
          'background:' + badge.colors[0] + ';color:' + badge.colors[1] + '">' + escapeHtml(badge.label.trim()) + '</span>';
      });
  }

  function renderMathInHtml(html) {
    if (!/[\\$]/.test(html) || !window.katex) return html;
    const template = document.createElement('template');
    template.innerHTML = html;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.parentElement && node.parentElement.closest('pre,code,script,style,.wb-widget,.katex')) continue;
      const value = node.nodeValue;
      const display = /^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(value) || /^\s*\\\[([\s\S]+?)\\\]\s*$/.exec(value);
      INLINE_MATH.lastIndex = 0;
      if (!display && !INLINE_MATH.test(value)) continue;
      const replacement = display ? mathHtml(display[1], true) : renderInline(value);
      if (replacement === escapeHtml(value) || replacement === value) continue;
      const fragment = document.createElement('template');
      fragment.innerHTML = replacement;
      node.replaceWith(fragment.content);
    }
    return template.innerHTML;
  }

  /* ------------------------------------------------------------------ 列表 */

  function renderList(lines) {
    const items = [];
    for (const line of lines) {
      const m = LIST_ITEM.exec(line);
      if (!m) {
        if (items.length) items[items.length - 1].text.push(line.trim());
        continue;
      }
      const ord = /^\d+/.exec(m[2]);
      items.push({
        indent: m[1].length,
        ordered: ord !== null,
        ordinal: ord ? Number(ord[0]) : null,
        text: [m[3]]
      });
    }

    const out = [];
    const stack = [];

    const open = (item) => {
      stack.push({ indent: item.indent, ordered: item.ordered });
      const start = item.ordered && item.ordinal !== null && item.ordinal !== 1 ? ' start="' + item.ordinal + '"' : '';
      out.push('<' + (item.ordered ? 'ol' : 'ul') + start + '><li>');
    };

    const closeDeeperThan = (indent) => {
      while (stack.length && stack[stack.length - 1].indent > indent) {
        const top = stack.pop();
        out.push('</li></' + (top.ordered ? 'ol' : 'ul') + '>');
      }
    };

    for (const item of items) {
      const top = stack[stack.length - 1];
      if (!top || item.indent > top.indent) {
        open(item);
      } else {
        closeDeeperThan(item.indent);
        if (!stack.length) open(item);
        else out.push('</li><li>');
      }
      out.push(renderInline(item.text.join(' ')));
    }

    while (stack.length) {
      const top = stack.pop();
      out.push('</li></' + (top.ordered ? 'ol' : 'ul') + '>');
    }

    return out.join('');
  }

  /* ---------------------------------------------------------------- 块级循环 */

  function render(markdown, shift) {
    const step = typeof shift === 'number' ? shift : 2;
    const lines = normalizeDslLeaves(String(markdown || '').replace(/\r\n?/g, '\n')).split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }

      /* 独立公式：$$...$$ 或 \\[...\\]，支持多行。 */
      const mathOpen = /^\s*(\$\$|\\\[)\s*(.*)$/.exec(line);
      if (mathOpen) {
        const closer = mathOpen[1] === '$$' ? '$$' : '\\]';
        const body = [mathOpen[2]];
        let closed = false;
        for (let k = i; k < lines.length; k++) {
          const current = k === i ? mathOpen[2] : lines[k];
          if (k > i) body.push(current);
          const end = current.lastIndexOf(closer);
          if (end >= 0) {
            body[body.length - 1] = current.slice(0, end);
            const suffix = current.slice(end + closer.length).trim();
            if (suffix) lines.splice(k + 1, 0, suffix);
            i = k + 1;
            closed = true;
            break;
          }
        }
        if (closed) {
          out.push('<div class="cex-math-block">' + mathHtml(body.join('\n'), true) + '</div>');
          continue;
        }
        out.push('<p>' + renderInline(line) + '</p>');
        i += 1;
        continue;
      }

      /* 围栏代码块 */
      const fence = FENCE.exec(line);
      if (fence) {
        const closer = fenceCloser(fence[2]);
        const dedent = new RegExp('^ {0,' + fence[1].length + '}');
        const body = [];
        i += 1;
        while (i < lines.length && !closer.test(lines[i])) {
          body.push(lines[i].replace(dedent, ''));
          i += 1;
        }
        i += 1;
        const lang = fence[3] ? ' data-language="' + escapeHtml(fence[3]) + '"' : '';
        out.push('<pre' + lang + '><code>' + escapeHtml(body.join('\n')) + '</code></pre>');
        continue;
      }

      /* 组件块：原样保留缩进（代码缩进就在这些行里） */
      if (isComponentStart(line)) {
        const end = componentSpan(lines, i);
        if (end >= i) {
          const raw = lines.slice(i, end + 1).map((l) => l.replace(/\s+$/, ''));
          out.push('<p>' + escapeHtml(dedentLines(raw).join('\n')) + '</p>');
          i = end + 1;
          continue;
        }
        /* 组件不配平（消息在组件中间被截断/标签残缺）：componentSpan 找不到结尾。
           此时绝不能落进下面的段落分支——段落循环遇到组件行会立即停住，
           i 永不前进 → 渲染死循环 → 页面卡死。降级为普通文本行输出。 */
        const textLines = [line.trim()];
        i += 1;
        while (
          i < lines.length &&
          lines[i].trim() &&
          !FENCE.test(lines[i]) &&
          !HEADING.test(lines[i]) &&
          !HR.test(lines[i]) &&
          !QUOTE.test(lines[i]) &&
          !LIST_ITEM.test(lines[i]) &&
          !isTableStart(lines, i)
        ) {
          textLines.push(lines[i].trim());
          i += 1;
        }
        out.push('<p>' + renderInline(textLines.join('\n')) + '</p>');
        continue;
      }

      /* 写作块：吞掉开标签，收集到闭标签为止，内容整块渲染成卡片。
         开标签可能在行首也可能在行中间；闭标签同理。 */
      const wbOpen = line.search(/<WritingBlock\b/i);
      if (wbOpen !== -1) {
        const gt = line.indexOf('>', wbOpen);
        const before = line.slice(0, wbOpen).trim();
        if (before) out.push('<p>' + renderInline(before) + '</p>');
        const inner = [];
        let rest = gt === -1 ? '' : line.slice(gt + 1);
        for (;;) {
          const cm = WRITING_CLOSE.exec(rest);
          if (cm) {
            if (cm[1].trim()) inner.push(cm[1]);
            if (cm[2].trim()) lines.splice(i + 1, 0, cm[2]);
            i += 1;
            break;
          }
          if (rest.trim()) inner.push(rest.replace(/<\/WritingBlock>/gi, ''));
          i += 1;
          if (i >= lines.length) break;
          rest = lines[i];
        }
        out.push('<div class="wb-writing">' + render(inner.join('\n'), step) + '</div>');
        continue;
      }

      /* 分隔线 */
      if (HR.test(line)) {
        out.push('<hr />');
        i += 1;
        continue;
      }

      /* 标题（降级） */
      const heading = HEADING.exec(line);
      if (heading) {
        const level = Math.min(6, heading[1].length + step);
        out.push('<h' + level + '>' + renderInline(heading[2].trim()) + '</h' + level + '>');
        i += 1;
        continue;
      }

      /* 引用 */
      if (QUOTE.test(line)) {
        const inner = [];
        while (i < lines.length) {
          const m = QUOTE.exec(lines[i]);
          if (!m) break;
          inner.push(m[1]);
          i += 1;
        }
        out.push('<blockquote>' + render(inner.join('\n'), step) + '</blockquote>');
        continue;
      }

      /* 表格 */
      if (isTableStart(lines, i)) {
        const head = splitRow(line).slice(0, TABLE_MAX_COLS);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(splitRow(lines[i]));
          i += 1;
        }
        const thead = head.map((c) => '<th>' + renderInline(c) + '</th>').join('');
        const tbody = rows
          .map(
            (row) =>
              '<tr>' +
              Array.from({ length: head.length }, (_, k) => '<td>' + renderInline(row[k] == null ? '' : row[k]) + '</td>').join('') +
              '</tr>'
          )
          .join('');
        out.push('<table><thead><tr>' + thead + '</tr></thead><tbody>' + tbody + '</tbody></table>');
        continue;
      }

      /* 列表 */
      if (LIST_ITEM.test(line)) {
        const block = [];
        while (i < lines.length) {
          if (LIST_ITEM.test(lines[i])) {
            block.push(lines[i]);
            i += 1;
            continue;
          }
          // 缩进 ≥2 的续行属于上一个列表项（代码块不算）
          if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && block.length && !FENCE.test(lines[i])) {
            block.push(lines[i]);
            i += 1;
            continue;
          }
          break;
        }
        out.push(renderList(block));
        continue;
      }

      /* 段落：连续非块级行，行内换行保留 */
      const para = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !FENCE.test(lines[i]) &&
        !HEADING.test(lines[i]) &&
        !HR.test(lines[i]) &&
        !QUOTE.test(lines[i]) &&
        !LIST_ITEM.test(lines[i]) &&
        !isComponentStart(lines[i]) &&
        !/^\s*(?:\$\$|\\\[)/.test(lines[i]) &&
        !isTableStart(lines, i)
      ) {
        para.push(lines[i].trim());
        i += 1;
      }
      out.push('<p>' + renderInline(para.join('\n')) + '</p>');
    }

    return out.join('\n');
  }

  /* ------------------------------------------------------------- 时间格式化 */

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function zoneLabel(offsetMinutes) {
    if (offsetMinutes === 0) return 'GMT';
    const sign = offsetMinutes > 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return 'GMT' + sign + h + (m ? ':' + pad2(m) : '');
  }

  /** 与真实导出完全一致的格式：2026-11-03 11:35 GMT+8 */
  function formatTimestamp(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds)) return '';
    const offset = -new Date(seconds * 1000).getTimezoneOffset();
    const d = new Date(seconds * 1000 + offset * 60000);
    const date = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    const time = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
    return date + ' ' + time + ' ' + zoneLabel(offset);
  }

  C.markdown = {
    render,
    renderInline,
    renderMathInHtml,
    escapeHtml,
    formatTimestamp
  };
})();
