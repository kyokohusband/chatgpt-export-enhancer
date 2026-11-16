const { chromium } = require('playwright-core');
const os = require('os'), path = require('path'), fs = require('fs');
const EXT = 'D:/下载/插件对比/ai-chat-exporter-extension';
const POPUP = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).action.default_popup;
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));

(async () => {
  const profile = path.join(__dirname, '.profile-3rd');
  fs.rmSync(profile, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME, headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) {
    try { sw = await ctx.waitForEvent('serviceworker', { timeout: 12000 }); } catch (e) {}
  }
  console.log('service worker:', sw ? sw.url() : '(none)');
  const id = sw ? new URL(sw.url()).host : null;
  console.log('extension id:', id);
  if (id) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.setViewportSize({ width: 400, height: 980 });
    await page.goto(`chrome-extension://${id}/${POPUP}`).catch(e => errs.push(e.message));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(__dirname, 'out', 'aichat-popup.png') });
    console.log('popup errors:', errs.length ? errs : 'none');
    console.log('popup title:', await page.title().catch(() => '?'));
  }
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
})();
