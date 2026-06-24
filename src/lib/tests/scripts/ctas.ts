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
    if (!!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return true;
    // Outline / ghost buttons have no fill but a visible border — still a
    // surfaced, clickable region and a common modern CTA style ("Contact sales").
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const bs = cs.borderTopStyle || 'none';
    return bw > 0 && bs !== 'none' && bs !== 'hidden';
  }

  function parseRgb(s) {
    if (!s) return null;
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((v) => parseFloat(v.trim()));
    if (parts.length < 3) return null;
    const a = parts.length >= 4 ? parts[3] : 1;
    if (a === 0) return null;
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  function relLum(c) {
    const ch = [c.r, c.g, c.b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function wcagContrast(fgCss, bgCss) {
    const fg = parseRgb(fgCss);
    const bg = parseRgb(bgCss);
    if (!fg || !bg) return null;
    const L1 = relLum(fg), L2 = relLum(bg);
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }
  function deriveWcagLevel(ratio, fontSizePx, fontWeight) {
    if (ratio === null) return null;
    const isLarge = fontSizePx >= 18 || (fontSizePx >= 14 && fontWeight >= 700);
    if (ratio >= 7) return 'AAA';
    if (ratio >= 4.5) return 'AA';
    if (ratio >= 3 && isLarge) return 'AA-large';
    return 'FAIL';
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
      // Customer-logo / image link: it has NO visible text of its own (the label
      // text passed in comes from img alt / aria-label) and its content is an
      // image. These fill "trusted by" logo strips and otherwise score
      // cta_primary — notion's hero logos (OpenAI, Figma, Ramp, Cursor, Vercel)
      // each became cta_primary/conversion, so deriveHero took "OpenAI" as the
      // hero CTA over "Get Notion free". Social proof, not a CTA — drop to 'link'
      // (trust detection counts them as customer_logos where appropriate).
      const ownText = ((el.innerText || el.value || '') + '').trim();
      if (!ownText && el.querySelector && el.querySelector('img, svg, picture')) return 'link';
      let score = 0;
      if (rect.top < viewportH) score++;
      if (text.length > 0 && text.length <= 32) score++;
      // Button-sized. The old 90×28 floor missed normal small buttons — linear's
      // above-fold "Sign up" (≈78×30 = 2334px²) scored 3 → secondary, so the hero
      // CTA came back empty. 64×28 still excludes inline links / sub-icon chrome.
      if (area >= 64 * 28) score++;
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

  // Accessibility skip-links (<a href="#main">Skip to content</a>) are
  // button-ish anchors that score as cta_primary but are never CTAs — they're
  // keyboard jump links. Exclude by canonical phrasing.
  function isSkipLink(text) {
    const t = (text || '').trim();
    if (!/^(skip|jump)\\b/i.test(t)) return false;
    return /^(skip|jump)\\s+(to\\s+)?(the\\s+)?(main\\s+)?(content|navigation|nav|search|menu|main)\\b/i.test(t);
  }

  const SEL = 'button, a[href], input[type=submit], input[type=button], [role="button"]';
  const nodes = Array.from(document.querySelectorAll(SEL));
  const raw = [];
  for (const el of nodes) {
    if (!isVisible(el)) continue;
    if (el.closest && el.closest('[data-lovable-cookie-root="1"]')) {
      continue;
    }
    const rect = el.getBoundingClientRect();

    const cs = window.getComputedStyle(el);
    const text = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    if (isCarouselNav(el, text)) continue;
    if (isSkipLink(text)) continue;
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
    const fontSizePx = parseFloat(r.cs.fontSize) || 14;
    const fontWeightN = parseInt(r.cs.fontWeight, 10) || 400;
    const contrastRatio = wcagContrast(r.cs.color, r.cs.backgroundColor);
    const wcagLevel = deriveWcagLevel(contrastRatio, fontSizePx, fontWeightN);
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
      contrastRatio: contrastRatio,
      wcagLevel: wcagLevel,
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


