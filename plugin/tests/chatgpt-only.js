const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const extension = path.resolve(__dirname, '../extension');
const manifest = require(path.join(extension, 'manifest.json'));
const chromePath = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const allowed = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];

assert.deepEqual(manifest.content_scripts[0].matches, allowed);
assert.deepEqual(manifest.host_permissions, allowed);
assert.deepEqual(manifest.web_accessible_resources[0].matches, allowed);

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cex-site-scope-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath,
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    await context.route(/https:\/\/(chatgpt\.com|claude\.ai)\/c\/site-scope/, route => route.fulfill({
      contentType: 'text/html',
      body: '<article data-testid="conversation-turn-0"><div data-message-author-role="user">问题</div></article><article data-testid="conversation-turn-1"><div data-message-author-role="assistant"><div class="markdown">回答</div></div></article>'
    }));
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/c/site-scope');
    await page.locator('#__cex_frame__').waitFor();
    await page.goto('https://claude.ai/c/site-scope');
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#__cex_frame__').count(), 0);
    console.log('PASS: ChatGPT has bubble; other AI site has none');
  } finally {
    await context.close();
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('cex-site-scope-')) {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
