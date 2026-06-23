// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const SECTIONS_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;

  function buildSelector(el) {
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return '#' + el.id;
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
    if (testId) {
      const sel = el.tagName.toLowerCase() + '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
    }
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-') && a.value && a.value.length < 64) {
        const sel = el.tagName.toLowerCase() + '[' + a.name + '="' + a.value.replace(/"/g, '\\\\"') + '"]';
        try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
      }
    }
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur !== document.body && cur.nodeType === 1 && depth < 10) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\\w-]*$/.test(cur.id)) {
        parts.unshift('#' + cur.id);
        const candidate = parts.join(' > ');
        try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch (e) {}
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch (e) {}
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
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

  // Heading text as a human reads it: innerText (drops display:none responsive/
  // a11y copies) + collapse an exact whole-phrase repetition (>=3-word unit) so
  // a headline duplicated 2-3x into one element isn't read as "X X X". Mirror of
  // the helper in pageAudit.ts (scripts are self-contained, no shared imports).
  function cleanHeadingText(el) {
    if (!el) return '';
    var t = ((el.innerText || el.textContent || '') + '').trim().replace(/\\s+/g, ' ');
    var w = t.split(' ');
    for (var p = 3; p <= w.length / 2; p++) {
      if (w.length % p !== 0) continue;
      var ok = true;
      for (var i = p; i < w.length; i++) { if (w[i] !== w[i % p]) { ok = false; break; } }
      if (ok) { w = w.slice(0, p); break; }
    }
    return w.join(' ');
  }

  // Largest-font visible text run inside a section — the DISPLAY headline for a
  // section that has NO semantic heading (h1–h4), e.g. a styled-<div> hero like
  // warby-parker "SEE SUMMER BETTER" / glossier / spotify's app-shell. This is a
  // hero-headline FALLBACK only and is deliberately NOT passed to classifyType,
  // so it can never move a section's type or sectionOrder (the trap the earlier
  // attempt hit). Deterministic for a frozen DOM + fixed replay viewport: ranks
  // by computed font-size, then rendered area, then DOM order (strict-greater
  // keeps the first winner).
  function prominentText(el) {
    const nodes = el.querySelectorAll('h5,h6,p,span,div,a,strong,b,em,li,blockquote');
    let best = '', bestSize = -1, bestArea = -1;
    const limit = nodes.length < 600 ? nodes.length : 600;
    for (let i = 0; i < limit; i++) {
      const node = nodes[i];
      if (node.tagName === 'BUTTON') continue;
      // Direct text nodes only — never a wrapper's concatenated descendant text.
      let txt = '';
      const kids = node.childNodes;
      for (let c = 0; c < kids.length; c++) {
        if (kids[c].nodeType === 3) txt += kids[c].nodeValue;
      }
      txt = txt.replace(/\\s+/g, ' ').trim();
      if (txt.length < 3 || txt.length > 200) continue;
      if (txt.split(' ').length < 2) continue; // single word ~ a UI label
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue; // display:none / collapsed
      const st = window.getComputedStyle(node);
      if (st.visibility === 'hidden' || parseFloat(st.opacity) === 0) continue;
      const size = parseFloat(st.fontSize) || 0;
      const area = r.width * r.height;
      if (size > bestSize || (size === bestSize && area > bestArea)) {
        best = txt; bestSize = size; bestArea = area;
      }
    }
    return best.slice(0, 200);
  }

  function headings(el) {
    const h1s = Array.from(el.querySelectorAll('h1'));
    let heading = '';
    if (h1s.length > 0) {
      heading = h1s.map((h) => cleanHeadingText(h)).filter(Boolean).join(' ');
    } else {
      const h = el.querySelector('h2,h3,h4');
      heading = h ? cleanHeadingText(h) : '';
    }
    heading = heading.replace(/\\s+/g, ' ').slice(0, 200);
    const sub = el.querySelector('h2,h3,p');
    let subheading = '';
    if (sub && (h1s.length === 0 || h1s.indexOf(sub) === -1)) {
      subheading = cleanHeadingText(sub).slice(0, 200);
    }
    // Display-only fallback for a section with no semantic heading. Kept OUT of
    // the heading field so classifyType + sectionOrder are byte-for-byte unaffected.
    const displayHeading = heading ? '' : prominentText(el);
    return { heading, subheading, displayHeading };
  }

  function classifyType(el, rect, repeated, heading) {
    const tag = el.tagName;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'NAV' || role === 'navigation') return 'nav';
    if (tag === 'FOOTER' || role === 'contentinfo') return 'footer';
    if (tag === 'HEADER' || role === 'banner') return 'header';
    if (tag === 'ASIDE' || role === 'complementary') return 'aside';
    // Belt-and-suspenders: backstop hero/header misclassification if a
    // cookie-banner residue slips past addNode()'s isCookieBanner filter.
    const cookieTxt = (el.innerText || '').toLowerCase().slice(0, 600);
    if (/accept (all )?cookies?|godk[äa]nn (alla )?cookies|we use cookies|vi anv[äa]nder cookies/.test(cookieTxt)) {
      return 'content';
    }
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
  let raw = [];

  // Cache total element count once for wrapper-detection below.
  const totalElements = document.body.querySelectorAll('*').length;

  function isCookieBanner(el) {
    const id = (el.id || '').toLowerCase();
    const cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
    const aria = ((el.getAttribute && el.getAttribute('aria-label')) || '').toLowerCase();
    const role = ((el.getAttribute && el.getAttribute('role')) || '').toLowerCase();
    const COOKIE_RX = /(cookie|consent|gdpr|ccpa|onetrust|cookiebot|trustarc|usercentrics|didomi|osano|klaro|truste|quantcast|iubenda|secureprivacy|termly|cookieyes|cookiehub|ketch|tealium|sourcepoint)/;
    if (COOKIE_RX.test(id) || COOKIE_RX.test(cls) || COOKIE_RX.test(aria)) {
      return true;
    }
    if (role === 'dialog' || role === 'alertdialog') {
      const txt = (el.innerText || '').toLowerCase().slice(0, 400);
      if (/cookie|consent|gdpr|samtycke/.test(txt)) {
        return true;
      }
    }
    // Inspect a couple of close ancestors so deeply-nested banner inner divs
    // are also filtered.
    let p = el.parentElement;
    let hops = 0;
    while (p && hops++ < 3) {
      const pid = (p.id || '').toLowerCase();
      const pcls = (p.className && typeof p.className === 'string') ? p.className.toLowerCase() : '';
      if (COOKIE_RX.test(pid) || COOKIE_RX.test(pcls)) {
        return true;
      }
      p = p.parentElement;
    }
    // Pure content signal: short, banner-shaped text + cookie CTA wording.
    // Triggers oavsett klass/id/role så portal-rendered banners fångas
    // (Greenhouse/Rippling-mönster). Nav-guard hindrar mega-menyer med
    // "Cookie policy"-länkar från att matcha (Personio/HiBob-mönster).
    const isNav = el.tagName === 'NAV' || (el.closest && el.closest('nav, header') !== null);
    const rect = el.getBoundingClientRect();
    const text = (el.innerText || '').toLowerCase();
    if (!isNav && rect.height > 0 && rect.height < viewportH * 0.9 && text.length > 0 && text.length < 1500) {
      const BANNER_PHRASES = /(we use cookies|this (site|website) uses cookies|cookie (preferences|settings|policy)|by clicking ["“']?accept|manage (your )?cookies|your privacy choices|tracking technologies|essential cookies|f[öo]r att f[öo]rb[äa]ttra din upplevelse|vi anv[äa]nder cookies|samtycke till cookies)/;
      const ACCEPT_CTA = /(accept (all )?cookies?|allow all|godk[äa]nn (alla )?cookies|till[åa]t alla|acceptera alla|reject (all )?cookies?|avvisa alla|neka alla)/;
      if (BANNER_PHRASES.test(text) || ACCEPT_CTA.test(text)) {
        return true;
      }
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

      if (tooBig || tooTall) {
        // Skip this wrapper as a section, but recurse into its direct
        // children so nested real sections aren't lost with the subtree.
        try {
          const kids = el.children;
          for (let i = 0; i < kids.length; i++) addNode(kids[i]);
        } catch (_) {}
        return;
      }
    }
    seen.add(el);
    const repeated = repeatedChildrenCount(el);
    const hh = headings(el);
    const type = classifyType(el, rect, repeated, hh.heading);
    raw.push({
      el, rect, repeated, heading: hh.heading, subheading: hh.subheading,
      displayHeading: hh.displayHeading, type,
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

  // Dedup: drop entries fully contained inside another entry that shares the
  // same heading (or has no distinct heading of its own). Preserves sibling
  // cards with unique headings; drops structural duplicates like a <header>
  // nested inside a hero <div> that share the page's h1.
  function isContained(inner, outer) {
    const sy = document.documentElement.scrollTop || document.body.scrollTop || 0;
    const ir = inner.rect, or = outer.rect;
    const iTop = ir.top + sy;
    const iBot = iTop + ir.height;
    const oTop = or.top + sy;
    const oBot = oTop + or.height;
    return iTop >= oTop - 4 && iBot <= oBot + 4
        && ir.left >= or.left - 4 && (ir.left + ir.width) <= (or.left + or.width) + 4;
  }
  function normHeading(h) {
    return (h || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }
  const deduped = [];
  for (const cand of raw) {
    let drop = false;
    for (const kept of deduped) {
      if (!isContained(cand, kept)) continue;
      const ch = normHeading(cand.heading);
      const kh = normHeading(kept.heading);
      if (ch === '' || ch === kh) { drop = true; break; }
    }
    if (!drop) deduped.push(cand);
  }
  raw = deduped;



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
    // Only present for no-semantic-heading sections; consumed solely by
    // deriveHero as a headline fallback (not part of the normalized golden).
    if (r.displayHeading) entry.displayHeading = r.displayHeading;
    return entry;
  });
  return out;
})()`;


