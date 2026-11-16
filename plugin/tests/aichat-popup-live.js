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
    executablePath: CHROME, headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/chatgpt-mock.html'), 'utf8');
  await ctx.route('https://chatgpt.com/**', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const page = await ctx.newPage();
  await page.goto('https://chatgpt.com/c/mock-chat', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const parsed = await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    if (!tabs.length) return { error: 'no tab' };
    try {
      const r = await chrome.tabs.sendMessage(tabs[0].id, { type: 'PING' });
      return { ping: r };
    } catch (e) { return { pingError: e.message }; }
  });
  console.log('content script ping:', JSON.stringify(parsed));

  const opened = await sw.evaluate(async () => {
    try { await chrome.action.openPopup(); return 'opened'; }
    catch (e) { return 'error: ' + e.message; }
  });
  console.log('openPopup:', opened);
  await page.waitForTimeout(1800);

  const popup = ctx.pages().find(p => p.url().includes('/popup/popup.html'));
  console.log('popup page:', popup ? popup.url() : '(none)');
  if (popup) {
    await popup.screenshot({ path: path.join(OUT, 'aichat-popup-live.png') });
    const txt = await popup.evaluate(() => document.body.innerText).catch(() => '');
    console.log('--- popup text ---');
    console.log(txt.slice(0, 600));
  }
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
})();
