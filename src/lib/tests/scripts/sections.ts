// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const SECTIONS_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;

  function buildSelector(el) {
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return '#' + el.id;
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
    if (testId) return el.tagName.toLowerCase() + '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
    const parent = el.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      const idx = same.indexOf(el) + 1;
      const parentSel = parent === document.body ? 'body' : parent.tagName.toLowerCase();
      return parentSel + ' > ' + el.tagName.toLowerCase() + ':nth-of-type(' + idx + ')';
    }
    return el.tagName.toLowerCase();
  }

  function repeatedChildrenCount(el) {
    if (!el.children || el.children.length < 3) return 0;
    const kids = Array.from(el.children);
    const byTag = {};
    for (const c of kids) byTag[c.tagName] = (byTag[c.tagName] || 0) + 1;
    let maxRun = 0;
    for (const k in byTag) if (byTag[k] > maxRun) maxRun = byTag[k];
    if (maxRun < 3) return 0;
    const firstTag = kids.find((c) => byTag[c.tagName] === maxRun).tagName;
    const sameTag = kids.filter((c) => c.tagName === firstTag);
    const heights = sameTag.slice(0, 6).map((c) => c.getBoundingClientRect().height).filter((h) => h > 30);
    if (heights.length < 3) return 0;
    const avg = heights.reduce((s, v) => s + v, 0) / heights.length;
    const allSimilar = heights.every((h) => Math.abs(h - avg) / avg < 0.4);
    return allSimilar ? maxRun : 0;
  }

  function headings(el) {
    const h = el.querySelector('h1,h2,h3,h4');
    const sub = el.querySelector('h2,h3,p');
    const heading = h ? (h.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160) : '';
    let subheading = '';
    if (sub && sub !== h) {
      subheading = (sub.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200);
    }
    return { heading, subheading };
  }

  function classifyType(el, rect, repeated, heading) {
    const tag = el.tagName;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'NAV' || role === 'navigation') return 'nav';
    if (tag === 'FOOTER' || role === 'contentinfo') return 'footer';
    if (tag === 'HEADER' || role === 'banner') return 'header';
    if (tag === 'ASIDE' || role === 'complementary') return 'aside';
    // Only classify as 'form' when a contained form actually fills a sane
    // portion of the section — guards against entire-page <form> wrappers
    // (common on Ashby-style SPAs) that would otherwise mark the whole
    // page as a single form section.
    const innerForm = el.querySelector('form');
    if (innerForm) {
      const fr = innerForm.getBoundingClientRect();
      if (fr.height > 40 && fr.height < viewportH * 1.5 && fr.height <= rect.height * 0.9) return 'form';
    }
    const docTop = rect.top + window.scrollY;
    // Hero: above-fold, taller than a thin strip, but not a full-page wrapper.
    // Wrapper-DIV protection lives in addNode() (own elementCount > 80% of total),
    // so this cap can be generous to allow rich hero sections with media/video.
    if (docTop < viewportH * 0.4 && rect.height > 200 && rect.height < viewportH * 2.5) return 'hero';
    const h = (heading || '').toLowerCase();
    if (/pric|plan|kostnad|prenum|abonnemang/.test(h)) return 'pricing';
    if (/faq|fr[åa]gor|questions|hj[äa]lp/.test(h)) return 'faq';
    if (/testimonial|kund|customer|review|omd[öo]me|recension/.test(h)) return 'testimonials';
    if (/feature|funktion|s[åa] funkar|how it works|capabilit/.test(h)) return 'features';
    if (/benefit|f[öo]rdel|varf[öo]r|why /.test(h)) return 'benefits';
    if (repeated >= 4) return 'cards';
    return 'content';
  }

  function countElements(el) {
    try { return el.querySelectorAll('*').length; } catch (_) { return 0; }
  }

  const seen = new Set();
  const raw = [];

  // Cache total element count once for wrapper-detection below.
  const totalElements = document.body.querySelectorAll('*').length;

  function isCookieBanner(el) {
    const id = (el.id || '').toLowerCase();
    const cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
    const aria = ((el.getAttribute && el.getAttribute('aria-label')) || '').toLowerCase();
    const role = ((el.getAttribute && el.getAttribute('role')) || '').toLowerCase();
    const COOKIE_RX = /(cookie|consent|gdpr|ccpa|onetrust|cookiebot|trustarc|usercentrics|didomi|osano|klaro)/;
    if (COOKIE_RX.test(id) || COOKIE_RX.test(cls) || COOKIE_RX.test(aria)) return true;
    if (role === 'dialog' || role === 'alertdialog') {
      const txt = (el.innerText || '').toLowerCase().slice(0, 400);
      if (/cookie|consent|gdpr|samtycke/.test(txt)) return true;
    }
    // Inspect a couple of close ancestors so deeply-nested banner inner divs
    // are also filtered.
    let p = el.parentElement;
    let hops = 0;
    while (p && hops++ < 3) {
      const pid = (p.id || '').toLowerCase();
      const pcls = (p.className && typeof p.className === 'string') ? p.className.toLowerCase() : '';
      if (COOKIE_RX.test(pid) || COOKIE_RX.test(pcls)) return true;
      p = p.parentElement;
    }
    return false;
  }

  function addNode(el) {
    if (!el || seen.has(el)) return;
    let rect = el.getBoundingClientRect();
    if (rect.width < 40) return;
    const rawH = rect.height;
    let effectiveH = rawH;
    let offsetH = 0, scrollH = 0, cloneH = 0;
    if (effectiveH < 80) {
      offsetH = el.offsetHeight || 0;
      scrollH = el.scrollHeight || 0;
      effectiveH = Math.max(offsetH, scrollH);
    }
    if (effectiveH < 80) {
      // Last resort: clone off-screen without transform/overflow to read natural height.
      try {
        const clone = el.cloneNode(true);
        clone.style.cssText =
          'position:fixed;left:-9999px;top:0;visibility:hidden;opacity:0;' +
          'transform:none;height:auto;max-height:none;overflow:visible;';
        document.body.appendChild(clone);
        cloneH = clone.getBoundingClientRect().height;
        document.body.removeChild(clone);
        if (cloneH > effectiveH) effectiveH = cloneH;
      } catch (_) {}
    }
    if (rawH < 80) {
      try {
        window.__lazyDebug = window.__lazyDebug || [];
        window.__lazyDebug.push({
          tag: el.tagName,
          id: el.id || null,
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
          rectH: Math.round(rawH),
          offsetH: Math.round(offsetH),
          scrollH: Math.round(scrollH),
          cloneH: Math.round(cloneH),
          accepted: effectiveH >= 80,
        });
      } catch (_) {}
    }
    if (effectiveH < 80) return;
    if (effectiveH !== rawH) {
      rect = {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.top + effectiveH,
        width: rect.width,
        height: effectiveH,
        x: rect.left,
        y: rect.top,
      };
    }
    if (isCookieBanner(el)) return;
    // Skip page-wrapper elements that span almost the entire document — they
    // produce bogus "hero" / "form" sections with rect.h ≈ document height.
    // Applies to any tag (DIV, FORM, SECTION, MAIN, …) since SPAs sometimes
    // wrap the whole page in <form> or a React-root <div>.
    if (rect.height > viewportH * 1.5) {
      const ownCount = el.querySelectorAll('*').length;
      const ratio = totalElements > 0 ? ownCount / totalElements : 0;
      const tooTall = rect.height > viewportH * 10;
      const tooBig = ratio > 0.6;
      // Diagnostic: record every candidate that crossed the height threshold.
      try {
        window.__wrapperDebug = window.__wrapperDebug || [];
        window.__wrapperDebug.push({
          tag: el.tagName,
          id: el.id || null,
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
          ownCount,
          totalElements,
          ratio: Math.round(ratio * 1000) / 1000,
          rectH: Math.round(rect.height),
          viewportH,
          skipped: tooBig || tooTall,
        });
      } catch (_) {}
      if (tooBig || tooTall) return;
    }
    seen.add(el);
    const repeated = repeatedChildrenCount(el);
    const hh = headings(el);
    const type = classifyType(el, rect, repeated, hh.heading);
    raw.push({
      el, rect, repeated, heading: hh.heading, subheading: hh.subheading, type,
    });
  }

  // Landmarks
  document.querySelectorAll(
    'header, nav, main, footer, aside, ' +
    '[role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"]'
  ).forEach(addNode);

  // Direct children of <main>
  const main = document.querySelector('main') || document.body;
  if (main && main.children) {
    for (const child of Array.from(main.children)) {
      const r = child.getBoundingClientRect();
      if (r.height < 160) continue;
      addNode(child);
    }
  }

  // Explicit <section>/<article>
  document.querySelectorAll('section, article').forEach(addNode);

  // Sort by docY
  raw.sort((a, b) => (a.rect.top + window.scrollY) - (b.rect.top + window.scrollY));

  // Compute max area for visualWeight normalization
  let maxArea = 1;
  for (const r of raw) {
    const a = r.rect.width * r.rect.height;
    if (a > maxArea) maxArea = a;
  }

  const out = raw.map((r, i) => {
    const area = r.rect.width * r.rect.height;
    const heading = r.heading;
    const sub = r.subheading && r.subheading !== heading ? r.subheading : '';
    const entry = {
      id: 'section_' + (i + 1),
      type: r.type,
      position: i + 1,
      heading,
      selector: buildSelector(r.el),
      rect: {
        y: Math.round(r.rect.top + window.scrollY),
        w: Math.round(r.rect.width),
        h: Math.round(r.rect.height),
      },
      aboveFold: r.rect.top < viewportH,
      visualWeight: Math.round((area / maxArea) * 100),
      elementCount: countElements(r.el),
      childCount: r.el.children ? r.el.children.length : 0,
      containsPrimaryCTA: false,
      containsTrustSignals: false,
      containsForm: !!r.el.querySelector('form'),
      containsPricing: false,
      containsNavigation: r.type === 'nav' || r.type === 'header' || r.type === 'footer',
    };
    if (sub) entry.subheading = sub;
    return entry;
  });
  return out;
})()`;


