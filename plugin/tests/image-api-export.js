const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const extension = path.resolve(__dirname, '../extension');
const url = 'https://chatgpt.com/c/11112222-aaaa-bbbb-cccc-ddddeeeeffff';
const chrome = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cex-image-api-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chrome, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    const mapping = {
      root: { id: 'root', parent: null, message: null },
      user: { id: 'user', parent: 'root', message: {
        id: 'user', author: { role: 'user' }, recipient: 'all', metadata: {},
        content: { content_type: 'text', parts: ['Explain the environment'] }
      } },
      assistant: { id: 'assistant', parent: 'user', message: {
        id: 'assistant', author: { role: 'assistant' }, recipient: 'all', metadata: {},
        content: { content_type: 'multimodal_text', parts: [
          '## Browser environment\n\nTwo common environments.',
          { content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-browser', width: 320, height: 200 },
          '## Node environment'
        ] }
      } },
      imageTool: { id: 'imageTool', parent: 'assistant', message: {
        id: 'imageTool', author: { role: 'tool' }, recipient: 'all', metadata: {},
        content: { content_type: 'image', parts: [
          { content_type: 'image', image_url: 'https://example.com/node.png', width: 320, height: 200 }
        ] }
      } }
    };
    await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
      <article data-testid="conversation-turn-0"><div data-message-author-role="user"><p>Explain the environment</p></div></article>
      <article data-testid="conversation-turn-1"><div data-message-author-role="assistant"><p>Two common environments.</p></div></article>
      <div style="height:2000px"></div><script>window.scrolled = false; addEventListener('scroll', () => { window.scrolled = true; });</script>
      </body></html>` }));
    await context.route('https://chatgpt.com/api/auth/session', route => route.fulfill({ json: { accessToken: 'test-token-1234567890' } }));
    await context.route('https://chatgpt.com/backend-api/conversation/**', route => route.fulfill({ json: {
      title: 'Environments', current_node: 'imageTool', mapping
    } }));

    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForSelector('#__cex_frame__');
    await sw.evaluate(() => chrome.storage.sync.set({ 'cex.settings.v1': { engine: 'js', interactive: false, imageMode: 'link' } }));
    const [tab] = await sw.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }));
    const result = await sw.evaluate(id => chrome.tabs.sendMessage(id, { type: 'cex:export', format: 'html' }), tab.id);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.doesNotMatch(result.data.text, /<img\b|https:\/\/example\.com\/node\.png/);
    assert.match(result.data.text, /此处图片未导出，请到原会话查看/);
    assert.match(result.data.text, /图片未包含在导出文件中/);
    assert.equal(await page.evaluate(() => window.scrolled), false);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await sw.evaluate(() => chrome.storage.sync.set({ 'cex.settings.v1': { engine: 'js', interactive: true, imageMode: 'link' } }));
    const interactive = await sw.evaluate(id => chrome.tabs.sendMessage(id, { type: 'cex:export', format: 'html' }), tab.id);
    assert.equal(interactive.ok, true, JSON.stringify(interactive));
    assert.match(interactive.data.text, /图片未包含在导出文件中/);
    assert.match(interactive.data.text, /此处图片未导出，请到原会话查看/);
    assert.doesNotMatch(interactive.data.text, /<img\b/);
    assert.equal(await page.evaluate(() => window.scrolled), false);
    console.log('PASS: omitted API images show notices without scrolling the page');
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
