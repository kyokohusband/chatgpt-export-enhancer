const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright-core');

const extension = path.resolve(__dirname, '../extension');
const chromePath = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cex-split-export-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath, headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.sync.set({
      'cex.settings.v1': { format: 'html', scope: 'all', fileName: '旧文件模板', subfolder: '', interactive: true, engine: 'js', autoLoad: false }
    }));
    await context.route('https://chatgpt.com/c/split-export-test', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<html><head><title>原会话</title></head><body>' +
        '<article data-testid="conversation-turn-0"><div data-message-author-role="user">第一问</div></article>' +
        '<article data-testid="conversation-turn-1"><div data-message-author-role="assistant"><div class="markdown"><h2>自动标题</h2><p>第一答</p><p>&lt;box title="第一组组件"&gt;</p><p>&lt;text&gt;组件内容&lt;/text&gt;</p><p>&lt;/box&gt;</p></div></div></article>' +
        '<article data-testid="conversation-turn-2"><div data-message-author-role="user">第二问</div></article>' +
        '<article data-testid="conversation-turn-3"><div data-message-author-role="assistant"><div class="markdown"><p>第二答</p></div></div></article>' +
        '</body></html>'
    }));
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/c/split-export-test');
    const panel = page.frameLocator('#__cex_frame__');
    await panel.locator('#bubble').click();
    await panel.locator('#exportTitle').fill('统一标题');
    await panel.locator('#splitTurns').check();
    await panel.locator('#btnExport').click();
    await panel.locator('.split-item').first().waitFor();
    assert.equal(await panel.locator('.split-item').count(), 2);
    await panel.locator('.split-item input').first().uncheck();
    await panel.locator('.split-item .split-title').nth(1).fill('第二组专属标题');
    const downloadPromise = page.waitForEvent('download');
    await panel.locator('#splitConfirm').click();
    const download = await downloadPromise;
    const html = fs.readFileSync(await download.path(), 'utf8');
    assert.match(await panel.locator('#toast').textContent(), /已拆分导出 1 组问答/);
    assert.match(html, /<title>第二组专属标题<\/title>/);
    assert.match(html, /<h1 class="doc-title" dir="auto">第二组专属标题<\/h1>/);
    assert.match(html, /第二问/);
    assert.match(html, /第二答/);
    assert.doesNotMatch(html, /第一问|第一答/);
    assert.match(await panel.locator('#toast').textContent(), /第二组专属标题\.html/);

    const allDownloads = [];
    page.on('download', item => allDownloads.push(item));
    await panel.locator('#btnExport').click();
    await panel.locator('#splitAll').click();
    await panel.locator('#splitConfirm').click();
    await panel.locator('#toast').getByText(/已拆分导出 2 组问答/).waitFor();
    assert.equal(allDownloads.length, 2);
    const pages = await Promise.all(allDownloads.map(async item => fs.readFileSync(await item.path(), 'utf8')));
    assert.match(pages[0], /第一问/);
    assert.doesNotMatch(pages[0], /第二问/);
    assert.match(pages[0], /id="wb-widget-data"/);
    assert.match(pages[0], /class="wb-widget"/);
    assert.match(pages[1], /第二问/);
    assert.match(pages[1], /<title>统一标题 - 02 - 第二问<\/title>/);
    assert.doesNotMatch(pages[1], /第一问/);
    assert.doesNotMatch(pages[1], /第一组组件/);
    const preview = await context.newPage();
    const previewPath = path.join(profile, 'split-preview.html');
    fs.writeFileSync(previewPath, pages[0], 'utf8');
    await preview.goto(pathToFileURL(previewPath).href);
    await preview.locator('.wb-widget > *').first().waitFor();
    assert.match(await preview.locator('.wb-widget').innerText(), /组件内容/);
    console.log('PASS: one title controls filename; split picker exports only selected Q&A');
  } finally {
    await context.close();
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('cex-split-export-')) {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
