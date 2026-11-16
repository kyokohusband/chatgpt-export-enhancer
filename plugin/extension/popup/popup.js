(function () {
  const S = window.__CEX_SHARED__;
  const els = {
    site: document.getElementById('site'),
    count: document.getElementById('count'),
    title: document.getElementById('title'),
    open: document.getElementById('open'),
    quickAll: document.getElementById('quickAll'),
    options: document.getElementById('options'),
    hint: document.getElementById('hint')
  };

  const FILES = [
    'shared/defaults.js',
    'content/dsl.js',
    'content/adapters.js',
    'content/serialize.js',
    'content/markdown.js',
    'content/conversation.js',
    'content/widget.js',
    'content/exporters.js',
    'content/worker.js'
  ];

  let tabId = null;
  let settings = S.DEFAULTS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setHint(text, warn) {
    els.hint.textContent = text;
    els.hint.classList.toggle('warn', !!warn);
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('没有活动标签页');
    tabId = tab.id;
    return tab;
  }

  async function status() {
    const tab = await activeTab();
    if (!S.isChatGptUrl(tab.url)) throw new Error('仅支持 ChatGPT 页面');
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'cex:status' });
    } catch (e) {
      await chrome.scripting.executeScript({ target: { tabId }, files: FILES });
      await sleep(600);
      return await chrome.tabs.sendMessage(tabId, { type: 'cex:status' });
    }
  }

  function paint(snap) {
    const count = snap.count || 0;
    els.count.textContent = String(count);
    els.site.textContent = snap.site ? snap.site + (snap.model ? ' · ' + snap.model : '') : '当前页面';
    els.title.textContent = snap.title || '未命名会话';
    els.title.title = snap.title || '';
    els.open.disabled = false;
    els.quickAll.disabled = count === 0;

    if (!count) {
      setHint('还没有识别到消息。先在这个页面发出一条消息再试。', true);
    } else {
      setHint('默认格式：' + labelOf(settings.format) + ' · 快捷键 Alt+Shift+E', false);
    }
  }

  function labelOf(format) {
    return { html: 'HTML', markdown: 'Markdown', json: 'JSON', text: '纯文本' }[format] || 'HTML';
  }

  els.open.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'cex:open' });
      window.close();
    } catch (e) {
      setHint('无法打开面板：' + (e.message || '未知错误'), true);
    }
  });

  els.quickAll.addEventListener('click', async () => {
    els.quickAll.disabled = true;
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'cex:export', format: settings.format });
      if (!res || !res.ok) throw new Error((res && res.error) || '导出失败');

      const blob = new Blob([res.data.text], { type: res.data.mime });
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({
        url,
        filename: res.data.filename,
        saveAs: !!settings.saveAs,
        conflictAction: 'uniquify'
      });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setHint('已导出 ' + res.data.count + ' 条消息：' + String(res.data.filename).split('/').pop(), false);
      setTimeout(() => window.close(), 900);
    } catch (err) {
      setHint(err.message || '导出失败', true);
      els.quickAll.disabled = false;
    }
  });

  els.options.addEventListener('click', () => chrome.runtime.openOptionsPage());

  (async function boot() {
    settings = await S.getSettings();
    els.open.disabled = true;
    els.quickAll.disabled = true;
    try {
      paint(await status());
    } catch (err) {
      els.site.textContent = '不支持此页面';
      els.title.textContent = err.message || '读取失败';
      setHint('请打开 ChatGPT 对话页面后再试。', true);
    }
  })();
})();
