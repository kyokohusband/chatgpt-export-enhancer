/* Service worker：默认设置、清理旧站点注册、快捷键。 */
importScripts('shared/defaults.js');

const S = self.__CEX_SHARED__;
const SCRIPT_ID = 'cex-custom-sites';

const FILES = [
  'shared/defaults.js',
  'content/dsl.js',
  'content/adapters.js',
  'content/serialize.js',
  'assets/katex.js',
  'content/markdown.js',
  'content/conversation.js',
  'content/widget.js',
  'content/exporters.js',
  'content/worker.js'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 内容脚本不能直接跨域读扩展资源，统一由这里转发（并做一层缓存） */
const assetCache = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'cex:asset') return undefined;

  const name = String(msg.name || '');
  if (!/^[\w.-]+$/.test(name)) {
    sendResponse({ ok: false, error: '非法的资源名' });
    return true;
  }
  if (assetCache.has(name)) {
    sendResponse({ ok: true, text: assetCache.get(name) });
    return true;
  }

  (async () => {
    try {
      const resp = await fetch(chrome.runtime.getURL('assets/' + name));
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      assetCache.set(name, text);
      sendResponse({ ok: true, text });
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || '读取失败' });
    }
  })();
  return true;
});

async function removeLegacySiteScripts() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch (e) {
    /* 旧版本没有注册过，忽略 */
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const bag = await chrome.storage.sync.get(S.KEY);
    if (!bag || !bag[S.KEY]) await S.setSettings({});
  } catch (e) {
    /* ignore */
  }
  removeLegacySiteScripts();
});

chrome.runtime.onStartup.addListener(removeLegacySiteScripts);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !S.isChatGptUrl(tab.url)) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'cex:toggle' });
    return;
  } catch (e) {
    /* 页面还没有内容脚本，按需注入 */
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES });
    await sleep(600);
    await chrome.tabs.sendMessage(tab.id, { type: 'cex:toggle' });
  } catch (err) {
    console.warn('[会话导出] 无法在当前页面启用：', err && err.message);
  }
});
