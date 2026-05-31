// Renders one of the three "Get Started" tutorials based on ?id= in the URL.
// IDs:
//   1 → open.mp server setup (links out to the launcher repo)
//   2 → installing the open.mp Launcher (release notes fetched from GitHub)
//   3 → CrossOver + GTA: SA + downgrade (long-form, baked-in)
(async () => {
  const GUIDES = [
    {
      id: 1,
      title: 'Set up an open.mp server',
      accent: 'on macOS',
      tagline: 'Spin up a local open.mp server using the launcher and connect from any client.',
      eyebrow: 'Tutorial 01 · Server',
      date: '2026-05-25',
      cta: {
        label: 'Server launcher repo',
        sub: 'github.com/Mac-Andreas/open.mp-launcher-macOS',
        href: 'https://github.com/Mac-Andreas/open.mp-launcher-macOS',
      },
      body: `
### What you'll set up

A local **open.mp** server running on macOS, reachable from the open.mp
Launcher running on the same machine or a friend's. No Windows VM, no Docker.

### Steps

1. Grab the **open.mp Launcher (macOS)** from
   [the launcher releases page](https://github.com/Mac-Andreas/open.mp-launcher-macOS/releases/latest).
2. Move the launcher app into \`/Applications\` and open it once so macOS
   registers it past Gatekeeper.
3. In the launcher, open **Settings → Server** and pick a folder for your
   server data (gamemodes, filterscripts, plugins). The launcher creates
   the open.mp server binaries inside that folder on first start.
4. Drop your \`gamemodes/*.amx\`, \`filterscripts/*.amx\`, and
   \`plugins/*.dylib\` (or \`.so\`) into that folder.
5. Edit \`config.json\` in the server folder — set \`name\`, \`maxplayers\`,
   pick a \`gamemode\`, list any \`filterscripts\` and \`plugins\`. The
   launcher offers a GUI editor under **Settings → Config** if you'd rather
   not touch JSON directly.
6. Hit **Start** in the launcher. The output console shows the server
   boot log; once you see \`Started server on port 7777\` you're live.
7. From the **Servers** tab, click **Connect** on your own server (or any
   public open.mp server) to join.

### Troubleshooting

- **Server immediately exits** — usually a missing plugin. Re-read the
  launcher console for the first line that mentions a \`.dylib\` /
  \`.so\` that can't be loaded.
- **Mac can't open the launcher** — right-click the app icon → Open
  once to bypass Gatekeeper, then it'll launch normally afterwards.
- **Port 7777 already in use** — change \`port\` in \`config.json\` or
  stop whatever else is bound to it.

Detailed reference for the launcher itself lives in the
[next tutorial](guide.html?id=2). For CrossOver + GTA: SA setup (needed
to actually *play* on a server, not just host one), see
[Tutorial 03](guide.html?id=3).
`,
    },

    {
      id: 2,
      title: 'Install the open.mp',
      accent: 'Launcher',
      tagline: 'Drop-in macOS launcher — install, sign, and run on Apple silicon.',
      eyebrow: 'Tutorial 02 · Install',
      date: '2026-05-20',
      cta: {
        label: 'Download v1.6.3',
        sub: 'open.mp-launcher-macOS · arm64',
        href: 'https://github.com/Mac-Andreas/open.mp-launcher-macOS/releases/tag/v1.6.3-arm.1',
      },
      // Body is fetched from the release notes at runtime — see remote().
      remote: {
        owner: 'Mac-Andreas',
        repo:  'open.mp-launcher-macOS',
        tag:   'v1.6.3-arm.1',
      },
      body: '_Loading release notes from GitHub…_',
    },

    {
      id: 3,
      title: 'CrossOver',
      accent: 'setup',
      tagline: 'What CrossOver and Rockstar leave on you — the bits the launcher cannot do for you.',
      eyebrow: 'Tutorial 03 · CrossOver',
      date: '2026-05-19',
      cta: {
        label: 'Get CrossOver',
        sub: 'codeweavers.com · 14-day trial',
        href: 'https://www.codeweavers.com/crossover',
      },
      body: `
A follow-up for anyone getting the launcher running end-to-end. The
macOS launcher takes over once the game is installed and on v1.0; the
steps below cover the bits CrossOver and Rockstar leave to the user.

> **Before you start.** These steps assume you **own a legitimate copy**
> of Grand Theft Auto: San Andreas (via the Rockstar Games Launcher and/or
> Steam). Every tool named below — CrossOver, the Rockstar Games Launcher,
> SA-MP, and the downgrade tool — is **third-party software** and is **not
> affiliated with or distributed by Mac-Andreas**. We link to each tool's
> official source; we don't host or mirror any game files. Don't
> redistribute any copyrighted executable.

### Getting CrossOver

CrossOver is the Windows compatibility layer that runs GTA: SA on
macOS. The launcher does **not** bundle Wine — grab CrossOver from
CodeWeavers directly:
[codeweavers.com/crossover](https://www.codeweavers.com/crossover) —
paid license, with a 14-day free trial (as of 20 May 2026).

**Version note.** The steps below were tested on **CrossOver 26.1**,
which is why the \`libcef.dll\` workaround later in this post is scoped
to that build. CodeWeavers ships fixes on a tight cadence, so install
the latest version if you can — newer releases often clear up the same
issues without any manual patching. If the Rockstar Games Launcher
window renders fine on your version, ignore the Terminal step entirely.

### Installing the game

1. Install **Rockstar Games Launcher (RGL)** inside CrossOver. CrossOver
   creates a fresh bottle for it automatically — no manual bottle setup.
2. Buy / own **Grand Theft Auto: The Trilogy** on Rockstar's store. This
   is the classic trilogy, **not** the Definitive Edition — only the
   classic build works with SA-MP / open.mp.
3. Open RGL and install **Grand Theft Auto: San Andreas** from your
   library. (If GTA: SA does not appear, make sure the Trilogy purchase
   is tied to the Social Club account you're signed in with.)
4. If RGL or the game misbehave, re-install the following into the same
   bottle and try again
   (\`"Rockstar Games Launcher" Bottle → Install Application into Bottle\`):
    - Microsoft Visual C++ Redistributable
    - Microsoft Edge WebView2
    - .NET Framework 4.8
    - DirectX for Modern Games

**CrossOver 26.1 only.** If RGL opens but the window stays invisible /
blank, fully quit CrossOver and run this in macOS Terminal:

\`\`\`bash
bottle="Rockstar Games Launcher"
dll="$HOME/Library/Application Support/CrossOver/Bottles/$bottle/drive_c/Program Files/Rockstar Games/Social Club/libcef.dll"
perl -0777 -pi -e 's/use-gl/xse-gl/g' "$dll"
\`\`\`

Reopen CrossOver, launch RGL again — the window should now render.

### Issues you may hit

#### Mouse spinning / broken camera movement

A well-known macOS + CrossOver quirk — the camera spins forever or
mouse input goes unstable as soon as you're in-game. The fix: use a
**Steam** \`gta-sa.exe\` (copied from a Windows machine) alongside the
Rockstar one — not replacing it. Keep **both**: \`gta_sa.exe\` from RGL
and \`gta-sa.exe\` from Steam.

1. Grab \`gta-sa.exe\` from a Steam install of GTA: San Andreas on a
   Windows machine and copy it to the Mac.
2. In CrossOver, open the bottle → **Open C: Drive**.
3. Navigate to your GTA: San Andreas install folder.
4. Paste the Steam \`gta-sa.exe\` there — **keep the existing
   \`gta_sa.exe\` (RGL) too**. Both executables now sit side by side.
5. Inside CrossOver: **Run Command → Browse →** pick the Steam
   \`gta-sa.exe\` you just pasted → **Save command as launcher**.

#### Downgrading to v1.0

SA-MP and open.mp only run against the **v1.0 executable**, so any
modern Steam / Rockstar copy has to be downgraded. A community downgrade
tool (e.g. the RockstarNexus downgrader) handles this. It is **third-party
software, not affiliated with Mac-Andreas** — download it from its own
official source; it is never hosted or mirrored here.

1. Download the downgrade tool from its official source.
2. Open the CrossOver bottle.
3. Click **Install Application into Bottle**.
4. Browse to the Downloads folder and select the downgrade tool.
5. When the tool asks which \`gta-sa.exe\` to target, point it at the
   one inside the bottle.
6. Let it finish.

Once the game is on v1.0, the launcher picks up the bottle automatically
— install your SA-MP version from **Settings → Overview** and hit
**Connect** on a server.
`,
    },
    {
      id: 4,
      eyebrow: 'Tutorial 04',
      title: 'Write open.mp Pawn in',
      accent: 'VS Code',
      tagline: 'Set up a modern Pawn editing + compile workflow in VS Code on macOS — no Pawno, no Qawno, no Wine.',
      date: '2026-05-31',
      cta: { href: 'https://github.com/Mac-Andreas/vscode-open-pawn', label: 'Get the extension', sub: 'VS Code · macOS · Win · Linux' },
      body: `
## Why VS Code?

Pawno (Windows-only) and Qawno (needs Wine on the Mac) are the classic
SA-MP / open.mp editors. On macOS you can skip both: the
[**vscode-open-pawn**](https://github.com/Mac-Andreas/vscode-open-pawn)
extension brings full Pawn language support to **VS Code** (and Cursor,
VSCodium, Gitpod) — syntax highlighting, autocomplete, snippets, and a
one-key **compile task** that runs the open.mp Pawn compiler natively.
No Wine required.

## 1 · Install VS Code

Grab VS Code for Apple silicon from
[code.visualstudio.com](https://code.visualstudio.com/) and open it.

## 2 · Install the Pawn extension

Open the Extensions panel (\`⇧⌘X\`), search for **"open.mp Pawn"** (publisher
*Mac-Andreas*), and click **Install**. Or install from the repo's release
\`.vsix\`:

1. Download the latest \`.vsix\` from the
   [releases page](https://github.com/Mac-Andreas/vscode-open-pawn/releases/latest).
2. In VS Code: **Extensions → ⋯ → Install from VSIX…** and pick the file.

## 3 · Point it at the compiler

The extension bundles a macOS-native build of the open.mp Pawn compiler
(\`pawncc\`), so there's nothing else to download. If you want to use your
own compiler, set its path in **Settings → Extensions → open.mp Pawn →
Compiler Path**.

Add the open.mp includes (the \`pawno/include\` or \`qawno/include\` folder
from your server package) to your project so \`#include <open.mp>\` resolves.

## 4 · Compile

Open any \`.pwn\` file (a gamemode in \`gamemodes/\` or a filterscript in
\`filterscripts/\`) and run the **Compile** task:

- **\`⌘⇧B\`** → *Pawn: Compile current file*, or
- the **Compile** button the extension adds to the editor title bar.

Errors and warnings show up inline and in the **Problems** panel with
clickable line numbers. The compiled \`.amx\` lands next to your source,
ready to drop into your server's \`gamemodes/\` / \`filterscripts/\`.

## 5 · Run it

Start your server with the
[open.mp Server Manager](app.html?slug=server-manager) (or
\`./omp-server\` from Terminal), then connect with the
[open.mp Launcher](app.html?slug=launcher). Edit → \`⌘⇧B\` → reload the
gamemode → test. That's the whole loop, entirely on macOS.

> **Tip.** Pair this with the [Qawno](app.html?slug=qawno) build if you
> prefer the classic editor UI — both use the same compiler, so you can
> switch freely.
`,
    },
  ];

  const id = parseInt(new URLSearchParams(location.search).get('id'), 10);
  const guide = GUIDES.find(g => g.id === id);

  if (!guide) {
    document.title = 'Guide not found · Mac-Andreas';
    setText('guide-title', 'Not found');
    setHTML('guide-body',
      `<p class="err">Unknown guide id: <code>${escapeHtml(String(id || ''))}</code>.
       <a href="index.html#guides" style="color:var(--ember);">Back to guides</a>.</p>`);
    return;
  }

  document.title = `${guide.title} · Mac-Andreas`;
  setText('guide-eyebrow', guide.eyebrow);
  setHTML('guide-title', `${escapeHtml(guide.title)} <span class="accent">${escapeHtml(guide.accent || '')}</span>`);
  setText('guide-tagline', guide.tagline || '');
  setText('sb-step', `${guide.id} of ${GUIDES.length}`);
  if (guide.date) {
    setText('sb-updated', new Date(guide.date + 'T00:00:00').toLocaleDateString());
  }

  // Sidebar CTA.
  if (guide.cta) {
    const cta = document.getElementById('guide-cta');
    cta.href = guide.cta.href;
    cta.querySelector('strong').textContent = guide.cta.label;
    setText('guide-cta-sub', guide.cta.sub || '');
  }

  // Pager.
  const prev = GUIDES.find(g => g.id === guide.id - 1);
  const next = GUIDES.find(g => g.id === guide.id + 1);
  wirePager('prev-guide', 'prev-sub', prev);
  wirePager('next-guide', 'next-sub', next);

  // Body — fetch remote release notes if defined, otherwise use inline body.
  let md = guide.body;
  if (guide.remote) {
    const { owner, repo, tag } = guide.remote;
    try {
      const r = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
        { headers: { 'Accept': 'application/vnd.github+json' } });
      if (r.ok) {
        const rel = await r.json();
        const intro = [
          `**Release ${rel.tag_name}** — published ${rel.published_at ? new Date(rel.published_at).toLocaleDateString() : '—'}`,
          `[View release on GitHub](${rel.html_url})`,
        ].join(' · ');
        md = `${intro}\n\n${rel.body || '_Release notes are empty._'}`;
        if (rel.published_at) {
          setText('sb-updated', new Date(rel.published_at).toLocaleDateString());
        }
      } else {
        md = `_Could not load release notes (HTTP ${r.status}). View the release on GitHub:_\n\n[${tag} on GitHub](https://github.com/${owner}/${repo}/releases/tag/${tag})`;
      }
    } catch (e) {
      console.warn('release fetch failed', e);
      md = `_Network error loading release notes._\n\n[View ${tag} on GitHub](https://github.com/${owner}/${repo}/releases/tag/${tag})`;
    }
  }

  // Render markdown.
  // Configure marked so external links open in new tabs and code blocks get
  // our existing dark theming.
  if (window.marked) {
    marked.setOptions({ gfm: true, breaks: false, mangle: false, headerIds: true });
    document.getElementById('guide-body').innerHTML = marked.parse(md);
    // Anchor target rewrite — all rendered <a> open in a new tab unless they
    // point inside this site.
    document.querySelectorAll('#guide-body a[href]').forEach(a => {
      const h = a.getAttribute('href');
      if (/^(https?:)?\/\//i.test(h) && !h.includes(location.host)) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
    });
  } else {
    setHTML('guide-body', '<p class="err">Markdown renderer failed to load.</p>');
  }

  // ============ Helpers ============
  function wirePager(btnId, subId, target) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (!target) {
      btn.style.opacity = '0.35';
      btn.style.pointerEvents = 'none';
      btn.href = '#';
      setText(subId, '—');
      btn.querySelector('strong').textContent = btnId === 'prev-guide' ? 'Start' : 'Done';
      return;
    }
    btn.href = `guide.html?id=${target.id}`;
    setText(subId, target.title);
  }
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
})();
