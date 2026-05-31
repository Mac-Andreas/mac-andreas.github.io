// Hero banner rotation — picks one banner at random on each page load/refresh.
//
// GitHub Pages serves static files with no directory listing, so the banner set
// is an explicit manifest. Drop a new optimised .webp into assets/hero/ and add
// its filename to BANNERS to include it in the rotation.
//
// All banners share the hero aspect (1584×672) and keep their subject on the
// RIGHT half — the title block sits on the left (.hero-brand) behind a left-side
// dark gradient (.hero::after) for legibility.
(() => {
  const BANNERS = [
    'assets/hero/banner1.webp',
    'assets/hero/banner2.webp',
  ];
  const FALLBACK = 'assets/hero/banner1.png';

  const hero = document.querySelector('.hero');
  if (!hero || !BANNERS.length) return;

  const pick = BANNERS[Math.floor(Math.random() * BANNERS.length)];

  // Preload so the swap only happens once the image is ready (no flash of the
  // fallback gradient). Fall back to a PNG if the webp fails to load.
  const img = new Image();
  img.onload  = () => applyBanner(pick);
  img.onerror = () => applyBanner(FALLBACK);
  img.src = pick;

  function applyBanner(url) {
    hero.style.backgroundImage = [
      'linear-gradient(180deg, rgba(12,14,10,0) 55%, rgba(12,14,10,0.85) 92%, var(--bg) 100%)',
      `url('${url}')`,
      'linear-gradient(180deg, #3E1A3E 0%, #8B2A3A 30%, #E8721C 60%, #2A2418 88%, #0C0E0A 100%)',
    ].join(', ');
  }
})();
