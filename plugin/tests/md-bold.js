const { chromium } = require('playwright-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
const SRC = fs.readFileSync(path.resolve('extension/content/markdown.js'), 'utf8');

const cases = [
  ['基本', '这是**粗体**文字'],
  ['中文标点', '**注意**：这里要小心'],
  ['带行内代码', '**用 `rm -rf` 删除**'],
  ['跨行', '**第一行\n第二行**'],
  ['粗斜', '***很重要***'],
  ['连续多个', '**A** 和 **B**'],
  ['括号内', '（**重点**）'],
  ['前后空格', '前 **粗体** 后'],
  ['列表项', '- **粗体** 说明'],
  ['标题行', '### **小标题**'],
  ['引用', '> **引用里的粗体**'],
  ['含斜杠', '**A/B**'],
  ['数字单位', '**100%**'],
  ['方括号', '**注意[1]**'],
  ['末尾标点', '**重点。**'],
  ['行首缩进', '  **两空格缩进**'],
];

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  await p.setContent('<html><body></body></html>');
  await p.addScriptTag({ content: SRC });
  const res = await p.evaluate((cs) => cs.map(([name, src]) => {
    let html = '';
    try { html = window.__CEX__.markdown.render(src); } catch (e) { html = 'ERR ' + e.message; }
    return { name, src, html: html.trim(), ok: !html.includes('**') && /<(strong|em|del)>/.test(html) };
  }), cases);
  for (const r of res) console.log((r.ok ? '✓ ' : '✗ ') + r.name.padEnd(10) + ' | ' + JSON.stringify(r.src) + ' -> ' + r.html.replace(/\n/g, '⏎').slice(0, 90));
  await b.close();
})();
