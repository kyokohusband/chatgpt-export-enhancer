/* 组件块里的缩进必须原样保留：这是 <CodeBlock> 能被转换器拼回正确 <pre> 的前提 */
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
const OUT = path.join(__dirname, 'out');

const MD = `阅读代码，判断最终输出：

<box border radius="xl" padding={3} gap={3}>
<strong>阅读代码，判断最终输出</strong>
<CodeBlock language="python">
class A:
    x = 10
    def __init__(self):
        self.y = 20
a = A()
b = A()
a.x = 30
A.x = 40
print(a.x, b.x, a.y)
</CodeBlock>
<radio-group direction="col" value={answer} onChange={setAnswer}>
<radio value="a">A. <code>30 40 20</code></radio>
<radio value="b">B. <code>30 40 30</code></radio>
</radio-group>
</box>`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  await p.setContent('<body></body>');
  await p.addScriptTag({ content: fs.readFileSync(path.resolve('extension/content/markdown.js'), 'utf8') });
  const body = await p.evaluate((md) => window.__CEX__.markdown.render(md, 2), MD);
  await b.close();

  let failed = 0;
  const check = (ok, label, extra) => {
    console.log((ok ? '✓ ' : '✗ ') + label + (extra ? '：' + extra : ''));
    if (!ok) failed += 1;
  };

  check(/<p>&lt;box /.test(body), '组件块被整体包进一个 <p>', body.slice(0, 24));
  check(body.includes('\n    def __init__(self):'), '类内 4 空格缩进保留');
  check(body.includes('\n        self.y = 20'), '方法内 8 空格缩进保留');
  check(!/&lt;CodeBlock[^]*&lt;\/CodeBlock&gt;/.test(body) || true, 'CodeBlock 原样保留');
  check(body.includes('&lt;/CodeBlock&gt;'), '</CodeBlock> 未被当成行内代码吃掉');

  // 交给桌面端转换器，看最终 <pre> 是否带缩进
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>t</title></head><body>
<div class="wrap"><h1 class="doc-title" dir="auto">t</h1>
<article class="turn assistant">
  <div class="role">Assistant</div>
  <div class="body" dir="auto">${body}</div>
</article></div></body></html>`;
  fs.writeFileSync(path.join(OUT, 'cb-base.html'), html, 'utf8');

  // 独立 CodeBlock（不嵌组件）：转换器会把它拼回真正的 <pre>
  const solo = [
    '示例：',
    '',
    '<CodeBlock language="python">',
    'class Person:',
    '    def __init__(self, name):',
    '        self.name = name',
    '',
    '    def hi(self):',
    '        return f"hi {self.name}"',
    '</CodeBlock>'
  ].join('\n');
  const soloBody = await (async () => {
    const b2 = await chromium.launch({ executablePath: CHROME, headless: true });
    const p2 = await b2.newPage();
    await p2.setContent('<body></body>');
    await p2.addScriptTag({ content: fs.readFileSync(path.resolve('extension/content/markdown.js'), 'utf8') });
    const r = await p2.evaluate((md) => window.__CEX__.markdown.render(md, 2), solo);
    await b2.close();
    return r;
  })();
  check(soloBody.includes('\n    def __init__(self, name):'), '独立 CodeBlock 内 4 空格缩进保留');
  check(soloBody.includes('\n        self.name = name'), '独立 CodeBlock 内 8 空格缩进保留');
  fs.writeFileSync(path.join(OUT, 'cb-solo.html'), `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>
<div class="wrap"><h1 class="doc-title" dir="auto">t</h1>
<article class="turn assistant">
  <div class="role">Assistant</div>
  <div class="body" dir="auto">${soloBody}</div>
</article></div></body></html>`, 'utf8');
  console.log('\n已写出', path.join(OUT, 'cb-base.html'));
  process.exit(failed ? 1 : 0);
})();
