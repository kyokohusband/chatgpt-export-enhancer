/* 站点适配器：从页面 DOM 里找出「一条消息」= { el, role, content }。
   适配器只负责定位，不负责序列化。 */
(function () {
  const C = (window.__CEX__ = window.__CEX__ || {});
  if (C.adapters) return;
  const S = window.__CEX_SHARED__;

  function textLen(el) {
    if (!el) return 0;
    const t = el.innerText || el.textContent || '';
    return t.replace(/\s+/g, ' ').trim().length;
  }

  function byDomOrder(a, b) {
    if (a.el === b.el) return 0;
    const pos = a.el.compareDocumentPosition(b.el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  function cleanTitle(raw, siteName) {
    let t = String(raw || '').replace(/\s+/g, ' ').trim();
    for (const suffix of ['ChatGPT', 'Claude', 'Gemini', 'DeepSeek', 'Kimi', '豆包', 'Copilot', 'Qwen', 'Grok']) {
      const rx = new RegExp('\\s*[|\\-–—·]\\s*' + suffix + '\\s*$', 'i');
      t = t.replace(rx, '');
    }
    if (!t) return '';
    if (siteName && t.toLowerCase() === String(siteName).toLowerCase()) return '';
    return t;
  }

  function guessRole(el) {
    const probe = [
      el.getAttribute('data-message-author-role'),
      el.getAttribute('data-role'),
      el.getAttribute('data-author'),
      el.getAttribute('data-sender'),
      el.getAttribute('data-testid'),
      el.getAttribute('aria-label'),
      typeof el.className === 'string' ? el.className : ''
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (/(^|[\s_-])(user|human|me|query|question|prompt)([\s_-]|$)/.test(probe)) return 'user';
    if (/(^|[\s_-])(assistant|bot|ai|model|agent|answer|response|gpt|claude|gemini)([\s_-]|$)/.test(probe)) {
      return 'assistant';
    }
    return '';
  }

  function findScroller(el) {
    let node = el && el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const st = getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 40) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function finalize(items) {
    const list = (items || []).filter(
      (it) => it && it.el && it.el.isConnected && it.content && textLen(it.content) > 0
    );
    list.sort(byDomOrder);

    const seen = new Set();
    const unique = [];
    for (const it of list) {
      if (seen.has(it.content)) continue;
      seen.add(it.content);
      unique.push(it);
    }

    // 外层容器把内层内容整个包住时，保留内层（更精确，不带按钮/附件区）
    return unique.filter((it) => {
      for (const other of unique) {
        if (other === it || other.role !== it.role) continue;
        if (it.content.contains(other.content) && textLen(other.content) >= textLen(it.content) * 0.85) {
          return false;
        }
      }
      return true;
    });
  }

  function q(root, selectors) {
    for (const sel of selectors) {
      try {
        const found = root.querySelector(sel);
        if (found) return found;
      } catch (e) {
        /* 选择器不合法时跳过 */
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- ChatGPT */

  const chatgpt = {
    id: 'chatgpt',
    name: 'ChatGPT',
    hosts: ['chatgpt.com', 'chatgpt.livekit.cloud', 'chat.openai.com'],
    title() {
      return cleanTitle(document.title, 'ChatGPT');
    },
    model() {
      const el = q(document, [
        '[data-testid="model-switcher"]',
        'button[aria-label*="模型"]',
        'button[aria-label*="Model"]',
        '[data-testid="model-switcher-dropdown"]'
      ]);
      return el ? cleanTitle(el.innerText || el.textContent, '') : '';
    },
    turns() {
      let nodes = [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
      if (!nodes.length) nodes = [...document.querySelectorAll('div[data-testid^="conversation-turn-"]')];

      const pairs = [];
      if (nodes.length) {
        for (const el of nodes) {
          const holder = el.querySelector('[data-message-author-role]');
          if (holder) pairs.push({ el, holder });
        }
      } else {
        // 分享页 / 结构改版：没有 conversation-turn 包裹，直接按消息角色找
        for (const holder of document.querySelectorAll('[data-message-author-role]')) {
          const el =
            holder.closest('article[data-testid^="conversation-turn-"]') ||
            holder.closest('div[data-testid^="conversation-turn-"]') ||
            holder;
          pairs.push({ el, holder });
        }
      }

      const out = [];
      for (const { el, holder } of pairs) {
        const raw = holder.getAttribute('data-message-author-role');
        // tool / system 之类不是对话轮次，跳过
        if (raw !== 'user' && raw !== 'assistant') continue;
        const role = raw;
        const content =
          role === 'user'
            ? q(holder, ['.whitespace-pre-wrap', '[data-message-author-role="user"] > div'])
            : q(holder, ['.markdown', 'div[class*="markdown"]']);
        out.push({ el, role, content: content || holder });
      }
      return out;
    }
  };

  /* ----------------------------------------------------------------- Claude */

  const claude = {
    id: 'claude',
    name: 'Claude',
    hosts: ['claude.ai'],
    title() {
      return cleanTitle(document.title, 'Claude');
    },
    model() {
      const el = q(document, ['[data-testid="model-selector"]', 'button[aria-haspopup="menu"]']);
      return el ? cleanTitle(el.innerText || el.textContent, '') : '';
    },
    turns() {
      const out = [];
      document.querySelectorAll('[data-testid="user-message"]').forEach((el) => {
        out.push({ el, role: 'user', content: q(el, ['.whitespace-pre-wrap', '.font-user-message']) || el });
      });
      document.querySelectorAll('div.font-claude-message, [data-testid="assistant-message"], [data-is-streaming]').forEach((el) => {
        out.push({ el, role: 'assistant', content: el.querySelector('.font-claude-message') || el });
      });
      return out;
    }
  };

  /* ----------------------------------------------------------------- Gemini */

  const gemini = {
    id: 'gemini',
    name: 'Gemini',
    hosts: ['gemini.google.com', 'aistudio.google.com'],
    title() {
      return cleanTitle(document.title, 'Gemini');
    },
    model() {
      const el = q(document, ['[data-test-id="model-selector"]', '.model-selector']);
      return el ? cleanTitle(el.innerText || el.textContent, '') : '';
    },
    turns() {
      const out = [];
      document.querySelectorAll('user-query').forEach((el) => {
        out.push({ el, role: 'user', content: q(el, ['.query-text', '.query-content', 'div']) || el });
      });
      document.querySelectorAll('model-response').forEach((el) => {
        out.push({ el, role: 'assistant', content: q(el, ['message-content', '.markdown', 'div']) || el });
      });
      return out;
    }
  };

  /* ------------------------------------------------------- 通用启发式兜底 */

  function heuristicTurns() {
    const candidates = document.querySelectorAll('div, section, main, ul, ol');
    let best = null;

    for (const el of candidates) {
      const kids = el.children;
      if (kids.length < 2 || kids.length > 300) continue;
      let usable = 0;
      let blocky = 0;
      let total = 0;
      for (const k of kids) {
        const len = textLen(k);
        if (len < 8) continue;
        usable++;
        total += len;
        if (k.querySelector('p, pre, li, h1, h2, h3, h4, table, blockquote')) blocky++;
      }
      if (usable < 2) continue;
      if (usable / kids.length < 0.5) continue;
      if (blocky / usable < 0.5) continue;
      if (total / usable < 40) continue;

      const score = usable * 10 + Math.min(total / 300, 30);
      if (!best || score > best.score) best = { el, score };
    }

    if (!best) return [];

    const kids = [...best.el.children].filter((k) => textLen(k) >= 4);
    const items = kids.map((el) => ({ el, role: guessRole(el), content: el }));
    const unknown = items.filter((it) => !it.role).length;
    if (unknown / Math.max(items.length, 1) > 0.4) {
      items.forEach((it, i) => {
        if (!it.role) it.role = i % 2 === 0 ? 'user' : 'assistant';
      });
    } else {
      items.forEach((it) => {
        if (!it.role) it.role = 'assistant';
      });
    }
    return items;
  }

  const generic = {
    id: 'generic',
    name: '通用模式',
    hosts: [],
    title() {
      return cleanTitle(document.title, '');
    },
    model() {
      return '';
    },
    turns: heuristicTurns
  };

  const BUILTIN = [chatgpt, claude, gemini];

  function buildCustomAdapter(cfg) {
    const userSel = String(cfg.user || '').trim();
    const aiSel = String(cfg.assistant || '').trim();
    const contentSel = String(cfg.content || '').trim();
    return {
      id: 'custom:' + (cfg.name || userSel || 'site'),
      name: cfg.name || '自定义站点',
      hosts: cfg.hosts || [],
      title() {
        const t = cfg.title ? q(document, [cfg.title]) : null;
        return cleanTitle(t ? t.innerText || t.textContent : document.title, cfg.name || '');
      },
      model() {
        return '';
      },
      turns() {
        const out = [];
        const pick = (el) => (contentSel ? q(el, [contentSel]) || el : el);
        if (userSel) {
          document.querySelectorAll(userSel).forEach((el) => out.push({ el, role: 'user', content: pick(el) }));
        }
        if (aiSel) {
          document.querySelectorAll(aiSel).forEach((el) => out.push({ el, role: 'assistant', content: pick(el) }));
        }
        return out;
      }
    };
  }

  function pickAdapter(customAdapters) {
    const host = location.hostname;
    for (const cfg of customAdapters || []) {
      if (cfg && (cfg.hosts || []).length && S.matchHost(host, cfg.hosts)) {
        const built = buildCustomAdapter(cfg);
        if (built.turns().length) return built;
      }
    }
    for (const a of BUILTIN) {
      if (S.matchHost(host, a.hosts)) {
        const adapter = Object.assign({}, a);
        // 站点改版时留一条退路：内置选择器失效就用通用启发式
        const original = a.turns.bind(a);
        adapter.turns = () => {
          const found = original();
          return found.length ? found : heuristicTurns();
        };
        return adapter;
      }
    }
    return generic;
  }

  C.adapters = {
    pickAdapter,
    heuristicTurns,
    finalize,
    findScroller,
    textLen,
    cleanTitle,
    BUILTIN
  };
})();
