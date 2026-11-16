/* 验证：滚出视口后，代码块 / 消息是否会被卸载（虚拟滚动） */
const { chromium } = require('playwright-core');
const os = require('os'), path = require('path');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
const URL = process.argv[2] || 'https://chatgpt.com/share/ac7a971a-911c-4553-87b6-06f3049b8dae';

const snap = () => ({
  pres: document.querySelectorAll('pre').length,
  codes: document.querySelectorAll('pre code').length,
  turns: document.querySelectorAll('[data-message-author-role]').length,
  md: document.querySelectorAll('.markdown').length,
  cmEd: document.querySelectorAll('.cm-editor').length,
  textLen: document.body.innerText.length
});

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(7000);

  console.log('初始      ', JSON.stringify(await page.evaluate(snap)));

  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9)));
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(800);
  console.log('滚到底部  ', JSON.stringify(await page.evaluate(snap)));

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  console.log('回到顶部  ', JSON.stringify(await page.evaluate(snap)));

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1200);
  console.log('再到顶部? ', JSON.stringify(await page.evaluate(snap)));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
