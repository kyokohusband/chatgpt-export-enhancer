/* HTML → .docx（真正的 WordprocessingML + 自建 ZIP，不依赖第三方库）。
   输入是导出器产出的整页 HTML，所以 Word 里的内容和 HTML 版完全一致。 */
(function () {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  if (root.__CEX_DOCX__) return;

  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  const xml = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  // XML 1.0 不允许的控制字符，直接从文本里剔掉
  const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  /* ------------------------------------------------------------------ 样式 */

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:eastAsia="Microsoft YaHei" w:cs="Segoe UI"/>
      <w:sz w:val="21"/><w:szCs w:val="21"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr>
      <w:spacing w:after="120" w:line="288" w:lineRule="auto"/>
    </w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:before="0" w:after="160"/><w:keepNext/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Meta">
    <w:name w:val="Meta"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="40"/></w:pPr>
    <w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="687990"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Role">
    <w:name w:val="Role"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="200" w:after="80"/><w:keepNext/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="17"/><w:szCs w:val="17"/><w:spacing w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:before="280" w:after="120"/><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:before="240" w:after="100"/><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:before="200" w:after="80"/><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/><w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>
      <w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>
      <w:ind w:left="160" w:right="160"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei" w:cs="Consolas"/>
      <w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="1F2937"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/><w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C7D7F0"/></w:pBdr>
      <w:shd w:val="clear" w:color="auto" w:fill="F7F9FD"/>
      <w:ind w:left="240"/>
    </w:pPr>
    <w:rPr><w:color w:val="43536B"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="InlineCode">
    <w:name w:val="Inline Code"/>
    <w:rPr>
      <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>
      <w:sz w:val="19"/><w:szCs w:val="19"/>
      <w:shd w:val="clear" w:color="auto" w:fill="EEF2F8"/>
    </w:rPr>
  </w:style>
  <w:style w:type="table" w:styleId="PlainTable">
    <w:name w:val="Plain Table"/><w:tblPr>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="E0E7F0"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="E0E7F0"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="E0E7F0"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="E0E7F0"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E0E7F0"/>
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="E0E7F0"/>
      </w:tblBorders>
    </w:tblPr>
  </w:style>
</w:styles>`;

  /* ------------------------------------------------------------- OOXML 片段 */

  function run(text, fmt) {
    fmt = fmt || {};
    if (text == null || text === '') return '';
    const props = [];
    if (fmt.bold) props.push('<w:b/>');
    if (fmt.italic) props.push('<w:i/>');
    if (fmt.strike) props.push('<w:strike/>');
    if (fmt.code) props.push('<w:rStyle w:val="InlineCode"/>');
    if (fmt.color) props.push('<w:color w:val="' + fmt.color + '"/>');
    if (fmt.underline) props.push('<w:u w:val="single"/>');
    const p = props.length ? '<w:rPr>' + props.join('') + '</w:rPr>' : '';
    return '<w:r>' + p + '<w:t xml:space="preserve">' + xml(clean(text)) + '</w:t></w:r>';
  }

  function lineBreak() {
    return '<w:r><w:br/></w:r>';
  }

  function paragraph(inner, pPr) {
    return '<w:p>' + (pPr ? '<w:pPr>' + pPr + '</w:pPr>' : '') + (inner || '') + '</w:p>';
  }

  function ruleParagraph(color) {
    return paragraph(
      '',
      '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="' + (color || 'E0E7F0') + '"/></w:pBdr>' +
        '<w:spacing w:before="40" w:after="160" w:line="120" w:lineRule="auto"/>'
    );
  }

  /* --------------------------------------------------------------- 行内遍历 */

  let rels = [];

  function hyperlink(inner, href) {
    if (!inner || !href) return inner;
    const id = 'rIdLink' + (rels.length + 1);
    rels.push({ id, target: href });
    return '<w:hyperlink r:id="' + id + '" w:history="1">' + inner + '</w:hyperlink>';
  }

  function inlineRuns(node, fmt) {
    if (!node) return '';
    if (node.nodeType === 3) return run(node.nodeValue, fmt);
    if (node.nodeType !== 1) return '';

    const el = node;
    const tag = el.tagName;
    if (tag === 'BR') return lineBreak();
    if (tag === 'IMG') {
      const alt = el.getAttribute('alt') || '图片';
      return run('［图片：' + alt + '］', { color: '687990' });
    }
    if (tag === 'CODE' || tag === 'KBD') return run(el.textContent, Object.assign({}, fmt, { code: true }));

    const next = Object.assign({}, fmt);
    if (tag === 'STRONG' || tag === 'B') next.bold = true;
    if (tag === 'EM' || tag === 'I') next.italic = true;
    if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') next.strike = true;
    if (tag === 'A') {
      next.color = '2563EB';
      next.underline = true;
    }

    let inner = '';
    for (const child of el.childNodes) inner += inlineRuns(child, next);

    if (tag === 'A') {
      const href = el.getAttribute('href');
      if (href && !/^javascript:/i.test(href)) return hyperlink(inner, href);
    }
    return inner;
  }

  /* --------------------------------------------------------------- 块级遍历 */

  function indent(depth) {
    if (!depth) return '';
    return '<w:ind w:left="' + 420 * depth + '" w:hanging="240"/>';
  }

  function listXml(el, depth, quote) {
    const ordered = el.tagName === 'OL';
    let out = '';
    let n = 1;

    for (const li of [...el.children].filter((c) => c.tagName === 'LI')) {
      const inlineParts = [];
      const nested = [];
      for (const child of li.childNodes) {
        if (child.nodeType === 1 && ['UL', 'OL'].includes(child.tagName)) nested.push(child);
        else if (child.nodeType === 1 && ['P', 'PRE', 'TABLE', 'BLOCKQUOTE', 'DIV'].includes(child.tagName)) nested.push(child);
        else inlineParts.push(inlineRuns(child, {}));
      }

      const marker = ordered ? n++ + '. ' : '• ';
      const pPr = (quote ? '<w:pStyle w:val="Quote"/>' : '') + indent(depth + 1) + '<w:spacing w:after="40"/>';
      out += paragraph(run(marker, { bold: ordered }) + inlineParts.join(''), pPr);

      for (const node of nested) {
        if (node.tagName === 'UL' || node.tagName === 'OL') out += listXml(node, depth + 1, quote);
        else out += blocksOf(node, { depth: depth + 1, quote }).join('');
      }
    }
    return out;
  }

  function tableXml(table) {
    const rows = [...table.querySelectorAll('tr')];
    if (!rows.length) return '';

    let out =
      '<w:tbl><w:tblPr><w:tblStyle w:val="PlainTable"/><w:tblW w:w="0" w:type="auto"/>' +
      '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>' +
      '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>';

    for (const tr of rows) {
      const cells = [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
      if (!cells.length) continue;
      out += '<w:tr>';
      for (const cell of cells) {
        const head = cell.tagName === 'TH';
        const inner = inlineRuns(cell, head ? { bold: true } : {});
        out +=
          '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>' +
          (head ? '<w:shd w:val="clear" w:color="auto" w:fill="F3F6FB"/>' : '') +
          '</w:tcPr>' +
          paragraph(inner, '<w:spacing w:before="40" w:after="40"/>') +
          '</w:tc>';
      }
      out += '</w:tr>';
    }
    return out + '</w:tbl>' + paragraph('', '<w:spacing w:after="80" w:line="120" w:lineRule="auto"/>');
  }

  function codeXml(pre) {
    const codeEl = pre.querySelector('code') || pre;
    const text = String(codeEl.textContent || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
    const lines = text.split('\n');
    return lines
      .map((line) => paragraph(run(line || ' ', {}), '<w:pStyle w:val="Code"/>'))
      .join('');
  }

  function blocksOf(node, ctx) {
    ctx = ctx || {};
    const quote = !!ctx.quote;
    const depth = ctx.depth || 0;

    if (!node) return [];
    if (node.nodeType === 3) {
      const text = String(node.nodeValue || '').trim();
      return text ? [paragraph(run(text, quote ? { color: '43536B' } : {}), quote ? '<w:pStyle w:val="Quote"/>' : '')] : [];
    }
    if (node.nodeType !== 1) return [];

    const el = node;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'BUTTON') return [];

    switch (tag) {
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6': {
        const level = Math.min(Number(tag[1]), 4);
        const style = level <= 3 ? 'Heading' + level : 'Heading3';
        return [paragraph(inlineRuns(el, {}), '<w:pStyle w:val="' + style + '"/>')];
      }
      case 'P': {
        const inner = inlineRuns(el, {});
        if (!inner.trim()) return [];
        const pPr = quote
          ? '<w:pStyle w:val="Quote"/>'
          : (depth ? indent(depth) : '');
        return [paragraph(inner, pPr)];
      }
      case 'UL':
      case 'OL':
        return [listXml(el, depth, quote)];
      case 'PRE':
        return [codeXml(el)];
      case 'BLOCKQUOTE': {
        const inner = [];
        for (const child of el.childNodes) inner.push(...blocksOf(child, { quote: true, depth }));
        return inner.length ? inner : [];
      }
      case 'TABLE':
        return [tableXml(el)];
      case 'HR':
        return [ruleParagraph()];
      case 'IMG':
        return [paragraph(run('［图片：' + (el.getAttribute('alt') || '图片') + '］', { color: '687990' }))];
      case 'FIGURE': {
        const out = [];
        const img = el.querySelector('img');
        if (img) out.push(...blocksOf(img, ctx));
        const cap = el.querySelector('figcaption');
        if (cap) {
          out.push(paragraph(run(inlineRuns(cap, {}).replace(/<[^>]+>/g, ''), { italic: true, color: '687990' })));
        }
        return out;
      }
      case 'DETAILS': {
        const summary = el.querySelector('summary');
        const out = [];
        if (summary) out.push(paragraph(run(summary.textContent.trim(), { bold: true })));
        for (const child of el.children) if (child !== summary) out.push(...blocksOf(child, ctx));
        return out;
      }
      default: {
        const out = [];
        for (const child of el.childNodes) out.push(...blocksOf(child, ctx));
        return out;
      }
    }
  }

  /* ------------------------------------------------------------ document.xml */

  function documentXml(doc) {
    const out = [];

    const head = doc.querySelector('.doc-head');
    if (head) {
      const h1 = head.querySelector('h1');
      if (h1) out.push(paragraph(run(h1.textContent.trim(), {}), '<w:pStyle w:val="Title"/>'));
      head.querySelectorAll('.doc-meta').forEach((p) => {
        const text = p.textContent.trim();
        if (text) out.push(paragraph(run(text, {}), '<w:pStyle w:val="Meta"/>'));
      });
      out.push(ruleParagraph());
    }

    doc.querySelectorAll('article.turn').forEach((turn) => {
      const isUser = turn.classList.contains('user');
      const role = isUser ? '用户' : turn.classList.contains('system') ? '系统' : '助手';
      out.push(paragraph(run(role, {}), '<w:pStyle w:val="Role"/>'));

      for (const child of turn.childNodes) {
        if (child.nodeType === 1 && (child.classList.contains('role') || child.tagName === 'H5')) continue;
        out.push(...blocksOf(child));
      }
      out.push(ruleParagraph('E8EEF7'));
    });

    return out.join('');
  }

  const DOCUMENT_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>`;
  const DOCUMENT_TAIL = `<w:sectPr>
    <w:pgSz w:w="11906" w:h="16838"/>
    <w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="851" w:footer="992" w:gutter="0"/>
  </w:sectPr></w:body></w:document>`;

  const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  function documentRels() {
    const items = [
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    ];
    for (const rel of rels) {
      items.push(
        '<Relationship Id="' + rel.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' +
          xml(rel.target) + '" TargetMode="External"/>'
      );
    }
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      items.join('') +
      '</Relationships>'
    );
  }

  /* -------------------------------------------------------------------- ZIP */

  let crcTable = null;
  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  }

  function crc32(bytes) {
    if (!crcTable) crcTable = makeCrcTable();
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const buffer = await new Response(stream).arrayBuffer();
      return new Uint8Array(buffer);
    } catch (e) {
      return null;
    }
  }

  async function makeZip(entries) {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
      const packed = await deflateRaw(raw);
      const useDeflate = !!packed && packed.length < raw.length;
      const body = useDeflate ? packed : raw;
      const method = useDeflate ? 8 : 0;
      const crc = crc32(raw);

      const local = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // 文件名 UTF-8
      dv.setUint16(8, method, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0x21, true); // 1980-01-01
      dv.setUint32(14, crc, true);
      dv.setUint32(18, body.length, true);
      dv.setUint32(22, raw.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      parts.push(local, body);
      central.push({ nameBytes, crc, size: body.length, rawSize: raw.length, method, offset });
      offset += local.length + body.length;
    }

    const centralStart = offset;
    for (const item of central) {
      const header = new Uint8Array(46 + item.nameBytes.length);
      const dv = new DataView(header.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, item.method, true);
      dv.setUint16(12, 0, true);
      dv.setUint16(14, 0x21, true);
      dv.setUint32(16, item.crc, true);
      dv.setUint32(20, item.size, true);
      dv.setUint32(24, item.rawSize, true);
      dv.setUint16(28, item.nameBytes.length, true);
      dv.setUint16(30, 0, true);
      dv.setUint16(32, 0, true);
      dv.setUint16(34, 0, true);
      dv.setUint16(36, 0, true);
      dv.setUint32(38, 0, true);
      dv.setUint32(42, item.offset, true);
      header.set(item.nameBytes, 46);
      parts.push(header);
      offset += header.length;
    }

    const end = new Uint8Array(22);
    const dv = new DataView(end.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, central.length, true);
    dv.setUint16(10, central.length, true);
    dv.setUint32(12, offset - centralStart, true);
    dv.setUint32(16, centralStart, true);
    parts.push(end);

    return new Blob(parts, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  }

  /* ------------------------------------------------------------------- 出口 */

  async function build(html) {
    rels = [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = documentXml(doc);

    const entries = [
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: '_rels/.rels', data: ROOT_RELS },
      { name: 'word/document.xml', data: DOCUMENT_HEAD + body + DOCUMENT_TAIL },
      { name: 'word/styles.xml', data: STYLES },
      { name: 'word/_rels/document.xml.rels', data: documentRels() }
    ];
    return makeZip(entries);
  }

  root.__CEX_DOCX__ = { build };
})();
