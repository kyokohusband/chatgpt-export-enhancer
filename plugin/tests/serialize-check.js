/** 序列化单元检查：把 mock 页面喂给 serialize.js，观察输出。 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'chatgpt-mock.html');
const CHROME =
  process.env.CHROME_PATH ||
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.goto('file:///' + FIXTURE.replace(/\\/g, '/'));
  await page.addScriptTag({ path: path.join(ROOT, 'extension/content/serialize.js') });

  const out = await page.evaluate(() => {
    const S = window.__CEX__.serialize;
    const user = document.querySelector('.whitespace-pre-wrap');
    const md = document.querySelector('.markdown');
    const quote = document.querySelector('blockquote');
    return {
      userBreaks: S.blocks(user, { breaks: true }),
      userPlain: S.blocks(user, { breaks: false }),
      quoteHtml: S.blocks(quote, {}),
      quoteMd: S.markdown(quote),
      mdPreview: S.markdown(md).slice(0, 400)
    };
  });

  console.log('--- user breaks ---');
  console.log(JSON.stringify(out.userBreaks));
  console.log('--- user plain ---');
  console.log(JSON.stringify(out.userPlain));
  console.log('--- quote html ---');
  console.log(out.quoteHtml);
  console.log('--- quote md ---');
  console.log(out.quoteMd);
  console.log('--- md preview ---');
  console.log(out.mdPreview);

  await browser.close();
})();
