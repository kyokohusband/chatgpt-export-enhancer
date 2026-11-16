// node tests/widget-math-real.js <exported-html>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright-core');

(async () => {
  const original = fs.readFileSync(process.argv[2], 'utf8');
  const match = original.match(/<script id="wb-widget-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'sample contains widget data');
  const source = JSON.parse(match[1]).find(item => item.includes('第一步：明确目标'));
  assert.ok(source, 'sample contains the flowchart');
  const asset = name => fs.readFileSync(path.resolve(__dirname, '../extension/assets', name), 'utf8');
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + asset('converter.css') + asset('katex.css') + '</style>' +
    '<script>' + asset('katex.js') + '</script></head><body><div class="wb-widget" data-w="0"></div>' +
    '<script id="wb-widget-data" type="application/json">' + JSON.stringify([source]).replace(/<\//g, '<\\/') + '</script>' +
    '<script>' + asset('runtime.js') + '</script></body></html>';
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 850, height: 920 } });
    await page.setContent(html);
    const widget = page.locator('.wb-widget');
    assert.equal(await widget.locator('.katex').count(), 4);
    assert.doesNotMatch(await widget.innerText(), /\\\(|\\\)/);
    assert.equal(await page.locator('.wb-err').count(), 0);
    await widget.screenshot({ path: path.join(__dirname, 'out/widget-math-real.png') });
    console.log('PASS: all four formulas in the real flowchart render');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
