/* DSL 词法工具：app/dslsyntax.py 的 JS 移植版。
   数「组件标签开合」时不能只靠正则——属性里的箭头函数 `onChange={v=>setTodo(...)}`
   含 `>`，会数错。这里逐字符扫描，与桌面端保持同一套规则。 */
(function () {
  const C = (window.__CEX__ = window.__CEX__ || {});
  if (C.dsl) return;

  const DSL_TAGS = new Set(
    (
      'box row col column grid grid-item list list-item table table-row table-cell text title caption divider badge icon ' +
      'pressable button radio-group radio checkbox input textarea select option date-picker slider label ' +
      'svg rect path circle line polyline polygon ellipse g defs'
    ).split(/\s+/)
  );

  // 能作为「组件开头」的标签：收窄，避免正文里零星出现的 icon/badge 被误判
  const START_TAGS = (
    'box row col column grid list table text title caption label pressable button ' +
    'checkbox input textarea select date-picker slider svg'
  ).split(/\s+/);

  const VOID_TAGS = new Set(['input', 'br', 'hr', 'img']);
  const NAME_CHAR = /[\w-]/;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 长名在前，避免 grid 抢先匹配 grid-item
  const TAGS_PATTERN = [...DSL_TAGS]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|');
  const OPEN_RE = new RegExp('<(?:' + TAGS_PATTERN + ')\\b');
  const START_RE = new RegExp(
    '^\\s*(?:<(?:' + START_TAGS.map(escapeRe).join('|') + ')\\b|\\{@body\\b|\\{#each\\b)'
  );

  /** 从属性区起点往后找真正的 '>'，跳过引号字符串和 `{...}` 里的 '>'。 */
  function tagEnd(text, from) {
    let i = from;
    let depth = 0;
    let quote = null;
    const n = text.length;
    while (i < n) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        if (depth) depth -= 1;
      } else if (ch === '>' && depth === 0) {
        return i;
      }
      i += 1;
    }
    return n;
  }

  function* iterTags(text) {
    let i = 0;
    const n = text.length;
    while (i < n) {
      const lt = text.indexOf('<', i);
      if (lt < 0) return;

      let j = lt + 1;
      if (text[j] === '/') {
        let k = j + 1;
        let name = '';
        while (k < n && NAME_CHAR.test(text[k])) {
          name += text[k];
          k += 1;
        }
        const gt = text.indexOf('>', k);
        const stop = gt >= 0 ? gt + 1 : n;
        const low = name.toLowerCase();
        if (DSL_TAGS.has(low)) yield { kind: 'close', name: low, start: lt, end: stop, selfClose: false };
        i = stop;
        continue;
      }

      if (j >= n || !/[A-Za-z]/.test(text[j])) {
        i = lt + 1;
        continue;
      }

      let k = j;
      let name = '';
      while (k < n && NAME_CHAR.test(text[k])) {
        name += text[k];
        k += 1;
      }
      const end = tagEnd(text, k);
      const low = name.toLowerCase();
      if (DSL_TAGS.has(low)) {
        yield {
          kind: 'open',
          name: low,
          start: lt,
          end: Math.min(end + 1, n),
          selfClose: text.slice(k, end).replace(/\s+$/, '').endsWith('/')
        };
      }
      i = end + 1;
    }
  }

  /** [开标签数, 闭标签数, 自闭合数]，自闭合不计入开标签 */
  function count(text) {
    let opens = 0;
    let closes = 0;
    let selfCloses = 0;
    for (const tok of iterTags(text)) {
      if (tok.kind === 'close') closes += 1;
      else if (tok.selfClose) selfCloses += 1;
      else opens += 1;
    }
    return [opens, closes, selfCloses];
  }

  /** 正数表示还有多少个标签没闭合 */
  function balance(text) {
    const [opens, closes] = count(text);
    return opens - closes;
  }

  function directiveBalance(text) {
    const opens = (text.match(/\{#(?:each|if)\b/g) || []).length;
    const closes = (text.match(/\{\/(?:each|if)\}/g) || []).length;
    return opens - closes;
  }

  function isBalanced(text) {
    return balance(text) === 0 && directiveBalance(text) === 0;
  }

  /** 组件尾部被截断时，需要补哪些闭合标签 / 结束指令（按逆序） */
  function closingTail(text) {
    const stack = [];
    for (const tok of iterTags(text)) {
      if (tok.kind === 'open') {
        if (!tok.selfClose && !VOID_TAGS.has(tok.name)) stack.push(tok.name);
      } else {
        const at = stack.lastIndexOf(tok.name);
        if (at >= 0) stack.splice(at, 1);
      }
    }

    const dirs = [];
    const re = /\{#(if|each)\b|\{\/(if|each)\}/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) {
        dirs.push(m[1]);
      } else {
        const at = dirs.lastIndexOf(m[2]);
        if (at >= 0) dirs.splice(at, 1);
      }
    }

    return (
      stack.reverse().map((t) => '</' + t + '>').join('') +
      dirs.reverse().map((d) => '{/' + d + '}').join('')
    );
  }

  /** 每个配平的 `{...}` 的 [左括号下标, 右括号下标+1)，跳过字符串里的括号 */
  function braceSpans(text) {
    const spans = [];
    let i = 0;
    const n = text.length;
    while (i < n) {
      if (text[i] !== '{') {
        i += 1;
        continue;
      }
      let depth = 0;
      let j = i;
      let quote = null;
      while (j < n) {
        const ch = text[j];
        if (quote) {
          if (ch === '\\') {
            j += 2;
            continue;
          }
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'" || ch === '`') {
          quote = ch;
        } else if (ch === '{') {
          depth += 1;
        } else if (ch === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
        j += 1;
      }
      const end = j < n ? j + 1 : n;
      spans.push([i, end]);
      i = end;
    }
    return spans;
  }

  /** 导出器把模板字符串里的反引号变成了 <code>，这里在 {...} 内还原回反引号 */
  function normalizeInlineTemplateCode(source) {
    if (!source.includes('<code>') && !source.includes('<em>')) return source;

    let out = '';
    let last = 0;
    for (const [start, end] of braceSpans(source)) {
      const span = source.slice(start, end);
      let fixed = span.split('<code>').join('`').split('</code>').join('`');
      if (span.startsWith('{#each')) {
        fixed = fixed.split('<em>').join('*').split('</em>').join('*');
      }
      if (fixed === span) continue;
      out += source.slice(last, start) + fixed;
      last = end;
    }
    if (!out) return source;
    return out + source.slice(last);
  }

  C.dsl = {
    DSL_TAGS,
    START_TAGS,
    VOID_TAGS,
    OPEN_RE,
    START_RE,
    iterTags,
    count,
    balance,
    directiveBalance,
    isBalanced,
    closingTail,
    braceSpans,
    normalizeInlineTemplateCode
  };
})();
