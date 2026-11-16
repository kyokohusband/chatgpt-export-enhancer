const { chromium } = require('playwright-core');
const os = require('os'), path = require('path'), fs = require('fs');
const EXT = 'D:/下载/插件对比/ai-chat-exporter-extension';
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
const OUT = path.join(__dirname, 'out');

(async () => {
  const profile = path.join(__dirname, '.profile-ai');
  fs.rmSync(profile, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME, headless: true, acceptDownloads: true,
    downloadsPath: path.join(OUT, 'dl-ai'),
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/chatgpt-mock.html'), 'utf8');
  await ctx.route('https://chatgpt.com/**', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const page = await ctx.newPage();
  await page.goto('https://chatgpt.com/c/mock-chat', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const conv = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: 'get_conversation', timestamp: Date.now() });
    } catch (e) { return { error: e.message }; }
  });
  const brief = JSON.stringify(conv).slice(0, 700);
  console.log('get_conversation:', brief);
  if (conv && conv.success) {
    const d = conv.conversation || conv.data || conv;
    const pairs = Array.isArray(d?.pairs) ? d.pairs : Array.isArray(d?.messages) ? d.messages : null;
    console.log('pairs/messages:', pairs ? pairs.length : 'n/a');
  }

  const dlPromise = ctx.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  const exp = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: 'export_conversation', format: 'html', timestamp: Date.now() });
    } catch (e) { return { error: e.message }; }
  });
  console.log('export_conversation:', JSON.stringify(exp).slice(0, 300));

  const dl = await dlPromise;
  console.log('download event:', dl ? dl.suggestedFilename() : '(none)');
  if (dl) {
    const dest = path.join(OUT, 'aichat-export.html');
    await dl.saveAs(dest);
    const text = fs.readFileSync(dest, 'utf8');
    console.log('saved bytes:', text.length);
    console.log('contains "<box":', text.includes('<box'), '| contains "&lt;box":', text.includes('&lt;box'));
    console.log('contains "seccomp":', text.includes('seccomp'), '| contains "def run":', text.includes('def run'));
  }
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
})();
