// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const TRUST_SIGNALS_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;

  const PATTERNS = {
    testimonial:        /testimonial|kundr[öo]st|kundcitat|customer story|case study/i,
    review_rating:      /\\b(\\d[.,]\\d)\\s*\\/\\s*5\\b|\\b(\\d[.,]\\d)\\s*av\\s*5\\b|\\b(\\d[.,]\\d)\\s*out of\\s*5\\b/i,
    trusted_by:         /trusted by|used by|anv[äa]nds av|v[åa]ra kunder|featured in|som setts i|our clients/i,
    certification:      /\\bISO\\s?\\d{4,5}\\b|\\bGDPR\\b|\\bHIPAA\\b|\\bSOC ?2\\b|\\bPCI[- ]?DSS\\b|certifierad|certified/i,
    guarantee:          /(\\d+)[- ]?(day|dagars?)\\s+(money[- ]back|n[öo]jd[- ]?kund|garanti|guarantee)|return policy|[öo]ppet k[öo]p|money[- ]back guarantee/i,
    secure_payment:     /secure (checkout|payment)|s[äa]ker betalning|ssl secured|256[- ]bit/i,
    press_mention:      /as seen in|as featured in|som setts i|i pressen|in the news/i,
    social_proof_count: /\\b(\\d{1,3}(?:[ ,.]\\d{3})+|\\d{4,})\\+?\\s*(customers|users|members|kunder|anv[äa]ndare|medlemmar|downloads|nedladdningar|reviews|recensioner)/i,
    org_number:         /\\b\\d{6}-\\d{4}\\b|\\bVAT[: ]?[A-Z]{2}\\d{6,}\\b/i,
  };

  const SECTION_KIND = (function () {
    function walk(el) {
      let p = el;
      let inHeader = false, inFooter = false, inNav = false, inMain = false, inAside = false;
      while (p && p !== document.body) {
        const tag = p.tagName;
        const role = (p.getAttribute && p.getAttribute('role') || '').toLowerCase();
        if (tag === 'NAV' || role === 'navigation') inNav = true;
        else if (tag === 'HEADER' || role === 'banner') inHeader = true;
        else if (tag === 'FOOTER' || role === 'contentinfo') inFooter = true;
        else if (tag === 'MAIN' || role === 'main') inMain = true;
        else if (tag === 'ASIDE') inAside = true;
        p = p.parentElement;
      }
      return { inHeader, inFooter, inNav, inMain, inAside };
    }
    return function (el, rect) {
      const w = walk(el);
      if (w.inFooter) return 'footer';
      if (w.inNav) return 'nav';
      if (w.inHeader) return 'header';
      const docTop = rect.top + window.scrollY;
      if (docTop < viewportH * 1.1) return 'hero';
      return 'content';
    };
  })();

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
    if (r.width < 1 || r.height < 1) return false;
    return true;
  }

  function nearestBlock(el) {
    let p = el;
    while (p && p !== document.body) {
      const cs = window.getComputedStyle(p);
      if (cs.display && cs.display !== 'inline' && cs.display !== 'contents') return p;
      p = p.parentElement;
    }
    return el;
  }

  const RECOGNIZED_BRANDS = [
    'spotify','stripe','hubspot','google','microsoft','apple','amazon','meta','facebook','instagram',
    'linkedin','twitter','x.com','youtube','tiktok','netflix','airbnb','uber','lyft','slack',
    'shopify','salesforce','adobe','figma','notion','intercom','zendesk','atlassian','github','gitlab',
    'mongodb','vercel','cloudflare','klarna','ikea','volvo','ericsson','h&m','spotify','tesla',
    'nike','adidas','coca-cola','pepsi','samsung','sony','intel','nvidia','oracle','sap',
  ];

  const seen = new Set();
  const out = [];

  function push(type, text, el, source, extras) {
    const block = nearestBlock(el);
    if (!isVisible(block)) return;
    const cleanText = (text || '').trim().replace(/\\s+/g, ' ').slice(0, 200);
    const dedupeKey = type + '|' + cleanText.slice(0, 80) + '|' + buildSelector(block);
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const rect = block.getBoundingClientRect();
    const entry = {
      type,
      text: cleanText,
      section: SECTION_KIND(block, rect),
      aboveFold: rect.top < viewportH,
      selector: buildSelector(block),
      visualWeight: Math.round(rect.width * rect.height),
      source,
      rect: {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    };
    if (extras) Object.assign(entry, extras);
    out.push(entry);
  }

  // Testimonial enrichment helpers
  function extractTestimonialMeta(el, text) {
    const extras = {};
    // Look for <cite>, <figcaption>, or "— Name, Company" pattern
    const cite = el.querySelector('cite, figcaption, [class*="author" i], [class*="name" i]');
    if (cite) {
      const t = (cite.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
      const m = t.match(/^([^,—–-]+)[,—–-]\\s*(.+)$/);
      if (m) { extras.personName = m[1].trim(); extras.company = m[2].trim(); }
      else if (t) { extras.personName = t; }
    } else {
      const m = text.match(/[—–-]\\s*([A-Z][\\w .'-]{2,40}?)\\s*,\\s*([A-Z][\\w .'-]{2,60})/);
      if (m) { extras.personName = m[1].trim(); extras.company = m[2].trim(); }
    }
    extras.hasImage = !!el.querySelector('img');
    return extras;
  }

  function safeFloat(s) {
    if (s === undefined || s === null) return undefined;
    const n = parseFloat(String(s).replace(',', '.'));
    return isNaN(n) ? undefined : n;
  }
  function safeInt(s) {
    if (s === undefined || s === null) return undefined;
    const n = parseInt(String(s).replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? undefined : n;
  }

  function extractRatingMeta(text) {
    const extras = {};
    if (!text) return extras;
    let m =
      text.match(/(\\d[.,]\\d)\\s*(?:\\/|av|out of)\\s*5/i) ||
      text.match(/TrustScore\\s+(\\d[.,]\\d)/i) ||
      text.match(/Rated\\s+(\\d[.,]\\d)\\s*(?:out of|\\/)\\s*5/i) ||
      text.match(/Rated\\s+(\\d[.,]\\d)/i) ||
      text.match(/(\\d[.,]\\d)\\s*stars?\\b/i);
    if (m) {
      const r = safeFloat(m[1]);
      if (r !== undefined) extras.rating = r;
    }
    let rc =
      text.match(/\\b(\\d{1,3}(?:[ ,.]\\d{3})+|\\d{2,})\\s*(?:reviews|recensioner|omd[öo]men|ratings)\\b/i) ||
      text.match(/based on\\s+(\\d{1,3}(?:[ ,.]\\d{3})*|\\d+)\\s*(?:reviews|recensioner|ratings)/i);
    if (rc) {
      const c = safeInt(rc[1]);
      if (c !== undefined) extras.reviewCount = c;
    }
    if (/trustpilot/i.test(text)) extras.reviewSource = 'Trustpilot';
    else if (/google/i.test(text)) extras.reviewSource = 'Google';
    else if (/g2\\b/i.test(text)) extras.reviewSource = 'G2';
    else if (/capterra/i.test(text)) extras.reviewSource = 'Capterra';
    return extras;
  }

  function extractSocialProofCount(text) {
    const m = text.match(/\\b(\\d{1,3}(?:[ ,.]\\d{3})+|\\d{4,})/);
    if (m) {
      const c = safeInt(m[1]);
      if (c !== undefined) return { reviewCount: c };
    }
    return undefined;
  }

  // 1) Text-based scan across visible block elements.
  const blocks = document.querySelectorAll('p, li, span, h1, h2, h3, h4, h5, h6, blockquote, figcaption, div, section, article');
  for (const el of blocks) {
    let leaf = true;
    for (const c of el.children) {
      const tag = c.tagName;
      if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'H1' || tag === 'H2' || tag === 'H3') { leaf = false; break; }
    }
    if (!leaf) continue;
    const text = (el.innerText || el.textContent || '').trim();
    if (!text || text.length > 600) continue;
    for (const type in PATTERNS) {
      if (PATTERNS[type].test(text)) {
        let extras;
        if (type === 'testimonial') extras = extractTestimonialMeta(el, text);
        else if (type === 'review_rating') extras = extractRatingMeta(text);
        else if (type === 'social_proof_count') extras = extractSocialProofCount(text);
        push(type, text, el, 'text', extras);
      }
    }
  }

  // Quote-based testimonial detection (long quoted text)
  document.querySelectorAll('blockquote, [class*="testimonial" i], [class*="quote" i]').forEach((el) => {
    const text = (el.innerText || el.textContent || '').trim();
    if (text.length < 40 || text.length > 600) return;
    push('testimonial', text, el, 'text', extractTestimonialMeta(el, text));
  });

  function neighborText(el) {
    if (!el) return '';
    const bits = [];
    if (el.innerText) bits.push(el.innerText);
    const parent = el.parentElement;
    if (parent && parent.innerText) bits.push(parent.innerText);
    const grand = parent && parent.parentElement;
    if (grand && grand.innerText) bits.push(grand.innerText);
    const greatGrand = grand && grand.parentElement;
    if (greatGrand && greatGrand.innerText) bits.push(greatGrand.innerText);
    // siblings of parent (catches widget layouts where rating-text is in a separate div)
    if (parent && parent.parentElement) {
      for (const sib of parent.parentElement.children) {
        if (sib !== parent && sib.innerText) bits.push(sib.innerText);
      }
    }
    if (el.nextElementSibling && el.nextElementSibling.innerText) bits.push(el.nextElementSibling.innerText);
    if (el.previousElementSibling && el.previousElementSibling.innerText) bits.push(el.previousElementSibling.innerText);
    return bits.join(' ').slice(0, 2000);
  }

  function extractRatingFromAttrs(el) {
    if (!el) return {};
    const extras = {};
    const ratingRx = /(\\d[.,]?\\d?)\\s*(?:out of|av|\\/)\\s*5/i;
    const ratedRx = /Rated\\s+(\\d[.,]\\d)/i;
    const scope = [el];
    if (el.parentElement) scope.push(el.parentElement);
    if (el.parentElement && el.parentElement.parentElement) scope.push(el.parentElement.parentElement);
    let descCount = 0;
    el.querySelectorAll('*').forEach((d) => { if (descCount++ < 50) scope.push(d); });
    for (const node of scope) {
      if (extras.rating === undefined) {
        const aria = (node.getAttribute && node.getAttribute('aria-label')) || '';
        const title = (node.getAttribute && node.getAttribute('title')) || '';
        for (const t of [aria, title]) {
          const m = t.match(ratingRx) || t.match(ratedRx);
          if (m) { const r = safeFloat(m[1]); if (r !== undefined) { extras.rating = r; break; } }
        }
      }
      if (extras.rating === undefined && node.matches && (node.matches('[itemprop="ratingValue"]') || node.matches('[data-rating]') || node.matches('[data-score]') || node.matches('[data-stars]'))) {
        const raw = (node.getAttribute('content') || node.getAttribute('data-rating') || node.getAttribute('data-score') || node.getAttribute('data-stars') || node.textContent || '').trim();
        const r = safeFloat(raw);
        if (r !== undefined) extras.rating = r;
      }
      if (extras.reviewCount === undefined && node.matches && (node.matches('[itemprop="reviewCount"]') || node.matches('[itemprop="ratingCount"]'))) {
        const raw = (node.getAttribute('content') || node.textContent || '').trim();
        const c = safeInt(raw);
        if (c !== undefined) extras.reviewCount = c;
      }
    }
    // Look for ratingValue/reviewCount inside descendants by selector if not found yet
    if (extras.rating === undefined) {
      const r = el.querySelector && el.querySelector('[itemprop="ratingValue"]');
      if (r) {
        const v = safeFloat((r.getAttribute('content') || r.textContent || '').trim());
        if (v !== undefined) extras.rating = v;
      }
    }
    if (extras.reviewCount === undefined) {
      const c = el.querySelector && el.querySelector('[itemprop="reviewCount"], [itemprop="ratingCount"]');
      if (c) {
        const v = safeInt((c.getAttribute('content') || c.textContent || '').trim());
        if (v !== undefined) extras.reviewCount = v;
      }
    }
    return extras;
  }

  function extractStarRating(parent) {
    const fromAttrs = extractRatingFromAttrs(parent);
    if (fromAttrs.rating !== undefined) return fromAttrs;
    const fromText = extractRatingMeta(neighborText(parent));
    if (fromText.rating !== undefined) {
      // merge reviewCount from attrs if available
      if (fromAttrs.reviewCount !== undefined && fromText.reviewCount === undefined) fromText.reviewCount = fromAttrs.reviewCount;
      return fromText;
    }
    // Also try plain "4.7" near stars (without /5 suffix)
    const t = neighborText(parent);
    const m = t.match(/\\b([1-5][.,]\\d)\\b/);
    if (m) {
      const r = safeFloat(m[1]);
      if (r !== undefined) {
        const out = { rating: r };
        if (fromAttrs.reviewCount !== undefined) out.reviewCount = fromAttrs.reviewCount;
        return out;
      }
    }
    // Fallback: count filled stars — only when it looks like a rating widget
    const allStars = parent.querySelectorAll('[class*="star" i]');
    const filled = parent.querySelectorAll(
      '[class*="filled" i], [class*="active" i], [class*="full" i], [aria-checked="true"]'
    );
    if (allStars.length >= 4 && allStars.length <= 5 && filled.length >= 1 && filled.length <= allStars.length) {
      const out = { rating: filled.length };
      if (fromAttrs.reviewCount !== undefined) out.reviewCount = fromAttrs.reviewCount;
      return out;
    }
    return fromAttrs;
  }

  // 2) Star icons clusters
  const starNodes = Array.from(document.querySelectorAll(
    '[class*="star" i], [class*="rating" i], svg[aria-label*="star" i], i[class*="fa-star"]'
  ));
  const byParent = new Map();
  for (const n of starNodes) {
    const p = n.parentElement;
    if (!p) continue;
    const arr = byParent.get(p) || [];
    arr.push(n);
    byParent.set(p, arr);
  }
  for (const [parent, group] of byParent) {
    if (group.length < 3) continue;
    push('stars', String(group.length) + ' stars', parent, 'attr', extractStarRating(parent));
  }
  document.querySelectorAll('p, span, div').forEach((el) => {
    if (el.children.length > 0) return;
    const t = el.textContent || '';
    if ((t.match(/[★⭐✦]/g) || []).length >= 3) push('stars', t.trim().slice(0, 60), el, 'text', extractStarRating(el));
  });

  // 2b) Schema.org AggregateRating microdata in DOM
  document.querySelectorAll('[itemtype*="AggregateRating" i], [itemprop="aggregateRating"]').forEach((el) => {
    const ratingEl = el.querySelector('[itemprop="ratingValue"]');
    const countEl = el.querySelector('[itemprop="reviewCount"], [itemprop="ratingCount"]');
    const ratingRaw = ratingEl ? (ratingEl.getAttribute('content') || ratingEl.textContent || '').trim() : '';
    const countRaw = countEl ? (countEl.getAttribute('content') || countEl.textContent || '').trim() : '';
    const rating = safeFloat(ratingRaw);
    const count = safeInt(countRaw);
    const extras = {};
    if (rating !== undefined) extras.rating = rating;
    if (count !== undefined) extras.reviewCount = count;
    if (Object.keys(extras).length) {
      push('review_rating', ('Aggregate rating ' + (extras.rating !== undefined ? extras.rating : '')).trim(), el, 'schema', extras);
    }
  });

  // 2c) Trustpilot / G2 widget containers
  document.querySelectorAll('[class*="trustpilot" i], [class*="trustbox" i], [data-businessunit-id], [class*="g2-" i], [class*="g2crowd" i]').forEach((el) => {
    const extras = {};
    const dataRating = el.getAttribute('data-rating') || el.getAttribute('data-score') || el.getAttribute('data-stars');
    const r = safeFloat(dataRating);
    if (r !== undefined) extras.rating = r;
    const fromText = extractRatingMeta(el.innerText || el.textContent || '');
    if (extras.rating === undefined && fromText.rating !== undefined) extras.rating = fromText.rating;
    if (fromText.reviewCount !== undefined) extras.reviewCount = fromText.reviewCount;
    const cls = (el.className && el.className.toString()) || '';
    if (/trustpilot|trustbox/i.test(cls) || el.hasAttribute('data-businessunit-id')) extras.reviewSource = 'Trustpilot';
    else if (/g2/i.test(cls)) extras.reviewSource = 'G2';
    if (Object.keys(extras).length) {
      push('review_rating', ('Widget rating ' + (extras.rating !== undefined ? extras.rating : '')).trim(), el, 'attr', extras);
    }
  });

  // 3) Customer logos — row/grid of ≥4 small <img>
  document.querySelectorAll('ul, ol, div, section').forEach((el) => {
    const imgs = Array.from(el.querySelectorAll(':scope > * img, :scope > img'));
    if (imgs.length < 4) return;
    const small = imgs.filter((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 40 && r.width < 240 && r.height > 20 && r.height < 120;
    });
    if (small.length < 4) return;
    const altText = small.map((i) => (i.getAttribute('alt') || '') + ' ' + (i.getAttribute('src') || '')).join(' ').toLowerCase();
    const recognized = [];
    for (const b of RECOGNIZED_BRANDS) if (altText.indexOf(b) >= 0) recognized.push(b);
    push('customer_logos', String(small.length) + ' logo images', el, 'img_alt', {
      logoCount: small.length,
      recognizedBrands: Array.from(new Set(recognized)).slice(0, 20),
    });
  });

  // 4) Payment logos
  const paymentRx = /(visa|mastercard|amex|american express|paypal|stripe|klarna|swish|apple pay|google pay)/i;
  const paymentImgs = Array.from(document.querySelectorAll('img[alt], img[src]')).filter((i) => {
    const alt = (i.getAttribute('alt') || '') + ' ' + (i.getAttribute('src') || '');
    return paymentRx.test(alt);
  });
  if (paymentImgs.length > 0) {
    const parent = paymentImgs[0].closest('div, section, footer, ul') || paymentImgs[0].parentElement;
    if (parent) push('secure_payment', paymentImgs.length + ' payment provider logos', parent, 'img_alt');
  }

  // 5) Contact info
  document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]').forEach((a) => {
    push('contact_info', a.getAttribute('href') || '', a, 'attr');
  });

  // 6) Schema.org
  const ldNodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const n of ldNodes) {
    try {
      const parsed = JSON.parse(n.textContent || '');
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of arr) {
        const type = it && it['@type'];
        const types = Array.isArray(type) ? type : [type];
        for (const t of types) {
          if (t === 'Review' || t === 'AggregateRating') {
            const rating = it.ratingValue || (it.reviewRating && it.reviewRating.ratingValue);
            const reviewCount = it.reviewCount || it.ratingCount;
            push('review_rating', rating ? 'Schema rating ' + rating : 'Schema review', document.body, 'schema', {
              rating: rating ? parseFloat(String(rating)) : undefined,
              reviewCount: reviewCount ? parseInt(String(reviewCount), 10) : undefined,
            });
          }
          if (t === 'Organization' && (it.address || it.telephone || it.email)) {
            push('contact_info', 'Schema Organization contact', document.body, 'schema');
          }
        }
      }
    } catch (e) {}
  }

  return out;
})()`;


