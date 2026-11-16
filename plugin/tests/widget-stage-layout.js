const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const runtime = fs.readFileSync(path.resolve(__dirname, '../extension/assets/runtime.js'), 'utf8');
const chrome = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const fixture = `<box gap={3}>
  <row align="start" gap={3}>
    <box><icon name="code-2" size="lg"/></box>
    <box flex="1" gap={1}>
      **核心层**

      单元 1：Mapper

      单元 2：Wrapper

      单元 3：Service
    </box>
  </row>
  <row><icon name="layers-3" size="lg"/></row>
</box>`;

function sourceFrom(file) {
  if (!file) return fixture;
  const html = fs.readFileSync(file, 'utf8');
  const match = html.match(/<script id="wb-widget-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'real export has widget data');
  const sources = JSON.parse(match[1].replace(/<\\\//g, '</'));
  const source = sources.find(item => item.includes('基础层（理解框架）'));
  assert.ok(source, 'real export has learning-stage widget');
  return source;
}

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 850, height: 900 } });
    const source = sourceFrom(process.argv[2]);
    await page.setContent('<div class="wb-widget" data-w="0"></div>' +
      '<script id="wb-widget-data" type="application/json">' + JSON.stringify([source]).replace(/<\//g, '<\\/') + '</script>');
    await page.addScriptTag({ content: runtime });
    const root = page.locator('.wb-widget');
    assert.equal(await root.locator('.wb-err').count(), 0);
    const units = root.locator('span').filter({ hasText: /^\s*单元 \d+：/ });
    assert.equal(await units.count(), process.argv[2] ? 14 : 3);
    const positions = await units.evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().top));
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] > positions[i - 1], `unit ${i + 1} starts below previous unit`);
    }
    const icons = root.locator('svg');
    assert.equal(await icons.count(), process.argv[2] ? 3 : 2);
    const shapes = await icons.evaluateAll(nodes => nodes.map(el => el.querySelectorAll('path,polyline').length));
    assert.ok(shapes.every(count => count > 1), 'legacy icons use named shapes instead of fallback circles');
    console.log('PASS: unit lines remain separate and legacy stage icons render' + (process.argv[2] ? ' in real export' : ''));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
