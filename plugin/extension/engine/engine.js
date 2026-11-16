/* Python 转换引擎
 *
 * 在扩展页面里跑 Pyodide（CPython → WebAssembly），直接调用 app/converter.py 原版代码，
 * 因此产出与桌面端「导出增强器」逐字节一致，不存在移植偏差。
 *
 * 文件来源：
 *   ../py/converter.py        app/converter.py 原样拷贝（由 build_extension_assets.py 同步）
 *   ../py/dslsyntax.py        app/dslsyntax.py
 *   ../py/runtime_embed.py    app/runtime_embed.py
 *   ../assets/hljs.js         → 沙箱内写作 hljs.min.js（converter 按此名读取）
 *   ../assets/hljs.css        → 沙箱内写作 hljs-github.min.css
 *   ../assets/mermaid.js      → 沙箱内写作 mermaid.min.js（仅文档含 mermaid 时加载）
 */
(function () {
  'use strict';

  const stateEl = document.getElementById('state');
  const say = (text) => {
    if (stateEl) stateEl.textContent = text;
  };

  const abs = (p) => new URL(p, location.href).href;

  // 源路径 → 沙箱内文件名。converter.py 用 os.path.dirname(__file__) 读同目录资源。
  const PY_FILES = [
    ['../py/converter.py', 'converter.py'],
    ['../py/dslsyntax.py', 'dslsyntax.py'],
    ['../py/runtime_embed.py', 'runtime_embed.py'],
    ['../assets/hljs.js', 'hljs.min.js'],
    ['../assets/hljs.css', 'hljs-github.min.css']
  ];

  let pyodide = null;
  let booting = null;
  let mermaidReady = false;

  async function writeFile(name, response) {
    const buf = await response.arrayBuffer();
    pyodide.FS.writeFile('/app/' + name, new Uint8Array(buf));
    return buf.byteLength;
  }

  async function boot() {
    if (pyodide) return pyodide;
    if (booting) return booting;

    // 精简版安装包不带 vendor/pyodide，这里直接失败，让调用方回退到 JS 引擎
    if (typeof loadPyodide !== 'function') {
      say('python runtime missing');
      throw new Error('未找到 Python 运行时（精简版安装包），请改用 JS 引擎');
    }

    booting = (async () => {
      say('loading python…');
      const instance = await loadPyodide({ indexURL: abs('../vendor/pyodide/') });
      pyodide = instance;

      instance.FS.mkdir('/app');
      instance.FS.mkdir('/work');
      for (const [src, name] of PY_FILES) {
        const res = await fetch(abs(src));
        if (!res.ok) throw new Error('资源加载失败：' + src + ' (' + res.status + ')');
        await writeFile(name, res);
      }

      await instance.runPythonAsync(
        "import sys\nsys.path.insert(0, '/app')\nimport converter\n"
      );
      say('ready · ' + instance.version);
      return instance;
    })().catch((err) => {
      booting = null;
      pyodide = null;
      say('failed');
      throw err;
    });

    return booting;
  }

  /** mermaid 有 3.3MB，只在文档确实用到时才搬进沙箱 */
  async function ensureMermaid(html) {
    if (mermaidReady) return;
    if (!/data-language\s*=\s*["']mermaid["']|class\s*=\s*["'][^"']*language-mermaid|\bwb-mermaid\b/i.test(html)) {
      return;
    }
    try {
      const res = await fetch(abs('../assets/mermaid.js'));
      if (!res.ok) return;
      await writeFile('mermaid.min.js', res);
      mermaidReady = true;
    } catch (e) {
      /* mermaid 缺失不影响其余组件，converter 会跳过 */
    }
  }

  async function convert(html) {
    const instance = await boot();
    await ensureMermaid(html);

    instance.FS.writeFile('/work/in.html', new TextEncoder().encode(html));
    const raw = await instance.runPythonAsync(`
import json
html = open('/work/in.html', encoding='utf-8').read()
r = converter.convert_html(html)
doc = (r.extra or {}).get('doc', '')
if not doc and r.skipped:
    doc = html
json.dumps({
    'ok': bool(r.ok),
    'skipped': bool(r.skipped),
    'message': r.message,
    'widgets': int(r.widgets or 0),
    'doc': doc,
})
`);
    const out = JSON.parse(raw);
    out.mermaid = mermaidReady;
    return out;
  }

  /* ------------------------------------------------------------ 消息协议 */

  async function handle(data, reply) {
    if (data.type === 'cex-py:warm') {
      try {
        const started = Date.now();
        await boot();
        reply({ ok: true, ready: true, ms: Date.now() - started, version: pyodide.version });
      } catch (err) {
        reply({ ok: false, ready: false, error: String((err && err.message) || err) });
      }
      return;
    }

    if (data.type === 'cex-py:convert') {
      try {
        const out = await convert(String(data.html || ''));
        reply(Object.assign({ ok: true, id: data.id }, out));
      } catch (err) {
        reply({ ok: false, id: data.id, error: String((err && err.message) || err) });
      }
    }
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (typeof data.type !== 'string' || data.type.indexOf('cex-py:') !== 0) return;
    // 只接受来自父窗口的指令（这个 iframe 只被内容脚本使用）
    if (event.source !== window.parent) return;

    const source = event.source;
    const origin = event.origin;
    const reply = (payload) => {
      try {
        source.postMessage(
          Object.assign({ type: 'cex-py:reply', id: data.id }, payload),
          origin && origin !== 'null' ? origin : '*'
        );
      } catch (e) {
        /* ignore */
      }
    };

    handle(data, reply);
  });

  window.__CEX_PY_ENGINE__ = { boot, convert };

  // 握手信号：内容脚本靠它判断「引擎页真的加载成功了」，
  // 否则（旧版插件 / 资源缺失）会 8 秒超时后回退，而不是干等 90 秒。
  try {
    window.parent.postMessage({ type: 'cex-py:hello', hasRuntime: typeof loadPyodide === 'function', version: '1.3.20' }, '*');
  } catch (e) {
    /* ignore */
  }
})();
