// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const CTAS_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;

  const INTENT_RX = {
    conversion: /(book|buy|demo|start|get started|sign[- ]?up|signup|register|subscribe|request|trial|checkout|order|apply|donate|download|add to cart|best[äa]ll|k[öo]p|boka|prova|kom ig[åa]ng|skapa konto|registrera|ans[öo]k)/i,
    navigation: /(login|log in|sign in|account|menu|home|profile|settings|logga in|mina sidor|hem|inst[äa]llningar)/i,
    utility: /(search|s[öo]k|language|spr[åa]k|cookie|accept|godk[äa]nn|contact|kontakt|help|hj[äa]lp|faq)/i,
    social: /(facebook|instagram|linkedin|twitter|youtube|tiktok|share|dela)/i,
  };

  function buildSelector(el) {
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return '#' + el.id;
    const parent = el.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      const idx = same.indexOf(el) + 1;
      return el.tagName.toLowerCase() + ':nth-of-type(' + idx + ')';
    }
    return el.tagName.toLowerCase();
  }

  function isVisible(el) {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    return true;
  }

  function sectionKind(el, rect) {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const tag = p.tagName;
      const role = (p.getAttribute && p.getAttribute('role') || '').toLowerCase();
      if (tag === 'FOOTER' || role === 'contentinfo') return 'footer';
      if (tag === 'NAV' || role === 'navigation') return 'nav';
      if (tag === 'HEADER' || role === 'banner') return 'header';
      p = p.parentElement;
    }
    const docTop = rect.top + window.scrollY;
    if (docTop < viewportH * 1.1) return 'hero';
    return 'content';
  }

  function hasSurface(cs) {
    const bg = cs.backgroundColor || '';
    return !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  }

  function classifyCategory(el, cs, rect, text) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if ((tag === 'BUTTON' && type === 'submit') || (tag === 'INPUT' && type === 'submit')) return 'form_submit';
    const role = (el.getAttribute('role') || '').toLowerCase();
    const isButtonish = tag === 'BUTTON' || tag === 'INPUT' || role === 'button' || (tag === 'A' && el.hasAttribute('href'));
    const area = rect.width * rect.height;
    if (isButtonish && rect.width <= 56 && rect.height <= 56 && (!text || text.length <= 2)) return 'icon_button';
    if (isButtonish) {
      let score = 0;
      if (rect.top < viewportH) score++;
      if (text.length > 0 && text.length <= 32) score++;
      if (area >= 90 * 28) score++;
      if (hasSurface(cs)) score++;
      if (score >= 4) return 'cta_primary';
      if (score >= 2 && hasSurface(cs)) return 'cta_secondary';
    }
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    return 'other';
  }

  function classifyIntent(text, category, rect) {
    const t = (text || '').trim();
    if (INTENT_RX.conversion.test(t)) return 'conversion';
    if (INTENT_RX.navigation.test(t)) return 'navigation';
    if (INTENT_RX.social.test(t)) return 'social';
    if (INTENT_RX.utility.test(t)) return 'utility';
    if (category === 'cta_primary' && rect.top < viewportH) return 'conversion';
    return 'unknown';
  }

  // Collect candidate CTAs (buttons + anchor links with visible surface or strong CTA-ish text)
  const CAROUSEL_NAV_RX = /\\b(prev|previous|next|forward|back|föreg[åa]ende|n[äa]sta|slide|arrow|scroll[- ]?(left|right|prev|next)|carousel|swipe)\\b/i;
  function isCarouselNav(el, text) {
    const aria = (el.getAttribute('aria-label') || '').trim();
    const title = (el.getAttribute('title') || '').trim();
    const cls = (el.className && typeof el.className === 'string') ? el.className : '';
    if (aria && CAROUSEL_NAV_RX.test(aria)) return true;
    if (title && CAROUSEL_NAV_RX.test(title)) return true;
    if (/\\b(swiper|slick|embla|keen-slider|glide|splide|carousel|slider)[-_]?(button|nav|arrow|prev|next)\\b/i.test(cls)) return true;
    // Tiny icon-only buttons next to a carousel ancestor with just symbol text
    if ((!text || text.length <= 2) && /[<>‹›←→]/.test(text || '')) return true;
    return false;
  }

  const SEL = 'button, a[href], input[type=submit], input[type=button], [role="button"]';
  const nodes = Array.from(document.querySelectorAll(SEL));
  const raw = [];
  for (const el of nodes) {
    if (!isVisible(el)) continue;
    if (el.closest && el.closest('[data-lovable-cookie-root="1"]')) continue;
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const text = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    if (isCarouselNav(el, text)) continue;
    const category = classifyCategory(el, cs, rect, text);
    if (category === 'other' || category === 'link') continue; // keep button-ish + form_submit only
    raw.push({
      el, rect, cs, text, category,
      intent: classifyIntent(text, category, rect),
      section: sectionKind(el, rect),
    });
  }

  // Pre-fetch trust signal + form rects for distance calc
  const trustRects = [];
  document.querySelectorAll('[class*="testimonial" i], [class*="review" i], [class*="trust" i], blockquote').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) trustRects.push({ cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
  });
  document.querySelectorAll('[class*="star" i], [class*="logo" i]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) trustRects.push({ cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
  });
  const formRects = Array.from(document.querySelectorAll('form')).map((f) => {
    const r = f.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });

  function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

  function minDist(cx, cy, arr) {
    if (arr.length === 0) return 9999;
    let m = Infinity;
    for (const r of arr) { const d = dist(cx, cy, r.cx, r.cy); if (d < m) m = d; }
    return Math.round(m);
  }

  function formDistance(el, cx, cy) {
    for (const f of formRects) {
      if (cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h) return 0;
    }
    return minDist(cx, cy, formRects);
  }

  // Output
  const out = raw.map((r) => {
    const cx = r.rect.left + r.rect.width / 2;
    const cy = r.rect.top + r.rect.height / 2;
    // competingActions: CTAs in same section excluding self
    let competing = 0;
    for (const o of raw) {
      if (o === r) continue;
      if (o.section !== r.section) continue;
      if (o.category === 'cta_primary' || o.category === 'cta_secondary' || o.category === 'form_submit') competing++;
    }
    return {
      text: r.text,
      intent: r.intent,
      category: r.category,
      section: r.section,
      aboveFold: r.rect.top < viewportH,
      visualWeight: Math.round(r.rect.width * r.rect.height),
      competingActions: competing,
      nearestTrustSignalDistance: minDist(cx, cy, trustRects),
      nearestFormDistance: formDistance(r.el, cx, cy),
      selector: buildSelector(r.el),
      rect: {
        x: Math.round(r.rect.left + window.scrollX),
        y: Math.round(r.rect.top + window.scrollY),
        w: Math.round(r.rect.width),
        h: Math.round(r.rect.height),
      },
    };
  });
  return out;
})()`;


