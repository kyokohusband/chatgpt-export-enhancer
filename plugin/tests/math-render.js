const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright-core');

const extension = path.resolve(__dirname, '../extension');
const read = file => fs.readFileSync(path.join(extension, file), 'utf8');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<!doctype html><html><head></head><body></body></html>');
    for (const file of ['content/serialize.js', 'assets/katex.js', 'content/markdown.js', 'content/dsl.js', 'content/widget.js', 'content/exporters.js']) {
      await page.addScriptTag({ content: read(file) });
    }
    const result = await page.evaluate(async css => {
      const C = window.__CEX__;
      const md = [
        '物理公式 $E=mc^2$，方程 \\(F=ma\\)。价格是 \\$5，也可以写 $5 and $10。',
        '',
        '$$',
        '\\int_0^1 x^2\\,dx=\\frac{1}{3}',
        '$$',
        '',
        '\\[',
        '\\frac{a}{b}=c',
        '\\]',
        '',
        '$$a^2=b^2+c^2$$',
        '',
        '$$e^2=1-\\frac{b^2}{a^2}$$',
        '',
        '```text',
        '$E=mc^2$',
        '```',
      ].join('\n');
      const dom = document.createElement('div');
      dom.innerHTML = '<p>DOM 公式 <span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">x^2+y^2=z^2</annotation></semantics></math></span></span></p>';
      const messages = [{ role: 'assistant', md }, { role: 'assistant', content: dom }];
      const deps = { getAsset: async name => css[name] };
      const doc = await C.exporters.buildHTML(messages, { title: '公式测试', site: 'ChatGPT' }, { interactive: false }, deps);
      const built = await C.exporters.buildHTML(messages, { title: '公式测试', site: 'ChatGPT' }, { interactive: true, engine: 'js' }, {
        getAsset: async name => css[name],
      });
      const widgetSource = '<box border padding={3} gap={2}>\n  **第一步：明确目标**\n  求 \\(e=c/a\\)，而不是所有线段长度\n  设 \\(PF_1=m,\\ PF_2=n\\)\n</box>';
      const widget = await C.exporters.buildHTML([{ role: 'assistant', md: widgetSource }],
        { title: '组件公式', site: 'ChatGPT' }, { interactive: true, engine: 'js' }, deps);
      return { doc: doc.doc, built: built.doc, widget: widget.doc,
        widgetBase: C.exporters.baseHTML([{ role: 'assistant', md: widgetSource }], { title: '组件公式', site: 'ChatGPT' }, {}),
        base: C.exporters.baseHTML(messages, { title: '公式测试', site: 'ChatGPT' }, {}),
        inline: C.markdown.renderInline('代码 `$x$` 公式 $x^2$') };
    }, {
      'katex.css': read('assets/katex.css'),
      'katex.js': read('assets/katex.js'),
      'runtime.js': read('assets/runtime.js'),
      'hljs.js': read('assets/hljs.js'),
      'hljs.css': read('assets/hljs.css'),
      'converter.css': read('assets/converter.css'),
      'toc.js': read('assets/toc.js'),
      'mermaid.js': '',
    });
    assert.match(result.inline, /<code>\$x\$<\/code>/);
    assert.match(result.inline, /class="katex"/);
    assert.doesNotMatch(result.doc, /<span class="cex-math">[^<]*5 and/);
    for (const html of [result.doc, result.built]) {
      assert.match(html, /id="cex-katex"/);
      assert.match(html, /data:font\/woff2;base64,/);
      assert.match(html, /class="katex"/);
      assert.match(html, /class="cex-math-block"/);
      assert.match(html, /<code>\$E=mc\^2\$<\/code>/);
      assert.doesNotMatch(html, /url\(fonts\//);
    }
    const python = spawnSync('python', ['-c',
      'import sys;sys.path.insert(0,sys.argv[1]);import converter;r=converter.convert_html(sys.stdin.read());assert r.ok,r.message;assert r.extra["doc"].count("class=\\"cex-math")>=4;print("Python conversion preserves math")',
      path.resolve(__dirname, '../../desktop/app')], { input: result.base, encoding: 'utf8' });
    assert.equal(python.status, 0, python.stderr || python.stdout);
    assert.match(result.widget, /id="cex-katex-runtime"/);
    assert.match(result.widget, /id="cex-katex"/);
    await page.setContent(result.widget);
    assert.equal(await page.locator('.wb-widget .katex').count(), 2);
    assert.doesNotMatch(await page.locator('.wb-widget').innerText(), /\\\(/);
    const pyWidget = spawnSync('python', ['-c',
      'import sys;sys.path.insert(0,sys.argv[1]);import converter;r=converter.convert_html(sys.stdin.read());assert r.ok,r.message;sys.stdout.write(r.extra["doc"])',
      path.resolve(__dirname, '../../desktop/app')], { input: result.widgetBase, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(pyWidget.status, 0, pyWidget.stderr);
    const pythonExport = await page.evaluate(async ({ doc, css, js }) => {
      const out = await window.__CEX__.exporters.buildHTML([], { title: '组件公式' }, {}, {
        pyConvert: async () => ({ ok: true, doc, widgets: 1 }),
        getAsset: async name => ({ 'katex.css': css, 'katex.js': js })[name],
      });
      return out.doc;
    }, { doc: pyWidget.stdout, css: read('assets/katex.css'), js: read('assets/katex.js') });
    await page.setContent(pythonExport);
    assert.equal(await page.locator('.wb-widget .katex').count(), 2);
    await page.setContent(result.built);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.cex-math-block .katex-display').count(), 4);
    const bounds = await page.locator('.cex-math-block').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      const formula = node.querySelector('.katex-html').getBoundingClientRect();
      return { boxTop: box.top, boxBottom: box.bottom, formulaTop: formula.top, formulaBottom: formula.bottom };
    }));
    for (const { boxTop, boxBottom, formulaTop, formulaBottom } of bounds) {
      assert.ok(formulaTop >= boxTop - 1 && formulaBottom <= boxBottom + 1, 'formula stays within visible vertical space');
    }
    assert.ok(await page.locator('.cex-math .katex').count() >= 3);
    assert.equal(await page.locator('pre code').textContent(), '$E=mc^2$');
    assert.equal(await page.locator('p').filter({ hasText: '价格是' }).count(), 1);
    await page.screenshot({ path: path.join(__dirname, 'out/math-preview.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: body and widget formulas, DOM KaTeX, code isolation, offline fonts, JS/Python exports');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
