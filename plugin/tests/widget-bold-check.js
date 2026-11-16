/* 验证：DSL 里 **{expr}** 这种「字面量包裹表达式」的加粗能正确渲染。
   用法：node widget-bold-check.js <导出的可交互HTML> */
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
  const html = '<html><body>' + roots +
    '<script id="wb-widget-data" type="application/json">' +
    JSON.stringify(sources).replace(/<\//g, '<\\/') + '</script>' + '</body></html>';
  await p.setContent(html);
  await p.addScriptTag({ content: RUNTIME });
  await p.waitForTimeout(1200);
  const res = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('.wb-widget').forEach((root, i) => {
      out.push({
        i,
        err: root.querySelector('.wb-err') ? root.querySelector('.wb-err').textContent : '',
        leaks: (root.textContent.match(/\*\*/g) || []).length,
        strong: root.querySelectorAll('strong').length,
        sample: (root.textContent || '').replace(/\s+/g, ' ').slice(0, 60)
      });
    });
    return out;
  });
  let bad = 0;
  for (const r of res) {
    const ok = !r.err && r.leaks === 0;
    if (!ok) bad++;
    console.log(ok ? '✓' : '✗', '组件' + r.i, '| strong×' + r.strong, '| **泄漏×' + r.leaks, r.err ? '| ' + r.err : '', '|', r.sample);
  }
  console.log(bad === 0 ? '全部通过' : bad + ' 个组件有问题');
  await b.close();
})();
