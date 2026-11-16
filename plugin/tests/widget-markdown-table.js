const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const runtime = fs.readFileSync(path.resolve(__dirname, '../extension/assets/runtime.js'), 'utf8');
const chrome = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const source = `<box border padding={3}>
  <row>**school 数据库**</row>
  <box>
    <row>**students 表**</row>
    | id | name | age |
    |---:|---|---:|
    | 1 | 张三 | 18 |
    | 2 | 李四 | 19 |
    <row>**courses 表**</row>
    | id | course_name |
    |---:|---|
    | 101 | 数学 |
    | 102 | 英语 |
  </box>
</box>`;

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="wb-widget" data-w="0"></div><script id="wb-widget-data" type="application/json">' + JSON.stringify([source]) + '</script>');
    await page.addScriptTag({ content: runtime });
    const tables = page.locator('.wb-widget table.wb-md-table');
    assert.equal(await tables.count(), 2);
    assert.deepEqual(await tables.first().locator('thead th').allTextContents(), ['id', 'name', 'age']);
    assert.deepEqual(await tables.first().locator('tbody tr').allTextContents(), ['1张三18', '2李四19']);
    assert.deepEqual(await tables.nth(1).locator('tbody tr').allTextContents(), ['101数学', '102英语']);
    assert.doesNotMatch(await page.locator('.wb-widget').innerText(), /\|---/);
    console.log('PASS: aligned Markdown tables inside widgets');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
