const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const chrome = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');
const content = path.resolve(__dirname, '../extension/content');
const runtime = fs.readFileSync(path.resolve(__dirname, '../extension/assets/runtime.js'), 'utf8');
const fixture = `### ② 宿主环境 API

主要有两种常见环境。

<grid columns={2} gap={3}>
  <grid-item>
    <AsyncImage query="modern web browser developer tools console DOM inspector screenshot" aspectRatio="5:4" width="100%"/>
    **浏览器环境**
    <text color="secondary" size="xs">提供网页相关能力。</text>
    - window
    - document
  </grid-item>
  <grid-item>
    <AsyncImage query="Node.js terminal JavaScript development environment code screenshot" aspectRatio="5:4" width="100%"/>
    **Node.js 环境**
    <text color="secondary" size="xs">提供服务器及系统相关能力。</text>
    - 文件系统
    - 网络服务
  </grid-item>
</grid>`;

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    for (const name of ['dsl', 'serialize', 'markdown', 'widget', 'exporters']) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(content, name + '.js'), 'utf8') });
    }
    const html = await page.evaluate(({ fixture, runtime }) => {
      const C = window.__CEX__;
      const base = C.exporters.baseHTML([{ role: 'assistant', md: fixture }],
        { title: '宿主环境', site: 'ChatGPT', url: 'https://chatgpt.com/c/example' }, { includeCss: true });
      return C.widget.convert(base, { runtime, hljsJs: '', hljsCss: '', converterCss: '', tocJs: '' }).doc;
    }, { fixture, runtime });
    await page.setContent(html);
    const widget = page.locator('.wb-widget');
    await widget.first().waitFor();
    assert.equal(await widget.locator('.wb-err').count(), 0);
    const text = await widget.innerText();
    assert.equal((text.match(/图片未导出，请到原会话查看/g) || []).length, 2);
    assert.match(text, /浏览器环境/);
    assert.match(text, /Node\.js 环境/);
    assert.equal(await widget.locator('img').count(), 0);
    console.log('PASS: both AsyncImage positions show notices in the exported widget');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
