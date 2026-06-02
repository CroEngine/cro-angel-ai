// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const VISUAL_HIERARCHY_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;
  const docH = document.documentElement.scrollHeight || viewportH;
  const docW = document.documentElement.scrollWidth || window.innerWidth || 1280;

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
  function contrast(a, b) {
    const la = relLum(a), lb = relLum(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  const bodyBg = parseRgb(window.getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255 };

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
    const elBg = parseRgb(cs.backgroundColor);
    const elFg = parseRgb(cs.color) || { r: 0, g: 0, b: 0 };
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

  return deduped.map((s) => {
    const sk = sectionKind(s.el, s.rect);
    return {
      selector: buildSelector(s.el),
      text: s.text,
      role: role(s.el, sk),
      tagName: s.el.tagName.toLowerCase(),
      visualWeight: Math.round((s.score / maxScore) * 100),
      area: Math.round(s.area),
      fontSize: Math.round(s.fontSize),
      fontWeight: s.fontWeight,
      contrast: Math.round(s.con * 10) / 10,
      position: {
        xPct: Math.round(((s.rect.left + s.rect.width / 2) / docW) * 100),
        yPct: Math.round(((s.rect.top + window.scrollY) / docH) * 100),
      },
      aboveFold: s.rect.top < viewportH,
      section: sk,
    };
  });
})()`;



