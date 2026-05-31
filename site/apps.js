// Apps section + home "apps" tile count. Renders app cards from MA_CONFIG.apps.
// No telemetry / Supabase — replaces the old landing.js. Each card links to the
// GitHub-backed detail page (app.html?slug=…, rendered by app-detail.js).
(() => {
  const cfg = window.MA_CONFIG;
  const grid = document.getElementById('apps-grid');
  if (grid && cfg?.apps) {
    grid.innerHTML = cfg.apps.map(app => `
      <a class="card app-card" href="app.html?slug=${encodeURIComponent(app.slug)}">
        <div class="app-card-icon">${escapeHtml(app.display.charAt(0))}</div>
        <div class="app-card-body">
          <span class="card-tag">${escapeHtml(app.platform || 'macOS')}</span>
          <h3>${escapeHtml(app.display)}</h3>
          <p class="card-summary">${escapeHtml(app.tagline || '')}</p>
          <span class="card-cta">View app →</span>
        </div>
      </a>`).join('');
  }

  const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  if (cfg?.apps) set('home-apps-count', cfg.apps.length);

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
