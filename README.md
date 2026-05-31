# mac-andreas.github.io

**Mac-Andreas** — native macOS tools, guides, and scripts for the open.mp / SA-MP community.

🌐 **Live site:** [mac-andreas.github.io](https://mac-andreas.github.io)

---

## What's here

| Section | Description |
|---|---|
| **Apps** | Native Apple Silicon builds of open.mp tools (launcher, Qawno, server launcher) |
| **Guides** | Step-by-step tutorials: server setup, launcher install, CrossOver configuration |
| **Scripts** | SA-MP filterscripts & gamemodes ported to open.mp (auto-fetched by topic tag) |
| **Dashboard** | Anonymous opt-in usage telemetry, visualised per-app |
| **Garage** | All repositories tagged `mac-andreas-project` on GitHub, live snapshot |
| **Discussions** | Community threads from the GitHub Discussions board |

---

## Repository layout

```
index.html                  Main site (single-page, section-based)
guide.html                  Tutorial detail page
app.html                    App detail page
dashboard/
  config.js                 App registry + Supabase view names
  stats.js                  Shared stats.json accessor (window.MA_STATS)
  repos.js                  Garage grid renderer (reads data/pinned.json)
  app.js                    Per-app dashboard panels + Chart.js charts
  landing.js                Home card grid renderer
  discussions.js            Community board renderer
  scripts.js                Scripts section renderer
  home.js                   Home stats counters
  section-nav.js            Sticky nav active-section tracker
  guide-detail.js           Tutorial page renderer
  app-detail.js             App page renderer
  icons.js                  Inline SVG icon sprite
  styles.css                Site-wide styles (GTA SA car-culture theme)
data/
  pinned.json               Repo snapshot (refreshed daily by Actions)
  stats.json                App telemetry snapshot (refreshed every 3h by Actions)
  scripts.json              Script repo snapshot (refreshed daily by Actions)
  discussions.json          Community thread snapshot (refreshed daily by Actions)
scripts/
  fetch-pinned-repos.mjs    Fetches repos tagged `mac-andreas-project` → data/pinned.json
  fetch-stats.mjs           Fetches Supabase aggregate views → data/stats.json
  fetch-scripts.mjs         Fetches repos tagged `openmp-script-port` → data/scripts.json
  fetch-discussions.mjs     Fetches GitHub Discussions → data/discussions.json
assets/
  hero/banner.webp          Hero banner image
```

---

## How the Garage works

Repositories appear in **The Garage** section automatically when they carry the
[`mac-andreas-project`](https://github.com/search?q=topic:mac-andreas-project+user:Mac-Andreas)
GitHub topic. The daily `refresh-repos.yml` workflow runs `scripts/fetch-pinned-repos.mjs`
which queries the GitHub Search API and commits the result to `data/pinned.json`.

To add a repo: go to the repo on GitHub → About → Topics → add `mac-andreas-project`.

---

## Adding another app to the Dashboard

1. Create Supabase views named `<slug>_app_dau`, `<slug>_app_wau`, etc. (copy the pattern from existing views).
2. Append an entry to `dashboard/config.js`'s `apps` array with `slug`, `display`, `platform`, `tagline`, `repo`, and `views`.
3. Update `scripts/fetch-stats.mjs` to include the new slug.

---

## Deploying

Push to the `main` branch of
[`Mac-Andreas/mac-andreas.github.io`](https://github.com/Mac-Andreas/mac-andreas.github.io).
GitHub Pages serves from the repo root automatically.

No build step — plain HTML, CSS, and vanilla JS.

---

## Legal

Community project. Not affiliated with Rockstar Games, Take-Two Interactive,
the SA-MP team, or the open.mp project maintainers. See the
[legal section on the site](https://mac-andreas.github.io/#legal) for full details.
