/* 面板：ui + 下载 + 剪贴板；所有页面数据由内容脚本通过 postMessage 提供。 */
(function () {
  const S = window.__CEX_SHARED__;
  const $ = (id) => document.getElementById(id);

  const els = {
    bubble: $('bubble'),
    badge: $('bubbleBadge'),
    panel: $('panel'),
    siteTag: $('siteTag'),
    docTitle: $('docTitle'),
    list: $('list'),
    status: $('status'),
    engine: $('engine'),
    source: $('source'),
    sizeHint: $('sizeHint'),
    exportTitle: $('exportTitle'),
    splitTurns: $('splitTurns'),
    splitPicker: $('splitPicker'),
    splitHint: $('splitHint'),
    splitList: $('splitList'),
    splitAll: $('splitAll'),
    splitNone: $('splitNone'),
    splitCancel: $('splitCancel'),
    splitConfirm: $('splitConfirm'),
    btnExport: $('btnExport'),
    btnCopy: $('btnCopy'),
    btnRescan: $('btnRescan'),
    btnSettings: $('btnSettings'),
    btnCollapse: $('btnCollapse'),
    scope: $('scope'),
    formats: $('formats'),
    toast: $('toast')
  };

  const embedded = window.parent && window.parent !== window;

  const state = {
    settings: S.DEFAULTS,
    messages: [],
    selected: new Set(),
    scope: S.DEFAULTS.scope === 'selected' ? 'selected' : 'all',
    format: S.DEFAULTS.format || 'html',
    connected: false,
    busy: false,
    title: '',
    url: '',
    titleEdited: false,
    initialized: false
  };

  /* ------------------------------------------------------------------ 通信 */

  let seq = 0;
  const pending = new Map();

  function call(type, payload, timeout) {
    if (!embedded) return Promise.reject(new Error('未连接到页面'));
    const id = 'c' + ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('页面没有响应，请刷新后重试'));
      }, timeout || 20000);

      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        }
      });

      parent.postMessage({ __cex: 1, dir: 'to-host', id, type, payload: payload || {} }, '*');
    });
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.__cex !== 1 || data.dir !== 'to-panel') return;

    if (data.id && !data.stream) {
      const job = pending.get(data.id);
      if (job) {
        pending.delete(data.id);
        if (data.ok) job.resolve(data.data);
        else job.reject(new Error(data.error || '操作失败'));
      }
      return;
    }

    if (data.stream && data.stream.type === 'progress') {
      const phase = data.stream.data.phase === 'scroll';
      els.status.textContent =
        (phase ? '正在滚动补齐代码块… ' : '正在加载更早的消息… ') + (data.stream.data.count || 0) + ' 条';
      return;
    }

    if (data.type === 'changed') {
      if (!state.busy) refresh(false);
      return;
    }

    if (data.type === 'ui' && data.data) {
      applyUi(!!data.data.expanded);
      if (data.data.expanded && !state.messages.length) refresh(false);
      return;
    }

    if (data.type === 'engine' && data.data) {
      renderEngine(data.data);
      return;
    }

    if (data.type === 'settings' && data.data && data.data.settings) {
      state.settings = data.data.settings;
    }
  });

  /* -------------------------------------------------------------- 引擎状态 */

  const ENGINE_LABEL = { ready: 'Python', loading: 'Python…', error: 'JS 回退', off: 'JS', idle: '' };

  function renderEngine(info) {
    const el = els.engine;
    if (!el || !info) return;
    const status = info.status || 'idle';
    const label = ENGINE_LABEL[status];
    if (!label) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.className = 'engine is-' + (status === 'off' ? 'off' : status);
    el.textContent = label;
    const bits = [];
    if (info.detail) bits.push(info.detail);
    if (status === 'ready' && info.ms) bits.push('启动 ' + info.ms + ' ms');
    if (status === 'error') bits.push('点击设置页可自检');
    el.title = bits.join(' · ') || label;
  }

  /* ------------------------------------------------------------------ 展开 */

  function applyUi(expanded) {
    document.body.classList.toggle('collapsed', !expanded);
    document.body.classList.toggle('expanded', expanded);
    els.panel.hidden = !expanded;
  }

  async function expand() {
    applyUi(true);
    try {
      await call('setExpanded', { expanded: true }, 4000);
    } catch (e) {
      /* 面板自己也要能切换到展开态，尺寸由宿主调整 */
    }
    await refresh(!!state.settings.autoLoad);
  }

  async function collapse() {
    applyUi(false);
    try {
      await call('setExpanded', { expanded: false }, 4000);
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ 数据 */

  /** 消息来源徽章：接口 = 原始 Markdown（不会丢代码块）；页面 = 抓 DOM */
  function renderSource(snap) {
    if (!els.source) return;
    const api = snap.source === 'api';
    els.source.hidden = false;
    els.source.textContent = api ? '接口' : '页面';
    els.source.className = 'engine ' + (api ? 'is-ready' : 'is-off');
    els.source.title = api
      ? '消息来自 ChatGPT 接口（原始 Markdown），与页面有没有滚动无关'
      : snap.apiError
        ? '接口不可用，已退回抓取页面：' + snap.apiError
        : '从页面 DOM 抓取；长回答里的代码块可能还没渲染';
  }

  function applySnapshot(snap) {
    if (!snap) return;
    state.connected = true;
    if (snap.engine) renderEngine(snap.engine);
    renderSource(snap);
    state.title = snap.title || '';
    if (state.url !== (snap.url || '')) {
      state.url = snap.url || '';
      state.titleEdited = false;
    }
    if (!state.titleEdited) els.exportTitle.value = state.title;
    els.siteTag.textContent = snap.site || '当前页面';
    els.docTitle.textContent = snap.title || '未命名会话';
    els.docTitle.title = snap.title || '';

    const incoming = snap.messages || [];
    const ids = new Set(incoming.map((m) => m.id));
    for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);

    if (!state.initialized) {
      incoming.forEach((m) => state.selected.add(m.id));
      state.initialized = true;
    } else {
      incoming.forEach((m) => {
        if (!ids.has(m.id)) return;
        if (!state.messages.some((old) => old.id === m.id)) state.selected.add(m.id);
      });
    }

    state.messages = incoming;
    els.badge.hidden = !incoming.length;
    els.badge.textContent = String(incoming.length);
    render();
  }

  function refresh(autoLoadEarlier) {
    if (state.busy) return Promise.resolve();
    state.busy = true;
    els.status.textContent = '正在读取页面…';
    els.panel.classList.add('is-busy');

    return (async () => {
      try {
        const snap = await call('scan', {}, 15000);
        applySnapshot(snap);

        if (autoLoadEarlier && state.messages.length) {
          els.status.textContent = '正在加载更早的消息…';
          try {
            const next = await call('loadAll', {}, 180000);
            applySnapshot(next);
          } catch (e) {
            /* 加载更早失败不影响已有消息 */
          }
        }
      } catch (err) {
        state.connected = false;
        els.siteTag.textContent = '未连接';
        els.docTitle.textContent = '读取页面失败';
        toast(err.message || '读取失败', true);
      } finally {
        state.busy = false;
        els.panel.classList.remove('is-busy');
        updateStatus();
      }
    })();
  }

  /* ------------------------------------------------------------------ 渲染 */

  function visibleMessages() {
    if (state.scope === 'all') return state.messages;
    return state.messages.filter((m) => state.selected.has(m.id));
  }

  function splitGroups(messages) {
    const groups = [];
    let current = [];
    for (const message of messages) {
      if (message.role === 'user' && current.some((item) => item.role === 'user')) {
        groups.push(current);
        current = [];
      }
      current.push(message);
    }
    if (current.length) groups.push(current);
    return groups;
  }

  let offeredGroups = [];
  function defaultPartTitle(group, index) {
    const base = (els.exportTitle.value.trim() || state.title || '未命名会话').replace(/\s+/g, ' ').slice(0, 40);
    const question = group.find((message) => message.role === 'user') || group[0];
    const short = String(question.preview || '').replace(/\s+/g, ' ').split(/[：，。！？!?]/)[0].trim().slice(0, 28) || '问答';
    return base + ' - ' + String(index + 1).padStart(2, '0') + ' - ' + short;
  }

  function showSplitPicker() {
    offeredGroups = splitGroups(visibleMessages());
    if (!offeredGroups.length) return toast('没有可拆分的消息', true);
    els.splitHint.textContent = '每组单独保存，可修改各自的标题／文件名。';
    els.splitList.replaceChildren();
    offeredGroups.forEach((group, index) => {
      const row = document.createElement('div');
      row.className = 'split-item';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = true;
      check.dataset.index = String(index);
      check.setAttribute('aria-label', '导出第 ' + (index + 1) + ' 组问答');
      const body = document.createElement('div');
      body.className = 'split-item-body';
      const label = document.createElement('span');
      const question = group.find((message) => message.role === 'user') || group[0];
      label.textContent = String(index + 1).padStart(2, '0') + ' · ' + question.preview;
      const title = document.createElement('input');
      title.className = 'split-title';
      title.type = 'text';
      title.maxLength = 200;
      title.value = defaultPartTitle(group, index);
      title.setAttribute('aria-label', '第 ' + (index + 1) + ' 组标题和文件名');
      body.append(label, title);
      row.append(check, body);
      els.splitList.appendChild(row);
    });
    els.splitPicker.hidden = false;
  }

  function render() {
    const list = els.list;
    list.textContent = '';

    if (!state.messages.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '没有识别到消息。先发一条消息，或在设置里为该站点配置选择器。';
      list.appendChild(li);
      updateStatus();
      return;
    }

    const frag = document.createDocumentFragment();
    for (const m of state.messages) {
      const on = state.selected.has(m.id);
      const row = document.createElement('li');
      row.className = 'row' + (on ? ' is-on' : '');
      row.dataset.id = m.id;
      row.dataset.role = m.role;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = on;
      cb.setAttribute('aria-label', '选择第 ' + m.index + ' 条消息');
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        toggle(m.id, cb.checked);
      });

      const role = document.createElement('span');
      role.className = 'role';
      role.textContent = m.role === 'user' ? 'U' : m.role === 'assistant' ? 'A' : 'S';
      role.title = m.role === 'user' ? '提问' : m.role === 'assistant' ? '回答' : '系统';

      const preview = document.createElement('span');
      preview.className = 'preview';
      preview.textContent = m.preview;
      preview.title = m.preview;

      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(m.index);

      const locate = document.createElement('button');
      locate.type = 'button';
      locate.className = 'locate';
      locate.title = '在页面上定位';
      locate.textContent = '⌖';
      locate.addEventListener('click', (e) => {
        e.stopPropagation();
        call('reveal', { id: m.id }, 5000).catch(() => {});
      });

      row.append(cb, role, preview, idx, locate);
      row.addEventListener('click', () => toggle(m.id, !state.selected.has(m.id)));
      frag.appendChild(row);
    }

    list.appendChild(frag);
    updateStatus();
  }

  function toggle(id, on) {
    if (on) state.selected.add(id);
    else state.selected.delete(id);
    const row = els.list.querySelector('[data-id="' + id + '"]');
    if (row) {
      row.classList.toggle('is-on', on);
      const cb = row.querySelector('input');
      if (cb) cb.checked = on;
    }
    updateStatus();
  }

  function bulk(kind) {
    if (!state.messages.length) return;
    if (kind === 'all') state.messages.forEach((m) => state.selected.add(m.id));
    if (kind === 'none') state.selected.clear();
    if (kind === 'invert') {
      const next = new Set();
      state.messages.forEach((m) => {
        if (!state.selected.has(m.id)) next.add(m.id);
      });
      state.selected = next;
    }
    if (kind === 'user') state.selected = new Set(state.messages.filter((m) => m.role === 'user').map((m) => m.id));
    if (kind === 'assistant') {
      state.selected = new Set(state.messages.filter((m) => m.role === 'assistant').map((m) => m.id));
    }
    render();
  }

  function estSize(chars) {
    const kb = (chars / 1024) * 1.7;
    if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
    return Math.max(1, Math.round(kb)) + ' KB';
  }

  function updateStatus() {
    const total = state.messages.length;
    const count = visibleMessages().length;
    if (!total) {
      els.status.textContent = '没有消息';
      els.sizeHint.textContent = '';
      els.btnExport.disabled = true;
      els.btnCopy.disabled = true;
      return;
    }

    els.status.textContent =
      state.scope === 'all' ? '共 ' + total + ' 条消息' : '已选 ' + count + ' / ' + total + ' 条';

    const chars = visibleMessages().reduce((sum, m) => sum + (m.chars || m.preview.length), 0);
    els.sizeHint.textContent = count ? '约 ' + estSize(chars) : '';

    els.btnExport.disabled = count === 0;
    els.btnCopy.disabled = count === 0;
  }

  /* ------------------------------------------------------------------ 交互 */

  function setScope(scope, persist) {
    const next = scope === 'selected' ? 'selected' : 'all';
    const changed = next !== state.scope;
    state.scope = next;
    for (const btn of els.scope.querySelectorAll('.seg')) {
      const on = btn.dataset.scope === state.scope;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    updateStatus();
    if (persist && changed) S.setSettings({ scope: state.scope }).catch(() => {});
  }

  function setFormat(format, persist) {
    const next = ['html', 'markdown', 'json', 'text'].includes(format) ? format : 'html';
    const changed = next !== state.format;
    state.format = next;
    for (const btn of els.formats.querySelectorAll('.fmt')) {
      btn.classList.toggle('is-active', btn.dataset.format === state.format);
    }
    if (persist && changed) S.setSettings({ format: state.format }).catch(() => {});
  }

  let toastTimer = null;
  function toast(message, isError) {
    els.toast.textContent = message;
    els.toast.classList.toggle('is-error', !!isError);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  async function downloadFile(filename, mime, text) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);

    const fallback = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = String(filename).split('/').pop();
      document.body.appendChild(a);
      a.click();
      a.remove();
    };

    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      try {
        await chrome.downloads.download({
          url,
          filename,
          saveAs: !!state.settings.saveAs,
          conflictAction: 'uniquify'
        });
      } catch (_) {
        fallback();
      }
    } else {
      fallback();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function doExport(mode, groups) {
    const list = visibleMessages();
    if (!list.length) {
      toast('请先选择要导出的消息', true);
      return;
    }

    els.btnExport.disabled = true;
    els.btnCopy.disabled = true;
    try {
      const title = state.titleEdited ? els.exportTitle.value.trim() : '';

      const res = await call(
        'export',
        { format: state.format, scope: state.scope, ids: [...state.selected], title, splitGroups: groups || null },
        180000
      );

      if (res.files) {
        for (const file of res.files) await downloadFile(file.filename, file.mime, file.text);
        toast('已拆分导出 ' + res.files.length + ' 组问答' +
          (res.files.length === 1 ? '：' + String(res.files[0].filename).split('/').pop() : ''));
        if (state.settings.collapseAfterExport) setTimeout(collapse, 900);
      } else if (mode === 'copy') {
        const ok = await copyText(res.text);
        toast(ok ? '已复制 ' + res.count + ' 条消息' : '复制失败，请改用导出', !ok);
      } else {
        await downloadFile(res.filename, res.mime, res.text);
        const merged = res.engine === 'js' && res.engineError;
        const bits = ['已导出 ' + res.count + ' 条消息'];
        if (res.widgets) bits.push('还原 ' + res.widgets + ' 个组件');
        if (res.engine === 'python') bits.push('Python 引擎');
        else if (res.engine === 'js') bits.push(merged ? '已回退 JS 引擎' : 'JS 引擎');
        toast(bits.join(' · ') + '：' + String(res.filename).split('/').pop(), merged);
        if (merged) {
          els.engine.title = 'Python 引擎不可用：' + res.engineError;
          renderEngine({ status: 'error', detail: res.engineError });
        }
        if (state.settings.collapseAfterExport) setTimeout(collapse, 900);
      }
    } catch (err) {
      toast(err.message || '导出失败', true);
    } finally {
      updateStatus();
    }
  }

  /* ------------------------------------------------------------------ 绑定 */

  function bind() {
    els.bubble.addEventListener('pointerdown', (event) => {
      if (!embedded || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      parent.postMessage({
        __cex: 1, dir: 'to-host', type: 'bubbleDragStart',
        payload: { x: event.clientX, y: event.clientY }
      }, '*');
    });
    els.bubble.addEventListener('click', expand);
    els.btnCollapse.addEventListener('click', collapse);
    els.btnRescan.addEventListener('click', () => refresh(false));
    els.btnSettings.addEventListener('click', () => {
      if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    });

    els.scope.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg');
      if (btn) setScope(btn.dataset.scope, true);
    });

    els.formats.addEventListener('click', (e) => {
      const btn = e.target.closest('.fmt');
      if (btn) setFormat(btn.dataset.format, true);
    });

    els.panel.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const act = chip.dataset.act;
      if (act === 'load') {
        if (state.busy) return;
        state.busy = true;
        els.status.textContent = '正在加载更早的消息…';
        call('loadAll', { force: true }, 90000)
          .then((snap) => applySnapshot(snap))
          .catch((err) => toast(err.message || '加载失败', true))
          .finally(() => {
            state.busy = false;
            updateStatus();
          });
        return;
      }
      bulk(act);
    });

    els.btnExport.addEventListener('click', () => {
      if (els.splitTurns.checked) showSplitPicker();
      else doExport('save');
    });
    els.btnCopy.addEventListener('click', () => doExport('copy'));

    els.splitAll.addEventListener('click', () => els.splitList.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.checked = true; }));
    els.splitNone.addEventListener('click', () => els.splitList.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.checked = false; }));
    els.splitCancel.addEventListener('click', () => { els.splitPicker.hidden = true; });
    els.splitConfirm.addEventListener('click', () => {
      const chosen = [...els.splitList.querySelectorAll('input[type="checkbox"]:checked')].map((el) => {
        const index = Number(el.dataset.index);
        return {
          index,
          ids: offeredGroups[index].map((m) => m.id),
          title: el.closest('.split-item').querySelector('.split-title').value.trim()
        };
      });
      if (!chosen.length) {
        els.splitHint.textContent = '请至少选择一组问答。';
        return;
      }
      els.splitPicker.hidden = true;
      doExport('save', chosen);
    });
    els.exportTitle.addEventListener('input', () => {
      state.titleEdited = !!els.exportTitle.value.trim();
    });
    els.exportTitle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !els.splitTurns.checked) doExport('save');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!els.splitPicker.hidden) els.splitPicker.hidden = true;
      else if (document.body.classList.contains('expanded')) collapse();
    });
  }

  /* ------------------------------------------------------------------ 启动 */

  (async function boot() {
    state.settings = await S.getSettings();
    setFormat(state.settings.format);
    setScope(state.settings.scope === 'selected' ? 'selected' : 'all');
    bind();

    if (!embedded) {
      applyUi(true);
      els.status.textContent = '独立预览模式';
      els.docTitle.textContent = '请从网页右下角的气泡打开面板';
      return;
    }

    // 嵌入时先问宿主当前状态：从弹窗/快捷键打开的情况下要直接展开
    try {
      const snap = await call('sync', {}, 4000);
      if (snap && snap.expanded) {
        applyUi(true);
        await refresh(!!state.settings.autoLoad);
        return;
      }
      // 收起态也先把条数显示在气泡上，点开前就知道有没有内容
      const info = await call('scan', {}, 15000);
      const count = (info && info.messages && info.messages.length) || 0;
      els.badge.hidden = !count;
      els.badge.textContent = String(count);
    } catch (e) {
      /* 保持收起态（72×72 气泡） */
    }
  })();
})();
