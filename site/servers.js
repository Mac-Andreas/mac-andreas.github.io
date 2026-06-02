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
// Colour convention (per request): open.mp = PURPLE, SA-MP = ORANGE.
(() => {
  const OMP_API = 'https://api.open.mp/servers';
  const HISTORY_URL = 'data/server-history.json';

  // SA-MP began its long wind-down in 2018 (Kalcor stepping back; the forums &
  // wiki later went dark). User chose 2018 as the reference point.
  const SAMP_FORUMS_CLOSED = '2018-01-01';

  // Cache/refresh the live snapshot at most once per hour so we don't hammer
  // api.open.mp on every visit. (The Actions recorder also runs hourly.)
  const POLL_MS = 60 * 60 * 1000;

  // "All" first — it's the default range (full 2010→today archive).
  const RANGES = [
    { key: 'all',  label: 'All',       days: 365 * 50 }, // full archive: SACNR 2010 → today
    { key: 'day',  label: 'Daily',     days: 1 },
    { key: 'week', label: 'Weekly',    days: 7 },   // rolling 7 days (Mon–Sun framing in note)
    { key: 'mo',   label: 'Monthly',   days: 30 },
    { key: 'qtr',  label: 'Quarterly', days: 91 },
    { key: 'half', label: 'Half-yr',   days: 182 },
    { key: 'yr',   label: 'Yearly',    days: 365 },
  ];

  // Theme — mirrors site/styles.css. open.mp=purple, SA-MP=orange (ember).
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
  // Ordered DARK→LIGHT so "newest build" (first slice) is the deepest purple and
  // older builds fade toward light grey-purple.
  const PURPLES = ['#5B3FB0', '#6D4DC7', '#7C5BD6', '#9B7FE8', '#B9A6F0', '#C9BCF5', '#D8CFF0', '#E5DEF6'];
  // Green→red ramp for "fill level" style charts (low utilisation = green/good,
  // packed = red/bad). Six steps to match the capacity bands.
  const GREEN_RED = ['#B4D862', '#9FCB4E', '#E0C04A', '#E8A13C', '#E0742C', '#C9442B'];
  const PALETTE = BLUES;  // default generic palette

  const tabsEl   = document.getElementById('dash-tabs');
  const panelsEl = document.getElementById('dash-panels');
  if (!tabsEl || !panelsEl) return;

  // ── Embed mode (?embed=dashboard) ────────────────────────────────────────
  // When embedded via the Embed tab's iframe snippet, strip the site chrome
  // (hero/nav/footer) and show ONLY the #dashboard section, then pin a small
  // "powered by Mac-Andreas" credit beneath it. The whole dashboard still works
  // (tabs, live data) inside the iframe.
  const EMBED = new URLSearchParams(location.search).has('embed');
  if (EMBED) {
    document.body.classList.add('embed-mode');
    // Hide the Embed tab inside an embed (the snippet/preview is meaningless and
    // its preview iframe would nest recursively).
    const embedTabBtn = tabsEl.querySelector('[data-tab="embed"]');
    if (embedTabBtn) embedTabBtn.style.display = 'none';
    const dash = document.getElementById('dashboard');
    if (dash && !document.querySelector('.embed-credit')) {
      const credit = document.createElement('p');
      credit.className = 'embed-credit';
      credit.innerHTML = 'Live data · <a href="https://mac-andreas.github.io/#dashboard" target="_blank" rel="noopener">Mac-Andreas Usage Dashboard ↗</a>';
      dash.appendChild(credit);
    }
  }

  // ── state ───────────────────────────────────────────────────────────────
  let _servers = null, _error = null, _activeTab = 'live', _pollTimer = null;
  let _history = null, _trendRange = 'all', _mapFilter = 'all';
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
  // devicePixelRatio:null lets Chart.js read the LIVE window.devicePixelRatio on
  // each resize — so browser zoom (which changes DPR) re-rasterizes crisply
  // instead of leaving a stale canvas whose hit-testing maps the cursor to the
  // wrong data point. A DPR watcher below triggers that resize on zoom.
  const baseOpts = {
    responsive: true, maintainAspectRatio: false, devicePixelRatio: null,
    animation: { duration: 350 },
    plugins: { legend: { display: false }, tooltip },
  };
  const DL = (typeof ChartDataLabels !== 'undefined') ? ChartDataLabels : null; // datalabels plugin

  function make(id, config) {
    destroy(id);
    const el = document.getElementById(id);
    if (!el) return null;
    _charts[id] = new Chart(el.getContext('2d'), config);
    return _charts[id];
  }

  // Browser zoom changes window.devicePixelRatio but fires no resize event, which
  // is what left Chart.js canvases at a stale scale (tooltip/crosshair landing on
  // the wrong point + a momentary glitch). Watch DPR via a matchMedia query that
  // re-arms after every change, and resize all live charts when it shifts.
  (function watchZoom() {
    let last = window.devicePixelRatio || 1;
    const resizeAll = () => { for (const id in _charts) { try { _charts[id].resize(); } catch {} } };
    const arm = () => {
      const mq = matchMedia(`(resolution: ${last}dppx)`);
      const onChange = () => {
        const now = window.devicePixelRatio || 1;
        if (now !== last) { last = now; resizeAll(); }
        arm(); // re-arm for the new ratio
      };
      mq.addEventListener ? mq.addEventListener('change', onChange, { once: true })
                          : mq.addListener(onChange);
    };
    arm();
    // Belt-and-braces: a debounced window resize also re-syncs (covers zoom paths
    // that DO emit resize, and normal layout reflows).
    let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(resizeAll, 150); });
  })();

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
    const lastIdx = datasets.length - 1;
    // Per-row totals (sum across datasets) → shown at the END of each bar.
    const rowTotals = labels.map((_, i) => datasets.reduce((a, d) => a + (d.data[i] || 0), 0));
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
        layout: { padding: { right: 64 } },
        scales: {
          x: { stacked: true, ticks: { color: C.muted, font: { size: 11 }, precision: 0 }, grid: { color: C.border }, beginAtZero: true },
          y: { stacked: true, ticks: { color: C.text, font: { size: 11 } }, grid: { display: false } },
        },
        plugins: {
          ...baseOpts.plugins,
          legend: { display: true, position: 'top', labels: { color: C.text, font: { size: 11 }, boxWidth: 12, padding: 10 } },
          tooltip,
          datalabels: DL ? {
            // Two labels per element: the in-segment value (theme-aware white,
            // skip empties) and — only on the last segment — the row TOTAL,
            // pushed just past the bar end in bold sand.
            labels: {
              value: {
                color: C.text, font: { size: 10, weight: '600' }, anchor: 'center', align: 'center',
                formatter: (v) => (v > 0 ? fmt(v) : ''),
              },
              total: {
                anchor: 'end', align: 'end', offset: 6, clamp: true,
                color: C.sand, font: { size: 11, weight: '700' },
                formatter: (v, ctx) => (ctx.datasetIndex === lastIdx ? fmt(rowTotals[ctx.dataIndex]) : ''),
              },
            },
          } : undefined,
        },
      },
      plugins: DL ? [DL] : [],
    });
  }

  // opts: { showValues=true, outside=false }.
  //  • outside:true → labels sit OUTSIDE the ring (theme-aware WHITE text) and
  //    read "value (pct%)" — used for the 2-slice open.mp-vs-SA-MP donuts.
  //  • otherwise   → compact in-ring labels on dark slice fills.
  function doughnut(id, labels, data, colors = PALETTE, opts = {}) {
    const { showValues = true, outside = false } = (typeof opts === 'boolean') ? { showValues: opts } : opts;
    const labelText = (v, ctx) => {
      const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
      const p = pctOf(v, total);
      if (outside) return `${fmt(v)} (${p}%)`;
      return p >= 6 ? fmt(v) : ''; // hide labels on tiny slices (in-ring mode)
    };
    return make(id, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors.map(c => c + 'CC'), borderColor: colors, borderWidth: 1, hoverOffset: 6 }] },
      options: {
        ...baseOpts, cutout: '56%',
        layout: outside ? { padding: 30 } : undefined,
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
            color: outside ? C.text : C.bg,           // theme-aware white when outside
            anchor: outside ? 'end' : 'center',
            align: outside ? 'end' : 'center',
            offset: outside ? 8 : 0,
            clamp: true,
            font: { size: outside ? 11 : 10, weight: '700' },
            formatter: labelText,
          } : undefined,
        },
      },
      plugins: (DL && showValues) ? [DL] : [],
    });
  }

  // `opts` (optional): { xLabel, yLabel } adds titled axes.
  function lineChart(id, labels, series, opts = {}) {
    const axisTitle = (text) => ({
      display: !!text, text, color: C.sand,
      font: { size: 11, weight: '600', style: 'italic' },
    });
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
          x: { title: axisTitle(opts.xLabel || 'Date'), ticks: { color: C.muted, font: { size: 10 }, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: C.border } },
          y: { title: axisTitle(opts.yLabel), ticks: { color: C.muted, font: { size: 11 }, precision: 0 }, grid: { color: C.border }, beginAtZero: true },
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
    if (!['live', 'trends', 'analysis', 'breakdown', 'geography', 'othergames', 'sources', 'embed'].includes(tab)) tab = 'live';
    _activeTab = tab;
    tabsEl.querySelectorAll('.dash-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    panelsEl.querySelectorAll('.dash-panel').forEach(p => p.dataset.active = String(p.dataset.tab === tab));
    renderTab(tab);
  }

  // Deep-link a sub-tab via #dashboard-geography etc. (shareable + testable).
  function tabFromHash() {
    const m = (location.hash || '').match(/^#dashboard-(live|trends|analysis|breakdown|geography|othergames|sources|embed)$/);
    return m ? m[1] : null;
  }
  window.addEventListener('hashchange', () => { const t = tabFromHash(); if (t) activate(t); });

  // ── boot ────────────────────────────────────────────────────────────────────
  panelsEl.innerHTML = `
    <section class="dash-panel" data-tab="live"      data-active="true"></section>
    <section class="dash-panel" data-tab="trends"    data-active="false"></section>
    <section class="dash-panel" data-tab="analysis"   data-active="false"></section>
    <section class="dash-panel" data-tab="breakdown" data-active="false"></section>
    <section class="dash-panel" data-tab="geography"  data-active="false"></section>
    <section class="dash-panel" data-tab="othergames" data-active="false"></section>
    <section class="dash-panel" data-tab="sources"    data-active="false"></section>
    <section class="dash-panel" data-tab="embed"      data-active="false"></section>`;
  // Honour a deep-linked sub-tab on first load — deferred to the next tick so
  // every `const` helper defined below this IIFE block (skeleton, kpi, canvas…)
  // is initialised before activate()→renderTab() can reference them (avoids a
  // temporal-dead-zone crash on the deep-link path). The same tick paints the
  // active tab's LOADING state immediately, so the panel is never blank while the
  // open.mp fetch is in flight (previously it only rendered after the await).
  setTimeout(() => {
    const t = tabFromHash();
    if (t && t !== _activeTab) activate(t);
    else renderTab(_activeTab);
  }, 0);
  load();

  async function load() {
    const cached = cachedServers();
    if (cached) { _servers = cached; _error = null; }
    else {
      try { _servers = await fetchServers(); cacheServers(_servers); _error = null; }
      catch (err) { console.error('[dashboard] fetch failed', err); _error = err.message || String(err); }
    }
    // Re-render any tab that overlays the long-term SA history once it loads
    // (trends + the all-platform lines on benchmarking & analysis).
    fetchHistory().then(h => { _history = h; if (['trends', 'othergames', 'analysis'].includes(_activeTab)) renderTab(_activeTab); });
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
    if (tab === 'embed')      return renderEmbed(el);
    if (_error && !_servers) { el.innerHTML = `<div class="dash-error">Couldn't reach <code>api.open.mp</code> — ${_error}</div>`; return; }
    if (!_servers) { el.innerHTML = skeleton(); return; }
    if (tab === 'live')      return renderLive(el);
    if (tab === 'trends')    return renderTrends(el);
    if (tab === 'breakdown') return renderBreakdown(el);
    if (tab === 'geography') return renderGeography(el);
    if (tab === 'analysis')  return renderAnalysis(el);
  }

  // Loading state — a spinner + message, shown while the live open.mp snapshot is
  // being fetched (replaces the old blank/skeleton flash).
  const skeleton = () => `
    <div class="dash-loading">
      <div class="dash-spinner" aria-hidden="true"></div>
      <div class="dash-loading-text">Loading data — please wait…</div>
      <div class="dash-loading-sub">Fetching the live open.mp + SA-MP server list.</div>
    </div>`;

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
          ${kpi('good',   'Total Players Online (last hour)', 'sv-players')}
          ${kpi('purple', 'open.mp Players','sv-omp-players')}
          ${kpi('ember',  'SA-MP Players',  'sv-samp-players')}
          ${kpi('sand',   'Total Servers',  'sv-total')}
          ${kpi('purple', 'open.mp Servers','sv-omp')}
          ${kpi('ember',  'SA-MP Servers',  'sv-samp')}
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
          <h3>open.mp <span style="color:${OMP}">vs</span> SA-MP <span class="dim">players over time</span> ${tip('How the player base splits between open.mp (purple) and legacy SA-MP (orange). Watch open.mp climb as SA-MP declines.')}</h3>${canvas('trend-split', 260)}
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
    const range = RANGES.find(r => r.key === _trendRange) || RANGES[0];
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

    lineChart('trend-players', labels, [{ label: 'Total players', data: pts.map(p => p.p), color: BLUE, dashFrom: dash }],
      { xLabel: 'Date', yLabel: 'Players online' });
    lineChart('trend-servers', labels, [{ label: 'Total servers', data: pts.map(p => p.s), color: BLUE, dashFrom: dash }],
      { xLabel: 'Date', yLabel: 'Servers listed' });
    // open.mp only existed from 2023 — before that op=0. Render those leading
    // zeros as gaps (null) so the purple line doesn't draw a flat run along the
    // x-axis; it simply begins where open.mp data actually starts.
    lineChart('trend-split', labels, [
      { label: 'open.mp players', data: pts.map(p => p.op > 0 ? p.op : null), color: OMP, dashFrom: dash },
      { label: 'SA-MP players', data: pts.map(p => p.sp), color: SAMP, dashFrom: dash },
    ], { xLabel: 'Date', yLabel: 'Players online' });

    // Card baseline = the point closest to EXACTLY one period ago, so each range
    // reads as "vs yesterday / last week / last month / last quarter / 6 months
    // ago / last year". (The chart still plots every point in the window above;
    // this only picks the comparison anchor for the % cards.) We search the full
    // history — not just the window — so a sparse window still finds a sensible
    // "one period ago" point. Falls back to the oldest in-window point.
    const b = pts[pts.length - 1];
    const targetTs = Date.now() - range.days * 86_400_000;
    const a = _trendRange === 'all'
      ? pts[0]
      : _history.reduce((best, p) => {
          const d = Math.abs(new Date(p.t).getTime() - targetTs);
          return (best == null || d < best._d) ? Object.assign({}, p, { _d: d }) : best;
        }, null) || pts[0];
    // In the "All" range the cards are really "current totals" — a % change vs the
    // 2010 archive point is misleading, so suppress the ▲/▼ delta line there.
    const noDelta = _trendRange === 'all';
    // Human period label for the delta line: "yesterday" / "last week (1–7 Jun
    // 2026)" / "last month (May 2026)" / "last year (2025)" etc., derived from the
    // chosen range and the actual baseline point's date.
    const periodLbl = periodLabel(_trendRange, a.t);
    const kpiEl = document.getElementById('trend-kpis');
    if (kpiEl) kpiEl.innerHTML = [
      pctCard('good',   'Total players',   a.p,  b.p,  periodLbl, noDelta),
      pctCard('purple', 'open.mp players', a.op, b.op, periodLbl, noDelta),
      pctCard('ember',  'SA-MP players',   a.sp, b.sp, periodLbl, noDelta),
      pctCard('sand',   'Total servers',   a.s,  b.s,  periodLbl, noDelta),
      pctCard('purple', 'open.mp servers', a.os, b.os, periodLbl, noDelta),
      pctCard('ember',  'SA-MP servers',   a.ss, b.ss, periodLbl, noDelta),
    ].join('');

    const anyEst = pts.some(p => p.est);
    const hasSacnr = pts.some(p => p.source === 'sacnr');
    // "All" shows current totals (no vs-2010 delta); other ranges show % change.
    const lead = _trendRange === 'all' ? 'Current totals over the' : '% change over the';
    if (note) note.textContent = _trendRange === 'all'
      ? `Cards show current totals. Full archive timeline: SACNR Monitor SA-MP totals (yearly, 2010→2022) + archived open.mp snapshots (2023→), refreshed hourly. The open.mp/SA-MP split only exists from 2023 — earlier years are all SA-MP.`
      : anyEst
        ? `${lead} last ${range.label}. Solid line = real data (archived snapshots, refreshed hourly); dashed = estimated pre-archive backbone.`
        : hasSacnr
          ? `${lead} last ${range.label}. Real data: SACNR Monitor SA-MP totals (yearly, 2010→2022) + archived open.mp snapshots (2023→), refreshed hourly. The open.mp/SA-MP split only exists from 2023 — earlier years are all SA-MP.`
          : `${lead} last ${range.label}, from real open.mp snapshots (Internet Archive), refreshed hourly.`;
  }

  // `periodLbl` (optional) = human period label for the baseline, e.g.
  // "yesterday" / "last week (1–7 Jun 2026)" / "last year (2025)". Shown after
  // the baseline value: "from 21,010 · last year (2025)".
  // `noDelta` (optional) hides the ▲/▼ change line entirely (used by the "All"
  // range, where the card is a current total, not a trend vs the 2010 archive).
  function pctCard(color, label, from, to, periodLbl, noDelta) {
    if (noDelta) {
      return `<div class="kpi-card ${color}"><div class="kpi-label">${label}</div><div class="kpi-value">${fmt(to)}</div></div>`;
    }
    const when = periodLbl ? ` <span class="dim">· ${periodLbl}</span>` : '';
    let deltaHtml;
    if (!from) {
      deltaHtml = to > 0
        ? `<span class="kpi-delta up">▲ new <span class="dim">from 0${when}</span></span>`
        : `<span class="kpi-delta dim">no change</span>`;
    } else {
      const delta = ((to - from) / from) * 100, up = delta >= 0;
      deltaHtml = `<span class="kpi-delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}% <span class="dim">from ${fmt(from)}${when}</span></span>`;
    }
    return `<div class="kpi-card ${color}"><div class="kpi-label">${label}</div><div class="kpi-value">${fmt(to)}</div>${deltaHtml}</div>`;
  }

  // Human label for the comparison baseline, given the range key + baseline date.
  //   day  → "yesterday"
  //   week → "last week (1–7 Jun 2026)"   (the 7-day window ending at baseline)
  //   mo   → "last month (May 2026)"
  //   qtr  → "last quarter (Mar 2026)"
  //   half → "6 months ago (Dec 2025)"
  //   yr   → "last year (2025)"
  function periodLabel(rangeKey, baselineISO) {
    const d = new Date(baselineISO);
    const dMon = (x) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const mon  = (x) => x.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    switch (rangeKey) {
      case 'day':  return 'yesterday';
      case 'week': {
        const end = d, start = new Date(d.getTime() - 6 * 86_400_000);
        return `last week (${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}–${dMon(end)})`;
      }
      case 'mo':   return `last month (${mon(d)})`;
      case 'qtr':  return `last quarter (${mon(d)})`;
      case 'half': return `6 months ago (${mon(d)})`;
      case 'yr':   return `last year (${d.getFullYear()})`;
      default:     return mon(d);
    }
  }

  // Unambiguous axis dates. Long ranges (>~7mo) → "Mon YYYY" (e.g. "Jun 2026");
  // short ranges → "D Mon YYYY" (e.g. "1 Jun 2026"). We always show the FULL year
  // so "Jan 22" can't be misread as a day-of-month vs a 2-digit year.
  function shortDate(iso, days) {
    const d = new Date(iso);
    return days > 200
      ? d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
          <div class="chart-panel"><h3>open.mp <span style="color:${OMP}">vs</span> SA-MP <span class="dim">servers</span> ${tip('Share of the server count: open.mp (purple) vs legacy SA-MP (orange).')}</h3>${canvas('bd-split', 240)}</div>
          <div class="chart-panel"><h3>open.mp <span style="color:${OMP}">vs</span> SA-MP <span class="dim">players</span> ${tip('Share of all online players: open.mp (purple) vs SA-MP (orange).')}</h3>${canvas('bd-split-p', 240)}</div>
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
    // Capacity utilisation → green (empty-ish) to red (packed) tint.
    doughnut('bd-cap', uLabels, uCounts, GREEN_RED);

    // Languages — "Unknown" for blanks (label already does that).
    const langs = topCounts(_servers, s => (s.la || '').trim() || 'Unknown', 10);
    barChart('bd-lang', langs.map(x => x[0]), langs.map(x => x[1]), BLUE, true);

    // open.mp versions → purple family, dark (newest) → light (oldest).
    const vers = topCounts(t.omp, s => s.vn || 'Unknown', 8);
    doughnut('bd-ver', vers.map(x => x[0]), vers.map(x => x[1]), PURPLES);

    // Password protected — green = open (unlocked), red = password (locked).
    doughnut('bd-pass', ['Open', 'Password'], [t.totalServers - passCount, passCount], [C.good, C.bad]);

    // open.mp vs SA-MP — purple vs orange, 2 slices, labels OUTSIDE the ring with
    // "value (pct%)", theme-aware white text. No click-to-filter (only 2 values).
    doughnut('bd-split',   ['open.mp', 'SA-MP'], [t.ompServers, t.sampServers], [OMP, SAMP], { outside: true });
    doughnut('bd-split-p', ['open.mp', 'SA-MP'], [t.ompPlayers, t.sampPlayers], [OMP, SAMP], { outside: true });
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
            <div id="geo-status" class="dash-status">Open this tab to resolve server locations…</div>
            <div class="dash-controls" id="geo-filter-btns">
              <button class="btn-range active" data-filter="all">All servers</button>
              <button class="btn-range" data-filter="omp">open.mp</button>
              <button class="btn-range" data-filter="samp">SA-MP</button>
            </div>
          </div>
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
      kpiVal('good',   'Total Players Online', fmt(t.totalPlayers)),
      kpiVal('purple', 'open.mp Servers',      fmt(t.ompServers)),
      kpiVal('info',   `Active Servers ${tip('Servers with at least one player online right now (empty servers excluded).')}`, fmt(t.activeServers)),
      kpiVal('sand',   'Avg Players/Server',   t.totalServers ? (t.totalPlayers / t.totalServers).toFixed(1) : '0'),
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
    ragemp:  { game: 'GTA V',            label: 'RAGE:MP',    color: '#34D399' },  // green
    vcmp:    { game: 'GTA: Vice City',   label: 'VC:MP',      color: '#29E0FF' },  // cyan
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
          stacks up against other GTA multiplayer platforms, recorded hourly (these
          platforms’ public APIs aren’t reachable directly from a browser).
          The <strong>San&nbsp;Andreas</strong> bar stacks every San Andreas platform —
          <strong>SA-MP</strong> + <strong>open.mp</strong> + <strong>MTA:SA</strong> —
          while <strong>RAGE:MP</strong> (GTA&nbsp;V) and <strong>VC:MP</strong>
          (Vice&nbsp;City) get their own bars. alt:V&nbsp;/&nbsp;FiveM probes run hourly and
          light up automatically if their APIs return. GTA&nbsp;III&nbsp;/&nbsp;IV have no
          live master.
        </p>
        <div class="chart-panel">
          <h3>Live player benchmark <span class="dim">across platforms · last hour</span> ${tip('Concurrent players per platform from the most recent hourly snapshot. The San Andreas bar stacks SA-MP (orange) + open.mp (purple) + MTA:SA (amber). RAGE:MP and VC:MP get their own bars in their own colour. The number at the end of each bar is that game’s total players. Different games — shown for scale.')}</h3>
          ${canvas('og-bench', 240)}
        </div>
        <div class="chart-panel" style="margin-top:16px">
          <h3>Players <span class="dim">over time · all platforms</span> ${tip('Concurrent players over time for every platform — San Andreas (SA-MP + open.mp) plus RAGE:MP, MTA:SA and VC:MP — on one shared timeline. Combines hourly recordings with Internet-Archive history.')}</h3>
          ${canvas('og-players', 300)}
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

  // Most-recent NON-NULL value of a field for a platform, scanning the history
  // backwards — so a single failed hourly scrape (which writes null/omits the key)
  // doesn't make a platform vanish from the benchmark.
  function latestVal(key, field) {
    const og = _otherHist || [];
    for (let i = og.length - 1; i >= 0; i--) {
      const v = og[i].sources?.[key]?.[field];
      if (v != null) return v;
    }
    return null;
  }

  function drawOtherGames() {
    const hist = _otherHist || [];
    const note = document.getElementById('og-note');

    // Live San Andreas baseline (open.mp + SA-MP) from the current server list.
    const sa = _servers ? totals(_servers) : null;
    // MTA:SA is ALSO a San Andreas platform → it stacks into the San Andreas bar.
    const mtaPlayers = latestVal('mtasa', 'players') || 0;

    // ── Benchmark bar (PLAYERS only) ──────────────────────────────────────────
    // San Andreas row stacks SA-MP + open.mp + MTA:SA. Every other GAME (RAGE:MP,
    // VC:MP, …) is its own single-segment row in its own colour. Each platform's
    // value is its most-recent non-null player count.
    const otherGameKeys = Object.keys(OG_PLATFORMS)
      .filter(k => !['samp', 'omp', 'mtasa'].includes(k))   // SA platforms handled above
      .filter(k => (latestVal(k, 'players') || 0) > 0);

    const cats = [];
    if (sa) cats.push('San Andreas');
    otherGameKeys.forEach(k => cats.push(`${OG_PLATFORMS[k].label} · ${OG_PLATFORMS[k].game}`));

    if (cats.length) {
      const at = (cat, val) => cats.map(c => (c === cat ? val : 0));
      const datasets = [];
      if (sa) {
        datasets.push({ label: OG_PLATFORMS.samp.label,  color: OG_PLATFORMS.samp.color,  data: at('San Andreas', sa.sampPlayers) });
        datasets.push({ label: OG_PLATFORMS.omp.label,   color: OG_PLATFORMS.omp.color,   data: at('San Andreas', sa.ompPlayers) });
        if (mtaPlayers > 0)
          datasets.push({ label: OG_PLATFORMS.mtasa.label, color: OG_PLATFORMS.mtasa.color, data: at('San Andreas', mtaPlayers) });
      }
      otherGameKeys.forEach(k => {
        const cat = `${OG_PLATFORMS[k].label} · ${OG_PLATFORMS[k].game}`;
        datasets.push({ label: OG_PLATFORMS[k].label, color: OG_PLATFORMS[k].color, data: at(cat, latestVal(k, 'players')) });
      });
      stackedBar('og-bench', cats, datasets);
    } else {
      destroy('og-bench');
    }

    // ── History lines: players over time for EVERY platform on ONE time axis ──
    // Includes San Andreas (SA-MP + open.mp, from the long-term server-history)
    // plus every recorded other platform (RAGE:MP, MTA:SA, VC:MP…). Each platform
    // is aligned to a shared, sorted set of timestamps with null gaps so lines of
    // different length plot correctly against the same axis.
    drawAllPlatformLines('og-players', note,
      'Players over time across every platform — San Andreas (SA-MP + open.mp) and the other GTA masters (RAGE:MP, MTA:SA, VC:MP), blending hourly recordings with Internet-Archive history.');
  }

  // Build a unified players-over-time line chart across SA-MP, open.mp and the
  // other-game platforms. `histKey` selects 'players' vs 'servers' on the
  // other-games rows; San Andreas comes from _history (p.sp / p.op).
  function drawAllPlatformLines(canvasId, noteEl, noteText, metric = 'players') {
    const og = _otherHist || [];
    // 1) Collect each platform's (timestamp → value) map.
    const saField = metric === 'servers' ? { samp: 'ss', omp: 'os' } : { samp: 'sp', omp: 'op' };
    const maps = {}; // key → Map(iso → value)
    const add = (key, iso, v) => {
      if (v == null) return;
      (maps[key] ||= new Map()).set(iso, v);
    };
    (_history || []).forEach(p => {
      if (p.sp != null) add('samp', p.t, p[saField.samp]);
      if (p.op > 0)     add('omp',  p.t, p[saField.omp]); // open.mp only after 2023
    });
    og.forEach(p => {
      for (const [k, v] of Object.entries(p.sources || {})) {
        if (k === 'samp' || k === 'omp') continue;
        add(k, p.t, v?.[metric]);
      }
    });

    // 2) Unified, sorted timestamp axis across all contributing platforms.
    const allTs = [...new Set(Object.values(maps).flatMap(m => [...m.keys()]))].sort();
    const platforms = Object.keys(maps).filter(k => OG_PLATFORMS[k] && maps[k].size >= 2);
    if (!allTs.length || !platforms.length) {
      destroy(canvasId);
      if (noteEl) noteEl.textContent = og.length
        ? 'Only one snapshot so far — the trend lines appear once there are at least two.'
        : 'History populates hourly (and from the Internet Archive).';
      return;
    }
    // Span > ~7 months ⇒ "Mon YYYY" axis labels, else day-level.
    const spanDays = (new Date(allTs[allTs.length - 1]) - new Date(allTs[0])) / 86_400_000;
    const labels = allTs.map(t => shortDate(t, spanDays > 200 ? 365 : 30));
    const series = platforms.map(k => ({
      label: OG_PLATFORMS[k].label,
      color: OG_PLATFORMS[k].color,
      data: allTs.map(t => (maps[k].has(t) ? maps[k].get(t) : null)),
    }));
    lineChart(canvasId, labels, series, { xLabel: 'Date', yLabel: metric === 'servers' ? 'Servers' : 'Players online' });
    if (noteEl) noteEl.textContent = noteText;
  }

  // ══ TAB: Server Analysis ═════════════════════════════════════════════════════
  // What KIND of servers carry the SA-MP/open.mp scene (gamemode + language
  // popularity), plus a cross-GAME comparison (SA-MP, open.mp, RAGE:MP, MTA:SA,
  // VC:MP) by server count and players — the broad "who's playing what" view.

  // Free-text gamemodes are messy ("FZ:RP v5.06 - Rol…", "Grand Larceny"…). Bucket
  // them into a handful of recognisable genres by keyword; anything unmatched is
  // "Other". Order matters — first match wins.
  const GAMEMODE_RULES = [
    { genre: 'Roleplay',   re: /\brp\b|role\s*play|roleplay|\brpg\b|:rp|rol\b|real life|real-life/i },
    { genre: 'Cops & Robbers', re: /cops?\s*(and|&|n)?\s*robbers?|\bcnr\b|\bcdc\b/i },
    { genre: 'Freeroam',   re: /free\s*roam|freeroam|\bfr\b|sandbox/i },
    { genre: 'Racing',     re: /\brace|racing|drift|stunt/i },
    { genre: 'Deathmatch', re: /death\s*match|\bdm\b|\btdm\b|war\b|gang\s*war|\bcbug/i },
    { genre: 'Survival',   re: /survival|zombie|hunger|apocalyp/i },
    { genre: 'Minigames',  re: /mini\s*game|minigame|party|fun\b/i },
  ];
  const gmGenre = (gm) => {
    const s = (gm || '').trim();
    if (!s) return 'Unknown';
    for (const r of GAMEMODE_RULES) if (r.re.test(s)) return r.genre;
    return 'Other';
  };

  function renderAnalysis(el) {
    if (!_rendered.has('analysis')) {
      el.innerHTML = `
        <p class="dash-note">
          What kind of servers make up the live scene — gamemode genres and the
          languages players speak — plus how the wider family of GTA multiplayer
          <strong>games</strong> (SA-MP, open.mp, RAGE:MP, MTA:SA, VC:MP) compares by
          server count and live players.
        </p>
        <div class="chart-grid">
          <div class="chart-panel">
            <div class="chart-toolbar"><h3>Gamemode <span class="dim">genres · by servers</span> ${tip('Every SA-MP/open.mp server bucketed into a genre by keywords in its gamemode text (Roleplay, Cops & Robbers, Freeroam, Racing, Deathmatch…). Shows which kinds of servers there are most of.')}</h3></div>
            ${canvas('an-gm-servers', 260)}
          </div>
          <div class="chart-panel">
            <div class="chart-toolbar"><h3>Gamemode <span class="dim">genres · by players</span> ${tip('The same genre buckets, but weighted by live players — which kinds of servers people actually play on right now.')}</h3></div>
            ${canvas('an-gm-players', 260)}
          </div>
        </div>
        <div class="chart-grid">
          <div class="chart-panel"><h3>Top Languages <span class="dim">by players</span> ${tip('Live players summed per declared server language — which language communities are most active.')}</h3>${canvas('an-lang', 260)}</div>
          <div class="chart-panel"><h3>Top Gamemodes <span class="dim">(raw)</span> ${tip('The most common raw gamemode strings, before genre-bucketing — useful for spotting big individual scripts/communities.')}</h3>${canvas('an-gm-raw', 260)}</div>
        </div>
        <div class="chart-panel">
          <h3>Cross-game <span class="dim">comparison · servers</span> ${tip('How many public servers each GTA-multiplayer game has online right now. SA-MP + open.mp are live from api.open.mp; RAGE:MP, MTA:SA and VC:MP from their public masters (hourly). Number at the end of each bar = server count.')}</h3>
          ${canvas('an-games-servers', 240)}
        </div>
        <div class="chart-panel" style="margin-top:16px">
          <h3>Servers <span class="dim">over time · all games</span> ${tip('Server count over time for every platform on one shared timeline — combining hourly recordings with Internet-Archive history.')}</h3>
          ${canvas('an-games-time', 300)}
        </div>
        <p class="dash-note" id="an-note" style="margin-top:12px"></p>`;
      _rendered.add('analysis');
    }
    // Other-games history is needed for the cross-game charts; lazy-load it.
    if (_otherHist == null) {
      fetch('data/othergames-history.json').then(r => r.ok ? r.json() : { points: [] })
        .then(o => { _otherHist = Array.isArray(o?.points) ? o.points : []; drawAnalysis(); })
        .catch(() => { _otherHist = []; drawAnalysis(); });
    } else {
      drawAnalysis();
    }
  }

  function drawAnalysis() {
    if (!_servers) return;
    const t = totals(_servers);
    const og = _otherHist || [];
    const latest = og.length ? og[og.length - 1].sources || {} : {};
    const otherGames = ['ragemp', 'mtasa', 'vcmp'].filter(k => latest[k]);

    // ── Gamemode genres (servers + players) ───────────────────────────────
    const byGenreServers = topSum(_servers, s => gmGenre(s.gm), () => 1, 8);
    barChart('an-gm-servers', byGenreServers.map(x => x[0]), byGenreServers.map(x => x[1]), BLUE, true);
    const byGenrePlayers = topSum(_servers, s => gmGenre(s.gm), s => s.pc || 0, 8);
    barChart('an-gm-players', byGenrePlayers.map(x => x[0]), byGenrePlayers.map(x => x[1]), BLUE, true);

    // ── Languages by players + raw gamemodes ──────────────────────────────
    const langP = topSum(_servers, s => (s.la || '').trim() || 'Unknown', s => s.pc || 0, 12);
    barChart('an-lang', langP.map(x => x[0]), langP.map(x => x[1]), BLUE, true);
    const gmRaw = topSum(_servers.filter(s => (s.pc || 0) > 0), s => (s.gm || '').trim() || 'Unknown', s => s.pc || 0, 12);
    barChart('an-gm-raw', gmRaw.map(x => x[0].slice(0, 28)), gmRaw.map(x => x[1]), BLUE, true);

    // ── Cross-game server-count comparison ────────────────────────────────
    // One bar per GAME. San Andreas stacks SA-MP + open.mp; others are single
    // segments in their own colour, with the row total at the bar end.
    const cats = ['San Andreas'];
    const at = (cat, val) => cats.map(c => (c === cat ? val : 0));
    const datasets = [
      { label: 'SA-MP',   color: OG_PLATFORMS.samp.color, data: at('San Andreas', t.sampServers) },
      { label: 'open.mp', color: OG_PLATFORMS.omp.color,  data: at('San Andreas', t.ompServers) },
    ];
    otherGames.forEach(k => {
      const cat = `${OG_PLATFORMS[k].label} · ${OG_PLATFORMS[k].game}`;
      if (!cats.includes(cat)) cats.push(cat);
      datasets.push({ label: OG_PLATFORMS[k].label, color: OG_PLATFORMS[k].color, data: cats.map(c => (c === cat ? (latest[k].servers || 0) : 0)) });
    });
    // Re-pad every dataset to the final cats length (cats grew as we pushed).
    datasets.forEach(d => { while (d.data.length < cats.length) d.data.push(0); });
    stackedBar('an-games-servers', cats, datasets);

    // ── Servers over time across every platform ───────────────────────────
    drawAllPlatformLines('an-games-time', document.getElementById('an-note'),
      'Server count over time across every platform, blending hourly recordings with Internet-Archive history.', 'servers');
  }

  // ══ TAB: Embed ═══════════════════════════════════════════════════════════════
  // Lets anyone embed the live dashboard (the region from the "Is SA-MP dead?"
  // verdict through every tab) on their own site via an <iframe>. The iframe
  // loads THIS page with ?embed=dashboard, which strips the site chrome and shows
  // only #dashboard (see the EMBED block at the top + the .embed-mode CSS).
  // The snippet users COPY always points at the canonical public site, so embeds
  // load the real, deployed dashboard.
  function embedURL() {
    return 'https://mac-andreas.github.io/?embed=dashboard#dashboard';
  }
  // The local PREVIEW loads THIS exact page (so you see the current build, even on
  // file:// or a fork) — just with the embed flag added.
  function previewURL() {
    const u = new URL(location.href);
    u.searchParams.set('embed', 'dashboard');
    u.hash = 'dashboard';
    return u.toString();
  }
  function iframeSnippet(height) {
    const src = esc(embedURL());
    return `<iframe src="${src}" title="Mac-Andreas live SA-MP / open.mp dashboard" `
      + `width="100%" height="${height}" loading="lazy" `
      + `style="border:1px solid #2F3623;border-radius:8px;max-width:1100px;width:100%" `
      + `referrerpolicy="no-referrer-when-downgrade"></iframe>`;
  }

  function renderEmbed(el) {
    if (_rendered.has('embed')) return;
    const heights = { Compact: 720, Standard: 1000, Tall: 1400 };
    el.innerHTML = `
      <p class="dash-note">
        Put this <strong>live</strong> dashboard on your own site or forum. The embed shows
        everything from the <em>“Is SA-MP dead?”</em> verdict down through every tab — live
        open.mp + SA-MP data, refreshed in the visitor’s browser. Pick a height, copy the
        snippet, and paste it into any HTML page.
      </p>
      <div class="chart-panel">
        <div class="chart-toolbar"><h3>Embed <span class="dim">snippet</span> ${tip('Standard HTML <iframe>. It loads this dashboard in “embed” mode (no site header/footer). Width is responsive; choose a height that fits your layout.')}</h3></div>
        <div class="embed-options" id="embed-size-btns">
          ${Object.entries(heights).map(([k, v], i) => `<button class="btn-range${i === 1 ? ' active' : ''}" data-h="${v}">${k} <span class="dim">${v}px</span></button>`).join('')}
        </div>
        <textarea class="embed-snippet" id="embed-code" readonly spellcheck="false"></textarea>
        <div class="embed-copy-row">
          <button class="dash-select dl-btn" id="embed-copy">Copy snippet</button>
          <span class="embed-copied" id="embed-copied">Copied ✓</span>
          <a class="dash-select dl-btn" id="embed-open" target="_blank" rel="noopener">Open embed view ↗</a>
        </div>
      </div>
      <div class="chart-panel" style="margin-top:16px">
        <div class="chart-toolbar"><h3>Live <span class="dim">preview</span></h3></div>
        <iframe class="embed-preview-frame" id="embed-preview" title="Embed preview"></iframe>
      </div>`;

    const codeEl = el.querySelector('#embed-code');
    const preview = el.querySelector('#embed-preview');
    const openLink = el.querySelector('#embed-open');
    let height = heights.Standard;
    const refresh = () => {
      codeEl.value = iframeSnippet(height);
      preview.src = previewURL();   // preview the CURRENT build (local/fork-safe)
      openLink.href = previewURL();
    };
    refresh();

    el.querySelector('#embed-size-btns').addEventListener('click', (e) => {
      const b = e.target.closest('[data-h]'); if (!b) return;
      height = +b.dataset.h;
      el.querySelectorAll('#embed-size-btns .btn-range').forEach(x => x.classList.toggle('active', x === b));
      // Only the snippet height changes; the preview src is unaffected.
      codeEl.value = iframeSnippet(height);
    });
    el.querySelector('#embed-copy').addEventListener('click', async () => {
      codeEl.select();
      try { await navigator.clipboard.writeText(codeEl.value); }
      catch { document.execCommand('copy'); }
      const c = el.querySelector('#embed-copied');
      c.classList.add('show'); setTimeout(() => c.classList.remove('show'), 1600);
    });
    _rendered.add('embed');
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
      years: 'Live + 2018→present',
      provides: 'GTA V (RAGE:MP) server + player counts for cross-platform benchmarking.',
      process: 'Public master list (JSON), refreshed hourly. Historical points from Internet-Archive captures of the same master.',
    },
    {
      name: 'MTA:SA community',
      where: 'community.multitheftauto.com',
      years: 'Live + 2021→present',
      provides: 'MTA:SA (GTA San Andreas) live players + server count.',
      process: 'Public community servers page publishes a verified “N players online on M servers” total, read hourly; history from Internet-Archive captures. Falls back to the binary ASE master for a reliable server count.',
    },
    {
      name: 'game-state.com',
      where: 'game-state.com',
      years: 'Live + 2014→present',
      provides: 'VC:MP (GTA Vice City) live players + server count.',
      process: 'Public server browser; per-server player cells are summed across pages hourly. History from Internet-Archive captures.',
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
      <div class="live-banner">
        <div class="live-banner-status">
          <span class="live-dot" aria-hidden="true"></span>
          <span class="live-word">DASHBOARD · LIVE</span>
          <span class="live-sub" id="src-last-update">Last update: … <span class="dim">(updates hourly)</span></span>
        </div>
        <div class="dl-dropdown" id="dl-dropdown">
          <button type="button" class="dash-select dl-toggle" id="dl-toggle" aria-haspopup="true" aria-expanded="false">
            Download <span class="dl-caret" aria-hidden="true">▾</span>
          </button>
          <div class="dl-menu" id="dl-menu" role="menu" hidden>
            <button class="dl-item" role="menuitem" data-dl="live">Live servers <span class="dim">· CSV</span></button>
            <button class="dl-item" role="menuitem" data-dl="history">SA history <span class="dim">· CSV</span></button>
            <button class="dl-item" role="menuitem" data-dl="othergames">Cross-game history <span class="dim">· CSV</span></button>
            <button class="dl-item" role="menuitem" data-dl="json">Everything <span class="dim">· JSON</span></button>
          </div>
        </div>
      </div>
      <p class="dash-note">
        Where every figure on this dashboard comes from. Live numbers are read directly from
        public APIs in your browser each visit; we also ping the same APIs hourly (the fetcher)
        so the trend history grows over time. Historical numbers are reconstructed from snapshots
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
      </div>
      <div class="chart-panel" style="margin-top:16px">
        <h3>Legal <span class="dim">&amp; data usage</span></h3>
        <ul class="src-process">
          <li><strong>Public data only.</strong> Every figure comes from publicly available
            master lists / server browsers that these games and tools publish for exactly this
            purpose — listing live servers — or from the <strong>Internet Archive</strong>'s
            public captures of those same pages. No private, paywalled or authenticated source
            is used.</li>
          <li><strong>Aggregate counts, not personal data.</strong> Only aggregate totals are
            stored (player counts, server counts, gamemode/language tags, and a public
            IP-derived country for the map). No personal data about individual players is
            collected.</li>
          <li><strong>Light, infrequent, attributed access.</strong> Sources are read at most
            once an hour with a descriptive user-agent — well within normal, courteous use — and
            historical points come from the Internet Archive rather than by re-crawling the
            original sites.</li>
          <li><strong>Trademarks.</strong> SA-MP, open.mp, MTA, RAGE:MP, VC:MP and Grand Theft
            Auto belong to their respective owners. This dashboard is an independent,
            non-commercial community project, not affiliated with or endorsed by them.</li>
          <li><strong>Takedown.</strong> If you operate one of these sources and would like your
            data excluded, reach out via the project's GitHub and we'll remove it.</li>
        </ul>
      </div>`;

    // Last-update line: newest of the live snapshot + the history files.
    populateLastUpdate();

    // Download dropdown — toggle open/close; pick an item → export → close.
    const dd = el.querySelector('#dl-dropdown');
    const toggle = el.querySelector('#dl-toggle');
    const menu = el.querySelector('#dl-menu');
    const setOpen = (open) => { menu.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); dd.classList.toggle('open', open); };
    toggle.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dl]'); if (!b) return;
      handleDownload(b.dataset.dl); setOpen(false);
    });
    // Close on outside click / Escape.
    document.addEventListener('click', (e) => { if (!dd.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    _rendered.add('sources');
  }

  // "2 minutes ago" / "1 hour ago" style relative time.
  function relativeTime(ms) {
    const diff = Math.max(0, Date.now() - ms);
    const mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  function populateLastUpdate() {
    const elx = document.getElementById('src-last-update');
    if (!elx) return;
    const stamps = [];
    try { const c = JSON.parse(sessionStorage.getItem('ma_servers') || 'null'); if (c?.at) stamps.push(c.at); } catch {}
    Promise.all([
      fetch(HISTORY_URL, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('data/othergames-history.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([h, o]) => {
      [h?.updated_at, o?.updated_at].forEach(s => { const t = Date.parse(s); if (Number.isFinite(t)) stamps.push(t); });
      const newest = stamps.length ? Math.max(...stamps) : Date.now();
      const abs = new Date(newest).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      elx.innerHTML = `Last update: ${relativeTime(newest)} <span class="dim">(updates hourly)</span>`;
      elx.title = abs;
    });
  }

  // ── CSV / JSON export (client-side; no server) ──────────────────────────────
  const csvCell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCSV = (rows, cols) =>
    [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n');
  function downloadBlob(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  async function handleDownload(kind) {
    if (kind === 'live') {
      if (!_servers) return;
      const cols = ['name', 'players', 'max', 'fill_pct', 'gamemode', 'language', 'version', 'platform', 'country_ip', 'ip'];
      const rows = _servers.map(s => ({
        name: s.hn, players: s.pc || 0, max: s.pm || 0,
        fill_pct: pctOf(s.pc || 0, s.pm || 0),
        gamemode: s.gm, language: s.la, version: s.vn,
        platform: s.omp ? 'open.mp' : 'SA-MP', country_ip: '', ip: s.ip,
      }));
      return downloadBlob(`mac-andreas-live-servers-${stamp()}.csv`, toCSV(rows, cols), 'text/csv');
    }
    if (kind === 'history') {
      const h = await fetch(HISTORY_URL, { cache: 'no-cache' }).then(r => r.json()).catch(() => null);
      const pts = h?.points || [];
      const cols = ['date', 'total_players', 'total_servers', 'omp_players', 'omp_servers', 'samp_players', 'samp_servers', 'source', 'estimated'];
      const rows = pts.map(p => ({
        date: p.t, total_players: p.p, total_servers: p.s,
        omp_players: p.op, omp_servers: p.os, samp_players: p.sp, samp_servers: p.ss,
        source: p.source || 'recorder', estimated: p.est ? 'yes' : 'no',
      }));
      return downloadBlob(`mac-andreas-sa-history-${stamp()}.csv`, toCSV(rows, cols), 'text/csv');
    }
    if (kind === 'othergames') {
      const o = await fetch('data/othergames-history.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null);
      const pts = o?.points || [];
      const keys = [...new Set(pts.flatMap(p => Object.keys(p.sources || {})))];
      // Long format: one row per (date, platform) — friendliest for BI tools.
      const cols = ['date', 'platform', 'game', 'players', 'servers', 'maxslots'];
      const rows = [];
      pts.forEach(p => keys.forEach(k => {
        const v = p.sources?.[k]; if (!v) return;
        rows.push({ date: p.t, platform: OG_PLATFORMS[k]?.label || k, game: OG_PLATFORMS[k]?.game || '', players: v.players, servers: v.servers, maxslots: v.maxslots });
      }));
      return downloadBlob(`mac-andreas-crossgame-history-${stamp()}.csv`, toCSV(rows, cols), 'text/csv');
    }
    if (kind === 'json') {
      const [h, o] = await Promise.all([
        fetch(HISTORY_URL, { cache: 'no-cache' }).then(r => r.json()).catch(() => null),
        fetch('data/othergames-history.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null),
      ]);
      const bundle = { exported_at: new Date().toISOString(), live_servers: _servers || [], sa_history: h, crossgame_history: o };
      return downloadBlob(`mac-andreas-data-${stamp()}.json`, JSON.stringify(bundle, null, 2), 'application/json');
    }
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
