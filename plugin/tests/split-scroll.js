const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const extension = path.resolve(__dirname, '../extension');
const chromePath = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cex-split-scroll-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    const turns = Array.from({ length: 16 }, (_, i) =>
      '<article data-testid="conversation-turn-' + (i * 2) + '"><div data-message-author-role="user">第 ' + (i + 1) +
      ' 问：这是比较长的提问内容，用于检查拆分列表能否滚动到最后一项</div></article>' +
      '<article data-testid="conversation-turn-' + (i * 2 + 1) + '"><div data-message-author-role="assistant"><div class="markdown">第 ' + (i + 1) + ' 答</div></div></article>'
    ).join('');
    await context.route('https://chatgpt.com/c/split-scroll-test', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<html><head><title>滚动测试</title></head><body>' + turns + '</body></html>'
    }));
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/c/split-scroll-test');
    const panel = page.frameLocator('#__cex_frame__');
    await panel.locator('#bubble').click();
    await panel.locator('#splitTurns').check();
    await panel.locator('#btnExport').click();
    assert.equal(await panel.locator('.split-item').count(), 16);
    const before = await panel.locator('#splitList').evaluate(el => ({
      height: el.clientHeight, full: el.scrollHeight, top: el.scrollTop,
      cardBottom: el.closest('.split-card').getBoundingClientRect().bottom,
      actionsBottom: el.nextElementSibling.getBoundingClientRect().bottom,
      viewport: innerHeight
    }));
    assert.ok(before.full > before.height, 'list has a scrollable viewport');
    assert.ok(before.actionsBottom <= before.viewport, 'bottom actions stay inside panel');
    await panel.locator('#splitList').hover();
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(150);
    const after = await panel.locator('#splitList').evaluate(el => el.scrollTop);
    assert.ok(after > before.top, 'wheel scroll moves the split list');
    await panel.locator('.split-item').last().scrollIntoViewIfNeeded();
    assert.ok(await panel.locator('#splitConfirm').isVisible(), 'export action remains visible at list end');
    console.log('PASS: long split list scrolls while actions remain visible');
  } finally {
    await context.close();
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('cex-split-scroll-')) {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
