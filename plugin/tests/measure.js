const { chromium } = require('playwright-core');
const os = require('os'), path = require('path');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  for (const width of [1920, 1400, 1000]) {
    const p = await b.newPage({ viewport: { width, height: 900 } });
    await p.goto('file:///' + encodeURI(process.argv[2].replace(/\\/g, '/')), { waitUntil: 'load' });
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => {
      const wrap = document.querySelector('.wrap');
      const toc = document.querySelector('.wb-toc');
      const bodyCls = document.body.className;
      if (!wrap) return { wrap: false };
      const wr = wrap.getBoundingClientRect();
      const tr = toc ? toc.getBoundingClientRect() : null;
      return {
        bodyCls, viewport: window.innerWidth,
        wrapLeft: Math.round(wr.left), wrapRight: Math.round(wr.right),
        wrapCenter: Math.round((wr.left + wr.right) / 2),
        screenCenter: Math.round(window.innerWidth / 2),
        tocLeft: tr ? Math.round(tr.left) : null,
        bodyPadRight: getComputedStyle(document.body).paddingRight
      };
    });
    console.log(width + 'px:', JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
