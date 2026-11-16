const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright-core');

const extension = path.resolve(__dirname, '../extension');
const read = file => fs.readFileSync(path.join(extension, file), 'utf8');
const md = '# MyBatis-Plus 系统学习教程\n\n' +
  '<badge color="info">体系构建阶段</badge> <badge>已有一定基础</badge>\n\n' +
  '行内代码 `<badge color="danger">原样</badge>`。\n\n' +
  '```html\n<badge>代码块原样</badge>\n```';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    for (const file of ['content/serialize.js', 'content/markdown.js', 'content/exporters.js']) {
      await page.addScriptTag({ content: read(file) });
    }
    const html = await page.evaluate(markdown => window.__CEX__.exporters.baseHTML(
      [{ role: 'assistant', md: markdown }], { title: 'MyBatis-Plus 系统学习教程', site: 'ChatGPT' }, {}), md);
    await page.setContent(html);
    const badges = page.locator('.body .cex-badge');
    assert.deepEqual(await badges.allTextContents(), ['体系构建阶段', '已有一定基础']);
    assert.equal(await badges.first().evaluate(el => getComputedStyle(el).color), 'rgb(29, 78, 216)');
    assert.equal(await badges.nth(1).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(243, 244, 246)');
    assert.equal(await page.locator('.body :not(pre) > code').textContent(), '<badge color="danger">原样</badge>');
    assert.equal(await page.locator('.body pre code').textContent(), '<badge>代码块原样</badge>');
    assert.doesNotMatch(await page.locator('.body p').first().innerText(), /<badge/);
    const unsafe = await page.evaluate(() => window.__CEX__.markdown.renderInline(
      '<badge color="constructor" onclick="alert(1)">安全</badge>'));
    assert.match(unsafe, /class="cex-badge"/);
    assert.doesNotMatch(unsafe, /onclick|undefined/);

    const python = spawnSync('python', ['-c',
      'import sys;sys.path.insert(0,sys.argv[1]);import converter;r=converter.convert_html(sys.stdin.read());assert r.ok,r.message;assert r.extra["doc"].count("class=\\"cex-badge\\"")==2',
      path.resolve(__dirname, '../../desktop/app')], {
        input: html, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });
    assert.equal(python.status, 0, python.stderr || python.stdout);
    console.log('PASS: badge styling in exported HTML; code stays literal; Python conversion preserves badges');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
