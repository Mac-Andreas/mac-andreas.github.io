// App detail page renderer.
// - Reads ?slug=<slug> from URL, finds matching app in MA_CONFIG.apps
// - Fetches GitHub repo + latest release + topics + README in parallel
// - Renders hero icon (SVG glyph generated from slug), title, sidebar with
//   version/license/stars/forks/created/min-macOS, features parsed from README
(async () => {
  const cfg = window.MA_CONFIG;
  const slug = new URLSearchParams(location.search).get('slug');
  const app  = (cfg.apps || []).find(a => a.slug === slug);

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el != null) el.textContent = text;
  };
  const setHTML = (id, html) => {
    const el = document.getElementById(id);
    if (el != null) el.innerHTML = html;
  };

  if (!app) {
    document.title = 'App not found · Mac-Andreas';
    setText('app-title', 'Not found');
    setHTML('app-tagline', `Unknown app slug: <code>${escapeHtml(slug || '')}</code>. <a href="index.html" style="color:var(--ember);">Back to home</a>.`);
    return;
  }

  document.title = `${app.display} · Mac-Andreas`;
  setText('app-eyebrow', app.platform || 'macOS');
  const parts = app.display.split(' ');
  setHTML('app-title', `${escapeHtml(parts[0])} <span class="accent">${escapeHtml(parts.slice(1).join(' ') || '')}</span>`);
  setText('app-tagline', app.tagline || '');
  setText('sb-platform', app.platform || 'macOS');

  // ----- SVG glyph from slug -----
  setHTML('app-icon', renderGlyph(app));

  const repoUrl = app.repo || '';
  const m = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/i);
  if (!m) {
    setText('about-text', 'No GitHub repo configured.');
    return;
  }
  const [, owner, repo] = m;
  document.getElementById('repo-link').href = repoUrl;
  document.getElementById('download-btn').href = `${repoUrl}/releases/latest`;

  // ----- GitHub fetches -----
  const headers = { 'Accept': 'application/vnd.github+json' };
  const ghJson = async (path) => {
    try {
      const r = await fetch(`https://api.github.com${path}`, { headers });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };
  const ghText = async (path, accept) => {
    try {
      const r = await fetch(`https://api.github.com${path}`,
        { headers: { ...headers, ...(accept ? { 'Accept': accept } : {}) } });
      if (!r.ok) return null;
      return await r.text();
    } catch { return null; }
  };

  const [repoData, release, topicsData, readme] = await Promise.all([
    ghJson(`/repos/${owner}/${repo}`),
    ghJson(`/repos/${owner}/${repo}/releases/latest`),
    ghJson(`/repos/${owner}/${repo}/topics`),
    ghText(`/repos/${owner}/${repo}/readme`, 'application/vnd.github.raw'),
  ]);

  if (repoData) {
    if (repoData.created_at) {
      const d = new Date(repoData.created_at);
      const monthYear = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      setText('sb-created', monthYear);
    }
    if (repoData.license?.spdx_id && repoData.license.spdx_id !== 'NOASSERTION') {
      setText('sb-license', repoData.license.spdx_id);
    } else {
      setText('sb-license', 'No license');
    }
    setText('sb-stars', (repoData.stargazers_count ?? 0).toLocaleString());
    setText('sb-forks', (repoData.forks_count      ?? 0).toLocaleString());
    setText('about-text', repoData.description || 'No description provided in the repository.');
  } else {
    setText('about-text', 'Repository data unavailable. Possibly rate-limited or private.');
  }

  if (release) {
    setText('sb-version', release.tag_name || release.name || '—');
    if (release.published_at) {
      setText('sb-released', new Date(release.published_at).toLocaleDateString());
    }
    const assets = release.assets || [];
    const pick = assets.find(a => /\.dmg$/i.test(a.name))
              || assets.find(a => /\.pkg$/i.test(a.name))
              || assets.find(a => /mac|darwin|osx/i.test(a.name))
              || assets.find(a => /\.zip$/i.test(a.name))
              || assets[0];
    if (pick) {
      document.getElementById('download-btn').href = pick.browser_download_url;
      setText('dl-sub', `${pick.name} · ${formatBytes(pick.size)}`);
    } else {
      setText('dl-sub', `Latest release · ${release.tag_name || ''}`);
    }
  } else {
    setText('sb-version', 'No releases');
    setText('sb-released', '—');
    setText('dl-sub', 'View releases on GitHub');
  }

  // Tools list: topics + language.
  const tools = new Set();
  if (repoData?.language) tools.add(repoData.language);
  (topicsData?.names || []).forEach(t => tools.add(t));
  (app.tools || []).forEach(t => tools.add(t));
  const toolsHtml = tools.size
    ? [...tools].map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')
    : '<span class="tag muted-text">No tools listed.</span>';
  setHTML('tools-list', toolsHtml);

  // Features from README "Features" section.
  const features = extractFeatures(readme) || app.features || [];
  if (features.length) {
    setHTML('features-list', features.map(f => `<li>${escapeHtml(f)}</li>`).join(''));
  } else {
    setHTML('features-list', '<li class="muted-text">No features section in README yet.</li>');
  }

  if (readme) {
    const macMatch = readme.match(/macOS\s+(\d{1,2}(?:\.\d+)?)\s*(?:\+|or\s+later|or\s+newer|sonoma|ventura|sequoia|monterey|big\s*sur)?/i);
    if (macMatch) setText('sb-macos', `macOS ${macMatch[1]}+`);
    else setText('sb-macos', 'macOS 13+');
  } else {
    setText('sb-macos', 'macOS 13+');
  }

  // ============ Helpers ============

  function renderGlyph(app) {
    // Deterministic hue from slug, plus the first letter of the display name
    // as the glyph. Square 96x96, ember border, gradient fill.
    let h = 0;
    for (let i = 0; i < app.slug.length; i++) {
      h = (h * 31 + app.slug.charCodeAt(i)) >>> 0;
    }
    const hue = h % 360;
    const letter = (app.display || app.slug).trim().charAt(0).toUpperCase() || '?';
    // Two-stop diagonal gradient using the deterministic hue alongside the
    // site's ember accent so every glyph still feels on-brand.
    return `
      <svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeAttr(app.display + ' icon')}">
        <defs>
          <linearGradient id="g-${app.slug}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stop-color="hsl(${hue}, 70%, 28%)"/>
            <stop offset="100%" stop-color="hsl(${(hue + 40) % 360}, 75%, 16%)"/>
          </linearGradient>
        </defs>
        <rect x="3" y="3" width="90" height="90" rx="14" ry="14"
              fill="url(#g-${app.slug})"
              stroke="#E8721C" stroke-width="2"/>
        <text x="48" y="64"
              text-anchor="middle"
              font-family="Impact, Oswald, sans-serif"
              font-size="56"
              font-style="italic"
              fill="#F2EBD3">${escapeHtml(letter)}</text>
        <rect x="3" y="3" width="90" height="6" rx="14" ry="14" fill="#E8721C" opacity="0.85"/>
      </svg>
    `;
  }

  function extractFeatures(md) {
    if (!md) return null;
    const lines = md.split(/\r?\n/);
    let inFeatures = false;
    const items = [];
    for (const raw of lines) {
      const line = raw.trimEnd();
      const head = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (head) {
        const t = head[1].toLowerCase();
        if (/feature|highlight|what.?s\s+inside|capabilit/.test(t)) { inFeatures = true; continue; }
        if (inFeatures) break;
      }
      if (!inFeatures) continue;
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
      if (bullet) {
        items.push(stripMd(bullet[1]));
        continue;
      }
      if (items.length && /^\s*$/.test(line)) break;
    }
    return items.length ? items : null;
  }

  function stripMd(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/[*_~]/g, '')
      .trim();
  }

  function formatBytes(b) {
    if (!b && b !== 0) return '';
    const u = ['B','KB','MB','GB'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(b < 10 ? 1 : 0)} ${u[i]}`;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
