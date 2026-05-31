// Injects the shared SVG icon sprite into the page so nav + footer links can
// reference icons via <use href="#ico-…">. One source of truth across
// index.html, app.html, and guide.html. Stroke icons inherit currentColor;
// the GitHub mark is a filled path.
(() => {
  if (document.getElementById('ma-icon-sprite')) return;
  const sprite = `
<svg id="ma-icon-sprite" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <symbol id="ico-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 21v-6h6v6"/>
  </symbol>
  <symbol id="ico-apps" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
  </symbol>
  <symbol id="ico-scripts" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/>
  </symbol>
  <symbol id="ico-guides" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 3v18"/>
  </symbol>
  <symbol id="ico-dashboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="6"/><line x1="18" y1="20" x2="18" y2="14"/>
  </symbol>
  <symbol id="ico-garage" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 .5C5.73.5.7 5.53.7 11.8c0 4.99 3.24 9.22 7.73 10.71.57.1.78-.25.78-.55v-2c-3.14.68-3.8-1.34-3.8-1.34-.52-1.31-1.27-1.66-1.27-1.66-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.5-.28-5.14-1.25-5.14-5.57 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.1-2.98 0 0 .95-.3 3.1 1.16a10.8 10.8 0 0 1 5.65 0c2.15-1.46 3.1-1.16 3.1-1.16.61 1.55.23 2.7.11 2.98.72.79 1.16 1.8 1.16 3.03 0 4.33-2.64 5.28-5.16 5.56.41.35.77 1.03.77 2.08v3.08c0 .3.2.66.79.55A11.3 11.3 0 0 0 23.3 11.8C23.3 5.53 18.27.5 12 .5z"/>
  </symbol>
  <symbol id="ico-discussions" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.7L3 21l1.4-5A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>
  </symbol>
  <symbol id="ico-privacy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
  </symbol>
  <symbol id="ico-legal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3v18"/><path d="M7 7h10"/><path d="M5 7l-2.5 6a3 3 0 0 0 5 0z"/><path d="M19 7l-2.5 6a3 3 0 0 0 5 0z"/><path d="M8 21h8"/>
  </symbol>
</svg>`;
  document.body.insertAdjacentHTML('afterbegin', sprite);
})();
