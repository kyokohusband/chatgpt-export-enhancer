/* 验证「插件内 Python 引擎」与桌面端 converter.py 输出完全一致。
 *
 * 步骤：
 *   1. 用扩展导出静态 HTML（interactive=false）→ 这就是 base
 *   2. 用扩展导出 Python 引擎产物（interactive=true, engine=python）
 *   3. 把 base 交给本机 app/converter.py 转换
 *   4. 比较两个产物的 sha256
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(__dirname, 'out');
const PROFILE = path.join(__dirname, '.profile-py');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));

const log = (...a) => console.log(...a);
let failed = false;
const fail = (m) => {
  failed = true;
  console.error('✗ ' + m);
};

const setSettings = (sw, patch) =>
  sw.evaluate(async (p) => {
    const KEY = 'cex.settings.v1';
    const bag = await chrome.storage.sync.get(KEY);
    const cur = bag[KEY] || {};
    await chrome.storage.sync.set({ [KEY]: Object.assign({}, cur, p) });
  }, patch);

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });

  const html = fs.readFileSync(path.join(__dirname, 'fixtures/chatgpt-mock.html'), 'utf8');
  await ctx.route('https://chatgpt.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  );

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('https://chatgpt.com/c/mock-chat');
  await page.waitForSelector('#__cex_frame__', { timeout: 20000 });
  await page.waitForTimeout(1200);

  const tabs = await sw.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }));
  const tab = tabs[0];
  log('✓ 页面就绪:', tab.url);

  // --- 1. 静态 base ---
  await setSettings(sw, { interactive: false, engine: 'python' });
  await page.waitForTimeout(500);
  const base = await sw.evaluate(
    (tabId) => chrome.tabs.sendMessage(tabId, { type: 'cex:export', format: 'html' }),
    tab.id
  );
  if (!base || !base.ok) throw new Error('静态导出失败：' + (base && base.error));
  const baseFile = path.join(OUT, 'py-base.html');
  fs.writeFileSync(baseFile, base.data.text, 'utf8');
  log('✓ 静态 base:', base.data.count, '条 ·', Buffer.byteLength(base.data.text), 'bytes · engine=' + base.data.engine);

  // --- 2. Python 引擎产物 ---
  await setSettings(sw, { interactive: true, engine: 'python' });
  await page.waitForTimeout(500);
  const t0 = Date.now();
  const py = await sw.evaluate(
    (tabId) => chrome.tabs.sendMessage(tabId, { type: 'cex:export', format: 'html' }),
    tab.id
  );
  const pyMs = Date.now() - t0;
  if (!py || !py.ok) throw new Error('Python 引擎导出失败：' + (py && py.error));
  log('✓ Python 引擎导出:', pyMs + 'ms · engine=' + py.data.engine + ' · widgets=' + py.data.widgets);
  if (py.data.engine !== 'python') fail('没有走 Python 引擎，实际引擎：' + py.data.engine);

  const pyFile = path.join(OUT, 'py-interactive.html');
  fs.writeFileSync(pyFile, py.data.text, 'utf8');
  log('  产物:', Buffer.byteLength(py.data.text), 'bytes');

  // --- 3. JS 引擎对照（确认回退通路仍在） ---
  await setSettings(sw, { engine: 'js' });
  await page.waitForTimeout(500);
  const js = await sw.evaluate(
    (tabId) => chrome.tabs.sendMessage(tabId, { type: 'cex:export', format: 'html' }),
    tab.id
  );
  if (!js || !js.ok) fail('JS 引擎导出失败：' + (js && js.error));
  else {
    fs.writeFileSync(path.join(OUT, 'js-interactive.html'), js.data.text, 'utf8');
    log('✓ JS 回退可用: engine=' + js.data.engine + ' · widgets=' + js.data.widgets);
  }
  await setSettings(sw, { engine: 'python' });

  // --- 4. 桌面端跑同一个 base ---
  const desktop = execFileSync(
    'python',
    ['-c', `
import sys, hashlib, json
sys.path.insert(0, r'${path.join(ROOT, '..', 'desktop', 'app').replace(/\\/g, '/')}')
from converter import convert_html
html = open(r'${baseFile.replace(/\\/g, '/')}', encoding='utf-8').read()
r = convert_html(html)
out = (r.extra or {}).get('doc', '')
b = out.encode('utf-8')
print(json.dumps({'ok': r.ok, 'skipped': bool(r.skipped), 'widgets': int(r.widgets or 0),
                  'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()}))
`],
    { encoding: 'utf8' }
  );
  const desk = JSON.parse(desktop.trim().split('\n').pop());

  const pyBytes = Buffer.from(py.data.text, 'utf8');
  const crypto = require('crypto');
  const pySha = crypto.createHash('sha256').update(pyBytes).digest('hex');

  log('');
  log('  桌面端 converter.py :', desk.bytes, 'bytes  widgets=' + desk.widgets, desk.sha256.slice(0, 16) + '…');
  log('  插件内 Python 引擎  :', pyBytes.length, 'bytes  widgets=' + py.data.widgets, pySha.slice(0, 16) + '…');

  if (pySha !== desk.sha256) fail('输出与桌面端不一致！');
  else log('✓ 两者 sha256 完全一致');
  if (pyBytes.length !== desk.bytes) fail('字节数不同');
  if (py.data.widgets !== desk.widgets) fail('组件数不同');

  // --- 5. 产物本身能否正常渲染 ---
  const view = await ctx.newPage();
  const viewErrors = [];
  view.on('pageerror', (e) => viewErrors.push(e.message));
  await view.goto('file:///' + pyFile.replace(/\\/g, '/'));
  await view.waitForTimeout(1800);
  const mounted = await view.locator('.wb-widget > *').count();
  const toc = await view.locator('.wb-toc').count();
  const tokens = await view.locator('pre code.hljs span').count();
  log('✓ 渲染检查: 组件 ' + mounted + ' · 目录 ' + toc + ' · 高亮词元 ' + tokens);
  if (!mounted) fail('组件没有渲染');
  if (!toc) fail('没有目录');
  if (!tokens) fail('没有语法高亮');
  const btn = view.locator('.wb-widget button').first();
  if (await btn.count()) {
    const before = (await btn.innerText()).trim();
    await btn.click();
    await view.waitForTimeout(300);
    const after = (await btn.innerText()).trim();
    log('✓ 组件交互:', JSON.stringify(before), '→', JSON.stringify(after));
    if (before === after) fail('组件按钮点击无响应');
  }
  await view.screenshot({ path: path.join(OUT, '5-python-engine.png'), fullPage: true });

  if (pageErrors.length) log('  页面报错:', pageErrors.slice(0, 3));
  if (viewErrors.length) log('  导出页报错:', viewErrors.slice(0, 3));

  await ctx.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });

  log('');
  log(failed ? '结果：有失败项' : '结果：全部通过');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('✗ 异常:', err && (err.stack || err.message));
  process.exit(1);
});
