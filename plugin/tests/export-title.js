const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const extension = path.resolve(__dirname, '../extension');
const chromePath = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cex-export-title-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath,
    headless: true,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.sync.set({
      'cex.settings.v1': { format: 'html', scope: 'all', fileName: '{title}', subfolder: '', interactive: false, engine: 'js', autoLoad: false }
    }));
    await context.route('https://chatgpt.com/c/export-title-test', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<html><head><title>原会话标题</title></head><body><article data-testid="conversation-turn-0"><div data-message-author-role="user">问题</div></article><article data-testid="conversation-turn-1"><div data-message-author-role="assistant"><div class="markdown"><h2>自动标题</h2><p>回答</p></div></div></article></body></html>'
    }));
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/c/export-title-test');
    const panel = page.frameLocator('#__cex_frame__');
    await panel.locator('#bubble').click();
    await panel.locator('#exportTitle').waitFor({ state: 'visible' });
    assert.equal(await panel.locator('#exportTitle').inputValue(), '自动标题');

    await panel.locator('#exportTitle').fill('自定义导出标题');
    const downloadPromise = page.waitForEvent('download');
    await panel.locator('#btnExport').click();
    const download = await downloadPromise;
    assert.match(await panel.locator('#toast').textContent(), /自定义导出标题\.html/);
    const html = fs.readFileSync(await download.path(), 'utf8');
    assert.match(html, /<title>自定义导出标题<\/title>/);
    assert.match(html, /<h1 class="doc-title" dir="auto">自定义导出标题<\/h1>/);

    await panel.locator('#exportTitle').fill('');
    const automatic = page.waitForEvent('download');
    await panel.locator('#btnExport').click();
    await automatic;
    assert.match(await panel.locator('#toast').textContent(), /自动标题\.html/);
    console.log('PASS: editable export title changes document and filename; empty title restores automatic title');
  } finally {
    await context.close();
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('cex-export-title-')) {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
