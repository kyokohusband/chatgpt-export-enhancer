/* 组件还原：app/converter.py 的 JS 移植。
   把导出的 HTML 里被拆散、被转义的组件源码重新拼成完整组件，替换成占位容器，
   再把运行时 / 高亮 / mermaid / 目录注入页面——产物与桌面端转换结果等价。 */
(function () {
  const C = (window.__CEX__ = window.__CEX__ || {});
  if (C.widget) return;
  const D = C.dsl;

  const ARTICLE_RE = /<article class="turn assistant"[^>]*>[\s\S]*?<\/article>/g;
  const BLOCK_RE = /<p>([\s\S]*?)<\/p>|<pre\b[^>]*>[\s\S]*?<\/pre>/gi;
  const GAP_BREAK_RE = /<(?:h[1-6]|hr|table|blockquote|article)\b/i;
  const MERMAID_RE = /(?:data-language\s*=\s*["']mermaid["']|class\s*=\s*["'][^"']*\blanguage-mermaid\b)/i;

  const UL_RE = /<ul\b[^>]*>[\s\S]*?<\/ul>/gi;
  const CODE_EXAMPLE_RE = /<(?:code|pre)\b[^>]*>[\s\S]*?<\/(?:code|pre)\s*>/gi;
  const LIST_DSL_RE = new RegExp(
    '&lt;\\s*/?\\s*(?:' +
      [...D.DSL_TAGS].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
      ')\\b'
  );

  // 已知的坏组件：{@body} 里写了 JSX，new Function 编译不过 → 换成纯字符串拼接
  const BAD_PAD =
    'const padSyntax = padValues.every((v)=>v===padValues[0]) ? <code>${padValues[0]}px</code> ' +
    ': padValues[0]===padValues[2] && padValues[1]===padValues[3] ? <code>${padValues[0]}px ${padValues[1]}px</code> ' +
    ': padValues[1]===padValues[3] ? <code>${padValues[0]}px ${padValues[1]}px ${padValues[2]}px</code> ' +
    ': <code>${padValues[0]}px ${padValues[1]}px ${padValues[2]}px ${padValues[3]}px</code>';
  const GOOD_PAD =
    'const pv = padValues; ' +
    'const padSyntax = (pv.every((v)=>v===pv[0]) ? [pv[0]] ' +
    ': (pv[0]===pv[2] && pv[1]===pv[3]) ? [pv[0],pv[1]] ' +
    ': (pv[1]===pv[3]) ? [pv[0],pv[1],pv[2]] ' +
    ': [pv[0],pv[1],pv[2],pv[3]]).map((n)=>n+"px").join(" ")';

  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

  function unescapeHtml(s) {
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : m;
    });
  }

  function iterBlocks(article, base) {
    const blocks = [];
    BLOCK_RE.lastIndex = 0;
    let m;
    while ((m = BLOCK_RE.exec(article))) {
      if (m[1] === undefined) {
        blocks.push({
          start: base + m.index,
          end: base + m.index + m[0].length,
          source: '{@html:' + encodeURIComponent(m[0]) + '}',
          isParagraph: false
        });
      } else {
        blocks.push({
          start: base + m.index,
          end: base + m.index + m[0].length,
          source: D.normalizeInlineTemplateCode(unescapeHtml(m[1])),
          isParagraph: true
        });
      }
    }
    return blocks;
  }

  function needsMore(acc, startsWithBody, hasComponent) {
    return (
      D.balance(acc) !== 0 ||
      D.directiveBalance(acc) !== 0 ||
      (startsWithBody && !hasComponent)
    );
  }

  function mergeComponent(html, blocks, i) {
    let acc = blocks[i].source;
    const startsWithBody = acc.replace(/^\s+/, '').startsWith('{@body');
    let hasComponent = D.OPEN_RE.test(acc);
    let truncated = false;
    let j = i;

    while (needsMore(acc, startsWithBody, hasComponent) && j + 1 < blocks.length) {
      const next = blocks[j + 1];
      const gap = html.slice(blocks[j].end, next.start);
      if (gap.trim()) {
        // 组件内部常夹着真实 HTML（ul/strong/br…），不含标题表格就并进组件
        if (GAP_BREAK_RE.test(gap)) {
          truncated = true;
          break;
        }
        acc += '\n{@html:' + encodeURIComponent(gap.trim()) + '}\n' + next.source;
      } else {
        acc += '\n' + next.source;
      }
      j += 1;
      hasComponent = hasComponent || D.OPEN_RE.test(next.source);
    }

    let forced = false;
    const ranOut = j + 1 >= blocks.length;
    if (hasComponent && !D.isBalanced(acc) && (truncated || ranOut)) {
      acc += '\n' + D.closingTail(acc);
      forced = true;
    }

    if (forced || (D.isBalanced(acc) && (!startsWithBody || hasComponent))) {
      return { j, source: acc.trim() };
    }
    return null;
  }

  function collectRegions(html) {
    const regions = [];
    ARTICLE_RE.lastIndex = 0;
    let art;
    while ((art = ARTICLE_RE.exec(html))) {
      const blocks = iterBlocks(art[0], art.index);
      let i = 0;
      while (i < blocks.length) {
        const head = blocks[i];
        if (!head.isParagraph || !D.START_RE.test(head.source)) {
          i += 1;
          continue;
        }
        const merged = mergeComponent(html, blocks, i);
        if (!merged) {
          i += 1;
          continue;
        }
        regions.push({ start: head.start, end: blocks[merged.j].end, source: merged.source });
        i = merged.j + 1;
      }
    }
    return regions;
  }

  function hasListDsl(text) {
    CODE_EXAMPLE_RE.lastIndex = 0;
    return LIST_DSL_RE.test(text.replace(CODE_EXAMPLE_RE, ''));
  }

  /** 组件源码被 markdown 当成列表续行塞进 <li> 时，提回独立段落 */
  function repairListSpill(html) {
    return html.replace(UL_RE, (block) => {
      if (!hasListDsl(block)) return block;

      const openEnd = block.indexOf('>') + 1;
      const closeAt = block.toLowerCase().lastIndexOf('</ul>');
      if (closeAt <= openEnd) return block;
      const inner = block.slice(openEnd, closeAt);

      const parts = inner.split(/(<li\b[^>]*>)/i);
      const out = [];
      let buf = [];
      const flush = () => {
        if (buf.length) {
          out.push('<ul>' + buf.join('') + '</ul>');
          buf = [];
        }
      };

      if (parts[0].trim()) out.push(parts[0]);

      for (let k = 1; k < parts.length; k += 2) {
        const openTag = parts[k];
        const rest = k + 1 < parts.length ? parts[k + 1] : '';
        const low = rest.toLowerCase();
        let body = rest;
        let tail = '';
        if (low.includes('</li>')) {
          const pos = low.indexOf('</li>');
          body = rest.slice(0, pos);
          tail = rest.slice(pos + 5);
        }
        if (hasListDsl(body)) {
          flush();
          out.push('<p>' + body.trim() + '</p>');
          if (tail.trim()) out.push(tail.trim());
        } else {
          buf.push(openTag + body + '</li>');
        }
      }
      flush();
      return out.join('');
    });
  }

  // 导出器自带的 banner / 页脚 / 提示条：桌面端会把它们去掉，这里保持一致
  const CHROME_RES = [
    /<div class="banner">[\s\S]*?<\/div>\s*/i,
    /<div class="footer">[\s\S]*?<\/div>\s*/i,
    /<div class="notice">[\s\S]*?<\/div>\s*/i
  ];

  function stripChrome(html) {
    return CHROME_RES.reduce((acc, re) => acc.replace(re, ''), html);
  }

  /* ------------------------------------------------------------ 注入脚本 */

  const HIGHLIGHT_BOOT =
    "(function(){function run(){var cs=document.querySelectorAll('pre[data-language]>code');" +
    "for(var i=0;i<cs.length;i++){var c=cs[i],lang=c.parentElement.getAttribute('data-language');" +
    "if(lang&&lang.toLowerCase()==='mermaid')continue;" +
    "if(window.hljs){if(lang&&hljs.getLanguage(lang))c.classList.add('language-'+lang);" +
    "c.classList.add('hljs');try{hljs.highlightElement(c);}catch(e){}}}}" +
    "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();})();";

  // 与 converter.py 的 copy_boot 逐字一致（多行、2 空格缩进），否则 JS 产物与 Python 产物排版不同
  const COPY_BOOT = [
    '',
    "(function () {",
    "  function fallback(text) {",
    "    var input = document.createElement('textarea');",
    "    input.value = text;",
    "    input.style.cssText = 'position:fixed;left:-9999px;top:0';",
    "    document.body.appendChild(input);",
    "    input.select();",
    "    try { return document.execCommand('copy'); }",
    "    finally { input.remove(); }",
    "  }",
    "  function add(pre) {",
    "    if (pre.classList.contains('wb-copyable')) return;",
    "    var code = pre.querySelector(':scope > code');",
    "    if (!code) return;",
    "    pre.classList.add('wb-copyable');",
    "    var button = document.createElement('button');",
    "    button.type = 'button';",
    "    button.className = 'wb-copy-code';",
    "    button.textContent = '\u590d\u5236';",
    "    button.setAttribute('aria-label', '\u590d\u5236\u4ee3\u7801');",
    "    button.addEventListener('click', async function () {",
    "      var ok = false;",
    "      try {",
    "        if (navigator.clipboard && navigator.clipboard.writeText) {",
    "          await navigator.clipboard.writeText(code.textContent);",
    "          ok = true;",
    "        }",
    "      } catch (_) {}",
    "      if (!ok) { try { ok = fallback(code.textContent); } catch (_) {} }",
    "      button.textContent = ok ? '\u5df2\u590d\u5236' : '\u590d\u5236\u5931\u8d25';",
    "      setTimeout(function () { button.textContent = '\u590d\u5236'; }, 1800);",
    "    });",
    "    pre.appendChild(button);",
    "  }",
    "  function scan(root) {",
    "    if (root.nodeType !== 1) return;",
    "    if (root.tagName === 'PRE') add(root);",
    "    root.querySelectorAll('pre').forEach(add);",
    "  }",
    "  function run() {",
    "    scan(document.body);",
    "    new MutationObserver(function (records) {",
    "      records.forEach(function (record) { record.addedNodes.forEach(scan); });",
    "    }).observe(document.body, {childList: true, subtree: true});",
    "  }",
    "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);",
    "  else run();",
    "})();",
    '',
  ].join('\n');

  const MERMAID_BOOT =
    "(function () {" +
    "  async function run() {" +
    "    if (!window.mermaid) return;" +
    "    mermaid.initialize({startOnLoad: false, securityLevel: 'strict'});" +
    "    var blocks = document.querySelectorAll('pre[data-language] > code, pre > code.language-mermaid');" +
    "    var index = 0;" +
    "    for (var code of blocks) {" +
    "      var pre = code.parentElement;" +
    "      if ((pre.getAttribute('data-language') || '').toLowerCase() !== 'mermaid' &&" +
    "          !code.classList.contains('language-mermaid')) continue;" +
    "      try {" +
    "        var id = 'wb-mermaid-' + index++;" +
    "        while (document.getElementById(id)) id += '-x';" +
    "        var result = await mermaid.render(id, code.textContent);" +
    "        var figure = document.createElement('div');" +
    "        figure.className = 'wb-mermaid';" +
    "        figure.innerHTML = result.svg;" +
    "        pre.replaceWith(figure);" +
    "      } catch (err) {" +
    "        console.warn('Mermaid render failed:', err);" +
    "      }" +
    "    }" +
    "  }" +
    "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);" +
    "  else run();" +
    "})();";

  function buildInject(parts) {
    let out = '\n<style>' + parts.hljsCss + '\n' + parts.converterCss + '</style>\n';
    out += '<script id="wb-widget-data" type="application/json">' + parts.payload + '</script>\n';
    out += '<script>\n' + parts.runtime + '\n</script>\n';
    out += '<script>' + parts.hljsJs + '</script>\n<script>' + HIGHLIGHT_BOOT + '</script>\n';
    if (parts.mermaidJs) {
      out += '<script>' + parts.mermaidJs + '</script>\n<script>' + MERMAID_BOOT + '</script>\n';
    }
    out += '<script>' + COPY_BOOT + '</script>\n';
    out += '<script id="wb-toc-script">' + parts.tocJs + '</script>\n';
    return out;
  }

  /**
   * @param {string} html 已生成的完整 HTML 文档
   * @param {{runtime:string,hljsJs:string,hljsCss:string,converterCss:string,tocJs:string,mermaidJs?:string}} assets
   */
  function convert(html, assets) {
    let doc = stripChrome(repairListSpill(html));
    const regions = collectRegions(doc);
    const sources = [];
    let out = '';
    let cursor = 0;

    regions.forEach((region, idx) => {
      out += doc.slice(cursor, region.start);
      out += '<div class="wb-widget" data-w="' + idx + '"></div>';
      sources.push(region.source.split(BAD_PAD).join(GOOD_PAD));
      cursor = region.end;
    });
    out += doc.slice(cursor);

    const hasMermaid = MERMAID_RE.test(out);
    // Python 侧是 json.dumps(..., ensure_ascii=False)，数组元素间是 ", "（带空格）；
    // JSON.stringify 不带空格，直接相差 N-1 字节。这里手工拼出同样的分隔符。
    const payload = (sources.length
      ? '[' + sources.map((s) => JSON.stringify(s)).join(', ') + ']'
      : '[]').replace(/<\//g, '<\\/');
    const inject = buildInject({
      payload,
      runtime: assets.runtime,
      hljsJs: assets.hljsJs,
      hljsCss: assets.hljsCss,
      converterCss: assets.converterCss,
      tocJs: assets.tocJs,
      mermaidJs: hasMermaid ? assets.mermaidJs || '' : ''
    });

    // 必须用函数式替换：inject 里内嵌 hljs/runtime 源码，含 $& / $$ / $` 等序列，
    // 直接传字符串会被 String.replace 当成替换模式展开（$& → 匹配到的 "</body>"）。
    out = out.includes('</body>')
      ? out.replace('</body>', () => inject + '</body>')
      : out + inject;
    return { doc: out, widgets: sources.length, hasMermaid };
  }

  C.widget = {
    convert,
    collectRegions,
    repairListSpill,
    hasMermaid: (html) => MERMAID_RE.test(html),
    MERMAID_RE
  };
})();
