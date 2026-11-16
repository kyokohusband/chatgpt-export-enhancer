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
    const out = { pres: document.querySelectorAll('.wb-widget pre[data-language]').length, errs: [], literalFences: 0 };
    document.querySelectorAll('.wb-widget').forEach((w, i) => {
      const e = w.querySelector('.wb-err');
      if (e) out.errs.push(i + ':' + e.textContent.slice(0, 60));
      if ((w.innerText || '').includes('```')) out.literalFences++;
    });
    const pre = document.querySelector('.wb-widget pre[data-language] code');
    out.sample = pre ? pre.textContent.replace(/\s+/g, ' ').slice(0, 60) : '';
    return out;
  });
  console.log('真代码块:', r.pres, '| 残留```组件:', r.literalFences, '| 报错组件:', r.errs.length ? r.errs : '无');
  console.log('代码内容示例:', r.sample);
  await b.close();
})();
