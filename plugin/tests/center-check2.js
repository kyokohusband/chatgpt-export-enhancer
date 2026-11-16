const { chromium } = require('playwright-core');
const os = require('os'), path = require('path');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  for (const width of [1920, 1400, 1260, 1100, 1000]) {
    const p = await b.newPage({ viewport: { width, height: 900 } });
    await p.goto('file:///' + encodeURI(process.argv[2].replace(/\\/g, '/')), { waitUntil: 'load' });
    await p.waitForTimeout(800);
    const r = await p.evaluate((w) => {
      /* 模拟新规则：≥1320px 时 padding-right 恢复 1rem */
      if (w >= 1320) document.body.style.paddingRight = "1rem";
      const wrap = document.querySelector('.wrap');
      const toc = document.querySelector('.wb-toc');
      const wr = wrap.getBoundingClientRect();
      const tr = toc && toc.getBoundingClientRect().width ? toc.getBoundingClientRect() : null;
      return {
        wrapCenter: Math.round((wr.left + wr.right) / 2),
        screenCenter: Math.round(window.innerWidth / 2),
        tocLeft: tr ? Math.round(tr.left) : null,
        overlap: tr ? wr.right > tr.left : false
      };
    }, width);
    const centered = Math.abs(r.wrapCenter - r.screenCenter) <= 2;
    console.log(width + 'px:', JSON.stringify(r), centered && !r.overlap ? '✓ 居中且不压目录' : (r.tocLeft === null ? '✓ 无目录' : '✗'));
    await p.close();
  }
  await b.close();
})();
