// ==UserScript==
// @name         ChatGPT 图片点击开大图
// @namespace    local.wb.chatgpt.image
// @version      5.0.1
// @description  点 ChatGPT 里的图片，在新标签页打开原图。
// @author       WorkBuddy
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ---------- 可调参数 ---------- */
  const MIN_W = 100;      // 渲染宽度下限：小于这个算头像/图标，不拦截
  const MIN_H = 75;       // 渲染高度下限
  const VERIFY_MS = 8000; // 验证升级地址的等待上限
  /* ------------------------------ */

  /* ==================================================================
   * 1. 把缩略图地址升级成原图地址
   *
   * ChatGPT 有两套图片地址体系：
   *
   *   旧：https://images.openai.com/...?purpose=96x96
   *        → 改成 purpose=fullsize 就是原图
   *
   *   新：https://chatgpt.com/backend-api/estuary/content
   *              ?type=image&id=file_xxx%23thumbnail&w=384
   *        → id 里的 %23thumbnail 是"缩略图"标记，去掉它（并去掉 w）才是原图
   *
   * 改写不一定成功（地址可能带签名，改了就 403），
   * 所以后面会用真实加载来验证一次，失败就退回原地址。
   * ================================================================== */
  function upgrade(url) {
    let u;
    try { u = new URL(url, location.href); } catch (e) { return url; }

    // estuary 体系：去掉 %23thumbnail 标记
    if (/estuary\/content/i.test(u.pathname)) {
      const id = u.searchParams.get('id') || '';
      // searchParams.get 已经自动解码过一次，%23 已经变成 #
      if (/#thumbnail/i.test(id)) {
        u.searchParams.set('id', id.replace(/#thumbnail$/i, ''));
        u.searchParams.delete('w');
        u.searchParams.delete('width');
        return u.href;
      }
      return url;
    }

    // images.openai.com 体系：purpose 参数
    // （域名是 images.openai.com，purpose 是路径段；
    //   也兼容把 images.openai.com 放在路径里的形态）
    const isOpenAI = /images\.openai\.com/i.test(u.hostname) ||
                     /\/images\.openai\.com\//i.test(u.pathname);

    if (isOpenAI) {
      if (/[?&]purpose=/i.test(u.search) && !/[?&]purpose=fullsize/i.test(u.search)) {
        u.searchParams.set('purpose', 'fullsize');
        return u.href;
      }
      // purpose 路径段
      if (/\/purpose\/[^/]+\//i.test(u.pathname) && !/\/purpose\/(fullsize|original)\//i.test(u.pathname)) {
        u.pathname = u.pathname.replace(/(\/purpose\/)[^/]+(\/)/i, '$1fullsize$2');
        return u.href;
      }
    }

    return url;
  }

  /* ==================================================================
   * 2. 找到"用户点到的那张图"
   *
   * 只处理点击事件直接命中的 <img>。
   * 不能用 elementsFromPoint 往下查找：关闭按钮覆盖在图片上时，
   * 元素栈里仍有下层图片，会误打开大图。
   * ================================================================== */
  function findImage(target) {
    if (!(target instanceof HTMLImageElement)) return null;

    // 只看渲染尺寸，不看 naturalWidth，避免把头像误认成大图。
    const r = target.getBoundingClientRect();
    return r.width >= MIN_W && r.height >= MIN_H ? target : null;
  }

  /* ==================================================================
   * 3. 打开新标签
   * ================================================================== */

  /**
   * 注意：这里**不能**传 'noopener,noreferrer'。
   * 按规范，带 noopener 时 window.open() 的返回值恒为 null，
   * v2.0.0 因此每次都判定"被浏览器拦截"，于是每次都弹出那条浮条。
   * 需要断 opener 的话，在拿到窗口后单独设置 win.opener = null。
   */
  function openTab(url) {
    let win = null;
    try { win = window.open(url, '_blank'); } catch (e) { win = null; }
    if (win) {
      try { win.opener = null; } catch (e) { /* ignore */ }
      return win;
    }
    showFallback(url);
    return null;
  }

  /** 弹窗被拦时，给一个可点的小浮条（点击本身就是用户手势，能过拦截） */
  function showFallback(url) {
    if (!document.body) { setTimeout(function () { showFallback(url); }, 100); return; }

    const old = document.getElementById('wb-open-img');
    if (old) old.remove();

    const bar = document.createElement('div');
    bar.id = 'wb-open-img';
    bar.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:96px', 'transform:translateX(-50%)',
      'z-index:2147483647', 'background:#1f1f1d', 'color:#fff',
      'padding:10px 16px', 'border-radius:10px', 'font:13px/1.5 system-ui',
      'box-shadow:0 8px 28px rgba(0,0,0,.28)', 'display:flex', 'gap:12px',
      'align-items:center', 'max-width:70vw'
    ].join(';');

    const tip = document.createElement('span');
    tip.textContent = '浏览器拦了自动弹窗，点这里打开：';

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '打开原图';
    link.style.cssText = 'color:#7ee2b8;text-decoration:underline;white-space:nowrap';

    const close = document.createElement('span');
    close.textContent = '✕';
    close.style.cssText = 'cursor:pointer;color:#888';
    close.onclick = function () { bar.remove(); };

    link.onclick = function () { setTimeout(function () { bar.remove(); }, 300); };

    bar.appendChild(tip);
    bar.appendChild(link);
    bar.appendChild(close);
    document.body.appendChild(bar);
    setTimeout(function () { if (bar.isConnected) bar.remove(); }, 12000);
  }

  /* ==================================================================
   * 4. 验证升级后的地址
   *
   * 真实加载一次：如果加载失败（多半是签名对不上，403），
   * 就把已经打开的标签页导航回原地址，不让用户对着一个错误页面发呆。
   * ================================================================== */
  function verify(upgraded, original, win) {
    const probe = new Image();
    let settled = false;

    const fallback = function () {
      if (!win) return;
      try { win.location.href = original; } catch (e) { /* ignore */ }
    };

    probe.onload = function () {
      settled = true;
      probe.onload = probe.onerror = null;
    };
    probe.onerror = function () {
      if (settled) return;
      settled = true;
      probe.onload = probe.onerror = null;
      fallback();
    };

    probe.src = upgraded;
    // 超时就不管了 —— 保持已经打开的内容，不做多余动作
    setTimeout(function () { settled = true; probe.onload = probe.onerror = null; }, VERIFY_MS);
  }

  /* ==================================================================
   * 5. 点击拦截
   * ================================================================== */
  let lastOpen = 0;

  document.addEventListener('click', function (e) {
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // 保留原生手势

    const img = findImage(e.target);
    if (!img) return;                       // 没点到图 → 什么都不做

    const raw = img.currentSrc || img.src || '';
    if (!/^https?:\/\//i.test(raw)) return;

    const now = Date.now();
    if (now - lastOpen < 400) return;       // 防止一次点击开两个标签
    lastOpen = now;

    const upgraded = upgrade(raw);

    // 阻止 ChatGPT 自己的内置预览叠加弹出
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    if (upgraded === raw) {
      // 本来就是原图，直接开
      openTab(raw);
      return;
    }

    // 先开升级后的地址（必须在用户手势的同步栈里，否则被弹窗拦截），
    // 然后验证一下，失败就退回原地址。
    const win = openTab(upgraded);
    verify(upgraded, raw, win);
  }, true);

  /* ==================================================================
   * 6. 光标提示
   *
   * @run-at document-start 时 document.head / documentElement 可能还是 null，
   * 直接 appendChild 会抛异常并掐死整个 IIFE —— 所以做成可重试。
   * ================================================================== */
  const CSS = 'main img, main [style*="background-image"] { cursor: zoom-in !important; }';

  function injectStyle() {
    const t = document.head || document.documentElement;
    if (!t) return false;
    if (document.getElementById('wb-img-opener-style')) return true;
    const s = document.createElement('style');
    s.id = 'wb-img-opener-style';
    s.textContent = CSS;
    t.appendChild(s);
    return true;
  }

  if (!injectStyle()) {
    const timer = setInterval(function () {
      if (injectStyle()) clearInterval(timer);
    }, 20);
    setTimeout(function () { clearInterval(timer); }, 15000);
  }
})();
