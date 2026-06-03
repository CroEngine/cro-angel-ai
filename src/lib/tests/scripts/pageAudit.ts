// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const PAGE_AUDIT_SCRIPT = `(() => {
  function nullIfEmpty(s) { const v = (s || '').trim(); return v === '' ? null : v; }
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
    canonical: nullIfEmpty(canonicalEl ? (canonicalEl.getAttribute('href') || '') : ''),
    lang: (document.documentElement.getAttribute('lang') || '').trim(),
    viewport: nullIfEmpty(meta('viewport')),
    robots: nullIfEmpty(meta('robots')),
    ogTitle: og('og:title'),
    ogDescription: og('og:description'),
    ogImage: nullIfEmpty(og('og:image')),
    ogType: nullIfEmpty(og('og:type')),
    ogUrl: nullIfEmpty(og('og:url')),
    twitterCard: nullIfEmpty(meta('twitter:card')),
    twitterTitle: nullIfEmpty(meta('twitter:title')),
    twitterImage: nullIfEmpty(meta('twitter:image')),
  };

  const hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const h1Texts = hs
    .filter((h) => h.tagName === 'H1')
    .slice(0, 2)
    .map((h) => (h.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120));
  const headings = {
    h1Count: hs.filter((h) => h.tagName === 'H1').length,
    h2Count: hs.filter((h) => h.tagName === 'H2').length,
    h3Count: hs.filter((h) => h.tagName === 'H3').length,
    h1Texts,
  };

  // hreflang — internationella sajter (alternate language links i <head>).
  const hreflangNodes = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]'));
  const hreflangEntries = hreflangNodes.map((n) => ({
    lang: (n.getAttribute('hreflang') || '').trim(),
    href: (n.getAttribute('href') || '').trim(),
  }));
  const hreflang = {
    count: hreflangEntries.length,
    hasXDefault: hreflangEntries.some((h) => h.lang.toLowerCase() === 'x-default'),
    // Relativa hreflang-URLs är ogiltiga enligt Google. true = alla absoluta.
    hasAbsoluteUrls: hreflangEntries.length > 0 && hreflangEntries.every(
      (h) => h.href.startsWith('http://') || h.href.startsWith('https://')
    ),
    entries: hreflangEntries,
  };

  const imgs = Array.from(document.querySelectorAll('img'));
  const imgTotal = imgs.length;
  const imgMissingAlt = imgs.filter((i) => !i.hasAttribute('alt') || (i.getAttribute('alt') || '').trim() === '').length;
  const imgMissingDims = imgs.filter((i) => !i.hasAttribute('width') || !i.hasAttribute('height')).length;
  const imgLazy = imgs.filter((i) => (i.getAttribute('loading') || '').toLowerCase() === 'lazy').length;

  // Bildformat — klassificerar per filändelse på currentSrc (eller src fallback).
  // OBS: Många CDN:er (Cloudinary, ImageKit, Imgix) serverar WebP/AVIF via
  // content negotiation utan att URL:en ändras (t.ex. hero.jpg?format=auto).
  // Sådana bilder hamnar i jpg/png/legacyCount trots att browsern fick WebP.
  // Använd inte legacyCount som ensam källa för "behöver moderniseras"-flaggor.
  function extOf(src) {
    try {
      const u = new URL(src, location.href);
      const m = u.pathname.toLowerCase().match(/\\.([a-z0-9]+)$/);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }
  const formats = { webp: 0, avif: 0, jpg: 0, png: 0, gif: 0, svg: 0, other: 0, unknown: 0 };
  for (const im of imgs) {
    const src = im.currentSrc || im.getAttribute('src') || '';
    if (!src) { formats.unknown++; continue; }
    const e = extOf(src);
    if (e === 'webp') formats.webp++;
    else if (e === 'avif') formats.avif++;
    else if (e === 'jpg' || e === 'jpeg') formats.jpg++;
    else if (e === 'png') formats.png++;
    else if (e === 'gif') formats.gif++;
    else if (e === 'svg') formats.svg++;
    else if (e === '') formats.unknown++;
    else formats.other++;
  }
  const images = {
    total: imgTotal,
    missingAlt: imgMissingAlt,
    missingAltPct: imgTotal > 0 ? Math.round((imgMissingAlt / imgTotal) * 1000) / 10 : 0,
    missingDims: imgMissingDims,
    lazy: imgLazy,
    formats,
    modernCount: formats.webp + formats.avif,
    legacyCount: formats.jpg + formats.png + formats.gif,
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
  const REQUIRED = {
    Organization: ['name', 'url'],
    WebSite: ['name', 'url'],
    Article: ['headline', 'author', 'datePublished'],
    NewsArticle: ['headline', 'author', 'datePublished'],
    BlogPosting: ['headline', 'author', 'datePublished'],
    Product: ['name', 'image', 'offers'],
    BreadcrumbList: ['itemListElement'],
    FAQPage: ['mainEntity'],
    LocalBusiness: ['name', 'address'],
    Person: ['name'],
    Event: ['name', 'startDate', 'location'],
  };
  const ldTypes = new Set();
  const ldBlocks = [];
  // Ett script-block kan innehålla ett @graph-array med flera @type-objekt.
  // Vi packar upp @graph och pushar ett entry per inre objekt till ldBlocks,
  // så schema.blocks.length kan vara > schema.count (antal script-taggar).
  function checkBlock(it) {
    let type = it && it['@type'];
    if (Array.isArray(type)) type = type[0];
    if (typeof type !== 'string') type = null;
    if (type) ldTypes.add(type);
    const req = type && REQUIRED[type];
    const missing = [];
    if (req) {
      for (const f of req) {
        const v = it[f];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
          missing.push(f);
        }
      }
    }
    ldBlocks.push({ type: type || null, missingRequired: missing, parseError: null });
  }
  for (const n of ldNodes) {
    try {
      const parsed = JSON.parse(n.textContent || '');
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of arr) {
        if (!it || typeof it !== 'object') continue;
        // Handle @graph wrappers
        if (Array.isArray(it['@graph'])) {
          for (const g of it['@graph']) if (g && typeof g === 'object') checkBlock(g);
        } else {
          checkBlock(it);
        }
      }
    } catch (e) {
      ldBlocks.push({ type: null, missingRequired: [], parseError: String((e && e.message) || e) });
    }
  }
  const schema = { count: ldNodes.length, types: Array.from(ldTypes), blocks: ldBlocks };

  const main = document.querySelector('main') || document.body;
  const wordCount = ((main && main.innerText) || '').trim().split(/\\s+/).filter(Boolean).length;
  const content = {
    wordCount,
    sections: document.querySelectorAll('section').length,
    articles: document.querySelectorAll('article').length,
  };

  // --- indexability ---
  const robotsContent = (meta('robots') || '').toLowerCase();
  const canonicalUrl = canonicalEl ? (canonicalEl.getAttribute('href') || '') : '';
  function normalizeUrl(u) {
    try {
      const parsed = new URL(u, location.href);
      let p = parsed.pathname.replace(/\\/+$/, '') || '/';
      return parsed.origin + p;
    } catch (e) { return ''; }
  }
  const canonicalNorm = canonicalUrl ? normalizeUrl(canonicalUrl) : '';
  const selfNorm = normalizeUrl(location.href);
  const ogUrlRaw = og('og:url') || '';
  const ogUrlNorm = ogUrlRaw ? normalizeUrl(ogUrlRaw) : '';
  const indexability = {
    indexable: true, // recomputed server-side after robotsTxt is fetched
    noindex: /\\bnoindex\\b/.test(robotsContent),
    nofollow: /\\bnofollow\\b/.test(robotsContent),
    canonicalUrl: canonicalUrl || null,
    canonicalMatchesSelf: canonicalNorm !== '' && canonicalNorm === selfNorm,
    canonicalIsAbsolute: /^https?:\\/\\//i.test(canonicalUrl),
    ogUrl: ogUrlRaw || null,
    canonicalMatchesOgUrl:
      (canonicalNorm === '' || ogUrlNorm === '') ? true :
      canonicalNorm === ogUrlNorm,
    robotsTxtAllows: true, // set server-side
  };

  // --- contentMetrics ---
  const paragraphCount = document.querySelectorAll('p').length;
  const listCount = document.querySelectorAll('ul,ol').length;
  const listItemCount = document.querySelectorAll('li').length;
  const blockquoteCount = document.querySelectorAll('blockquote').length;
  const detailsCount = document.querySelectorAll('details').length;
  const headingsQuestionCount = hs.filter((h) => (h.textContent || '').trim().endsWith('?')).length;
  let headingDepth = 0;
  for (const h of hs) {
    const lvl = parseInt(h.tagName.substring(1), 10);
    if (lvl > headingDepth) headingDepth = lvl;
  }
  const contentMetrics = {
    readingTimeMinutes: Math.max(1, Math.round(wordCount / 220)),
    paragraphCount,
    listCount,
    listItemCount,
    faqCount: detailsCount + headingsQuestionCount,
    blockquoteCount,
    headingDepth,
  };

  // --- performanceProxy ---
  // Approximate above-fold weight without O(n) getBoundingClientRect across
  // every node. Sample top-level sectioning containers + their direct children,
  // dedupe via Set (in case <header> nests inside <main>), and count subtree
  // size of those that cross the fold.
  const viewportH = window.innerHeight || 720;
  const domNodes = document.querySelectorAll('*').length;
  const sampleRoots = new Set();
  const seedSelectors = ['main > *', 'header > *', 'nav > *', 'aside > *', 'footer > *', 'body > section', 'body > section > *'];
  for (const sel of seedSelectors) {
    try {
      const list = document.querySelectorAll(sel);
      for (const n of list) sampleRoots.add(n);
    } catch (e) {}
  }
  // Drop any node whose ancestor is also in the set so subtrees don't double-count.
  const topRoots = [];
  for (const node of sampleRoots) {
    let p = node.parentElement;
    let nested = false;
    while (p) { if (sampleRoots.has(p)) { nested = true; break; } p = p.parentElement; }
    if (!nested) topRoots.push(node);
  }
  let aboveFoldElements = 0;
  for (const node of topRoots) {
    const r = node.getBoundingClientRect();
    if (r.top < viewportH && r.bottom > 0 && r.width > 0 && r.height > 0) {
      aboveFoldElements += 1 + node.querySelectorAll('*').length;
    }
  }


  let largestImagePx = 0;
  let aboveFoldImageCount = 0;
  let lazyLoadedImages = 0;
  let eagerImagesAboveFold = 0;
  for (const im of imgs) {
    const nw = im.naturalWidth || 0;
    const nh = im.naturalHeight || 0;
    let area = nw * nh;
    if (!area) {
      const r = im.getBoundingClientRect();
      area = Math.round(r.width * r.height);
    }
    if (area > largestImagePx) largestImagePx = area;
    const loading = (im.getAttribute('loading') || '').toLowerCase();
    if (loading === 'lazy') lazyLoadedImages++;
    const r = im.getBoundingClientRect();
    const isAF = r.top < viewportH && r.bottom > 0;
    if (isAF) {
      aboveFoldImageCount++;
      if (loading !== 'lazy') eagerImagesAboveFold++;
    }
  }
  const performanceProxy = {
    domNodes,
    aboveFoldElements,
    aboveFoldImageCount,
    largestImagePx,
    lazyLoadedImages,
    eagerImagesAboveFold,
    stylesheetCount: document.querySelectorAll('link[rel="stylesheet"]').length,
    scriptCount: document.querySelectorAll('script').length,
  };

  return {
    url: location.href,
    head,
    headings,
    images,
    links,
    schema,
    content,
    indexability,
    contentMetrics,
    performanceProxy,
  };
})()`;



