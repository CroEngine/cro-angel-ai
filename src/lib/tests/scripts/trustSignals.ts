// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const TRUST_SIGNALS_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;

  const PATTERNS = {
    testimonial:        /testimonial|kundr[öo]st|kundcitat|customer story|case study/i,
    review_rating:      /\\b(\\d[.,]\\d)\\s*\\/\\s*5\\b|\\b(\\d[.,]\\d)\\s*av\\s*5\\b|\\b(\\d[.,]\\d)\\s*out of\\s*5\\b/i,
    trusted_by:         /\\b(trusted by|used by|anv[äa]nds av|joined by|loved by|trusted globally by)\\s+[\\d\\w]/i,
    certification:      /\\bISO\\s?\\d{4,5}\\b|\\bGDPR\\b|\\bHIPAA\\b|\\bSOC ?2\\b|\\bPCI[- ]?DSS\\b|certifierad|\\bcertified\\b(?!\\s+(?:experts?|partners?|professionals?|developers?|consultants?|specialists?|resellers?|trainers?|agenc))/i,
    guarantee:          /(\\d+)[- ]?(day|dagars?)\\s+(money[- ]back|n[öo]jd[- ]?kund|garanti|guarantee|returns?)|\\b(?:returns?|refunds?)\\s+polic(?:y|ies)\\b|\\breturns?\\s*(?:&|and|\\/)\\s*exchanges?\\b|\\b(?:free|easy|hassle[- ]free)\\s+returns?\\b|[öo]ppet k[öo]p|money[- ]back guarantee|\\bguarantee[ds]?\\b|\\bwarranty\\b|\\bgaranti\\b/i,
    secure_payment:     /secure (checkout|payment)|s[äa]ker betalning|ssl secured|256[- ]bit/i,
    press_mention:      /as seen in|featured in|som setts i|i pressen|in the news/i,
    social_proof_count: /\\b(\\d{1,3}(?:[ ,.]\\d{3})+|\\d+(?:[.,]\\d+)?[KMBT]|\\d{4,})\\+?\\s*(?:[a-zåäö]+\\s+){0,2}(customers|users|members|kunder|anv[äa]ndare|medlemmar|downloads|nedladdningar|reviews|recensioner|compan(?:y|ies)|businesses|teams|brands|people|developers|organi[sz]ations|websites|sites|stores|merchants|subscribers|installs)/i,
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
    // Stash the source block on every entry so the post-collection hierarchy
    // dedup can walk ancestor/descendant relationships. Stripped before return.
    entry._block = block;
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
      if (
        tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' ||
        tag === 'H1' || tag === 'H2' || tag === 'H3' ||
        tag === 'H4' || tag === 'H5' || tag === 'H6' ||
        tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' ||
        tag === 'FIGCAPTION' || tag === 'UL' || tag === 'OL'
      ) { leaf = false; break; }
    }
    if (!leaf) continue;
    const text = (el.innerText || el.textContent || '').trim();
    if (!text || text.length > 600) continue;
    let blockHadRating = false;
    for (const type in PATTERNS) {
      const rx = PATTERNS[type];
      rx.lastIndex = 0;
      const m = rx.exec(text);
      if (!m) continue;
      // A "N reviews" volume inside a block that ALSO states an X/5 rating is the
      // review COUNT (already captured as review_rating.reviewCount), not an
      // independent social-proof stat. review_rating is evaluated first (PATTERNS
      // order), so skip the redundant social_proof_count for the same block —
      // otherwise a product card "1,306 reviews · 4.6/5" counts as two signals.
      if (type === 'social_proof_count' && blockHadRating) {
        logDecision('text-pattern', 'rejected', 'redundant-with-review_rating-same-block', el, text);
        continue;
      }
      // Sentence-boundary anchor: the match must start at text[0] (or after
      // [.!?]\\s) and end at [.!?] (with optional trailing whitespace) or at
      // block-end. Rejects mid-sentence substring matches like
      // "months for the pipeline to grow ..." extracted from a longer block.
      const start = m.index;
      const end = start + m[0].length;
      const before2 = start >= 2 ? text.slice(start - 2, start) : '';
      const startOk = start === 0 || /[.!?]\\s/.test(before2);
      const after = text.slice(end);
      const endOk = /^\\s*$/.test(after) || /^[.!?](\\s|$)/.test(after);
      // A SHORT block (badge, caption, label, heading) IS trust copy — the
      // matched keyword is the whole point of the block, so accept it even when
      // more words follow ("GDPR Compliant", "30-day money-back guarantee", "As
      // seen in TechCrunch", "Trusted by 4,000+ companies", "Rated 4.8 out of 5
      // by 2,341 customers"). The strict start+end sentence anchor only guards
      // LONG prose blocks, where a keyword buried mid-paragraph is an incidental
      // fragment, not a signal. Without the exemption the anchor silently
      // dropped ~2/3 of real-world trust copy (every phrase with a trailing
      // word). Every PATTERN already carries \\b word boundaries / a specific
      // numeric format, so the keyword can't match inside another word.
      const SHORT_TRUST_BLOCK = 120;
      if (!(startOk && endOk) && text.length > SHORT_TRUST_BLOCK) {
        logDecision('text-pattern', 'rejected', 'incidental-keyword-in-long-prose', el, text, {
          matchedText: m[0], startOk: startOk, endOk: endOk, blockLen: text.length,
        });
        continue;
      }
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
      if (type === 'review_rating') blockHadRating = true;
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
    // A quotation mark proves there is quoted text, NOT that the text is a
    // customer endorsement — news headlines (»…«) and product/music carousels
    // are full of quoted or dashed text. So a bare quote mark (or a hyphen) no
    // longer qualifies a slide on its own; it must come with a real attribution.
    const hasQuoteMark = /[“"„«»]/.test(text);
    const hasTestimonialClass = /testimonial|quote|review/.test(cls);
    // Strong author signal: an explicit <cite>/<figcaption> element with text,
    // OR a customer logo near the card. The previous broad selector
    // ([class*="title" i], [class*="name" i], [class*="role" i]) matched
    // section titles and product feature labels, so it has been removed.
    const strongAuthorEl = el.querySelector('cite, figcaption');
    const strongAuthorText = strongAuthorEl ? (strongAuthorEl.textContent || '').trim() : '';
    const hasStrongAuthor = strongAuthorText.length >= 3 && strongAuthorText.length <= 120;
    const hasLogoImg = !!el.querySelector('img[alt*="logo" i], img[class*="logo" i], [class*="logo" i] img');

    const meta = extractTestimonialMeta(el, text);
    // Attribution: a real testimonial names or marks its endorser. Require one
    // of — an explicit testimonial/quote/review class (author intent), a
    // cite/figcaption author element, a customer logo, or a person name parsed
    // from a "— Jane Doe[, Acme]" author line. A quote mark alone is NOT
    // sufficient (it fired on »…« news headlines and "- Title" music/product
    // carousels). Blockquotes still pass on the tag below.
    const hasAttribution =
      hasTestimonialClass ||
      hasStrongAuthor ||
      hasLogoImg ||
      !!meta.personName;

    // Apply the attribution gate to BOTH slides and explicit testimonial/quote
    // containers (CMS authors sometimes reuse those class names for product
    // cards). Blockquotes still get through on their own merit — the
    // <blockquote> tag itself is the attribution signal.
    const isBlockquote = el.tagName === 'BLOCKQUOTE';
    if (!isBlockquote && !hasAttribution) {
      logDecision('quote-block', 'rejected', 'no attribution signal', el, text, {
        isSlide: isSlide, hasQuoteMark: hasQuoteMark, hasStrongAuthor: hasStrongAuthor,
        hasLogoImg: hasLogoImg, hasTestimonialClass: hasTestimonialClass,
        personName: meta.personName, company: meta.company,
      });
      return;
    }
    logDecision('quote-block', 'accepted',
      isBlockquote ? 'blockquote tag' : (isSlide ? 'slide with attribution' : 'container with attribution'),
      el, text, {
        isSlide: isSlide, hasQuoteMark: hasQuoteMark, hasStrongAuthor: hasStrongAuthor,
        hasLogoImg: hasLogoImg, hasTestimonialClass: hasTestimonialClass,
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



  // 2) Star icons clusters.
  // CRITICAL precision filter: [class*="star"] also matches the CSS-utility
  // tokens "items-start", "col-start-2", "row-start-1", "self-start",
  // "justify-start" (every one contains the substring "star"), so on any
  // Tailwind/grid site (vercel, patagonia, …) hundreds of layout cells were
  // collected as "stars" and miscounted into phantom rating clusters
  // (vercel reported a bogus "avg 1.33", patagonia "avg 0"). Drop a "star"
  // candidate unless it carries a REAL star token — "star" NOT inside "start"
  // (star-not-followed-by-t) — or a star aria-label. "rating"-class candidates
  // pass through unchanged: utility CSS has no "rating" false friend, and
  // tightening it would drop camelCase widgets like MUI's "MuiRating-icon".
  const STAR_TOKEN = /(^|[^a-z])star(?!t)/i;
  const starNodes = Array.from(document.querySelectorAll(
    '[class*="star" i], [class*="rating" i], svg[aria-label*="star" i], i[class*="fa-star"]'
  )).filter((n) => {
    const cls = (n.className && n.className.toString()) || '';
    const aria = (n.getAttribute && n.getAttribute('aria-label')) || '';
    if (/rating/i.test(cls)) return true;                 // unchanged from before
    return STAR_TOKEN.test(cls) || STAR_TOKEN.test(aria); // "star" but not "start"
  });
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

  // 2d) Review-score widgets. A compact container that shows a DECIMAL score
  // co-located with a review COUNT — booking.com "8.5 Very Good · 3,339
  // reviews", "4.6 (1,200 reviews)", hotel/marketplace/e-commerce score cards.
  // The score and label often live in separate child nodes, so the leaf
  // text-scan (PATTERNS.review_rating, /5 only) misses them; scan compact
  // containers here. Tightly gated: a decimal X.Y (or 10) AND "N reviews" in
  // the SAME <=120-char block — both together are specifically a rating widget,
  // so a bare review count ("3,339 reviews") or a stray decimal never fires.
  // Nested duplicates collapse via the hierarchy-dedup pass below.
  const SCORE_RX = /(?:^|[^\\d.,])([0-9][.,][0-9]|10(?:[.,]0)?)(?![\\d.,])/;
  const REVIEWCOUNT_RX = /\\b(\\d{1,3}(?:[ ,.]\\d{3})+|\\d{2,})\\s*(reviews|recensioner|omd[öo]men|ratings|reviews?)\\b/i;
  document.querySelectorAll('div, section, li, article, a, figure, span, p').forEach((el) => {
    // Cheap textContent gate first (no layout): the count keyword must be
    // present, so we only pay innerText on compact rating-context elements.
    const tc = el.textContent || '';
    if (tc.length > 400 || !/review|recension|omd[\\u00f6o]m|rating/i.test(tc)) return;
    const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    if (t.length < 6 || t.length > 120) return;
    const sm = t.match(SCORE_RX);
    const rm = t.match(REVIEWCOUNT_RX);
    if (!sm || !rm) return;
    const val = safeFloat(sm[1]);
    if (val === undefined || val < 1 || val > 10) return;
    const extras = { rating: val, reviewCount: safeInt(rm[1]) };
    if (val > 5) extras.ratingScale = 10; // /10 widget (booking-style); else /5
    push('review_rating', t.slice(0, 80), el, 'widget', extras);
  });

  // 3) Customer-logo walls (img + inline-svg, unified). A wall is a container
  // holding >=4 logo-sized media — imgs (deduped by src) and/or inline svgs,
  // which modern SaaS use for "trusted by" logos (no src/alt), invisible to a
  // plain <img> scan. Emit ONE customer_logos for the largest wall that shows a
  // real logo signal, so a media / e-commerce page's scattered article/product
  // thumbnails don't read as a logo wall — the old global img count read 33
  // article thumbnails on The Verge as customer logos. A wall must be a strip /
  // compact grid (height <= 600; alone this drops a whole-page image scatter)
  // AND carry one of: a logo/customer CONTEXT word on the container or an
  // ancestor; most media carrying "logo" in src/alt; or a wordmark SHAPE (widths
  // vary >=2x AND each wider-than-tall) — brand wordmarks that uniform
  // article/product/icon grids never have.
  const LOGO_CTX = /logo|customer|client|partner|brand|trusted|compan|integrat|powered|works with|used by|backed by/i;
  // A wall of payment-method marks (visa/mastercard/klarna/swish…) is the
  // checkout/secure-payment strip, NOT a customer-logo wall — and these icons
  // often live under /assets/logos/ so they otherwise qualify via "logo" in the
  // path. The secure_payment pass already emits them; skip such walls here.
  const PAYMENT_WALL_RX = /\\b(visa|mastercard|maestro|amex|american express|paypal|klarna|swish|apple ?pay|google ?pay|discover|diners|unionpay|mobilepay|vipps|ideal|bancontact|sofort|giropay|sepa|mada)\\b/;
  const inLogoBox = (r) => r.width >= 40 && r.width <= 240 && r.height >= 14 && r.height <= 120;
  const logoVisible = (el) => {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const logoCands = [];
  const seenLogoSrc = new Set();
  for (const img of document.querySelectorAll('img')) {
    if (!logoVisible(img)) continue;
    const r = img.getBoundingClientRect();
    if (!inLogoBox(r)) continue;
    const src = (img.getAttribute('src') || img.currentSrc || '').split('?')[0];
    if (!src || seenLogoSrc.has(src)) continue;
    seenLogoSrc.add(src);
    logoCands.push({ el: img, kind: 'img', r, hay: ((img.getAttribute('alt') || '') + ' ' + src).toLowerCase() });
  }
  for (const svg of document.querySelectorAll('svg')) {
    if (!logoVisible(svg)) continue;
    const r = svg.getBoundingClientRect();
    if (!inLogoBox(r)) continue;
    const cls = (svg.className && svg.className.toString && svg.className.toString()) || '';
    logoCands.push({ el: svg, kind: 'svg', r, hay: ((svg.getAttribute('aria-label') || '') + ' ' + cls).toLowerCase() });
  }
  if (logoCands.length >= 4 && logoCands.length <= 600) {
    const candSet = new Set(logoCands.map((c) => c.el));
    // each candidate -> nearest ancestor (<=4 hops) holding >=4 candidates (the wall)
    const wallFor = (el) => {
      let p = el.parentElement, hops = 0;
      while (p && p !== document.body && hops++ < 4) {
        let c = 0;
        for (const o of candSet) { if (p.contains(o)) { c++; if (c >= 4) break; } }
        if (c >= 4) return p;
        p = p.parentElement;
      }
      return null;
    };
    const byWall = new Map();
    for (const cand of logoCands) {
      const w = wallFor(cand.el);
      if (!w) continue;
      const arr = byWall.get(w) || [];
      arr.push(cand);
      byWall.set(w, arr);
    }
    const wallEls = Array.from(byWall.keys());
    const outerWalls = wallEls.filter((a) => !wallEls.some((b) => b !== a && b.contains(a)));
    const qualifying = [];
    for (const wall of outerWalls) {
      const members = byWall.get(wall);
      if (!members || members.length < 4) continue;
      const wr = wall.getBoundingClientRect();
      if (wr.height > 600) continue; // strip/compact grid only; drops page-wide scatter
      // Payment-method strip (visa/mastercard/klarna/swish…) -> secure_payment,
      // not a customer-logo wall. Skip when most members are payment marks.
      const paymentMembers = members.filter((m) => PAYMENT_WALL_RX.test(m.hay)).length;
      if (paymentMembers >= 2 && paymentMembers * 2 >= members.length) continue;
      const widths = members.map((m) => m.r.width);
      const widthSpread = Math.max.apply(null, widths) / Math.max(1, Math.min.apply(null, widths));
      const aspects = members.map((m) => m.r.width / Math.max(1, m.r.height)).sort((a, b) => a - b);
      const medAspect = aspects[Math.floor(aspects.length / 2)];
      let ctx = false, node = wall;
      for (let i = 0; i < 4 && node && node !== document.body; i++) {
        const hay = ((node.className && node.className.toString()) || '') + ' ' +
          (node.id || '') + ' ' + ((node.getAttribute && node.getAttribute('aria-label')) || '');
        if (LOGO_CTX.test(hay)) { ctx = true; break; }
        node = node.parentElement;
      }
      const logoInPath = members.filter((m) => m.hay.indexOf('logo') >= 0).length;
      // The pure-visual wordmark path (no logo/customer context word, no "logo"
      // in markup) is the weakest signal — it fired on booking.com's 16px strip
      // of 5 unlabeled sister-brand wordmarks. Require >=6 members there: a small
      // unlabeled wordmark strip is more likely sister-brands / partners /
      // decoration than a customer-logo wall. Context- or "logo"-backed walls
      // still qualify at >=4.
      const wordmarkShape = members.length >= 6 && widthSpread >= 2 && medAspect >= 1.8;
      const accept = ctx || (logoInPath >= 3 && logoInPath * 2 >= members.length) || wordmarkShape;
      if (!accept) continue;
      const vh = window.innerHeight;
      const wallHay = members.map((m) => m.hay).join(' ');
      const recognized = [];
      for (const b of RECOGNIZED_BRANDS) if (wallHay.indexOf(b) >= 0) recognized.push(b);
      qualifying.push({
        wall,
        count: members.length,
        aboveFoldLogoCount: members.filter((m) => m.r.top < vh && m.r.bottom > 0).length,
        recognizedBrands: Array.from(new Set(recognized)).slice(0, 20),
      });
    }
    // Emit ONE signal: a page has a logo wall or it doesn't. Anchor on the
    // largest qualifying wall so a multi-strip site counts once, not per row.
    if (qualifying.length) {
      qualifying.sort((a, b) => b.count - a.count);
      const top = qualifying[0];
      push('customer_logos', String(top.count) + ' logo images', top.wall, 'logo_wall', {
        logoCount: top.count,
        aboveFoldLogoCount: top.aboveFoldLogoCount,
        recognizedBrands: top.recognizedBrands,
        wallCount: qualifying.length,
      });
    }
  }

  // 3b) Third-party review/award badges (G2, Capterra, Trustpilot, etc.)
  const BADGE_BRANDS = /\\bg2\\b|g2crowd|g2\\.com|capterra|trustradius|trustpilot|software ?advice|getapp|gartner peer insights|sourceforge|product hunt|crozdesk|finances ?online|tekpon/i;
  const BADGE_TITLES = /\\b(leader|high performer|momentum leader|easiest to do business with|best (value|support|relationship|usability|est\\.? roi)|top rated|best of \\d{4}|users love us|fastest implementation|rising star|category leader|customers' choice|editors' choice)\\b/i;
  const BADGE_PATH = /\\/badges?\\/(file\\/)?/i;
  // App-store / download badges also live under /badges/ paths but are NOT
  // third-party REVIEW badges — counting them inflated trust (rei's Google-Play
  // + App-Store buttons read as review badges). Exclude them up front.
  const APP_STORE_BADGE = /google.?play|app.?store|apple.?store|microsoft store|windows store|chrome.?web.?store|get.?it.?on|download.?on|f-?droid|galaxy store|app gallery/i;

  const allBadgeImgs = Array.from(document.querySelectorAll('img[alt], img[src]'));
  const badgeRects = new Map();
  for (const img of allBadgeImgs) badgeRects.set(img, img.getBoundingClientRect());

  const badgeImgs = allBadgeImgs.filter((i) => {
    const r = badgeRects.get(i);
    if (!r || r.width < 30 || r.height < 30 || r.width > 320 || r.height > 320) return false;
    const alt = i.getAttribute('alt') || '';
    const src = i.getAttribute('src') || '';
    const hay = (alt + ' ' + src).toLowerCase();
    if (APP_STORE_BADGE.test(hay)) return false;
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





  // 4) Payment-method logos. A genuine "we accept …" strip lists SEVERAL
  // providers, so require >=2 DISTINCT payment brands. Stripe/Klarna/PayPal/
  // Apple-Pay/Google-Pay also appear as marquee CUSTOMER logos, so a lone one is
  // far more likely a customer logo than a checkout trust badge — counting it
  // inflated trust (a single Stripe logo became "1 payment provider logos").
  // Single-provider secure-payment claims are still covered by the textual
  // PATTERNS.secure_payment scan ("secure checkout" / "SSL" / "256-bit").
  const paymentRx = /(visa|mastercard|amex|american express|paypal|stripe|klarna|swish|apple pay|google pay)/i;
  const paymentImgs = Array.from(document.querySelectorAll('img[alt], img[src]')).filter((i) => {
    const r = i.getBoundingClientRect();
    if (r.width < 16 || r.height < 8) return false;
    const alt = (i.getAttribute('alt') || '') + ' ' + (i.getAttribute('src') || '');
    return paymentRx.test(alt);
  });
  const paymentBrands = new Set();
  for (const i of paymentImgs) {
    const m = ((i.getAttribute('alt') || '') + ' ' + (i.getAttribute('src') || '')).match(paymentRx);
    if (m) paymentBrands.add(m[0].toLowerCase());
  }
  if (paymentBrands.size >= 2) {
    const parent = paymentImgs[0].closest('div, section, footer, ul') || paymentImgs[0].parentElement;
    if (parent) push('secure_payment', paymentImgs.length + ' payment provider logos', parent, 'img_alt', {
      paymentBrands: Array.from(paymentBrands).slice(0, 10),
    });
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

    // Product cards in a carousel carry an aggregate star rating too, but they
    // are not testimonials. Reject anything that reads as commerce — a price
    // token (incl. SEK "99:-"), a sale/price label, or an add-to-cart
    // affordance — so "★4.4 GREJSIMOJS … 99:-" is not derived as a quote.
    const COMMERCE_RX = /[$€£¥]\\s?\\d|\\b\\d[\\d  .,]*\\s?(?:kr|sek|usd|eur|gbp|nok|dkk)\\b|\\d+\\s*:\\-|\\b(?:add to (?:cart|bag|basket)|buy now|shop now|in stock|out of stock|sold out|free shipping|fri frakt|k[öo]p\\b|l[äa]gg i|s[äa]nkt pris|tidigare.{0,6}pris|l[äa]gsta pris|ordinarie pris|rea\\b|sale\\b)/i;
    if (COMMERCE_RX.test(fullCardText)) {
      logDecision('stars-anchor', 'rejected', 'commercial/product card', cardEl, fullCardText);
      continue;
    }

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
    if (cleanedText.length < 20) {
      logDecision('stars-anchor', 'rejected', 'cleanedText < 20', cardEl, cleanedText);
      continue;
    }

    logDecision('stars-anchor', 'accepted', 'stars in carousel card', cardEl, cleanedText, {
      personName: meta.personName, company: meta.company, hasImage: meta.hasImage,
      rating: starEntry.rating,
    });
    push('testimonial', cleanedText, cardEl, 'text', Object.assign({}, meta, {
      derivedFromStars: true,
      rating: starEntry.rating,
    }));
  }

  // Hierarchy dedup: within each type, drop entries whose _block is a
  // descendant of another kept entry's _block. Keep root-most (outermost)
  // so the entry preserves attribution context (name + company + logo on
  // the testimonial card, label on the stat card) that inner leaves lack.
  // Sort primary key is DOM depth ascending — the direct structural signal
  // for "container vs leaf". Tiebreak on bounding-box area descending.
  (function hierarchyDedup() {
    const depthCache = new Map();
    function depth(el) {
      if (depthCache.has(el)) return depthCache.get(el);
      let d = 0; let p = el;
      while (p && p !== document.body) { d++; p = p.parentElement; }
      depthCache.set(el, d);
      return d;
    }
    function area(el) {
      const r = el.getBoundingClientRect();
      return r.width * r.height;
    }
    const byType = new Map();
    for (const e of out) {
      if (!e._block) continue;
      const arr = byType.get(e.type) || [];
      arr.push(e);
      byType.set(e.type, arr);
    }
    const dropSet = new Set();
    for (const group of byType.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => depth(a._block) - depth(b._block) || area(b._block) - area(a._block));
      const kept = [];
      for (const e of group) {
        const dominator = kept.find((k) => k._block !== e._block && k._block.contains(e._block));
        if (dominator) {
          dropSet.add(e);
          logDecision('hierarchy-dedup', 'rejected', 'descendant of kept entry', e._block, e.text, {
            dominatorSelector: dominator.selector,
          });
        } else {
          kept.push(e);
        }
      }
    }
    for (let i = out.length - 1; i >= 0; i--) if (dropSet.has(out[i])) out.splice(i, 1);
  })();

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
    if (seenTestimonialText.has(key)) {
      logDecision('dedup-text', 'rejected', 'duplicate testimonial text', null, e.text);
      return false;
    }
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

  return { signals: filtered, _debug: debug };






})()`;


