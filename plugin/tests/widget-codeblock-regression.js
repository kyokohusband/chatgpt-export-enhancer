const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
    headless: true,
  });
  try {
    const file = path.resolve(process.argv[2]);
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file:///' + file.replace(/\\/g, '/'));
    const widget = page.locator('.wb-widget[data-w="4"]');
    const code = widget.locator('pre[data-language="python"] code');
    assert.equal(await code.count(), 1);
    const source = await code.textContent();
    assert.match(source, /^class A:\n    x = 10\n\n    def __init__\(self\):\n        self.y = 20/m);
    assert.match(source, /print\(a.x, b.x, a.y\)$/);
    assert.equal(await code.evaluate(el => getComputedStyle(el.parentElement).whiteSpace), 'pre');
    await widget.locator('input[type="radio"]').first().check();
    const explanation = widget.locator('div[style*="background"]', { hasText: '创建了实例属性' }).last();
    assert.match(await explanation.innerText(), /a\.x = 30 在 a 上创建了实例属性，遮蔽类属性。A\.x = 40 修改了类属性，因此 b\.x 查找到 40。/);
    assert.equal(await explanation.evaluate(el => [...el.children].filter(child => child.tagName === 'CODE').length), 0);
    assert.equal(await page.locator('.wb-err').count(), 0);
    assert.deepEqual(errors, []);
    await widget.screenshot({ path: path.resolve(__dirname, 'out/widget-codeblock-fixed.png') });
    // JS asset and Python embedded runtime must both carry the same fix.
    const runtime = fs.readFileSync(path.resolve(__dirname, '../extension/assets/runtime.js'), 'utf8');
    assert.match(runtime, /case 'CodeBlock'/);
    console.log('PASS: real code block preserves indentation; explanation stays inline');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
