// Forum-signature / embed builder — pure client side, no backend.
//
// Produces copy-paste BBCode for MyBB (and any BBCode forum). Three modes:
//   • Overview   — live total servers/players + the "Is SA-MP dead?" verdict
//   • Per-server — pick a server from the live list; bakes its name + players
//   • Quote      — a GTA-style custom quote (parody lines) with a font choice
//
// Live numbers come from api.open.mp/servers (same source as the dashboard) and
// are baked into the BBCode at copy time. A "View more →" link (new tab) to the
// dashboard is appended to every signature. Themes change the colour palette of
// the generated BBCode.
//
// Note: forum signatures can't run JS, so the numbers are a snapshot from when
// the user copies — they don't auto-update. (A live-updating image badge would
// need a tiny serverless image endpoint; out of scope for a static site.)
(() => {
  const root = document.getElementById('sig-app');
  if (!root) return;

  const OMP_API = 'https://api.open.mp/servers';
  const SITE = 'https://mac-andreas.github.io/#dashboard';

  const THEMES = {
    ember:  { name: 'Hot-rod (orange)', a: '#E8721C', b: '#C9A86B', t: '#EDE3C8' },
    purple: { name: 'open.mp (purple)', a: '#9B7FE8', b: '#29E0FF', t: '#EDE3C8' },
    green:  { name: 'Army (olive)',     a: '#8FAA48', b: '#B4D862', t: '#EDE3C8' },
    chrome: { name: 'Chrome (mono)',    a: '#D6D6D8', b: '#9FA1A4', t: '#FFFFFF' },
  };

  // Parody quotes that *resemble* well-known GTA lines without quoting them
  // verbatim. Users can also type their own.
  const QUOTES = [
    'AAH SH*T, HERE WE GO AGAIN',
    'ALL YOU HAD TO DO WAS PLAY THE DAMN GAME',
    'FOLLOW THE DAMN TRAIN',
    'BUSTED… BUT STILL ONLINE',
    'GRObE STREETS, SMALL PING',
    'RESPECT IS EVERYTHING ON SAN ANDREAS',
  ];
  const FONTS = ['Impact', 'Arial Black', 'Tahoma', 'Georgia', 'Courier New', 'Verdana'];

  let _servers = null;
  let _mode = 'overview';
  let _theme = 'ember';

  root.innerHTML = `
    <div class="sig-builder">
      <div class="sig-controls">
        <div class="sig-field">
          <label>Signature type</label>
          <div class="sig-seg" id="sig-mode">
            <button data-mode="overview" class="active">Overview</button>
            <button data-mode="server">Per-server</button>
            <button data-mode="quote">Custom quote</button>
          </div>
        </div>

        <div class="sig-field">
          <label>Theme</label>
          <select id="sig-theme" class="dash-select">
            ${Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}
          </select>
        </div>

        <div class="sig-field" id="sig-server-field" hidden>
          <label>Server</label>
          <select id="sig-server" class="dash-select"><option>Loading live servers…</option></select>
        </div>

        <div class="sig-field" id="sig-quote-field" hidden>
          <label>Quote</label>
          <input type="text" id="sig-quote" class="dash-input" maxlength="60" placeholder="Type your own…" />
          <div class="sig-quote-chips" id="sig-quote-chips">
            ${QUOTES.map(q => `<button class="sig-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
          </div>
          <label style="margin-top:10px">Font</label>
          <select id="sig-font" class="dash-select">
            ${FONTS.map(f => `<option value="${f}">${f}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="sig-preview-wrap">
        <div class="sig-preview-label">Preview</div>
        <div class="sig-preview" id="sig-preview"></div>

        <div class="sig-preview-label" style="margin-top:14px">BBCode <span class="dim">— paste into your forum signature</span></div>
        <textarea class="sig-code" id="sig-code" readonly rows="5"></textarea>
        <button class="btn-range" id="sig-copy" style="margin-top:8px">Copy BBCode</button>
        <span class="sig-copied" id="sig-copied" hidden>Copied ✓</span>
      </div>
    </div>`;

  // Wire controls.
  root.querySelector('#sig-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    _mode = b.dataset.mode;
    root.querySelectorAll('#sig-mode button').forEach(x => x.classList.toggle('active', x === b));
    root.querySelector('#sig-server-field').hidden = _mode !== 'server';
    root.querySelector('#sig-quote-field').hidden = _mode !== 'quote';
    render();
  });
  root.querySelector('#sig-theme').addEventListener('change', e => { _theme = e.target.value; render(); });
  root.querySelector('#sig-server').addEventListener('change', render);
  root.querySelector('#sig-quote').addEventListener('input', render);
  root.querySelector('#sig-font').addEventListener('change', render);
  root.querySelector('#sig-quote-chips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-q]'); if (!c) return;
    root.querySelector('#sig-quote').value = c.dataset.q; render();
  });
  root.querySelector('#sig-copy').addEventListener('click', () => {
    const ta = root.querySelector('#sig-code');
    ta.select();
    navigator.clipboard?.writeText(ta.value).catch(() => document.execCommand('copy'));
    const c = root.querySelector('#sig-copied');
    c.hidden = false; setTimeout(() => { c.hidden = true; }, 1600);
  });

  // Load live servers for the totals + per-server picker.
  fetch(OMP_API).then(r => r.json()).then(d => {
    _servers = Array.isArray(d) ? d : [];
    const sel = root.querySelector('#sig-server');
    const top = _servers.filter(s => s.pc > 0).sort((a, b) => (b.pc || 0) - (a.pc || 0)).slice(0, 100);
    sel.innerHTML = top.length
      ? top.map((s, i) => `<option value="${i}">${esc((s.hn || '').slice(0, 50))} — ${s.pc}/${s.pm}</option>`).join('')
      : '<option>No populated servers right now</option>';
    sel._top = top;
    render();
  }).catch(() => { render(); });

  function totals() {
    const sv = _servers || [];
    const omp = sv.filter(s => s.omp), samp = sv.filter(s => !s.omp);
    const sum = a => a.reduce((x, s) => x + (s.pc || 0), 0);
    return {
      servers: sv.length, players: sum(sv),
      ompPlayers: sum(omp), sampPlayers: sum(samp),
      sampServers: samp.length,
    };
  }

  function render() {
    const th = THEMES[_theme];
    let bb = '', html = '';

    if (_mode === 'overview') {
      const t = totals();
      const verdict = t.sampPlayers > 1 ? 'NO — SA-MP is still alive' : 'YES — SA-MP is dead';
      bb = [
        `[center]`,
        `[b][size=4][color=${th.a}]★ open.mp + SA-MP — LIVE[/color][/size][/b]`,
        `[color=${th.t}][b]${fmtBB(t.players)}[/b] players online across [b]${fmtBB(t.servers)}[/b] servers[/color]`,
        `[color=${th.b}]Is SA-MP dead? [b]${verdict}[/b] (${fmtBB(t.sampPlayers)} SA-MP players)[/color]`,
        `[url=${SITE}][color=${th.a}]» View the live dashboard[/color][/url]`,
        `[/center]`,
      ].join('\n');
      html = `
        <div style="text-align:center">
          <div style="color:${th.a};font-weight:700;font-size:17px;font-family:Impact,sans-serif">★ open.mp + SA-MP — LIVE</div>
          <div style="color:${th.t};margin-top:4px"><b>${fmtBB(t.players)}</b> players online across <b>${fmtBB(t.servers)}</b> servers</div>
          <div style="color:${th.b};margin-top:2px">Is SA-MP dead? <b>${esc(verdict)}</b></div>
          <div style="margin-top:6px"><a style="color:${th.a}">» View the live dashboard</a></div>
        </div>`;
    } else if (_mode === 'server') {
      const sel = root.querySelector('#sig-server');
      const s = (sel._top || [])[+sel.value] || null;
      if (s) {
        bb = [
          `[center]`,
          `[b][size=3][color=${th.a}]${esc(s.hn)}[/color][/size][/b]`,
          `[color=${th.t}][b]${s.pc}/${s.pm}[/b] players · ${esc(s.la || 'Unknown')} · ${s.omp ? 'open.mp' : 'SA-MP'}[/color]`,
          `[color=${th.b}]${esc(s.gm || '')}[/color]`,
          `[url=${SITE}][color=${th.a}]» More on Mac-Andreas[/color][/url]`,
          `[/center]`,
        ].join('\n');
        html = `
          <div style="text-align:center">
            <div style="color:${th.a};font-weight:700;font-size:15px;font-family:Impact,sans-serif">${esc(s.hn)}</div>
            <div style="color:${th.t};margin-top:4px"><b>${s.pc}/${s.pm}</b> players · ${esc(s.la || 'Unknown')} · ${s.omp ? 'open.mp' : 'SA-MP'}</div>
            <div style="color:${th.b};margin-top:2px">${esc(s.gm || '')}</div>
            <div style="margin-top:6px"><a style="color:${th.a}">» More on Mac-Andreas</a></div>
          </div>`;
      } else {
        bb = 'Pick a server above to generate its signature.';
        html = '<div class="dim">Pick a server above…</div>';
      }
    } else { // quote
      const q = (root.querySelector('#sig-quote').value || QUOTES[0]).toUpperCase();
      const font = root.querySelector('#sig-font').value || 'Impact';
      bb = [
        `[center]`,
        `[font=${font}][b][size=5][color=${th.a}]"${esc(q)}"[/color][/size][/b][/font]`,
        `[url=${SITE}][color=${th.b}]» Mac-Andreas · open.mp on macOS[/color][/url]`,
        `[/center]`,
      ].join('\n');
      html = `
        <div style="text-align:center">
          <div style="color:${th.a};font-weight:800;font-size:22px;font-family:'${font}',Impact,sans-serif;font-style:italic">"${esc(q)}"</div>
          <div style="margin-top:6px"><a style="color:${th.b}">» Mac-Andreas · open.mp on macOS</a></div>
        </div>`;
    }

    root.querySelector('#sig-preview').innerHTML = html;
    root.querySelector('#sig-code').value = bb;
  }

  function fmtBB(n) { return Number.isFinite(+n) ? (+n).toLocaleString() : '—'; }
  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  render(); // initial (before servers load → shows dashes)
})();
