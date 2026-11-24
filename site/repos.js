// Garage — every PUBLIC repository in the Mac-Andreas GitHub org.
//
// Read live from the GitHub REST API (no key, CORS-enabled). The result is
// cached in sessionStorage for an hour so repeat visits stay well inside the
// unauthenticated 60-requests/hour limit. If the API is unreachable or
// rate-limited, the committed data/garage.json snapshot is used instead.
// Also fills the home page "Garage" tile count.
(async () => {
  const ORG = 'Mac-Andreas';
  const API = `https://api.github.com/orgs/${ORG}/repos?type=public&per_page=100&sort=pushed`;
  const CACHE_KEY = 'ma_garage_v1';
  const TTL = 60 * 60 * 1000;
  // GitHub linguist colours for the languages the org uses.
  const LANG_COLORS = {
    'C++': '#f34b7d', C: '#555555', Swift: '#F05138', TypeScript: '#3178c6',
    JavaScript: '#f1e05a', Pawn: '#dbb284', Python: '#3572A5', Shell: '#89e051',
    Rust: '#dea584', Go: '#00ADD8', 'Objective-C': '#438eff', HTML: '#e34c26', CSS: '#563d7c',
  };

  const grid = document.getElementById('repos-grid');
  const meta = document.getElementById('garage-meta');
  const homeCount = document.getElementById('home-repos-count');
  if (!grid && !homeCount) return;

  const fromApi = (r) => ({
    name: r.name, html_url: r.html_url, description: r.description,
    stars: r.stargazers_count || 0, forks: r.forks_count || 0, pushed_at: r.pushed_at,
    archived: !!r.archived, fork: !!r.fork, language: r.language,
    license: r.license && r.license.spdx_id, private: !!r.private,
  });

  async function load() {
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (c && Date.now() - c.at < TTL && Array.isArray(c.repos)) return { repos: c.repos, live: true };
    } catch {}
    try {
      const res = await fetch(API);
      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr)) {
          const repos = arr.map(fromApi).filter(r => !r.private);
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), repos })); } catch {}
          return { repos, live: true };
        }
      }
    } catch {}
    try {
      const res = await fetch('data/garage.json', { cache: 'no-cache' });
      if (res.ok) {
        const snap = await res.json();
        const repos = (snap.repos || snap.garage || []).filter(r => !r.private);
        return { repos, live: false, at: snap.fetched_at };
      }
    } catch {}
    return null;
  }

  const data = await load();
  if (!data) {
    if (grid) grid.innerHTML = '<p class="err">Could not load the repositories — try again in a minute.</p>';
    return;
  }

  const repos = data.repos.slice().sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));
  if (homeCount) homeCount.textContent = String(repos.length);
  if (meta) {
    meta.textContent = `${repos.length} public ${repos.length === 1 ? 'repository' : 'repositories'} · github.com/${ORG}`
      + (data.live ? '' : ' · cached snapshot');
  }
  if (!grid) return;

  if (!repos.length) {
    grid.innerHTML = '<p class="err" style="background:transparent;border-color:var(--border);color:var(--muted);">No public repositories yet.</p>';
    return;
  }

  grid.innerHTML = repos.map(r => {
    const lang = r.language
      ? `<span class="lang"><span class="lang-dot" style="background:${LANG_COLORS[r.language] || 'var(--sand)'}"></span>${esc(r.language)}</span>`
      : '';
    const stars = r.stars ? `<span class="star">★ ${r.stars}</span>` : '';
    const forks = r.forks ? `<span class="fork">⑂ ${r.forks}</span>` : '';
    const lic = r.license && r.license !== 'NOASSERTION' ? `<span class="lic">${esc(r.license)}</span>` : '';
    const upd = r.pushed_at ? `<span class="upd" title="${esc(new Date(r.pushed_at).toLocaleString('en-GB'))}">Updated ${ago(r.pushed_at)}</span>` : '';
    const tags = [r.fork ? '<span class="repo-tag fork-tag">Fork</span>' : '', r.archived ? '<span class="repo-tag archived-tag">Archived</span>' : ''].join('');
    return `
      <a class="repo-card${tags ? ' has-tags' : ''}" href="${esc(r.html_url)}" target="_blank" rel="noopener">
        ${tags ? `<div class="repo-tags">${tags}</div>` : ''}
        <h3>${esc(r.name)}</h3>
        <p class="desc">${esc(r.description || 'No description.')}</p>
        <div class="stat-row">${lang}${stars}${forks}${lic}${upd}</div>
      </a>`;
  }).join('');

  function ago(iso) {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days < 1) return 'today';
    if (days < 2) return 'yesterday';
    if (days < 31) return `${days} days ago`;
    const months = Math.round(days / 30.44);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
    const years = Math.round(days / 365.25);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
