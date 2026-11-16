/* 共享设置层：content script / 面板 / 弹窗 / 设置页共用。 */
(function () {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  if (root.__CEX_SHARED__) return;

  const KEY = 'cex.settings.v1';

  const DEFAULTS = Object.freeze({
    format: 'html',          // html | markdown | json | text
    scope: 'all',            // all | selected
    subfolder: '会话导出',
    imageMode: 'link',       // link | inline | alt
    interactive: true,       // HTML 直接产出可交互页（内嵌运行时），false 则只导出静态 HTML
    engine: 'python',        // python＝跑 app/converter.py 原版（输出与桌面端一致）| js＝内置快速移植版
    includeMeta: true,
    includeCss: true,
    autoLoad: true,          // 打开面板时自动向上滚动加载更早的消息
    collapseAfterExport: false,
    saveAs: false,
    customAdapters: []       // [{ name, hosts:[], user, assistant, content, title }]
  });

  function merge(base, patch) {
    const out = Object.assign({}, base);
    if (!patch || typeof patch !== 'object') return out;
    for (const k of Object.keys(patch)) {
      if (patch[k] !== undefined && patch[k] !== null) out[k] = patch[k];
    }
    return out;
  }

  async function readRaw() {
    try {
      const bag = await chrome.storage.sync.get(KEY);
      return bag && bag[KEY];
    } catch (e) {
      try {
        const bag = await chrome.storage.local.get(KEY);
        return bag && bag[KEY];
      } catch (_) {
        return undefined;
      }
    }
  }

  async function getSettings() {
    const settings = merge(DEFAULTS, await readRaw());
    return settings;
  }

  async function setSettings(patch) {
    const next = merge(await getSettings(), patch);
    try {
      await chrome.storage.sync.set({ [KEY]: next });
    } catch (e) {
      await chrome.storage.local.set({ [KEY]: next });
    }
    return next;
  }

  function onSettingsChanged(cb) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!changes[KEY]) return;
      cb(merge(DEFAULTS, changes[KEY].newValue));
    });
  }

  function normalizeHost(h) {
    return String(h || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^\*\./, '');
  }

  function matchHost(hostname, hosts) {
    const host = String(hostname || '').toLowerCase();
    for (const raw of hosts || []) {
      const h = normalizeHost(raw);
      if (!h) continue;
      if (host === h || host.endsWith('.' + h)) return true;
    }
    return false;
  }

  function isChatGptUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' &&
        (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com');
    } catch (_) {
      return false;
    }
  }

  root.__CEX_SHARED__ = {
    KEY,
    DEFAULTS,
    merge,
    getSettings,
    setSettings,
    onSettingsChanged,
    matchHost,
    normalizeHost,
    isChatGptUrl
  };
})();
