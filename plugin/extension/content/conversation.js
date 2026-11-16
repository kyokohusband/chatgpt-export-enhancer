/* ==========================================================================
 * 会话取数（走 ChatGPT 官方接口，而不是抓 DOM）
 *
 * 为什么必须走接口：ChatGPT 的代码块是**按视口懒渲染**的，长回答里没滚到的
 * 代码块在 DOM 里只剩一个语言标签，正文根本不存在。滚一遍也救不回来（虚拟
 * 滚动会让滚过去的部分重新卸载），于是导出的 HTML 里出现大量孤立的
 * <p>Python</p>，代码全丢。
 *
 * 接口返回的是**原始消息文本（Markdown）**，与页面滚没滚到无关，所以：
 *   · 代码块 100% 完整，语言标签也准确
 *   · 不用再滚动网页，导出更快
 *   · 能拿到每条消息的时间戳（真实导出里 .role 就带时间）
 *
 * 消息抽取规则与 GPT Master 2.51.0 一致：只保留 user / assistant 的可见消息，
 * 隐藏消息（is_visually_hidden_from_conversation）、系统提示、仅图片的占位都按
 * 同一套规则处理；连续的 assistant 片段会合并成一整轮。
 * ========================================================================== */

(function () {
  const C = (window.__CEX__ = window.__CEX__ || {});
  if (C.conversation) return;

  const HIDDEN_ROLES = { system: true, tool: true };

  const UNTITLED_DOC = 'Untitled document';
  const RECIPIENT_CREATE_DOC = 'canmore.create_textdoc';
  const RECIPIENT_UPDATE_DOC = 'canmore.update_textdoc';
  const EDITED_LATER = '_[edited later in canvas; edits not included]_';

  const HOSTS = ['chatgpt.com', 'chat.openai.com', 'www.chatgpt.com'];

  function isChatGpt() {
    return HOSTS.includes(location.hostname);
  }

  /** /c/<uuid> */
  function conversationId() {
    const m = /^\/c\/([0-9a-fA-F-]{8,})/.exec(location.pathname);
    return m ? m[1] : '';
  }

  /** /share/<id> */
  function shareId() {
    const m = /^\/share\/([0-9a-zA-Z-]{8,})/.exec(location.pathname);
    return m ? m[1] : '';
  }

  function supported() {
    return isChatGpt() && !!(conversationId() || shareId());
  }

  /* ------------------------------------------------------------------ 鉴权 */

  function tokenFromDom() {
    const probes = [
      /,"accessToken","([^"]+)"/,
      /["']accessToken["']\s*:\s*["']([^"']+)["']/,
      /accessToken\s*[=:]\s*["']([^"']+)["']/,
      /["']token["']\s*:\s*["']([^"']+)["']/,
      /Authorization["']\s*:\s*["']Bearer\s+([^"']+)["']/
    ];
    for (const script of Array.from(document.scripts || [])) {
      const text = script.textContent || '';
      if (!text || text.length > 4000000) continue;
      for (const re of probes) {
        const hit = text.match(re);
        if (hit && hit[1] && hit[1].length > 20) return hit[1];
      }
    }
    return '';
  }

  let cachedToken = '';
  let cachedAt = 0;

  async function accessToken(force) {
    if (!force && cachedToken && Date.now() - cachedAt < 60000) return cachedToken;
    try {
      const res = await fetch('/api/auth/session', {
        credentials: 'include',
        headers: { accept: 'application/json' }
      });
      if (res.ok) {
        const json = await res.json();
        if (json && typeof json.accessToken === 'string' && json.accessToken) {
          cachedToken = json.accessToken;
          cachedAt = Date.now();
          return cachedToken;
        }
      }
    } catch (e) {
      /* 落到 DOM 提取 */
    }
    const fromDom = tokenFromDom();
    if (fromDom) {
      cachedToken = fromDom;
      cachedAt = Date.now();
      return fromDom;
    }
    return '';
  }

  /* ------------------------------------------------------------------ 取数 */

  function describeStatus(status) {
    if (status === 401) return '未登录或登录已过期，请先在页面上登录';
    if (status === 403) return '接口拒绝访问（403），可能需要刷新页面';
    if (status === 404) return '会话不存在或无权访问（404）';
    if (status === 429) return '请求太频繁（429），稍后再试';
    return '接口返回 ' + status;
  }

  async function getJson(url, headers) {
    // 分享页是公开接口：带 Authorization 反而会被判 403（实测 2026-11），所以先不带
    const isPublic = /\/backend-api\/share\//.test(url);
    const token = isPublic ? '' : await accessToken();

    const send = async (auth) =>
      fetch(url, {
        credentials: 'include',
        headers: Object.assign({ accept: '*/*' }, auth ? { authorization: 'Bearer ' + auth } : {}, headers || {})
      });

    let res = await send(token);

    if (!res.ok && (res.status === 401 || res.status === 403)) {
      if (token) {
        // 1) token 过期：刷新后重试
        const fresh = await accessToken(true);
        if (fresh && fresh !== token) res = await send(fresh);
        // 2) 有些会话靠 Cookie 就能读：去掉 Authorization 再试一次
        if (!res.ok && (res.status === 401 || res.status === 403)) res = await send('');
      }
    }
    if (!res.ok) throw new Error(describeStatus(res.status));

    const text = await res.text();
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('接口返回了网页而不是数据，可能登录已失效');
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('接口返回内容无法解析');
    }
  }

  /* -------------------------------------------------------------- 消息抽取 */

  const isHiddenMessage = (msg) => {
    const meta = msg.metadata || {};
    return meta.is_visually_hidden_from_conversation === true || meta.is_user_system_message === true;
  };

  /** 普通文本消息：作者是 user/assistant、没有特殊收件人、内容是文本 */
  function isPlainTextMessage(msg) {
    const role = msg.author && msg.author.role;
    if (role !== 'user' && role !== 'assistant') return false;
    const recipient = msg.recipient;
    if (recipient != null && recipient !== 'all') return false;
    const type = msg.content && msg.content.content_type;
    return type === 'text' || type === 'multimodal_text';
  }

  function partText(part) {
    if (typeof part === 'string') return part.trim();
    if (!part || typeof part !== 'object') return '';
    if (part.content_type === 'image_asset_pointer' || part.image_url ||
        (/image/i.test(part.content_type || '') && (part.url || part.asset_pointer))) {
      return '> ⚠️ 此处图片未导出，请到原会话查看。';
    }
    if (typeof part.text === 'string') return part.text.trim();
    return '';
  }

  function partsText(parts) {
    if (!Array.isArray(parts)) return [];
    return parts.map(partText).filter((t) => t.length > 0);
  }

  function attachmentsOf(msg) {
    const list = msg && msg.metadata && msg.metadata.attachments;
    return Array.isArray(list) ? list.filter((a) => !!a && typeof a === 'object') : [];
  }

  function imageRefsOf(msg) {
    const refs = [];
    const seen = new Set();
    const parts = msg && msg.content && msg.content.parts;
    let anchor = '';
    const add = (part) => {
      if (!part || typeof part !== 'object') return;
      const type = String(part.content_type || part.type || '').toLowerCase();
      const pointer = typeof part.asset_pointer === 'string' ? part.asset_pointer : '';
      const direct = [part.image_url && part.image_url.url, part.image_url, part.url, part.src, part.download_url]
        .find((value) => typeof value === 'string' && /^(https?:\/\/|data:image\/)/i.test(value)) || '';
      if (!pointer && !direct) return;
      if (!/image|photo|picture|thumbnail/.test(type) && !pointer && !part.image_url &&
          !(part.mime_type || '').startsWith('image/')) return;
      const key = pointer || direct;
      if (seen.has(key)) return;
      seen.add(key);
      refs.push({ src: direct, pointer, alt: part.alt || part.name || '', anchor });
    };
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (typeof part === 'string') {
          const lines = part.trim().split(/\n\s*\n/);
          anchor = (lines[lines.length - 1] || '').replace(/[#*_`<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
        } else {
          add(part);
          if (part && typeof part.text === 'string') anchor = part.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        }
      }
    }
    for (const attachment of attachmentsOf(msg)) {
      if (!attachment || !((attachment.mime_type || '').startsWith('image/') ||
        (attachment.width && attachment.height))) continue;
      add(Object.assign({ content_type: 'image_asset_pointer', asset_pointer: attachment.asset_pointer ||
        (attachment.id ? 'file-service://' + attachment.id : '') }, attachment));
    }
    return refs;
  }

  function attachmentLabels(attachments) {
    return attachments
      .map((a) => a.name)
      .filter((n) => typeof n === 'string' && n.length > 0)
      .map((n) => '_[' + 'attachment: ' + n + ']_');
  }

  function longestRun(text, ch) {
    let best = 0;
    let cur = 0;
    for (const c of text) {
      cur = c === ch ? cur + 1 : 0;
      if (cur > best) best = cur;
    }
    return best;
  }

  /** 画布（canmore）里的文档：以标题 + 代码块的形式保留下来 */
  function canvasDoc(msg) {
    const raw =
      typeof (msg.content && msg.content.text) === 'string'
        ? msg.content.text
        : msg.content && msg.content.parts && msg.content.parts[0];
    if (typeof raw !== 'string') return null;

    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!doc || typeof doc.content !== 'string' || !doc.content.trim()) return null;

    const name = (typeof doc.name === 'string' ? doc.name : '').replace(/\s+/g, ' ').trim() || UNTITLED_DOC;
    const type = typeof doc.type === 'string' ? doc.type : '';
    if (!type.startsWith('code')) return '### ' + name + '\n\n' + doc.content.trim();

    const lang = (type.split('/')[1] || '').replace(/[^\w+#.-]/g, '');
    const fence = '`'.repeat(Math.max(3, longestRun(doc.content, '`') + 1));
    return '### ' + name + '\n\n' + fence + lang + '\n' + doc.content.replace(/\n+$/, '') + '\n' + fence;
  }

  function validTime(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds)) return null;
    if (Math.abs(seconds * 1000) > 864e13) return null;
    return seconds;
  }

  function messageToTurn(msg) {
    if (!msg || isHiddenMessage(msg)) return null;

    const role = msg.author && msg.author.role;
    const images = imageRefsOf(msg);
    let pieces = [];
    let commentary = false;

    if (role === 'tool') {
      pieces = [];
    } else if (role === 'assistant' && msg.recipient === RECIPIENT_CREATE_DOC) {
      const doc = canvasDoc(msg);
      pieces = doc ? [doc] : [];
    } else if (isPlainTextMessage(msg)) {
      const attachments = attachmentsOf(msg);
      pieces = [...attachmentLabels(attachments), ...partsText(msg.content && msg.content.parts)];
      commentary = role === 'assistant' && msg.channel === 'commentary';
    } else if (!images.length) {
      return null;
    }

    if (images.length && !pieces.some((piece) => piece.includes('此处图片未导出'))) {
      pieces.push('> ⚠️ 此处图片未导出，请到原会话查看。');
    }

    if (HIDDEN_ROLES[role] && !pieces.length && !images.length) return null;
    if (!pieces.length && !images.length) return null;

    return {
      role: role === 'user' ? 'user' : 'assistant',
      text: pieces.join('\n\n'),
      images,
      createdAt: validTime(msg.create_time),
      commentary
    };
  }

  /** 连续的 assistant 片段合并成一整轮（工具调用、画布多次写入都会切成多段） */
  function mergeTurns(turns) {
    const out = [];
    let buffer = [];

    const flush = () => {
      if (!buffer.length) return;
      const kept = buffer.filter((t) => !t.commentary);
      const picked = kept.length ? kept : buffer;
      out.push({
        role: 'assistant',
        text: picked.map((t) => t.text).join('\n\n'),
        images: picked.flatMap((t) => t.images || []),
        createdAt: (picked.find((t) => t.createdAt !== null) || {}).createdAt || null
      });
      buffer = [];
    };

    for (const turn of turns) {
      if (turn.role === 'assistant') {
        buffer.push(turn);
        continue;
      }
      flush();
      out.push({ role: turn.role, text: turn.text, images: turn.images || [], createdAt: turn.createdAt });
    }
    flush();
    return out;
  }

  /** 从 current_node 顺着 parent 往回收，得到当前分支的完整消息链 */
  function extract(data) {
    if (!data || typeof data !== 'object') return { title: '', messages: [], truncated: true };

    const mapping = data.mapping || {};
    const chain = [];
    const seen = new Set();
    let truncated = false;
    let nodeId = data.current_node || null;
    let canvasEdited = false;

    while (nodeId) {
      if (seen.has(nodeId)) {
        truncated = true;
        break;
      }
      seen.add(nodeId);
      const node = mapping[nodeId];
      if (!node) {
        truncated = true;
        break;
      }
      const msg = node.message;
      if (msg && msg.author && msg.author.role === 'assistant' && msg.recipient === RECIPIENT_UPDATE_DOC) canvasEdited = true;

      const turn = messageToTurn(msg);
      if (canvasEdited && msg && msg.recipient === RECIPIENT_CREATE_DOC && turn) {
        turn.text = turn.text + '\n\n' + EDITED_LATER;
        canvasEdited = false;
      }
      if (turn) chain.push(turn);
      nodeId = node.parent || null;
    }

    chain.reverse();
    return {
      title: (data.title || '').trim(),
      messages: mergeTurns(chain),
      truncated
    };
  }

  function mediaShape(data) {
    const contentTypes = {};
    const partTypes = {};
    const mediaPaths = new Set();
    let nodes = 0;
    function walk(value, path, depth) {
      if (!value || typeof value !== 'object' || depth > 4 || mediaPaths.size >= 30) return;
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 12)) walk(item, path + '[]', depth + 1);
        return;
      }
      for (const key of Object.keys(value)) {
        const next = path ? path + '.' + key : key;
        if (/(image|asset|thumbnail|file|download|visual|media)/i.test(key)) mediaPaths.add(next);
        walk(value[key], next, depth + 1);
      }
    }
    for (const node of Object.values((data && data.mapping) || {})) {
      const msg = node && node.message;
      if (!msg) continue;
      nodes++;
      const content = msg.content || {};
      const type = String(content.content_type || 'unknown');
      contentTypes[type] = (contentTypes[type] || 0) + 1;
      for (const part of Array.isArray(content.parts) ? content.parts : []) {
        const partType = typeof part === 'string' ? 'string' : String((part && part.content_type) || 'object');
        partTypes[partType] = (partTypes[partType] || 0) + 1;
        if (part && typeof part === 'object') walk(part, 'part', 0);
      }
      walk(msg.metadata, 'metadata', 0);
    }
    return { nodes, contentTypes, partTypes, mediaPaths: [...mediaPaths] };
  }

  /* ---------------------------------------------------------------- 对外接口 */

  async function fetchConversation(options) {
    const opts = options || {};
    const id = conversationId();

    let data;
    if (id) {
      data = await getJson('/backend-api/conversation/' + encodeURIComponent(id), opts.headers);
    } else {
      const share = shareId();
      if (!share) throw new Error('当前页面不是对话页');
      const raw = await getJson('/backend-api/share/' + encodeURIComponent(share), opts.headers);
      // 分享接口有两种外层：{...conversation} 或 {data: {...conversation}}
      data = raw && raw.mapping ? raw : raw && raw.data && raw.data.mapping ? raw.data : raw;
    }

    const parsed = extract(data);
    if (!parsed.messages.length) throw new Error('接口里没有可导出的消息');
    return {
      title: parsed.title || (document.title || '').replace(/\s*[-|]\s*ChatGPT\s*$/, '').trim(),
      messages: parsed.messages,
      mediaShape: mediaShape(data),
      truncated: parsed.truncated,
      url: location.href,
      source: 'api'
    };
  }

  C.conversation = {
    supported,
    conversationId,
    shareId,
    fetch: fetchConversation,
    extract,
    accessToken
  };
})();
