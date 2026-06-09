// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const VISUAL_HIERARCHY_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;
  const docH = document.documentElement.scrollHeight || viewportH;
  const docW = document.documentElement.scrollWidth || window.innerWidth || 1280;

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
  function contrast(a, b) {
    const la = relLum(a), lb = relLum(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  const bodyBg = parseRgb(window.getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255 };

  // Walks ancestors (incl. self). Returns rgb of first opaque ancestor bg, or
  // null if any ancestor in the stack has bg-image or alpha<1 (unmeasurable
  // composite). Reaching root with nothing opaque → bodyBg fallback.
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

  function sectionKind(el, rect) {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const tag = p.tagName;
      if (tag === 'FOOTER') return 'footer';
      if (tag === 'NAV') return 'nav';
      if (tag === 'HEADER') return 'header';
      p = p.parentElement;
    }
    const docTop = rect.top + window.scrollY;
    if (docTop < viewportH * 1.1) return 'hero';
    return 'content';
  }

  function role(el, sectionKind) {
    const tag = el.tagName;
    const attrRole = (el.getAttribute && el.getAttribute('role') || '').toLowerCase();
    const isButtonLike = tag === 'BUTTON' || attrRole === 'button' ||
      (tag === 'A' && !!el.getAttribute('href'));
    if (sectionKind === 'hero') {
      if (/^H[1-3]$/.test(tag)) return 'hero_headline';
      if (isButtonLike) return 'hero_cta';
    }
    if (sectionKind === 'nav' || sectionKind === 'header') {
      if (isButtonLike) return 'nav_item';
    }
    if (sectionKind === 'footer') {
      if (isButtonLike) return 'footer_link';
    }
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'IMG') return 'image';
    if (tag === 'P') return 'paragraph';
    return 'other';
  }

  const SEL = 'h1, h2, h3, button, a[href], img, p, [role="button"]';
  const candidates = Array.from(document.querySelectorAll(SEL));
  const scored = [];
  for (const el of candidates) {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (parseFloat(cs.opacity || '1') === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) continue;
    const area = rect.width * rect.height;
    const fontSize = parseFloat(cs.fontSize) || 14;
    const fontWeight = parseInt(cs.fontWeight, 10) || 400;
    const elBg = effectiveBgRgb(el);
    const elFg = parseRgb(cs.color) || { r: 0, g: 0, b: 0 };
    // bg unmeasurable (image / semi-transparent in stack) → fall back to
    // fg-vs-bodyBg readability proxy (legacy behaviour for unknown bg).
    const con = elBg ? contrast(elBg, bodyBg) : contrast(elFg, bodyBg);
    const score = area * (fontSize / 16) * (con / 4) * (fontWeight / 400);
    scored.push({ el, rect, fontSize, fontWeight, con, area, score });
  }
  scored.sort((a, b) => b.score - a.score);

  // Dedupe near-identical entries (e.g. h1 + p with same text/styling) and
  // drop entries with empty text — they carry no signal for LLM analysis.
  const seenKeys = new Set();
  const deduped = [];
  for (const s of scored) {
    const text = ((s.el.innerText || s.el.getAttribute('alt') || s.el.getAttribute('aria-label') || '') + '')
      .trim().replace(/\\s+/g, ' ').slice(0, 100);
    if (!text) continue;
    const key = text + '|' + Math.round(s.fontSize) + '|' + Math.round(s.area / 1000);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push({ ...s, text });
    if (deduped.length >= 20) break;
  }
  const maxScore = deduped[0] ? deduped[0].score : 1;

  function deriveWcagLevel(ratio, fontSizePx, fontWeight) {
    if (ratio === null || !isFinite(ratio)) return null;
    const isLarge = fontSizePx >= 18 || (fontSizePx >= 14 && fontWeight >= 700);
    if (ratio >= 7) return 'AAA';
    if (ratio >= 4.5) return 'AA';
    if (ratio >= 3 && isLarge) return 'AA-large';
    return 'FAIL';
  }

  return deduped.map((s) => {
    const sk = sectionKind(s.el, s.rect);
    const contrastRatio = Math.round(s.con * 10) / 10;
    return {
      selector: buildSelector(s.el),
      text: s.text,
      role: role(s.el, sk),
      tagName: s.el.tagName.toLowerCase(),
      visualWeight: Math.round((s.score / maxScore) * 100),
      area: Math.round(s.area),
      fontSize: Math.round(s.fontSize),
      fontWeight: s.fontWeight,
      contrast: contrastRatio,
      wcagLevel: deriveWcagLevel(contrastRatio, s.fontSize, s.fontWeight),
      position: {
        xPct: Math.round(((s.rect.left + s.rect.width / 2) / docW) * 100),
        yPct: Math.round(((s.rect.top + window.scrollY) / docH) * 100),
      },
      aboveFold: s.rect.top < viewportH,
      section: sk,
    };
  });
})()`;



