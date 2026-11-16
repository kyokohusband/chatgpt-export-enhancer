/**
 * 端到端验证：在模拟的 ChatGPT 页面上加载扩展，检查采集、导出与面板交互。
 * 运行：node tests/e2e.mjs
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(__dirname, 'out');
const PROFILE = path.join(__dirname, '.profile');
const DOWNLOADS = path.join(OUT, 'downloads');
const FIXTURE = path.join(__dirname, 'fixtures', 'chatgpt-mock.html');
const CHROME =
  process.env.CHROME_PATH ||
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');

const log = (...args) => console.log(...args);
const fail = (msg) => {
  console.error('✗ ' + msg);
  process.exitCode = 1;
};

function readPng(p) {
  return fs.existsSync(p) ? fs.statSync(p).size : 0;
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });

  let lastHtml = '';
  let htmlFileName = '';

  const html = fs.readFileSync(FIXTURE, 'utf8');

  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    downloadsPath: DOWNLOADS,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
    const extId = new URL(sw.url()).host;
    log('✓ 扩展已加载，id =', extId);

    // 让 chatgpt.com 的请求命中本地 fixture（扩展按 host 自动注入）
    await context.route('https://chatgpt.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    );

    // 测试期间把下载目录固定成临时子目录，结束后清理
    await sw.evaluate(() => chrome.storage.sync.get('cex.settings.v1'));
    await sw.evaluate(() =>
      chrome.storage.sync.set({ 'cex.settings.v1': { subfolder: 'cex-e2e', format: 'html', scope: 'all' } })
    );
    await new Promise((r) => setTimeout(r, 300));

    const page = await context.newPage();
    page.on('pageerror', (e) => log('[pageerror]', e.message));
    await page.goto('https://chatgpt.com/c/mock-chat', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#__cex_frame__', { timeout: 20000 });
    log('✓ 浮层 iframe 已注入');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, '1-page-bubble.png') });

    const tabs = await sw.evaluate(() =>
      chrome.tabs.query({}).then((ts) => ts.map((t) => ({ id: t.id, url: t.url })))
    );
    const tab = tabs.find((t) => (t.url || '').includes('chatgpt.com/c/mock-chat'));
    if (!tab) throw new Error('没找到目标标签页');

    const status = await sw.evaluate(
      (tabId) => chrome.tabs.sendMessage(tabId, { type: 'cex:status' }),
      tab.id
    );
    log('✓ 状态：', status.site, '|', status.title, '|', status.count, '条消息');
    if (!status.ok) throw new Error('状态读取失败');
    if (status.count !== 5) fail('消息条数应为 5，实际 ' + status.count);
    if (status.adapterId !== 'chatgpt') fail('适配器应为 chatgpt，实际 ' + status.adapterId);

    for (const format of ['html', 'markdown', 'json', 'text']) {
      const res = await sw.evaluate(
        ({ tabId, format }) => chrome.tabs.sendMessage(tabId, { type: 'cex:export', format }),
        { tabId: tab.id, format }
      );
      if (!res.ok) throw new Error(format + ' 导出失败：' + res.error);
      const file = String(res.data.filename).split('/').pop();
      fs.writeFileSync(path.join(OUT, file), res.data.text, 'utf8');
      log(`✓ 导出 ${format}: ${res.data.filename} (${res.data.count} 条, ${res.data.bytes} 字节)`);
      if (format === 'html') {
        lastHtml = res.data.text;
        htmlFileName = file;
        log('  · 组件还原：', res.data.widgets, '个 · 可交互：', res.data.interactive);
      }
    }

    // ---------------------------------------------------------------- 面板
    const frame = page.frameLocator('#__cex_frame__');
    await frame.locator('#bubble').click();
    await frame.locator('.row').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(OUT, '2-panel-expanded.png') });

    const rows = await frame.locator('.row').count();
    log('✓ 面板消息行数：', rows);
    if (rows !== 5) fail('面板应显示 5 行，实际 ' + rows);

    const statusAll = await frame.locator('#status').innerText();
    log('✓ 面板状态：', statusAll);
    if (!/共 5 条消息/.test(statusAll)) fail('面板状态未回到正常值：' + statusAll);

    await frame.locator('.chip[data-act="user"]').click();
    await frame.locator('.seg[data-scope="selected"]').click();
    await page.waitForTimeout(300);
    const statusSelected = await frame.locator('#status').innerText();
    log('✓ 选中模式：', statusSelected);
    if (!/已选 2 \/ 5/.test(statusSelected)) fail('仅提问应选中 2 条，实际：' + statusSelected);
    await page.screenshot({ path: path.join(OUT, '3-panel-selected.png') });

    await frame.locator('#btnCopy').click();
    await page.waitForTimeout(1200);
    const copyToast = await frame.locator('#toast').innerText().catch(() => '');
    log('✓ 复制提示：', copyToast);
    if (!/已复制 2 条消息|复制失败/.test(copyToast)) fail('复制没有反馈：' + copyToast);

    await frame.locator('#btnExport').click();
    await page.waitForTimeout(2000);
    const exportToast = await frame.locator('#toast').innerText().catch(() => '');
    log('✓ 导出提示：', exportToast);

    const found = [];
    const scan = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) scan(p);
        else found.push(p);
      }
    };
    scan(DOWNLOADS);
    const homeDownloads = path.join(os.homedir(), 'Downloads', 'cex-e2e');
    scan(homeDownloads);
    log('✓ 下载到的文件：', found.map((f) => path.basename(f)).join(', ') || '（无）');
    if (!found.length) fail('导出没有产生文件');

    const items = await sw.evaluate(() =>
      chrome.downloads.search({ limit: 5 }).then((list) =>
        list.map((d) => ({ filename: d.filename, state: d.state, error: d.error, bytes: d.bytesReceived }))
      )
    );
    log('✓ 浏览器下载记录：', JSON.stringify(items));
    if (!items.length) fail('chrome.downloads 没有记录');
    else if (!/\.html$/.test(items[0].filename)) {
      log('  注：Playwright 接管下载后会把落盘名改成 GUID，真实浏览器里使用导出建议名');
    }
    if (!/已导出 2 条消息.*\.html$/.test(exportToast)) fail('导出提示里的文件名不对：' + exportToast);

    // 导出的 HTML 应当已经是「转换后」的可交互页
    if (!/class="wb-widget" data-w="0"/.test(lastHtml)) fail('HTML 里没有组件占位容器');
    if (!/id="wb-widget-data"/.test(lastHtml)) fail('HTML 里没有组件数据');
    if (!/id="wb-toc-script"/.test(lastHtml)) fail('HTML 里没有目录脚本');
    log('✓ 产物已内嵌运行时：', Math.round(lastHtml.length / 1024), 'KB');

    // 打开导出的文件本身：组件要能渲染、能交互，高亮和目录都要在
    const exportPage = await context.newPage();
    exportPage.on('pageerror', (e) => log('[export pageerror]', e.message));
    await exportPage.goto('file:///' + path.join(OUT, htmlFileName).replace(/\\/g, '/'));
    await exportPage.waitForTimeout(1800);
    const mounted = await exportPage.locator('.wb-widget > *').count();
    const tocCount = await exportPage.locator('.wb-toc').count();
    const hlTokens = await exportPage.locator('pre code.hljs span').count();
    log('✓ 导出页：组件', mounted, '个 · 目录', tocCount, ' · 高亮词元', hlTokens);
    if (mounted < 2) fail('导出的页面里组件没有渲染：' + mounted);
    if (!tocCount) fail('导出的页面没有右侧目录');
    if (!hlTokens) fail('代码块没有语法高亮');

    const btn = exportPage.locator('.wb-widget button').first();
    const before = (await btn.innerText()).trim();
    await btn.click();
    await exportPage.waitForTimeout(400);
    const after = (await btn.innerText()).trim();
    log('✓ 组件交互：', JSON.stringify(before), '→', JSON.stringify(after));
    if (before === after) fail('点击组件按钮后状态没有变化');
    await exportPage.screenshot({ path: path.join(OUT, '4-export-page.png'), fullPage: true });

    // 面板收起
    await frame.locator('#btnCollapse').click();
    await page.waitForTimeout(400);
    const collapsedVisible = await frame.locator('#bubble').isVisible();
    log('✓ 收起后气泡可见：', collapsedVisible);

    // 从弹窗/快捷键路径打开（宿主主动 setExpanded）
    await sw.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'cex:open' }), tab.id);
    await page.waitForTimeout(1800);
    const panelVisible = await frame.locator('#panel').isVisible();
    const box = await page.locator('#__cex_frame__').boundingBox();
    log('✓ 外部打开后：面板可见', panelVisible, '尺寸', Math.round(box.width), 'x', Math.round(box.height));
    if (!panelVisible) fail('从弹窗路径打开时面板没有展开');
    if (Math.round(box.width) < 360) fail('展开后 iframe 宽度异常：' + box.width);

    // 设置页写入 storage
    const optionsPage = await context.newPage();
    optionsPage.on('pageerror', (e) => log('[options pageerror]', e.message));
    await optionsPage.goto(`chrome-extension://${extId}/options/options.html`);
    await optionsPage.locator('#includeCss').uncheck();
    await optionsPage.waitForTimeout(900);
    const saved = await sw.evaluate(() =>
      chrome.storage.sync.get('cex.settings.v1').then((b) => b['cex.settings.v1'])
    );
    log('✓ 设置页写入：includeCss =', saved && saved.includeCss);
    if (!saved || saved.includeCss !== false) fail('设置页没有写入 storage');
    await optionsPage.locator('#includeCss').check();
    await page.waitForTimeout(700);
    await optionsPage.close(); // 关掉页面，避免它延迟保存把后面的设置覆盖回去

    // 关掉「直接产出可交互页面」时应退回静态 HTML（可再交给桌面端转换）
    await sw.evaluate(async () => {
      const bag = await chrome.storage.sync.get('cex.settings.v1');
      const cur = bag['cex.settings.v1'] || {};
      await chrome.storage.sync.set({ 'cex.settings.v1': Object.assign({}, cur, { interactive: false }) });
    });
    await page.waitForTimeout(600);
    const rawExport = await sw.evaluate(
      (tabId) => chrome.tabs.sendMessage(tabId, { type: 'cex:export', format: 'html' }),
      tab.id
    );
    if (!rawExport.ok) throw new Error('静态导出失败：' + rawExport.error);
    fs.writeFileSync(path.join(OUT, 'static.html'), rawExport.data.text, 'utf8');
    log('✓ 静态模式：', rawExport.data.widgets, '个组件 ·', Math.round(rawExport.data.text.length / 1024), 'KB');
    if (rawExport.data.interactive) fail('静态模式不该注入运行时');
    if (/wb-widget-data/.test(rawExport.data.text)) fail('静态模式仍然注入了组件数据');

    await sw.evaluate(async () => {
      const bag = await chrome.storage.sync.get('cex.settings.v1');
      const cur = bag['cex.settings.v1'] || {};
      await chrome.storage.sync.set({ 'cex.settings.v1': Object.assign({}, cur, { interactive: true }) });
    });

    log('');
    log('产物目录：', OUT);
    if (readPng(path.join(OUT, '2-panel-expanded.png'))) log('截图：1-page-bubble.png / 2-panel-expanded.png / 3-panel-selected.png');
  } catch (err) {
    fail(err && err.stack ? err.stack : String(err));
  } finally {
    await context.close().catch(() => {});
    // 清理可能落到用户下载目录的测试文件
    const junk = path.join(os.homedir(), 'Downloads', 'cex-e2e');
    if (fs.existsSync(junk)) {
      fs.rmSync(junk, { recursive: true, force: true });
      log('已清理测试下载目录：', junk);
    }
  }
})();
