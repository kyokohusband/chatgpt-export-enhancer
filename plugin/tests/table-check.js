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
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => {
    const out = { tables: document.querySelectorAll('.wb-md-table').length, pipes: 0, sample: '' };
    document.querySelectorAll('.wb-widget').forEach(w => {
      if ((w.innerText || '').includes('|---|') || /\|\s*在指定位置/.test(w.innerText)) out.pipes++;
    });
    const t = document.querySelector('.wb-md-table');
    if (t) out.sample = t.innerText.replace(/\s+/g, ' ').slice(0, 100);
    return out;
  });
  console.log('真表格数:', r.tables, '| 残留竖线文本组件:', r.pipes);
  console.log('表格内容:', r.sample);
  await b.close();
})();
