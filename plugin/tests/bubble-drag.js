const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const EXT = path.resolve(__dirname, '../extension');
const CHROME = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const URL = 'https://chatgpt.com/c/bubble-test';

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cex-bubble-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME, headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    await context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<html><body><article data-testid="conversation-turn-0"><div data-message-author-role="user">问题</div></article><article data-testid="conversation-turn-1"><div data-message-author-role="assistant"><div class="markdown">回答</div></div></article></body></html>'
    }));
    const page = await context.newPage({ viewport: { width: 1000, height: 800 } });
    await page.goto(URL);
    const frame = page.locator('#__cex_frame__');
    await frame.waitFor();
    await frame.contentFrame().locator('#bubble').waitFor();
    let rect = await frame.boundingBox();
    assert.ok(rect.x > 850, 'bubble starts at right edge');

    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(400, 260, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    rect = await frame.boundingBox();
    assert.ok(rect.x > 320 && rect.x < 410 && rect.y > 185 && rect.y < 270, `bubble stays where dropped: ${JSON.stringify(rect)}`);
    assert.equal(await frame.contentFrame().locator('#panel').isVisible(), false, 'drag does not open panel');

    await page.reload();
    await frame.waitFor();
    await frame.contentFrame().locator('#bubble').waitFor();
    rect = await frame.boundingBox();
    assert.ok(rect.x > 320 && rect.x < 410 && rect.y > 185 && rect.y < 270, 'free position survives reload');

    await frame.contentFrame().locator('#bubble').click();
    await frame.contentFrame().locator('#panel').waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
    rect = await frame.boundingBox();
    assert.ok(rect.x > 150 && rect.x < 260 && rect.width > 300, `panel opens near bubble: ${JSON.stringify(rect)}`);
    await frame.contentFrame().locator('#btnCollapse').click();
    await frame.contentFrame().locator('#bubble').waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
    rect = await frame.boundingBox();
    assert.ok(rect.x > 320 && rect.x < 410 && rect.width === 72, 'collapse restores bubble position');

    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(650, 500, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    rect = await frame.boundingBox();
    assert.ok(rect.x > 570 && rect.x < 660 && rect.y > 420, 'bubble stays at second free position');
    await page.setViewportSize({ width: 700, height: 500 });
    await page.waitForTimeout(250);
    rect = await frame.boundingBox();
    assert.ok(rect.x >= 18 && rect.x + rect.width <= 682 && rect.y >= 18 && rect.y + rect.height <= 482,
      `bubble remains inside resized viewport: ${JSON.stringify(rect)}`);

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ 'cex.bubblePosition.v1': { side: 'left', y: 0.5 } }));
    await page.reload();
    await page.waitForFunction(() => {
      const bubble = document.getElementById('__cex_frame__');
      return bubble && bubble.getBoundingClientRect().left < 40;
    });
    rect = await frame.boundingBox();
    assert.ok(rect.y > 160 && rect.y < 250, 'old edge position migrates to free position');
    console.log('PASS: free drag, persist, click, expand, collapse, resize and old position migration');
  } finally {
    await context.close();
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('cex-bubble-')) {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
