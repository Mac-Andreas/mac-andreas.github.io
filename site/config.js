// Site config: app registry + community links.
//
// No telemetry, no Supabase. The app registry below is plain metadata used by
// app.html / site/app-detail.js + site/apps.js, which render each app from the
// public GitHub API (repo, latest release, README, stars). There is no
// analytics backend. The live #dashboard reads api.open.mp directly (servers.js).
//
// Override per environment by setting window.__MA_CONFIG__ before this loads.
window.MA_CONFIG = Object.assign({
  // Community hub. Points at the repo with Discussions enabled.
  discussionsUrl: 'https://github.com/Mac-Andreas/open.mp-Qawno-Silicon/discussions',

  // Garage lists Mac-Andreas repos carrying any of these GitHub topics (the
  // toolchain repos use mixed tags); the site repo is excluded. The daily
  // workflow snapshots them to data/garage.json — see scripts/fetch-scripts.mjs.
  garageOrg: 'Mac-Andreas',

  // Shipping apps. slug + display + repo are required; app-detail.js pulls the
  // version/release/README/stars live from GitHub. (Community App was removed.)
  apps: [
    {
      slug: 'launcher',
      display: 'open.mp Launcher',
      platform: 'macOS · Apple silicon',
      tagline: 'Native macOS build of the open.mp launcher — CrossOver integration, SA-MP installer, bottle picker and a .pkg installer. Upstream is Windows-only.',
      repo: 'https://github.com/Mac-Andreas/omp-launcher-macOS',
    },
    {
      slug: 'server-manager',
      display: 'open.mp Server Manager',
      platform: 'macOS · Apple silicon',
      tagline: 'SwiftUI launcher/manager for the open.mp server on macOS, with a bundled Wine compatibility layer.',
      repo: 'https://github.com/Mac-Andreas/omp-Server-Manager-macOS',
    },
    {
      slug: 'qawno',
      display: 'Qawno',
      platform: 'macOS · Apple silicon',
      tagline: 'The open.mp Pawn editor, ported to macOS — bundled Wine, in-app compiler, auto-update and dark/light themes.',
      repo: 'https://github.com/Mac-Andreas/Qawno-macOS',
    },
    {
      slug: 'vscode',
      display: 'VS Code Pawn',
      platform: 'VS Code · macOS · Win · Linux',
      tagline: 'Full Pawn language support for SA-MP and open.mp inside VS Code (and Cursor, VSCodium, Gitpod) — a modern, cross-platform replacement for Pawno/Qawno, no Wine on the Mac.',
      repo: 'https://github.com/Mac-Andreas/vscode-open-pawn',
    },
  ],
}, window.__MA_CONFIG__ || {});
