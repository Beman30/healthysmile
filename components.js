(function(){
  // ── CSS ──────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.id = 'hs-components-style';
  style.textContent = [
    "@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');",
    ":root{--hs-black:#0e0e0e;--hs-white:#fafaf8;--hs-accent:#C8005C;--hs-serif:'DM Serif Display',Georgia,serif;--hs-sans:'DM Sans',system-ui,sans-serif;}",
    "#hs-nav{position:sticky;top:0;z-index:100;background:var(--hs-black);border-bottom:1px solid #2a2a2a;padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:56px}",
    "#hs-nav .hs-nav-logo{font-family:var(--hs-serif);font-size:18px;color:var(--hs-black);text-decoration:none;letter-spacing:-0.01em}",
    "#hs-nav .hs-nav-links{display:flex;gap:8px;align-items:center}",
    "#hs-nav .hs-nav-links a{font-size:13px;font-weight:400;color:#ffffff;text-decoration:none;padding:6px 12px;border-radius:6px;transition:background 0.15s}",
    "#hs-nav .hs-nav-links a:hover{background:#222}",
    "#hs-nav .hs-nav-links a.active{color:var(--hs-accent);font-weight:500}",
    "#hs-nav .hs-nav-cta{font-size:13px!important;font-weight:500!important;background:#C8005C;color:var(--hs-white)!important;padding:8px 16px!important;border-radius:6px;transition:opacity 0.15s}",
    "#hs-nav .hs-nav-cta:hover{opacity:0.85;background:#a0004a!important}",
    ".hs-hamburger{display:none;flex-direction:column;justify-content:center;gap:5px;width:36px;height:36px;cursor:pointer;padding:4px;background:none;border:none;flex-shrink:0}",
    ".hs-hamburger span{display:block;height:2px;background:#ffffff;border-radius:2px;transition:transform 0.3s,opacity 0.3s}",
    ".hs-hamburger:hover span{background:#f0a0c0}",
    ".hs-hamburger.open span:nth-child(1){transform:translateY(7px) rotate(45deg)}",
    ".hs-hamburger.open span:nth-child(2){opacity:0}",
    ".hs-hamburger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}",
    ".hs-drawer{position:fixed;top:0;right:0;bottom:0;width:260px;background:#1C1C1C;z-index:300;transform:translateX(100%);transition:transform 0.35s cubic-bezier(0.4,0,0.2,1);display:flex;flex-direction:column;padding:80px 32px 40px;gap:8px;border-left:1px solid #2a2a2a}",
    ".hs-drawer.open{transform:translateX(0)}",
    ".hs-drawer-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:290;opacity:0;pointer-events:none;transition:opacity 0.35s}",
    ".hs-drawer-overlay.open{opacity:1;pointer-events:auto}",
    ".hs-drawer a{font-family:var(--hs-sans);font-size:1.05rem;color:#aaa;text-decoration:none;padding:12px 0;border-bottom:1px solid #2a2a2a;transition:color 0.15s;display:block}",
    ".hs-drawer a:hover,.hs-drawer a.active{color:#fff}",
    ".hs-drawer a.active{color:#f0a0c0}",
    ".hs-drawer .hs-drawer-cta{margin-top:24px;background:var(--hs-accent);color:#fff!important;text-align:center;padding:14px 20px!important;border-radius:4px;border:none!important;font-weight:500;display:block}",
    ".hs-drawer .hs-drawer-cta:hover{background:#a0004a!important}",
    ".hs-drawer-close{position:absolute;top:16px;right:16px;background:none;border:none;color:#666;font-size:1.5rem;cursor:pointer;padding:8px;line-height:1;transition:color 0.15s}",
    ".hs-drawer-close:hover{color:#fff}",
    "@media(max-width:768px){.hs-hamburger{display:flex}#hs-nav .hs-nav-links{display:none}#hs-nav{padding:0 16px}}",
    "#hs-footer{background:#0a0a0a;padding:28px 24px 20px;border-top:1px solid #2a2a2a;display:flex;flex-direction:column;gap:0}",
    "#hs-footer .hs-footer-top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding-bottom:20px}",
    "#hs-footer .hs-footer-logo{font-family:var(--hs-serif);font-size:16px;color:#888}",
    "#hs-footer .hs-footer-logo em{font-style:italic;color:#f0a0c0}",
    "#hs-footer .hs-footer-links{display:flex;gap:16px;flex-wrap:wrap}",
    "#hs-footer .hs-footer-links a{font-size:13px;color:#888;text-decoration:none;transition:color 0.15s}",
    "#hs-footer .hs-footer-links a:hover{color:#ccc}",
    "#hs-footer .hs-footer-legal{font-size:12px;color:#555;border-top:1px solid #1e1e1e;padding-top:16px}",
    "@media(max-width:768px){#hs-footer .hs-footer-top{flex-direction:column;align-items:flex-start}}"
  ].join('');
  document.head.appendChild(style);

  // ── NAV ──────────────────────────────────────────────────────────────
  var LOGO_SRC = 'data:image/png;base64,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';
  var WA_URL   = 'https://wa.me/393924076794?text=Ciao%2C%20ho%20visto%20il%20sito%20e%20vorrei%20informazioni';

  var nav = document.createElement('nav');
  nav.id = 'hs-nav';
  nav.innerHTML =
    '<a href="https://healthysmile.it" class="hs-nav-logo">' +
      '<img src="' + LOGO_SRC + '" alt="Healthy Smile By N" style="height:44px;width:auto;display:block;">' +
    '</a>' +
    '<div class="hs-nav-links">' +
      '<a href="https://healthysmile.it/prevenzione">Prevenzione</a>' +
      '<a href="https://healthysmile.it/salva-il-tuo-dente">Non estrarre</a>' +
      '<a href="' + WA_URL + '" class="hs-nav-cta">Scrivici</a>' +
    '</div>' +
    '<button class="hs-hamburger" id="hs-hamburger" aria-label="Menu">' +
      '<span></span><span></span><span></span>' +
    '</button>';

  var overlay = document.createElement('div');
  overlay.className = 'hs-drawer-overlay';
  overlay.id = 'hs-drawer-overlay';

  var drawer = document.createElement('div');
  drawer.className = 'hs-drawer';
  drawer.id = 'hs-drawer';
  drawer.innerHTML =
    '<button class="hs-drawer-close" id="hs-drawer-close">&#x2715;</button>' +
    '<a href="https://healthysmile.it/prevenzione">Prevenzione</a>' +
    '<a href="https://healthysmile.it">Chi siamo</a>' +
    '<a href="https://healthysmile.it/salva-il-tuo-dente">Non estrarre</a>' +
    '<a href="' + WA_URL + '" class="hs-drawer-cta">Scrivici su WhatsApp</a>';

  // ── FOOTER ───────────────────────────────────────────────────────────
  var footer = document.createElement('footer');
  footer.id = 'hs-footer';
  footer.innerHTML =
    '<div class="hs-footer-top">' +
      '<span class="hs-footer-logo">Healthy Smile <em>By N</em> &middot; Torino</span>' +
      '<div class="hs-footer-links">' +
        '<a href="https://healthysmile.it/prevenzione">Prevenzione</a>' +
        '<a href="https://healthysmile.it/salva-il-tuo-dente">Non estrarre</a>' +
        '<a href="https://www.instagram.com/healthy.smile.by.n" target="_blank" rel="noopener">Instagram</a>' +
        '<a href="tel:+390112488248">011 2488248</a>' +
      '</div>' +
    '</div>' +
    '<div class="hs-footer-legal">' +
      '&copy; ' + new Date().getFullYear() + ' Dominus Srl &nbsp;&middot;&nbsp; Via Lagrange 10, Torino &nbsp;&middot;&nbsp; P.IVA 12923420017' +
    '</div>';

  // ── INJECT ───────────────────────────────────────────────────────────
  function inject(){
    if(!document.getElementById('hs-nav')){
      document.body.insertBefore(nav, document.body.firstChild);
      document.body.insertBefore(overlay, nav.nextSibling);
      document.body.insertBefore(drawer, overlay.nextSibling);
    }
    if(!document.getElementById('hs-footer')){
      document.body.appendChild(footer);
    }

    // Mark active link
    var path = location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
    document.querySelectorAll('#hs-nav .hs-nav-links a, .hs-drawer a').forEach(function(a){
      var ap = (new URL(a.href)).pathname.replace(/\/$/, '') || '/';
      if(ap === path) a.classList.add('active'); else a.classList.remove('active');
    });

    // Drawer logic
    var btn      = document.getElementById('hs-hamburger');
    var drw      = document.getElementById('hs-drawer');
    var ovl      = document.getElementById('hs-drawer-overlay');
    var closeBtn = document.getElementById('hs-drawer-close');
    function openDrawer(){btn.classList.add('open');drw.classList.add('open');ovl.classList.add('open');document.body.style.overflow='hidden'}
    function closeDrawer(){btn.classList.remove('open');drw.classList.remove('open');ovl.classList.remove('open');document.body.style.overflow=''}
    btn.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    ovl.addEventListener('click', closeDrawer);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
