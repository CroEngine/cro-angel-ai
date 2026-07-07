// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports of server state; the shared classifier below
// is inlined into the script string via toString(), never closed over.

import { classifyIntentShared, formKindShared } from "./shared/intent";
import {
  classifyCategoryShared,
  hasMeaningfulSurfaceShared,
  HERO_MAX_VIEWPORTS,
  inNavOrFooterShared,
} from "./shared/category";

export const CTAS_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;

  // THE shared intent classifier — inlined from shared/intent.ts, same source
  // COLLECT_SCRIPT uses (B1). This file used to carry its own drifted copy of
  // the wordlists; it no longer defines any.
  ${classifyIntentShared.toString()}
  ${formKindShared.toString()}

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
    if (docTop < viewportH * ${HERO_MAX_VIEWPORTS}) return 'hero';
    return 'content';
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

  // Shared category classification (B2) — same 5-signal rule as COLLECT_SCRIPT
  // (this script used to require above-fold for cta_primary; a prominent
  // below-fold buy button can be primary in both scripts now).
  ${hasMeaningfulSurfaceShared.toString()}
  ${inNavOrFooterShared.toString()}
  ${classifyCategoryShared.toString()}

  function classifyCategory(el, cs, rect, text) {
    return classifyCategoryShared(
      el.tagName,
      el.getAttribute('type') || '',
      el.getAttribute('role') || '',
      el.tagName === 'A' && el.hasAttribute('href'),
      rect.width, rect.height, rect.top,
      (text || '').length,
      hasMeaningfulSurfaceShared(cs.backgroundColor || '', cs.border || ''),
      inNavOrFooterShared(el),
      viewportH,
    );
  }

  function classifyIntent(el, text, category, rect) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const isFormSubmit = (tag === 'BUTTON' && type === 'submit') || (tag === 'INPUT' && type === 'submit');
    const href = (el.getAttribute('href') || '');
    const attrBag = [];
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-')) attrBag.push(a.value || '');
    }
    // Same-page anchor (flik/TOC) — samma beräkning som collect.ts (regel 6 i
    // classifyIntentShared): flikar får inte positions-fallbackas till
    // conversion. Deklarerad URL (canonical/og:url) som bas, location som
    // fallback — annars flippar regeln aldrig i MHTML-replay (file://-location
    // vs absoluta https-själv-URL:er) och live/replay divergerar.
    let samePageAnchor = false;
    if (el.tagName === 'A' && href) {
      try {
        let pageUrl = new URL(location.href);
        const canon = document.querySelector('link[rel="canonical"]');
        const og = document.querySelector('meta[property="og:url"]');
        const declared = (canon && canon.getAttribute('href')) || (og && og.getAttribute('content')) || '';
        if (declared && /^https?:/i.test(declared)) pageUrl = new URL(declared);
        const u = new URL(href, pageUrl.href);
        samePageAnchor = !!u.hash && u.origin === pageUrl.origin &&
          u.pathname === pageUrl.pathname && u.search === pageUrl.search;
      } catch (e) { /* trasig href -> ingen flagga */ }
    }
    return classifyIntentShared(
      (text || '').trim(), href, attrBag.join(' '), category, isFormSubmit, rect.top < viewportH,
      isFormSubmit ? formKindShared(el) : '', samePageAnchor,
    );
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
    if (el.closest && el.closest('[data-lovable-cookie-root="1"]')) {
      continue;
    }
    // Never audit Angel's own runtime injections (C1) — same rule as collect.
    if (el.closest && el.closest('[data-angel-injected], .angel-badge, .angel-sticky-cta, .angel-secondary-cta, #angel-debug')) {
      continue;
    }
    const rect = el.getBoundingClientRect();

    const cs = window.getComputedStyle(el);
    const text = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    if (isCarouselNav(el, text)) continue;
    const category = classifyCategory(el, cs, rect, text);
    if (category === 'other' || category === 'link' || category === 'nav_item') continue; // keep button-ish + form_submit only
    raw.push({
      el, rect, cs, text, category,
      intent: classifyIntent(el, text, category, rect),
      section: sectionKind(el, rect),
    });
  }

  // NOTE (B4): trust proximity is NOT computed here anymore. This script used
  // to guess trust locations from class names ([class*="trust"], blockquote…),
  // which disagreed with the real trust engine in the same report ("Trust
  // signals: 1 above fold" next to "trust 9999px"). The server now computes
  // nearestTrustSignalDistance from TRUST_SIGNALS_SCRIPT's canonical rects
  // (audit-helpers.ts computeTrustProximity); this script emits null.
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
      // Filled server-side from the canonical trust rects (B4); null when the
      // page has no positioned trust signal — never a fake 9999.
      nearestTrustSignalDistance: null,
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


