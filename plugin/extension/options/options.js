(function () {
  const S = window.__CEX_SHARED__;
  const $ = (id) => document.getElementById(id);

  const BOOLS = ['interactive', 'includeMeta', 'includeCss', 'autoLoad', 'collapseAfterExport', 'saveAs'];
  const TEXTS = ['subfolder'];
  const SELECTS = ['format', 'scope', 'imageMode', 'engine'];

  const els = {
    format: $('format'),
    scope: $('scope'),
    subfolder: $('subfolder'),
    imageMode: $('imageMode'),
    engine: $('engine'),
    reset: $('reset'),
    testEngine: $('testEngine'),
    engineResult: $('engineResult'),
    saved: $('saved')
  };
  for (const id of BOOLS) els[id] = $(id);

  let timer = null;
  let saveTimer = null;

  function paint(settings) {
    els.format.value = settings.format;
    els.scope.value = settings.scope;
    els.subfolder.value = settings.subfolder;
    els.imageMode.value = settings.imageMode;
    els.engine.value = settings.engine === 'js' ? 'js' : 'python';
    for (const id of BOOLS) els[id].checked = !!settings[id];
  }

  function flashSaved() {
    els.saved.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      els.saved.hidden = true;
    }, 1400);
  }

  async function save() {
    const patch = {};
    for (const id of SELECTS) patch[id] = els[id].value;
    for (const id of TEXTS) patch[id] = els[id].value.trim();
    for (const id of BOOLS) patch[id] = !!els[id].checked;

    await S.setSettings(patch);
    flashSaved();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      save().catch((err) => {
        els.saved.textContent = '保存失败：' + (err.message || '未知错误');
        els.saved.hidden = false;
      });
    }, 400);
  }

  els.reset.addEventListener('click', async () => {
    await S.setSettings(Object.assign({}, S.DEFAULTS));
    paint(await S.getSettings());
    flashSaved();
  });

  /* ------------------------------------------------------------ 引擎自检 */

  // 故意用「被拆成多段 <p> 的组件源码」做样例：能还原出 1 个组件，
  // 就说明合并、占位、注入整条链路都跑通了。
  const TEST_HTML =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>selftest</title></head><body>' +
    '<article class="turn assistant"><div class="role">Assistant</div><div class="body">' +
    '<p>&lt;button</p><p>label="自检按钮"</p><p>&gt;</p><p>&lt;/button&gt;</p>' +
    '</div></article></body></html>';

  function waitHello(frame, timeoutMs) {
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const data = event.data;
        if (!data || data.type !== 'cex-py:hello') return;
        if (event.source !== frame.contentWindow) return;
        cleanup();
        resolve(data);
      };
      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('引擎页没有响应：插件可能是旧版本，或者 engine/ 目录没加载'));
      }, timeoutMs);
      window.addEventListener('message', onMessage);
    });
  }

  function engineCall(frame, message, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const onMessage = (event) => {
        const data = event.data;
        if (!data || data.type !== 'cex-py:reply' || data.id !== id) return;
        if (event.source !== frame.contentWindow) return;
        cleanup();
        if (data.ok) resolve(data);
        else reject(new Error(data.error || '引擎返回失败'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('等待超时（' + Math.round(timeoutMs / 1000) + ' 秒）'));
      }, timeoutMs);
      window.addEventListener('message', onMessage);
      frame.contentWindow.postMessage(Object.assign({ id }, message), '*');
    });
  }

  if (els.testEngine) {
    els.testEngine.addEventListener('click', async () => {
      const btn = els.testEngine;
      const out = els.engineResult;
      btn.disabled = true;
      out.className = 'hint';
      out.textContent = '正在启动 Python…（首次约 1~2 秒）';

      let frame = null;
      try {
        frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.src = '../engine/engine.html';
        frame.style.cssText =
          'position:fixed;left:-9999px;top:0;width:2px;height:2px;border:0;opacity:0;pointer-events:none;';
        document.body.appendChild(frame);

        const hello = await waitHello(frame, 10000);
        if (!hello.hasRuntime) throw new Error('没找到 Python 运行时 —— 这是精简版安装包');

        const started = Date.now();
        await engineCall(frame, { type: 'cex-py:warm' }, 120000);
        const bootMs = Date.now() - started;

        const conv = await engineCall(frame, { type: 'cex-py:convert', html: TEST_HTML }, 60000);
        const widgets = conv.widgets || 0;
        const kb = Math.round((conv.doc || '').length / 1024);

        if (widgets > 0) {
          out.className = 'hint good';
          out.textContent = '✓ 正常：Python 启动 ' + bootMs + ' ms，样例还原出 ' + widgets + ' 个组件（产物 ' + kb + ' KB）';
        } else {
          out.className = 'hint bad';
          out.textContent = '⚠ Python 起来了（' + bootMs + ' ms），但样例没还原出组件，检查 extension/py/converter.py 是否最新';
        }
      } catch (err) {
        out.className = 'hint bad';
        out.textContent = '✗ ' + (err && err.message ? err.message : String(err));
      } finally {
        btn.disabled = false;
        if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
      }
    });
  }

  for (const id of [...SELECTS, ...TEXTS]) els[id].addEventListener('input', scheduleSave);
  for (const id of SELECTS) els[id].addEventListener('change', scheduleSave);
  for (const id of BOOLS) els[id].addEventListener('change', scheduleSave);

  (async function boot() {
    paint(await S.getSettings());
  })();
})();
