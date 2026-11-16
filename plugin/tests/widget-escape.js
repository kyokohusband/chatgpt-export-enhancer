const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const runtime = fs.readFileSync(path.resolve(__dirname, '../extension/assets/runtime.js'), 'utf8');
const chrome = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const fixture = '<box><box>**Wrapper<escape><</escape>T>**<text>条件构造器</text></box><box>**Map<escape><K,V></escape>**</box></box>';

function realSource(file) {
  if (!file) return null;
  const html = fs.readFileSync(file, 'utf8');
  const match = html.match(/<script id="wb-widget-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'real export has widget data');
  return JSON.parse(match[1].replace(/<\\\//g, '</')).find(source => source.includes('AbstractWrapper'));
}

(async () => {
  const sources = [fixture];
  const actual = realSource(process.argv[2]);
  if (actual) sources.push(actual);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    const roots = sources.map((_, i) => `<div class="wb-widget" data-w="${i}"></div>`).join('');
    await page.setContent(roots + '<script id="wb-widget-data" type="application/json">' + JSON.stringify(sources).replace(/<\//g, '<\\/') + '</script>');
    await page.addScriptTag({ content: runtime });
    const strong = page.locator('.wb-widget[data-w="0"] strong');
    assert.deepEqual(await strong.allTextContents(), ['Wrapper<T>', 'Map<K,V>']);
    assert.equal(await page.locator('.wb-widget escape').count(), 0);
    assert.doesNotMatch(await page.locator('.wb-widget').first().innerText(), /\*\*/);
    if (actual) {
      const root = page.locator('.wb-widget[data-w="1"]');
      assert.equal(await root.locator('strong').first().textContent(), 'Wrapper<T>');
      assert.equal(await root.locator('.wb-err').count(), 0);
      assert.doesNotMatch(await root.innerText(), /\*\*/);
    }
    console.log('PASS: escaped angle brackets stay inline with Markdown emphasis' + (actual ? ' in real MyBatis widget' : ''));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
