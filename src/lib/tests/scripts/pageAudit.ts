// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const PAGE_AUDIT_SCRIPT = `(() => {
  function meta(name) {
    const el = document.querySelector('meta[name="' + name + '"]');
    return el ? (el.getAttribute('content') || '').trim() : '';
  }
  function og(prop) {
    const el = document.querySelector('meta[property="' + prop + '"]');
    return el ? (el.getAttribute('content') || '').trim() : '';
  }
  const canonicalEl = document.querySelector('link[rel="canonical"]');
  const head = {
    title: (document.title || '').trim(),
    description: meta('description'),
    canonical: canonicalEl ? (canonicalEl.getAttribute('href') || '') : '',
    lang: (document.documentElement.getAttribute('lang') || '').trim(),
    viewport: meta('viewport'),
    robots: meta('robots'),
    ogTitle: og('og:title'),
    ogDescription: og('og:description'),
    ogImage: og('og:image'),
    ogType: og('og:type'),
    ogUrl: og('og:url'),
    twitterCard: meta('twitter:card'),
    twitterTitle: meta('twitter:title'),
    twitterImage: meta('twitter:image'),
  };

  const hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const hierarchy = hs.slice(0, 50).map((h) => ({
    level: parseInt(h.tagName.substring(1), 10),
    text: (h.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
    id: h.id || '',
  }));
  const headings = {
    h1Count: hs.filter((h) => h.tagName === 'H1').length,
    h2Count: hs.filter((h) => h.tagName === 'H2').length,
    h3Count: hs.filter((h) => h.tagName === 'H3').length,
    hierarchy,
  };

  const imgs = Array.from(document.querySelectorAll('img'));
  const imgTotal = imgs.length;
  const imgMissingAlt = imgs.filter((i) => !i.hasAttribute('alt') || (i.getAttribute('alt') || '').trim() === '').length;
  const imgMissingDims = imgs.filter((i) => !i.hasAttribute('width') || !i.hasAttribute('height')).length;
  const imgLazy = imgs.filter((i) => (i.getAttribute('loading') || '').toLowerCase() === 'lazy').length;
  const images = {
    total: imgTotal,
    missingAlt: imgMissingAlt,
    missingAltPct: imgTotal > 0 ? Math.round((imgMissingAlt / imgTotal) * 1000) / 10 : 0,
    missingDims: imgMissingDims,
    lazy: imgLazy,
  };

  const origin = location.origin;
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  let internal = 0, external = 0, nofollow = 0;
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    const rel = (a.getAttribute('rel') || '').toLowerCase();
    if (rel.includes('nofollow')) nofollow++;
    try {
      const url = new URL(href, origin);
      if (url.origin === origin) internal++;
      else external++;
    } catch (e) {}
  }
  const links = { internal, external, nofollow, total: internal + external };

  const ldNodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  const ldTypes = new Set();
  for (const n of ldNodes) {
    try {
      const parsed = JSON.parse(n.textContent || '');
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of arr) {
        if (it && it['@type']) {
          if (Array.isArray(it['@type'])) it['@type'].forEach((t) => ldTypes.add(t));
          else ldTypes.add(it['@type']);
        }
      }
    } catch (e) {}
  }
  const schema = { count: ldNodes.length, types: Array.from(ldTypes) };

  const main = document.querySelector('main') || document.body;
  const wordCount = ((main && main.innerText) || '').trim().split(/\\s+/).filter(Boolean).length;
  const content = {
    wordCount,
    sections: document.querySelectorAll('section').length,
    articles: document.querySelectorAll('article').length,
  };

  return {
    url: location.href,
    head,
    headings,
    images,
    links,
    schema,
    content,
  };
})()`;


