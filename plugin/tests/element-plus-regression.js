// node tests/element-plus-regression.js <repaired-html>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright-core');
const vm = require('node:vm');

(async () => {
  const file = path.resolve(process.argv[2]);
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  for (const script of ['dsl', 'widget']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../extension/content/${script}.js`), 'utf8'), sandbox);
  }
  const tableFixture = '<article class="turn assistant"><p>&lt;table&gt;&lt;table-row&gt;&lt;table-cell&gt;姓名&lt;/table-cell&gt;&lt;/table-row&gt;&lt;/table&gt;</p></article>';
  assert.equal(sandbox.window.__CEX__.widget.collectRegions(tableFixture).length, 1, 'JS engine recognizes standalone DSL tables');
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    const widgets = page.locator('.wb-widget');
    const buttons = widgets.nth(3).locator('button');
    assert.equal(await buttons.count(), 5);
    const colors = await buttons.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
    assert.notEqual(colors[0], colors[2], 'danger must differ from primary');
    assert.equal(await buttons.nth(3).getAttribute('aria-busy'), 'true');
    assert.equal(await buttons.nth(3).isDisabled(), true);
    assert.equal(await buttons.nth(4).isDisabled(), true);

    const layout = widgets.nth(4);
    const bounds = await layout.evaluate(root => {
      const aside = [...root.querySelectorAll('div')].find(node => node.__wbRaw?.props.width === '28%');
      const col = [...root.querySelectorAll('div')].find(node => node.__wbRaw?.tag === 'col');
      const row = col.parentElement;
      return { aside: aside.getBoundingClientRect().height, col: col.getBoundingClientRect().height, row: row.getBoundingClientRect().height, display: getComputedStyle(col).display };
    });
    assert.equal(bounds.display, 'flex');
    assert.ok(Math.abs(bounds.aside - bounds.row) < 1, 'aside fills row height');
    assert.ok(Math.abs(bounds.col - bounds.row) < 1, 'column fills row height');

    const form = widgets.nth(5);
    assert.deepEqual(await form.locator('select option').allTextContents(), ['北京', '上海', '广州']);
    assert.equal(await form.locator('select').inputValue(), 'beijing');
    await form.locator('select').selectOption('shanghai');
    await assert.doesNotReject(() => form.getByText('"region": "shanghai"', { exact: false }).waitFor());
    const date = form.locator('input[type=date]');
    assert.equal(await date.inputValue(), '2026-11-04');
    await date.fill('2026-12-12');
    await assert.doesNotReject(() => form.getByText('"birthday": "2026-12-12"', { exact: false }).waitFor());
    assert.equal(await page.locator('.wb-err').count(), 0);
    assert.deepEqual(errors, []);

    // IME 候选期间节点不能被替换，确认后才更新业务状态。
    const search = page.getByPlaceholder('搜索用户姓名');
    await search.evaluate(el => {
      window.__imeInput = el;
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.value = 'zhang';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }));
    });
    assert.equal(await search.evaluate(el => el === window.__imeInput), true);
    assert.equal(await search.inputValue(), 'zhang');
    await search.evaluate(el => {
      el.value = '张';
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '张' }));
    });
    assert.equal(await search.inputValue(), '张');
    const manager = search.locator('xpath=ancestor::div[contains(@class,"wb-widget")]');
    assert.match(await manager.innerText(), /共 1 条记录/);
    const recoveredTable = page.locator('.wb-widget[data-w="10"]');
    assert.match(await recoveredTable.innerText(), /张三/);
    assert.equal(await recoveredTable.locator('[style*="display: table-row"]').count(), 4);

    // The same component data must work with the plugin's JS runtime too.
    const data = await page.locator('#wb-widget-data').textContent();
    const source = JSON.parse(data);
    await page.setContent(source.map((_, i) => `<div class="wb-widget" data-w="${i}"></div>`).join('') +
      `<script id="wb-widget-data" type="application/json">${data}</script>`);
    await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../extension/assets/runtime.js'), 'utf8') });
    assert.equal(await page.locator('.wb-err').count(), 0);
    assert.equal(await page.locator('select').first().locator('option').count(), 3);
    assert.equal(await recoveredTable.locator('[style*="display: table-row"]').count(), 4);
    await page.setViewportSize({ width: 375, height: 800 });
    assert.equal(await buttons.first().evaluate(node => getComputedStyle(node.parentElement).flexWrap), 'wrap');
    assert.ok(await buttons.first().evaluate(node => node.parentElement.scrollWidth <= node.parentElement.clientWidth + 1));
    await widgets.nth(3).screenshot({ path: path.join(__dirname, 'out/element-plus-buttons.png') });
    await page.setViewportSize({ width: 1000, height: 800 });
    await widgets.nth(4).screenshot({ path: path.join(__dirname, 'out/element-plus-layout.png') });
    await widgets.nth(5).screenshot({ path: path.join(__dirname, 'out/element-plus-form.png') });
    console.log(`PASS: ${source.length} real widgets; IME composition, recovered table, button states, layout, select/date state, mobile wrap, both runtimes`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
