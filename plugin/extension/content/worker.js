/* 内容脚本：注入 iframe 面板，负责「读页面」和「导出」，文件与剪贴板交给面板处理。 */
(function () {
  if (!window.__CEX_SHARED__.isChatGptUrl(location.href)) return;
  if (window.__CEX_WORKER__) return;
  window.__CEX_WORKER__ = true;

  const C = window.__CEX__;
  const S = window.__CEX_SHARED__;
  const A = C.adapters;
  const SZ = C.serialize;

  const COLLAPSED = 72;
  const EXPANDED_W = 384;
  const EXPANDED_H = 584;
  const BUBBLE_MARGIN = 18;
  const BUBBLE_POSITION_KEY = 'cex.bubblePosition.v1';

  const state = {
    frame: null,
    expanded: false,
    bubblePosition: { x: 1, y: 1 },
    bubbleDrag: null,
    settings: S.DEFAULTS,
    adapter: null,
    messages: [],
    busy: false,
    api: null,        // 接口拿到的会话（原始 Markdown），有它就不依赖 DOM
    apiTitle: '',
    apiError: '',
    source: 'dom',    // 'api' | 'dom'，面板上会显示
    url: location.href // SPA 导航检测：URL 变了就意味着换了会话
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 已经完整翻过历史的会话 URL，避免每次打开面板都重滚一遍
  const loadedUrls = new Set();

  /* ------------------------------------------------------------- iframe 框架 */

  function bubbleCoord(fraction, limit) {
    const room = Math.max(0, limit - COLLAPSED - BUBBLE_MARGIN * 2);
    return BUBBLE_MARGIN + Math.round(room * Math.max(0, Math.min(1, fraction)));
  }

  function clampPosition(value, limit, size) {
    return Math.max(BUBBLE_MARGIN, Math.min(Math.max(BUBBLE_MARGIN, limit - size - BUBBLE_MARGIN), value));
  }

  function applySize() {
    const frame = state.frame;
    if (!frame || state.bubbleDrag) return;
    const width = state.expanded ? Math.min(EXPANDED_W, Math.max(1, window.innerWidth - BUBBLE_MARGIN * 2)) : COLLAPSED;
    const height = state.expanded ? Math.min(EXPANDED_H, Math.max(1, window.innerHeight - BUBBLE_MARGIN * 2)) : COLLAPSED;
    const left = bubbleCoord(state.bubblePosition.x, window.innerWidth);
    const top = bubbleCoord(state.bubblePosition.y, window.innerHeight);
    frame.style.width = width + 'px';
    frame.style.height = height + 'px';
    frame.style.left = (state.expanded ? clampPosition(left + (COLLAPSED - width) / 2, window.innerWidth, width) : left) + 'px';
    frame.style.top = (state.expanded ? clampPosition(top + (COLLAPSED - height) / 2, window.innerHeight, height) : top) + 'px';
    frame.style.right = 'auto';
    frame.style.bottom = 'auto';
  }

  function finishBubbleDrag(event, cancelled) {
    const drag = state.bubbleDrag;
    if (!drag) return;
    state.bubbleDrag = null;
    window.removeEventListener('pointermove', moveBubble, true);
    window.removeEventListener('pointerup', endBubble, true);
    window.removeEventListener('pointercancel', cancelBubble, true);
    window.removeEventListener('blur', cancelBubble, true);
    const frame = state.frame;
    if (frame) {
      frame.style.pointerEvents = 'auto';
      frame.style.transition = 'width .18s ease, height .18s ease, left .18s ease, right .18s ease, top .18s ease';
    }
    if (cancelled) { applySize(); return; }
    if (!drag.moved) { setExpanded(true); return; }
    const roomX = Math.max(1, window.innerWidth - COLLAPSED - BUBBLE_MARGIN * 2);
    const roomY = Math.max(1, window.innerHeight - COLLAPSED - BUBBLE_MARGIN * 2);
    state.bubblePosition = {
      x: Math.max(0, Math.min(1, (drag.left - BUBBLE_MARGIN) / roomX)),
      y: Math.max(0, Math.min(1, (drag.top - BUBBLE_MARGIN) / roomY))
    };
    applySize();
    chrome.storage.local.set({ [BUBBLE_POSITION_KEY]: state.bubblePosition }).catch(() => {});
  }

  function moveBubble(event) {
    const drag = state.bubbleDrag;
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) drag.moved = true;
    if (!drag.moved) return;
    event.preventDefault();
    drag.left = clampPosition(event.clientX - drag.offsetX, window.innerWidth, COLLAPSED);
    drag.top = clampPosition(event.clientY - drag.offsetY, window.innerHeight, COLLAPSED);
    state.frame.style.left = drag.left + 'px';
    state.frame.style.right = 'auto';
    state.frame.style.top = drag.top + 'px';
    state.frame.style.bottom = 'auto';
  }

  function endBubble(event) { finishBubbleDrag(event, false); }
  function cancelBubble(event) { finishBubbleDrag(event, true); }

  function startBubbleDrag(payload) {
    if (state.expanded || state.bubbleDrag || !state.frame) return;
    const rect = state.frame.getBoundingClientRect();
    const x = Number(payload && payload.x);
    const y = Number(payload && payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    state.bubbleDrag = {
      startX: rect.left + x, startY: rect.top + y,
      offsetX: x, offsetY: y, left: rect.left, top: rect.top, moved: false
    };
    state.frame.style.transition = 'none';
    state.frame.style.pointerEvents = 'none';
    window.addEventListener('pointermove', moveBubble, true);
    window.addEventListener('pointerup', endBubble, true);
    window.addEventListener('pointercancel', cancelBubble, true);
    window.addEventListener('blur', cancelBubble, true);
  }

  chrome.storage.local.get(BUBBLE_POSITION_KEY).then((saved) => {
    const value = saved && saved[BUBBLE_POSITION_KEY];
    if (!value || !Number.isFinite(value.y)) return;
    const x = Number.isFinite(value.x) ? value.x : value.side === 'left' ? 0 : value.side === 'right' ? 1 : NaN;
    if (!Number.isFinite(x)) return;
    state.bubblePosition = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, value.y)) };
    applySize();
  }).catch(() => {});

  function ensureFrame() {
    if (state.frame && state.frame.isConnected) return state.frame;

    const frame = document.createElement('iframe');
    frame.id = '__cex_frame__';
    frame.title = '会话导出增强器';
    frame.setAttribute('allow', 'clipboard-write; clipboard-read');
    frame.setAttribute('aria-label', '会话导出增强器面板');

    const st = frame.style;
    st.position = 'fixed';
    st.right = BUBBLE_MARGIN + 'px';
    st.bottom = BUBBLE_MARGIN + 'px';
    st.width = COLLAPSED + 'px';
    st.height = COLLAPSED + 'px';
    st.border = '0';
    st.margin = '0';
    st.padding = '0';
    st.background = 'transparent';
    st.zIndex = '2147483600';
    st.colorScheme = 'light';
    st.overflow = 'hidden';
    st.borderRadius = '18px';
    st.transition = 'width .18s ease, height .18s ease';

    frame.src = chrome.runtime.getURL('panel/panel.html');
    (document.documentElement || document.body).appendChild(frame);
    state.frame = frame;
    applySize();
    return frame;
  }

  function setExpanded(value) {
    if (value && state.bubbleDrag) finishBubbleDrag(null, true);
    state.expanded = !!value;
    ensureFrame();
    applySize();
    // 从弹窗/快捷键触发时，面板自己并不知道要展开，这里同步一次
    postToPanel('ui', { expanded: state.expanded });
    if (state.expanded) warmPython();
    return state.expanded;
  }

  function postToPanel(type, data) {
    if (!state.frame || !state.frame.contentWindow) return;
    state.frame.contentWindow.postMessage({ __cex: 1, dir: 'to-panel', type, data }, '*');
  }

  window.addEventListener('resize', applySize);

  /* ------------------------------------------------------------------ 采集 */

  function currentTitle(messages = state.messages) {
    const answerTitle = C.exporters.answerTitle(messages);
    if (answerTitle) return answerTitle;
    if (state.apiTitle) return state.apiTitle;
    const adapter = state.adapter;
    let title = adapter && adapter.title ? adapter.title() : '';
    if (!title) {
      const t = (document.title || '').replace(/\s+/g, ' ').trim();
      if (t && !/^(chatgpt|claude|gemini|deepseek|kimi|新聊天|new chat)$/i.test(t)) title = t;
    }
    if (!title) {
      const firstUser = state.messages.find((m) => m.role === 'user');
      if (firstUser) title = firstUser.preview.replace(/…$/, '').slice(0, 30);
    }
    return title || '未命名会话';
  }

  // 消息 id 必须跟元素绑定：往上翻出更早的消息后，序号会变，但 id 不能变
  const elIds = new WeakMap();
  let idSeq = 0;
  function stableId(el) {
    let id = elIds.get(el);
    if (!id) {
      id = 'm' + ++idSeq;
      elIds.set(el, id);
    }
    return id;
  }

  /** 只看页面 DOM：站点适配器 + 稳定 id（面板「跳到消息」用得到） */
  function collectFromDom() {
    const custom = (state.settings && state.settings.customAdapters) || [];
    const adapter = A.pickAdapter(custom);
    state.adapter = adapter;

    const found = A.finalize(adapter.turns());
    const messages = [];
    found.forEach((it) => {
      const role = it.role === 'user' ? 'user' : it.role === 'system' ? 'system' : 'assistant';
      const preview = SZ.preview(it.content, 110);
      if (!preview) return;
      messages.push({
        id: stableId(it.el),
        index: messages.length + 1,
        role,
        el: it.el,
        content: it.content,
        chars: (it.content.innerText || '').length,
        preview
      });
    });
    return messages;
  }

  /** 从 Markdown 抽一句摘要，给面板列表用 */
  function mdPreview(md, limit) {
    const text = String(md || '')
      .replace(/```[\s\S]*?```/g, ' [代码块] ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*([-*+]|\d{1,9}[.)])\s+/gm, '')
      .replace(/`{1,3}/g, '')
      .replace(/[*_~]{1,3}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > limit ? text.slice(0, limit) + '…' : text;
  }

  /* 消息来源：能走接口就走接口（原始 Markdown，代码块不会丢），否则退回 DOM。
   * 接口那份是权威列表，DOM 只用来补「跳到页面对应位置」的元素引用。 */
  function collect() {
    const domMessages = collectFromDom();
    const api = state.api;

    if (api && api.messages && api.messages.length) {
      const messages = api.messages.map((m, i) => {
        const dom = domMessages[i];
        const same = dom && dom.role === m.role;
        return {
          id: 'a' + (i + 1),
          index: i + 1,
          role: m.role,
          md: m.text,
          createdAt: m.createdAt,
          el: same ? dom.el : null,
          content: same ? dom.content : null,
          omittedImages: (m.images || []).length,
          chars: (m.text || '').length,
          preview: mdPreview(m.text, 110)
        };
      });
      state.messages = messages;
      state.source = 'api';
      return messages;
    }

    state.messages = domMessages;
    state.source = 'dom';
    return domMessages;
  }

  /** 从接口拉一次会话；失败不抛，把原因记下来给面板显示 */
  let apiRequest = null;
  async function loadFromApi() {
    if (!C.conversation || !C.conversation.supported()) return null;
    const url = location.href;
    if (apiRequest && apiRequest.url === url) return apiRequest.promise;
    const request = { url };
    request.promise = (async () => {
      try {
        const data = await C.conversation.fetch();
        if (location.href !== url || apiRequest !== request) return null;
        state.api = data;
        state.apiError = '';
        state.apiTitle = (data && data.title) || '';
        return data;
      } catch (err) {
        if (location.href !== url || apiRequest !== request) return null;
        state.api = null;
        state.apiTitle = '';
        state.apiError = (err && err.message) || String(err);
        console.warn('[导出增强器] 接口取数失败，改用页面 DOM：' + state.apiError);
        return null;
      } finally {
        if (apiRequest === request) apiRequest = null;
      }
    })();
    apiRequest = request;
    return request.promise;
  }

  function snapshot() {
    const title = currentTitle();
    const model = state.adapter && state.adapter.model ? state.adapter.model() : '';
    return {
      site: state.adapter ? state.adapter.name : '未知站点',
      adapterId: state.adapter ? state.adapter.id : '',
      title,
      model,
      url: location.href,
      count: state.messages.length,
      source: state.source,
      apiError: state.apiError,
      expanded: state.expanded,
      engine: Object.assign({}, pyState),
      messages: state.messages.map((m) => ({
        id: m.id,
        index: m.index,
        role: m.role,
        preview: m.preview,
        chars: m.chars
      }))
    };
  }

  /* ------------------------------------------------------------ 加载更早消息 */

  // 记录哪些会话已经「逐屏滚过一遍」。ChatGPT 的代码块 / 图片 / 表格是按视口懒渲染的，
  // 没滚到的地方 DOM 里只有外壳（语言标签），没有 <pre>，导出就会整段丢代码。
  const deepScrolled = new Set();
  function scrollCtl(anchor) {
    const scroller = A.findScroller(anchor);
    const isDoc = scroller === document.scrollingElement || scroller === document.documentElement;
    return {
      scroller,
      isDoc,
      top: () => (isDoc ? window.scrollY : scroller.scrollTop),
      to: (y) => {
        if (isDoc) window.scrollTo(0, y);
        else scroller.scrollTop = y;
      },
      viewport: () => (isDoc ? window.innerHeight : scroller.clientHeight) || 700,
      max: () =>
        isDoc
          ? Math.max(0, (document.scrollingElement || document.documentElement).scrollHeight - window.innerHeight)
          : Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    };
  }

  /** 从当前位置逐屏滚到页面底部，把懒加载的内容逼出来；返回各类块元素的数量变化 */
  async function deepScroll(ctl, notify) {
    const before = {
      pre: document.querySelectorAll('pre').length,
      table: document.querySelectorAll('table').length,
      img: document.querySelectorAll('img').length
    };

    const step = Math.max(180, Math.round(ctl.viewport() * 0.6));
    let guard = 0;
    let sameRounds = 0;

    while (guard++ < 400) {
      const y = ctl.top();
      const max = ctl.max();
      if (y >= max - 4) break;
      ctl.to(Math.min(max, y + step));
      await sleep(160);
      const now = ctl.top();
      if (now <= y + 2) {
        // 没滚动（可能是到底了，等一次再判）
        if (++sameRounds > 3) break;
      } else {
        sameRounds = 0;
      }
      if (notify && guard % 8 === 0) notify();
    }

    // 底部再等一下，最后一批懒加载组件通常这时才挂上
    await sleep(400);
    ctl.to(ctl.max());
    await sleep(400);

    return {
      before,
      after: {
        pre: document.querySelectorAll('pre').length,
        table: document.querySelectorAll('table').length,
        img: document.querySelectorAll('img').length
      },
      pre: document.querySelectorAll('pre').length - before.pre,
      table: document.querySelectorAll('table').length - before.table,
      img: document.querySelectorAll('img').length - before.img
    };
  }

  async function loadAll(notify, force) {
    // 接口能拿到完整会话时，根本不用滚页面（也就没有懒渲染丢代码的问题）
    if ((force ? await loadFromApi() : state.api || await loadFromApi())) {
      collect();
      if (notify) notify(state.messages.length);
      return state.messages.length;
    }

    // 同一个会话只自动翻一次；之后打开面板直接复用现有消息
    if (!force && loadedUrls.has(location.href) && deepScrolled.has(location.href)) {
      collect();
      return state.messages.length;
    }

    const anchor = (state.messages[0] && state.messages[0].el) || document.body;
    const ctl = scrollCtl(anchor);
    const restore = ctl.top();

    // 1) 先往上翻，把更早的消息加载出来
    let last = -1;
    for (let i = 0; i < 45; i++) {
      ctl.to(0);
      await sleep(420);
      const count = A.finalize(
        (state.adapter || A.pickAdapter((state.settings && state.settings.customAdapters) || [])).turns()
      ).length;
      if (notify) notify(count);
      if (count === last) break;
      last = count;
    }

    // 2) 再从头逐屏滚到底，触发代码块 / 表格 / 图片的懒渲染
    if (!deepScrolled.has(location.href) || force) {
      ctl.to(0);
      await sleep(160);
      const added = await deepScroll(ctl, () => {
        if (notify) notify(last, 'scroll');
      });
      state.scrollStats = added;
      if (added.pre || added.table || added.img) {
        console.info('[导出增强器] 滚动补渲染：', added);
      }
      deepScrolled.add(location.href);
    }

    await sleep(200);
    ctl.to(restore);
    loadedUrls.add(location.href);
    collect();
    return state.messages.length;
  }

  /* ---------------------------------------------------- Python 转换引擎 */

  /* 跑在隐藏的扩展页 iframe 里：Pyodide（CPython→WASM）+ app/converter.py 原版源码。
   * 好处是转换逻辑只有一份（就是桌面端那份），不存在 JS 移植带来的偏差。 */

  let pyFrame = null;
  let pyFrameReady = null;
  let pySeq = 0;
  const pyPending = new Map();

  // 引擎状态：面板会显示这个，用户能一眼看出走的哪条路
  const pyState = { status: 'idle', detail: '', ms: 0 };
  function setPyState(status, detail, ms) {
    pyState.status = status;
    pyState.detail = detail || '';
    if (ms) pyState.ms = ms;
    postToPanel('engine', Object.assign({}, pyState));
  }

  function ensurePyFrame() {
    if (pyFrameReady) return pyFrameReady;
    setPyState('loading', '正在启动 Python 引擎');
    pyFrameReady = new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.id = '__cex_py_engine__';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.src = chrome.runtime.getURL('engine/engine.html');
      frame.style.cssText =
        'position:fixed !important;left:-9999px !important;top:0 !important;' +
        'width:2px !important;height:2px !important;border:0 !important;' +
        'opacity:0 !important;pointer-events:none !important;z-index:-1 !important;';

      // 等引擎页回 hello：说明 engine.js 执行完了、运行时资源都在
      const onHello = (event) => {
        const data = event.data;
        if (!data || data.type !== 'cex-py:hello') return;
        if (event.source !== frame.contentWindow) return;
        cleanup();
        if (!data.hasRuntime) {
          reject(new Error('缺少 Python 运行时（精简版安装包）'));
          return;
        }
        pyFrame = frame;
        resolve(frame);
      };

      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener('message', onHello);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('引擎页无响应，插件可能是旧版本或未重新加载'));
      }, 8000);

      window.addEventListener('message', onHello);
      (document.body || document.documentElement).appendChild(frame);
    }).catch((err) => {
      pyFrameReady = null;
      setPyState('error', err.message);
      throw err;
    });
    return pyFrameReady;
  }

  function pyCall(message, timeoutMs) {
    return ensurePyFrame().then(
      (frame) =>
        new Promise((resolve, reject) => {
          const id = 'p' + ++pySeq;
          const timer = setTimeout(() => {
            pyPending.delete(id);
            reject(new Error('Python 引擎超时'));
          }, timeoutMs || 60000);
          pyPending.set(id, { resolve, reject, timer });
          try {
            frame.contentWindow.postMessage(Object.assign({ id }, message), '*');
          } catch (err) {
            clearTimeout(timer);
            pyPending.delete(id);
            reject(err);
          }
        })
    );
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'cex-py:reply') return;
    if (!pyFrame || event.source !== pyFrame.contentWindow) return;
    const pending = pyPending.get(data.id);
    if (!pending) return;
    pyPending.delete(data.id);
    clearTimeout(pending.timer);
    if (data.ok) pending.resolve(data);
    else pending.reject(new Error(data.error || 'Python 引擎出错'));
  });

  /** 预热：面板展开时就先把 Python 起起来，导出时不用等 */
  function warmPython() {
    if (state.settings && state.settings.engine === 'js') {
      setPyState('off', '当前为 JS 引擎');
      return pyState;
    }
    const started = Date.now();
    pyCall({ type: 'cex-py:warm' }, 60000)
      .then(() => setPyState('ready', 'Python 引擎已就绪', Date.now() - started))
      .catch((err) => setPyState('error', (err && err.message) || '启动失败'));
    return pyState;
  }

  async function pyConvert(html) {
    const started = Date.now();
    try {
      const out = await pyCall({ type: 'cex-py:convert', html }, 120000);
      setPyState('ready', 'Python 引擎已就绪', Date.now() - started);
      return out;
    } catch (err) {
      setPyState('error', (err && err.message) || '转换失败');
      throw err;
    }
  }

  /* ------------------------------------------------------------------ 导出 */

  // 运行时 / 高亮 / mermaid 体积大，向后台要一次就缓存起来
  const assetCache = new Map();

  async function getAsset(name) {
    if (assetCache.has(name)) return assetCache.get(name);
    const res = await chrome.runtime.sendMessage({ type: 'cex:asset', name });
    if (!res || !res.ok) throw new Error('读取内置资源失败：' + name);
    assetCache.set(name, res.text);
    return res.text;
  }

  async function exportPayload(payload) {
    const format = payload.format || 'html';
    const settings = Object.assign({}, state.settings, payload.settings || {});

    // 优先走接口：一次拿全，不依赖页面渲染，也就不需要滚动
    if (!payload._skipRefresh && C.conversation && C.conversation.supported()) {
      await loadFromApi();
    }
    if (!payload._skipRefresh) collect();

    // 导出不改变当前页面的滚动位置；接口不可用时只使用当前已有的 DOM。
    let list = state.messages;

    if (payload.scope === 'selected') {
      const ids = new Set(payload.ids || []);
      list = state.messages.filter((m) => ids.has(m.id));
    }
    if (!list.length) throw new Error('当前没有可导出的消息');

    if (payload.splitGroups) {
      if (!Array.isArray(payload.splitGroups) || !payload.splitGroups.length) throw new Error('请至少选择一组问答');
      const available = new Map(list.map((message) => [message.id, message]));
      const baseTitle = String(payload.title || '').replace(/\s+/g, ' ').trim().slice(0, 200) || currentTitle(list);
      const files = [];
      for (let index = 0; index < payload.splitGroups.length; index++) {
        const entry = payload.splitGroups[index];
        const ids = entry && entry.ids;
        if (!Array.isArray(ids) || !ids.length || ids.some((id) => !available.has(id))) {
          throw new Error('会话消息已变化，请重新选择拆分问答');
        }
        const partNumber = Number.isInteger(entry.index) && entry.index >= 0 ? entry.index + 1 : index + 1;
        const group = ids.map((id) => available.get(id));
        const question = group.find((message) => message.role === 'user') || group[0];
        const short = String(question.preview || '').replace(/\s+/g, ' ').split(/[：，。！？!?]/)[0].trim().slice(0, 28) || '问答';
        const defaultTitle = baseTitle.slice(0, 40) + ' - ' + String(partNumber).padStart(2, '0') + ' - ' + short;
        const partTitle = String(entry.title || '').replace(/\s+/g, ' ').trim().slice(0, 200) || defaultTitle;
        files.push(await exportPayload({
          format,
          scope: 'selected',
          ids,
          title: partTitle,
          settings,
          _skipRefresh: true
        }));
      }
      return { files, count: files.reduce((sum, file) => sum + file.count, 0), title: baseTitle };
    }

    const meta = {
      title: String(payload.title || '').replace(/\s+/g, ' ').trim().slice(0, 200) || currentTitle(list),
      url: location.href,
      site: state.adapter ? state.adapter.name : '',
      model: state.adapter && state.adapter.model ? state.adapter.model() : '',
      count: list.length
    };

    let text;
    let widgets = 0;
    let interactive = false;
    let engine = 'none';
    let engineError = '';

    if (format === 'html') {
      const built = await C.exporters.buildHTML(list, meta, settings, {
        getAsset,
        pyConvert: settings.engine === 'js' ? null : pyConvert,
        onEngineError: (err) => {
          engineError = (err && err.message) || String(err);
        }
      });
      text = withDiag(built.doc, list);
      widgets = built.widgets || 0;
      interactive = !!built.interactive;
      engine = built.engine || 'none';
      if (engineError && engine !== 'python') {
        console.warn('[导出增强器] Python 引擎不可用，已回退 JS：' + engineError);
      }
    } else {
      text = C.exporters.build(list, meta, settings, format);
    }

    return {
      filename: C.exporters.filename(meta, settings, format),
      mime: C.exporters.mime(format),
      text,
      count: list.length,
      widgets,
      interactive,
      engine,
      engineError,
      bytes: new Blob([text]).size,
      title: meta.title
    };
  }

  /* ------------------------------------------------------------ 抓取诊断 */

  /* 导出时把「拿到手的 DOM 到底长什么样」埋进 HTML 注释，
   * 这样用户只要把文件发过来，就能判断是懒渲染没触发、还是结构没覆盖到。 */

  function diagnose(list) {
    const per = list.map((m) => {
      const el = m.content || m.el;
      const q = (sel) => {
        try {
          return el.querySelectorAll(sel).length;
        } catch (e) {
          return -1;
        }
      };
      return {
        role: m.role,
        chars: (el.textContent || '').length,
        pre: q('pre'),
        code: q('code'),
        cm: q('.cm-editor, [class*="cm-content"]'),
        codeShell: q('[id*="code-block"], [class*="code-block"], [data-testid*="code"]'),
        copyBtn: q('button[aria-label*="复制"], button[aria-label*="Copy"], [data-testid*="copy"]'),
        button: q('button'),
        table: q('table'),
        imagesInContent: q('img'),
        imagesInTurn: m.el && m.el.querySelectorAll ? m.el.querySelectorAll('img').length : 0,
        imagesOmitted: m.omittedImages || 0
      };
    });

    const totals = per.reduce(
      (acc, x) => {
        acc.pre += x.pre;
        acc.cm += x.cm;
        acc.copyBtn += x.copyBtn;
        acc.codeShell += x.codeShell;
        return acc;
      },
      { pre: 0, cm: 0, copyBtn: 0, codeShell: 0 }
    );

    // 抽样一个「有复制按钮、但里面没有 pre」的代码块外壳，看它到底渲染成了什么
    let sampleShell = null;
    for (const m of list) {
      const el = m.content || m.el;
      let shells = [];
      try {
        shells = el.querySelectorAll('[id*="code-block"], [class*="code-block"], [data-testid*="code"]');
      } catch (e) {
        shells = [];
      }
      for (const sh of shells) {
        if (sh.querySelector('pre')) continue;
        sampleShell = { cls: String(sh.className).slice(0, 90), html: sh.outerHTML.slice(0, 700) };
        break;
      }
      if (sampleShell) break;
    }

    return {
      v: '1.2.2',
      url: location.href,
      site: state.adapter ? state.adapter.id : '',
      apiMedia: state.api && state.api.mediaShape || null,
      scrolled: deepScrolled.has(location.href),
      scroll: state.scrollStats || null,
      messages: per.length,
      totals,
      per,
      sampleShell
    };
  }

  function withDiag(html, list) {
    try {
      const json = JSON.stringify(diagnose(list));
      // 注释里不能出现 -- 连字符序列，转义一下防止破坏注释
      const safe = json.replace(/--/g, '-\\u002d');
      return html.replace(/<\/html>\s*$/i, '<!--CEX-DIAG:' + safe + '-->\n</html>\n');
    } catch (e) {
      return html;
    }
  }

  /* ------------------------------------------------------------------ 定位 */

  function reveal(id) {
    const msg = state.messages.find((m) => m.id === id);
    if (!msg) return false;
    const el = msg.el;
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) {
      el.scrollIntoView();
    }
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '2px solid #2563eb';
    el.style.outlineOffset = '4px';
    el.style.borderRadius = '10px';
    setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOffset;
    }, 1500);
    return true;
  }

  /* -------------------------------------------------------------- 面板通信 */

  const handlers = {
    async hello() {
      if (!state.messages.length) collect();
      return snapshot();
    },
    async sync() {
      return { expanded: state.expanded, settings: state.settings };
    },
    async scan() {
      await loadFromApi();
      collect();
      return snapshot();
    },
    async loadAll(payload, reply) {
      if (state.busy) throw new Error('正在加载中');
      state.busy = true;
      try {
        await loadAll((n, phase) => postToPanel('progress', { count: n, phase }), !!(payload && payload.force));
        return snapshot();
      } finally {
        state.busy = false;
      }
    },
    async export(payload) {
      return exportPayload(payload || {});
    },
    async reveal(payload) {
      return { ok: reveal(payload && payload.id) };
    },
    async setExpanded(payload) {
      setExpanded(payload && payload.expanded);
      return { expanded: state.expanded };
    }
  };

  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || data.__cex !== 1 || data.dir !== 'to-host') return;
    if (state.frame && event.source !== state.frame.contentWindow) return;
    if (data.type === 'bubbleDragStart') { startBubbleDrag(data.payload); return; }

    const handler = handlers[data.type];
    if (!handler) return;

    try {
      const result = await handler(data.payload || {}, (chunk) => {
        if (state.frame) {
          state.frame.contentWindow.postMessage({ __cex: 1, dir: 'to-panel', id: data.id, stream: chunk }, '*');
        }
      });
      if (state.frame) {
        state.frame.contentWindow.postMessage({ __cex: 1, dir: 'to-panel', id: data.id, ok: true, data: result }, '*');
      }
    } catch (err) {
      if (state.frame) {
        state.frame.contentWindow.postMessage(
          { __cex: 1, dir: 'to-panel', id: data.id, ok: false, error: (err && err.message) || '导出失败' },
          '*'
        );
      }
    }
  });

  /* --------------------------------------------------------- 弹出窗口/快捷键 */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'cex:toggle') {
      setExpanded(!state.expanded);
      if (!state.messages.length) collect();
      sendResponse({ ok: true, expanded: state.expanded, count: state.messages.length });
      return true;
    }
    if (msg.type === 'cex:open') {
      setExpanded(true);
      collect();
      sendResponse({ ok: true, expanded: true, count: state.messages.length });
      return true;
    }
    if (msg.type === 'cex:status') {
      collect();
      sendResponse({ ok: true, ...snapshot() });
      return true;
    }
    if (msg.type === 'cex:export') {
      (async () => {
        try {
          if (!state.messages.length) collect();
          const out = await exportPayload({ format: msg.format || state.settings.format, scope: 'all' });
          sendResponse({ ok: true, data: out });
        } catch (err) {
          sendResponse({ ok: false, error: (err && err.message) || '导出失败' });
        }
      })();
      return true;
    }
    return undefined;
  });

  /* ---------------------------------------------------------- 页面变化监听 */

  function hasTurns() {
    try {
      const adapter = A.pickAdapter((state.settings && state.settings.customAdapters) || []);
      return adapter.turns().length > 0;
    } catch (e) {
      return false;
    }
  }

  let changeTimer = null;
  let lastDomSignature = '';
  const observer = new MutationObserver((records) => {
    if (records.every((record) => state.frame && (record.target === state.frame || state.frame.contains(record.target)))) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(async () => {
      /* SPA 导航检测：站点内切换会话（新会话/历史会话）不会重新注入内容脚本，
         旧会话的接口数据与消息列表必须整体作废，否则面板一直停在旧会话上，
         看起来就是「新会话不显示，必须刷新页面」。 */
      if (location.href !== state.url) {
        state.url = location.href;
        state.api = null;
        state.apiError = '';
        state.apiTitle = '';
        state.messages = [];
        lastDomSignature = '';
        if (state.frame) {
          collect();
          postToPanel('changed', { count: state.messages.length, source: state.source });
        }
        loadFromApi().then(() => {
          collect();
          if (state.frame) {
            postToPanel('changed', { count: state.messages.length, source: state.source });
          } else if (state.messages.length) {
            ensureFrame();
          }
        });
        return;
      }
      const dom = collectFromDom();
      const signature = JSON.stringify(dom.map((message) => [message.role, message.content.textContent]));
      if (signature === lastDomSignature) return;
      lastDomSignature = signature;
      const url = location.href;
      await loadFromApi();
      if (location.href !== url) return;
      collect();
      if (!state.frame && state.messages.length) ensureFrame();
      postToPanel('changed', { count: state.messages.length, source: state.source });
    }, 1400);
  });

  /* ------------------------------------------------------------------ 启动 */

  async function boot() {
    state.settings = await S.getSettings();
    S.onSettingsChanged((next) => {
      state.settings = next;
      collect();
      postToPanel('settings', { settings: next });
    });

    collect();

    // 接口取数（原始 Markdown，不受懒渲染影响）。成功后用接口那份重建列表。
    loadFromApi().then((data) => {
      if (!data) return;
      collect();
      postToPanel('changed', { count: state.messages.length, source: 'api' });
      if (!state.frame && state.messages.length) ensureFrame();
    });

    // 空对话页不打扰：确认有消息才显示气泡；后续消息由 MutationObserver 兜住
    if (state.messages.length || (state.adapter && state.adapter.id !== 'generic' && hasTurns())) {
      ensureFrame();
    }

    try {
      observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    } catch (e) {
      /* ignore */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 600));
  } else {
    setTimeout(boot, 600);
  }
})();
