/* 在真实 ChatGPT 分享页上跑一次导出，验证语言标签（pre 内部）与 CodeMirror 代码块 */
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(__dirname, 'out');
const PROFILE = path.join(__dirname, '.profile-real');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
const URL = process.argv[2] || 'https://chatgpt.com/share/90c41b0a-f4ec-4afb-af78-12c70b91c378';

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME, headless: true,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');

  const page = await ctx.newPage();
  console.log('打开:', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(7000);

  const raw = await page.evaluate(() => ({
    pres: document.querySelectorAll('pre').length,
    cm: document.querySelectorAll('.cm-editor').length,
    roles: document.querySelectorAll('[data-message-author-role]').length,
    articles: document.querySelectorAll('article[data-testid^="conversation-turn-"]').length
  }));
  console.log('页面原始:', JSON.stringify(raw));

  const hasFrame = await page.locator('#__cex_frame__').count().catch(() => 0);
  console.log('插件面板已注入:', !!hasFrame);
  if (!hasFrame) { console.error('✗ content script 没注入'); await ctx.close(); process.exit(1); }

  const [tab] = await sw.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }));
  const status = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'cex:status' }), tab.id);
  console.log('识别到消息:', status.count, '条 · 站点:', status.site, '· 适配器:', status.adapterId);

  const t0 = Date.now();
  const res = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'cex:export', format: 'html' }), tab.id);
  console.log('导出耗时:', Date.now() - t0, 'ms');
  if (!res || !res.ok) { console.error('✗ 导出失败:', res && res.error); await ctx.close(); process.exit(1); }

  const doc = res.data.text;
  fs.writeFileSync(path.join(OUT, 'real-share.html'), doc, 'utf8');

  const langs = [...doc.matchAll(/<pre data-language="([^"]*)">/g)].map((m) => m[1]);
  const orphans = (doc.match(/<p>\s*(Python|Bash|JavaScript|纯文本|文本)\s*<\/p>/g) || []).length;
  console.log('产物: 代码块', langs.length, '· 孤立标签', orphans, '·', Math.round(doc.length / 1024), 'KB');
  console.log('语言:', [...new Set(langs)].join(', ') || '(无)');

  await page.screenshot({ path: path.join(OUT, 'real-share-page.png') });
  await ctx.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });

  let bad = false;
  if (!langs.length) { console.error('✗ 一个代码块都没抓到'); bad = true; }
  if (orphans) { console.error('✗ 仍有孤立语言标签'); bad = true; }
  if (langs.includes('text') && langs.length) { console.error('✗ 有代码块语言是 text'); bad = true; }
  console.log(bad ? '结果：有失败项' : '结果：通过');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
