// Renders the Garage grid from data/pinned.json — a static snapshot committed
// by the daily refresh-repos workflow. Repos are filtered on GitHub by the
// `mac-andreas-project` topic. No GitHub API calls at runtime.
(async () => {
  const grid = document.getElementById('repos-grid');
  if (!grid) return;

  let snapshot;
  try {
    // Cache-bust against the commit SHA where possible. Pages serves the file
    // with normal HTTP caching; ?v= forces a fresh fetch on each load only
    // when the file itself changes (browser still caches by URL).
    const res = await fetch('data/pinned.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    snapshot = await res.json();
  } catch (e) {
    console.error('Failed to load data/pinned.json', e);
    grid.innerHTML = '<p class="err">Could not load pinned repos.</p>';
    return;
  }

  const repos = (snapshot.repos || [])
    .slice()
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));

  if (!repos.length) {
    grid.innerHTML = '<p class="err" style="background:transparent;border-color:var(--border);color:var(--muted);">No pinned repos yet. The daily refresh job will populate this list.</p>';
    return;
  }

  grid.innerHTML = '';
  for (const r of repos) {
    const a = document.createElement('a');
    a.href = r.html_url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'repo-card';
    const lang = r.language
      ? `<span class="lang"><span class="lang-dot" style="background:${r.language_color || '#C9A86B'}"></span>${escapeHtml(r.language)}</span>`
      : '';
    const stars = r.stars ? `<span class="star">★ ${r.stars}</span>` : '';
    const forks = r.forks ? `<span class="fork">⑂ ${r.forks}</span>` : '';
    const archived = r.archived ? '<span class="archived-tag">Archived</span>' : '';
    a.innerHTML = `
      ${archived}
      <h3>${escapeHtml(r.name)}</h3>
      <p class="desc">${escapeHtml(r.description || 'No description.')}</p>
      <div class="stat-row">
        ${lang}
        ${stars}
        ${forks}
      </div>
    `;
    grid.appendChild(a);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
})();
