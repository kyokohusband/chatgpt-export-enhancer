
(function(){
  function clean(t){ return (t||'').replace(/\s+/g,' ').trim(); }
  function cut(t,n){ return t.length > n ? t.slice(0,n) + '\u2026' : t; }
  function build(){
    var turns = document.querySelectorAll('article.turn');
    if (!turns.length) return;
    var ti = document.querySelector('h1.doc-title') || document.querySelector('h1');
    var title = clean(ti && ti.textContent) || clean(document.title) || '对话';
    var nav = document.createElement('nav');
    nav.className = 'wb-toc';
    var head = document.createElement('div');
    head.className = 'wb-toc-t';
    head.textContent = title;
    nav.appendChild(head);

    var items = [], n = 0;
    function add(el, text, lv){
      if (!el || !text) return;
      n += 1;
      var id = el.id;
      if (!id) {
        id = 'wb-sec-' + n;
        while (document.getElementById(id)) id += '-x';
        el.setAttribute('id', id);
      }
      var a = document.createElement('a');
      a.className = 'lv' + lv;
      if (lv > 2) a.style.paddingLeft = Math.min(9 + (lv - 1) * 12, 69) + 'px';
      a.textContent = cut(text, lv === 1 ? 34 : 28);
      a.title = text;
      a.setAttribute('data-target', id);
      nav.appendChild(a);
      items.push({ a: a, el: el });
    }
    for (var i = 0; i < turns.length; i++) {
      var t = turns[i];
      var body = t.querySelector('.body');
      if (t.className.indexOf('user') >= 0) {
        add(t, clean(body && body.textContent), 1);
      } else {
        var hs = Array.from((body || t).querySelectorAll('h1, h2, h3, h4, h5, h6'))
          .filter(function(h){ return !h.closest('pre, .wb-widget'); });
        var minLevel = hs.reduce(function(min, h){ return Math.min(min, Number(h.tagName.slice(1))); }, 6);
        for (var j = 0; j < hs.length; j++) {
          var level = 2 + Number(hs[j].tagName.slice(1)) - minLevel;
          add(hs[j], clean(hs[j].textContent), level);
        }
      }
    }
    if (!items.length) {
      var p = document.createElement('div');
      p.className = 'wb-toc-empty';
      p.textContent = '\uff08\u672c\u9875\u6ca1\u6709\u5206\u8282\u6807\u9898\uff09';
      nav.appendChild(p);
    }
    document.body.appendChild(nav);
    document.body.className += ' wb-with-toc';

    nav.addEventListener('click', function(e){
      var t = e.target, a = t && t.closest ? t.closest('a') : null;
      if (!a) return;
      e.preventDefault();
      var el = document.getElementById(a.getAttribute('data-target'));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    var raf = 0;
    function spy(){
      raf = 0;
      var y = window.scrollY + 130, cur = items.length ? 0 : -1;
      for (var i = 0; i < items.length; i++) {
        if (items[i].el.getBoundingClientRect().top + window.scrollY <= y) cur = i;
      }
      for (var k = 0; k < items.length; k++) items[k].a.classList.toggle('on', k === cur);
    }
    window.addEventListener('scroll', function(){ if (!raf) raf = requestAnimationFrame(spy); }, { passive: true });
    window.addEventListener('resize', spy);
    spy();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
