const { chromium } = require('playwright-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
const RT = fs.readFileSync(path.resolve('extension/assets/runtime.js'), 'utf8');

// 取用户真实文件里的组件源码
const page = fs.readFileSync('D:/下载/会话导出/python的类.html', 'utf8');
const m = page.match(/<script id="wb-widget-data" type="application\/json">([\s\S]*?)<\/script>/);
const list = JSON.parse(m[1].replace(/<\\\//g, '</'));

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  const holder = JSON.stringify(list.slice(0, 2)).replace(/</g, '\\u003c');
  await p.setContent(`<html><head><meta charset="utf-8"></head><body>
<div class="wb-widget" data-w="0"></div><div class="wb-widget" data-w="1"></div>
<script id="wb-widget-data" type="application/json">${holder}</script></body></html>`);
  await p.addScriptTag({ content: RT });
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('.wb-widget').forEach((w) => {
      out.push({
        w: w.getAttribute('data-w'),
        strong: w.querySelectorAll('strong').length,
        leftStars: (w.innerText.match(/\*\*/g) || []).length,
        strongTexts: [...w.querySelectorAll('strong')].map((s) => s.textContent).slice(0, 4),
      });
    });
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
