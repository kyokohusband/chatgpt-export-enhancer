// node tests/three-issues-real.js <exported-html>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright-core');

(async () => {
  const original = fs.readFileSync(process.argv[2], 'utf8');
  const match = original.match(/<script id="wb-widget-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'sample contains widget data');
  const all = JSON.parse(match[1]);
  const sources = [all[0], all[5], all[7]];
  const asset = name => fs.readFileSync(path.resolve(__dirname, '../extension/assets', name), 'utf8');
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + asset('converter.css') + asset('katex.css') +
    '</style><script>' + asset('katex.js') + '</script></head><body>' +
    sources.map((_, i) => `<div class="wb-widget" data-w="${i}"></div>`).join('') +
    '<script id="wb-widget-data" type="application/json">' + JSON.stringify(sources).replace(/<\//g, '<\\/') + '</script>' +
    '<script>' + asset('runtime.js') + '</script></body></html>';
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 850, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(html);
    const widgets = page.locator('.wb-widget');
    assert.equal(await page.locator('.wb-err').count(), 0);
    assert.deepEqual(errors, []);
    assert.equal(await widgets.nth(0).locator('.katex').count(), 2);
    const cards = await widgets.nth(0).evaluate(root => {
      const grid = [...root.querySelectorAll('div')].find(node => node.__wbRaw?.tag === 'grid');
      return [...grid.children].map(node => node.getBoundingClientRect().height);
    });
    assert.ok(Math.abs(cards[0] - cards[1]) < 1, 'comparison cards share one row height');
    const slider = widgets.nth(1).locator('input.wb-slider');
    assert.equal(await slider.evaluate(el => getComputedStyle(el).appearance), 'none');
    const bar = await widgets.nth(1).evaluate(root => {
      const el = [...root.querySelectorAll('div')].find(node => node.__wbRaw?.props.direction === 'row');
      return { direction: getComputedStyle(el).flexDirection,
        widths: [...el.children].map(child => child.getBoundingClientRect().width),
        height: el.getBoundingClientRect().height };
    });
    assert.equal(bar.direction, 'row');
    assert.ok(Math.abs(bar.widths[0] / bar.widths[1] - 5 / 3) < .1);
    assert.ok(Math.abs(bar.height - 18) < 1);
    const diagram = await widgets.nth(2).evaluate(root => {
      const grid = [...root.querySelectorAll('div')].find(node => node.__wbRaw?.tag === 'grid');
      return { width: grid.getBoundingClientRect().width, parent: grid.parentElement.getBoundingClientRect().width,
        cells: [...grid.children].map(node => node.getBoundingClientRect()) };
    });
    assert.ok(diagram.width >= diagram.parent - 30);
    assert.ok(diagram.cells[1].x > diagram.cells[0].x);
    for (let i = 0; i < 3; i++) {
      await widgets.nth(i).screenshot({ path: path.resolve(__dirname, `out/three-issues-${i}.png`) });
    }
    await slider.evaluate(el => { el.value = '180'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.match(await widgets.nth(1).innerText(), /180 分钟/);
    assert.match(await widgets.nth(1).innerText(), /90 分钟/);
    console.log('PASS: aligned/gathered math, slider and segmented bar, full-width relation grid');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
