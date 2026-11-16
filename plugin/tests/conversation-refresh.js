const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright-core');
const EXT = path.resolve(__dirname, '../extension');
const URL = 'https://chatgpt.com/c/11112222-aaaa-bbbb-cccc-ddddeeeeffff';

function conversation(texts) {
  const mapping = { root: { id: 'root', parent: null, message: null } };
  texts.forEach((text, i) => {
    const id = 'm' + i;
    mapping[id] = { id, parent: i ? 'm' + (i - 1) : 'root', message: {
      id, author: { role: i % 2 ? 'assistant' : 'user' },
      content: { content_type: 'text', parts: [text] }, metadata: {}, recipient: 'all',
    } };
  });
  return { title: '会话名', current_node: 'm' + (texts.length - 1), mapping };
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cex-refresh-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    let texts = ['问题', '# 初始标题\n正文'];
    let requests = 0;
    await context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html', body: '<html><body><main id="thread"></main></body></html>',
    }));
    await context.route('https://chatgpt.com/api/auth/session', route => route.fulfill({
      json: { accessToken: 'test-token-1234567890' },
    }));
    await context.route('https://chatgpt.com/backend-api/conversation/**', route => {
      requests++;
      return route.fulfill({ json: conversation(texts) });
    });
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(URL);
    const render = async () => page.evaluate(values => {
      document.getElementById('thread').innerHTML = values.map((text, i) =>
        `<article data-testid="conversation-turn-${i}"><div data-message-author-role="${i % 2 ? 'assistant' : 'user'}"><div class="markdown prose">${text}</div></div></article>`).join('');
    }, texts);
    await render();
    await page.waitForSelector('#__cex_frame__');
    const [tab] = await sw.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }));
    const status = () => sw.evaluate(id => chrome.tabs.sendMessage(id, { type: 'cex:status' }), tab.id);
    async function waitTitle(title, count) {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const value = await status();
        if (value.title === title && value.count === count) return;
        await page.waitForTimeout(250);
      }
      assert.fail(`Expected title ${title}, count ${count}; got ${JSON.stringify(await status())}`);
    }
    await waitTitle('初始标题', 2);
    // 折叠状态、消息数不变，只修改现有文本节点。
    texts[1] = '# 生成完成的新标题\n完整回答';
    await page.evaluate(value => {
      document.querySelector('[data-message-author-role="assistant"] .markdown').firstChild.nodeValue = value;
    }, texts[1]);
    await waitTitle('生成完成的新标题', 2);
    texts.push('第二个问题', '# 第二轮标题\n第二轮回答');
    await render();
    await waitTitle('第二轮标题', 4);
    // 没等观察器触发就导出，仍须读取最新内容。
    texts[3] = '# 导出时的最新标题\n最后更新的完整回答';
    const result = await sw.evaluate(id => chrome.tabs.sendMessage(id, { type: 'cex:export', format: 'markdown' }), tab.id);
    assert.equal(result.ok, true);
    assert.equal(result.data.title, '导出时的最新标题');
    assert.match(result.data.text, /最后更新的完整回答/);
    assert.match(result.data.filename, /导出时的最新标题\.md$/);
    assert.deepEqual(errors, []);
    assert.ok(requests >= 4);
    console.log('PASS: collapsed panel, text-only generation, new replies, latest export/title/filename');
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
