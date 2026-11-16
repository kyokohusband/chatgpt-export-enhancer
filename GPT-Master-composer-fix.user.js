// ==UserScript==
// @name         GPT Master 修复 ChatGPT 输入框
// @namespace    local.chatgpt.gpt-master-composer-fix
// @version      1.0.0
// @description  修复 GPT Master 样式冲突导致的 ChatGPT 首页输入框隐藏
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ChatGPT 的此容器同时带有 hidden 和 only:contents。
  // 它是唯一子元素时应使用 display: contents；GPT Master 注入的全局
  // .hidden 样式会使它仍计算为 display: none，连带隐藏输入框。
  const css = String.raw`
    div.hidden.only\:contents:only-child:has(form[data-chatgpt-composer]) {
      display: contents !important;
    }
  `;

  function inject() {
    const root = document.head || document.documentElement;
    if (!root) return false;
    if (document.getElementById('gpt-master-composer-fix')) return true;
    const style = document.createElement('style');
    style.id = 'gpt-master-composer-fix';
    style.textContent = css;
    root.appendChild(style);
    return true;
  }

  if (!inject()) {
    const timer = setInterval(function () {
      if (inject()) clearInterval(timer);
    }, 20);
    setTimeout(function () { clearInterval(timer); }, 15000);
  }
})();
