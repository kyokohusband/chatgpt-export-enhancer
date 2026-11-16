const { chromium } = require('playwright-core');
const os = require('os'), path = require('path');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 2 });
  await p.goto('file:///' + path.join(__dirname, 'out/api-interactive.html').replace(/\\/g, '/'));
  await p.waitForTimeout(1200);
  const pre = p.locator('pre', { hasText: 'class Person' }).first();
  await pre.scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  await pre.screenshot({ path: path.join(__dirname, 'out/codeblock-fixed.png') });
  const t = await pre.evaluate((el) => el.textContent);
  console.log(JSON.stringify(t.slice(0, 120)));
  await b.close();
})();
