const { chromium } = require('playwright-core');
const os = require('os'), path = require('path');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  const file = 'file:///' + encodeURI(process.argv[2].replace(/\\/g,'/'));
  await p.goto(file, { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  const leaks = await p.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue || '';
      if (/\*\*[^*\s][^*]*\*\*/.test(t) || t.includes('**')) {
        const parentTag = n.parentElement ? n.parentElement.tagName : '?';
        const inPre = n.parentElement && n.parentElement.closest('pre,code');
        out.push({ tag: parentTag, inCode: !!inPre, text: t.slice(0, 160) });
      }
    }
    return out;
  });
  console.log('leaks:', leaks.length);
  leaks.slice(0, 20).forEach(l => console.log(`[${l.tag}${l.inCode ? ' 代码内' : ''}]`, l.text.replace(/\n/g, '⏎')));
  await b.close();
})();
