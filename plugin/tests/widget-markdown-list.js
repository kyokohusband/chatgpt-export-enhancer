const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const runtime = fs.readFileSync(path.resolve(__dirname, '../extension/assets/runtime.js'), 'utf8');
const chrome = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const fixture = `<grid columns={2} gap={3}>
  <grid-item>
    **浏览器环境**
    <text size="xs">提供网页相关能力。</text>
    - window
    - document
    - DOM
    - localStorage
    - 浏览器事件
  </grid-item>
  <grid-item>
    **Node.js 环境**
    <text size="xs">提供服务器相关能力。</text>
    - 文件系统
    - 网络服务
    - 进程管理
    - 模块加载
  </grid-item>
</grid>`;

function sourceFrom(file) {
  if (!file) return fixture;
  const html = fs.readFileSync(file, 'utf8');
  const match = html.match(/<script id="wb-widget-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'real export has widget data');
  const sources = JSON.parse(match[1]);
  const source = sources.find(item => item.includes('localStorage') && item.includes('grid-item'));
  assert.ok(source, 'real export has environment grid');
  return source;
}

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 800 } });
    const source = sourceFrom(process.argv[2]);
    await page.setContent('<div class="wb-widget" data-w="0"></div>' +
      '<script id="wb-widget-data" type="application/json">' + JSON.stringify([source]).replace(/<\//g, '<\\/') + '</script>');
    await page.addScriptTag({ content: runtime });
    const root = page.locator('.wb-widget');
    assert.equal(await root.locator('.wb-err').count(), 0);
    const lists = root.locator('ul');
    assert.equal(await lists.count(), 2);
    assert.deepEqual(await lists.first().locator('li').allTextContents(),
      ['window', 'document', 'DOM', 'localStorage', '浏览器事件']);
    assert.equal(await lists.nth(1).locator('li').count(), 4);
    const tops = await lists.first().locator('li').evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().top));
    assert.ok(tops.every((top, index) => index === 0 || top > tops[index - 1]), 'list items appear on separate lines');
    console.log('PASS: Markdown lists in grid items render as vertical bullet lists');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
