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
    if (el.querySelector('form')) return 'form';
    const docTop = rect.top + window.scrollY;
    if (docTop < viewportH * 0.4 && rect.height > 200) return 'hero';
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

  function addNode(el) {
    if (!el || seen.has(el)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 80) return;
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
    return {
      id: 'section_' + (i + 1),
      type: r.type,
      kind: r.type,
      position: i + 1,
      heading: r.heading,
      subheading: r.subheading,
      selector: buildSelector(r.el),
      rect: {
        x: Math.round(r.rect.left + window.scrollX),
        y: Math.round(r.rect.top + window.scrollY),
        w: Math.round(r.rect.width),
        h: Math.round(r.rect.height),
      },
      aboveFold: r.rect.top < viewportH,
      heightPx: Math.round(r.rect.height),
      visualWeight: Math.round((area / maxArea) * 100),
      elementCount: countElements(r.el),
      childCount: r.el.children ? r.el.children.length : 0,
      repeatedChildren: r.repeated,
      headingText: r.heading,
      containsPrimaryCTA: false,
      containsTrustSignals: false,
      containsForm: !!r.el.querySelector('form'),
      containsPricing: false,
      containsNavigation: r.type === 'nav' || r.type === 'header' || r.type === 'footer',
    };
  });
  return out;
})()`;


