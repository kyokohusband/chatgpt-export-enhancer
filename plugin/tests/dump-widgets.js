const { chromium } = require('playwright-core');
const os = require('os'), fs = require('fs'), path = require('path');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
const RUNTIME = fs.readFileSync(path.resolve('../extension/assets/runtime.js'), 'utf8');
const doc = fs.readFileSync(process.argv[2], 'utf8');
const m = doc.match(/<script id="wb-widget-data" type="application\/json">([\s\S]*?)<\/script>/);
const sources = JSON.parse(m[1].replace(/<\\\//g, '</'));
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  const roots = sources.map((_, i) => '<div class="wb-widget" data-w="' + i + '"></div>').join('');
  await p.setContent('<html><body>' + roots +
    '<script id="wb-widget-data" type="application/json">' + JSON.stringify(sources).replace(/<\//g, '<\\/') + '</script></body></html>');
  await p.addScriptTag({ content: RUNTIME });
  await p.waitForTimeout(1200);
  const res = await p.evaluate(() => {
    return [...document.querySelectorAll('.wb-widget')].map((w, i) => ({
      i,
      text: (w.innerText || '').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.length),
      err: w.querySelector('.wb-err') ? w.querySelector('.wb-err').textContent : ''
    }));
  });
  for (const r of res) {
    console.log('== 组件' + r.i + (r.err ? '  ⚠ ' + r.err : ''));
    r.text.slice(0, 12).forEach(l => console.log('   | ' + l.slice(0, 70)));
  }
  await b.close();
})();
