/* ================= Widget Runtime for ChatGPT-exported HTML =================
 * 解析导出文件里被转义成文本的组件 DSL（box/row/text/... + {#each} + {#if}
 * + {@body useState}），重新渲染为真实 DOM，并支持交互与状态。
 * 无外部依赖，可离线运行。
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------ 设计 token ------------------ */
  var SP = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32 };
  var RADIUS = { sm: '4px', md: '8px', lg: '12px', xl: '16px', full: '999px' };
  var TEXT_SIZE = { xs: '12px', sm: '13px', md: '15px', lg: '17px', xl: '22px' };
  var TITLE_SIZE = { xs: '13px', sm: '15px', md: '18px', lg: '22px', xl: '32px' };
  var C = {
    'default': '#1a1a1a', primary: '#2563eb', secondary: '#6b7280', tertiary: '#8b95a1', success: '#16a34a',
    danger: '#dc2626', warning: '#d97706', caution: '#d97706', info: '#2563eb', discovery: '#7c3aed', subtle: '#e5e7eb',
    surface: '#ffffff', 'surface-secondary': '#f6f8fa', 'surface-tertiary': '#ebedf0',
    transparent: 'transparent'
  };
  var TV = { xs: { bg: '#eef2ff', fg: '#3730a3' }, info: { bg: '#dbeafe', fg: '#1d4ed8' }, success: { bg: '#dcfce7', fg: '#15803d' }, discovery: { bg: '#ede9fe', fg: '#6d28d9' }, danger: { bg: '#fee2e2', fg: '#b91c1c' }, warning: { bg: '#fef3c7', fg: '#b45309' } };
  TV.secondary = { bg: '#f3f4f6', fg: '#4b5563' };

  var focusSeq = 0;

  // 拼音候选尚未提交时保留原输入节点，避免状态更新重建 DOM 中断输入法。
  function bindTextChange(el, onChange) {
    var composing = false, lastValue = el.value;
    function commit() {
      if (composing || el.value === lastValue) return;
      lastValue = el.value;
      onChange(el.value);
    }
    el.addEventListener('compositionstart', function () { composing = true; });
    el.addEventListener('compositionend', function () { composing = false; commit(); });
    el.addEventListener('input', function (event) { if (!event.isComposing) commit(); });
    el.addEventListener('change', commit);
  }

  function px(v) {
    if (typeof v === 'number') return (SP[v] !== undefined ? SP[v] : v) + 'px';
    return v;
  }
  function radius(v) {
    if (typeof v === 'number') return v + 'px';
    return RADIUS[v] || v;
  }
  function col(v) {
    if (v === undefined || v === null || v === '') return null;
    return C[v] || v;
  }
  function mapAlign(v) {
    return ({ start: 'flex-start', end: 'flex-end', center: 'center', baseline: 'baseline', stretch: 'stretch', left: 'flex-start', right: 'flex-end' })[v] || v;
  }
  function mapJustify(v) {
    return ({ start: 'flex-start', end: 'flex-end', center: 'center', between: 'space-between', around: 'space-around', evenly: 'space-evenly' })[v] || v;
  }

  function applyPadding(s, p) {
    if (p === undefined || p === null) return;
    if (typeof p === 'number' || typeof p === 'string') { s.padding = px(p); return; }
    ['top', 'right', 'bottom', 'left'].forEach(function (k) {
      if (p[k] !== undefined) s['padding' + k.charAt(0).toUpperCase() + k.slice(1)] = px(p[k]);
    });
  }
  function applyBorder(s, b) {
    if (!b) return;
    if (b === true) { s.border = '1px solid #e5e7eb'; return; }
    if (b.size !== undefined || b.color !== undefined) {
      s.border = (b.size || 1) + 'px solid ' + (col(b.color) || '#e5e7eb');
      return;
    }
    ['top', 'right', 'bottom', 'left'].forEach(function (k) {
      var v = b[k];
      if (!v) return;
      if (v === true) v = { size: 1, color: '#e5e7eb' };
      s['border' + k.charAt(0).toUpperCase() + k.slice(1)] = (v.size || 1) + 'px solid ' + (col(v.color) || '#e5e7eb');
    });
  }

  /* ------------------ 图标 ------------------ */
  var ICONS = {
    'file-code': '<path d="M6 2h7l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M13 2v5h5"/><path d="M9 12l-2 2 2 2"/><path d="M13 12l2 2-2 2"/>',
    'layers': '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    'list-ordered': '<path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-.5"/><path d="M11 6h9"/><path d="M11 12h9"/><path d="M11 18h9"/>',
    'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    'monitor': '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    'smartphone': '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    'wrench': '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    'check-check': '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    'braces': '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
    'terminal': '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
    'layout-template': '<rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="7" x="3" y="14" rx="1"/><rect width="5" height="7" x="14" y="14" rx="1"/>',
    'mouse-pointer-click': '<path d="m9 9 5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 5.1"/><path d="m5.1 8-2.9-.8"/><path d="M14 4.1 12 6"/><path d="m6 12-1.9 2"/>',
    'list-filter': '<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>',
    'table': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
    'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'workflow': '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
    'arrow-up-down': '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'list': '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
    'files': '<path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l5 5v9a2 2 0 0 1-2 2Z"/><path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"/>',
    'panels-top-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
    'scan-eye': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1"/><path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"/>',
    'skip-forward': '<path d="M21 4v16"/><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>',
    'book-open': '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 0 4 2 5 5 0 0 0 4-2z"/>',
    'calendar-check': '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="m9 15 2 2 4-4"/>',
    'calendar-days': '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'folder': '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9h18"/>',
    'file': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    'user-round': '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    'coffee': '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>',
    'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    'layout-grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    'lightbulb': '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    'list-tree': '<path d="M8 5h13"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="M3 10a2 2 0 0 0 2 2h3"/><path d="M3 5v12a2 2 0 0 0 2 2h3"/>',
    'map': '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
    'play': '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
    'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'sparkles': '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
    'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    'house': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'circle-plus': '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
    'plus-circle': '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    'flag': '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>',
    'trending-up': '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
    'repeat': '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    'compass': '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
    'default': '<circle cx="12" cy="12" r="8"/>'
  };
  function iconSvg(name, size, color) {
    var library = typeof WB_LUCIDE_ICONS !== 'undefined' ? WB_LUCIDE_ICONS : {};
    var d = Object.prototype.hasOwnProperty.call(library, name) ? library[name] :
      (Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : ICONS['default']);
    var s = ({ xs: 12, sm: 16, md: 18, lg: 20, xl: 22, '2xl': 28, '3xl': 36 })[size] || 16;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="' +
      (col(color) || 'currentColor') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  }

  /* ------------------ 构造元素 ------------------ */
  function T(v) {
    if (v === undefined || v === null) return document.createTextNode('');
    return document.createTextNode(String(v));
  }

  /* ---------- 行内 Markdown：组件里的 **粗体** / `代码` / ~~删除~~ / *斜体* ----------
     组件的字面量文本节点走这里；表达式结果（数字、对象）仍然走 T，不解析。 */
  function escText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* 与 markdown.js 的 wrapToken 同规则：token 两侧不能是空白，避免把 `a * b * c` 当强调 */
  function wrapT(text, token, open, close) {
    var n = token.length, out = '', last = 0, start = text.indexOf(token);
    while (start !== -1) {
      var next = text[start + n];
      if (next === undefined || /\s/.test(next)) { start = text.indexOf(token, start + 1); continue; }
      var end = text.indexOf(token, start + n + 1);
      while (end !== -1 && /\s/.test(text[end - 1])) end = text.indexOf(token, end + 1);
      if (end === -1) break;
      out += text.slice(last, start) + open + text.slice(start + n, end) + close;
      last = end + n;
      start = text.indexOf(token, last);
    }
    return out + text.slice(last);
  }
  var MD_INLINE_RE = /\*\*|~~|`|\*[^\s*]|\\\(|\\\[|\$/;
  var MD_LIST_RE = /(^|\n)[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;
  /* 组件文本里的 markdown 表格（| 行 + |---| 分隔行）按真表格渲染 */
  var MD_TABLE_RE = /(^|\n)[ \t]*\|[^\n]*\n[ \t]*\|[ \t]*:?-{3,}:?[ \t]*\|/;
  function mdSepRow(l) {
    return /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/.test(l);
  }
  function mdCells(l) {
    var t = l.trim().replace(/^\|/, '').replace(/\|[ \t]*$/, '');
    return t.split('|').map(function (c) { return c.trim(); });
  }
  function mdTableHTML(block) {
    var rows = block.split('\n').filter(function (l) { return l.trim() && !mdSepRow(l); }).map(mdCells);
    if (!rows.length) return '';
    var head = rows[0];
    var h = '<table class="wb-md-table"><thead><tr>';
    head.forEach(function (c) { h += '<th>' + inlineMd(c) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.slice(1).forEach(function (r) {
      h += '<tr>';
      head.forEach(function (_, k) { h += '<td>' + inlineMd(r[k] == null ? '' : r[k]) + '</td>'; });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }
  /* 把文本拆成 普通文本段 + 表格：只有表格块结构化，其余文本保持原样
     （换行语义不动，交由 box 的行内分组处理） */
  function mdBlockFrag(s) {
    var lines = String(s).split('\n');
    var frag = document.createDocumentFragment();
    var buf = [];
    var flush = function () {
      if (!buf.length) return;
      var seg = buf.join('\n');
      /* notable：本函数只负责表格，避免表格分支自我递归；
         分段里的围栏仍交回 TM 的围栏分支，两个分支互相递归时各自
         至少消费一个块级结构，必然收敛 */
      frag.appendChild(MD_INLINE_RE.test(seg) ? TM(seg, 'notable') : document.createTextNode(seg));
      buf = [];
    };
    var i = 0;
    while (i < lines.length) {
      if (/^[ \t]*\|/.test(lines[i])) {
        var j = i, block = [];
        while (j < lines.length && /^[ \t]*\|/.test(lines[j])) { block.push(lines[j]); j += 1; }
        if (block.length >= 2 && mdSepRow(block[1])) {
          flush();
          var tpl = document.createElement('template');
          tpl.innerHTML = mdTableHTML(block.join('\n'));
          frag.appendChild(tpl.content);
          i = j;
          continue;
        }
      }
      buf.push(lines[i]);
      i += 1;
    }
    flush();
    return frag;
  }
  /* 组件文本里的 markdown 围栏代码块（```lang ... ```）按真代码块渲染，
     复用页面的 pre[data-language] 卡片样式 / 高亮 / 复制按钮 */
  var MD_FENCE_RE = /(^|\n)[ \t]*```/;
  function emitMdPre(frag, lang, content) {
    var tpl = document.createElement('template');
    var langAttr = lang ? ' data-language="' + escText(lang) + '"' : '';
    tpl.innerHTML = '<pre' + langAttr + '><code>' + escText(content) + '</code></pre>';
    frag.appendChild(tpl.content);
  }
  function mdFenceFrag(s) {
    var lines = String(s).split('\n');
    var frag = document.createDocumentFragment();
    var buf = [];
    var flush = function () {
      if (!buf.length) return;
      var seg = buf.join('\n');
      frag.appendChild(MD_INLINE_RE.test(seg) ? TM(seg, 'nofence') : document.createTextNode(seg));
      buf = [];
    };
    var open = null;
    for (var i = 0; i < lines.length; i++) {
      var isFenceLine = /^[ \t]*```/.test(lines[i]);
      if (open === null) {
        if (isFenceLine) {
          flush();
          open = { lang: lines[i].replace(/^[ \t]*```/, '').trim(), lines: [] };
        } else {
          buf.push(lines[i]);
        }
      } else if (isFenceLine) {
        emitMdPre(frag, open.lang, open.lines.join('\n'));
        open = null;
      } else {
        open.lines.push(lines[i]);
      }
    }
    if (open) {
      /* 未闭合的围栏：整体退回普通文本 */
      buf.push('```' + open.lang);
      buf.push.apply(buf, open.lines);
    }
    flush();
    return frag;
  }
  function inlineMd(s) {
    var parts = [];
    var fences = [];
    var maths = [];
    /* ``` 围栏先换成占位符：不参与行内代码配对，避免围栏残留的反引号
       和后面的 `代码` 错误配对，把正文吞进 <code> */
    var out = escText(s).replace(/`{3,}/g, function (m) {
      fences.push(m);
      return '\u0001f' + (fences.length - 1) + '\u0002';
    });
    out = out.replace(/`([^`]+)`/g, function (_, code) {
      parts.push(code);
      return '\u0000' + (parts.length - 1) + '\u0000';
    });
    out = out.replace(/\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|(?<!\\)\$(?!\$|\s)([^\n$]+?)(?<!\\)\$(?!\$|[\p{L}\p{N}])/gu,
      function (match, bracket, dollars, paren, inline) {
        var display = bracket !== undefined || dollars !== undefined;
        var tex = bracket !== undefined ? bracket : dollars !== undefined ? dollars : paren !== undefined ? paren : inline;
        tex = tex.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        if (!window.katex) return match;
        try {
          maths.push('<span class="cex-math' + (display ? ' cex-math-display' : '') + '">' +
            window.katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, trust: false, output: 'htmlAndMathml' }) + '</span>');
          return '\u0001m' + (maths.length - 1) + '\u0002';
        } catch (e) { return match; }
      });
    out = wrapT(wrapT(out, '***', '<strong><em>', '</em></strong>'), '**', '<strong>', '</strong>');
    out = wrapT(out, '~~', '<del>', '</del>');
    out = out.replace(/(^|[^\w*])\*([^\s*][^*]*?)\*(?=[^\w*]|$)/g, '$1<em>$2</em>');
    out = out.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return '<code style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
        'background:rgba(128,128,128,.16);padding:1px 5px;border-radius:4px">' + parts[+i] + '</code>';
    });
    return out.replace(/\u0001f(\d+)\u0002/g, function (_, i) { return fences[+i]; })
      .replace(/\u0001m(\d+)\u0002/g, function (_, i) { return maths[+i]; });
  }
  function mdListFrag(s) {
    var lines = String(s).split('\n');
    var frag = document.createDocumentFragment();
    var plain = [];
    var list = null;
    function flushPlain() {
      if (!plain.length) return;
      var segment = plain.join('\n');
      if (segment.trim()) frag.appendChild(TM(segment, 'nolist'));
      plain = [];
    }
    function flushList() {
      if (!list) return;
      frag.appendChild(list);
      list = null;
    }
    lines.forEach(function (line) {
      var match = /^[ \t]*(?:([-*+])|(\d+)[.)])[ \t]+(.+)$/.exec(line);
      if (!match) {
        flushList();
        plain.push(line);
        return;
      }
      flushPlain();
      var ordered = !!match[2];
      if (list && list.tagName !== (ordered ? 'OL' : 'UL')) flushList();
      if (!list) {
        list = document.createElement(ordered ? 'ol' : 'ul');
        list.style.margin = '0';
        list.style.paddingLeft = '1.5em';
        if (ordered && Number(match[2]) !== 1) list.start = Number(match[2]);
      }
      var item = document.createElement('li');
      item.innerHTML = inlineMd(match[3]);
      list.appendChild(item);
    });
    flushList();
    flushPlain();
    return frag;
  }
  function TM(v, mode) {
    if (v === undefined || v === null) return document.createTextNode('');
    var s = String(v);
    /* mode 控制块级分支：'notable' 跳过表格、'nofence' 跳过围栏（递归防环用） */
    if (mode !== 'notable' && MD_FENCE_RE.test(s)) return mdFenceFrag(s);
    if (mode !== 'nofence' && MD_TABLE_RE.test(s)) return mdBlockFrag(s);
    if (mode !== 'nolist' && MD_LIST_RE.test(s)) return mdListFrag(s);
    if (!MD_INLINE_RE.test(s)) return document.createTextNode(s);
    var tpl = document.createElement('template');
    tpl.innerHTML = inlineMd(s);
    var frag = document.createDocumentFragment();
    frag.appendChild(tpl.content);
    return frag;
  }
  function RAW(html) {
    var span = document.createElement('span');
    span.innerHTML = String(html).replace(/\\n/g, '\n');
    return span;
  }
  function RAW_HTML(encoded) {
    var template = document.createElement('template');
    template.innerHTML = decodeURIComponent(encoded);
    return template.content.cloneNode(true);
  }
  function isRadioGroup(el) { return el && el.classList && el.classList.contains('wb-rg'); }

  /* ------------------ SVG ------------------ */
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SVG_KEEP = { viewBox: 1, preserveAspectRatio: 1, gradientUnits: 1, patternUnits: 1, textLength: 1 };
  function svgAttr(name) {
    if (SVG_KEEP[name]) return name;
    return name.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
  }
  /* DSL 里的 svg 子元素是先用 HTML 元素建出来的，这里按命名空间重建 */
  function svgClone(node) {
    if (!node) return node;
    if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
    var raw = node.__wbRaw;
    if (node.nodeType !== 1 || !raw) return node.cloneNode(true);
    var el = document.createElementNS(SVG_NS, raw.tag);
    var p = raw.props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === undefined || v === null || v === false || typeof v === 'function' || k === 'key') return;
      if (v === true) { el.setAttribute(svgAttr(k), ''); return; }
      el.setAttribute(svgAttr(k), String(v));
    });
    (raw.kids || []).forEach(function (k) { if (k) el.appendChild(svgClone(k)); });
    return el;
  }

  /* flex 容器中的文字、加粗和行内代码应共处一行；显式换行和块级子组件另起一行。 */
  function groupFlexChildren(kids) {
    var flat = [];
    kids.forEach(function (kid) {
      if (kid && kid.nodeType === 11) {
        Array.prototype.forEach.call(kid.childNodes, function (child) { flat.push(child); });
      } else flat.push(kid);
    });

    var grouped = [], run = [];
    function flush() {
      if (run.length === 1 && run[0].nodeType !== 3) grouped.push(run[0]);
      else if (run.length > 1) {
        var span = document.createElement('span');
        run.forEach(function (node) { span.appendChild(node); });
        grouped.push(span);
      } else if (run.length === 1) {
        /* 相邻纯文本节点会被浏览器并成同一个匿名 flex 子项，换行必须有元素边界。 */
        var line = document.createElement('span');
        line.appendChild(run[0]);
        grouped.push(line);
      }
      run = [];
    }

    flat.forEach(function (node) {
      if (!node) return;
      if (node.nodeType === 3 && node.nodeValue.indexOf('\n') >= 0) {
        var lines = node.nodeValue.split('\n');
        lines.forEach(function (line, index) {
          if (line.trim()) run.push(document.createTextNode(line));
          if (index < lines.length - 1) flush();
        });
      } else if (node.nodeType === 3 || node.__wbInline ||
                 (node.nodeType === 1 && /^(STRONG|EM|CODE|SPAN|A|B|I|DEL|S|MARK|SUP|SUB)$/.test(node.tagName))) {
        run.push(node);
      } else {
        flush();
        grouped.push(node);
      }
    });
    flush();
    return grouped;
  }

  function EL(tag, props, kids) {
    props = props || {};
    kids = (kids || []).flat(Infinity).filter(function (k) { return k !== null && k !== undefined; });
    var rawKids = kids;
    var el, i;

    switch (tag) {
      case 'box':
      case 'col':
      case 'column':
        el = document.createElement('div');
        el.style.display = 'flex';
        el.style.flexDirection = props.direction === 'row' ? 'row' : 'column';
        el.style.boxSizing = 'border-box';
        if (props.gap !== undefined) el.style.gap = px(props.gap);
        break;
      case 'row':
        el = document.createElement('div');
        el.style.display = 'flex';
        el.style.flexDirection = 'row';
        el.style.alignItems = 'stretch';
        if (props.gap !== undefined) el.style.gap = px(props.gap);
        break;
      case 'grid':
        el = document.createElement('div');
        el.style.display = 'grid';
        el.style.width = '100%';
        el.style.minWidth = '0';
        el.style.gridTemplateColumns = 'repeat(' + (props.columns || 2) + ', minmax(0, 1fr))';
        if (props.gap !== undefined) el.style.gap = px(props.gap);
        break;
      case 'list':
        el = document.createElement('div');
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        if (props.gap !== undefined) el.style.gap = px(props.gap);
        break;
      case 'list-item':
        el = document.createElement('div');
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.padding = '8px 0';
        if (props.gap !== undefined) el.style.gap = px(props.gap);
        break;
      case 'grid-item':
        el = document.createElement('div');
        el.style.display = 'grid';
        el.style.minWidth = '0';
        if (Number.isInteger(Number(props.span)) && Number(props.span) > 0) {
          el.style.gridColumn = 'span ' + Number(props.span);
        }
        break;
      case 'table':
        el = document.createElement('div');
        el.style.display = 'table';
        el.style.width = '100%';
        el.style.borderCollapse = 'collapse';
        el.style.fontSize = '14px';
        break;
      case 'table-row':
        el = document.createElement('div');
        el.style.display = 'table-row';
        break;
      case 'table-cell':
        el = document.createElement('div');
        el.style.display = 'table-cell';
        el.style.verticalAlign = 'middle';
        el.style.padding = '8px 6px';
        el.style.borderBottom = '1px solid #e5e7eb';
        break;
      case 'text':
        /* svg 里的 <text> 和 DSL 的文本组件同名，按属性特征区分 */
        if (props.x !== undefined || props.y !== undefined || props.textAnchor !== undefined
            || props.fontSize !== undefined || props.dx !== undefined) {
          el = document.createElement('text');
          break;
        }
        el = document.createElement('span');
        el.style.display = props.inline ? 'inline' : 'block';
        el.__wbInline = !!props.inline;
        if (props.size) el.style.fontSize = TEXT_SIZE[props.size] || props.size;
        if (props.weight !== undefined) el.style.fontWeight = props.weight;
        if (props.color) el.style.color = col(props.color);
        if (props.italic) el.style.fontStyle = 'italic';
        if (props.underline) el.style.textDecoration = 'underline';
        if (props.lineThrough) el.style.textDecoration = 'line-through';
        if (props.textAlign) el.style.textAlign = props.textAlign;
        if (props.preserveWhitespace) el.style.whiteSpace = 'pre-wrap';
        el.style.lineHeight = '1.6';
        break;
      case 'title':
        el = document.createElement('div');
        el.style.fontSize = TITLE_SIZE[props.size] || (props.size || '18px');
        el.style.fontWeight = props.weight || '700';
        el.style.lineHeight = '1.35';
        el.style.color = col(props.color) || '#111827';
        break;
      case 'caption':
        el = document.createElement('div');
        el.style.fontSize = '12px';
        el.style.color = col(props.color) || '#8b95a1';
        el.style.lineHeight = '1.5';
        break;
      case 'divider':
        el = document.createElement('div');
        el.style.height = '1px';
        el.style.background = col(props.color) || '#e5e7eb';
        el.style.margin = '2px 0';
        el.style.flex = '0 0 auto';
        break;
      case 'strong':
        el = document.createElement('strong');
        el.__wbInline = true;
        break;
      case 'code':
        el = document.createElement('code');
        el.__wbInline = true;
        el.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        // 半透明底：浅色背景上是浅灰块，深色背景上是淡色块，文字始终继承父级颜色
        el.style.background = 'rgba(128,128,128,.16)';
        el.style.padding = '1px 5px';
        el.style.borderRadius = '4px';
        el.style.fontSize = '0.88em';
        break;
      case 'CodeBlock':
        el = document.createElement('pre');
        if (props.language) el.setAttribute('data-language', String(props.language));
        el.style.whiteSpace = 'pre';
        el.style.overflowX = 'auto';
        break;
      case 'badge': {
        el = document.createElement('span');
        el.__wbInline = true;
        var t = TV[props.color] || TV.info;
        el.style.display = 'inline-block';
        el.style.padding = '2px 9px';
        el.style.borderRadius = '999px';
        el.style.fontSize = '12px';
        el.style.fontWeight = '600';
        el.style.background = t.bg;
        el.style.color = t.fg;
        break;
      }
      case 'icon':
        el = document.createElement('span');
        el.__wbInline = !!props.inline;
        el.style.display = 'inline-flex';
        el.style.alignItems = 'center';
        el.style.color = col(props.color) || '#6b7280';
        el.innerHTML = iconSvg(props.name, props.size, props.color);
        break;
      case 'spacer':
        el = document.createElement('span');
        el.style.flex = '1 1 0%';
        break;
      case 'pressable':
        el = document.createElement('div');
        el.style.cursor = 'pointer';
        el.style.transition = 'background .18s ease, color .18s ease';
        el.style.display = 'inline-flex';
        el.style.flexDirection = props.direction === 'column' || props.direction === 'col' ? 'column' : 'row';
        el.style.alignItems = mapAlign(props.align || 'center');
        if (props.gap !== undefined) el.style.gap = px(props.gap);
        if (props.onClick) el.addEventListener('click', props.onClick);
        break;
      case 'button':
        el = document.createElement('button');
        el.type = 'button';
        el.disabled = !!(props.disabled || props.loading);
        el.style.display = 'inline-flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.gap = '6px';
        el.style.border = '1px solid transparent';
        el.style.background = '#111827';
        el.style.color = '#fff';
        el.style.padding = props.size === 'xs' ? '4px 8px' : props.size === 'sm' ? '6px 10px' : '11px 16px';
        el.style.borderRadius = props.size === 'xs' ? '999px' : '9px';
        el.style.fontSize = props.size === 'xs' ? '12px' : props.size === 'sm' ? '13px' : '15px';
        el.style.fontWeight = '600';
        el.style.cursor = 'pointer';
        el.style.fontFamily = 'inherit';
        if (props.block) el.style.width = '100%';
        if (props.loading) {
          el.setAttribute('aria-busy', 'true');
          var spinner = document.createElement('span');
          spinner.setAttribute('aria-hidden', 'true');
          spinner.style.cssText = 'display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;flex-shrink:0';
          if (spinner.animate && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
            spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 800, iterations: Infinity });
          }
          el.appendChild(spinner);
          el.style.cursor = 'wait';
        }
        if (props.disabled) {
          el.style.opacity = '.5';
          el.style.cursor = 'not-allowed';
        }
        if (props.onClick) el.addEventListener('click', props.onClick);
        break;
      case 'radio-group':
        el = document.createElement('div');
        el.className = 'wb-rg';
        el.style.display = 'flex';
        el.style.flexDirection = props.direction === 'col' ? 'column' : 'row';
        el.style.gap = '8px';
        el.style.flexWrap = 'wrap';
        break;
      case 'radio':
        el = document.createElement('label');
        el.style.display = 'inline-flex';
        el.style.alignItems = 'center';
        el.style.gap = '8px';
        el.style.cursor = 'pointer';
        el.style.fontSize = '15px';
        el.style.color = '#1a1a1a';
        var inp = document.createElement('input');
        inp.type = 'radio';
        inp.value = props.value !== undefined && props.value !== null ? String(props.value) : '';
        inp.style.margin = '0';
        inp.style.accentColor = '#111827';
        el.appendChild(inp);
        el.__radio = inp;
        break;
      case 'checkbox': {
        el = document.createElement('label');
        el.style.display = 'flex';
        el.style.alignItems = 'flex-start';
        el.style.gap = '10px';
        el.style.cursor = 'pointer';
        el.style.padding = '7px 0';
        el.style.fontSize = '15px';
        el.style.lineHeight = '1.6';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!props.checked;
        cb.style.margin = '4px 0 0';
        cb.style.width = '16px';
        cb.style.height = '16px';
        cb.style.flex = '0 0 auto';
        cb.style.accentColor = '#16a34a';
        cb.style.cursor = 'pointer';
        el.appendChild(cb);
        el.__wbBody = document.createElement('span');
        el.__wbBody.style.flex = '1';
        el.__wbBody.style.minWidth = '0';
        if (props.lineThrough) el.__wbBody.style.textDecoration = 'line-through';
        el.__wbBody.style.opacity = props.checked ? '0.62' : '1';
        if (typeof props.onChange === 'function') {
          cb.addEventListener('change', function () { props.onChange(cb.checked); });
        }
        break;
      }
      case 'select':
        el = document.createElement('select');
        (Array.isArray(props.options) ? props.options : []).forEach(function (item) {
          var option = document.createElement('option');
          var object = item !== null && typeof item === 'object';
          option.value = String(object ? item.value : item);
          option.textContent = String(object ? (item.label !== undefined ? item.label : item.value) : item);
          option.disabled = !!(object && item.disabled);
          el.appendChild(option);
        });
        el.disabled = !!props.disabled;
        el.style.cssText = 'box-sizing:border-box;padding:9px 12px;border:1px solid #d0d7de;border-radius:8px;font-size:15px;font-family:inherit;color:#1a1a1a;background:#fff;min-width:0';
        if (props.block) el.style.width = '100%';
        if (typeof props.onChange === 'function') {
          el.addEventListener('change', function () { props.onChange(el.value); });
        }
        break;
      case 'date-picker':
      case 'input':
        el = document.createElement('input');
        el.type = tag === 'date-picker' ? 'date' : (props.inputType || props.type || 'text');
        if (props.min !== undefined) el.min = String(props.min);
        if (props.max !== undefined) el.max = String(props.max);
        if (props.value !== undefined && props.value !== null) el.value = String(props.value);
        if (props.placeholder) el.placeholder = props.placeholder;
        if (props.disabled) el.disabled = true;
        el.style.width = '100%';
        el.style.boxSizing = 'border-box';
        el.style.padding = '9px 12px';
        el.style.border = '1px solid #d0d7de';
        el.style.borderRadius = '8px';
        el.style.fontSize = '15px';
        el.style.fontFamily = 'inherit';
        el.style.color = '#1a1a1a';
        el.style.background = '#fff';
        el.style.outline = 'none';
        if (typeof props.onChange === 'function') {
          bindTextChange(el, props.onChange);
        }
        break;
      case 'slider':
        el = document.createElement('input');
        el.type = 'range';
        el.className = 'wb-slider';
        el.min = props.min !== undefined ? props.min : 0;
        el.max = props.max !== undefined ? props.max : 100;
        el.step = props.step !== undefined ? props.step : 1;
        el.value = props.value !== undefined && props.value !== null ? props.value : el.min;
        el.disabled = !!props.disabled;
        el.setAttribute('aria-label', props.label || '滑块');
        el.style.width = '100%';
        el.style.margin = '4px 0';
        el.style.accentColor = col(props.color) || '#409eff';
        if (typeof props.onChange === 'function') {
          /* change 在拖动结束后触发，避免每个 pointermove 都重建整棵组件 DOM。 */
          el.addEventListener('change', function () {
            props.onChange(Number(el.value));
          });
        }
        break;
      case 'textarea':
        el = document.createElement('textarea');
        if (props.rows) el.rows = Number(props.rows) || 3;
        if (props.value !== undefined && props.value !== null) el.value = String(props.value);
        if (props.placeholder) el.placeholder = props.placeholder;
        el.style.width = '100%';
        el.style.boxSizing = 'border-box';
        el.style.padding = '9px 12px';
        el.style.border = '1px solid #d0d7de';
        el.style.borderRadius = '8px';
        el.style.fontSize = '15px';
        el.style.fontFamily = 'inherit';
        el.style.color = '#1a1a1a';
        el.style.background = '#fff';
        el.style.lineHeight = '1.6';
        el.style.resize = 'vertical';
        if (typeof props.onChange === 'function') {
          bindTextChange(el, props.onChange);
        }
        break;
      case 'label':
        el = document.createElement('label');
        el.style.display = 'block';
        el.style.fontSize = '13px';
        el.style.fontWeight = '600';
        el.style.color = '#374151';
        el.style.lineHeight = '1.5';
        break;
      case 'svg':
        el = document.createElementNS(SVG_NS, 'svg');
        el.style.maxWidth = '100%';
        el.style.height = 'auto';
        el.style.display = 'block';
        break;
      case 'rect': case 'path': case 'circle': case 'line': case 'polyline':
      case 'polygon': case 'ellipse': case 'g': case 'defs':
        el = document.createElement(tag);
        break;
      default:
        el = document.createElement(tag);
    }

    /* 通用盒模型属性 */
    if (props.padding !== undefined) applyPadding(el.style, props.padding);
    if (props.gap !== undefined && tag !== 'box' && tag !== 'row' && tag !== 'grid') el.style.gap = px(props.gap);
    if (props.background) el.style.background = col(props.background);
    if (props.border) applyBorder(el.style, props.border);
    if (props.radius) el.style.borderRadius = radius(props.radius);
    if (props.width !== undefined) el.style.width = props.width;
    if (props.height !== undefined) el.style.height = props.height;
    if (props.minWidth !== undefined) el.style.minWidth = props.minWidth;
    if (props.flex !== undefined) el.style.flex = String(props.flex);
    if (props.wrap !== undefined) el.style.flexWrap = props.wrap === true ? 'wrap' : props.wrap;
    if (props.size && (tag === 'box')) { el.style.width = props.size; el.style.height = props.size; }
    if (props.align) el.style.alignItems = mapAlign(props.align);
    if (props.justify) el.style.justifyContent = mapJustify(props.justify);
    if (props.clip) el.style.overflow = 'hidden';
    if (props.tabularNums) el.style.fontVariantNumeric = 'tabular-nums';
    if (props.weight !== undefined && tag !== 'title' && tag !== 'button') {
      el.style.fontWeight = props.weight === 'semibold' ? '600' : props.weight;
    }

    /* 按钮的描边 / 次要样式 */
    if (tag === 'button') {
      var buttonColor = col(props.color) || '#111827';
      el.style.background = buttonColor;
      if (props.variant === 'outline' || props.variant === 'ghost' || (props.color === 'secondary' && props.variant !== 'solid')) {
        el.style.background = props.variant === 'ghost' ? 'transparent' : '#fff';
        el.style.color = props.color === 'secondary' ? '#24292f' : buttonColor;
        el.style.border = props.variant === 'ghost' ? '1px solid transparent' : '1px solid ' + (props.color === 'secondary' ? '#d0d7de' : buttonColor);
      }
      if (props.color === 'secondary' && props.variant === 'solid') {
        el.style.background = '#6b7280';
        el.style.color = '#fff';
      }
    }

    el.__wbRaw = { tag: tag, props: props, kids: rawKids };
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'date-picker') el.setAttribute('data-wb-f', 'f' + (focusSeq++));

    /* checkbox 的子节点装进右侧内容区 */
    if (tag === 'checkbox') {
      kids.forEach(function (k) { if (k) el.__wbBody.appendChild(k); });
      el.appendChild(el.__wbBody);
      return el;
    }

    if (tag === 'CodeBlock') {
      var codeBlock = document.createElement('code');
      codeBlock.textContent = kids.map(function (k) { return k && k.textContent || ''; }).join('')
        .replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '');
      el.appendChild(codeBlock);
      return el;
    }

    /* svg 子元素按命名空间重建 */

    if (tag === 'svg') {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === undefined || v === null || v === false || typeof v === 'function' || k === 'key') return;
        el.setAttribute(svgAttr(k), v === true ? '' : String(v));
      });
      (rawKids || []).forEach(function (k) { if (k) el.appendChild(svgClone(k)); });
      return el;
    }

    /* radio 子节点：把文本装进 span，保持 input 在左 */
    if (tag === 'radio') {
      var span = document.createElement('span');
      kids.forEach(function (k) { span.appendChild(k); });
      el.appendChild(span);
      return el;
    }

    if (tag === 'box' || tag === 'col' || tag === 'column' || tag === 'row' || tag === 'list' || tag === 'list-item') {
      kids = groupFlexChildren(kids);
    }

    kids.forEach(function (k) { if (k) el.appendChild(k); });
    // 子 option 必须先挂载，再恢复受控值（同时支持 options 和显式 option）。
    if (tag === 'select' && props.value !== undefined && props.value !== null) el.value = String(props.value);

    /* 预格式文本里如果是 CSS 片段，用等宽字体呈现更接近原设计 */
    if (props.preserveWhitespace && /[{};]/.test(el.textContent || '')) {
      el.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      el.style.fontSize = '13px';
      el.style.color = el.style.color || '#24292f';
    }

    /* radio-group 挂载后：统一 name、恢复选中值、绑定 change */
    if (tag === 'radio-group') {
      var name = 'rg_' + Math.random().toString(36).slice(2);
      var inputs = el.querySelectorAll('input[type=radio]');
      for (i = 0; i < inputs.length; i++) {
        inputs[i].name = name;
        inputs[i].checked = String(props.value) === inputs[i].value;
      }
      el.addEventListener('change', function (e) {
        if (e.target && e.target.type === 'radio' && typeof props.onChange === 'function') {
          props.onChange(e.target.value);
        }
      });
    }

    return el;
  }

  /* ------------------ 模板解析 ------------------ */
  function parse(src) {
    var i = 0, n = src.length;

    function readBrace() {
      var d = 0, j = i, q = null;
      while (j < n) {
        var c = src[j];
        if (q) {
          if (c === '\\') { j += 2; continue; }
          if (c === q) q = null;
          j++; continue;
        }
        if (c === '"' || c === "'" || c === '`') { q = c; j++; continue; }
        if (c === '{') d++;
        else if (c === '}') {
          d--;
          if (d === 0) { var body = src.slice(i + 1, j); i = j + 1; return body; }
        }
        j++;
      }
      throw new Error('未闭合的 { 表达式');
    }

    function readDirective() {
      var d = 0, j = i + 1, q = null;
      while (j < n) {
        var c = src[j];
        if (q) {
          if (c === '\\') { j += 2; continue; }
          if (c === q) q = null;
          j++; continue;
        }
        if (c === '"' || c === "'" || c === '`') { q = c; j++; continue; }
        if (c === '{' || c === '[' || c === '(') d++;
        else if (c === ']' || c === ')') { if (d > 0) d--; }
        else if (c === '}') {
          if (d === 0) { var body = src.slice(i + 1, j); i = j + 1; return body; }
          d--;
        }
        j++;
      }
      throw new Error('未闭合的指令');
    }

    function parseText() {
      var s = '';
      while (i < n) {
        var c = src[i];
        /* GenUI 的 <escape>...</escape> 表示字面量文本，必须留在当前文本节点中。
           否则 **Wrapper<escape><</escape>T>** 会被拆开，粗体标记也会泄漏。 */
        if (src.startsWith('<escape>', i)) {
          var escapeEnd = src.indexOf('</escape>', i + 8);
          if (escapeEnd >= 0) {
            s += src.slice(i + 8, escapeEnd);
            i = escapeEnd + 9;
            continue;
          }
        }
        /* LaTeX 环境中的 {aligned}、{gathered} 等是公式语法，不是 DSL 表达式。 */
        var mathClose = src.startsWith('\\[', i) ? '\\]' :
          src.startsWith('\\(', i) ? '\\)' :
          src.startsWith('$$', i) ? '$$' :
          c === '$' && src[i + 1] && !/\s/.test(src[i + 1]) ? '$' : '';
        if (mathClose) {
          var openerLength = mathClose.length;
          var mathEnd = src.indexOf(mathClose, i + openerLength);
          if (mathEnd >= 0) {
            s += src.slice(i, mathEnd + mathClose.length);
            i = mathEnd + mathClose.length;
            continue;
          }
        }
        if (c === '{') break;
        if (c === '<' && /[a-zA-Z\/]/.test(src[i + 1] || '')) break;
        if (c === '`') {
          /* 行内代码：反引号里的 {expr}、<tag> 都是字面量，不当 DSL 语法解析。
             否则 `GET /detail/{id}` 里的 {id} 会被当成表达式，运行时找不到变量
             直接把整个组件炸成「渲染失败」。 */
          /* ≥3 个连续反引号是 markdown 围栏（``` 代码块）：整块按字面量消费，
             内容里的 {expr}、<tag> 一律不解析；找不到闭合行则按原样放行 */
          var run = 0;
          while (src[i + run] === '`') run += 1;
          if (run >= 3) {
            var cm = /\n[ \t]*`{3,}/.exec(src.slice(i + run));
            if (cm) {
              var endAbs = i + run + cm.index + cm[0].length;
              s += src.slice(i, endAbs);
              i = endAbs;
              continue;
            }
            s += src.slice(i, i + run);
            i += run;
            continue;
          }
          var token = src.slice(i, i + run);
          var close = src.indexOf(token, i + run);
          if (close > i) {
            s += src.slice(i, close + run);
            i = close + run;
            continue;
          }
          s += token;
          i += run;
          continue;
        }
        s += c; i++;
      }
      if (!s && i < n) { s = src[i]; i++; }
      return { type: 'text', value: s };
    }

    function parseInterp() {
      var body = readBrace();
      if (body.indexOf('@html:') === 0) return { type: 'html', value: body.slice(6) };
      if (/^\s*<[a-zA-Z]/.test(body)) return { type: 'raw', value: body };
      /* `{}` 这种空表达式（常见于 #{} 之类的代码片段）当字面量输出，避免编译成 () 直接炸掉整个组件 */
      if (!body.trim()) return { type: 'text', value: '{}' };
      return { type: 'expr', value: body };
    }

    function parseElement() {
      i++; // <
      var name = '';
      while (i < n && /[\w-]/.test(src[i])) { name += src[i]; i++; }
      var attrs = [], selfClose = false;
      while (i < n) {
        while (i < n && /\s/.test(src[i])) i++;
        if (src[i] === '/') { selfClose = true; i++; continue; }
        if (src[i] === '>') { i++; break; }
        if (i >= n) break;
        var an = '';
        while (i < n && /[^\s=>\/]/.test(src[i])) { an += src[i]; i++; }
        if (!an) { i++; continue; }
        while (i < n && /\s/.test(src[i])) i++;
        if (src[i] === '=') {
          i++;
          while (i < n && /\s/.test(src[i])) i++;
          if (src[i] === '"' || src[i] === "'") {
            var q = src[i]; i++;
            var v = '';
            while (i < n && src[i] !== q) { v += src[i]; i++; }
            i++;
            attrs.push({ name: an, kind: 'str', value: v });
          } else if (src[i] === '{') {
            attrs.push({ name: an, kind: 'expr', value: readBrace() });
          } else {
            var v2 = '';
            while (i < n && !/[\s>\/]/.test(src[i])) { v2 += src[i]; i++; }
            attrs.push({ name: an, kind: 'str', value: v2 });
          }
        } else {
          attrs.push({ name: an, kind: 'bool', value: true });
        }
      }
      var children = [];
      if (!selfClose) {
        var closeTag = '</' + name + '>';
        var closeIndex = src.indexOf(closeTag, i);
        var codeExample = (name === 'code' || name === 'CodeBlock') && closeIndex >= 0 ? src.slice(i, closeIndex) : '';
        if ((name === 'code' || name === 'CodeBlock') && closeIndex >= 0) {
          /* <code> 的内容一律按字面量处理（DSL 没有在代码里插值的语义）：
             {id}、<tag> 显示成什么就是什么，不能当表达式/标签解析。 */
          children = [{type: name === 'CodeBlock' ? 'literal' : 'text', value: codeExample}];
          i = closeIndex + closeTag.length;
        } else if (closeIndex < 0) {
          /* 找不到闭合标签（如文本里混入的 <T> 之类）：按自闭合处理，避免吞掉后续全部内容 */
          selfClose = true;
        } else {
          children = parseChildren([closeTag]);
          if (src.startsWith(closeTag, i)) i += name.length + 3;
          else {
            var k = src.indexOf(closeTag, i);
            if (k >= 0) i = k + name.length + 3;
          }
        }
      }
      return { type: 'el', name: name, attrs: attrs, children: children };
    }

    function parseEach() {
      var dir = readDirective();
      var s = dir.replace(/^#each\s+/, '');
      var m = s.match(/^([\s\S]*?)\s+as\s+([\w$]+)(?:\s*,\s*([\w$]+))?\s*$/);
      if (!m) throw new Error('each 语法无法解析: ' + s);
      var children = parseChildren(['{/each}']);
      if (src.startsWith('{/each}', i)) i += 7;
      return { type: 'each', expr: m[1], alias: m[2], idx: m[3] || '__i' + Math.random().toString(36).slice(2), children: children };
    }

    function parseIf() {
      var dir = readDirective();
      var cond = dir.replace(/^#if\s+/, '');
      var branches = [];
      var els = [];
      for (;;) {
        branches.push({ cond: cond, children: parseChildren(['{:else}', '{:else if', '{/if}']) });
        if (src.startsWith('{:else if', i)) {
          var body = readDirective();
          cond = body.replace(/^:?\s*else\s+if\s+/, '');
          continue;
        }
        if (src.startsWith('{:else}', i)) { i += 7; els = parseChildren(['{/if}']); }
        break;
      }
      if (src.startsWith('{/if}', i)) i += 5;
      return { type: 'if', branches: branches, else: els };
    }

    function parseChildren(stops) {
      var out = [];
      while (i < n) {
        if (stops) {
          var hit = false;
          for (var z = 0; z < stops.length; z++) if (src.startsWith(stops[z], i)) { hit = true; break; }
          if (hit) break;
        }
        if (src.startsWith('{#each', i)) { out.push(parseEach()); continue; }
        if (src.startsWith('{#if', i)) { out.push(parseIf()); continue; }
        if (src[i] === '<' && /[a-zA-Z]/.test(src[i + 1] || '') && !src.startsWith('<escape>', i)) {
          out.push(parseElement()); continue;
        }
        if (src[i] === '<' && src[i + 1] === '/') {
          /* 游离的闭合标签（没有对应开标签）：跳过而不是当正文显示 */
          var e = src.indexOf('>', i);
          i = e < 0 ? n : e + 1;
          continue;
        }
        if (src[i] === '{') { out.push(parseInterp()); continue; }
        out.push(parseText());
      }
      return out;
    }

    return parseChildren(null);
  }

  /* ------------------ 编译为 JS ------------------ */
  /* DSL 允许 **{expr}** 这种「字面量包裹表达式」的写法。** 与表达式会被解析成
     相邻的不同节点，单个文本节点里的 ** 配不成对，各自走 TM 时只能原样显示。
     这里在编译前扫描：只要某段连续的 文本/表达式 串里有文本节点带着不成对的
     ** / ~~ / `（且整串配平），就把整串并成一个 __tm，让行内 Markdown 一次性
     处理拼接结果。纯文本或已配平的串不动，保持原有渲染路径。 */
  var MD_TOKENS = ['**', '~~', '`'];
  function oddMarkerCount(s, token) {
    return (String(s).split(token).length - 1) % 2 === 1;
  }
  function isMdFragment(nd) {
    return nd.type === 'text' || nd.type === 'expr';
  }
  function mergeMdRuns(nodes) {
    var out = [], i = 0;
    while (i < nodes.length) {
      var nd = nodes[i];
      if (!isMdFragment(nd) || nd.type !== 'text' || !nd.value) { out.push(nd); i += 1; continue; }
      var hasOdd = false, starTotal = 0, k;
      for (k = 0; k < MD_TOKENS.length; k++) {
        if (oddMarkerCount(nd.value, MD_TOKENS[k])) hasOdd = true;
      }
      starTotal += String(nd.value).split('**').length - 1;
      var j = i + 1, hasExpr = false;
      while (j < nodes.length && isMdFragment(nodes[j])) {
        var nj = nodes[j];
        if (nj.type === 'text') {
          if (nj.value) {
            for (k = 0; k < MD_TOKENS.length; k++) {
              if (oddMarkerCount(nj.value, MD_TOKENS[k])) hasOdd = true;
            }
            starTotal += String(nj.value).split('**').length - 1;
          }
        } else hasExpr = true;
        j += 1;
      }
      if (hasOdd && hasExpr && starTotal % 2 === 0 && j - i >= 3) {
        var parts = [];
        for (k = i; k < j; k++) {
          var m = nodes[k];
          if (m.type === 'text') {
            if (m.value) parts.push(JSON.stringify(m.value));
          } else {
            var okExpr = null;
            try { new Function('return (' + m.value + ');'); okExpr = m.value; } catch (e) { okExpr = null; }
            parts.push(okExpr === null ? JSON.stringify('{' + m.value + '}') : 'String(' + okExpr + ')');
          }
        }
        out.push({ type: 'md', src: parts.join('+') });
        i = j;
        continue;
      }
      out.push(nd);
      i += 1;
    }
    return out;
  }
  function compileNodes(nodes) {
    return '[' + mergeMdRuns(nodes).map(compileNode).join(',') + ']';
  }
  /* 属性/条件表达式被导出器改坏时，不能让整个组件炸掉：降级成空值 */
  var _exprCache = {};
  function validExpr(src) {
    if (src in _exprCache) return _exprCache[src];
    var ok = true;
    try { new Function('return (' + src + ');'); } catch (e) { ok = false; }
    _exprCache[src] = ok;
    return ok;
  }
  function compileNode(nd) {
    if (nd.type === 'md') return '[__tm(' + nd.src + ')]';
    if (nd.type === 'literal') return '[__t(' + JSON.stringify(nd.value) + ')]';
    if (nd.type === 'text') {
      if (!nd.value || /^\s*$/.test(nd.value)) {
        /* 含换行的空白节点保留为一个 \n 文本节点：box/list 的行内分组靠它断行 */
        return nd.value && nd.value.indexOf('\n') >= 0 ? '[__t("\\n")]' : '[]';
      }
      return '[__tm(' + JSON.stringify(nd.value) + ')]';
    }
    if (nd.type === 'expr') {
      /* 表达式语法错误时降级为字面量，避免一个坏表达式让整个组件白屏 */
      var okExpr = null;
      try { new Function('return (' + nd.value + ');'); okExpr = nd.value; } catch (e) { okExpr = null; }
      if (okExpr === null) return '[__t(' + JSON.stringify('{' + nd.value + '}') + ')]';
      return '[__t((' + okExpr + '))]';
    }
    if (nd.type === 'raw') return '[__raw(' + JSON.stringify(nd.value) + ')]';
    if (nd.type === 'html') return '[__html(' + JSON.stringify(nd.value) + ')]';
    if (nd.type === 'el') {
      var props = nd.attrs.map(function (a) {
        var code;
        if (a.kind === 'bool') code = 'true';
        else if (a.kind === 'str') code = JSON.stringify(a.value);
        else code = validExpr(a.value) ? '(' + a.value + ')' : 'void 0';
        return JSON.stringify(a.name) + ':' + code;
      }).join(',');
      return '[__el(' + JSON.stringify(nd.name) + ',{' + props + '},' + compileNodes(nd.children) + ')]';
    }
    if (nd.type === 'each') {
      var eachExpr = validExpr(nd.expr) ? nd.expr : '[]';
      return '...(' + eachExpr + '||[]).map(function(' + nd.alias + ',' + nd.idx + '){return ' + compileNodes(nd.children) + ';})';
    }
    if (nd.type === 'if') {
      var code = compileNodes(nd.else || []);
      for (var bi = nd.branches.length - 1; bi >= 0; bi--) {
        var cond = validExpr(nd.branches[bi].cond) ? nd.branches[bi].cond : 'false';
        code = '(' + cond + '?(' + compileNodes(nd.branches[bi].children) + '):(' + code + '))';
      }
      return '...(' + code + ')';
    }
    return '[]';
  }

  /* ------------------ 挂载 ------------------ */
  function extractBodies(src) {
    var bodies = [], re = /^[ \t]*\{@body\s+/gm, parts = [], last = 0, match;
    while ((match = re.exec(src))) {
      var start = match.index, i = re.lastIndex, depth = 1, quote = null, comment = null;
      var bodyStart = i;
      for (; i < src.length; i++) {
        var c = src[i], next = src[i + 1];
        if (comment === 'line') { if (c === '\n') comment = null; continue; }
        if (comment === 'block') { if (c === '*' && next === '/') { comment = null; i++; } continue; }
        if (quote) {
          if (c === '\\') { i++; continue; }
          if (c === quote) quote = null;
          continue;
        }
        if (c === '/' && next === '/') { comment = 'line'; i++; continue; }
        if (c === '/' && next === '*') { comment = 'block'; i++; continue; }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) break;
      }
      if (depth !== 0) throw new Error('未闭合的 body 指令');
      parts.push(src.slice(last, start));
      bodies.push(src.slice(bodyStart, i));
      last = i + 1;
      re.lastIndex = last;
    }
    parts.push(src.slice(last));
    return {bodies: bodies, rest: parts.join('')};
  }

  function mount(root, src) {
    var ast, code;
    try {
      var extracted = extractBodies(src);
      ast = parse(extracted.rest);
      code = extracted.bodies.join('\n') + '\nreturn [].concat(' + compileNodes(ast) + ').flat(Infinity).filter(function(x){return x!==null&&x!==undefined;});';
    } catch (e) {
      root.innerHTML = '<div class="wb-err">组件解析失败：' + e.message + '</div>';
      return;
    }

    var fn;
    try {
      fn = new Function('__t', '__tm', '__raw', '__html', '__el', 'DIL', 'GenUI', code);
    } catch (e) {
      root.innerHTML = '<div class="wb-err">组件编译失败：' + e.message + '</div>';
      console.error(e, code);
      return;
    }

    /* 离线环境无法真的开新对话，把用户选中的追问显示在组件下方 */
    var GenUI = {
      issueNewTurn: function (text) {
        try {
          var note = root.parentNode && root.parentNode.querySelector('.wb-genui[data-for="' + root.getAttribute('data-w') + '"]');
          if (!note) {
            note = document.createElement('div');
            note.className = 'wb-genui';
            note.setAttribute('data-for', root.getAttribute('data-w') || '');
            root.parentNode.insertBefore(note, root.nextSibling);
          }
          note.textContent = String(text);
        } catch (e) { /* 忽略 */ }
      },
      copy: function (text) {
        var s = String(text == null ? '' : text);
        var done = function (ok) {
          try {
            var tip = document.createElement('div');
            tip.className = 'wb-toast' + (ok ? '' : ' wb-toast-bad');
            tip.textContent = ok ? '已复制到剪贴板' : '复制失败，请手动选择文本';
            document.body.appendChild(tip);
            setTimeout(function () { if (tip.parentNode) tip.parentNode.removeChild(tip); }, 1800);
          } catch (e) {}
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(s).then(function () { done(true); }, function () { done(false); });
            return;
          }
        } catch (e) { /* 落到下面的兜底 */ }
        try {
          var ta = document.createElement('textarea');
          ta.value = s;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          done(ok);
        } catch (e) { done(false); }
      }
    };

    var store = {};
    var rendering = false;
    function render() {
      if (rendering) return;
      rendering = true;
      var hookIndex = 0;
      var DIL = {
        useState: function (init) {
          var k = hookIndex++;
          if (!(k in store)) store[k] = (typeof init === 'function' ? init() : init);
          return [store[k], function (v) {
            store[k] = (typeof v === 'function' ? v(store[k]) : v);
            render();
          }];
        }
      };
      try {
        var ae = document.activeElement, keep = null, selA = null, selB = null;
        if (ae && ae.getAttribute && root.contains(ae) && ae.getAttribute('data-wb-f')) {
          keep = ae.getAttribute('data-wb-f');
          try { selA = ae.selectionStart; selB = ae.selectionEnd; } catch (e1) {}
        }
        focusSeq = 0;
        var out = fn(T, TM, RAW, RAW_HTML, EL, DIL, GenUI);
        while (root.firstChild) root.removeChild(root.firstChild);
        out.forEach(function (node) { if (node) root.appendChild(node); });
        if (keep) {
          var again = root.querySelector('[data-wb-f="' + keep + '"]');
          if (again) {
            try {
              again.focus();
              if (selA !== null && again.setSelectionRange) again.setSelectionRange(selA, selB);
            } catch (e2) {}
          }
        }
      } catch (e) {
        root.innerHTML = '<div class="wb-err">组件渲染失败：' + e.message + '</div>';
        console.error(e, code);
      } finally {
        rendering = false;
      }
    }
    render();
  }

  /* ------------------ 启动 ------------------ */
  function boot() {
    var dataEl = document.getElementById('wb-widget-data');
    if (!dataEl) return;
    var list;
    try { list = JSON.parse(dataEl.textContent); } catch (e) { return; }
    var roots = document.querySelectorAll('.wb-widget');
    for (var i = 0; i < roots.length; i++) {
      var idx = roots[i].getAttribute('data-w');
      if (list[idx] !== undefined) mount(roots[i], list[idx]);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
