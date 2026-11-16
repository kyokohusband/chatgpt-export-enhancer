const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    for (const name of ['serialize', 'markdown', 'exporters']) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../extension/content', name + '.js'), 'utf8') });
    }
    const result = await page.evaluate(() => {
      const E = window.__CEX__.exporters;
      const answer = md => ({ role: 'assistant', md });
      const messages = [
        { role: 'user', md: '# 用户的问题' },
        answer('# 旧回答'),
        answer('```md\n# 代码里的假标题\n```\n## **Element Plus 完整知识体系**\n### 第一节'),
        answer('没有标题的追问回复'),
      ];
      const title = E.answerTitle(messages);
      const doc = new DOMParser().parseFromString(E.baseHTML(messages, { title }, {}), 'text/html');
      const content = document.createElement('div');
      content.innerHTML = '<pre><h1>伪标题</h1></pre><h2>DOM 回答标题</h2>';
      return {
        title,
        htmlTitle: doc.title,
        pageTitle: doc.querySelector('.doc-title').textContent,
        filename: E.filename({ title }, { fileName: '{title}', subfolder: '' }, 'html'),
        selected: E.answerTitle([messages[1]]),
        noTitle: E.answerTitle([answer('纯文本')]),
        setext: E.answerTitle([answer('完整标题\n===\n内容')]),
        level: E.answerTitle([answer('### 小节\n# 主标题')]),
        dom: E.answerTitle([{ role: 'assistant', content }]),
        codeOnly: E.answerTitle([answer('~~~md\n# 示例代码\n~~~')]),
        safeFilename: E.filename({ title: 'A/B: C?' }, { fileName: '{title}', subfolder: '' }, 'html'),
      };
    });
    assert.equal(result.title, 'Element Plus 完整知识体系');
    assert.equal(result.htmlTitle, result.title);
    assert.equal(result.pageTitle, result.title);
    assert.equal(result.filename, result.title + '.html');
    assert.equal(result.selected, '旧回答');
    assert.equal(result.noTitle, '');
    assert.equal(result.setext, '完整标题');
    assert.equal(result.level, '主标题');
    assert.equal(result.dom, 'DOM 回答标题');
    assert.equal(result.codeOnly, '');
    assert.equal(result.safeFilename, 'A_B_ C_.html');
    console.log('PASS: answer heading, selected scope, DOM/Markdown, HTML title and filename, fallback, code fences, filename safety');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
