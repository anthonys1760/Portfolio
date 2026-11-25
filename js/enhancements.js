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
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
})();

// ── CallCatch live demo link (#callcatch-demo) ────────────────────────────────
(function () {
  function findLauncher() {
    var children = document.body ? document.body.children : [];
    for (var s = 0; s < children.length; s++) {
      var sr = children[s].shadowRoot;
      if (!sr) continue;
      var shadowBtn = sr.querySelector('button.bubble.launcher-circle[aria-controls="cc-panel"]');
      if (shadowBtn) return shadowBtn;
    }
    var nodes = document.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var label = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).toLowerCase();
      if (label.indexOf('callcatch') !== -1) {
        var style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'absolute') return el;
      }
    }
    var candidates = document.querySelectorAll('[class*="callcatch" i], [id*="callcatch" i], [class*="CallCatch"]');
    for (var j = 0; j < candidates.length; j++) {
      var node = candidates[j];
      if (node.tagName === 'BUTTON' || node.getAttribute('role') === 'button') return node;
      var btn = node.querySelector('button, [role="button"]');
      if (btn) return btn;
    }
    return null;
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href="#callcatch-demo"]');
    if (!link) return;
    if (window.CallCatch && typeof window.CallCatch.open === 'function') {
      e.preventDefault();
      window.CallCatch.open();
      return;
    }
    var launcher = findLauncher();
    if (!launcher) return;
    e.preventDefault();
    if (typeof launcher.focus === 'function') launcher.focus();
    if (typeof launcher.click === 'function') launcher.click();
  });
})();

// ── CallCatch Octopus Mascot Launcher ─────────────────────────────────────────
// Upgrades the round CallCatch chat button inside its open shadow root into an
// original mint/emerald octopus mascot that floats upward on hover/focus.
(function () {
  if (!document.body) return;

  var OCTO_SVG =
    '<svg class="octo-svg" viewBox="0 0 80 84" width="60" height="63" aria-hidden="true" focusable="false">' +
      '<defs>' +
        '<radialGradient id="cc-octo-body" cx="36%" cy="28%" r="72%">' +
          '<stop offset="0%" stop-color="#8affcb"/>' +
          '<stop offset="38%" stop-color="#4bffa5"/>' +
          '<stop offset="76%" stop-color="#179e6c"/>' +
          '<stop offset="100%" stop-color="#0b4f3a"/>' +
        '</radialGradient>' +
        '<linearGradient id="cc-octo-tentacle" x1="0%" y1="0%" x2="0%" y2="100%">' +
          '<stop offset="0%" stop-color="#22c785"/>' +
          '<stop offset="100%" stop-color="#0c5941"/>' +
        '</linearGradient>' +
        '<linearGradient id="cc-octo-rim" x1="0%" y1="0%" x2="100%" y2="100%">' +
          '<stop offset="0%" stop-color="#c9ffe6" stop-opacity="0.9"/>' +
          '<stop offset="100%" stop-color="#19c8b8" stop-opacity="0.45"/>' +
        '</linearGradient>' +
      '</defs>' +

      // Back curled tentacles (left & right outer arms)
      '<g class="octo-t octo-t-left">' +
        '<path d="M24 44 C15 47, 9 43, 10 36 C10.7 31, 16 30, 17 34.5 C17.6 37.5, 14 38.5, 14 36.2 C14 40, 18.5 41.5, 24 39 Z" fill="url(#cc-octo-tentacle)" stroke="#083829" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<circle cx="13.5" cy="40.5" r="1.2" fill="#8affcb" opacity="0.75"/>' +
        '<circle cx="17.2" cy="42.5" r="1.1" fill="#8affcb" opacity="0.65"/>' +
        // Inner-left curled leg
        '<path d="M30 46 C26 54, 21 61, 16 58.5 C12.5 56.8, 13.8 52, 17 53 C18.8 53.6, 18.2 55.6, 16.8 55.2 C19.5 56.5, 23 51.5, 25 45 Z" fill="url(#cc-octo-tentacle)" stroke="#083829" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<circle cx="21.5" cy="54.2" r="1.1" fill="#8affcb" opacity="0.7"/>' +
      '</g>' +

      '<g class="octo-t octo-t-right">' +
        '<path d="M56 44 C65 47, 71 43, 70 36 C69.3 31, 64 30, 63 34.5 C62.4 37.5, 66 38.5, 66 36.2 C66 40, 61.5 41.5, 56 39 Z" fill="url(#cc-octo-tentacle)" stroke="#083829" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<circle cx="66.5" cy="40.5" r="1.2" fill="#8affcb" opacity="0.75"/>' +
        '<circle cx="62.8" cy="42.5" r="1.1" fill="#8affcb" opacity="0.65"/>' +
        // Inner-right curled leg
        '<path d="M50 46 C54 54, 59 61, 64 58.5 C67.5 56.8, 66.2 52, 63 53 C61.2 53.6, 61.8 55.6, 63.2 55.2 C60.5 56.5, 57 51.5, 55 45 Z" fill="url(#cc-octo-tentacle)" stroke="#083829" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<circle cx="58.5" cy="54.2" r="1.1" fill="#8affcb" opacity="0.7"/>' +
      '</g>' +

      // Front center curled tentacles
      '<g class="octo-t octo-t-mid">' +
        '<path d="M36 47 C34 55, 31 62.5, 35.8 64.5 C39 65.8, 40.8 62.2, 38.4 60.6 C36.9 59.6, 35.8 61.2, 36.8 62 C35 61, 36.8 55, 39.5 48 Z" fill="url(#cc-octo-tentacle)" stroke="#083829" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<path d="M44 47 C46 55, 49 62.5, 44.2 64.5 C41 65.8, 39.2 62.2, 41.6 60.6 C43.1 59.6, 44.2 61.2, 43.2 62 C45 61, 43.2 55, 40.5 48 Z" fill="url(#cc-octo-tentacle)" stroke="#083829" stroke-width="1.1" stroke-linejoin="round"/>' +
      '</g>' +

      // Rounded chubby mantle / head
      '<path d="M21 36 C19 22, 28 14, 40 14 C52 14, 61 22, 59 36 C58.2 43.5, 51 48.5, 40 48.5 C29 48.5, 21.8 43.5, 21 36 Z" fill="url(#cc-octo-body)" stroke="url(#cc-octo-rim)" stroke-width="1.4"/>' +

      // Soft top-left brow highlight
      '<path d="M27.5 23 C30.5 18.5, 36 17.2, 40.5 17.5" fill="none" stroke="#eafff5" stroke-width="2" stroke-linecap="round" opacity="0.65"/>' +

      // CallCatch sleek headset band + earpiece + mic boom
      '<path d="M20 31.5 C20 17, 29 10.5, 40 10.5 C51 10.5, 60 17, 60 31.5" fill="none" stroke="#0c241b" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path d="M21 29 C22 17, 30 11.5, 40 11.5 C50 11.5, 58 17, 59 29" fill="none" stroke="#4bffa5" stroke-width="0.9" stroke-linecap="round" opacity="0.75"/>' +
      // Left headset cushion
      '<rect x="17" y="28" width="4.8" height="9" rx="2.4" fill="#0d261d" stroke="#4bffa5" stroke-width="1.1"/>' +
      // Right headset cushion + glowing indicator
      '<rect x="58.2" y="28" width="4.8" height="9" rx="2.4" fill="#0d261d" stroke="#4bffa5" stroke-width="1.1"/>' +
      '<circle cx="60.6" cy="32.5" r="1.2" fill="#4bffa5"/>' +
      // Curved mic boom + tip
      '<path d="M59.5 36 C58.5 41.5, 54.5 43.5, 49.5 43" fill="none" stroke="#0d261d" stroke-width="1.8" stroke-linecap="round"/>' +
      '<circle cx="49" cy="43" r="1.7" fill="#0d261d" stroke="#4bffa5" stroke-width="0.9"/>' +

      // Friendly expressive eyes + catchlights
      '<ellipse cx="32.5" cy="32.5" rx="3.5" ry="4.2" fill="#071f16"/>' +
      '<circle cx="31.3" cy="30.9" r="1.35" fill="#effff7"/>' +
      '<circle cx="33.7" cy="34.1" r="0.65" fill="#4bffa5" opacity="0.9"/>' +

      '<ellipse cx="47.5" cy="32.5" rx="3.5" ry="4.2" fill="#071f16"/>' +
      '<circle cx="46.3" cy="30.9" r="1.35" fill="#effff7"/>' +
      '<circle cx="48.7" cy="34.1" r="0.65" fill="#4bffa5" opacity="0.9"/>' +

      // Soft cheeks + cheerful smile
      '<ellipse cx="26.2" cy="37.2" rx="2.6" ry="1.4" fill="#b4ffda" opacity="0.45"/>' +
      '<ellipse cx="53.8" cy="37.2" rx="2.6" ry="1.4" fill="#b4ffda" opacity="0.45"/>' +
      '<path d="M36.8 38.4 Q40 41.6 43.2 38.4" fill="none" stroke="#071f16" stroke-width="1.85" stroke-linecap="round"/>' +

      // Tiny CallCatch chat-spark badge near upper right
      '<g class="octo-spark">' +
        '<path d="M62 12 C62 8.7, 65.2 6.5, 69 6.5 C72.8 6.5, 76 8.7, 76 12 C76 15.3, 72.8 17.5, 69 17.5 C67.7 17.5, 66.4 17.2, 65.4 16.7 L62.4 18.2 L63.3 15.3 C62.5 14.4, 62 13.2, 62 12 Z" fill="#0f1f19" stroke="#4bffa5" stroke-width="1.3" stroke-linejoin="round"/>' +
        '<circle cx="66.2" cy="12" r="1" fill="#4bffa5"/>' +
        '<circle cx="69" cy="12" r="1" fill="#4bffa5"/>' +
        '<circle cx="71.8" cy="12" r="1" fill="#4bffa5"/>' +
      '</g>' +
    '</svg>';

  var OCTO_CSS = [
    '.wrap.circle{right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));}',
    '.bubble.launcher-circle{',
    '  width:62px;height:68px;padding:0;border-radius:24px;',
    '  background:transparent;color:#4bffa5;box-shadow:none;overflow:visible;',
    '  transition:transform .22s cubic-bezier(.22,1,.36,1),opacity .18s ease;',
    '}',
    '.bubble.launcher-circle:hover{filter:none;transform:none;}',
    '.bubble.launcher-circle:active{transform:scale(0.95);}',
    '.bubble.launcher-circle:focus{outline:none;}',
    '.bubble.launcher-circle:focus-visible{',
    '  outline:2.5px solid #4bffa5;outline-offset:4px;',
    '  box-shadow:0 0 0 5px rgba(15,20,18,0.85);',
    '}',
    '.bubble.launcher-circle.is-open{width:54px;height:54px;border-radius:50%;}',
    '.bubble.launcher-circle .ico-chat{',
    '  transition:opacity .18s ease,transform .2s ease;',
    '}',
    '.bubble.launcher-circle.is-open .ico-chat{opacity:0;transform:scale(0.75) translateY(6px);}',
    '.bubble.launcher-circle .ico-x{',
    '  width:52px;height:52px;margin:auto;border-radius:50%;',
    '  background:#111c17;color:#4bffa5;border:1.75px solid #4bffa5;',
    '  box-shadow:0 10px 26px rgba(0,0,0,.45),0 0 16px rgba(75,255,165,.24);',
    '}',
    '.octo-stage{',
    '  position:relative;width:62px;height:68px;display:flex;align-items:center;justify-content:center;',
    '  pointer-events:none;',
    '}',
    '.octo-glow{',
    '  position:absolute;bottom:2px;left:50%;width:44px;height:11px;',
    '  transform:translateX(-50%) scaleX(1) scaleY(1);',
    '  border-radius:50%;',
    '  background:radial-gradient(ellipse at center,rgba(75,255,165,.52) 0%,rgba(23,158,108,.26) 52%,rgba(0,0,0,0) 76%);',
    '  filter:blur(2.5px);opacity:.9;',
    '  transition:transform .34s cubic-bezier(.22,1,.36,1),opacity .34s ease,filter .34s ease;',
    '  animation:cc-octo-glow-idle 3.6s ease-in-out infinite;',
    '}',
    '.octo-aura{',
    '  position:absolute;inset:-4px;border-radius:50%;pointer-events:none;',
    '  background:radial-gradient(circle at 50% 45%,rgba(75,255,165,.22) 0%,rgba(23,158,108,.08) 48%,rgba(0,0,0,0) 72%);',
    '  opacity:.45;transition:opacity .34s ease,transform .34s cubic-bezier(.22,1,.36,1);',
    '}',
    '.octo-rig{',
    '  position:relative;display:flex;align-items:center;justify-content:center;',
    '  transform:translateY(0) scale(1);',
    '  transition:transform .34s cubic-bezier(.22,1,.36,1);',
    '}',
    '.octo-bob{',
    '  display:flex;align-items:center;justify-content:center;',
    '  animation:cc-octo-bob 3.6s ease-in-out infinite;',
    '}',
    '.octo-svg{display:block;width:60px;height:63px;overflow:visible;}',
    '.octo-t{transform-box:fill-box;transform-origin:50% 8%;}',
    '.octo-spark{transform-box:fill-box;transform-origin:20% 80%;transition:transform .3s ease;}',

    // Hover / keyboard focus float-up state
    '.bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-aura{',
    '  opacity:.95;transform:translateY(-8px) scale(1.08);',
    '}',
    '.bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-rig{',
    '  transform:translateY(-8px) scale(1.04);',
    '}',
    '.bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-glow{',
    '  animation:none;',
    '  transform:translateX(-50%) scaleX(.72) scaleY(.74);',
    '  opacity:.55;filter:blur(4px);',
    '}',
    '.bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-t-left{',
    '  animation:cc-octo-wiggle-left 1.05s ease-in-out infinite;',
    '}',
    '.bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-t-right{',
    '  animation:cc-octo-wiggle-right 1.05s ease-in-out infinite;',
    '}',
    '.bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-t-mid{',
    '  animation:cc-octo-wiggle-mid 0.9s ease-in-out infinite;',
    '}',
    '.bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-spark{',
    '  transform:translate(1px,-2px) scale(1.08);',
    '}',
    '.bubble.launcher-circle:not(.is-open):active .octo-rig{',
    '  transform:translateY(-2px) scale(0.96);',
    '}',

    '@keyframes cc-octo-bob{',
    '  0%,100%{transform:translateY(0);}',
    '  50%{transform:translateY(-2.5px);}',
    '}',
    '@keyframes cc-octo-glow-idle{',
    '  0%,100%{transform:translateX(-50%) scaleX(1) scaleY(1);opacity:.9;}',
    '  50%{transform:translateX(-50%) scaleX(.91) scaleY(.92);opacity:.74;}',
    '}',
    '@keyframes cc-octo-wiggle-left{',
    '  0%,100%{transform:rotate(0deg);}',
    '  35%{transform:rotate(-7deg);}',
    '  70%{transform:rotate(4deg);}',
    '}',
    '@keyframes cc-octo-wiggle-right{',
    '  0%,100%{transform:rotate(0deg);}',
    '  35%{transform:rotate(7deg);}',
    '  70%{transform:rotate(-4deg);}',
    '}',
    '@keyframes cc-octo-wiggle-mid{',
    '  0%,100%{transform:translateY(0) rotate(0deg);}',
    '  50%{transform:translateY(1.2px) rotate(3deg);}',
    '}',

    '@media (max-width:480px){',
    '  .wrap.circle{right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));}',
    '  .bubble.launcher-circle{width:56px;height:62px;}',
    '  .octo-stage{width:56px;height:62px;}',
    '  .octo-svg{width:54px;height:57px;}',
    '  .bubble.launcher-circle.is-open{width:50px;height:50px;}',
    '  .bubble.launcher-circle .ico-x{width:48px;height:48px;}',
    '}',
    '@media (prefers-reduced-motion:reduce){',
    '  .octo-bob,.octo-glow,',
    '  .bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-t-left,',
    '  .bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-t-right,',
    '  .bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-t-mid{',
    '    animation:none !important;',
    '  }',
    '  .bubble.launcher-circle,.bubble.launcher-circle .ico-chat,.octo-aura,.octo-rig,.octo-glow,.octo-spark{',
    '    transition:none !important;',
    '  }',
    '  .bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-aura{',
    '    transform:none;opacity:.95;',
    '  }',
    '  .bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-rig{',
    '    transform:none;',
    '  }',
    '  .bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-glow{',
    '    transform:translateX(-50%) scaleX(1) scaleY(1);opacity:.95;filter:blur(2.5px);',
    '  }',
    '  .bubble.launcher-circle:not(.is-open):is(:hover,:focus-visible) .octo-spark{',
    '    transform:none;',
    '  }',
    '}'
  ].join('\n');

  function upgradeRoot(root) {
    if (!root || root.querySelector('style[data-portfolio-octopus]')) return false;
    var btn = root.querySelector('button.bubble.launcher-circle[aria-controls="cc-panel"]');
    var icoChat = btn && btn.querySelector('.ico-chat');
    if (!btn || !icoChat) return false;

    var style = document.createElement('style');
    style.setAttribute('data-portfolio-octopus', '1');
    style.textContent = OCTO_CSS;
    root.appendChild(style);

    icoChat.innerHTML =
      '<span class="octo-stage">' +
        '<span class="octo-aura"></span><span class="octo-glow"></span>' +
        '<span class="octo-rig"><span class="octo-bob">' + OCTO_SVG + '</span></span>' +
      '</span>';

    btn.addEventListener('mouseenter', function () {
      var cf = document.querySelector('.cursor-follower');
      if (cf) cf.classList.add('hide');
    });
    btn.addEventListener('mouseleave', function () {
      var cf = document.querySelector('.cursor-follower');
      if (cf) cf.classList.remove('hide');
    });
    return true;
  }

  function scan() {
    var children = document.body.children;
    for (var i = 0; i < children.length; i++) {
      var sr = children[i].shadowRoot;
      if (sr && upgradeRoot(sr)) return true;
    }
    return false;
  }

  if (scan()) return;

  var observer = new MutationObserver(function () {
    if (scan()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true });

  document.addEventListener('DOMContentLoaded', function () {
    if (scan()) observer.disconnect();
  });
  window.addEventListener('load', function () {
    if (scan()) observer.disconnect();
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
