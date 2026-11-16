const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const chrome = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe');

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    for (const name of ['serialize', 'markdown', 'exporters']) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../extension/content', name + '.js'), 'utf8') });
    }
    const result = await page.evaluate(() => {
      const C = window.__CEX__;
      const el = document.createElement('article');
      el.innerHTML = '<div class="markdown"><img src="https://example.com/dom.png" alt="DOM image"></div>';
      const html = C.exporters.baseHTML([
        { role: 'assistant', md: '介绍图片：\n\n![浏览器截图](https://example.com/browser.png)', el, content: el.firstElementChild },
        { role: 'assistant', md: '纯文字回答' }
      ], { title: '测试', site: 'ChatGPT', url: 'https://chatgpt.com/c/example' }, { includeCss: true });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return {
        images: doc.querySelectorAll('img').length,
        localNote: doc.querySelector('.turn .cex-image-note')?.textContent,
        globalNote: doc.querySelector('.wrap > .notice')?.textContent,
        link: doc.querySelector('.wrap > .notice a')?.getAttribute('href'),
        leakedUrl: html.includes('https://example.com/browser.png')
      };
    });
    assert.equal(result.images, 0);
    assert.match(result.localNote, /图片未导出（浏览器截图），请到原会话查看/);
    assert.match(result.globalNote, /图片未包含在导出文件中/);
    assert.equal(result.link, 'https://chatgpt.com/c/example');
    assert.equal(result.leakedUrl, false);
    console.log('PASS: omitted images show local and document notices');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
