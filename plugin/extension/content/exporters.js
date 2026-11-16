/* 导出格式：HTML（兼容 app/converter.py）、Markdown、JSON、纯文本。 */
(function () {
  const C = (window.__CEX__ = window.__CEX__ || {});
  if (C.exporters) return;
  const SZ = C.serialize;
  const MD = C.markdown;

  const esc = SZ.escape;
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

  const ROLE_LABEL = { user: 'User', assistant: 'Assistant', system: 'System' };
  const ROLE_CN = { user: '用户', assistant: '助手', system: '系统' };

  function answerTitle(messages) {
    const clean = (text) => String(text || '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
    // 多轮会话优先取最后一篇带标题的回答；只考察实际导出的消息。
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role !== 'assistant') continue;
      const headings = [];
      if (typeof message.md === 'string') {
        const lines = message.md.split(/\r?\n/);
        let fence = null;
        for (let j = 0; j < lines.length; j++) {
          const line = lines[j];
          const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line);
          if (fence) {
            if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !line.slice(mark[0].length).trim()) fence = null;
            continue;
          }
          if (mark) { fence = mark[1]; continue; }
          const atx = /^ {0,3}(#{1,6})\s+(.+?)\s*$/.exec(line);
          if (atx) headings.push({ level: atx[1].length, text: clean(atx[2].replace(/\s+#+\s*$/, '')) });
          else if (line.trim() && !/^\s*(?:>|[-+*]\s|\d+[.)]\s)/.test(line) && /^ {0,3}(?:=+|-+)\s*$/.test(lines[j + 1] || '')) {
            headings.push({ level: lines[++j].trim()[0] === '=' ? 1 : 2, text: clean(line) });
          }
        }
      } else if (message.content && message.content.querySelectorAll) {
        for (const node of message.content.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
          if (!node.closest('pre,code,.wb-widget')) headings.push({ level: Number(node.tagName.slice(1)), text: node.textContent.trim() });
        }
      }
      const valid = headings.filter((heading) => heading.text);
      if (valid.length) {
        const level = Math.min(...valid.map((heading) => heading.level));
        return valid.find((heading) => heading.level === level).text;
      }
    }
    return '';
  }

  // 原导出文件的样式表（取自真实的 GPT Master 导出页），保证与桌面端转换结果一致
  const STYLE = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 2rem 1rem; background: #fff; color: #1a1a1a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
      line-height: 1.6;
    }
    .wrap { max-width: 46rem; margin: 0 auto; }
    .banner {
      border: 1px solid #c9c9c9; border-radius: 6px; padding: 0.75rem 1rem;
      margin-bottom: 2rem; font-size: 0.875rem; color: #444;
    }
    .notice {
      border: 1px solid #d9a441; border-radius: 6px; padding: 0.75rem 1rem;
      margin-bottom: 1.5rem; font-size: 0.875rem;
    }
    .cex-image-note { display: inline-block; padding: .35rem .6rem; border: 1px dashed #d9a441;
      border-radius: 6px; background: #fff9e8; color: #704b00; font-size: .875rem; }
    h1.doc-title { font-size: 1.75rem; line-height: 1.3; margin: 0 0 1.5rem; }
    .body p { white-space: pre-wrap; }
    .body p, .body li, .body td, .body th, blockquote { unicode-bidi: plaintext; }
    .body p, .body li, blockquote { overflow-wrap: break-word; }
    .body h3 { font-size: 1.2rem; margin: 1.4rem 0 0.5rem; }
    .body h4 { font-size: 1.05rem; margin: 1.3rem 0 0.5rem; }
    .body h5 { font-size: 1rem; margin: 1.2rem 0 0.4rem; }
    .body h6 { font-size: 0.95rem; margin: 1.1rem 0 0.4rem; color: #333; }
    .turn { margin: 0 0 1.75rem; padding-left: 0.875rem; border-left: 3px solid #d4d4d4; }
    .turn.assistant { border-left-color: #10a37f; }
    .role {
      font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.04em; color: #666; margin-bottom: 0.4rem;
    }
    .turn > .body > :first-child { margin-top: 0; }
    .turn > .body > :last-child { margin-bottom: 0; }
    pre {
      background: #f6f6f6; border-left: 3px solid #d4d4d4; padding: 0.75rem 1rem;
      white-space: pre-wrap; overflow-wrap: break-word; font-size: 0.85em;
    }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    :not(pre) > code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; overflow-wrap: anywhere; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.9em; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; overflow-wrap: anywhere; vertical-align: top; }
    th { background: #f6f6f6; }
    blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid #ddd; color: #555; }
    .wb-writing { margin: 1rem 0; padding: 0.8rem 1rem; background: #f8fafb;
                  border: 1px solid #e4e7eb; border-left: 3px solid #10a37f; border-radius: 6px; }
    hr { border: 0; border-top: 1px solid #ddd; margin: 1.5rem 0; }
    a { color: #0b6bcb; overflow-wrap: anywhere; }
    .footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid #e0e0e0; font-size: 0.8125rem; color: #666; }
    img { max-width: 100%; height: auto; }
    .cex-dom-images { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 12px; margin: 1rem 0; }
    .cex-dom-images img { width: 100%; max-height: 320px; object-fit: contain; border-radius: 10px; }
    @media print {
      .banner { display: none; }
      body { padding: 0; font-size: 11pt; font-family: Georgia, "Times New Roman", serif; }
      .wrap { max-width: none; }
      .body h3 { font-size: 1.45em; }
      .body h4 { font-size: 1.25em; }
      .body h5 { font-size: 1.1em; }
      .body h6 { font-size: 1em; color: #1a1a1a; }
      .body p:has(> strong:only-child) { break-after: avoid; }
      a { color: #000; text-decoration: underline; text-underline-offset: 2px; }
      a[href][data-host]:not(.bare)::after { content: " (" attr(data-host) ")"; font-size: 9pt; color: #555; overflow-wrap: anywhere; }
      tr, li { break-inside: avoid; }
      .role { break-after: avoid; }
      h1, h2, h3, h4, h5, h6 { break-after: avoid; }
      thead { display: table-header-group; }
      th { border-bottom: 2px solid #333; }
      pre, th { background: transparent; print-color-adjust: exact; }
      .wb-writing { background: #fff; border-color: #ccc; break-inside: avoid; }
    }
    
`;

  function stamp(date) {
    const d = date || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return {
      ymd: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
      hm: p(d.getHours()) + ':' + p(d.getMinutes()),
      full: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    };
  }

  function mergeDomImages(html, message, settings) {
    const holder = message.el && message.el.querySelectorAll ? message.el : null;
    const cached = message.extraImages || [];
    if (!cached.length && (!holder || !holder.querySelector('img[src], img[srcset], img[data-src]'))) return html;
    const fragment = document.createElement('div');
    fragment.innerHTML = html;
    const existing = new Set([...fragment.querySelectorAll('img[src]')].map((img) => img.src));
    const images = [];
    let anchor = '';
    function addImage(src, alt) {
      const candidate = document.createElement('img');
      candidate.setAttribute('src', src);
      candidate.setAttribute('alt', alt || '');
      const rendered = SZ.blocks(candidate, { imageMode: (settings && settings.imageMode) || 'link' });
      const imageBox = document.createElement('div');
      imageBox.innerHTML = rendered;
      const safeImage = imageBox.querySelector('img[src]');
      if (!safeImage || existing.has(safeImage.src)) return false;
      existing.add(safeImage.src);
      images.push(safeImage);
      return true;
    }
    for (const item of cached) {
      if (item && item.src && addImage(item.src, item.alt) && !anchor) anchor = item.anchor || '';
    }
    for (const img of holder ? holder.querySelectorAll('img[src], img[srcset], img[data-src]') : []) {
      const width = Math.max(img.naturalWidth || 0, img.getBoundingClientRect().width,
        Number(img.getAttribute('width')) || 0);
      if (width < 80) continue; // 头像、小图标不是回答插图
      const src = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') ||
        String(img.getAttribute('srcset') || '').split(/[\s,]/)[0];
      if (!src) continue;
      if (!addImage(src, img.getAttribute('alt'))) continue;
      if (!anchor) {
        let node = img;
        while (node && node !== holder && !anchor) {
          for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
            const value = (prev.innerText || prev.textContent || '').replace(/\s+/g, ' ').trim();
            if (value.length >= 5 && value.length <= 120) { anchor = value; break; }
          }
          node = node.parentElement;
        }
      }
    }
    if (!images.length) return html;
    const gallery = document.createElement('div');
    gallery.className = 'cex-dom-images';
    images.forEach((img) => gallery.appendChild(img));
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const target = anchor && [...fragment.querySelectorAll('p,h3,h4,h5,h6')]
      .find((el) => normalize(el.textContent) === anchor);
    const marker = target && target.outerHTML;
    const at = marker ? html.indexOf(marker) : -1;
    if (at >= 0) return html.slice(0, at + marker.length) + gallery.outerHTML + html.slice(at + marker.length);
    return html + gallery.outerHTML;
  }

  /** 消息正文：走接口拿到的原始 Markdown 优先（与真实导出同一套渲染），否则退回 DOM 序列化 */
  function bodyOf(m, settings) {
    function omitImages(html) {
      if (!/<img\b/i.test(html)) return html;
      const holder = document.createElement('div');
      holder.innerHTML = html;
      for (const img of holder.querySelectorAll('img')) {
        const note = document.createElement('span');
        note.className = 'cex-image-note';
        note.setAttribute('role', 'note');
        const alt = (img.getAttribute('alt') || '').trim();
        note.textContent = '图片未导出' + (alt ? '（' + alt + '）' : '') + '，请到原会话查看。';
        img.replaceWith(note);
      }
      return holder.innerHTML;
    }
    if (typeof m.md === 'string') return omitImages(MD.render(m.md, 2) || '<p></p>');
    const role = m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant';
    return omitImages(MD.renderMathInHtml(SZ.blocks(m.content, {
      breaks: role === 'user',
      imageMode: 'link'
    })));
  }

  function plainOf(m) {
    if (typeof m.md === 'string') return m.md;
    return SZ.text(m.content);
  }

  function roleLineOf(m, role) {
    const when = m.createdAt != null ? MD.formatTimestamp(m.createdAt) : '';
    return ROLE_LABEL[role] + (when ? ' &middot; ' + when : '');
  }

  function buildBaseHTML(messages, meta, settings) {
    const s = settings || {};

    // 结构与真实导出逐行一致：article 不缩进，role/body 缩进两格，body 带 dir="auto"
    const turns = messages
      .map((m) => {
        const role = m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant';
        const body = bodyOf(m, s);
        return [
          '<article class="turn ' + role + '">',
          '  <div class="role">' + roleLineOf(m, role) + '</div>',
          '  <div class="body" dir="auto">' + (body || '<p></p>') + '</div>',
          '</article>'
        ].join('\n');
      })
      .join('\n');

    const t = stamp();
    const metaBits = [];
    if (s.includeMeta !== false) {
      if (meta.site) metaBits.push(meta.site);
      if (meta.model) metaBits.push(meta.model);
      metaBits.push(t.full);
      metaBits.push(messages.length + ' 条消息');
    }

    // 结构与真实导出文件一致：.wrap > h1.doc-title + .banner + article.turn + .footer
    const banner =
      s.includeMeta === false
        ? ''
        : '  <div class="banner">' +
          esc(metaBits.join(' · ')) +
          (meta.url ? ' · <a href="' + escAttr(meta.url) + '">' + esc(meta.url) + '</a>' : '') +
          '</div>\n';

    return (
      '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + esc(meta.title || '未命名会话') + '</title>\n' +
      '<meta name="generator" content="会话导出增强器 1.0">\n' +
      (s.includeCss === false ? '' : '<style>' + STYLE + '</style>\n') +
      '</head>\n<body>\n<div class="wrap">\n' +
      '  <h1 class="doc-title" dir="auto">' + esc(meta.title || '未命名会话') + '</h1>\n' +
      banner +
      '  <div class="notice" role="note">图片未包含在导出文件中。原会话如有图片，请返回' +
      (meta.url ? ' <a href="' + escAttr(meta.url) + '">原会话</a>' : '原会话') + '查看。</div>\n' +
      turns + '\n' +
      '  <div class="footer">Exported from ' + esc(meta.site || 'Chat') + ' · ' + t.full + '</div>\n' +
      '</div>\n</body>\n</html>\n'
    );
  }

  // 在浏览器里跑一遍桌面端的转换管线：还原被拆散的组件 + 注入运行时 / 高亮 / 目录
  async function buildInteractiveHTML(messages, meta, settings, deps) {
    const base = buildBaseHTML(messages, meta, settings);
    const withMathAssets = async (doc) => {
      if (!deps || !deps.getAsset) return doc;
      let widgetMath = false;
      const data = /<script id="wb-widget-data" type="application\/json">([\s\S]*?)<\/script>/.exec(doc);
      if (data) {
        try {
          widgetMath = JSON.parse(data[1]).some((source) =>
            source.includes('\\(') || source.includes('\\[') || source.includes('$$') || /(?<!\\)\$(?!\s|\$)/.test(source));
        } catch (_) { /* 组件数据损坏时不阻断正文导出 */ }
      }
      if (!widgetMath && !/class="cex-math(?: |")/.test(doc)) return doc;
      const css = await deps.getAsset('katex.css');
      let inject = '<style id="cex-katex">' + css +
        '\n.cex-math-display,.cex-math-block{display:block;text-align:center;overflow:visible}' +
        '.cex-math-display{margin:.7em 0;padding:.3em 0}' +
        '.cex-math-block{margin:.75em 0;padding:.45em 0;overflow-x:auto}' +
        '.cex-math-block>.cex-math-display{margin:0;padding:0}' +
        '.cex-math-display .katex-display{margin:0}\n</style>';
      if (widgetMath) {
        const js = await deps.getAsset('katex.js');
        inject += '\n<script id="cex-katex-runtime">' + js.replace(/<\/script/gi, '<\\/script') + '</script>';
      }
      return doc.replace('</head>', inject + '\n</head>');
    };
    const interactive = !settings || settings.interactive !== false;

    if (!interactive) {
      return { doc: await withMathAssets(base), widgets: 0, interactive: false, engine: 'none' };
    }

    // 首选：Python 引擎（Pyodide 里跑 app/converter.py 原版），输出与桌面端逐字节一致
    if (deps && deps.pyConvert) {
      try {
        const out = await deps.pyConvert(base);
        if (out && out.ok && out.doc) {
          return {
            doc: await withMathAssets(out.doc),
            widgets: out.widgets || 0,
            interactive: true,
            mermaid: !!out.mermaid,
            engine: 'python'
          };
        }
        if (deps.onEngineError) {
          deps.onEngineError(new Error(out && out.message ? out.message : 'Python 引擎未产出内容'));
        }
      } catch (err) {
        if (deps.onEngineError) deps.onEngineError(err);
      }
    }

    // 回退：内置 JS 版管线（无 WASM 环境 / 用户选了快速引擎时走这条）
    if (!deps || !deps.getAsset) {
      return { doc: await withMathAssets(base), widgets: 0, interactive: false, engine: 'none' };
    }
    if (!C.widget) throw new Error('组件运行时未加载，请重新加载插件');

    const needMermaid = C.widget.hasMermaid(base);
    const [runtime, hljsJs, hljsCss, converterCss, tocJs, mermaidJs] = await Promise.all([
      deps.getAsset('runtime.js'),
      deps.getAsset('hljs.js'),
      deps.getAsset('hljs.css'),
      deps.getAsset('converter.css'),
      deps.getAsset('toc.js'),
      needMermaid ? deps.getAsset('mermaid.js') : Promise.resolve('')
    ]);

    const result = C.widget.convert(base, { runtime, hljsJs, hljsCss, converterCss, tocJs, mermaidJs });
    return {
      doc: await withMathAssets(result.doc),
      widgets: result.widgets,
      interactive: true,
      mermaid: result.hasMermaid,
      engine: 'js'
    };
  }

  function buildMarkdown(messages, meta, settings) {
    const s = settings || {};
    const lines = ['# ' + (meta.title || '未命名会话'), ''];
    if (s.includeMeta !== false) {
      const bits = [];
      if (meta.site) bits.push(meta.site);
      if (meta.model) bits.push(meta.model);
      bits.push(stamp().full);
      bits.push(messages.length + ' 条消息');
      lines.push('> ' + bits.join(' · '));
      if (meta.url) lines.push('> ' + meta.url);
      lines.push('');
    }

    messages.forEach((m) => {
      const role = m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant';
      lines.push('---', '');
      lines.push('## ' + (ROLE_CN[role] || '消息'));
      lines.push('');
      const body = plainOf(m).trim();
      lines.push(body || '_(空)_');
      lines.push('');
    });

    return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
  }

  function buildJSON(messages, meta, settings) {
    const s = settings || {};
    return JSON.stringify(
      {
        title: meta.title || '',
        url: meta.url || '',
        site: meta.site || '',
        model: meta.model || '',
        exportedAt: new Date().toISOString(),
        messageCount: messages.length,
        messages: messages.map((m) => ({
          index: m.index,
          role: m.role,
          createdAt: m.createdAt != null ? MD.formatTimestamp(m.createdAt) : '',
          text: plainOf(m),
          html: bodyOf(m, s)
        }))
      },
      null,
      2
    );
  }

  function buildText(messages, meta, settings) {
    const s = settings || {};
    const parts = [];
    if (s.includeMeta !== false) {
      parts.push((meta.title || '未命名会话').toUpperCase());
      const bits = [meta.site, meta.model, stamp().full, messages.length + ' 条消息'].filter(Boolean);
      parts.push(bits.join(' · '));
      if (meta.url) parts.push(meta.url);
      parts.push('');
    }
    messages.forEach((m) => {
      const role = m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant';
      parts.push('===== ' + (ROLE_CN[role] || '消息') + ' =====');
      parts.push(plainOf(m));
      parts.push('');
    });
    return parts.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  }

  const MIME = {
    html: 'text/html;charset=utf-8',
    markdown: 'text/markdown;charset=utf-8',
    json: 'application/json;charset=utf-8',
    text: 'text/plain;charset=utf-8'
  };
  const EXT = { html: 'html', markdown: 'md', json: 'json', text: 'txt' };

  function buildFilename(meta, settings, format) {
    const s = settings || {};
    let name = String(meta.title || '会话');

    name = name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 80)
      .trim();
    if (!name) name = '会话';

    const file = name + '.' + (EXT[format] || 'txt');
    const folder = String(s.subfolder || '')
      .replace(/[\\:*?"<>|]/g, '')
      .replace(/^\/+|\/+$/g, '')
      .trim();
    return folder ? folder + '/' + file : file;
  }

  C.exporters = {
    build(messages, meta, settings, format) {
      switch (format) {
        case 'markdown':
          return buildMarkdown(messages, meta, settings);
        case 'json':
          return buildJSON(messages, meta, settings);
        case 'text':
          return buildText(messages, meta, settings);
        default:
          return buildBaseHTML(messages, meta, settings);
      }
    },
    buildHTML: buildInteractiveHTML,
    baseHTML: buildBaseHTML,
    mime: (format) => MIME[format] || MIME.text,
    filename: buildFilename,
    answerTitle,
    ROLE_CN
  };
})();
