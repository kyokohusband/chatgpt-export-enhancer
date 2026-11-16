const { chromium } = require('playwright-core');
const os = require('os'), fs = require('fs'), path = require('path');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  await p.goto('file:///' + encodeURI(process.argv[2].replace(/\\/g, '/')), { waitUntil: 'load' });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: process.argv[3], fullPage: true });
  console.log('已截图:', process.argv[3]);
  await b.close();
})();
