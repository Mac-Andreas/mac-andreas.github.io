// Hash-driven router for the single-file site.
// Nav links like <a href="#dashboard"> swap which <main> section is visible
// instead of scrolling. Only one section renders at a time.
// - URL hash is the source of truth
// - Empty hash defaults to the first section
// - Back/forward navigation works via hashchange
(() => {
  const nav = document.querySelector('.site-nav-sticky');
  const sections = [...document.querySelectorAll('main > section[id]')];
  if (!nav || !sections.length) return;

  const links = [...nav.querySelectorAll('a.site-nav-link[href^="#"]')];
  const ids   = new Set(sections.map(s => s.id));
  const DEFAULT = sections[0].id;

  function show(id) {
    // A hash may carry a sub-tab suffix (e.g. #dashboard-geography). Match the
    // section on the part before the first "-" so deep-links into a section's
    // sub-tab still resolve to that section (servers.js reads the full hash).
    const base = ids.has(id) ? id : id.split('-')[0];
    const target = ids.has(base) ? base : DEFAULT;
    sections.forEach(s => {
      s.dataset.active = String(s.id === target);
    });
    links.forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === `#${target}`);
    });
    // Scroll to top of viewport so the new section starts under the sticky
    // nav rather than wherever the previous one left the scroll position.
    window.scrollTo(0, 0);
  }

  // Smooth click — prevent default jump-scroll; just swap sections.
  links.forEach(a => {
    a.addEventListener('click', (ev) => {
      const id = a.getAttribute('href').slice(1);
      if (!ids.has(id)) return; // external link (target=_blank) — let it through
      ev.preventDefault();
      if (location.hash !== `#${id}`) {
        history.pushState(null, '', `#${id}`);
      }
      show(id);
    });
  });

  // Back/forward.
  window.addEventListener('hashchange', () => {
    show((location.hash || '').replace('#', ''));
  });

  // Initial route from URL hash.
  show((location.hash || '').replace('#', ''));
})();
