/* 端到端验证「走接口取数」这条新路径。
 *
 * 关键设计：页面故意用 lazy-mock.html —— 它上面只有 2 / 40 个代码块是真渲染的，
 * 如果导出结果跟页面 DOM 一致，说明接口没生效；如果导出是 fixture 里那 3 段完整
 * 代码，说明内容来自接口、与页面渲染无关。
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(__dirname, 'out');
const PROFILE = path.join(__dirname, '.profile-api');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
const CONV = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/conversation-api.json'), 'utf8'));
const URL = 'https://chatgpt.com/c/68a1b2c3-1111-2222-3333-444455556666';

let failed = 0;
const log = (...a) => console.log(...a);
function check(ok, label, extra) {
  if (ok) log('✓ ' + label + (extra ? '：' + extra : ''));
  else {
    log('✗ ' + label + (extra ? '：' + extra : ''));
    failed += 1;
  }
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });

  // 先挂兜底页面（Playwright 后注册的优先，所以兜底必须最先注册）
  const pageHtml = fs.readFileSync(path.join(__dirname, 'fixtures/lazy-mock.html'), 'utf8');
  await ctx.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml })
  );

  // 接口打桩：登录态 + 会话数据
  await ctx.route('https://chatgpt.com/api/auth/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'test-token-1234567890' }) })
  );
  await ctx.route('https://chatgpt.com/backend-api/conversation/**', (route) => {
    const headers = route.request().headers();
    if (headers.authorization !== 'Bearer test-token-1234567890') {
      return route.fulfill({ status: 401, body: 'unauthorized' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONV) });
  });

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#__cex_frame__', { timeout: 30000 });

  const [tab] = await sw.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }));

  // 等接口数据落到 state 里
  let status = null;
  for (let i = 0; i < 40; i++) {
    status = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'cex:status' }), tab.id);
    if (status && status.source === 'api') break;
    await page.waitForTimeout(300);
  }

  check(status && status.source === 'api', '消息来源', status && status.source);
  check(status && status.count === 4, '消息条数（应过滤 system/tool/隐藏消息）', status && status.count);
  check(status && status.title === '组件使用教程', '标题来自接口', status && status.title);
  if (status && status.apiError) log('  接口错误：', status.apiError);

  const roles = status ? status.messages.map((m) => m.role).join(',') : '';
  check(roles === 'user,assistant,user,assistant', '角色顺序', roles);

  // 面板截图（确认「接口」徽章）
  // 面板截图（确认「接口」徽章）
  const panelFrame = page.frameLocator('#__cex_frame__');
  await panelFrame.locator('#bubble').click();
  await panelFrame.locator('.row').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator('#__cex_frame__').screenshot({ path: path.join(OUT, 'api-panel.png') });
  const panelRows = await panelFrame.locator('.row').count();
  check(panelRows === 4, '面板列出接口里的 4 条消息', panelRows);
  const sourceBadge = (await panelFrame.locator('#source').innerText()).trim();
  check(sourceBadge === '接口', '面板显示「接口」徽章', sourceBadge);

  /* ---------------------------------------------------------------- 导出 HTML */
  const res = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'cex:export', format: 'html' }), tab.id);
  if (!res || !res.ok) {
    log('✗ 导出失败：' + (res && res.error));
    await ctx.close();
    process.exit(1);
  }
  const doc = res.data.text;
  fs.writeFileSync(path.join(OUT, 'api-interactive.html'), doc, 'utf8');

  const langs = [...doc.matchAll(/<pre data-language="([^"]*)">/g)].map((m) => m[1]);
  check(langs.length === 4, '代码块数量（页面 DOM 只有 2 个）', langs.length + ' → ' + langs.join('/'));
  check(!langs.includes('text') && !langs.includes(''), '代码块语言都不是 text', langs.join('/'));
  check(langs.join(',') === 'python,bash,python,bash', '代码块语言按原文识别', langs.join(','));
  check(/<pre data-language="python"><code>class Person:\n {4}def __init__\(self, name: str\):\n {8}self\.name = name/.test(doc),
    '<CodeBlock> 组件里的代码缩进保留', (doc.match(/<pre data-language="python"><code>class Person[\s\S]{0,60}/) || ['(无)'])[0].slice(-40));

  const orphans = (doc.match(/<p>\s*(Python|Bash|JavaScript|纯文本|文本)\s*<\/p>/g) || []).length;
  check(orphans === 0, '没有孤立语言标签', orphans + ' 处');

  check(/<div class="role">User &amp;middot;|User &middot;/.test(doc), '.role 带时间戳');
  const roleSamples = [...doc.matchAll(/<div class="role">([^<]*)<\/div>/g)].map((m) => m[1]);
  check(roleSamples.length === 4 && /^User &middot; \d{4}-\d{2}-\d{2} \d{2}:\d{2} GMT/.test(roleSamples[0]), '时间格式与真实导出一致', roleSamples[0]);

  check((doc.match(/<div class="body" dir="auto">/g) || []).length === 4, 'body 带 dir="auto"');
  check(/<h1 class="doc-title" dir="auto">/.test(doc), 'doc-title 带 dir="auto"');
  check(/<article class="turn user">\n  <div class="role">/.test(doc), 'article/role 缩进与真实导出一致');
  check(!/data-index=/.test(doc), '没有多余的 data-index');
  check(/<table><thead><tr><th>参数<\/th>/.test(doc), '表格还原');
  check(/<blockquote><p>注意：容器内不要留写权限。<\/p><\/blockquote>/.test(doc), '引用还原');
  check(/<ul><li>资源限制<ul><li>内存：<code>--memory 256m<\/code><\/li>/.test(doc), '嵌套列表还原');
  check(/<em>\[attachment: 截图\.png\]<\/em>/.test(doc), '附件名保留');
  // 附件里已列过的图片不再重复占位（与真实导出同一规则）
  check(!/_\[image\]_/.test(doc), '已列进附件的图片不重复占位');
  check(res.data.widgets >= 1, '组件已还原', String(res.data.widgets));
  check(/wb-widget/.test(doc), '产物里注入了组件运行时');

  /* ------------------------------------------------------- 静态模式（给桌面端） */
  await sw.evaluate(async () => {
    const bag = await chrome.storage.sync.get('cex.settings.v1');
    const cur = bag['cex.settings.v1'] || {};
    await chrome.storage.sync.set({ 'cex.settings.v1': Object.assign({}, cur, { interactive: false }) });
  });
  await page.waitForTimeout(600);
  const raw = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'cex:export', format: 'html' }), tab.id);
  if (!raw || !raw.ok) {
    log('✗ 静态导出失败：' + (raw && raw.error));
    failed += 1;
  } else {
    fs.writeFileSync(path.join(OUT, 'api-static.html'), raw.data.text, 'utf8');
    log('✓ 静态 HTML 已保存：' + path.join(OUT, 'api-static.html'));
  }

  const viewer = await ctx.newPage();
  await viewer.goto('file:///' + path.join(OUT, 'api-interactive.html').replace(/\\/g, '/'));
  await viewer.waitForTimeout(1800);
  await viewer.screenshot({ path: path.join(OUT, 'api-export.png'), fullPage: true });
  const mounted = await viewer.locator('.wb-widget > *').count();
  const tocCount = await viewer.locator('.wb-toc').count();
  check(mounted >= 1, '导出页组件正常挂载', String(mounted));
  check(tocCount >= 1, '导出页有目录', String(tocCount));

  // 组件里的按钮必须真的能点（说明 DSL 源码完整穿过 Markdown -> converter）
  const btn = viewer.locator('.wb-widget button').first();
  const before = (await btn.innerText()).trim();
  await btn.click();
  await viewer.waitForTimeout(400);
  const after = (await btn.innerText()).trim();
  check(before !== after && /1 次/.test(after), '组件按钮可交互', JSON.stringify(before) + ' → ' + JSON.stringify(after));
  await viewer.close();

  await page.screenshot({ path: path.join(OUT, 'api-page.png') });
  log(errors.length ? '页面错误：' + errors.slice(0, 3).join(' | ') : '✓ 页面无 JS 错误');

  await ctx.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });

  log(failed ? `\n结果：${failed} 项未通过` : '\n结果：全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
