/* enhancements.js — count-up, back-to-top, scrollspy, reading progress */

// ── Reading progress bar ──────────────────────────────────────────────────────
// Only activates on blog post pages (presence of .post-wrap)
(function () {
  if (!document.querySelector('.post-wrap')) return;

  var bar = document.createElement('div');
  bar.id = 'reading-progress';
  document.body.appendChild(bar);

  window.addEventListener('scroll', function () {
    var doc = document.documentElement;
    var scrolled = doc.scrollTop || document.body.scrollTop;
    var total = doc.scrollHeight - doc.clientHeight;
    bar.style.width = (total > 0 ? (scrolled / total) * 100 : 0) + '%';
  }, { passive: true });
})();

// ── Count-up animation ────────────────────────────────────────────────────────
// Triggers on .about-stat .num elements when they scroll into view.
// Only values that start with a number (e.g. "15+") are counted up.
(function () {
  var statsWrap = document.querySelector('.about-stats');
  if (!statsWrap) return;

  var nums = statsWrap.querySelectorAll('.num');
  if (!nums.length) return;

  // Authored text is already the final value; skip the count-up entirely.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function parseNum(text) {
    if (!/^\s*\d[\d,]*/.test(text)) return null;
    var suffix = text.replace(/[\d,]/g, '').trim();
    var value = parseInt(text.replace(/[^\d]/g, ''), 10);
    if (isNaN(value)) return null;
    return { value: value, suffix: suffix };
  }

  function animateNum(el, target, suffix, duration) {
    if (isNaN(target)) return;
    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      var current = Math.floor(eased * target);
      if (isNaN(current)) return;
      el.textContent = current.toLocaleString('en-US') + suffix;
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target.toLocaleString('en-US') + suffix;
    }
    requestAnimationFrame(step);
  }

  var fired = false;
  var observer = new IntersectionObserver(function (entries) {
    if (!entries[0].isIntersecting || fired) return;
    fired = true;
    nums.forEach(function (el) {
      var p = parseNum(el.textContent);
      if (!p || isNaN(p.value)) return;
      animateNum(el, p.value, p.suffix, p.value > 1000 ? 2000 : 1200);
    });
  }, { threshold: 0.4 });

  observer.observe(statsWrap);
})();

// ── Back-to-top button ────────────────────────────────────────────────────────
(function () {
  var btn = document.createElement('button');
  btn.id = 'back-to-top';
  btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = '&#8679;';
  document.body.appendChild(btn);

  window.addEventListener('scroll', function () {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });

  btn.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

// ── Scrollspy — auto-highlight current page in nav ───────────────────────────
(function () {
  var path = window.location.pathname;

  var map = {
    '/index.html': 'home',
    '/':           'home',
    '/about.html': 'about',
    '/portfolio.html': 'portfolio',
    '/blog/':      'blog',
    '/blog/index.html': 'blog',
    '/contact.html': 'contact',
  };

  // Blog post pages
  if (path.indexOf('/blog/posts/') !== -1) map[path] = 'blog';

  var key = map[path];
  if (!key) return;

  document.querySelectorAll('.header .top-menu .menu li a').forEach(function (a) {
    var href = a.getAttribute('href') || '';
    var match = false;
    if (key === 'home' && (href === 'index.html' || href === '/index.html' || href === '/' || href === '/index.html')) match = true;
    if (key === 'about' && href.indexOf('about.html') !== -1) match = true;
    if (key === 'portfolio' && href.indexOf('portfolio.html') !== -1) match = true;
    if (key === 'blog' && href.indexOf('/blog') !== -1) match = true;
    if (key === 'contact' && /contact\.html$/.test(href)) match = true;

    var li = a.parentElement;
    if (match) {
      li.classList.add('current-menu-item');
      a.setAttribute('aria-current', 'page');
    } else {
      li.classList.remove('current-menu-item');
      a.removeAttribute('aria-current');
    }
  });
})();
