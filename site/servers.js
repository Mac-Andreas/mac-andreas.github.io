// Live server dashboard — open.mp + SA-MP.
//
// Reads ONE public endpoint, https://api.open.mp/servers, directly from the
// browser (no key, no CORS issue, no Supabase). It's a live snapshot only —
// the open.mp project itself exposes no history/stats endpoint, so trends are
// built from a self-recorded + Wayback-imported history file
// (data/server-history.json). Server geolocation for the map uses geojs.io
// (HTTPS, free, no key).
//
// Four sub-tabs inside #dashboard:
//   • Live Servers — KPIs, top servers (with value labels), searchable table
//   • Trends       — player/server history + %-change over 1/3/6/12mo/5yr + cards
//   • Breakdown    — distributions + summary cards
//   • Geography    — borderless dark map (all / open.mp / SA-MP toggle)
//
// Colour convention (per request): open.mp = PURPLE, SA-MP = cyan.
(() => {
  const OMP_API = 'https://api.open.mp/servers';
  const HISTORY_URL = 'data/server-history.json';

  // SA-MP began its long wind-down in 2018 (Kalcor stepping back; the forums &
  // wiki later went dark). User chose 2018 as the reference point.
  const SAMP_FORUMS_CLOSED = '2018-01-01';

  // Cache/refresh the live snapshot at most once per hour so we don't hammer
  // api.open.mp on every visit. (The Actions recorder also runs hourly.)
  const POLL_MS = 60 * 60 * 1000;

  const RANGES = [
    { key: 'day',  label: 'Daily',     days: 1 },
    { key: 'week', label: 'Weekly',    days: 7 },   // rolling 7 days (Mon–Sun framing in note)
    { key: 'mo',   label: 'Monthly',   days: 30 },
    { key: 'qtr',  label: 'Quarterly', days: 91 },
    { key: 'half', label: 'Half-yr',   days: 182 },
    { key: 'yr',   label: 'Yearly',    days: 365 },
    { key: '3yr',  label: '3 yr',      days: 365 * 3 },
    { key: '5yr',  label: '5 yr',      days: 365 * 5 },
    { key: 'all',  label: 'All',       days: 365 * 50 }, // full archive: SACNR 2010 → today
  ];

  // Theme — mirrors site/styles.css. open.mp=purple, SA-MP=cyan (info).
  const C = {
    bg: '#0C0E0A', panel: '#1A1E15', border: '#2F3623',
    text: '#EDE3C8', muted: '#98937A', sand: '#C9A86B',
    ember: '#E8721C', info: '#29E0FF', good: '#B4D862', bad: '#C9442B',
    purple: '#9B7FE8', green: '#8FAA48',
  };
  // ── Colour discipline (locked) ───────────────────────────────────────────
  //   • SA-MP   → ORANGE shades   (reserved — never used for generic data)
  //   • open.mp → PURPLE shades   (reserved — never used for generic data)
  //   • each other GAME → its own distinct hue (cyan/green/amber/… per game)
  //   • every generic / non-platform chart → consistent BLUE
  // Orange & purple are reserved exclusively for SA-MP / open.mp respectively.
  const OMP = C.purple;   // open.mp brand colour (purple)
  const SAMP = C.ember;   // SA-MP brand colour (orange)
  const BLUE = '#3B82F6'; // generic bar/line colour for all non-platform charts
  // Blue-family ramp for generic multi-slice charts (NO orange/purple).
  const BLUES  = ['#3B82F6', '#60A5FA', '#93C5FD', '#1D4ED8', '#2563EB', '#0EA5E9', '#38BDF8', '#0369A1'];
  // Purple ramp for open.mp-specific multi-slice charts (e.g. open.mp versions).
  const PURPLES = ['#9B7FE8', '#B9A6F0', '#7C5BD6', '#6D4DC7', '#C9BCF5', '#5B3FB0'];
  const PALETTE = BLUES;  // default generic palette

  const tabsEl   = document.getElementById('dash-tabs');
  const panelsEl = document.getElementById('dash-panels');
  if (!tabsEl || !panelsEl) return;

  // ── state ───────────────────────────────────────────────────────────────
  let _servers = null, _error = null, _activeTab = 'live', _pollTimer = null;
  let _history = null, _trendRange = 'yr', _mapFilter = 'all';
  const _charts = {};
  let _serverMap = null, _geoLoaded = false;
  const _rendered = new Set();

  const fmt = (n) => Number.isFinite(+n) ? (+n).toLocaleString() : '—';
  const pctOf = (part, whole) => whole ? Math.round(part / whole * 100) : 0;

  // ── data ────────────────────────────────────────────────────────────────
  async function fetchServers() {
    const res = await fetch(OMP_API);
    if (!res.ok) throw new Error(`api.open.mp returned HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected API response shape');
    return data;
  }

  async function fetchHistory() {
    try {
      const res = await fetch(HISTORY_URL, { cache: 'no-cache' });
      if (!res.ok) return [];
      const obj = await res.json();
      const pts = Array.isArray(obj?.points) ? obj.points : [];
      return pts.slice().sort((a, b) => (a.t || '').localeCompare(b.t || ''));
    } catch { return []; }
  }

  function cachedServers() {
    try {
      const { at, data } = JSON.parse(sessionStorage.getItem('ma_servers') || 'null') || {};
      if (!at || Date.now() - at > POLL_MS) return null;
      return Array.isArray(data) ? data : null;
    } catch { return null; }
  }
  function cacheServers(data) {
    try { sessionStorage.setItem('ma_servers', JSON.stringify({ at: Date.now(), data })); } catch {}
  }

  function totals(servers) {
    const omp  = servers.filter(s => s.omp);
    const samp = servers.filter(s => !s.omp);
    const sum  = (a) => a.reduce((x, s) => x + (s.pc || 0), 0);
    return {
      servers, omp, samp,
      totalServers: servers.length, totalPlayers: sum(servers),
      ompServers: omp.length, ompPlayers: sum(omp),
      sampServers: samp.length, sampPlayers: sum(samp),
      activeServers: servers.filter(s => (s.pc || 0) > 0).length,
    };
  }

  // ── chart factory ─────────────────────────────────────────────────────────
  function destroy(id) { if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; } }
  const tooltip = { backgroundColor: C.bg, borderColor: '#3E3E4D', borderWidth: 1, titleColor: C.text, bodyColor: C.sand, padding: 10 };
  const baseOpts = { responsive: true, maintainAspectRatio: false, animation: { duration: 350 }, plugins: { legend: { display: false }, tooltip } };
  const DL = (typeof ChartDataLabels !== 'undefined') ? ChartDataLabels : null; // datalabels plugin

  function make(id, config) {
    destroy(id);
    const el = document.getElementById(id);
    if (!el) return null;
    _charts[id] = new Chart(el.getContext('2d'), config);
    return _charts[id];
  }

  // Bar with value labels at the end of each bar.
  function barChart(id, labels, data, color = C.ember, horizontal = false, fmtLabel) {
    // color may be a single hex string (uniform bars) or an array (per-bar).
    const bg = Array.isArray(color) ? color.map(c => c + '99') : color + '99';
    const bd = Array.isArray(color) ? color : color;
    const cfg = {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: bg, borderColor: bd, borderWidth: 1, borderRadius: 2 }] },
      options: {
        ...baseOpts,
        indexAxis: horizontal ? 'y' : 'x',
        layout: { padding: horizontal ? { right: 38 } : { top: 22 } },
        scales: {
          x: { ticks: { color: C.muted, font: { size: 11 }, precision: 0, maxRotation: 0 }, grid: { color: C.border }, beginAtZero: true },
          y: { ticks: { color: C.text, font: { size: 11 } }, grid: { display: !horizontal, color: C.border }, beginAtZero: true },
        },
        plugins: {
          ...baseOpts.plugins,
          datalabels: DL ? {
            anchor: 'end', align: horizontal ? 'right' : 'top', clamp: true,
            color: C.text, font: { size: 10, weight: '600' },
            formatter: (v) => (fmtLabel ? fmtLabel(v) : fmt(v)),
          } : undefined,
        },
      },
      plugins: DL ? [DL] : [],
    };
    return make(id, cfg);
  }

  // Horizontal STACKED bar. `datasets` = [{ label, data:[per-category], color }].
  // Used by the Other-Games benchmark: one "San Andreas" bar stacks SA-MP +
  // open.mp; other platforms (RAGE:MP…) are single-segment bars.
  function stackedBar(id, labels, datasets) {
    return make(id, {
      type: 'bar',
      data: {
        labels,
        datasets: datasets.map(d => ({
          label: d.label, data: d.data,
          backgroundColor: d.color + 'CC', borderColor: d.color, borderWidth: 1, borderRadius: 2,
        })),
      },
      options: {
        ...baseOpts,
        indexAxis: 'y',
        layout: { padding: { right: 46 } },
        scales: {
          x: { stacked: true, ticks: { color: C.muted, font: { size: 11 }, precision: 0 }, grid: { color: C.border }, beginAtZero: true },
          y: { stacked: true, ticks: { color: C.text, font: { size: 11 } }, grid: { display: false } },
        },
        plugins: {
          ...baseOpts.plugins,
          legend: { display: true, position: 'top', labels: { color: C.text, font: { size: 11 }, boxWidth: 12, padding: 10 } },
          tooltip,
          // Label each segment with its value (skip zero/empty segments). Chart.js
          // stacks the labels inside each segment.
          datalabels: DL ? {
            color: C.text, font: { size: 10, weight: '600' }, anchor: 'center', align: 'center',
            formatter: (v) => (v > 0 ? fmt(v) : ''),
          } : undefined,
        },
      },
      plugins: DL ? [DL] : [],
    });
  }

  function doughnut(id, labels, data, colors = PALETTE, showValues = true) {
    return make(id, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors.map(c => c + 'CC'), borderColor: colors, borderWidth: 1, hoverOffset: 6 }] },
      options: {
        ...baseOpts, cutout: '56%',
        plugins: {
          ...baseOpts.plugins,
          legend: { display: true, position: 'right', labels: { color: C.text, font: { size: 11 }, padding: 9, boxWidth: 12 } },
          tooltip: {
            ...tooltip,
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const v = ctx.parsed;
                return `${ctx.label}: ${fmt(v)} (${pctOf(v, total)}%)`;
              },
            },
          },
          datalabels: (DL && showValues) ? {
            color: C.bg, font: { size: 10, weight: '700' },
            formatter: (v, ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const p = pctOf(v, total);
              return p >= 6 ? fmt(v) : ''; // hide labels on tiny slices
            },
          } : undefined,
        },
      },
      plugins: (DL && showValues) ? [DL] : [],
    });
  }

  function lineChart(id, labels, series) {
    return make(id, {
      type: 'line',
      data: {
        labels,
        datasets: series.map(s => ({
          label: s.label, data: s.data, borderColor: s.color,
          backgroundColor: s.color + '22', borderWidth: 2, tension: 0.3,
          pointRadius: labels.length > 40 ? 0 : 2, pointHoverRadius: 4, fill: false, spanGaps: true,
          segment: { borderDash: ctx => (s.dashFrom != null && ctx.p0DataIndex < s.dashFrom) ? [5, 4] : undefined },
        })),
      },
      options: {
        ...baseOpts,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          ...baseOpts.plugins,
          legend: { display: series.length > 1, position: 'top', labels: { color: C.text, font: { size: 11 }, boxWidth: 12, padding: 10 } },
          tooltip,
          datalabels: DL ? { display: false } : undefined,
        },
        scales: {
          x: { ticks: { color: C.muted, font: { size: 10 }, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: C.border } },
          y: { ticks: { color: C.muted, font: { size: 11 }, precision: 0 }, grid: { color: C.border }, beginAtZero: true },
        },
      },
      plugins: DL ? [DL] : [],
    });
  }

  // ── sub-tabs ───────────────────────────────────────────────────────────────
  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) activate(btn.dataset.tab);
  });
  function activate(tab) {
    if (!['live', 'trends', 'breakdown', 'geography', 'othergames', 'sources'].includes(tab)) tab = 'live';
    _activeTab = tab;
    tabsEl.querySelectorAll('.dash-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    panelsEl.querySelectorAll('.dash-panel').forEach(p => p.dataset.active = String(p.dataset.tab === tab));
    renderTab(tab);
  }

  // Deep-link a sub-tab via #dashboard-geography etc. (shareable + testable).
  function tabFromHash() {
    const m = (location.hash || '').match(/^#dashboard-(live|trends|breakdown|geography|othergames|sources)$/);
    return m ? m[1] : null;
  }
  window.addEventListener('hashchange', () => { const t = tabFromHash(); if (t) activate(t); });

  // ── boot ────────────────────────────────────────────────────────────────────
  panelsEl.innerHTML = `
    <section class="dash-panel" data-tab="live"      data-active="true"></section>
    <section class="dash-panel" data-tab="trends"    data-active="false"></section>
    <section class="dash-panel" data-tab="breakdown" data-active="false"></section>
    <section class="dash-panel" data-tab="geography"  data-active="false"></section>
    <section class="dash-panel" data-tab="othergames" data-active="false"></section>
    <section class="dash-panel" data-tab="sources"    data-active="false"></section>`;
  // Honour a deep-linked sub-tab on first load — deferred to the next tick so
  // every `const` helper defined below this IIFE block (skeleton, kpi, canvas…)
  // is initialised before activate()→renderTab() can reference them (avoids a
  // temporal-dead-zone crash on the deep-link path).
  setTimeout(() => { const t = tabFromHash(); if (t && t !== _activeTab) activate(t); }, 0);
  load();

  async function load() {
    const cached = cachedServers();
    if (cached) { _servers = cached; _error = null; }
    else {
      try { _servers = await fetchServers(); cacheServers(_servers); _error = null; }
      catch (err) { console.error('[dashboard] fetch failed', err); _error = err.message || String(err); }
    }
    fetchHistory().then(h => { _history = h; if (_activeTab === 'trends') renderTab('trends'); });
    updateVerdict(); updateHomeCard();
    _geoLoaded = false;
    renderTab(_activeTab);

    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(async () => {
      try {
        _servers = await fetchServers(); cacheServers(_servers); _error = null;
        updateVerdict(); updateHomeCard();
        if (_activeTab !== 'geography') renderTab(_activeTab);
      } catch (err) { console.warn('[dashboard] poll failed', err); }
    }, POLL_MS);
  }

  // Function declaration (hoisted) so an early hash-driven activate() that calls
  // renderTab during boot can't hit a temporal-dead-zone on `panel`.
  function panel(tab) { return panelsEl.querySelector(`.dash-panel[data-tab="${tab}"]`); }

  function renderTab(tab) {
    const el = panel(tab);
    if (!el) return;
    // Benchmarking + Sources read committed data, not the live open.mp list —
    // render them even while the open.mp fetch is pending/failed.
    if (tab === 'othergames') return renderOtherGames(el);
    if (tab === 'sources')    return renderSources(el);
    if (_error && !_servers) { el.innerHTML = `<div class="dash-error">Couldn't reach <code>api.open.mp</code> — ${_error}</div>`; return; }
    if (!_servers) { el.innerHTML = skeleton(); return; }
    if (tab === 'live')      return renderLive(el);
    if (tab === 'trends')    return renderTrends(el);
    if (tab === 'breakdown') return renderBreakdown(el);
    if (tab === 'geography') return renderGeography(el);
  }

  const skeleton = () => `<div class="dash-skeleton"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>`;

  // ══ verdict ════════════════════════════════════════════════════════════════
  const daysSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso + 'T00:00:00Z').getTime()) / 86_400_000));

  function updateVerdict() {
    const root = document.getElementById('samp-verdict');
    const aEl = document.getElementById('samp-verdict-a');
    const subEl = document.getElementById('samp-verdict-sub');
    if (!root || !aEl || !subEl) return;
    if (_error && !_servers) {
      root.dataset.state = 'unknown'; aEl.textContent = '¯\\_(ツ)_/¯';
      subEl.textContent = "Can't tell — the open.mp API is unreachable right now."; return;
    }
    if (!_servers) {
      // Still fetching — keep the "Wait for it…" answer.
      root.dataset.state = 'loading';
      aEl.innerHTML = '<span class="verdict-wait">Wait for it…</span>';
      subEl.textContent = 'Counting live SA-MP players…';
      return;
    }
    // Verdict: >1 SA-MP player online ⇒ NOT dead.
    const t = totals(_servers);
    const alive = t.sampPlayers > 1;
    root.dataset.state = alive ? 'alive' : 'dead';
    aEl.textContent = alive ? 'No.' : 'Yes.';
    const days = daysSince(SAMP_FORUMS_CLOSED);
    subEl.innerHTML = alive
      ? `<strong>${fmt(t.sampPlayers)}</strong> players across <strong>${fmt(t.sampServers)}</strong> SA-MP servers are online right now — ${fmt(days)} days since SA-MP started winding down.`
      : `Only ${fmt(t.sampPlayers)} SA-MP players online — ${fmt(days)} days since SA-MP started winding down.`;
  }

  function updateHomeCard() {
    const el = document.getElementById('home-players-count');
    if (el && _servers) el.textContent = fmt(totals(_servers).totalPlayers);
  }

  // ══ TAB: Live Servers ═══════════════════════════════════════════════════════
  function renderLive(el) {
    const t = totals(_servers);
    if (!_rendered.has('live')) {
      el.innerHTML = `
        <div class="kpi-row">
          ${kpi('sand',   'Total Servers',  'sv-total')}
          ${kpi('purple', 'open.mp Servers','sv-omp')}
          ${kpi('ember',  'SA-MP Servers',  'sv-samp')}
          ${kpi('good',   'Players Online', 'sv-players')}
          ${kpi('purple', 'open.mp Players','sv-omp-players')}
          ${kpi('ember',  'SA-MP Players',  'sv-samp-players')}
        </div>

        <div class="chart-panel" style="margin-bottom:16px">
          <div class="chart-toolbar"><h3>Top 20 Servers <span class="dim">by players</span> ${tip('The 20 servers with the most players online right now. The number at the end of each bar is the live player count.')}</h3></div>
          ${canvas('sv-top20', 420)}
        </div>

        <div class="chart-panel">
          <div class="chart-toolbar dash-table-toolbar">
            <h3>All Servers <span class="dim" id="sv-table-count"></span> ${tip('Every server in the open.mp master list. Search by name, gamemode, language or IP; filter by type; sort by players, slots or name. Fill% is players ÷ max slots.')}</h3>
            <div class="dash-controls">
              <input type="text" id="sv-search" placeholder="Search name / gamemode / language…" class="dash-input">
              <select id="sv-filter-type" class="dash-select">
                <option value="all">All types</option>
                <option value="omp">open.mp only</option>
                <option value="samp">SA-MP only</option>
              </select>
              <select id="sv-sort" class="dash-select">
                <option value="players">Sort: Players</option>
                <option value="max">Sort: Max slots</option>
                <option value="name">Sort: Name</option>
              </select>
            </div>
          </div>
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr><th>#</th><th>Name</th><th>Players</th><th>Max</th><th>Fill</th><th>Gamemode</th><th>Language</th><th>Version</th><th>Type</th></tr></thead>
              <tbody id="sv-table-body"></tbody>
            </table>
          </div>
        </div>`;
      ['sv-search', 'sv-filter-type', 'sv-sort'].forEach(id => {
        const c = document.getElementById(id); if (c) c.addEventListener('input', renderTable);
      });
      _rendered.add('live');
    }

    setText('sv-total', fmt(t.totalServers));
    setText('sv-omp', fmt(t.ompServers));
    setText('sv-samp', fmt(t.sampServers));
    setText('sv-players', fmt(t.totalPlayers));
    setText('sv-omp-players', fmt(t.ompPlayers));
    setText('sv-samp-players', fmt(t.sampPlayers));

    const top20 = _servers.filter(s => s.pc > 0).sort((a, b) => (b.pc || 0) - (a.pc || 0)).slice(0, 20);
    barChart('sv-top20', top20.map(s => (s.hn || '').slice(0, 30)), top20.map(s => s.pc || 0), BLUE, true);
    renderTable();
  }

  function renderTable() {
    if (!_servers) return;
    const q = (document.getElementById('sv-search')?.value || '').toLowerCase();
    const type = document.getElementById('sv-filter-type')?.value || 'all';
    const sort = document.getElementById('sv-sort')?.value || 'players';
    let rows = [..._servers];
    if (type === 'omp') rows = rows.filter(s => s.omp);
    if (type === 'samp') rows = rows.filter(s => !s.omp);
    if (q) rows = rows.filter(s => s.hn?.toLowerCase().includes(q) || s.gm?.toLowerCase().includes(q) || s.la?.toLowerCase().includes(q) || s.ip?.includes(q));
    if (sort === 'players') rows.sort((a, b) => (b.pc || 0) - (a.pc || 0));
    if (sort === 'max') rows.sort((a, b) => (b.pm || 0) - (a.pm || 0));
    if (sort === 'name') rows.sort((a, b) => (a.hn || '').localeCompare(b.hn || ''));

    const count = document.getElementById('sv-table-count');
    if (count) count.textContent = `${fmt(rows.length)} of ${fmt(_servers.length)}`;
    const tbody = document.getElementById('sv-table-body');
    if (!tbody) return;
    tbody.innerHTML = rows.slice(0, 400).map((s, i) => {
      const fill = pctOf(s.pc || 0, s.pm || 0);
      const fc = fill >= 90 ? C.bad : fill >= 60 ? C.sand : C.good;
      return `<tr>
        <td class="num dim">${i + 1}</td>
        <td class="ellip" title="${esc(s.hn)}">${esc(s.hn) || '—'}</td>
        <td class="num">${s.pc || 0}</td>
        <td class="num dim">${s.pm || 0}</td>
        <td class="num" style="color:${fc}">${fill}%</td>
        <td class="ellip dim" style="max-width:160px" title="${esc(s.gm)}">${esc(s.gm) || '—'}</td>
        <td style="color:${C.sand};font-size:11px">${esc(s.la) || '—'}</td>
        <td class="dim" style="font-size:11px">${esc(s.vn) || '—'}</td>
        <td><span class="badge ${s.omp ? 'omp' : 'samp'}">${s.omp ? 'omp' : 'samp'}</span></td>
      </tr>`;
    }).join('') || `<tr><td colspan="9" class="empty-cell">No servers match.</td></tr>`;
  }

  // ══ TAB: Trends ═════════════════════════════════════════════════════════════
  function renderTrends(el) {
    if (!_rendered.has('trends')) {
      el.innerHTML = `
        <div class="chart-toolbar dash-table-toolbar">
          <h3 class="trend-title">Player &amp; Server <span class="dim">trends</span> ${tip('Built from real archived snapshots: SACNR Monitor SA-MP totals (yearly, 2010→2022) + api.open.mp/servers via the Internet Archive (2023→), refreshed hourly. Pick “All” for the full 2010→today timeline. % cards compare the oldest vs newest point in the chosen range.')}</h3>
          <div class="dash-controls" id="trend-range-btns">
            ${RANGES.map(r => `<button class="btn-range${r.key === _trendRange ? ' active' : ''}" data-range="${r.key}">${r.label}</button>`).join('')}
          </div>
        </div>
        <div class="kpi-row" id="trend-kpis"></div>
        <div class="chart-grid">
          <div class="chart-panel"><h3>Players <span class="dim">online</span> ${tip('Total concurrent players across all listed servers over time.')}</h3>${canvas('trend-players', 260)}</div>
          <div class="chart-panel"><h3>Servers <span class="dim">listed</span> ${tip('Total number of servers in the master list over time.')}</h3>${canvas('trend-servers', 260)}</div>
        </div>
        <div class="chart-panel">
          <h3>open.mp <span style="color:${OMP}">vs</span> SA-MP <span class="dim">players over time</span> ${tip('How the player base splits between open.mp (purple) and legacy SA-MP (cyan). Watch open.mp climb as SA-MP declines.')}</h3>${canvas('trend-split', 260)}
        </div>
        <p class="dash-note" id="trend-note" style="margin-top:14px"></p>`;
      el.querySelector('#trend-range-btns').addEventListener('click', (e) => {
        const b = e.target.closest('[data-range]'); if (!b) return;
        _trendRange = b.dataset.range;
        el.querySelectorAll('.btn-range').forEach(x => x.classList.toggle('active', x === b));
        drawTrends();
      });
      _rendered.add('trends');
    }
    drawTrends();
  }

  function drawTrends() {
    const note = document.getElementById('trend-note');
    if (_history == null) { if (note) note.textContent = 'Loading history…'; return; }
    const range = RANGES.find(r => r.key === _trendRange) || RANGES[3];
    const cutoff = Date.now() - range.days * 86_400_000;
    const pts = _history.filter(p => new Date(p.t).getTime() >= cutoff);

    if (pts.length < 2) {
      ['trend-players', 'trend-servers', 'trend-split'].forEach(destroy);
      const k = document.getElementById('trend-kpis'); if (k) k.innerHTML = '';
      if (note) note.textContent = 'Not enough history in this range yet — it fills in as hourly snapshots accumulate.';
      return;
    }
    const labels = pts.map(p => shortDate(p.t, range.days));
    let dashFrom = pts.findIndex(p => !p.est);
    if (dashFrom === -1) dashFrom = pts.length;
    const dash = dashFrom > 0 ? dashFrom : null;

    lineChart('trend-players', labels, [{ label: 'Total players', data: pts.map(p => p.p), color: BLUE, dashFrom: dash }]);
    lineChart('trend-servers', labels, [{ label: 'Total servers', data: pts.map(p => p.s), color: BLUE, dashFrom: dash }]);
    lineChart('trend-split', labels, [
      { label: 'open.mp players', data: pts.map(p => p.op), color: OMP, dashFrom: dash },
      { label: 'SA-MP players', data: pts.map(p => p.sp), color: SAMP, dashFrom: dash },
    ]);

    const a = pts[0], b = pts[pts.length - 1];
    const kpiEl = document.getElementById('trend-kpis');
    if (kpiEl) kpiEl.innerHTML = [
      pctCard('good', 'Players', a.p, b.p),
      pctCard('ember', 'Servers', a.s, b.s),
      pctCard('purple', 'open.mp players', a.op, b.op),
      pctCard('ember', 'SA-MP players', a.sp, b.sp),
    ].join('');

    const anyEst = pts.some(p => p.est);
    const hasSacnr = pts.some(p => p.source === 'sacnr');
    if (note) note.textContent = anyEst
      ? `% change over the last ${range.label}. Solid line = real data (archived snapshots, refreshed hourly); dashed = estimated pre-archive backbone.`
      : hasSacnr
        ? `% change over the ${range.key === 'all' ? 'full archive' : `last ${range.label}`}. Real data: SACNR Monitor SA-MP totals (yearly, 2010→2022) + archived open.mp snapshots (2023→), refreshed hourly. The open.mp/SA-MP split only exists from 2023 — earlier years are all SA-MP.`
        : `% change over the last ${range.label}, from real open.mp snapshots (Internet Archive), refreshed hourly.`;
  }

  function pctCard(color, label, from, to) {
    let deltaHtml;
    if (!from) {
      deltaHtml = to > 0
        ? `<span class="kpi-delta up">▲ new <span class="dim">from 0</span></span>`
        : `<span class="kpi-delta dim">no change</span>`;
    } else {
      const delta = ((to - from) / from) * 100, up = delta >= 0;
      deltaHtml = `<span class="kpi-delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}% <span class="dim">from ${fmt(from)}</span></span>`;
    }
    return `<div class="kpi-card ${color}"><div class="kpi-label">${label}</div><div class="kpi-value">${fmt(to)}</div>${deltaHtml}</div>`;
  }

  function shortDate(iso, days) {
    const d = new Date(iso);
    return days > 200
      ? d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  // ══ TAB: Breakdown ══════════════════════════════════════════════════════════
  function renderBreakdown(el) {
    const t = totals(_servers);
    if (!_rendered.has('breakdown')) {
      el.innerHTML = `
        <div class="kpi-row" id="bd-kpis"></div>
        <div class="chart-grid">
          <div class="chart-panel">
            <div class="chart-toolbar"><h3>Players per Server <span class="dim">distribution</span> ${tip('How many servers fall into each player-count band. Empty (0-player) servers are excluded so you see where the action actually is.')}</h3></div>
            ${canvas('bd-dist', 240)}
          </div>
          <div class="chart-panel">
            <h3>Capacity <span class="dim">utilisation</span> ${tip('Of servers that have players, how full are they? Each slice = servers whose live players ÷ max-slots falls in that fill band. “Packed” means 90%+ full.')}</h3>
            ${canvas('bd-cap', 240)}
          </div>
        </div>
        <div class="chart-grid thirds">
          <div class="chart-panel"><h3>Top Languages ${tip('Server count grouped by the declared language tag. Untagged servers are counted as “Unknown”.')}</h3>${canvas('bd-lang', 240)}</div>
          <div class="chart-panel"><h3>open.mp Versions ${tip('Which open.mp build each open.mp server runs. Helps gauge upgrade adoption.')}</h3>${canvas('bd-ver', 240)}</div>
          <div class="chart-panel"><h3>Password <span class="dim">protected</span> ${tip('How many servers require a password to join vs are open. Counts and share shown.')}</h3>${canvas('bd-pass', 240)}</div>
        </div>
        <div class="chart-grid">
          <div class="chart-panel"><h3>open.mp <span style="color:${OMP}">vs</span> SA-MP <span class="dim">servers</span> ${tip('Share of the server count: open.mp (purple) vs legacy SA-MP (cyan).')}</h3>${canvas('bd-split', 240)}</div>
          <div class="chart-panel"><h3>open.mp <span style="color:${OMP}">vs</span> SA-MP <span class="dim">players</span> ${tip('Share of all online players: open.mp (purple) vs SA-MP (cyan).')}</h3>${canvas('bd-split-p', 240)}</div>
        </div>`;
      _rendered.add('breakdown');
    }

    // Summary cards.
    const passCount = _servers.filter(s => s.pa).length;
    const langSet = new Set(_servers.map(s => (s.la || '').trim() || 'Unknown'));
    const kpiEl = document.getElementById('bd-kpis');
    if (kpiEl) kpiEl.innerHTML = [
      kpiVal('ember',  'Total Servers',   fmt(t.totalServers)),
      kpiVal('good',   'Active (≥1 player)', `${fmt(t.activeServers)} <span class="kpi-sub">${pctOf(t.activeServers, t.totalServers)}%</span>`),
      kpiVal('purple', 'open.mp share',   `${pctOf(t.ompServers, t.totalServers)}% <span class="kpi-sub">${fmt(t.ompServers)} servers</span>`),
      kpiVal('sand',   'Languages',       fmt(langSet.size)),
      kpiVal('info',   'Password-protected', `${fmt(passCount)} <span class="kpi-sub">${pctOf(passCount, t.totalServers)}%</span>`),
    ].join('');

    // Players-per-server histogram — exclude the 0 bucket; no server reaches
    // 1000 players in practice so the top band is 500+.
    const edges = [1, 5, 10, 25, 50, 100, 250, 500, Infinity];
    const labels = ['1-4', '5-9', '10-24', '25-49', '50-99', '100-249', '250-499', '500+'];
    const counts = Array(labels.length).fill(0);
    _servers.forEach(s => {
      const pc = s.pc || 0;
      if (pc < 1) return; // drop empty servers
      for (let i = 0; i < edges.length - 1; i++) { if (pc >= edges[i] && pc < edges[i + 1]) { counts[i]++; break; } }
    });
    barChart('bd-dist', labels, counts, BLUE);

    // Capacity utilisation — only populated servers; human-labelled bands.
    const uLabels = ['1-24%', '25-49%', '50-74%', '75-89%', '90-99%', 'Packed (100%)'];
    const uEdges  = [0.0001, 25, 50, 75, 90, 100, Infinity];
    const uCounts = Array(uLabels.length).fill(0);
    _servers.filter(s => (s.pc || 0) > 0 && s.pm).forEach(s => {
      const u = (s.pc / s.pm) * 100;
      for (let i = 0; i < uEdges.length - 1; i++) { if (u >= uEdges[i] && u < uEdges[i + 1]) { uCounts[i]++; break; } }
      if (u >= 100) uCounts[uCounts.length - 1]++;
    });
    doughnut('bd-cap', uLabels, uCounts, BLUES);

    // Languages — "Unknown" for blanks (label already does that).
    const langs = topCounts(_servers, s => (s.la || '').trim() || 'Unknown', 10);
    barChart('bd-lang', langs.map(x => x[0]), langs.map(x => x[1]), BLUE, true);

    // open.mp versions → purple family (open.mp-specific data).
    const vers = topCounts(t.omp, s => s.vn || 'Unknown', 8);
    doughnut('bd-ver', vers.map(x => x[0]), vers.map(x => x[1]), PURPLES);

    // Password protected — generic → blue family.
    doughnut('bd-pass', ['Open', 'Password'], [t.totalServers - passCount, passCount], [BLUES[0], BLUES[3]]);

    // Splits — open.mp purple, SA-MP cyan.
    doughnut('bd-split', ['open.mp', 'SA-MP'], [t.ompServers, t.sampServers], [OMP, SAMP]);
    doughnut('bd-split-p', ['open.mp', 'SA-MP'], [t.ompPlayers, t.sampPlayers], [OMP, SAMP]);
  }

  // ══ TAB: Geography ══════════════════════════════════════════════════════════
  function renderGeography(el) {
    if (!_rendered.has('geography')) {
      el.innerHTML = `
        <p class="dash-note">
          Every server plotted by IP geolocation (geojs.io · HTTPS · no key) on a
          borderless dark basemap — circle size = servers in that area, colour = player load.
        </p>
        <div class="kpi-row" id="geo-kpis"></div>
        <div class="geo-map-wrap">
          <div class="geo-map-toolbar">
            <div class="dash-controls" id="geo-filter-btns">
              <button class="btn-range active" data-filter="all">All servers</button>
              <button class="btn-range" data-filter="omp">open.mp</button>
              <button class="btn-range" data-filter="samp">SA-MP</button>
            </div>
          </div>
          <div id="geo-status" class="dash-status">Open this tab to resolve server locations…</div>
          <div id="geo-map" class="geo-map"></div>
          <div class="geo-legend">
            <span><i style="background:${C.ember}"></i>&gt;100 players</span>
            <span><i style="background:${C.info}"></i>20–100 players</span>
            <span><i style="background:${C.good}"></i>&lt;20 players</span>
          </div>
        </div>
        <div class="chart-grid" style="margin-top:18px">
          <div class="chart-panel"><h3>Players by <span class="dim">language</span> ${tip('Total online players summed per declared server language — a rough proxy for which regional communities are most active right now.')}</h3>${canvas('geo-lang-p', 260)}</div>
          <div class="chart-panel"><h3>Servers by <span class="dim">country</span> ${tip('Top countries by number of servers, resolved from server IP geolocation. Updates after the map finishes locating IPs.')}</h3>${canvas('geo-country', 260)}</div>
        </div>`;
      el.querySelector('#geo-filter-btns').addEventListener('click', (e) => {
        const b = e.target.closest('[data-filter]'); if (!b) return;
        _mapFilter = b.dataset.filter;
        el.querySelectorAll('#geo-filter-btns .btn-range').forEach(x => x.classList.toggle('active', x === b));
        if (_geoCache) drawMarkers(); // re-plot from cached geo without re-fetching
      });
      _rendered.add('geography');
    }

    const t = totals(_servers);
    const kpis = document.getElementById('geo-kpis');
    if (kpis) kpis.innerHTML = [
      kpiVal('purple', 'open.mp Servers', fmt(t.ompServers)),
      kpiVal('info',   'Players Online',  fmt(t.totalPlayers)),
      kpiVal('good',   'Active Servers',  fmt(t.activeServers)),
      kpiVal('sand',   'Avg Players/Server', t.totalServers ? (t.totalPlayers / t.totalServers).toFixed(1) : '0'),
    ].join('');

    // Players-by-language (kept here; the per-server-count language chart lives
    // only on the Breakdown tab now — no duplication).
    const langP = topSum(_servers, s => (s.la || '').trim() || 'Unknown', s => s.pc || 0, 12);
    barChart('geo-lang-p', langP.map(x => x[0]), langP.map(x => x[1]), BLUE, true);

    if (_serverMap) setTimeout(() => _serverMap.invalidateSize(), 60);
    if (!_geoLoaded) { _geoLoaded = true; loadMap(); }
    else if (_geoCache) drawCountryChart();
  }

  // Cache resolved geo so the all/omp/samp toggle re-plots instantly.
  let _geoCache = null; // { ipGeo, servers }

  async function loadMap() {
    const statusEl = document.getElementById('geo-status');
    const mapEl = document.getElementById('geo-map');
    if (!mapEl || typeof L === 'undefined') { if (statusEl) statusEl.textContent = 'Map library unavailable.'; return; }
    try {
      // 1) Build the map + borderless land FIRST so the dark map appears instantly
      //    — independent of the (slower, network-bound) IP geolocation below.
      if (_serverMap) { _serverMap.remove(); _serverMap = null; }
      const map = L.map(mapEl, {
        scrollWheelZoom: true, zoomControl: true, worldCopyJump: true,
        attributionControl: false, minZoom: 2, maxZoom: 8,
      });
      _serverMap = map;
      map.setView([20, 10], 2);

      // TRULY borderless: no tile basemap at all. We draw land masses ourselves
      // from a vendored world GeoJSON, filled solid with NO stroke — so there
      // are zero country borders. (CARTO/OSM raster tiles bake borders in.)
      // Draw it NOW so the dark map shows land immediately…
      await ensureLand(map);
      _markerLayer = L.layerGroup().addTo(map);
      // …then, because the Geography panel was display:none until this tab was
      // opened, Leaflet may have sized the container at 0×0. Recompute size and
      // REDRAW the land so its SVG paths reproject against the real dimensions —
      // this is what was leaving the basemap blank on the live page.
      const refresh = () => { map.invalidateSize(); ensureLand(map); };
      setTimeout(refresh, 60);
      setTimeout(refresh, 250);

      // 2) Now resolve server IP locations (geojs.io) and plot the markers.
      if (statusEl) statusEl.textContent = 'Resolving IP locations…';
      const uniqueIPs = [...new Set(_servers.map(s => s.ip?.split(':')[0]).filter(Boolean))].slice(0, 400);
      const ipGeo = {};
      for (let i = 0; i < uniqueIPs.length; i += 100) {
        const chunk = uniqueIPs.slice(i, i + 100);
        const rows = await fetch(`https://get.geojs.io/v1/ip/geo.json?ip=${chunk.join(',')}`).then(r => r.json()).catch(() => []);
        (Array.isArray(rows) ? rows : [rows]).forEach(r => {
          if (r && r.ip && r.latitude && r.longitude) ipGeo[r.ip] = { lat: +r.latitude, lon: +r.longitude, country: r.country || 'Unknown' };
        });
      }
      _geoCache = { ipGeo };

      drawMarkers();
      drawCountryChart();
    } catch (err) {
      console.error('[dashboard] map', err);
      if (statusEl) statusEl.textContent = `Map error: ${err.message}`;
    }
  }

  let _markerLayer = null;
  let _worldGeo = null; // cached vendored GeoJSON

  // Draw solid, border-less land polygons as the basemap. Sea = dark container
  // background (set directly here AND in CSS so Leaflet's default grey can't win).
  let _landLayer = null;
  async function ensureLand(map) {
    // Filled-continent silhouette: clearly readable land on dark sea, but with
    // ZERO country borders (stroke colour == fill colour).
    const SEA = '#0A0F14', LAND = '#39492C';
    if (map.getContainer()) map.getContainer().style.background = SEA;
    if (!_worldGeo) {
      try {
        _worldGeo = await fetch('assets/geo/world-countries.json').then(r => r.json());
      } catch (e) { console.warn('[dashboard] world geo load failed', e); return; }
    }
    if (_landLayer) { map.removeLayer(_landLayer); _landLayer = null; }
    _landLayer = L.geoJSON(_worldGeo, {
      style: {
        fillColor: LAND,        // land fill — a clear grey-green silhouette
        fillOpacity: 1,
        color: LAND,            // stroke == fill ⇒ NO visible country borders
        weight: 0.6,            // hairline only, same colour, closes AA gaps
        opacity: 1,
      },
      interactive: false,
    }).addTo(map);
    _landLayer.bringToBack();   // land under the markers, above the sea
  }

  function filteredServers() {
    if (_mapFilter === 'omp') return _servers.filter(s => s.omp);
    if (_mapFilter === 'samp') return _servers.filter(s => !s.omp);
    return _servers;
  }

  function drawMarkers() {
    if (!_serverMap || !_geoCache || !_markerLayer) return;
    const { ipGeo } = _geoCache;
    _markerLayer.clearLayers();
    const list = filteredServers();
    const clusters = {};
    list.forEach(s => {
      const geo = ipGeo[s.ip?.split(':')[0]];
      if (!geo) return;
      const key = `${Math.round(geo.lat)},${Math.round(geo.lon)}`;
      (clusters[key] ||= { geo, servers: [] }).servers.push(s);
    });
    const markers = [];
    Object.values(clusters).forEach(({ geo, servers }) => {
      const players = servers.reduce((a, s) => a + (s.pc || 0), 0);
      const radius = Math.max(6, Math.min(28, 6 + Math.sqrt(servers.length) * 4));
      const color = players > 100 ? C.ember : players > 20 ? C.info : C.good;
      const top5 = servers.slice().sort((a, b) => (b.pc || 0) - (a.pc || 0)).slice(0, 5);
      const popup = `<div class="geo-popup">
        <div class="geo-popup-h">${esc(geo.country) || 'Unknown'}</div>
        <div class="geo-popup-sub">${servers.length} server${servers.length > 1 ? 's' : ''} · ${players} players</div>
        ${top5.map(s => `<div class="geo-popup-row"><span>${esc(s.hn)}</span><b>${s.pc}/${s.pm}</b></div>`).join('')}
      </div>`;
      const m = L.circleMarker([geo.lat, geo.lon], { radius, fillColor: color, color: C.bg, fillOpacity: 0.82, weight: 1.5 }).bindPopup(popup, { maxWidth: 240 });
      _markerLayer.addLayer(m); markers.push(m);
    });
    if (markers.length) _serverMap.fitBounds(L.featureGroup(markers).getBounds().pad(0.1), { maxZoom: 5 });
    else _serverMap.setView([20, 10], 2);

    const statusEl = document.getElementById('geo-status');
    const resolved = Object.keys(_geoCache.ipGeo).length;
    const players = list.reduce((a, s) => a + (s.pc || 0), 0);
    if (statusEl) statusEl.textContent = `${resolved} IPs located · showing ${fmt(list.length)} ${_mapFilter === 'all' ? 'servers' : _mapFilter === 'omp' ? 'open.mp servers' : 'SA-MP servers'} · ${fmt(players)} players`;
  }

  function drawCountryChart() {
    if (!_geoCache) return;
    const { ipGeo } = _geoCache;
    const counts = {};
    filteredServers().forEach(s => {
      const geo = ipGeo[s.ip?.split(':')[0]];
      if (!geo) return;
      counts[geo.country] = (counts[geo.country] || 0) + 1;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (top.length) barChart('geo-country', top.map(x => x[0]), top.map(x => x[1]), BLUE, true);
  }

  // ══ TAB: Other Games ════════════════════════════════════════════════════════
  // GTA-multiplayer platforms beyond open.mp/SA-MP. Reads the committed
  // data/othergames-history.json (recorded hourly by Actions — those masters are
  // CORS-blocked for the browser). Currently RAGE:MP (GTA V); alt:V returns
  // nothing, FiveM's stream is too heavy, MTA/III/VC/IV have no usable API.
  let _otherHist = null; // null = not loaded yet, [] = loaded empty

  // Platform display metadata, keyed by the source id the recorder writes.
  // San Andreas is shown as two stacked segments (SA-MP orange + open.mp purple);
  // every other platform is one bar in its own distinct colour.
  // Per-game distinct hues. SA-MP=orange & open.mp=purple are RESERVED; every
  // other game uses a colour that's neither orange/purple nor the generic blue.
  const OG_PLATFORMS = {
    samp:    { game: 'GTA: San Andreas', label: 'SA-MP',      color: C.ember },   // orange (reserved)
    omp:     { game: 'GTA: San Andreas', label: 'open.mp',    color: C.purple },  // purple (reserved)
    ragemp:  { game: 'GTA V',            label: 'RAGE:MP',    color: '#29E0FF' },  // cyan
    altv:    { game: 'GTA V',            label: 'alt:V',      color: '#14B8A6' },  // teal
    fivem:   { game: 'GTA V',            label: 'FiveM',      color: '#A7C957' },  // lime
    mtasa:   { game: 'GTA: San Andreas', label: 'MTA:SA',     color: '#F4C430' },  // amber
    gta3mta: { game: 'GTA III',          label: 'MTA (III)',  color: '#8D6E63' },  // brown
    vcmta:   { game: 'GTA: Vice City',   label: 'MTA (VC)',   color: '#EC407A' },  // pink
    ivmp:    { game: 'GTA IV',           label: 'IV:MP',      color: '#10B981' },  // emerald (was purple — reserved)
  };

  function renderOtherGames(el) {
    if (!_rendered.has('othergames')) {
      el.innerHTML = `
        <p class="dash-note">
          <strong>Online benchmarking</strong> — how the live San Andreas player base
          (open.mp + SA-MP) stacks up against other GTA multiplayer platforms, recorded
          hourly (these platforms’ public APIs aren’t reachable directly from a browser).
          <strong>RAGE:MP</strong> (GTA&nbsp;V) reports players; <strong>MTA:SA</strong>
          (GTA&nbsp;San&nbsp;Andreas) reports a reliable server count from its binary
          master. alt:V&nbsp;/&nbsp;FiveM probes run hourly and light up automatically if
          their APIs return. GTA&nbsp;III&nbsp;/&nbsp;Vice&nbsp;City&nbsp;/&nbsp;IV have no
          live master (all dead).
        </p>
        <div class="kpi-row" id="og-kpis"></div>
        <div class="chart-panel">
          <h3>Live player benchmark <span class="dim">across platforms</span> ${tip('Current concurrent players per platform. The San Andreas bar is stacked: SA-MP (orange) + open.mp (purple), live from api.open.mp. Other platforms (RAGE:MP, MTA…) come from their public APIs, refreshed hourly, each in its own colour. Different games — shown for scale.')}</h3>
          ${canvas('og-bench', 240)}
        </div>
        <div class="chart-panel" style="margin-top:16px">
          <h3>Other-platform <span class="dim">players over time</span> ${tip('Concurrent players over time for each non-SA platform (currently RAGE:MP), from its public API, refreshed hourly.')}</h3>
          ${canvas('og-players', 260)}
        </div>
        <p class="dash-note" id="og-note" style="margin-top:12px"></p>`;
      _rendered.add('othergames');
    }
    if (_otherHist == null) {
      fetch('data/othergames-history.json').then(r => r.ok ? r.json() : { points: [] })
        .then(o => { _otherHist = Array.isArray(o?.points) ? o.points : []; drawOtherGames(); })
        .catch(() => { _otherHist = []; drawOtherGames(); });
    } else {
      drawOtherGames();
    }
  }

  function drawOtherGames() {
    const hist = _otherHist || [];
    const note = document.getElementById('og-note');
    const kpiEl = document.getElementById('og-kpis');
    const latest = hist.length ? hist[hist.length - 1].sources || {} : {};
    // Non-SA platforms in the recorder's latest snapshot. Some expose a player
    // count (RAGE:MP), others only a reliable server count (MTA:SA — its binary
    // master's player field couldn't be verified, so players is null there).
    const recKeys     = Object.keys(OG_PLATFORMS).filter(k => k !== 'samp' && k !== 'omp' && latest[k]);
    const playerKeys  = recKeys.filter(k => latest[k].players != null);
    const serverKeys  = recKeys.filter(k => latest[k].servers != null);

    // Live San Andreas baseline (open.mp + SA-MP) from the current server list.
    const sa = _servers ? totals(_servers) : null;

    // ── KPIs: SA-MP / open.mp split + each recorded other platform ───────────
    const cards = [];
    if (sa) {
      cards.push(kpiVal('ember',  'SA-MP players (live)',   fmt(sa.sampPlayers)));
      cards.push(kpiVal('purple', 'open.mp players (live)', fmt(sa.ompPlayers)));
    }
    playerKeys.forEach(k => cards.push(kpiVal('info', `${OG_PLATFORMS[k].label} players`, fmt(latest[k].players))));
    // Server-only platforms (e.g. MTA:SA) get a server-count KPI instead.
    serverKeys.filter(k => latest[k].players == null)
      .forEach(k => cards.push(kpiVal('good', `${OG_PLATFORMS[k].label} servers`, fmt(latest[k].servers))));
    cards.push(kpiVal('sand', 'Snapshots recorded', fmt(hist.length)));
    if (kpiEl) kpiEl.innerHTML = cards.join('') || '<div class="kpi-card"><div class="kpi-value">—</div></div>';

    // ── Stacked benchmark: San Andreas (SA-MP+open.mp) vs each other platform ─
    // One category per platform row. San Andreas gets two stacked segments
    // (SA-MP orange + open.mp purple); every other platform is one segment.
    const cats = (sa ? ['San Andreas'] : []).concat(playerKeys.map(k => `${OG_PLATFORMS[k].label} · ${OG_PLATFORMS[k].game}`));
    if (cats.length) {
      const at = (cat, val) => cats.map(c => (c === cat ? val : 0));
      const datasets = [];
      if (sa) {
        datasets.push({ label: OG_PLATFORMS.samp.label, color: OG_PLATFORMS.samp.color, data: at('San Andreas', sa.sampPlayers) });
        datasets.push({ label: OG_PLATFORMS.omp.label,  color: OG_PLATFORMS.omp.color,  data: at('San Andreas', sa.ompPlayers) });
      }
      playerKeys.forEach(k => {
        const cat = `${OG_PLATFORMS[k].label} · ${OG_PLATFORMS[k].game}`;
        datasets.push({ label: OG_PLATFORMS[k].label, color: OG_PLATFORMS[k].color, data: at(cat, latest[k].players) });
      });
      stackedBar('og-bench', cats, datasets);
    } else {
      destroy('og-bench');
    }

    // ── History lines: player count over time for player-bearing platforms ───
    const series = [];
    playerKeys.concat(Object.keys(OG_PLATFORMS).filter(k => k !== 'samp' && k !== 'omp' && !playerKeys.includes(k)))
      .filter((k, i, a) => a.indexOf(k) === i)
      .forEach(k => {
        const pts = hist.map(p => ({ t: p.t, v: p.sources?.[k]?.players })).filter(p => p.v != null);
        if (pts.length >= 2) series.push({ label: OG_PLATFORMS[k].label, data: pts.map(p => p.v), color: OG_PLATFORMS[k].color, _t: pts.map(p => p.t) });
      });
    if (series.length) {
      const labels = series[0]._t.map(t => shortDate(t, 30));
      lineChart('og-players', labels, series.map(s => ({ label: s.label, data: s.data, color: s.color })));
      if (note) note.textContent = 'Other-platform history fills in hourly. San Andreas long-term history lives in the Trends tab.';
    } else {
      destroy('og-players');
      if (note) note.textContent = hist.length
        ? 'Only one snapshot so far — the trend lines appear once there are at least two.'
        : 'No other-platform history yet — it populates hourly.';
    }
  }

  // ══ TAB: Sources ════════════════════════════════════════════════════════════
  // Transparent provenance for every number on the dashboard. We only reference
  // the PUBLIC data sources (live APIs + the Internet Archive) — not any internal
  // collection method/cadence.
  const SOURCES = [
    {
      name: 'open.mp server list',
      where: 'api.open.mp',
      years: 'Live + 2023→present',
      provides: 'Current open.mp + SA-MP servers, players, versions, geo IPs.',
      process: 'Public JSON API, read live in your browser each visit. Historical points come from snapshots of this same endpoint preserved by the Internet Archive.',
    },
    {
      name: 'Internet Archive (Wayback Machine)',
      where: 'web.archive.org',
      years: '2023→2026',
      provides: 'Archived open.mp server-list snapshots → real historical player/server totals.',
      process: 'Public CDX API lists archived captures of api.open.mp/servers; each capture is parsed exactly like the live list to recover that day’s totals.',
    },
    {
      name: 'SACNR Monitor (archived)',
      where: 'monitor.sacnr.com via web.archive.org',
      years: '2010→2022',
      provides: 'Yearly SA-MP totals (servers + players) for the pre-open.mp era.',
      process: 'For each year, archived captures of the monitor’s public homepage are read and the published “Tracking N servers, M players online” figure is taken (best capture per year).',
    },
    {
      name: 'RAGE:MP master',
      where: 'cdn.rage.mp',
      years: 'Live',
      provides: 'GTA V (RAGE:MP) server + player counts for cross-platform benchmarking.',
      process: 'Public master list (JSON). Used for the live player benchmark.',
    },
    {
      name: 'MTA:SA master',
      where: 'master.mtasa.com',
      years: 'Live',
      provides: 'MTA:SA (GTA San Andreas) server count.',
      process: 'Public ASE master list. Server count is reliable; player totals are not exposed in a verifiable form, so only the server count is shown.',
    },
    {
      name: 'geojs.io',
      where: 'get.geojs.io',
      years: 'Live',
      provides: 'IP→location for the Geography map.',
      process: 'Public, key-less geolocation API, queried live in your browser for the map only.',
    },
  ];

  function renderSources(el) {
    if (_rendered.has('sources')) return;
    el.innerHTML = `
      <p class="dash-note">
        Where every figure on this dashboard comes from. Live numbers are read directly from
        public APIs in your browser; historical numbers are reconstructed from snapshots
        preserved by the <strong>Internet Archive</strong>. Each row notes the years covered and
        how the data is turned into the charts you see.
      </p>
      <div class="chart-panel" style="padding:0;overflow:auto">
        <table class="dash-table src-table">
          <thead><tr>
            <th>Source</th><th>Where</th><th>Years</th><th>Provides</th>
          </tr></thead>
          <tbody>
            ${SOURCES.map(s => `<tr>
              <td><strong>${esc(s.name)}</strong></td>
              <td class="dim"><code>${esc(s.where)}</code></td>
              <td style="white-space:nowrap;color:${C.sand}">${esc(s.years)}</td>
              <td>${esc(s.provides)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="chart-panel" style="margin-top:16px">
        <h3>How the data is processed</h3>
        <ul class="src-process">
          ${SOURCES.map(s => `<li><strong>${esc(s.name)}:</strong> ${esc(s.process)}</li>`).join('')}
        </ul>
        <p class="dash-note" style="margin-top:10px">
          Long-term trends blend archived SA-MP totals (2010→2022) with archived open.mp
          snapshots (2023→). The open.mp / SA-MP split only exists from 2023 — earlier years are
          all SA-MP. Different games are shown side by side for scale only; they are distinct titles.
        </p>
      </div>`;
    _rendered.add('sources');
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  function topCounts(arr, keyFn, n) {
    const m = {}; arr.forEach(x => { const k = keyFn(x); m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
  }
  function topSum(arr, keyFn, valFn, n) {
    const m = {}; arr.forEach(x => { const k = keyFn(x); m[k] = (m[k] || 0) + valFn(x); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
  }
  const kpi = (color, label, id) => `<div class="kpi-card ${color}"><div class="kpi-label">${label}</div><div class="kpi-value" id="${id}">—</div></div>`;
  const kpiVal = (color, label, valHtml) => `<div class="kpi-card ${color}"><div class="kpi-label">${label}</div><div class="kpi-value">${valHtml}</div></div>`;
  const canvas = (id, h) => `<div class="canvas-wrap" style="height:${h}px"><canvas id="${id}"></canvas></div>`;
  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  // (?) explainer chip — web-rendered tooltip (NOT the OS title= tooltip).
  // The text is stashed in data-tip and surfaced by a single shared bubble that
  // follows the chip on hover/focus/tap. Icon is an inline SVG, not a glyph.
  function tip(text) {
    return `<button type="button" class="chart-tip" data-tip="${esc(text)}" aria-label="What is this?">`
      + `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/>`
      + `<path d="M6 6.2a2 2 0 1 1 2.6 1.9c-.5.2-.7.5-.7 1v.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`
      + `<circle cx="7.9" cy="11.4" r="0.95" fill="currentColor"/></svg></button>`;
  }

  // One shared tooltip bubble for all (?) chips — positioned next to the hovered
  // chip. Pure DOM/CSS, so it renders identically on every OS/browser.
  (function initTips() {
    const bubble = document.createElement('div');
    bubble.className = 'chart-tip-bubble';
    bubble.setAttribute('role', 'tooltip');
    bubble.hidden = true;
    document.body.appendChild(bubble);

    let active = null;
    const show = (chip) => {
      const text = chip.getAttribute('data-tip');
      if (!text) return;
      active = chip;
      bubble.textContent = text;
      bubble.hidden = false;
      const r = chip.getBoundingClientRect();
      const bw = Math.min(280, window.innerWidth - 24);
      bubble.style.maxWidth = bw + 'px';
      // Measure then clamp within viewport.
      let left = r.left + r.width / 2 - bw / 2 + window.scrollX;
      left = Math.max(12 + window.scrollX, Math.min(left, window.scrollX + window.innerWidth - bw - 12));
      bubble.style.left = left + 'px';
      bubble.style.top = (r.bottom + window.scrollY + 8) + 'px';
    };
    const hide = (chip) => { if (active === chip || !chip) { bubble.hidden = true; active = null; } };

    // Event delegation — chips are created dynamically inside the dashboard.
    document.addEventListener('mouseover', (e) => { const c = e.target.closest('.chart-tip'); if (c) show(c); });
    document.addEventListener('mouseout',  (e) => { const c = e.target.closest('.chart-tip'); if (c) hide(c); });
    document.addEventListener('focusin',   (e) => { const c = e.target.closest('.chart-tip'); if (c) show(c); });
    document.addEventListener('focusout',  (e) => { const c = e.target.closest('.chart-tip'); if (c) hide(c); });
    // Tap toggles on touch devices.
    document.addEventListener('click', (e) => {
      const c = e.target.closest('.chart-tip');
      if (c) { e.preventDefault(); (active === c) ? hide(c) : show(c); }
      else if (active) hide(active);
    });
    window.addEventListener('scroll', () => { if (active) hide(active); }, true);
  })();
})();
