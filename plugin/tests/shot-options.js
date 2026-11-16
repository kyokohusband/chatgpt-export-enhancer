const { chromium } = require('playwright-core');
const os = require('os'), path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(__dirname, 'out');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
(async () => {
  const profile = path.join(__dirname, '.profile-shot');
  fs.rmSync(profile, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME, headless: true,
    viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/options/options.html`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '6-options-engine.png'), fullPage: true });
  console.log('engine value:', await page.locator('#engine').inputValue());
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
})();
