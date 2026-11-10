/* TOT Stock — filet de sécurité : affiche l'erreur au lieu d'une page blanche (desktop / PWA). */
(function () {
  var shown = false;
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  function show(detail) {
    if (shown) return;
    var root = document.getElementById('root');
    if (root && root.childElementCount > 0) return; // l'application s'est affichée : rien à faire
    shown = true;
    var box = document.createElement('div');
    box.setAttribute('style', 'font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:760px;margin:40px auto;padding:20px;background:#fff;color:#0f172a;border:2px solid #f97316;border-radius:14px;');
    box.innerHTML =
      '<h2 style="margin:0 0 8px;color:#c2410c">TOT Stock — erreur au démarrage</h2>' +
      '<p style="margin:0 0 10px">L’application n’a pas pu s’afficher. Envoyez une capture de cet écran (ou le détail copié) au support.</p>' +
      '<pre id="tot-boot-detail" style="white-space:pre-wrap;word-break:break-word;background:#f1f5f9;padding:10px;border-radius:8px;font-size:12px;max-height:280px;overflow:auto">' + esc(detail) + '</pre>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
      '<button id="tot-boot-copy" style="padding:8px 12px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer">Copier le détail</button>' +
      '<button id="tot-boot-reload" style="padding:8px 12px;border-radius:8px;border:0;background:#f97316;color:#fff;font-weight:700;cursor:pointer">Recharger</button>' +
      '<button id="tot-boot-reset" style="padding:8px 12px;border-radius:8px;border:1px solid #fca5a5;background:#fff;color:#b91c1c;cursor:pointer">Vider le cache local et recharger</button>' +
      '</div>';
    document.body.appendChild(box);
    document.getElementById('tot-boot-copy').onclick = function () {
      try { navigator.clipboard.writeText(detail); } catch (e) {}
    };
    document.getElementById('tot-boot-reload').onclick = function () { location.reload(); };
    document.getElementById('tot-boot-reset').onclick = function () {
      if (!confirm('Vider le cache local ? Les données non synchronisées de cet appareil seront perdues.')) return;
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
      location.reload();
    };
  }
  function report(e) {
    var err = e && (e.error || e.reason);
    var detail = (e && (e.message || (err && err.message))) || 'Erreur inconnue';
    if (e && e.filename) detail += '\n' + e.filename + ':' + (e.lineno || '') + ':' + (e.colno || '');
    if (err && err.stack) detail += '\n\n' + err.stack;
    setTimeout(function () { show(detail); }, 400);
  }
  window.addEventListener('error', report);
  window.addEventListener('unhandledrejection', report);
})();
