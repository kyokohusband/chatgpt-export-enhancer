const { chromium } = require('playwright-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));
const RT = fs.readFileSync(path.resolve('../desktop/widget-runtime.js'), 'utf8');

const src = [
  '<box border radius="lg" padding={3} gap={2}>',
  '**Student 类**',
  '<text>定义学生的**数据**与行为</text>',
  '<row><text>**`__init__`**</text><text>初始化属性</text></row>',
  '<text>~~旧写法~~ 新写法，*斜体* 也算</text>',
  '<text>幂运算 2 ** 3 不能被当成粗体</text>',
  '<text>未闭合的 **星号 保持原样</text>',
  '</box>'
].join('\n');

/* 回归：**{expr}** 这种「字面量包裹表达式」的加粗。
   曾经 ** 与表达式是相邻的独立节点，单个节点里的 ** 配不成对，
   页面上原样显示 **xx**。修复后应合并成一个 __tm 再做行内解析。 */
const srcExpr = [
  '<box gap={1}>',
  '  {#each [{t:"设备信息", s:"名称：压力容器A"}] as item}',
  '  **{item.t}**',
  '  <text size="xs">{item.s}</text>',
  '  {/each}',
  '  <text>`GET /detail/{id}` 代码里的花括号是字面量</text>',
  '</box>'
].join('\n');

/* 回归：组件文本里的 markdown 表格要渲染成真表格，不能露出竖线纯文本 */
const srcTable = [
  '<box gap={2}>',
  '  **IDEA 常用调试操作**',
  '',
  '  | 操作 | 作用 |',
  '  |---|---|',
  '  | Breakpoint | **在指定位置**暂停 |',
  '  | Step Over (F8) | 执行当前行 |',
  '</box>'
].join('\n');

/* 回归：组件文本里的 markdown 围栏代码块要渲染成真 <pre><code>，
   内容里的 {expr}、<tag> 都是字面量（曾经 User {id=1} 的花括号被当成表达式求值） */
const srcFence = [
  '<box gap={2}>',
  '  **数据库记录**',
  '  ```text',
  '  id       1',
  '  username 张三',
  '  ```',
  '  ```java',
  '  User {',
  '    id=1,',
  '    username="张三"',
  '  }',
  '  ```',
  '</box>'
].join('\n');

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  await p.setContent(`<html><head><meta charset="utf-8"></head><body>
<div class="wb-widget" data-w="0"></div>
<div class="wb-widget" data-w="1"></div>
<div class="wb-widget" data-w="2"></div>
<div class="wb-widget" data-w="3"></div>
<script id="wb-widget-data" type="application/json">${JSON.stringify([src, srcExpr, srcTable, srcFence]).replace(/</g, '\\u003c')}</script>
</body></html>`);
  await p.addScriptTag({ content: RT });
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const ws = document.querySelectorAll('.wb-widget');
    const w = ws[0];
    const w2 = ws[1];
    const w3 = ws[2];
    const w4 = ws[3];
    return {
      text: w.innerText,
      strong: w.querySelectorAll('strong').length,
      em: w.querySelectorAll('em').length,
      del: w.querySelectorAll('del').length,
      code: w.querySelectorAll('code').length,
      hasStarStar: (w.innerText || '').includes('**'),
      html: w.innerHTML.slice(0, 320),
      /* 回归用例：**{expr}** */
      r2: {
        err: w2.querySelector('.wb-err') ? w2.querySelector('.wb-err').textContent : '',
        strong: w2.querySelectorAll('strong').length,
        starStar: (w2.innerText || '').includes('**'),
        code: w2.querySelectorAll('code').length,
        text: (w2.innerText || '').replace(/\s+/g, ' ').trim()
      },
      /* 回归用例：组件文本里的围栏代码块 */
      r4: {
        err: w4.querySelector('.wb-err') ? w4.querySelector('.wb-err').textContent : '',
        pre: w4.querySelectorAll('pre[data-language]').length,
        code: w4.querySelectorAll('pre code').length,
        starStar: (w4.innerText || '').includes('```'),
        text: (w4.innerText || '').replace(/\s+/g, ' ').trim()
      },
      /* 回归用例：组件文本里的 markdown 表格 */
      r3: {
        table: w3.querySelectorAll('table.wb-md-table').length,
        th: w3.querySelectorAll('th').length,
        td: w3.querySelectorAll('td').length,
        pipe: (w3.innerText || '').includes('|---|'),
        strongInCell: w3.querySelectorAll('td strong').length,
        text: (w3.innerText || '').replace(/\s+/g, ' ').trim()
      }
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
