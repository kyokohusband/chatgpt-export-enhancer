/* 找出「页面有 pre 但导出没有」的那个代码块，看它差在哪 */
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const PROFILE = path.join(__dirname, '.profile-miss');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
const URL = process.argv[2];

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(6000);

  const [tab] = await sw.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }));
  const res = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'cex:export', format: 'html' }), tab.id);
  const doc = res && res.ok ? res.data.text : '';

  // 导出完之后，页面滚动过了，再看每个 pre 的结构与它是否进了产物
  const info = await page.evaluate(() => {
    const out = [];
    const pres = [...document.querySelectorAll('pre')];
    for (const pre of pres) {
      const code = pre.querySelector('code');
      const text = (code ? code.textContent : pre.textContent || '').trim();
      // 找代码块外壳（含复制按钮）
      let shell = null;
      let n = pre.parentElement;
      for (let i = 0; i < 16 && n; i++) {
        if (n.querySelector && n.querySelector('button[aria-label*="复制"], button[aria-label*="Copy"]')) { shell = n; break; }
        n = n.parentElement;
      }
      // 是否在某个消息容器里
      const msg = pre.closest('[data-message-author-role]');
      out.push({
        cls: String(pre.className).slice(0, 46),
        textLen: text.length,
        head: text.slice(0, 40).replace(/\n/g, '\n'),
        hasShell: !!shell,
        shellHasPre: shell ? shell.querySelectorAll('pre').length : 0,
        msgRole: msg ? msg.getAttribute('data-message-author-role') : null,
        parentCls: String(pre.parentElement.className).slice(0, 40),
        contentEditable: pre.getAttribute('contenteditable') || (code && code.getAttribute('contenteditable')) || null
      });
    }
    return {
      pres: out,
      msgCount: document.querySelectorAll('[data-message-author-role]').length,
      cmCount: document.querySelectorAll('.cm-editor').length,
      editableCount: document.querySelectorAll('[contenteditable="true"]').length
    };
  });

  console.log('页面消息数:', info.msgCount, '| cm-editor:', info.cmCount, '| contenteditable:', info.editableCount);
  console.log('页面 pre 详情:');
  for (const p of info.pres) {
    console.log(`  · len=${String(p.textLen).padStart(4)} shell=${p.hasShell ? 'Y' : 'N'} shellPres=${p.shellHasPre} role=${p.msgRole} ce=${p.contentEditable} cls="${p.cls}"`);
    console.log(`    head="${p.head}"`);
  }
  const got = (doc.match(/<pre data-language="[^"]*">/g) || []).length;
  console.log('导出产物代码块数:', got);

  await ctx.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
