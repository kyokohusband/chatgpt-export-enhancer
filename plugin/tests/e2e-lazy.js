/* 懒渲染场景回归：代码块只有滚进视口才挂 <pre>。
 * 未滚动时导出必须自动补齐，否则会出现「只有 <p>Python</p> 没有代码」。
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(__dirname, 'out');
const PROFILE = path.join(__dirname, '.profile-lazy');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));

let failed = false;
const log = (...a) => console.log(...a);
const fail = (m) => {
  failed = true;
  console.error('✗ ' + m);
};

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1100, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });

  const html = fs.readFileSync(path.join(__dirname, 'fixtures/lazy-mock.html'), 'utf8');
  await ctx.route('https://chatgpt.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  );

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');

  const page = await ctx.newPage();
  await page.goto('https://chatgpt.com/c/lazy-chat');
  await page.waitForSelector('#__cex_frame__', { timeout: 20000 });
  await page.waitForTimeout(1500);

  const before = await page.evaluate(() => window.__lazyStats());
  log('打开后（未滚动）:', JSON.stringify(before));
  if (before.pre >= before.shells) fail('这张测试页没有模拟出懒加载：pre 已经全渲染了');

  const [tab] = await sw.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }));

  const t0 = Date.now();
  const res = await sw.evaluate(
    (id) => chrome.tabs.sendMessage(id, { type: 'cex:export', format: 'html' }),
    tab.id
  );
  const ms = Date.now() - t0;
  if (!res || !res.ok) throw new Error('导出失败：' + (res && res.error));

  const doc = res.data.text;
  fs.writeFileSync(path.join(OUT, 'lazy-export.html'), doc, 'utf8');

  const after = await page.evaluate(() => window.__lazyStats());
  log('导出后:', JSON.stringify(after), '（耗时 ' + ms + 'ms）');

  const pres = (doc.match(/<pre data-language="[^"]*">/g) || []).length;
  const strayLabels = (doc.match(/<p>\s*(Python|Bash|JavaScript)\s*<\/p>/g) || []).length;
  log('导出产物: pre ' + pres + ' 个 · 残留语言标签 ' + strayLabels + ' 处 · ' + Math.round(doc.length / 1024) + ' KB');

  if (pres < after.shells - 1) fail('代码块没补齐：产物 ' + pres + ' 个，页面应有 ' + after.shells + ' 个');
  if (strayLabels > 0) fail('还有 ' + strayLabels + ' 处语言标签被当成正文');
  if (after.rendered < after.shells) fail('滚动没有触发全部懒渲染：' + after.rendered + '/' + after.shells);

  // 语言识别是否正确（第一个代码块是 Python）
  const langs = [...new Set((doc.match(/data-language="([^"]+)"/g) || []).map((s) => s.slice(15, -1)))];
  log('识别到的语言:', langs.join(', '));
  if (langs.some((l) => l === 'text')) fail('有代码块被识别成 text');

  await ctx.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });

  log('');
  log(failed ? '结果：有失败项' : '结果：全部通过');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('✗ 异常:', err && (err.stack || err.message));
  process.exit(1);
});
