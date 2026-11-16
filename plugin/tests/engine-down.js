/* 缺 engine 目录时（模拟装了旧版插件），自检必须给出可读错误而不是一直转圈。
 * 注意：扩展目录由外部用 python 复制好（node 的 fs.cpSync 复制大目录会整进程被杀）。 */
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const EXT = path.resolve(__dirname, '.ext-noengine');
const PROFILE = path.join(__dirname, '.profile-noengine');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));

(async () => {
  if (!fs.existsSync(EXT)) throw new Error('缺少 .ext-noengine，请先用 python 复制扩展目录');
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME, headless: true,
    viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/options/options.html`);
  await page.waitForTimeout(600);

  const t0 = Date.now();
  await page.locator('#testEngine').click();
  await page.waitForFunction(() => {
    const el = document.getElementById('engineResult');
    return el && !/正在启动/.test(el.textContent);
  }, null, { timeout: 60000 });
  const text = (await page.locator('#engineResult').innerText()).trim();
  console.log('耗时', Date.now() - t0, 'ms');
  console.log('结果:', text);
  await page.screenshot({ path: path.join(__dirname, 'out/8-selftest-fail.png'), fullPage: true });
  await ctx.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  if (!/✗/.test(text)) { console.error('✗ 应当报错'); process.exit(1); }
  console.log('✓ 缺引擎时报错明确');
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
