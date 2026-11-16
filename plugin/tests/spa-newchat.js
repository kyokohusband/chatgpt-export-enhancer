/**
 * 复现「新会话面板不出现/不更新」：
 *  1) 空对话页不打扰（无面板）
 *  2) 动态注入消息（模拟新会话首轮回复）→ 面板自动出现
 *  3) SPA 切换会话（pushState + 换 DOM）→ 面板消息列表跟着切换（不作废旧缓存就是此 bug）
 * 运行：node tests/spa-newchat.js
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const PROFILE = path.join(__dirname, '.profile-spa');
const CHROME = process.env.CHROME_PATH || [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));

const PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>新聊天 | ChatGPT</title></head>
<body><main id="main"><div id="thread"></div></main></body></html>`;

function turns(userText, aiText) {
  return `
<article data-testid="conversation-turn-0" data-turn-id="u1">
  <div class="user-message-bubble-color" data-message-author-role="user" data-message-id="um1">
    <div class="whitespace-pre-wrap">${userText}</div>
  </div>
</article>
<article data-testid="conversation-turn-1" data-turn-id="a1">
  <div data-message-author-role="assistant" data-message-id="am1">
    <div class="markdown prose"><p>${aiText}</p></div>
  </div>
</article>`;
}

let failed = 0;
const check = (ok, label, extra) => {
  console.log((ok ? '✓ ' : '✗ ') + label + (extra !== undefined ? '：' + extra : ''));
  if (!ok) failed += 1;
};

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });

  await context.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE })
  );
  await context.route('https://chatgpt.com/api/auth/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'tk-12345678' }) })
  );

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  check(!(await page.$('#__cex_frame__')), '空对话页不打扰（无面板）');

  // 场景 2：新会话首轮回复出现 → 面板自动出现
  await page.evaluate((h) => { document.getElementById('thread').innerHTML = h; }, turns('会话A的问题', '会话A的回复'));
  await page.waitForTimeout(2500);
  check(!!(await page.$('#__cex_frame__')), '新会话消息出现后面板自动出现');

  // 场景 3：SPA 切换到会话 B（pushState + 换 DOM）
  const [tab] = await sw.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }));
  const status = async () => sw.evaluate(
    (id) => chrome.tabs.sendMessage(id, { type: 'cex:status' }),
    tab.id
  );

  await page.evaluate(() => {
    history.pushState({}, '', '/c/11112222-aaaa-bbbb-cccc-ddddeeeeffff');
  });
  await page.evaluate((h) => { document.getElementById('thread').innerHTML = h; }, turns('会话B的问题', '会话B的回复'));
  await page.waitForTimeout(3000);
  let st = await status();
  check(st.url.includes('/c/11112222'), '状态里是会话 B 的 URL', st.url);
  check(st.count === 2, '面板采集到会话 B 的消息', st.count);

  // 场景 4：再切一次（回首页再进新会话）
  await page.evaluate(() => {
    history.pushState({}, '', 'https://chatgpt.com/');
    document.getElementById('thread').innerHTML = '';
  });
  await page.waitForTimeout(2500);
  st = await status();
  check(st.count === 0, '切回空对话页消息清零', st.count);

  check(errors.length === 0, '页面无 JS 错误', errors.length ? errors[0] : '');

  await context.close();
  console.log(failed === 0 ? '结果：全部通过' : '结果：' + failed + ' 项失败');
  process.exit(failed === 0 ? 0 : 1);
})();
