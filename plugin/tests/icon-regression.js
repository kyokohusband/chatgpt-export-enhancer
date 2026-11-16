const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright-core');

(async () => {
  const source = '<box border padding={3} gap={2}>\n' +
    '<row><icon name="check-circle" color="success"/>继续当前思路</row>\n' +
    '<row><icon name="alert-triangle" color="caution"/>暂停并重新审视</row>\n' +
    '<row><icon name="refresh-cw" color="secondary"/>尝试更换方法</row>\n</box>';
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="wb-widget" data-w="0"></div>' +
      '<script id="wb-widget-data" type="application/json">' + JSON.stringify([source]) + '</script>');
    await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../extension/assets/runtime.js'), 'utf8') });
    const svg = page.locator('.wb-widget svg');
    assert.equal(await svg.count(), 3);
    assert.ok(await svg.nth(0).locator('path').count() > 0, 'check icon has a check mark');
    assert.ok(await svg.nth(1).locator('path').count() > 0, 'warning icon has an exclamation mark');
    assert.equal(await svg.nth(1).getAttribute('stroke'), '#d97706');
    assert.equal(await page.locator('.wb-err').count(), 0);
    await page.locator('.wb-widget').screenshot({ path: path.resolve(__dirname, 'out/icon-regression.png') });
    console.log('PASS: legacy icon names, check/warning shapes and caution color');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
