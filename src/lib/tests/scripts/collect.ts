// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

// Exporterad så att (a) testet importerar exakt samma predikat och
// (b) den kan inlinas i COLLECT_SCRIPT via ${isVisible.toString()}.
// Får därför bara referera page-globaler (window/document) + argumenten.
export function isVisible(
  el: Element,
  cs: CSSStyleDeclaration,
  rect: DOMRect,
): boolean {
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  if (parseFloat(cs.opacity || "1") === 0) return false;
  if (rect.width < 1 || rect.height < 1) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;

  // Off-flow elements: skip-links (left:-9999px), sr-only (clip-rect/inset),
  // off-screen transforms (reflekteras i rect via getBoundingClientRect).
  // Begränsat till absolute/fixed för att inte ge falska negativ för
  // normalpositionerade element med negativa scroll-offsets.
  if (cs.position === "absolute" || cs.position === "fixed") {
    const docW = window.innerWidth || document.documentElement.clientWidth;
    const docH = window.innerHeight || document.documentElement.clientHeight;
    if (rect.right <= 0) return false;
    if (rect.bottom <= 0) return false;
    if (rect.left >= docW) return false;
    if (rect.top >= docH) return false;
    if (cs.clip === "rect(0px, 0px, 0px, 0px)") return false;
    if (cs.clipPath === "inset(50%)" || cs.clipPath === "inset(100%)") return false;
  }

  return true;
}

// Diagnostik: körs ENDAST på element som redan passerat isVisible.
// Refererar bara cs/rect → säker att .toString()-inlina i page-context.
export function isSuspectOffFlow(
  cs: CSSStyleDeclaration,
  rect: DOMRect,
): boolean {
  if (cs.position !== "absolute" && cs.position !== "fixed") return false;
  return (
    rect.left < 0 ||
    rect.top < 0 ||
    (rect.width <= 1 && rect.height <= 1) ||
    parseFloat(cs.textIndent) <= -100
  );
}

export const COLLECT_SCRIPT = `(() => {
  ${isVisible.toString()}
  ${isSuspectOffFlow.toString()}

  const SEMANTIC_SEL =
    'button, a[href], input[type=submit], input[type=button], ' +
    '[role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"], ' +
    '[onclick], [tabindex]:not([tabindex="-1"])';

  // Priority for dedupe: lower = more semantic, kept over higher-priority ancestors/descendants.
  function semanticPriority(el) {
    const tag = el.tagName;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'BUTTON' || tag === 'INPUT') return 1;
    if (tag === 'A' && el.hasAttribute('href')) return 2;
    if (role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab' || role === 'switch') return 3;
    if (el.hasAttribute('onclick')) return 4;
    if (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') return 5;
    return 6; // cursor:pointer sweep
  }

  // Walk light + shadow DOM, collect all matching nodes.
  function walk(root, selector, sink) {
    try {
      const list = root.querySelectorAll(selector);
      for (const n of list) sink.push(n);
    } catch (_) { /* ignore */ }
    const all = root.querySelectorAll('*');
    for (const n of all) {
      if (n.shadowRoot) walk(n.shadowRoot, selector, sink);
    }
  }

  const semanticNodes = [];
  walk(document, SEMANTIC_SEL, semanticNodes);

  // Optional cursor:pointer sweep — hard filters to avoid wrappers/cards.
  const semanticSet = new Set(semanticNodes);
  const cursorCandidates = [];
  const allEls = [];
  walk(document, '*', allEls);
  for (const el of allEls) {
    if (semanticSet.has(el)) continue;
    const cs = window.getComputedStyle(el);
    if (cs.cursor !== 'pointer') continue;
    const text = ((el.innerText || el.getAttribute('aria-label') || '') + '').trim();
    if (!text || text.length > 120) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    if (!isVisible(el, cs, rect)) continue;
    // Skip if it has a semantic descendant or ancestor that will be collected.
    let skip = false;
    for (const s of semanticNodes) {
      if (el.contains(s) || s.contains(el)) { skip = true; break; }
    }
    if (skip) continue;
    cursorCandidates.push(el);
  }

  const candidates = semanticNodes.concat(cursorCandidates);

  // Semantic-priority dedupe: when two collected nodes overlap (ancestor/descendant),
  // keep the one with the lower (more semantic) priority. Tie → keep descendant (more specific).
  const kept = [];
  const dropped = new Set();
  for (let i = 0; i < candidates.length; i++) {
    if (dropped.has(candidates[i])) continue;
    const a = candidates[i];
    const pa = semanticPriority(a);
    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue;
      const b = candidates[j];
      if (dropped.has(b)) continue;
      if (!(a.contains(b) || b.contains(a))) continue;
      const pb = semanticPriority(b);
      // Winner = lower priority; tie → descendant wins.
      let loser;
      if (pa < pb) loser = b;
      else if (pb < pa) loser = a;
      else loser = a.contains(b) ? a : b;
      dropped.add(loser);
      if (loser === a) break;
    }
    if (!dropped.has(a)) kept.push(a);
  }

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

  function classifyTag(el) {
    if (el.tagName === 'INPUT') {
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (t === 'submit') return 'input[type=submit]';
      if (t === 'button') return 'input[type=button]';
    }
    if (el.tagName === 'A') return 'a';
    if (el.tagName === 'BUTTON') return 'button';
    if ((el.getAttribute('role') || '').toLowerCase() === 'button') return '[role=button]';
    return el.tagName.toLowerCase();
  }

  function inNavOrFooter(el) {
    let p = el;
    while (p && p !== document.body) {
      const tag = p.tagName;
      const role = (p.getAttribute && p.getAttribute('role') || '').toLowerCase();
      if (tag === 'NAV' || tag === 'HEADER' || tag === 'FOOTER' || role === 'navigation') return true;
      p = p.parentElement;
    }
    return false;
  }

  function hasMeaningfulSurface(cs) {
    const bg = cs.backgroundColor || '';
    const border = cs.border || '';
    // Detect non-transparent bg or visible border.
    const bgSolid = !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    const hasBorder = /\\d+px/.test(border) && !/0px/.test(border.split(' ')[0] || '');
    return bgSolid || hasBorder;
  }

  function classifyCategory(el, cs, rect, text) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if ((tag === 'BUTTON' && type === 'submit') || (tag === 'INPUT' && type === 'submit')) {
      return 'form_submit';
    }
    const role = (el.getAttribute('role') || '').toLowerCase();
    const isButtonish = tag === 'BUTTON' || tag === 'INPUT' || role === 'button' || (tag === 'A' && el.hasAttribute('href'));
    const area = rect.width * rect.height;
    const smallSquareish = rect.width <= 56 && rect.height <= 56;
    const shortLabel = text.length <= 2 || (!text && !!el.getAttribute('aria-label'));
    if (isButtonish && smallSquareish && shortLabel) return 'icon_button';

    const aboveFold = rect.top < window.innerHeight;
    const inChrome = inNavOrFooter(el);

    if (isButtonish) {
      // Multi-signal CTA primary heuristic.
      let score = 0;
      if (aboveFold) score++;
      if (text.length > 0 && text.length <= 32) score++;
      if (area >= 90 * 28) score++; // sizeable click target
      if (hasMeaningfulSurface(cs)) score++;
      if (!inChrome) score++;
      if (score >= 4) return 'cta_primary';
      if (score >= 2 && hasMeaningfulSurface(cs)) return 'cta_secondary';
    }

    if (tag === 'A' && el.hasAttribute('href')) {
      if (inChrome) return 'nav_item';
      return 'link';
    }
    return 'other';
  }

  // Intent ordlistor — partial match, case-insensitive
  const INTENT_RX = {
    conversion: /(book|buy|demo|start|get started|sign[- ]?up|signup|register|subscribe|request|trial|checkout|order|apply|donate|download|add to cart|beställ|köp|boka|prova|kom igång|skapa konto|registrera|gå med|gratis|ladda ner|lägg i (varu)?kund?korg|lägg till|ansök|bidra)/i,
    information: /(learn|read|explore|see how|how |why |about |läs|utforska|så funkar|mer info)/i,
    navigation: /(login|log in|sign in|account|menu|home|profile|settings|logga in|mina sidor|hem|inställningar)/i,
    social: /(facebook|instagram|linkedin|twitter|youtube|tiktok|share|dela)/i,
    utility: /(search|sök|language|språk|cookie|accept|godkänn|contact|kontakt|help|hjälp|faq)/i,
    engagement: /(like|love|save|bookmark|share|comment|reply|follow|subscribe|upvote|downvote|gilla|spara|kommentar|svara|följ|prenumerera|rösta|röst)/i,
  };

  const SOCIAL_HOST_RX = /(facebook|instagram|linkedin|twitter|x\\.com|youtube|tiktok|pinterest|snapchat|reddit|threads|mastodon)\\./i;

  function classifyIntent(el, text, category, rect) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const isFormSubmit = (tag === 'BUTTON' && type === 'submit') || (tag === 'INPUT' && type === 'submit');
    if (isFormSubmit) return 'conversion';

    const href = (el.getAttribute('href') || '');
    if (href.startsWith('tel:') || href.startsWith('mailto:')) return 'utility';
    if (SOCIAL_HOST_RX.test(href)) return 'social';

    // data-* attribute signals (data-event, data-cta, data-track, data-analytics-*)
    const attrBag = [];
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-')) attrBag.push(a.value || '');
    }
    const attrStr = attrBag.join(' ');

    const t = (text || '').trim();
    const probe = t + ' ' + attrStr;

    if (INTENT_RX.conversion.test(probe)) return 'conversion';
    if (INTENT_RX.engagement.test(probe)) return 'engagement';
    if (INTENT_RX.navigation.test(probe)) return 'navigation';
    if (INTENT_RX.social.test(probe)) return 'social';
    if (INTENT_RX.utility.test(probe)) return 'utility';
    if (INTENT_RX.information.test(probe)) return 'information';

    // Position-based fallback: above-fold primary CTA without keyword match → likely conversion.
    if (category === 'cta_primary' && rect.top < window.innerHeight) return 'conversion';

    // Text-less icon buttons in a horizontal row of ≥3 siblings → engagement toolbar.
    if (!t && category === 'icon_button') {
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) =>
          c.tagName === 'BUTTON' || c.tagName === 'A' || (c.getAttribute && c.getAttribute('role') === 'button')
        );
        if (siblings.length >= 3) return 'engagement';
      }
    }

    return 'unknown';
  }

  // Section detection — walk ancestors to find the structural container.
  const viewportH = window.innerHeight || 720;
  function detectSection(el, rect) {
    let p = el.parentElement;
    let inHeader = false, inFooter = false, inNav = false, inMain = false, inAside = false;
    let cardsAncestor = null;
    while (p && p !== document.body) {
      const tag = p.tagName;
      const role = (p.getAttribute && p.getAttribute('role') || '').toLowerCase();
      if (tag === 'NAV' || role === 'navigation') inNav = true;
      else if (tag === 'HEADER' || role === 'banner') inHeader = true;
      else if (tag === 'FOOTER' || role === 'contentinfo') inFooter = true;
      else if (tag === 'MAIN' || role === 'main') inMain = true;
      else if (tag === 'ASIDE') inAside = true;

      // Cards heuristic: container with ≥3 direct children of same tagName + similar height.
      if (!cardsAncestor && p.children && p.children.length >= 3) {
        const kids = Array.from(p.children);
        const firstTag = kids[0].tagName;
        const sameTag = kids.filter((c) => c.tagName === firstTag);
        if (sameTag.length >= 3) {
          const heights = sameTag.slice(0, 4).map((c) => c.getBoundingClientRect().height).filter((h) => h > 30);
          if (heights.length >= 3) {
            const avg = heights.reduce((s, v) => s + v, 0) / heights.length;
            const allSimilar = heights.every((h) => Math.abs(h - avg) / avg < 0.4);
            if (allSimilar) cardsAncestor = p;
          }
        }
      }
      p = p.parentElement;
    }

    if (inFooter) return 'footer';
    if (inNav) return 'nav';
    if (inHeader) return 'header';
    if (cardsAncestor) return 'cards';
    // Hero: above the fold + element is in the first big block of <main> (or just first 1.2 viewports).
    const docTop = rect.top + window.scrollY;
    if (docTop < viewportH * 1.2 && inMain) return 'hero';
    if (docTop < viewportH * 1.0 && !inAside) return 'hero';
    return 'content';
  }



  // WCAG relative luminance + contrast ratio.
  //
  // bgContrast = salience signal: element's EFFECTIVE bg (first opaque
  // ancestor in the stack) vs page bodyBg. Three buckets per backgroundColor:
  //   opaque (alpha == 1)        → use it
  //   transparent (alpha == 0)   → walk to parent
  //   semi-transparent (0<a<1)   → unmeasurable (don't pretend it's opaque)
  // Background-image on any ancestor in the walk → unmeasurable.
  // Walk to <html> with nothing opaque → fall back to bodyBg (yields ratio 1,
  // i.e. "no salience boost" — same as the legacy default).
  // Reported value: number | null. Null = unmeasurable, NOT collapsed to 1.
  function bgInfo(s) {
    if (!s) return { kind: 'transparent' };
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return { kind: 'transparent' };
    const parts = m[1].split(',').map((v) => parseFloat(v.trim()));
    if (parts.length < 3) return { kind: 'transparent' };
    const a = parts.length >= 4 ? parts[3] : 1;
    if (a === 0) return { kind: 'transparent' };
    if (a < 1) return { kind: 'semi' };
    return { kind: 'opaque', rgb: { r: parts[0], g: parts[1], b: parts[2] } };
  }
  function parseRgb(s) {
    const info = bgInfo(s);
    return info.kind === 'opaque' ? info.rgb : null;
  }
  function relLum(c) {
    const ch = [c.r, c.g, c.b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function contrastRatio(a, b) {
    const la = relLum(a), lb = relLum(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  const bodyBg = parseRgb(window.getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255 };

  // Returns rgb | null. Null = unmeasurable (bg-image or semi-transparent in stack).
  function effectiveBgRgb(el) {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const cs = window.getComputedStyle(cur);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const info = bgInfo(cs.backgroundColor);
      if (info.kind === 'opaque') return info.rgb;
      if (info.kind === 'semi') return null;
      cur = cur.parentElement;
    }
    return bodyBg;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function norm(v, lo, hi) { return (clamp(v, lo, hi) - lo) / (hi - lo); }

  const docH = document.documentElement.scrollHeight || window.innerHeight;
  const docW = document.documentElement.scrollWidth || window.innerWidth;

  // First pass: collect raw records
  const raw = [];
  let maxArea = 1;
  for (const el of kept) {
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    if (!isVisible(el, cs, rect)) continue;
    const text = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '').trim().replace(/\\s+/g, ' ').slice(0, 120);
    const attrs = {};
    for (const a of Array.from(el.attributes)) {
      attrs[a.name] = (a.value || '').slice(0, 200);
    }

    const docTop = rect.top + window.scrollY;
    const docLeft = rect.left + window.scrollX;
    const yPercent = docH > 0 ? (docTop / docH) * 100 : 0;
    const xPercent = docW > 0 ? ((docLeft + rect.width / 2) / docW) * 100 : 0;
    const viewportZone =
      docTop < window.innerHeight ? 'above_fold' :
      docTop < 2 * window.innerHeight ? 'mid_page' :
      'below_fold';

    const area = rect.width * rect.height;
    if (area > maxArea) maxArea = area;
    const fontSize = parseFloat(cs.fontSize) || 14;
    const fontWeight = parseInt(cs.fontWeight, 10) || 400;
    const elBg = effectiveBgRgb(el);
    const backgroundContrast = elBg ? contrastRatio(elBg, bodyBg) : null;

    const suspectOffFlow = isSuspectOffFlow(cs, rect);
    raw.push({
      el, rect, cs, text, attrs,
      docTop, docLeft, yPercent, xPercent, viewportZone,
      area, fontSize, fontWeight, backgroundContrast,
      suspectOffFlow,
    });
  }

  // Second pass: normalize visualWeight score and emit
  const out = [];
  for (const r of raw) {
    const areaN = r.area / maxArea;                  // 0–1
    const fontN = norm(r.fontSize, 10, 48);           // 0–1
    const weightN = norm(r.fontWeight, 300, 800);     // 0–1
    // Unmeasurable contrast → treat as neutral (1) for scoring only; the
    // emitted value below stays null so it's distinguishable downstream.
    const contrastForScore = r.backgroundContrast == null ? 1 : r.backgroundContrast;
    const contrastN = norm(contrastForScore, 1, 10); // 0–1
    const score = Math.round((areaN * 0.40 + fontN * 0.20 + weightN * 0.10 + contrastN * 0.30) * 100);

    const cat = classifyCategory(r.el, r.cs, r.rect, r.text);
    out.push({
      text: r.text,
      tagName: classifyTag(r.el),
      selector: buildSelector(r.el),
      category: cat,
      intent: classifyIntent(r.el, r.text, cat, r.rect),
      section: detectSection(r.el, r.rect),
      href: r.el.tagName === 'A' ? (r.el.getAttribute('href') || null) : null,
      disabled: !!r.el.disabled || r.el.getAttribute('aria-disabled') === 'true',
      visible: true,
      aboveFold: r.viewportZone === 'above_fold',

      rect: { x: Math.round(r.docLeft), y: Math.round(r.docTop), w: Math.round(r.rect.width), h: Math.round(r.rect.height) },
      position: {
        viewportZone: r.viewportZone,
        yPercent: Math.round(r.yPercent * 10) / 10,
        xPercent: Math.round(r.xPercent * 10) / 10,
      },
      visualWeight: {
        area: Math.round(r.area),
        fontSize: Math.round(r.fontSize),
        fontWeight: r.fontWeight,
        backgroundContrast: r.backgroundContrast == null ? null : Math.round(r.backgroundContrast * 10) / 10,
        score,
      },
      attributes: r.attrs,
      computedStyles: {
        color: r.cs.color,
        backgroundColor: r.cs.backgroundColor,
        fontSize: r.cs.fontSize,
        fontWeight: r.cs.fontWeight,
        padding: r.cs.padding,
        borderRadius: r.cs.borderRadius,
        border: r.cs.border,
        cursor: r.cs.cursor,
        display: r.cs.display,
      },
    });
  }
  return out;
})()`;


