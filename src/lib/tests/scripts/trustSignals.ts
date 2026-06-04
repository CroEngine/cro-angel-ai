// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const TRUST_SIGNALS_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;

  const PATTERNS = {
    testimonial:        /testimonial|kundr[öo]st|kundcitat|customer story|case study/i,
    review_rating:      /\\b(\\d[.,]\\d)\\s*\\/\\s*5\\b|\\b(\\d[.,]\\d)\\s*av\\s*5\\b|\\b(\\d[.,]\\d)\\s*out of\\s*5\\b/i,
    trusted_by:         /\\b(trusted by|used by|anv[äa]nds av|joined by|loved by|trusted globally by)\\s+[\\d\\w]|featured in|som setts i|as seen in/i,
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
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur.nodeType === 1) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\\w-]*$/.test(cur.id)) {
        parts.unshift('#' + cur.id);
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join('>');
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
  // _debug: per-decision log for testimonial classification. Each entry records
  // selector, snippet, decision (accepted/rejected) and reason. Temporary —
  // remove once classifier is stable across multiple sites.
  const debug = [];
  function logDecision(stage, decision, reason, el, text, extras) {
    try {
      const snip = (text || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
      const sel = el ? buildSelector(el) : null;
      const entry = { stage: stage, decision: decision, reason: reason, selector: sel, text: snip };
      if (extras) Object.assign(entry, extras);
      debug.push(entry);
    } catch (_e) { /* never throw from debug */ }
  }

  function isInsideCarousel(el) {
    let p = el;
    let hops = 0;
    while (p && p !== document.body && hops++ < 8) {
      const role = ((p.getAttribute && p.getAttribute('aria-roledescription')) || '').toLowerCase();
      if (role.indexOf('carousel') !== -1 || role.indexOf('slider') !== -1) return true;
      const cls = (p.className && typeof p.className === 'string') ? p.className.toLowerCase() : '';
      if (/(^|\\s|-)(swiper|slick|embla|keen-slider|glide|splide|carousel|slider-track|flickity)(\\s|-|$)/.test(cls)) return true;
      if (p.hasAttribute && (p.hasAttribute('data-carousel') || p.hasAttribute('data-slider'))) return true;
      const cs = window.getComputedStyle(p);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.children && p.children.length >= 3) return true;
      const scrollSnap = cs.scrollSnapType || '';
      if (scrollSnap && scrollSnap !== 'none') return true;
      p = p.parentElement;
    }
    return false;
  }


  function push(type, text, el, source, extras) {
    const block = nearestBlock(el);
    const inCarousel = isInsideCarousel(block);
    const visibleEnough = isVisible(block) || (inCarousel && block.getBoundingClientRect().width > 0);
    if (!visibleEnough) return;
    if (type === 'stars') {
      const raw = block.getBoundingClientRect();
      const viewportW = window.innerWidth || 1280;
      if (!inCarousel && (raw.left >= viewportW || raw.right <= 0)) return;
    }
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
    if (inCarousel) entry.inCarousel = true;
    if (type === 'trusted_by') entry._block = block;
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
      if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') { leaf = false; break; }
    }
    if (!leaf) continue;
    const text = (el.innerText || el.textContent || '').trim();
    if (!text || text.length > 600) continue;
    for (const type in PATTERNS) {
      if (PATTERNS[type].test(text)) {
        if (type === 'trusted_by' && text.length > 160) continue;
        let extras;
        if (type === 'testimonial') extras = extractTestimonialMeta(el, text);
        else if (type === 'review_rating') extras = extractRatingMeta(text);
        else if (type === 'social_proof_count') extras = extractSocialProofCount(text);
        if (type === 'testimonial') {
          logDecision('text-pattern', 'accepted', 'PATTERN matched', el, text, {
            personName: extras && extras.personName, company: extras && extras.company,
            hasImage: extras && extras.hasImage,
          });
        }
        push(type, text, el, 'text', extras);
      }
    }
  }

  // Quote-based testimonial detection (long quoted text).
  // Includes carousel slide containers so testimonials rendered as
  // slides (Embla/Swiper/Slick/etc.) are picked up even when the slide
  // itself lacks a "testimonial"/"quote" class.
  document.querySelectorAll(
    'blockquote, [class*="testimonial" i], [class*="quote" i], ' +
    '[class*="swiper-slide" i], [class*="slick-slide" i], [class*="embla__slide" i], ' +
    '[class*="keen-slider__slide" i], [class*="glide__slide" i], [class*="splide__slide" i], ' +
    '[role="group"][aria-roledescription~="slide" i], [data-slide], [data-carousel-item]'
  ).forEach((el) => {
    const text = (el.innerText || el.textContent || '').trim();
    if (text.length < 40 || text.length > 600) {
      if (text.length >= 20) logDecision('quote-block', 'rejected', 'text length ' + text.length, el, text);
      return;
    }
    const cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
    const isSlide = /slide|swiper|slick|embla|keen-slider|glide|splide/.test(cls)
      || (el.getAttribute && (el.getAttribute('aria-roledescription') || '').toLowerCase().indexOf('slide') !== -1);
    const hasQuote = /[“"„«»]/.test(text) || /[—–-]\\s*[A-ZÅÄÖ]/.test(text);
    const hasAuthor = !!el.querySelector('cite, figcaption, [class*="author" i], [class*="name" i], [class*="role" i], [class*="title" i]');
    const hasTestimonialClass = /testimonial|quote|review/.test(cls);
    if (isSlide && !hasQuote && !hasAuthor && !hasTestimonialClass) {
      logDecision('quote-block', 'rejected', 'slide without testimonial signal', el, text, {
        isSlide: true, hasQuote: false, hasAuthor: false, hasTestimonialClass: false,
      });
      return;
    }
    const meta = extractTestimonialMeta(el, text);
    logDecision('quote-block', 'accepted', isSlide ? 'slide with signal' : 'blockquote/quote class', el, text, {
      isSlide: isSlide, hasQuote: hasQuote, hasAuthor: hasAuthor, hasTestimonialClass: hasTestimonialClass,
      personName: meta.personName, company: meta.company, hasImage: meta.hasImage,
    });
    push('testimonial', text, el, 'text', meta);
  });


  // Big-number stat blocks (dl/dt/dd or stat/metric/counter containers where
  // the number and label live in separate sibling elements).
  const STAT_KEYWORDS = /\\b(customers|users|members|downloads|reviews|recensioner|kunder|anv[äa]ndare|medlemmar|nedladdningar|rekryteringar|rekryterare|f[öo]retag|projekt|jobb|tj[äa]nster|ordrar|leveranser)\\b/i;
  const NUM_RX = /^\\s*\\d{1,3}(?:[ ,.\\u00a0]\\d{3})+\\+?\\s*$|^\\s*\\d{4,}\\+?\\s*$/;
  const statSeen = new Set();
  document.querySelectorAll('dl, [class*="stat" i], [class*="metric" i], [class*="counter" i]').forEach((container) => {
    const containerText = (container.innerText || '').toLowerCase();
    if (!STAT_KEYWORDS.test(containerText)) return;
    const numEls = Array.from(container.querySelectorAll('dd, span, strong, p, div, h1, h2, h3, h4'))
      .filter((e) => NUM_RX.test((e.innerText || '').trim()));
    for (const numEl of numEls) {
      if (statSeen.has(numEl)) continue;
      statSeen.add(numEl);
      const numText = (numEl.innerText || '').trim();
      const containerText = (container.innerText || '').replace(/\\s+/g, ' ');
      // Pick the STAT_KEYWORD closest to numEl in the DOM (parent → grandparent →
      // container fallback). Container-wide match grabs the first hit, which is
      // wrong when multiple stat cards share one container with different labels.
      const p1 = numEl.parentElement;
      const p2 = p1 && p1.parentElement;
      const m1 = p1 && (p1.innerText || '').match(STAT_KEYWORDS);
      const m2 = !m1 && p2 ? (p2.innerText || '').match(STAT_KEYWORDS) : null;
      const m3 = (!m1 && !m2) ? containerText.match(STAT_KEYWORDS) : null;
      const km = m1 || m2 || m3;
      const label = km ? km[0] : '';
      const display = label ? numText + ' — ' + label : numText;
      push('social_proof_count', display, numEl, 'text', {
        reviewCount: safeInt(numText),
      });
    }
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

  function extractStarRating(parent, group) {
    const fromAttrs = extractRatingFromAttrs(parent);
    if (fromAttrs.rating !== undefined) return fromAttrs;
    const t = neighborText(parent);
    const fromText = extractRatingMeta(t);
    if (fromText.rating !== undefined) {
      if (fromAttrs.reviewCount !== undefined && fromText.reviewCount === undefined) fromText.reviewCount = fromAttrs.reviewCount;
      return fromText;
    }
    const m = t.match(/\\b([1-5][.,]\\d)\\b/);
    if (m) {
      const r = safeFloat(m[1]);
      if (r !== undefined) {
        const out = { rating: r };
        if (fromAttrs.reviewCount !== undefined) out.reviewCount = fromAttrs.reviewCount;
        return out;
      }
    }
    // Fallback chain: empty → filled → inline-fill → half-star → testimonial-context all-visible
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const withReviewCount = (rating) => {
      const o = { rating: clamp(rating, 0, 5) };
      if (fromAttrs.reviewCount !== undefined) o.reviewCount = fromAttrs.reviewCount;
      return o;
    };
    // Prefer the actual star group passed in (handles sites where star elements
    // don't have "star" in classname but match via aria-label/rating selectors).
    const allStars = (group && group.length)
      ? group
      : Array.from(parent.querySelectorAll('[class*="star" i]'));

    // Single length guard for all fallback steps below.
    if (allStars.length < 3 || allStars.length > 5) return fromAttrs;

    // (1) Empty stars present → rating = total - empty
    const empty = parent.querySelectorAll(
      '[class*="empty" i], [class*="outline" i], [class*="inactive" i], [class*="off" i], [aria-checked="false"]'
    );
    if (empty.length > 0) {
      return withReviewCount(allStars.length - empty.length);
    }

    // (2) Filled variant
    const filled = parent.querySelectorAll(
      '[class*="filled" i], [class*="active" i], [class*="full" i], [aria-checked="true"]'
    );
    if (filled.length >= 1 && filled.length <= allStars.length) {
      return withReviewCount(filled.length);
    }

    // (3) SVG inline fill attribute only (no computed style)
    let fillCount = 0;
    for (const s of allStars) {
      const f = (s.getAttribute && s.getAttribute('fill')) || '';
      const v = f.trim().toLowerCase();
      if (v && v !== 'none' && v !== 'transparent' && v !== 'rgba(0,0,0,0)') fillCount++;
    }
    if (fillCount >= 1 && fillCount <= 5) return withReviewCount(fillCount);

    // (3b) Half-star detection — class-based, then inline width:50% overlay.
    const halfNodes = parent.querySelectorAll(
      '[class*="half" i], [class*="fractional" i], [class*="partial" i]'
    );
    let halfCount = halfNodes.length;
    if (halfCount === 0) {
      for (const s of allStars) {
        const st = (s.getAttribute && s.getAttribute('style')) || '';
        if (/width:\\s*50%/i.test(st)) halfCount++;
      }
    }
    if (halfCount >= 1 && halfCount <= allStars.length) {
      const fullCount = filled.length > 0 && filled.length <= allStars.length
        ? filled.length
        : (allStars.length - halfCount);
      const rating = Math.round((fullCount + halfCount * 0.5) * 10) / 10;
      return withReviewCount(rating);
    }

    // (4) All visible stars filled.
    // For exactly 5 stars: if we reached this step, steps (1)–(3b) found no
    // empty/filled/half/fill signals, so a fully-visible 5-star cluster picked
    // up by the star-class selector is the canonical "5/5 in a testimonial
    // card" pattern. Hero decorations are almost always one icon + number,
    // not 5 separate star nodes — safe to skip context check.
    // For 3–4 stars: keep the testimonial-context guard to avoid false hits
    // on empty rating widgets with placeholder stars.
    const allVisible = Array.from(allStars).filter((s) => {
      const r = s.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (allVisible.length === allStars.length) {
      if (allStars.length === 5) return withReviewCount(5);
      const ctxRx = /testimonial|review|quote|kund|card|feedback/i;
      let ctx = false;
      let node = parent;
      for (let i = 0; i < 5 && node; i++) {
        const tag = node.tagName;
        if (tag === 'BODY' || tag === 'MAIN' || tag === 'HTML') break;
        const cls = (node.className && node.className.toString()) || '';
        if (tag === 'BLOCKQUOTE' || tag === 'FIGURE' || ctxRx.test(cls)) { ctx = true; break; }
        node = node.parentElement;
      }
      if (ctx) return withReviewCount(allVisible.length);
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
    push('stars', String(group.length) + ' stars', parent, 'attr', extractStarRating(parent, group));
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

  // 3) Customer logos — globally dedupe by normalized src
  const allLogoImgs = Array.from(document.querySelectorAll('img'));
  const seenSrcs = new Set();
  const uniqueLogos = [];
  for (const img of allLogoImgs) {
    const r = img.getBoundingClientRect();
    if (r.width < 40 || r.width > 240 || r.height < 20 || r.height > 120) continue;
    const raw = img.getAttribute('src') || img.currentSrc || '';
    if (!raw) continue;
    const key = raw.split('?')[0];
    if (seenSrcs.has(key)) continue;
    seenSrcs.add(key);
    uniqueLogos.push(img);
  }

  if (uniqueLogos.length >= 4) {
    const vh = window.innerHeight;
    const aboveFoldLogoCount = uniqueLogos.filter((i) => {
      const r = i.getBoundingClientRect();
      return r.top < vh && r.bottom > 0;
    }).length;
    const altText = uniqueLogos
      .map((i) => (i.getAttribute('alt') || '') + ' ' + (i.getAttribute('src') || ''))
      .join(' ').toLowerCase();
    const recognized = [];
    for (const b of RECOGNIZED_BRANDS) if (altText.indexOf(b) >= 0) recognized.push(b);
    const anchor = uniqueLogos[0];
    push('customer_logos', String(uniqueLogos.length) + ' logo images', anchor, 'img_alt', {
      logoCount: uniqueLogos.length,
      aboveFoldLogoCount: aboveFoldLogoCount,
      recognizedBrands: Array.from(new Set(recognized)).slice(0, 20),
    });
  }

  // 3b) Third-party review/award badges (G2, Capterra, Trustpilot, etc.)
  const BADGE_BRANDS = /\\bg2\\b|g2crowd|g2\\.com|capterra|trustradius|trustpilot|software ?advice|getapp|gartner peer insights|sourceforge|product hunt|crozdesk|finances ?online|tekpon/i;
  const BADGE_TITLES = /\\b(leader|high performer|momentum leader|easiest to do business with|best (value|support|relationship|usability|est\\.? roi)|top rated|best of \\d{4}|users love us|fastest implementation|rising star|category leader|customers' choice|editors' choice)\\b/i;
  const BADGE_PATH = /\\/badges?\\/(file\\/)?/i;

  const allBadgeImgs = Array.from(document.querySelectorAll('img[alt], img[src]'));
  const badgeRects = new Map();
  for (const img of allBadgeImgs) badgeRects.set(img, img.getBoundingClientRect());

  const badgeImgs = allBadgeImgs.filter((i) => {
    const r = badgeRects.get(i);
    if (!r || r.width < 30 || r.height < 30 || r.width > 320 || r.height > 320) return false;
    const alt = i.getAttribute('alt') || '';
    const src = i.getAttribute('src') || '';
    const hay = (alt + ' ' + src).toLowerCase();
    if (BADGE_BRANDS.test(hay)) return true;
    if (BADGE_PATH.test(src)) return true;
    if (BADGE_TITLES.test(alt) && r.height >= r.width * 0.8) {
      const wordCount = alt.trim().split(/\\s+/).length;
      if (alt.length <= 60 && wordCount <= 6 && !/\\.$/.test(alt.trim())) return true;
    }
    return false;
  });

  if (badgeImgs.length > 0) {
    const badgeGroups = new Map();
    for (const img of badgeImgs) {
      const block = img.closest('ul, ol, section, div, footer') || img.parentElement;
      if (!block) continue;
      const arr = badgeGroups.get(block) || [];
      arr.push(img);
      badgeGroups.set(block, arr);
    }
    // Dedupe wrapper-containers: drop a block if any OTHER block in the set is its descendant.
    const badgeBlocks = Array.from(badgeGroups.keys());
    const innermostBadgeBlocks = badgeBlocks.filter(
      (a) => !badgeBlocks.some((b) => b !== a && a.contains(b)),
    );
    for (const block of innermostBadgeBlocks) {
      const imgs = badgeGroups.get(block);
      const brandsFound = new Set();
      const titlesFound = new Set();
      for (const img of imgs) {
        const alt = img.getAttribute('alt') || '';
        const src = img.getAttribute('src') || '';
        const hay = (alt + ' ' + src).toLowerCase();
        const mb = hay.match(BADGE_BRANDS); if (mb) brandsFound.add(mb[0]);
        const mt = alt.match(BADGE_TITLES); if (mt) titlesFound.add(mt[0].toLowerCase());
      }
      push('review_badges', imgs.length + ' badge images', block, 'img_alt', {
        badgeCount: imgs.length,
        recognizedBrands: Array.from(brandsFound).slice(0, 10),
        badgeTitles: Array.from(titlesFound).slice(0, 10),
        detectionMethod: 'keyword',
      });
    }
  }





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
            const ratingRaw = it.ratingValue || (it.reviewRating && it.reviewRating.ratingValue);
            const reviewCountRaw = it.reviewCount || it.ratingCount;
            const extras = {};
            const r = safeFloat(ratingRaw);
            if (r !== undefined) extras.rating = r;
            const c = safeInt(reviewCountRaw);
            if (c !== undefined) extras.reviewCount = c;
            push('review_rating', extras.rating !== undefined ? 'Schema rating ' + extras.rating : 'Schema review', document.body, 'schema', extras);
          }
          if (t === 'Organization' && (it.address || it.telephone || it.email)) {
            push('contact_info', 'Schema Organization contact', document.body, 'schema');
          }
        }
      }
    } catch (e) {}
  }

  // Pass A: dedupera entries som råkar peka på exakt samma _block (keep first).
  function dedupeSameBlock(arr, targetType) {
    const seen = new Set();
    return arr.filter((e) => {
      if (e.type !== targetType || !e._block) return true;
      if (seen.has(e._block)) return false;
      seen.add(e._block);
      return true;
    });
  }

  // Pass B: släpp wrapper-block bara om dess logoCount förklaras av top-level
  // inner-siblings (descendants av samma typ som INTE själva ligger inuti en
  // annan inner — undviker dubbelräkning vid överlappande wrappers).
  function dropWrappers(arr, targetType) {
    const COVERAGE_SLACK = 2;
    return arr.filter((a) => {
      if (a.type !== targetType) return true;
      if (!a._block) return true;
      const allInner = arr.filter((b) =>
        b !== a && b.type === targetType && b._block &&
        a._block !== b._block && a._block.contains(b._block)
      );
      const topLevelInner = allInner.filter((b) =>
        !allInner.some((c) => c !== b && c._block.contains(b._block))
      );
      if (topLevelInner.length === 0) return true;
      const innerSum = topLevelInner.reduce((s, b) => s + (b.logoCount || 0), 0);
      return ((a.logoCount || 0) - innerSum) >= COVERAGE_SLACK;
    });
  }


  // Stars-anchor pass: for each stars-entry inside a carousel, find the
  // enclosing card and push a testimonial-entry with text, author and the
  // rating copied from the stars-entry.
  const starsInCarousel = out.filter((e) => e.type === 'stars' && e.inCarousel);
  for (const starEntry of starsInCarousel) {
    let starEl = null;
    try { starEl = document.querySelector(starEntry.selector); } catch (_e) { starEl = null; }
    if (!starEl) continue;

    let cardEl = null;
    let p = starEl.parentElement;
    let hops = 0;
    while (p && p !== document.body && hops++ < 6) {
      const r = p.getBoundingClientRect();
      if (r.width >= 200 && r.width <= 700 && r.height >= 150) {
        const txt = (p.innerText || '').trim();
        if (txt.length >= 40 && txt.length <= 800) { cardEl = p; break; }
      }
      p = p.parentElement;
    }
    if (!cardEl) continue;

    const fullCardText = (cardEl.innerText || '').trim().replace(/\\s+/g, ' ');
    if (fullCardText.length < 40 || fullCardText.length > 600) continue;

    const meta = extractTestimonialMeta(cardEl, fullCardText);

    if (!meta.personName) {
      const rawLines = (cardEl.innerText || '')
        .split(/\\n+/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && l.length <= 80);
      const candidateLines = rawLines.filter((l) => {
        if (/^[★⭐\\s\\d.,/]+$/.test(l)) return false;
        if (/^(g2|trustpilot|capterra|google)\\b/i.test(l)) return false;
        if (l.length < 3) return false;
        return true;
      });
      const lastLine = candidateLines[candidateLines.length - 1];
      if (lastLine && fullCardText.indexOf(lastLine) > 0) {
        const m = lastLine.match(/^([^,—–-]+)[,—–-]\\s*(.+)$/);
        if (m) { meta.personName = m[1].trim(); meta.company = m[2].trim(); }
        else { meta.personName = lastLine; }
      }
    }

    let cleanedText = fullCardText;
    if (meta.personName && cleanedText.endsWith(meta.personName)) {
      cleanedText = cleanedText.slice(0, -meta.personName.length).trim();
      cleanedText = cleanedText.replace(/[,—–-]\\s*$/, '').trim();
    }
    if (cleanedText.length < 20) continue;

    push('testimonial', cleanedText, cardEl, 'text', Object.assign({}, meta, {
      derivedFromStars: true,
      rating: starEntry.rating,
    }));
  }

  let filtered = dedupeSameBlock(out, 'trusted_by');
  filtered = dropWrappers(filtered, 'trusted_by');


  for (const e of filtered) delete e._block;
  for (const e of filtered) {
    if (e.source === 'schema') { delete e.rect; delete e.selector; }
  }

  // Dedup carousel-cloned testimonials by text (Swiper/Slick/Embla loop modes
  // create duplicate DOM nodes; selector-based dedupe doesn't catch them).
  const seenTestimonialText = new Set();
  filtered = filtered.filter((e) => {
    if (e.type !== 'testimonial') return true;
    const key = (e.text || '').slice(0, 80);
    if (!key) return true;
    if (seenTestimonialText.has(key)) return false;
    seenTestimonialText.add(key);
    return true;
  });

  // Stars aggregation: collapse all individual 'stars' entries into one
  // 'stars_aggregate' summary. Must run AFTER the stars-anchor pass above
  // (which iterates individual stars to derive testimonials).
  const starsEntries = filtered.filter((e) => e.type === 'stars');
  if (starsEntries.length > 0) {
    const withRating = starsEntries.filter((e) => typeof e.rating === 'number');
    const avg = withRating.length > 0
      ? withRating.reduce((s, e) => s + e.rating, 0) / withRating.length
      : null;
    const aboveFoldCount = starsEntries.filter((e) => e.aboveFold).length;
    filtered = filtered.filter((e) => e.type !== 'stars');
    filtered.push({
      type: 'stars_aggregate',
      text: starsEntries.length + ' star ratings' + (avg !== null ? ' (avg ' + (Math.round(avg * 100) / 100) + ')' : ''),
      section: starsEntries[0].section,
      aboveFold: aboveFoldCount > 0,
      visualWeight: 0,
      source: 'text',
      averageRating: avg !== null ? Math.round(avg * 100) / 100 : null,
      count: starsEntries.length,
      aboveFoldCount,
    });
  }

  return filtered;






})()`;


