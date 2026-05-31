// Renders the home "Crew" section from data/discussions.json — a static
// snapshot committed by the daily refresh-repos workflow. No GitHub API
// calls at runtime.
(async () => {
  const list = document.getElementById('discussions-list');
  if (!list) return;

  let snapshot;
  try {
    const res = await fetch('data/discussions.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    snapshot = await res.json();
  } catch (e) {
    console.error('Failed to load data/discussions.json', e);
    list.innerHTML = '<p class="err">Could not load discussions.</p>';
    return;
  }

  // Header CTA wires to the repo's discussions page.
  const cta = document.getElementById('discussions-cta');
  if (cta && snapshot.url) cta.href = snapshot.url;

  const discs = (snapshot.discussions || [])
    .slice()
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 10);

  if (!discs.length) {
    list.innerHTML = `
      <article class="discussion-card discussion-empty">
        <h3>Nothing yet — start the conversation.</h3>
        <p>The daily refresh job will populate this list once the first
           discussion is posted on the repo.</p>
        <a class="dl-btn" target="_blank" rel="noopener" href="${escapeAttr(snapshot.url || '#')}">
          <span class="dl-btn-icon">💬</span>
          <span class="dl-btn-text"><strong>Open on GitHub</strong><small>Start a discussion</small></span>
        </a>
      </article>
    `;
    return;
  }

  list.innerHTML = '';
  for (const d of discs) {
    const card = document.createElement('a');
    card.className = 'discussion-card';
    card.href = d.url;
    card.target = '_blank';
    card.rel = 'noopener';
    const answered = d.answered ? '<span class="d-answered">✓ Answered</span>' : '';
    const updated = d.updated_at ? formatAgo(new Date(d.updated_at)) : '';
    card.innerHTML = `
      <header class="d-head">
        <span class="d-cat">${escapeHtml(d.category_emoji || '')} ${escapeHtml(d.category)}</span>
        ${answered}
        <span class="d-when">${updated}</span>
      </header>
      <h3 class="d-title">${escapeHtml(d.title)}</h3>
      <p class="d-body">${escapeHtml(d.body_preview || '')}</p>
      <footer class="d-foot">
        <span class="d-author">
          ${d.avatar_url
            ? `<img src="${escapeAttr(d.avatar_url)}" alt="" width="20" height="20" loading="lazy"/>`
            : ''}
          @${escapeHtml(d.author)}
        </span>
        <span class="d-stats">
          <span title="Comments">💬 ${d.comments}</span>
          <span title="Upvotes">▲ ${d.upvotes}</span>
        </span>
      </footer>
    `;
    list.appendChild(card);
  }

  function formatAgo(date) {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString();
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
