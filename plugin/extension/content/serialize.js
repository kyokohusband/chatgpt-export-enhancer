/* DOM 序列化：把渲染后的消息节点还原成「语义 HTML / Markdown / 纯文本」。
   关键约束：HTML 输出要能被 app/converter.py 识别——<article class="turn assistant">、
   <p> 段落、<pre data-language="…"><code>。 */
(function () {
  const C = (window.__CEX__ = window.__CEX__ || {});
  if (C.serialize) return;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS',
    'VIDEO', 'AUDIO', 'SVG', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'NAV', 'FOOTER'
  ]);

  const BLOCKISH = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'BLOCKQUOTE', 'PRE', 'UL', 'OL',
    'TABLE', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HR', 'DL', 'DT', 'DD', 'ADDRESS', 'CENTER', 'FIELDSET', 'FORM'
  ]);

  const LANG_NAMES = {
    python: 'python', py: 'python', python3: 'python',
    javascript: 'javascript', js: 'javascript', node: 'javascript',
    typescript: 'typescript', ts: 'typescript',
    java: 'java', c: 'c', 'c++': 'cpp', cpp: 'cpp', 'c#': 'csharp', csharp: 'csharp',
    go: 'go', golang: 'go', rust: 'rust', ruby: 'ruby', rb: 'ruby', php: 'php',
    swift: 'swift', kotlin: 'kotlin', sql: 'sql', mysql: 'sql', postgresql: 'sql',
    bash: 'bash', shell: 'bash', sh: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
    powershell: 'powershell', ps1: 'powershell', cmd: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
    xml: 'xml', html: 'html', css: 'css', scss: 'scss', less: 'less',
    markdown: 'markdown', md: 'markdown', vue: 'vue', jsx: 'jsx', tsx: 'tsx',
    mermaid: 'mermaid', latex: 'latex', tex: 'latex', matlab: 'matlab',
    r: 'r', dart: 'dart', scala: 'scala', perl: 'perl', lua: 'lua',
    dockerfile: 'dockerfile', graphql: 'graphql', diff: 'diff', plaintext: 'text', text: 'text', txt: 'text'
  };

  const esc = (s) =>
    String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

  function absUrl(url) {
    const raw = String(url || '').trim();
    if (!raw || /^(javascript|data|blob):/i.test(raw)) return raw.startsWith('data:') ? raw : '';
    try {
      return new URL(raw, location.href).href;
    } catch (e) {
      return raw;
    }
  }

  function texOf(el) {
    const ann = el.querySelector && el.querySelector('annotation[encoding="application/x-tex"]');
    const src = ann ? ann.textContent.trim() : '';
    if (!src) return (el.innerText || el.textContent || '').trim();
    const display = el.classList.contains('katex-display') || !!(el.closest && el.closest('.katex-display'));
    return display ? '$$\n' + src + '\n$$' : '$' + src + '$';
  }

  function isHidden(el) {
    if (el.hidden) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.classList.contains('sr-only')) return true;
    return false;
  }

  function skipElement(el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.classList.contains('katex')) return false;
    if (el.classList.contains('wb-copy-code')) return true;
    try {
      if (el.matches('button, [role="button"], [role="toolbar"], [role="tablist"], [contenteditable="true"]')) return true;
      if (el.matches('[data-testid*="copy"], [data-testid*="action"], [data-testid*="feedback"]')) return true;
    } catch (e) {
      /* ignore */
    }
    // 代码块上方的语言标签（"Python" / "复制" 之类），紧挨着 <pre>，不是正文
    const next = el.nextElementSibling;
    if (next && next.tagName === 'PRE') {
      const label = (el.innerText || el.textContent || '').trim();
      if (!label || label.length <= 3 || labelLang(label) || /^(copy|复制|代码|code)$/i.test(label)) return true;
    }
    return false;
  }

  function imgTag(el, ctx) {
    const raw = el.getAttribute('src') || el.currentSrc || '';
    if (!raw) return '';
    const alt = (el.getAttribute('alt') || '').trim();
    if (raw.startsWith('data:')) {
      if (ctx.imageMode === 'alt' || raw.length > 8000000) {
        return alt ? '<span class="cex-note">[图片：' + esc(alt) + ']</span>' : '<span class="cex-note">[图片]</span>';
      }
    }
    const src = absUrl(raw);
    if (!src) return alt ? '<span class="cex-note">[图片：' + esc(alt) + ']</span>' : '';
    return '<img src="' + escAttr(src) + '" alt="' + escAttr(alt) + '" loading="lazy">';
  }

  function hasBlockChild(el) {
    for (const child of el.children) {
      if (BLOCKISH.has(child.tagName)) {
        if (child.tagName === 'DIV' || child.tagName === 'SECTION') {
          // 纯布局 div（只有行内内容）不算块，避免把一段话拆成多个 <p>
          if (child.querySelector('p, pre, ul, ol, table, h1, h2, h3, h4, h5, h6, blockquote, div')) return true;
          continue;
        }
        return true;
      }
    }
    return false;
  }

  // 站点上出现的语言名比原表更杂，补一批常见写法（只做精确匹配，避免误伤正文）
  Object.assign(LANG_NAMES, {
    solidity: 'solidity', elixir: 'elixir', erlang: 'erlang', clojure: 'clojure',
    haskell: 'haskell', groovy: 'groovy', gradle: 'groovy', makefile: 'makefile',
    nginx: 'nginx', asm: 'x86asm', x86asm: 'x86asm', objc: 'objectivec', 'objective-c': 'objectivec',
    plsql: 'sql', ocaml: 'ocaml', julia: 'julia', zig: 'zig', nim: 'nim', crystal: 'crystal',
    pascal: 'delphi', fortran: 'fortran', cobol: 'cobol', abap: 'abap', apex: 'apex',
    vba: 'vbnet', vb: 'vbnet', 'vb.net': 'vbnet', wasm: 'wasm', proto: 'protobuf',
    protobuf: 'protobuf', hcl: 'hcl', terraform: 'hcl', cmake: 'cmake',
    'f#': 'fsharp', fsharp: 'fsharp', 'c#': 'csharp', 'c++': 'cpp'
  });

  const LANG_ALIAS = { 纯文本: 'text', 文本: 'text', 代码: 'text' };

  function labelLang(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 18) return '';
    if (LANG_ALIAS[raw]) return LANG_ALIAS[raw];
    const key = raw.toLowerCase().replace(/[^a-z0-9+#.]/g, '');
    return LANG_NAMES[key] || '';
  }

  function detectLangFromLabel(pre) {
    let node = pre;
    for (let depth = 0; depth < 3 && node; depth++) {
      const parent = node.parentElement;
      if (!parent) break;

      // 语言标签通常在 <pre> 前面的兄弟节点里（有时隔着一层滚动容器）
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        const hit = codeHeaderLang(sib);
        if (hit) return hit;
      }
      const first = parent.firstElementChild;
      if (first && first !== node && !first.contains(pre)) {
        const hit = codeHeaderLang(first);
        if (hit) return hit;
      }
      node = parent;
    }
    return '';
  }

  function looksLikeCodeHeader(el) {
    if (!el || el.tagName === 'P' || el.tagName === 'PRE') return false;
    if (el.querySelector('button')) return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/(header|toolbar|title|lang|flex|action|toolbar)/i.test(cls)) return true;
    return el.tagName === 'SPAN';
  }

  function codeHeaderLang(el) {
    if (!looksLikeCodeHeader(el)) return '';
    let hit = labelLang(el.textContent);
    if (hit) return hit;
    for (const leaf of el.querySelectorAll('span, code, small, div')) {
      if (leaf.children.length) continue;
      hit = labelLang(leaf.textContent);
      if (hit) return hit;
    }
    return '';
  }

  /** 形如「JavaScript」的独立一段文字（可带复制按钮），且后面紧跟代码块 → 代码块的语言标签，不是正文 */
  function isLangLabelBeforeCode(el) {
    if (hasBlockChild(el)) return false;
    const text = (el.textContent || '').trim();
    if (!text || !labelLang(text)) return false;

    let node = el;
    for (let i = 0; i < 2 && node; i++) {
      const sib = node.nextElementSibling;
      if (sib && (sib.tagName === 'PRE' || sib.querySelector('pre'))) return true;
      node = node.parentElement;
    }
    return false;
  }

  function normalizeLang(raw) {
    const key = String(raw || '').trim().toLowerCase().replace(/^language-/, '');
    if (!key) return '';
    return LANG_NAMES[key] || (/^[a-z0-9+#._-]{1,20}$/.test(key) ? key : '');
  }

  /* ------------------------------------------------------------ inline HTML */

  function inlineNode(node, ctx) {
    if (node.nodeType === 3) {
      const text = node.nodeValue;
      if (!text) return '';
      const safe = esc(text);
      return ctx.breaks ? safe.replace(/\r?\n/g, '<br>') : safe;
    }
    if (node.nodeType !== 1) return '';
    const el = node;
    if (skipElement(el) || isHidden(el)) return '';
    if (el.classList.contains('katex') || el.classList.contains('katex-display')) return esc(texOf(el));

    switch (el.tagName) {
      case 'BR':
        return '<br>';
      case 'STRONG':
      case 'B':
        return '<strong>' + inlineChildren(el, ctx) + '</strong>';
      case 'EM':
      case 'I':
        return '<em>' + inlineChildren(el, ctx) + '</em>';
      case 'DEL':
      case 'S':
      case 'STRIKE':
        return '<del>' + inlineChildren(el, ctx) + '</del>';
      case 'MARK':
        return '<mark>' + inlineChildren(el, ctx) + '</mark>';
      case 'SUP':
        return '<sup>' + inlineChildren(el, ctx) + '</sup>';
      case 'SUB':
        return '<sub>' + inlineChildren(el, ctx) + '</sub>';
      case 'CODE':
      case 'KBD':
        return '<code>' + esc(el.textContent) + '</code>';
      case 'A': {
        const href = absUrl(el.getAttribute('href'));
        const inner = inlineChildren(el, ctx) || esc(el.textContent);
        return href && !/^javascript:/i.test(href)
          ? '<a href="' + escAttr(href) + '">' + inner + '</a>'
          : inner;
      }
      case 'IMG':
        return imgTag(el, ctx);
      default:
        return inlineChildren(el, ctx);
    }
  }

  function inlineChildren(el, ctx) {
    let out = '';
    for (const child of el.childNodes) out += inlineNode(child, ctx);
    return out;
  }

  /* ------------------------------------------------------------- block HTML */

  /** 从一段小文本里认出语言名（"Python" / "纯文本" / "cpp"）；只看短文本，避免把代码当标签 */
  function scanLangText(root) {
    if (!root) return '';
    const own = (root.textContent || '').trim();
    if (own && own.length <= 18) {
      const hit = labelLang(own);
      if (hit) return hit;
    }
    const els = root.querySelectorAll('*');
    for (let i = 0; i < els.length && i < 40; i++) {
      const el = els[i];
      if (el.children.length > 2) continue;
      const text = (el.textContent || '').trim();
      if (!text || text.length > 18) continue;
      const hit = labelLang(text);
      if (hit) return hit;
    }
    return '';
  }

  /**
   * 从代码块里认语言。
   *
   * 真实结构有两层 pre（外层 pre.overflow-visible 包着 CodeMirror 的 pre.cm-content），
   * 语言标签在「带复制按钮的 header」里，和代码区是兄弟关系，而且嵌套极深（实测 16 层）。
   * 所以不靠层级深度，靠「复制按钮」这个稳定特征定位代码块外壳。
   */
  function langInsidePre(pre, codeEl) {
    // 1) code → pre 之间，逐层看前兄弟
    if (codeEl && codeEl !== pre) {
      let node = codeEl;
      let guard = 0;
      while (node && node !== pre && guard++ < 24) {
        for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
          const hit = scanLangText(sib);
          if (hit) return hit;
        }
        node = node.parentElement;
      }
    }

    // 2) 向上找「含复制按钮」的代码块外壳，在它的 header 里找语言名
    const COPY_SEL =
      'button[aria-label*="复制"], button[aria-label*="Copy"], button[aria-label*="copy"], [data-testid*="copy"]';
    let shell = null;
    let n = pre.parentElement;
    for (let i = 0; i < 16 && n; i++) {
      if (n.querySelector && n.querySelector(COPY_SEL)) {
        shell = n;
        break;
      }
      n = n.parentElement;
    }

    if (shell) {
      const walker = document.createTreeWalker(shell, NodeFilter.SHOW_ELEMENT, {
        acceptNode(el) {
          if (el === pre || el.contains(pre)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let el;
      let guard = 0;
      while ((el = walker.nextNode()) && guard++ < 80) {
        if (el.children.length > 2) continue;
        const text = (el.textContent || '').trim();
        if (!text || text.length > 18) continue;
        const hit = labelLang(text);
        if (hit) return hit;
      }
    }

    // 3) 兜底：向上 6 层，看父容器里「除代码区之外」的短文本
    let up = pre.parentElement;
    for (let i = 0; i < 6 && up; i++) {
      for (const child of up.children) {
        if (child === pre || child.contains(pre)) continue;
        const text = (child.textContent || '').trim();
        if (!text || text.length > 18) continue;
        if (child.querySelector && child.querySelector('pre')) continue;
        const hit = labelLang(text);
        if (hit) return hit;
      }
      up = up.parentElement;
    }

    return '';
  }

  function preBlock(pre, ctx) {
    const codeEl = pre.querySelector('code') || pre;
    let lang = pre.getAttribute('data-language') || '';
    if (!lang) {
      const m = /language-([A-Za-z0-9+#._-]+)/.exec((codeEl.className || '') + ' ' + (pre.className || ''));
      if (m) lang = m[1];
    }
    // 新版 ChatGPT：标签在 pre 内部；旧版：标签在 pre 外面
    if (!lang) lang = langInsidePre(pre, codeEl);
    if (!lang) lang = detectLangFromLabel(pre);
    lang = normalizeLang(lang) || 'text';

    let text = codeEl.textContent || '';
    // CodeMirror 某些版本用 .cm-line 分行，textContent 会丢掉换行
    const lines = pre.querySelectorAll('.cm-line');
    if (lines.length > 1 && text.indexOf('\n') === -1) {
      text = Array.prototype.map.call(lines, (l) => l.textContent).join('\n');
    }
    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}$/, '\n');
    return '<pre data-language="' + escAttr(lang) + '"><code>' + esc(text.replace(/\n$/, '')) + '</code></pre>';
  }

  function listBlock(el, ctx) {
    const tag = el.tagName.toLowerCase();
    const items = [...el.children].filter((c) => c.tagName === 'LI');
    if (!items.length) return '';

    const rendered = items.map((li) => {
      const inlineParts = [];
      const blockParts = [];
      for (const node of li.childNodes) {
        if (node.nodeType === 1 && ['UL', 'OL', 'PRE', 'TABLE', 'BLOCKQUOTE', 'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(node.tagName)) {
          if (node.tagName === 'P') {
            const html = nodeBlock(node, ctx);
            if (html) blockParts.push(html);
          } else {
            const html = nodeBlock(node, ctx);
            if (html) blockParts.push(html);
          }
        } else {
          inlineParts.push(inlineNode(node, ctx));
        }
      }
      const head = inlineParts.join('').replace(/^(<br>)+|(<br>)+$/g, '').trim();
      const tail = blockParts.length ? '\n' + blockParts.join('\n') : '';
      return '<li>' + head + tail + '</li>';
    });

    return '<' + tag + '>\n' + rendered.join('\n') + '\n</' + tag + '>';
  }

  function tableBlock(table, ctx) {
    const trs = [...table.querySelectorAll('tr')];
    if (!trs.length) return '';

    const cellsOf = (tr) =>
      [...tr.children]
        .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
        .map((c) => {
          const tag = c.tagName.toLowerCase();
          return '<' + tag + '>' + inlineChildren(c, ctx).trim() + '</' + tag + '>';
        })
        .join('');

    const rows = trs.map(cellsOf).filter(Boolean);
    if (!rows.length) return '';

    const firstAllTh = trs[0] && [...trs[0].children].every((c) => c.tagName === 'TH');
    let out = '<table>\n';
    if (firstAllTh) {
      out += '<thead>\n<tr>' + rows[0] + '</tr>\n</thead>\n';
      out += '<tbody>\n' + rows.slice(1).map((r) => '<tr>' + r + '</tr>').join('\n') + '\n</tbody>\n';
    } else {
      out += '<tbody>\n' + rows.map((r) => '<tr>' + r + '</tr>').join('\n') + '\n</tbody>\n';
    }
    return out + '</table>';
  }

  function nodeBlock(node, ctx) {
    if (node.nodeType === 3) {
      const text = node.nodeValue;
      if (!text || !text.trim()) return '';
      return '<p>' + esc(text.trim()) + '</p>';
    }
    if (node.nodeType !== 1) return '';

    const el = node;
    if (skipElement(el) || isHidden(el)) return '';
    if (el.classList.contains('katex-display') || el.tagName === 'MATH') {
      return '<p class="math">' + esc(texOf(el)) + '</p>';
    }
    if (isLangLabelBeforeCode(el)) return '';

    switch (el.tagName) {
      case 'P': {
        const inner = inlineChildren(el, ctx).replace(/^(<br>\s*)+|(\s*<br>)+$/g, '').trim();
        return inner ? '<p>' + inner + '</p>' : '';
      }
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6': {
        const tag = el.tagName.toLowerCase();
        const inner = inlineChildren(el, ctx).trim();
        return inner ? '<' + tag + '>' + inner + '</' + tag + '>' : '';
      }
      case 'HR':
        return '<hr>';
      case 'PRE':
        return preBlock(el, ctx);
      case 'UL':
      case 'OL':
        return listBlock(el, ctx);
      case 'BLOCKQUOTE': {
        if (!hasBlockChild(el)) {
          const inlineQuote = inlineChildren(el, ctx).trim();
          return inlineQuote ? '<blockquote>\n<p>' + inlineQuote + '</p>\n</blockquote>' : '';
        }
        const inner = blocksOf(el, ctx);
        return inner ? '<blockquote>\n' + inner + '\n</blockquote>' : '';
      }
      case 'TABLE':
        return tableBlock(el, ctx);
      case 'DETAILS': {
        const summary = el.querySelector('summary');
        const head = summary ? '<p><strong>' + inlineChildren(summary, ctx).trim() + '</strong></p>' : '';
        const rest = [];
        for (const child of el.children) {
          if (child === summary) continue;
          rest.push(nodeBlock(child, ctx));
        }
        const body = rest.filter(Boolean).join('\n');
        const merged = [head, body].filter(Boolean).join('\n');
        return merged ? '<blockquote>\n' + merged + '\n</blockquote>' : '';
      }
      case 'FIGURE': {
        const img = el.querySelector('img');
        const cap = el.querySelector('figcaption');
        const parts = [];
        if (img) parts.push('<p>' + imgTag(img, ctx) + '</p>');
        if (cap) {
          const capHtml = inlineChildren(cap, ctx).trim();
          if (capHtml) parts.push('<p><em>' + capHtml + '</em></p>');
        }
        return parts.join('\n');
      }
      case 'IMG':
        return '<p>' + imgTag(el, ctx) + '</p>';
      case 'DL': {
        const parts = [];
        for (const child of el.children) {
          if (child.tagName === 'DT') parts.push('<p><strong>' + inlineChildren(child, ctx).trim() + '</strong></p>');
          else if (child.tagName === 'DD') parts.push('<p>' + inlineChildren(child, ctx).trim() + '</p>');
        }
        return parts.filter(Boolean).join('\n');
      }
      case 'DIV':
      case 'SECTION':
      case 'ARTICLE':
      case 'MAIN':
      case 'HEADER':
      case 'FIELDSET':
      case 'FORM':
      case 'CENTER':
      case 'ADDRESS': {
        if (hasBlockChild(el)) return blocksOf(el, ctx);
        const inner = inlineChildren(el, ctx).trim();
        return inner ? '<p>' + inner + '</p>' : '';
      }
      default: {
        if (hasBlockChild(el)) return blocksOf(el, ctx);
        const inner = inlineChildren(el, ctx).trim();
        return inner ? '<p>' + inner + '</p>' : '';
      }
    }
  }

  function blocksOf(root, ctx) {
    const out = [];
    for (const child of root.childNodes) {
      const html = nodeBlock(child, ctx);
      if (html) out.push(html);
    }
    return out.join('\n');
  }

  /* --------------------------------------------------------- inline / markdown */

  function mdInlineNode(node) {
    if (node.nodeType === 3) {
      return String(node.nodeValue || '').replace(/([\\`*<])/g, '\\$1');
    }
    if (node.nodeType !== 1) return '';
    const el = node;
    if (skipElement(el) || isHidden(el)) return '';
    if (el.classList.contains('katex') || el.classList.contains('katex-display')) return texOf(el);

    switch (el.tagName) {
      case 'BR':
        return '  \n';
      case 'STRONG':
      case 'B':
        return '**' + mdInlineChildren(el) + '**';
      case 'EM':
      case 'I':
        return '*' + mdInlineChildren(el) + '*';
      case 'DEL':
      case 'S':
      case 'STRIKE':
        return '~~' + mdInlineChildren(el) + '~~';
      case 'CODE':
      case 'KBD':
        return '`' + String(el.textContent).replace(/`/g, "'") + '`';
      case 'A': {
        const href = absUrl(el.getAttribute('href'));
        const inner = mdInlineChildren(el) || String(el.textContent || '').trim();
        return href && !/^javascript:/i.test(href) ? '[' + inner + '](' + href + ')' : inner;
      }
      case 'IMG': {
        const src = absUrl(el.getAttribute('src') || '');
        const alt = (el.getAttribute('alt') || '图片').trim();
        return src && !src.startsWith('data:') ? '![' + alt + '](' + src + ')' : '[' + alt + ']';
      }
      default:
        return mdInlineChildren(el);
    }
  }

  function mdInlineChildren(el) {
    let out = '';
    for (const child of el.childNodes) out += mdInlineNode(child);
    return out;
  }

  function mdList(el, depth) {
    const ordered = el.tagName === 'OL';
    const items = [...el.children].filter((c) => c.tagName === 'LI');
    const lines = [];
    let n = 1;
    for (const li of items) {
      const inlineParts = [];
      const nested = [];
      for (const node of li.childNodes) {
        if (node.nodeType === 1 && ['UL', 'OL'].includes(node.tagName)) nested.push(mdNode(node, depth + 1));
        else if (node.nodeType === 1 && ['P', 'PRE', 'TABLE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(node.tagName)) {
          const rendered = mdNode(node, depth + 1);
          if (rendered.trim()) nested.push(rendered);
        } else {
          inlineParts.push(mdInlineNode(node));
        }
      }
      const prefix = ordered ? n++ + '. ' : '- ';
      const indent = '  '.repeat(depth);
      const head = inlineParts.join('').trim();
      lines.push(indent + prefix + head);
      for (const chunk of nested) {
        const text = chunk.trim();
        if (!text) continue;
        lines.push(
          text
            .split('\n')
            .map((line) => indent + '  ' + line)
            .join('\n')
        );
      }
    }
    return lines.join('\n');
  }

  function mdTable(el) {
    const trs = [...el.querySelectorAll('tr')].filter((tr) => tr.children.length);
    if (!trs.length) return '';
    const cell = (c) => mdInlineChildren(c).trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|') || ' ';
    const rows = trs.map((tr) => [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map(cell));
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => r.concat(Array(width - r.length).fill(' '));
    const out = [];
    out.push('| ' + pad(rows[0]).join(' | ') + ' |');
    out.push('| ' + Array(width).fill('---').join(' | ') + ' |');
    for (const row of rows.slice(1)) out.push('| ' + pad(row).join(' | ') + ' |');
    return out.join('\n');
  }

  function mdNode(node, depth) {
    depth = depth || 0;
    if (node.nodeType === 3) {
      const text = String(node.nodeValue || '');
      return text.trim() ? text.trim() : '';
    }
    if (node.nodeType !== 1) return '';
    const el = node;
    if (skipElement(el) || isHidden(el)) return '';
    if (isLangLabelBeforeCode(el)) return '';

    switch (el.tagName) {
      case 'P': {
        const inner = mdInlineChildren(el).trim();
        return inner ? inner : '';
      }
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        return '#'.repeat(Number(el.tagName[1])) + ' ' + mdInlineChildren(el).trim();
      case 'HR':
        return '---';
      case 'PRE': {
        const codeEl = el.querySelector('code') || el;
        let lang = el.getAttribute('data-language') || '';
        if (!lang) {
          const m = /language-([A-Za-z0-9+#._-]+)/.exec((codeEl.className || '') + ' ' + (el.className || ''));
          if (m) lang = m[1];
        }
        if (!lang) lang = langInsidePre(el, codeEl) || detectLangFromLabel(el);
        lang = normalizeLang(lang) || '';
        const text = String(codeEl.textContent || '').replace(/\n$/, '');
        const fence = /```/.test(text) ? '````' : '```';
        return fence + lang + '\n' + text + '\n' + fence;
      }
      case 'UL':
      case 'OL':
        return mdList(el, depth);
      case 'BLOCKQUOTE': {
        if (!hasBlockChild(el)) return mdInlineChildren(el).trim() ? '> ' + mdInlineChildren(el).trim() : '';
        const inner = mdBlocks(el, depth);
        return inner
          .split('\n')
          .map((line) => '> ' + line)
          .join('\n');
      }
      case 'TABLE':
        return mdTable(el);
      case 'IMG': {
        const src = absUrl(el.getAttribute('src') || '');
        const alt = (el.getAttribute('alt') || '图片').trim();
        return src && !src.startsWith('data:') ? '![' + alt + '](' + src + ')' : '[' + alt + ']';
      }
      case 'FIGURE': {
        const parts = [];
        const img = el.querySelector('img');
        if (img) parts.push(mdNode(img, depth));
        const cap = el.querySelector('figcaption');
        if (cap) parts.push('*' + mdInlineChildren(cap).trim() + '*');
        return parts.join('\n\n');
      }
      case 'DETAILS': {
        const summary = el.querySelector('summary');
        const parts = [];
        if (summary) parts.push('**' + mdInlineChildren(summary).trim() + '**');
        for (const child of el.children) {
          if (child !== summary) parts.push(mdNode(child, depth));
        }
        return parts.filter(Boolean).join('\n\n');
      }
      default: {
        if (hasBlockChild(el)) return mdBlocks(el, depth);
        const inner = mdInlineChildren(el).trim();
        return inner;
      }
    }
  }

  function mdBlocks(root, depth) {
    const out = [];
    for (const child of root.childNodes) {
      const md = mdNode(child, depth || 0).trim();
      if (md) out.push(md);
    }
    return out.join('\n\n');
  }

  /* ------------------------------------------------------------------ export */

  function preview(el, limit) {
    const raw = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const max = limit || 120;
    return raw.length > max ? raw.slice(0, max) + '…' : raw;
  }

  function plainText(el) {
    return (el.innerText || el.textContent || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  C.serialize = {
    blocks(root, options) {
      const ctx = {
        breaks: !!(options && options.breaks),
        imageMode: (options && options.imageMode) || 'link'
      };
      return nodeBlock(root, ctx);
    },
    markdown(root) {
      return mdNode(root, 0);
    },
    text: plainText,
    preview,
    normalizeLang,
    escape: esc
  };
})();
