# mac-andreas.github.io

**Mac-Andreas** — native macOS tools and live server analytics for the open.mp / SA-MP community.

🌐 **Live site:** [mac-andreas.github.io](https://mac-andreas.github.io)

---

## What's here

| Section | Description |
|---|---|
| **Dashboard** | Live open.mp + SA-MP server analytics (Live Servers, Trends, Server Analysis, Breakdown, Geography, Benchmarking, Sources, Embed) |
| **Garage** | Every public repository in the [Mac-Andreas](https://github.com/Mac-Andreas) GitHub org |
| **Discussions** | Community threads from the GitHub Discussions board |

---

## Repository layout

```
index.html                  Main site (single-page, section-based)
site/
  chart-kit.js              Shared chart layer: per-chart Customize + Export,
                            type chips and date-range slider on time series
  servers.js                Dashboard data + tabs (api.open.mp, history files)
  repos.js                  Garage grid (GitHub API, falls back to data/garage.json)
  discussions.js            Community board renderer
  section-nav.js            Hash router for the single-page sections
  icons.js                  Inline SVG icon sprite
  styles.css                Site-wide styles (GTA SA car-culture theme)
data/
  server-history.json       SA-MP / open.mp history (Internet Archive + live snapshots)
  othergames-history.json   Cross-game history (RAGE:MP, MTA:SA, VC:MP …)
  garage.json               Fallback snapshot of the org's public repos
  discussions.json          Community thread snapshot
assets/
  hero/                     Hero banner images
  geo/world-countries.json  Borderless basemap for the Geography tab
```

---

## Dashboard charts

Every chart goes through `site/chart-kit.js`, which gives it:

- **Customize** (sliders icon): sort, show/hide categories, line type / stroke /
  width / points / fill, date + time on hover, axis position (X top/bottom,
  Y left/right), show/hide dates and axis labels, axis titles, grid lines,
  diagonal labels, weekday above the date, colour theme, background / grid /
  text / axis colours and every line, bar or slice colour.
- **Export** (download icon): PNG with the chart background, or transparent.
- **Time-series lines** also get type chips (click = show/hide, Alt/⌥-click =
  only that one, hover = highlight) and a date-range slider with 1D…All presets.

Appearance choices persist per chart in `localStorage`; the date window resets to
the chart's default on each visit (Trends: 1 week, other time charts: 1 month).

---

## How the Garage works

The Garage lists every **public** repository in the Mac-Andreas org, read live from
`https://api.github.com/orgs/Mac-Andreas/repos` in the browser (cached for an hour
per session). If the API is unreachable or rate-limited, it falls back to the
committed `data/garage.json` snapshot. New public repos appear automatically.

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
