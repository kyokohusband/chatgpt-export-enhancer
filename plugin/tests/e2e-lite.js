/* 精简版（无 Pyodide）必须干净回退到 JS 引擎，而不是卡住或报错 */
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const EXT = path.resolve(__dirname, '.ext-lite');
const PROFILE = path.join(__dirname, '.profile-lite');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME, headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/chatgpt-mock.html'), 'utf8');
  await ctx.route('https://chatgpt.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const page = await ctx.newPage();
  await page.goto('https://chatgpt.com/c/mock-chat');
  await page.waitForSelector('#__cex_frame__', { timeout: 20000 });
  await page.waitForTimeout(1000);
  const [tab] = await sw.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }));

  const t0 = Date.now();
  const res = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'cex:export', format: 'html' }), tab.id);
  const ms = Date.now() - t0;
  if (!res || !res.ok) { console.error('✗ 导出失败:', res && res.error); process.exit(1); }
  console.log('✓ 精简版导出成功:', ms + 'ms · engine=' + res.data.engine + ' · widgets=' + res.data.widgets + ' · ' + Buffer.byteLength(res.data.text) + ' bytes');
  if (res.data.engine !== 'js') { console.error('✗ 应当回退到 js，实际 ' + res.data.engine); process.exit(1); }
  if (!res.data.widgets) { console.error('✗ 组件没还原'); process.exit(1); }
  console.log('✓ 回退干净：没有卡在 Python 引擎上');
  await ctx.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
