// ChartKit — the shared chart layer behind every #dashboard chart.
//
// site/servers.js builds the data; ChartKit draws it with Chart.js and gives
// EVERY chart the same controls:
//
//   • Customize (sliders icon) — sort; show/hide categories; line style (curve,
//     stroke, width, points, area fill); hover (date + time, crosshair); axes
//     (X top/bottom, Y left/right, show/hide labels incl. dates, axis titles,
//     grid lines, diagonal labels, weekday above the date); bar orientation and
//     value labels; doughnut legend; colours (theme preset, background, grid,
//     text, axis, and every line / bar / slice colour); reset.
//   • Export (download icon) — PNG with the chart background, or transparent.
//   • Time-series line charts also get type chips (click = show/hide,
//     Alt/⌥-click = only this one, hover = highlight that line) and a
//     date-range slider with 1D…All presets.
//
// Appearance prefs persist per chart in localStorage. The date window does not:
// each visit starts on the chart's default range (spec.range).
(() => {
  const STORE = 'ma_chartkit_v1';
  const HOUR = 3_600_000, DAY = 86_400_000;

  const THEMES = {
    site:     { label: 'Site (dark)', bg: '#1A1E15', grid: '#2F3623', text: '#EDE3C8', axis: '#98937A', accent: '#C9A86B' },
    midnight: { label: 'Midnight',    bg: '#0B1020', grid: '#1E293B', text: '#E2E8F0', axis: '#94A3B8', accent: '#FBBF24' },
    light:    { label: 'Light',       bg: '#FFFFFF', grid: '#E5E7EB', text: '#1F2937', axis: '#6B7280', accent: '#B45309' },
    paper:    { label: 'Paper',       bg: '#F5EFE0', grid: '#DDD3BC', text: '#2E2A1F', axis: '#6B634E', accent: '#8B5A1A' },
  };
  const TOOLTIP = {
    backgroundColor: '#0C0E0A', borderColor: '#3E3E4D', borderWidth: 1,
    titleColor: '#EDE3C8', bodyColor: '#C9A86B', footerColor: '#98937A', padding: 10,
  };

  const PRESETS = [
    { key: '1D', days: 1 }, { key: '1W', days: 7 }, { key: '1M', days: 30 }, { key: '3M', days: 91 },
    { key: '6M', days: 182 }, { key: '1Y', days: 365 }, { key: 'All', days: Infinity },
  ];

  const SORTS = {
    line: [['default', 'Default order'], ['latest-desc', 'Latest · high → low'], ['latest-asc', 'Latest · low → high'],
           ['peak-desc', 'Peak · high → low'], ['avg-desc', 'Average · high → low'],
           ['name-asc', 'Name · A → Z'], ['name-desc', 'Name · Z → A']],
    cat:  [['default', 'Default order'], ['value-desc', 'Value · high → low'], ['value-asc', 'Value · low → high'],
           ['name-asc', 'Name · A → Z'], ['name-desc', 'Name · Z → A']],
  };
  const sortsFor = (kind) => (kind === 'line' ? SORTS.line : SORTS.cat);

  const COMMON = {
    theme: 'site', bg: null, grid: null, text: null, axis: null, // null → theme value
    colors: {}, hidden: [], sort: 'default',
    xPos: 'bottom', yPos: 'left', xLabels: true, yLabels: true, gridLines: true, diagonal: false,
  };
  const KIND = {
    line:     { axisTitles: true, curve: 'smooth', stroke: 'solid', width: 2, points: false, fill: false,
                hoverTime: true, crosshair: true, weekday: false },
    bar:      { axisTitles: false, values: true, orient: 'auto' },
    stacked:  { axisTitles: false, values: true, orient: 'auto' },
    doughnut: { values: true, legend: 'right' },
  };

  const DL = window.ChartDataLabels || null;
  const recs = {};     // chart id → record
  let store = {};
  try { store = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { store = {}; }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch {} };

  const fmt = (n) => (Number.isFinite(+n) ? (+n).toLocaleString() : '—');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hex6 = (c, fb = '#3B82F6') => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : fb);

  // ── prefs ──────────────────────────────────────────────────────────────────
  function prefs(rec) {
    const p = { ...COMMON, ...KIND[rec.kind], ...(rec.spec.defaults || {}), ...(store[rec.id] || {}) };
    if (!sortsFor(rec.kind).some(([v]) => v === p.sort)) p.sort = 'default';
    if (!THEMES[p.theme]) p.theme = 'site';
    if (!Array.isArray(p.hidden)) p.hidden = [];
    if (!p.colors || typeof p.colors !== 'object') p.colors = {};
    return p;
  }
  function setPref(rec, key, val) { (store[rec.id] ||= {})[key] = val; save(); }
  function delPref(rec, key) { if (store[rec.id]) { delete store[rec.id][key]; save(); } }
  function themeOf(p) {
    const T = THEMES[p.theme] || THEMES.site;
    return { bg: hex6(p.bg, T.bg), grid: hex6(p.grid, T.grid), text: hex6(p.text, T.text), axis: hex6(p.axis, T.axis), accent: T.accent };
  }
  const colorOf = (p, key, fallback) => hex6(p.colors[key], hex6(fallback));

  // ── time helpers ───────────────────────────────────────────────────────────
  const STEPS = [
    { u: 'hour', n: 1 }, { u: 'hour', n: 3 }, { u: 'hour', n: 6 }, { u: 'hour', n: 12 },
    { u: 'day', n: 1 }, { u: 'day', n: 2 }, { u: 'week', n: 1 }, { u: 'week', n: 2 },
    { u: 'month', n: 1 }, { u: 'month', n: 2 }, { u: 'month', n: 3 }, { u: 'month', n: 6 },
    { u: 'year', n: 1 }, { u: 'year', n: 2 }, { u: 'year', n: 5 }, { u: 'year', n: 10 },
  ];
  const stepMs = (s) => s.n * ({ hour: HOUR, day: DAY, week: 7 * DAY, month: 30.44 * DAY, year: 365.25 * DAY }[s.u]);

  // Calendar-aligned ticks (local time) for a [min,max] ms window: hours, days,
  // Mondays, month starts or years — whichever gives ≤ `target` ticks.
  function timeTicks(min, max, target = 8) {
    if (!(max > min)) return { unit: 'day', ticks: [min] };
    const st = STEPS.find(s => (max - min) / stepMs(s) <= target) || STEPS[STEPS.length - 1];
    const d = new Date(min), ticks = [];
    const push = () => { const t = +d; if (t >= min && t <= max) ticks.push(t); };
    if (st.u === 'hour') {
      d.setMinutes(0, 0, 0); d.setHours(d.getHours() - (d.getHours() % st.n));
      for (; +d <= max; d.setHours(d.getHours() + st.n)) push();
    } else if (st.u === 'day' || st.u === 'week') {
      d.setHours(0, 0, 0, 0);
      if (st.u === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
      const days = st.u === 'week' ? 7 * st.n : st.n;
      for (; +d <= max; d.setDate(d.getDate() + days)) push();
    } else if (st.u === 'month') {
      d.setHours(0, 0, 0, 0); d.setDate(1); d.setMonth(d.getMonth() - (d.getMonth() % st.n));
      for (; +d <= max; d.setMonth(d.getMonth() + st.n)) push();
    } else {
      d.setHours(0, 0, 0, 0); d.setMonth(0, 1); d.setFullYear(d.getFullYear() - (d.getFullYear() % st.n));
      for (; +d <= max; d.setFullYear(d.getFullYear() + st.n)) push();
    }
    if (!ticks.length) ticks.push(min);
    return { unit: st.u, ticks };
  }

  // Tick text. `weekday` puts the day name on its own line ABOVE the date.
  function tickLabel(v, unit, weekday) {
    const d = new Date(v);
    const wd = d.toLocaleDateString('en-GB', { weekday: 'short' });
    const dm = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (unit === 'hour') {
      const main = `${dm} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
      return weekday ? [wd, main] : main;
    }
    if (unit === 'day' || unit === 'week') {
      const main = `${dm} ${d.getFullYear()}`;
      return weekday ? [wd, main] : main;
    }
    if (unit === 'month') return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    return String(d.getFullYear());
  }

  function fmtWhen(ms, withTime) {
    const d = new Date(ms);
    const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (!withTime) return date;
    return `${date} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`;
  }
  const fmtDay = (ms, withTime) => {
    const d = new Date(ms);
    const s = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return withTime ? `${s} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : s;
  };

  // ── plugins ────────────────────────────────────────────────────────────────
  // Paints the chart background (omitted for transparent exports).
  const bgPlugin = {
    id: 'ckBg',
    beforeDraw(chart, _a, o) {
      if (!o || !o.color) return;
      const { ctx, width, height } = chart;
      ctx.save(); ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = o.color; ctx.fillRect(0, 0, width, height); ctx.restore();
    },
  };
  // Fades every dataset except the focused one (chip hover / nearest line).
  let _faded = false;
  const focusPlugin = {
    id: 'ckFocus',
    beforeDatasetDraw(chart, args) {
      const f = chart.$ck && chart.$ck.focus;
      const ds = chart.data.datasets[args.index];
      if (f != null && ds && ds.ckKey !== f) { chart.ctx.save(); chart.ctx.globalAlpha = 0.14; _faded = true; }
    },
    afterDatasetDraw(chart) { if (_faded) { chart.ctx.restore(); _faded = false; } },
  };
  // Vertical hover guide at the active x position.
  const crossPlugin = {
    id: 'ckCross',
    afterDatasetsDraw(chart, _a, o) {
      if (!o || !o.enabled) return;
      const act = chart.tooltip && chart.tooltip.getActiveElements();
      if (!act || !act.length) return;
      const x = act[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
      ctx.save(); ctx.strokeStyle = o.color; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
    },
  };
  const PLUGINS = [bgPlugin, focusPlugin, crossPlugin].concat(DL ? [DL] : []);

  // ── config builders ────────────────────────────────────────────────────────
  const axisTitle = (p, th, text) => ({
    display: !!(p.axisTitles && text), text: text || '', color: th.axis,
    font: { size: 11, weight: '600', style: 'italic' },
  });
  const base = (th, exp) => ({
    responsive: true, maintainAspectRatio: false, devicePixelRatio: null,
    animation: { duration: 350 },
    plugins: {
      legend: { display: false },
      tooltip: { ...TOOLTIP },
      ckBg: { color: exp && !exp.withBg ? null : th.bg },
      ckCross: { enabled: false },
      datalabels: { display: false },
    },
  });

  // Window [lo, hi] (indices into rec.axis) for the current range state.
  function windowIdx(rec) {
    const ax = rec.axis, last = ax.length - 1;
    if (last < 0) return { lo: 0, hi: -1 };
    let lo = 0, hi = last;
    const r = rec.range || { preset: 'All' };
    if (r.preset) {
      const pr = PRESETS.find(x => x.key === r.preset);
      if (pr && Number.isFinite(pr.days)) lo = ax.findIndex(t => t >= ax[last] - pr.days * DAY);
    } else {
      lo = ax.findIndex(t => t >= r.from);
      while (hi > 0 && ax[hi] > r.to) hi--;
    }
    if (lo < 0) lo = 0;
    if (hi - lo < 1) lo = Math.max(0, hi - 1); // always ≥ 2 points when there are 2
    return { lo, hi };
  }

  function seriesStats(rec, win) {
    const out = {};
    rec.spec.series.forEach(se => {
      let latest = null, peak = null, sum = 0, n = 0;
      for (const t of win) {
        const pt = se.map.get(t); if (!pt) continue;
        latest = pt.y; peak = peak == null ? pt.y : Math.max(peak, pt.y); sum += pt.y; n++;
      }
      out[se.key] = { latest, peak, avg: n ? sum / n : null };
    });
    return out;
  }
  function orderSeries(rec, p, stats) {
    const list = rec.spec.series.slice();
    const [k, dir] = p.sort.split('-');
    if (k === 'name') list.sort((a, b) => a.label.localeCompare(b.label) * (dir === 'desc' ? -1 : 1));
    else if (k === 'latest' || k === 'peak' || k === 'avg') {
      const v = (s) => stats[s.key][k] ?? -1;
      list.sort((a, b) => (v(a) - v(b)) * (dir === 'asc' ? 1 : -1));
    }
    return list;
  }
  function sortRows(rows, sort) {
    const [k, dir] = sort.split('-');
    if (k === 'value') return rows.slice().sort((a, b) => (a.value - b.value) * (dir === 'asc' ? 1 : -1));
    if (k === 'name') return rows.slice().sort((a, b) => String(a.label).localeCompare(String(b.label)) * (dir === 'desc' ? -1 : 1));
    return rows;
  }
  function tipSorter(p) {
    const [k, dir] = p.sort.split('-');
    if (k === 'name') return (a, b) => a.dataset.label.localeCompare(b.dataset.label) * (dir === 'desc' ? -1 : 1);
    if (k === 'latest' || k === 'peak' || k === 'avg') return (a, b) => (b.parsed.y - a.parsed.y) * (dir === 'asc' ? -1 : 1);
    return (a, b) => a.datasetIndex - b.datasetIndex;
  }
  const isHoriz = (rec, p) => (p.orient === 'h' ? true : p.orient === 'v' ? false : !!rec.spec.horizontal);

  function buildLine(rec, p, th, exp) {
    const s = rec.spec;
    const { lo, hi } = windowIdx(rec);
    const win = rec.axis.slice(lo, hi + 1);
    const minT = win[0], maxT = win[win.length - 1];
    const stats = seriesStats(rec, win);
    const visible = orderSeries(rec, p, stats).filter(se => !p.hidden.includes(se.key));
    const w = Math.max(1, Math.min(5, +p.width || 2));
    const dash = p.stroke === 'dashed' ? [w * 3, w * 2] : p.stroke === 'dotted' ? [0.5, w * 2.2] : [];
    const datasets = visible.map(se => {
      const col = colorOf(p, se.key, se.color);
      return {
        ckKey: se.key, label: se.label,
        data: win.map(t => { const pt = se.map.get(t); return { x: t, y: pt ? pt.y : null, est: !!(pt && pt.est) }; }),
        borderColor: col, backgroundColor: col + '22', pointBackgroundColor: col, pointBorderColor: col,
        borderWidth: w, borderDash: dash, borderCapStyle: p.stroke === 'dotted' ? 'round' : 'butt',
        tension: p.curve === 'smooth' ? 0.3 : 0,
        cubicInterpolationMode: p.curve === 'smooth' ? 'monotone' : 'default',
        stepped: p.curve === 'stepped' ? 'before' : false,
        pointRadius: p.points ? Math.max(2, w) : 0, pointHoverRadius: w + 3,
        fill: p.fill ? 'origin' : false, spanGaps: true,
        // Estimated points (pre-archive backbone) draw dashed.
        segment: { borderDash: (c) => (c.chart.data.datasets[c.datasetIndex]?.data[c.p0DataIndex]?.est ? [5, 4] : undefined) },
      };
    });
    const tt = timeTicks(minT, maxT);
    const o = base(th, exp);
    o.layout = { padding: { top: 6, right: 10, bottom: 2, left: 2 } };
    o.interaction = { mode: 'index', intersect: false };
    o.plugins.ckCross = { enabled: !!p.crosshair && !exp, color: th.axis };
    o.plugins.tooltip = {
      ...TOOLTIP, mode: 'index', intersect: false,
      filter: (it) => it.parsed.y != null,
      itemSort: tipSorter(p),
      callbacks: {
        title: (items) => (items.length ? fmtWhen(items[0].parsed.x, p.hoverTime) : ''),
        label: (it) => ` ${it.dataset.label}: ${fmt(it.parsed.y)}${it.raw && it.raw.est ? ' (est.)' : ''}`,
      },
    };
    o.scales = {
      x: {
        type: 'linear', position: p.xPos, min: minT, max: maxT,
        afterBuildTicks: (sc) => { sc.ticks = tt.ticks.map(value => ({ value })); },
        ticks: {
          display: !!p.xLabels, color: th.axis, font: { size: 10 }, autoSkip: true, autoSkipPadding: 12,
          maxRotation: p.diagonal ? 45 : 0, minRotation: p.diagonal ? 45 : 0,
          callback: (v) => tickLabel(v, tt.unit, p.weekday),
        },
        grid: { display: !!p.gridLines, color: th.grid }, border: { color: th.grid },
        title: axisTitle(p, th, s.xLabel ?? 'Date'),
      },
      y: {
        position: p.yPos, beginAtZero: true,
        ticks: { display: !!p.yLabels, color: th.axis, font: { size: 11 }, precision: 0, callback: (v) => fmt(v) },
        grid: { display: !!p.gridLines, color: th.grid }, border: { color: th.grid },
        title: axisTitle(p, th, s.yLabel),
      },
    };
    o.onHover = (evt, _els, chart) => {
      if (rec.chipFocus != null) return;
      let key = null;
      if (chart.data.datasets.length > 1) {
        const near = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false, axis: 'xy' }, false)[0];
        if (near && Math.abs(near.element.y - evt.y) < 14) key = chart.data.datasets[near.datasetIndex]?.ckKey ?? null;
      }
      if (key !== rec.focus) { rec.focus = key; chart.draw(); }
    };
    if (exp && datasets.length > 1) {
      o.plugins.legend = { display: true, position: 'top', labels: { color: th.text, font: { size: 12 }, usePointStyle: true, pointStyle: 'line', padding: 14 } };
    }
    rec.view = { lo, hi, minT, maxT, stats };
    return { type: 'line', data: { datasets }, options: o, plugins: PLUGINS, _struct: 'line' };
  }

  function buildBar(rec, p, th, exp) {
    const s = rec.spec, H = isHoriz(rec, p);
    const arr = Array.isArray(s.colors) ? s.colors : null;
    let rows = s.labels.map((l, i) => ({
      key: String(l), label: l, value: +s.values[i] || 0,
      color: arr ? colorOf(p, String(l), arr[i % arr.length]) : colorOf(p, '__bar', s.colors),
    }));
    rec.allRows = rows;
    rows = sortRows(rows.filter(r => !p.hidden.includes(r.key)), p.sort);
    const cat = H ? 'y' : 'x', val = H ? 'x' : 'y';
    const o = base(th, exp);
    o.indexAxis = H ? 'y' : 'x';
    o.layout = { padding: H ? { right: p.values ? 40 : 8 } : { top: p.values ? 22 : 6 } };
    o.scales = {
      [cat]: {
        ticks: {
          display: !!(cat === 'x' ? p.xLabels : p.yLabels), color: th.text, font: { size: 11 },
          autoSkip: !H, maxRotation: !H ? (p.diagonal ? 45 : 50) : 0, minRotation: !H && p.diagonal ? 45 : 0,
        },
        grid: { display: false }, border: { color: th.grid },
        title: axisTitle(p, th, s.categoryTitle),
      },
      [val]: {
        beginAtZero: true,
        ticks: { display: !!(val === 'x' ? p.xLabels : p.yLabels), color: th.axis, font: { size: 11 }, precision: 0, callback: (v) => fmt(v) },
        grid: { display: !!p.gridLines, color: th.grid }, border: { color: th.grid },
        title: axisTitle(p, th, s.valueTitle),
      },
    };
    o.scales.x.position = p.xPos; o.scales.y.position = p.yPos;
    o.plugins.datalabels = DL && p.values ? {
      anchor: 'end', align: H ? 'right' : 'top', clamp: true, color: th.text, font: { size: 10, weight: '600' },
      formatter: (v) => (s.valueFormat ? s.valueFormat(v) : fmt(v)),
    } : { display: false };
    return {
      type: 'bar',
      data: {
        labels: rows.map(r => r.label),
        datasets: [{
          label: s.valueTitle || 'Value', data: rows.map(r => r.value),
          backgroundColor: rows.map(r => r.color + '99'), borderColor: rows.map(r => r.color), borderWidth: 1, borderRadius: 2,
        }],
      },
      options: o, plugins: PLUGINS, _struct: `bar:${H}`,
    };
  }

  function buildStacked(rec, p, th, exp) {
    const s = rec.spec, H = isHoriz(rec, p);
    const sets = s.datasets.filter(d => !p.hidden.includes(d.key));
    const total = (i) => sets.reduce((a, d) => a + (+d.data[i] || 0), 0);
    let idx = s.labels.map((_, i) => i).filter(i => total(i) > 0);
    const [k, dir] = p.sort.split('-');
    if (k === 'value') idx.sort((a, b) => (total(a) - total(b)) * (dir === 'asc' ? 1 : -1));
    if (k === 'name') idx.sort((a, b) => String(s.labels[a]).localeCompare(String(s.labels[b])) * (dir === 'desc' ? -1 : 1));
    const rowTotals = idx.map(total);
    const datasets = sets.map(d => {
      const col = colorOf(p, d.key, d.color);
      return { ckKey: d.key, label: d.label, data: idx.map(i => +d.data[i] || 0), backgroundColor: col + 'CC', borderColor: col, borderWidth: 1, borderRadius: 2 };
    });
    const lastIdx = datasets.length - 1;
    const cat = H ? 'y' : 'x', val = H ? 'x' : 'y';
    const o = base(th, exp);
    o.indexAxis = H ? 'y' : 'x';
    o.layout = { padding: H ? { right: p.values ? 64 : 8 } : { top: p.values ? 24 : 6 } };
    o.scales = {
      [val]: {
        stacked: true, beginAtZero: true,
        ticks: { display: !!(val === 'x' ? p.xLabels : p.yLabels), color: th.axis, font: { size: 11 }, precision: 0, callback: (v) => fmt(v) },
        grid: { display: !!p.gridLines, color: th.grid }, border: { color: th.grid },
        title: axisTitle(p, th, s.valueTitle),
      },
      [cat]: {
        stacked: true,
        ticks: { display: !!(cat === 'x' ? p.xLabels : p.yLabels), color: th.text, font: { size: 11 }, maxRotation: !H && p.diagonal ? 45 : 0, minRotation: !H && p.diagonal ? 45 : 0 },
        grid: { display: false }, border: { color: th.grid },
        title: axisTitle(p, th, s.categoryTitle),
      },
    };
    o.scales.x.position = p.xPos; o.scales.y.position = p.yPos;
    o.plugins.tooltip = { ...TOOLTIP, filter: (it) => (it.parsed[val] || 0) > 0 };
    o.plugins.datalabels = DL && p.values ? {
      labels: {
        value: { color: th.text, font: { size: 10, weight: '600' }, anchor: 'center', align: 'center', formatter: (v) => (v > 0 ? fmt(v) : '') },
        total: {
          anchor: 'end', align: 'end', offset: 6, clamp: true, color: th.accent, font: { size: 11, weight: '700' },
          formatter: (_v, c) => (c.datasetIndex === lastIdx ? fmt(rowTotals[c.dataIndex]) : ''),
        },
      },
    } : { display: false };
    if (exp && datasets.length > 1) {
      o.plugins.legend = { display: true, position: 'top', labels: { color: th.text, font: { size: 12 }, boxWidth: 12, padding: 12 } };
    }
    return { type: 'bar', data: { labels: idx.map(i => s.labels[i]), datasets }, options: o, plugins: PLUGINS, _struct: `stacked:${H}` };
  }

  function buildDoughnut(rec, p, th, exp) {
    const s = rec.spec, colors = Array.isArray(s.colors) ? s.colors : [s.colors];
    let rows = s.labels.map((l, i) => ({ key: String(l), label: l, value: +s.values[i] || 0, color: colorOf(p, String(l), colors[i % colors.length]) }));
    rec.allRows = rows;
    rows = sortRows(rows.filter(r => !p.hidden.includes(r.key)), p.sort);
    const pct = (v, all) => { const t = all.reduce((a, b) => a + b, 0); return t ? Math.round(v / t * 100) : 0; };
    const o = base(th, exp);
    o.cutout = '56%';
    o.layout = { padding: s.outside ? 30 : 4 };
    o.plugins.legend = {
      display: p.legend !== 'hidden', position: p.legend === 'hidden' ? 'right' : p.legend,
      labels: { color: th.text, font: { size: 11 }, padding: 9, boxWidth: 12 },
    };
    o.plugins.tooltip = { ...TOOLTIP, callbacks: { label: (c) => `${c.label}: ${fmt(c.parsed)} (${pct(c.parsed, c.dataset.data)}%)` } };
    o.plugins.datalabels = DL && p.values && s.showValues !== false ? {
      color: s.outside ? th.text : '#0C0E0A', anchor: s.outside ? 'end' : 'center', align: s.outside ? 'end' : 'center',
      offset: s.outside ? 8 : 0, clamp: true, font: { size: s.outside ? 11 : 10, weight: '700' },
      formatter: (v, c) => { const q = pct(v, c.dataset.data); return s.outside ? `${fmt(v)} (${q}%)` : (q >= 6 ? fmt(v) : ''); },
    } : { display: false };
    return {
      type: 'doughnut',
      data: {
        labels: rows.map(r => r.label),
        datasets: [{ data: rows.map(r => r.value), backgroundColor: rows.map(r => r.color + 'CC'), borderColor: rows.map(r => r.color), borderWidth: 1, hoverOffset: 6 }],
      },
      options: o, plugins: PLUGINS, _struct: 'doughnut',
    };
  }

  function build(rec, p, exp) {
    const th = themeOf(p);
    if (rec.kind === 'line') return buildLine(rec, p, th, exp);
    if (rec.kind === 'stacked') return buildStacked(rec, p, th, exp);
    if (rec.kind === 'doughnut') return buildDoughnut(rec, p, th, exp);
    return buildBar(rec, p, th, exp);
  }

  // ── render ─────────────────────────────────────────────────────────────────
  function render(rec, mode = 'none') {
    const p = prefs(rec);
    const cfg = build(rec, p, null);
    const struct = cfg._struct; delete cfg._struct;
    if (rec.chart && rec.struct === struct) {
      rec.chart.data = cfg.data;
      rec.chart.options = cfg.options;
      rec.chart.update(mode);
    } else {
      if (rec.chart) rec.chart.destroy();
      rec.chart = new Chart(rec.canvas.getContext('2d'), cfg);
      rec.chart.$ck = rec;
      rec.struct = struct;
    }
    syncUI(rec, p);
  }
  // Coalesce bursts (slider drags, colour-picker drags) into one frame.
  function schedule(rec) {
    if (rec.raf) return;
    rec.raf = requestAnimationFrame(() => { rec.raf = 0; if (recs[rec.id] === rec) render(rec); });
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  const ICON_CUSTOMIZE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2.2" fill="currentColor"/><circle cx="15" cy="12" r="2.2" fill="currentColor"/><circle cx="7" cy="18" r="2.2" fill="currentColor"/></svg>';
  const ICON_EXPORT = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>';

  let openPop = null, openMenu = null;
  function closePop() {
    if (!openPop) return;
    openPop.ui.pop.hidden = true;
    openPop.ui.custBtn.setAttribute('aria-expanded', 'false');
    openPop = null;
  }
  function closeMenu() {
    if (!openMenu) return;
    openMenu.ui.menu.hidden = true;
    openMenu.ui.expBtn.setAttribute('aria-expanded', 'false');
    openMenu = null;
  }
  document.addEventListener('click', (e) => {
    if (openPop && !openPop.ui.pop.contains(e.target) && !openPop.ui.custBtn.contains(e.target)) closePop();
    if (openMenu && !openMenu.ui.dd.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePop(); closeMenu(); } });

  function ensureUI(rec) {
    const wrap = rec.canvas.closest('.canvas-wrap') || rec.canvas.parentElement;
    const panel = rec.canvas.closest('.chart-panel') || wrap.parentElement;
    if (rec.ui && rec.ui.wrap === wrap && rec.ui.actions.isConnected) return;
    const ui = rec.ui = { wrap, panel };
    panel.classList.add('ck-panel');

    const actions = ui.actions = document.createElement('div');
    actions.className = 'ck-actions';
    actions.innerHTML = `
      <button type="button" class="ck-btn" data-ck="customize" aria-haspopup="dialog" aria-expanded="false" title="Customize chart" aria-label="Customize chart">${ICON_CUSTOMIZE}</button>
      <div class="ck-dd">
        <button type="button" class="ck-btn" data-ck="export" aria-haspopup="menu" aria-expanded="false" title="Export chart" aria-label="Export chart">${ICON_EXPORT}</button>
        <div class="ck-menu" role="menu" hidden>
          <button type="button" class="ck-item" role="menuitem" data-export="bg">PNG <span class="dim">· with background</span></button>
          <button type="button" class="ck-item" role="menuitem" data-export="clear">PNG <span class="dim">· transparent</span></button>
        </div>
      </div>`;
    panel.appendChild(actions);
    ui.custBtn = actions.querySelector('[data-ck="customize"]');
    ui.expBtn = actions.querySelector('[data-ck="export"]');
    ui.dd = actions.querySelector('.ck-dd');
    ui.menu = actions.querySelector('.ck-menu');
    ui.custBtn.addEventListener('click', (e) => { e.stopPropagation(); openPop === rec ? closePop() : showPop(rec); });
    ui.expBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openMenu === rec) return closeMenu();
      closeMenu(); ui.menu.hidden = false; ui.expBtn.setAttribute('aria-expanded', 'true'); openMenu = rec;
    });
    ui.menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-export]'); if (!b) return;
      closeMenu(); exportPNG(rec, b.dataset.export === 'bg');
    });

    const pop = ui.pop = document.createElement('div');
    pop.className = 'ck-pop'; pop.hidden = true;
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Customize chart');
    panel.appendChild(pop);
    const onPop = (e) => onPopInput(rec, e);
    pop.addEventListener('input', onPop);
    pop.addEventListener('change', onPop);
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ck]'); if (!b) return;
      if (b.dataset.ck === 'reset') { delete store[rec.id]; save(); render(rec); fillPop(rec); }
      if (b.dataset.ck === 'close') closePop();
    });

    // Type chips (line + stacked): click = show/hide, Alt-click = only this,
    // hover = highlight that series.
    if (rec.kind === 'line' || rec.kind === 'stacked') {
      const chips = ui.chips = document.createElement('div');
      chips.className = 'ck-chips';
      chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Show or hide types');
      wrap.before(chips);
      chips.addEventListener('click', (e) => {
        const c = e.target.closest('.ck-chip'); if (!c) return;
        const keys = seriesKeys(rec);
        let hidden = new Set(prefs(rec).hidden);
        if (c.dataset.all != null) hidden = new Set();
        else if (e.altKey) hidden = new Set(keys.filter(k => k !== c.dataset.key));
        else hidden.has(c.dataset.key) ? hidden.delete(c.dataset.key) : hidden.add(c.dataset.key);
        setPref(rec, 'hidden', [...hidden]);
        rec.chipFocus = null; rec.focus = null;
        render(rec);
      });
      const setFocus = (key) => {
        if (rec.chipFocus === key) return;
        rec.chipFocus = key; rec.focus = key;
        if (rec.chart) rec.chart.draw();
      };
      chips.addEventListener('pointerover', (e) => { const c = e.target.closest('.ck-chip[data-key]'); setFocus(c && c.getAttribute('aria-pressed') === 'true' ? c.dataset.key : null); });
      chips.addEventListener('pointerleave', () => setFocus(null));
      chips.addEventListener('focusin', (e) => { const c = e.target.closest('.ck-chip[data-key]'); if (c) setFocus(c.dataset.key); });
      chips.addEventListener('focusout', () => setFocus(null));
    }

    // Date range (line): presets + dual-handle slider over the data points.
    if (rec.kind === 'line') {
      const rg = ui.range = document.createElement('div');
      rg.className = 'ck-range';
      rg.innerHTML = `
        <div class="ck-presets" role="group" aria-label="Date range presets">
          ${PRESETS.map(pr => `<button type="button" class="ck-preset" data-preset="${pr.key}">${pr.key}</button>`).join('')}
        </div>
        <div class="ck-slider">
          <div class="ck-track"><div class="ck-fill"></div></div>
          <input type="range" class="ck-lo" min="0" max="1" step="1" value="0" aria-label="Range start">
          <input type="range" class="ck-hi" min="0" max="1" step="1" value="1" aria-label="Range end">
        </div>
        <div class="ck-range-label" aria-live="polite"></div>`;
      wrap.before(rg);
      ui.lo = rg.querySelector('.ck-lo'); ui.hi = rg.querySelector('.ck-hi');
      ui.fill = rg.querySelector('.ck-fill'); ui.rlabel = rg.querySelector('.ck-range-label');
      rg.querySelector('.ck-presets').addEventListener('click', (e) => {
        const b = e.target.closest('[data-preset]'); if (!b) return;
        rec.range = { preset: b.dataset.preset }; render(rec);
      });
      const slide = (which) => {
        const max = rec.axis.length - 1; if (max < 1) return;
        let a = +ui.lo.value, b = +ui.hi.value;
        if (a > b - 1) { if (which === 'lo') a = Math.max(0, b - 1); else b = Math.min(max, a + 1); }
        if (b - a < 1) { a = Math.max(0, b - 1); b = a + 1; }
        ui.lo.value = a; ui.hi.value = b;
        rec.range = { from: rec.axis[a], to: rec.axis[b] };
        schedule(rec);
      };
      ui.lo.addEventListener('input', () => slide('lo'));
      ui.hi.addEventListener('input', () => slide('hi'));
    }

    rec.canvas.addEventListener('mouseleave', () => {
      if (rec.chipFocus == null && rec.focus != null) { rec.focus = null; if (rec.chart) rec.chart.draw(); }
    });
  }

  function seriesKeys(rec) {
    if (rec.kind === 'line') return rec.spec.series.map(s => s.key);
    if (rec.kind === 'stacked') return rec.spec.datasets.map(d => d.key);
    return [];
  }

  function syncUI(rec, p) {
    const ui = rec.ui; if (!ui) return;
    if (ui.chips) {
      let items = [];
      if (rec.kind === 'line') {
        const stats = rec.view.stats, k = p.sort.split('-')[0];
        const stat = (k === 'peak' || k === 'avg') ? k : 'latest';
        items = orderSeries(rec, p, stats).map(se => ({ key: se.key, label: se.label, color: colorOf(p, se.key, se.color), value: stats[se.key][stat] }));
      } else {
        items = rec.spec.datasets.map(d => ({ key: d.key, label: d.label, color: colorOf(p, d.key, d.color), value: d.data.reduce((a, v) => a + (+v || 0), 0) }));
      }
      const anyHidden = items.some(it => p.hidden.includes(it.key));
      ui.chips.hidden = items.length < 2;
      ui.chips.innerHTML = items.map(it => {
        const on = !p.hidden.includes(it.key);
        return `<button type="button" class="ck-chip" data-key="${esc(it.key)}" aria-pressed="${on}" title="Click to show/hide · Alt/⌥-click to show only this">`
          + `<i style="--c:${it.color}"></i><span>${esc(it.label)}</span><b>${it.value == null ? '—' : fmt(Math.round(it.value))}</b></button>`;
      }).join('') + (anyHidden ? '<button type="button" class="ck-chip ck-chip-all" data-all>Show all</button>' : '');
    }
    if (ui.range) {
      const n = rec.axis.length, max = Math.max(1, n - 1);
      const { lo, hi } = rec.view;
      ui.lo.max = ui.hi.max = String(max);
      ui.lo.value = String(lo); ui.hi.value = String(Math.max(hi, 0));
      ui.lo.disabled = ui.hi.disabled = n < 3;
      ui.lo.style.zIndex = lo >= max - 1 ? '4' : '2';
      ui.fill.style.left = `${(lo / max) * 100}%`;
      ui.fill.style.right = `${100 - (Math.max(hi, 0) / max) * 100}%`;
      ui.range.querySelectorAll('.ck-preset').forEach(b => b.classList.toggle('active', !!(rec.range && rec.range.preset === b.dataset.preset)));
      if (n >= 1 && hi >= 0) {
        const span = rec.view.maxT - rec.view.minT;
        const short = span < 3 * DAY;
        const len = span < 2 * DAY ? `${Math.max(1, Math.round(span / HOUR))} h` : `${fmt(Math.round(span / DAY))} days`;
        ui.rlabel.textContent = `${fmtDay(rec.view.minT, short)} → ${fmtDay(rec.view.maxT, short)} · ${len} · ${fmt(hi - lo + 1)} points`;
      } else ui.rlabel.textContent = 'No data yet';
    }
  }

  // ── Customize popover ──────────────────────────────────────────────────────
  function showPop(rec) {
    closePop(); closeMenu();
    fillPop(rec);
    rec.ui.pop.hidden = false;
    rec.ui.custBtn.setAttribute('aria-expanded', 'true');
    openPop = rec;
  }

  function fillPop(rec) {
    const p = prefs(rec), th = themeOf(p), k = rec.kind;
    const sel = (key, label, opts, wide) => `<label class="ck-f${wide ? ' ck-wide' : ''}"><span>${label}</span><select data-pref="${key}">`
      + opts.map(([v, l]) => `<option value="${esc(v)}"${String(p[key]) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('') + '</select></label>';
    const chk = (key, label) => `<label class="ck-f ck-chk"><input type="checkbox" data-pref="${key}"${p[key] ? ' checked' : ''}><span>${label}</span></label>`;
    const col = (attr, label, value) => `<label class="ck-f ck-col"><input type="color" ${attr} value="${hex6(value)}"><span>${esc(label)}</span></label>`;
    const sec = (title, body) => `<fieldset class="ck-sec"><legend>${title}</legend>${body}</fieldset>`;

    // Data
    let data = sel('sort', 'Sort', sortsFor(k), true);
    if (k === 'bar' || k === 'doughnut') {
      const rows = rec.allRows || [];
      if (rows.length) {
        data += `<div class="ck-f ck-wide"><span>Show categories</span><div class="ck-list">`
          + rows.map(r => `<label class="ck-chk"><input type="checkbox" data-hide="${esc(r.key)}"${p.hidden.includes(r.key) ? '' : ' checked'}><i style="--c:${r.color}"></i><span>${esc(r.label)}</span></label>`).join('')
          + '</div></div>';
      }
    }
    let html = `<div class="ck-pop-head"><strong>Customize</strong><button type="button" class="ck-x" data-ck="close" aria-label="Close">×</button></div>`;
    html += sec('Data', data);

    if (k === 'line') {
      html += sec('Lines',
        sel('curve', 'Line type', [['smooth', 'Smooth'], ['straight', 'Straight'], ['stepped', 'Stepped']])
        + sel('stroke', 'Stroke', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']])
        + `<label class="ck-f ck-wide"><span>Width · <b class="ck-wv">${p.width}px</b></span><input type="range" data-pref="width" min="1" max="5" step="0.5" value="${p.width}"></label>`
        + chk('points', 'Show points') + chk('fill', 'Fill area'));
      html += sec('Hover', chk('hoverTime', 'Date + time') + chk('crosshair', 'Crosshair'));
    }
    if (k === 'bar' || k === 'stacked') {
      html += sec('Bars',
        sel('orient', 'Orientation', [['auto', 'Default'], ['h', 'Horizontal'], ['v', 'Vertical']])
        + chk('values', 'Value labels'));
    }
    if (k === 'doughnut') {
      html += sec('Labels',
        sel('legend', 'Legend', [['right', 'Right'], ['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left'], ['hidden', 'Hidden']])
        + chk('values', 'Value labels'));
    }
    if (k !== 'doughnut') {
      html += sec('Axes',
        sel('xPos', 'X axis', [['bottom', 'Bottom'], ['top', 'Top']])
        + sel('yPos', 'Y axis', [['left', 'Left'], ['right', 'Right']])
        + chk('xLabels', k === 'line' ? 'Show dates' : 'X labels')
        + chk('yLabels', 'Y labels')
        + chk('axisTitles', 'Axis titles')
        + chk('gridLines', 'Grid lines')
        + chk('diagonal', 'Diagonal X labels')
        + (k === 'line' ? chk('weekday', 'Weekday above date') : ''));
    }

    // Colours
    let colours = `<label class="ck-f ck-wide"><span>Theme</span><select data-theme>`
      + Object.entries(THEMES).map(([v, t]) => `<option value="${v}"${p.theme === v ? ' selected' : ''}>${t.label}</option>`).join('') + '</select></label>'
      + col('data-pref="bg"', 'Background', th.bg) + col('data-pref="grid"', 'Grid', th.grid)
      + col('data-pref="text"', 'Text', th.text) + col('data-pref="axis"', 'Axis', th.axis);
    const swatches = [];
    if (k === 'line') rec.spec.series.forEach(se => swatches.push([se.key, se.label, colorOf(p, se.key, se.color)]));
    else if (k === 'stacked') rec.spec.datasets.forEach(d => swatches.push([d.key, d.label, colorOf(p, d.key, d.color)]));
    else if (k === 'doughnut' || Array.isArray(rec.spec.colors)) (rec.allRows || []).forEach(r => swatches.push([r.key, r.label, r.color]));
    else swatches.push(['__bar', 'Bars', colorOf(p, '__bar', rec.spec.colors)]);
    if (swatches.length) {
      colours += `<div class="ck-f ck-wide"><span>${k === 'line' ? 'Line colours' : k === 'doughnut' ? 'Slice colours' : 'Bar colours'}</span><div class="ck-swatches">`
        + swatches.map(([key, label, c]) => col(`data-color="${esc(key)}"`, label, c)).join('') + '</div></div>';
    }
    html += sec('Colours', colours);
    html += `<div class="ck-pop-foot"><button type="button" class="ck-reset" data-ck="reset">Reset this chart</button></div>`;
    rec.ui.pop.innerHTML = html;
  }

  function onPopInput(rec, e) {
    const t = e.target;
    if (t.dataset.theme != null) {
      if (prefs(rec).theme === t.value && e.type === 'change') return;
      setPref(rec, 'theme', t.value);
      ['bg', 'grid', 'text', 'axis'].forEach(key => delPref(rec, key));
      render(rec); fillPop(rec);
      return;
    }
    if (t.dataset.pref) {
      const key = t.dataset.pref;
      const v = t.type === 'checkbox' ? t.checked : t.type === 'range' ? +t.value : t.value;
      setPref(rec, key, v);
      if (key === 'width') { const wv = rec.ui.pop.querySelector('.ck-wv'); if (wv) wv.textContent = `${v}px`; }
    } else if (t.dataset.color) {
      setPref(rec, 'colors', { ...prefs(rec).colors, [t.dataset.color]: t.value });
    } else if (t.dataset.hide != null) {
      const hidden = new Set(prefs(rec).hidden);
      t.checked ? hidden.delete(t.dataset.hide) : hidden.add(t.dataset.hide);
      setPref(rec, 'hidden', [...hidden]);
    } else return;
    schedule(rec);
  }

  // ── export ─────────────────────────────────────────────────────────────────
  function chartTitle(rec) {
    const h = rec.ui && rec.ui.panel.querySelector('h3');
    if (!h) return rec.id;
    const c = h.cloneNode(true);
    c.querySelectorAll('.chart-tip').forEach(x => x.remove());
    return c.textContent.replace(/\s+/g, ' ').trim() || rec.id;
  }

  function exportPNG(rec, withBg) {
    if (!rec.chart) return;
    const p = prefs(rec), th = themeOf(p);
    const W = 1400;
    const ratio = rec.ui.wrap.clientHeight / Math.max(1, rec.ui.wrap.clientWidth);
    const H = Math.round(Math.min(1500, Math.max(560, W * ratio + 140)));
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-30000px;top:0;width:${W}px;height:${H}px;pointer-events:none;`;
    const cv = document.createElement('canvas');
    host.appendChild(cv); document.body.appendChild(host);
    let url = null;
    try {
      const cfg = build(rec, p, { withBg });
      delete cfg._struct;
      const o = cfg.options;
      o.animation = false; o.devicePixelRatio = 2; o.onHover = undefined;
      const pad = o.layout && o.layout.padding;
      const add = (v) => (v || 0) + 28;
      o.layout = { padding: typeof pad === 'object' && pad
        ? { top: add(pad.top), right: add(pad.right), bottom: add(pad.bottom), left: add(pad.left) }
        : 28 + (+pad || 0) };
      const sub = rec.kind === 'line' && rec.view
        ? `${fmtDay(rec.view.minT)} – ${fmtDay(rec.view.maxT)}`
        : `Snapshot · ${fmtDay(Date.now(), true)}`;
      o.plugins.title = { display: true, text: chartTitle(rec), color: th.text, font: { size: 20, weight: '700' }, padding: { top: 0, bottom: 4 } };
      o.plugins.subtitle = { display: true, text: `${sub} · mac-andreas.github.io`, color: th.axis, font: { size: 12 }, padding: { bottom: 14 } };
      const ch = new Chart(cv.getContext('2d'), cfg);
      url = ch.toBase64Image('image/png', 1);
      ch.destroy();
    } catch (err) {
      console.error('[chart-kit] export failed', err);
    } finally {
      host.remove();
    }
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `mac-andreas-${rec.id}-${new Date().toISOString().slice(0, 10)}${withBg ? '' : '-transparent'}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ── public API ─────────────────────────────────────────────────────────────
  function upsert(id, kind, spec) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === 'undefined') return null;
    let rec = recs[id];
    if (rec && (rec.kind !== kind || rec.canvas !== canvas)) { destroy(id); rec = null; }
    if (!rec) rec = recs[id] = { id, kind, canvas, chart: null, focus: null, chipFocus: null, range: null, specRange: undefined };
    rec.spec = spec;
    if (kind === 'line') {
      spec.series.forEach(se => {
        se.key = String(se.key ?? se.label);
        se.map = new Map(se.points.filter(pt => pt && pt.y != null && Number.isFinite(pt.t)).map(pt => [pt.t, pt]));
      });
      rec.axis = [...new Set(spec.series.flatMap(se => [...se.map.keys()]))].sort((a, b) => a - b);
      if (!rec.axis.length) { destroy(id); return null; }
      // A new spec.range (e.g. a Trends range button) resets the window; the
      // same range on a redraw (hourly poll) keeps the user's slider position.
      const want = spec.range || '1M';
      if (rec.specRange !== want) { rec.specRange = want; rec.range = { preset: want }; }
    }
    if (kind === 'stacked') spec.datasets.forEach(d => { d.key = String(d.key ?? d.label); });
    ensureUI(rec);
    render(rec, rec.chart ? 'none' : undefined);
    return rec.chart;
  }

  function destroy(id) {
    const rec = recs[id]; if (!rec) return;
    if (openPop === rec) closePop();
    if (openMenu === rec) closeMenu();
    if (rec.raf) cancelAnimationFrame(rec.raf);
    if (rec.chart) rec.chart.destroy();
    if (rec.ui) ['actions', 'pop', 'chips', 'range'].forEach(k => rec.ui[k] && rec.ui[k].remove());
    delete recs[id];
  }

  window.ChartKit = {
    line: (id, spec) => upsert(id, 'line', spec),
    bar: (id, spec) => upsert(id, 'bar', spec),
    stacked: (id, spec) => upsert(id, 'stacked', spec),
    doughnut: (id, spec) => upsert(id, 'doughnut', spec),
    destroy,
    resizeAll() { for (const id in recs) { try { recs[id].chart && recs[id].chart.resize(); } catch {} } },
  };
})();
