// Renders the Scripts section from data/scripts.json — a daily snapshot of
// Mac-Andreas repos tagged with the configured GitHub topic (default:
// `openmp-script-port`). Tag a repo with that topic and the next workflow
// run will surface it here automatically.
(async () => {
  const grid = document.getElementById('scripts-grid');
  if (!grid) return;

  let snap;
  try {
    const res = await fetch('data/scripts.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    snap = await res.json();
  } catch (e) {
    console.error('Failed to load data/scripts.json', e);
    grid.innerHTML = '<p class="err">Could not load scripts.</p>';
    return;
  }

  const topic = snap.topic || 'openmp-script-port';
  const items = (snap.scripts || []).slice().sort((a, b) => b.stars - a.stars);

  if (!items.length) {
    grid.innerHTML = `
      <p class="empty-note">
        No featured scripts yet. Any repo under
        <code>${escapeHtml(snap.account || 'Mac-Andreas')}</code> tagged with
        the GitHub topic <code>${escapeHtml(topic)}</code> will appear here
        automatically after the next daily refresh.
      </p>`;
    return;
  }

  grid.innerHTML = '';
  for (const r of items) {
    const card = document.createElement('article');
    card.className = 'card';
    const licence = r.has_license
      ? `<a href="${escapeAttr(r.license_url || (r.html_url + '/blob/HEAD/LICENSE'))}" target="_blank" rel="noopener" class="card-licence">${escapeHtml(r.license || 'Licensed')}</a>`
      : `<span class="card-licence card-licence-missing">No licence</span>`;
    const lang = r.language
      ? `<span class="tag"><span class="lang-dot" style="background:${escapeAttr(r.language_color || '#C9A86B')}"></span>${escapeHtml(r.language)}</span>`
      : '';
    const archived = r.archived ? '<span class="card-tag" style="color:var(--amber);border-color:var(--amber);">Archived</span>' : '';
    card.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <span class="card-tag">Script</span>
        ${archived}
        ${licence}
      </div>
      <h3>${escapeHtml(r.name)}</h3>
      <p class="card-summary">${escapeHtml(r.description || 'No description.')}</p>
      <div class="tag-row" style="margin-top:4px;">
        ${lang}
        ${r.stars ? `<span class="tag">★ ${r.stars}</span>` : ''}
        ${r.forks ? `<span class="tag">⑂ ${r.forks}</span>` : ''}
      </div>
      <div class="card-actions">
        <a class="dl-btn" href="${escapeAttr(r.html_url)}" target="_blank" rel="noopener">
          <span class="dl-btn-icon">↗</span>
          <span class="dl-btn-text"><strong>View on GitHub</strong></span>
        </a>
        <a class="dl-btn dl-btn-ghost" href="${escapeAttr(r.html_url + '/releases/latest')}" target="_blank" rel="noopener">
          <span class="dl-btn-icon">⬇</span>
          <span class="dl-btn-text"><strong>Releases</strong></span>
        </a>
      </div>
    `;
    grid.appendChild(card);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
