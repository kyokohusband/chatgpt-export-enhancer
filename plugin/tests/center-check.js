/* 用新 converter.css 覆盖后测量主内容居中情况 */
const { chromium } = require('playwright-core');
const os = require('os'), fs = require('fs'), path = require('path');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
const NEWCSS = fs.readFileSync(path.resolve('../extension/assets/converter.css'), 'utf8');
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  for (const width of [1920, 1400, 1260, 1100, 1000]) {
    const p = await b.newPage({ viewport: { width, height: 900 } });
    await p.goto('file:///' + encodeURI(process.argv[2].replace(/\\/g, '/')), { waitUntil: 'load' });
    await p.addStyleTag({ content: NEWCSS });
    await p.waitForTimeout(600);
    const r = await p.evaluate(() => {
      const wrap = document.querySelector('.wrap');
      const toc = document.querySelector('.wb-toc');
      const wr = wrap.getBoundingClientRect();
      const tr = toc ? toc.getBoundingClientRect() : null;
      const overlap = tr ? wr.right > tr.left : false;
      return {
        wrapCenter: Math.round((wr.left + wr.right) / 2),
        screenCenter: Math.round(window.innerWidth / 2),
        tocLeft: tr && tr.width ? Math.round(tr.left) : null,
        overlap
      };
    });
    console.log(width + 'px:', JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
