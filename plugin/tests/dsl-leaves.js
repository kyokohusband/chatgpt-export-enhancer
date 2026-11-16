/* ChatGPT 后端 DSL 叶子组件归一化：
 * <Entity value="X"/> / <Link title="Y"/> / <AsyncImage query="Q"/> 之类自闭合标签
 * 的内容只在属性里，运行时渲染成空元素 → 实体名/链接标题丢失 + 跨标签粗体 ** 裸露。
 * 归一化后 Entity→value、Link→title+↗、AsyncImage→原位提示，且围栏代码块/行内 code 不受影响。 */
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
/* Playwright 缓存的 chromium 优先；本机 ms-playwright junction 已失效（指向不存在的
 * D:\Cache\ms-playwright），回退到系统 Chrome */
const CHROME = process.env.CHROME_PATH || [
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p));

/* 真实用例：2026-11-14「识别歌曲 MP3」导出件里被吃掉的搜索结果卡片原文 */
const REAL_CARD = `<box gap={3}>
  <row align=start gap={3}>
    <AsyncImage query="AHA Music song identifier logo" aspectRatio="1:1" maxWidth="64px"/>
    <box flex="1" gap={1}>
      **1. <Entity value="AHA Music" category="software" disambig="Online music recognition service"/>** <badge color="success">优先推荐</badge>
      - 支持直接上传 MP3
      - 使用 ACRCloud 曲库进行指纹匹配
      - 支持选择音频片段识别

      <Link ref="turn676783search7" title="打开 AHA Music 上传页面"/>
    </box>
  </row>
  <divider color="subtle"/>
  <row align=start gap={3}>
    <AsyncImage query="AudioTag.info music recognition logo" aspectRatio="1:1" maxWidth="64px"/>
    <box flex="1" gap={1}>
      **2. <Entity value="AudioTag" category="software" disambig="Online audio fingerprint recognition service"/>**
      - 支持上传 MP3
      - 推荐 10～30 秒的音乐片段
      - 可以返回匹配的歌曲候选

      <Link ref="turn676783search3" title="打开 AudioTag"/>
    </box>
  </row>
</box>`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  await p.setContent('<body></body>');
  await p.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../extension/content/markdown.js'), 'utf8') });
  const out = await p.evaluate((src) => window.__CEX__.markdown.render(src, 2), REAL_CARD);
  const inline = await p.evaluate((t) => window.__CEX__.markdown.renderInline(t), '推荐用 <Entity value="Spotify"/> 听歌，<br/>换行不吞');
  const fenced = await p.evaluate((t) => window.__CEX__.markdown.render('```dsl\n<Entity value="X"/>\n<Link ref="r" title="T"/>\n```', 2));
  const codespan = await p.evaluate((t) => window.__CEX__.markdown.renderInline('代码 `<Entity value="X"/>` 原样'));
  const unknown = await p.evaluate((t) => window.__CEX__.markdown.renderInline('见 <SearchResult value="结果A"/> 与 <Widget foo="bar"/>'));
  await b.close();

  let failed = 0;
  const check = (ok, label, extra) => {
    console.log((ok ? '\u2713 ' : '\u2717 ') + label + (extra !== undefined ? '：' + extra : ''));
    if (!ok) failed += 1;
  };

  check(!out.includes('&lt;Entity'), '组件块：Entity 标签不再保留');
  check(!out.includes('AsyncImage'), '组件块：AsyncImage 标签已替换');
  check((out.match(/图片未导出，请到原会话查看/g) || []).length === 2, '组件块：两个图片位置各有提示');
  check(out.includes('AHA Music'), '组件块：实体名 AHA Music 还在');
  check(out.includes('AudioTag'), '组件块：实体名 AudioTag 还在');
  check(out.includes('**1. AHA Music**'), '组件块：跨标签粗体已配对（**1. AHA Music**）');
  check(!out.includes('**1. &lt;'), '组件块：不再有裸露 ** 紧跟被删标签');
  check(out.includes('优先推荐'), '组件块：badge 内容还在');
  check(out.includes('打开 AHA Music 上传页面 \u2197'), '组件块：Link → 标题 + ↗');
  check(out.includes('打开 AudioTag \u2197'), '组件块：第二个 Link 同样还原');
  check(out.includes('- 支持直接上传 MP3'), '组件块：列表行还在');

  check(inline.includes('推荐用 Spotify 听歌'), '行内：Entity → 实体名', inline);
  check(inline.includes('&lt;br/&gt;'), '行内：小写 <br/> 不被误伤（原样转义显示）', inline);
  check(!inline.includes('&lt;Entity'), '行内：不再有残留 Entity 标签', inline);

  check(fenced.includes('&lt;Entity value=&quot;X&quot;/&gt;'), '围栏：代码块内的 DSL 原样保留', fenced);
  check(codespan.includes('&lt;Entity value=&quot;X&quot;/&gt;'), '行内 code：DSL 原样保留', codespan);

  check(unknown.includes('结果A'), '兜底：未知 PascalCase 叶子取 value', unknown);
  check(!unknown.includes('&lt;Widget'), '兜底：无已知属性的未知叶子被删除', unknown);

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
