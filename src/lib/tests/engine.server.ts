// Stagehand-based step engine. Runs against an already-created Browserbase session.

import { Stagehand } from "@browserbasehq/stagehand";

function readJpegDimensions(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSOF) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { w, h };
    }
    const segLen = buf.readUInt16BE(i + 2);
    i += 2 + segLen;
  }
  return null;
}

export type Step =
  | { kind: "goto"; url: string }
  | { kind: "wait"; ms: number }
  | { kind: "assertText"; text: string }
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "act"; instruction: string }
  | { kind: "extract"; instruction: string }
  | { kind: "observe"; instruction: string }
  | { kind: "collect"; target: CollectTarget };

export type CollectTarget = "clickables" | "buttons";

export type ElementCategory =
  | "cta_primary"
  | "cta_secondary"
  | "form_submit"
  | "icon_button"
  | "nav_item"
  | "link"
  | "other";

export type ViewportZone = "above_fold" | "mid_page" | "below_fold";

export type ElementIntent =
  | "conversion"
  | "information"
  | "navigation"
  | "social"
  | "utility"
  | "unknown";

export type CollectedElement = {
  text: string;
  tagName: string;
  selector: string;
  category: ElementCategory;
  intent: ElementIntent;
  href: string | null;
  disabled: boolean;
  visible: boolean;
  aboveFold: boolean;
  rect: { x: number; y: number; w: number; h: number };
  position: {
    viewportZone: ViewportZone;
    yPercent: number;
    xPercent: number;
  };
  visualWeight: {
    area: number;
    fontSize: number;
    fontWeight: number;
    backgroundContrast: number;
    score: number;
  };
  attributes: Record<string, string>;
  computedStyles: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontWeight: string;
    padding: string;
    borderRadius: string;
    border: string;
    cursor: string;
    display: string;
  };
};



export type EngineEvent =
  | { type: "step_started"; index: number; kind: Step["kind"]; summary: string }
  | { type: "step_passed"; index: number; kind: Step["kind"]; summary: string; durationMs: number; data?: unknown }
  | { type: "step_failed"; index: number; kind: Step["kind"]; summary: string; durationMs: number; error: string }
  | { type: "log"; message: string };

function summarize(step: Step): string {
  switch (step.kind) {
    case "goto": return `goto ${step.url}`;
    case "wait": return `wait ${step.ms}ms`;
    case "assertText": return `assertText "${step.text}"`;
    case "click": return `click ${step.selector}`;
    case "fill": return `fill ${step.selector} = "${step.value}"`;
    case "act": return `act "${step.instruction}"`;
    case "extract": return `extract "${step.instruction}"`;
    case "observe": return `observe "${step.instruction}"`;
    case "collect": return `collect ${step.target}`;
  }
}

export async function runSteps(
  sessionId: string,
  steps: Step[],
  opts: { onEvent: (e: EngineEvent) => void; signal?: AbortSignal },
): Promise<{ passed: number; failed: number; aborted: boolean }> {
  const { onEvent, signal } = opts;
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY missing");
  if (!projectId) throw new Error("BROWSERBASE_PROJECT_ID missing");

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    browserbaseSessionID: sessionId,
    // keepAlive: stagehand.close() should disconnect Stagehand only,
    // not terminate the Browserbase session — the session lives on so the
    // live iframe can keep showing the collect overlay until closeSession()
    // in the orchestrator's terminate() callback runs.
    keepAlive: true,
  });

  let passed = 0;
  let failed = 0;
  let aborted = false;
  let initialized = false;
  let crashed = false;

  try {
    await stagehand.init();
    initialized = true;

    for (let i = 0; i < steps.length; i++) {
      if (signal?.aborted) { aborted = true; break; }

      const step = steps[i];
      const summary = summarize(step);
      const index = i + 1;
      onEvent({ type: "step_started", index, kind: step.kind, summary });
      const t0 = Date.now();

      try {
        const page = stagehand.context.pages()[0] ?? (await stagehand.context.newPage());
        let data: unknown = undefined;

        switch (step.kind) {
          case "goto": {
            const existing = stagehand.context.pages()[0];
            if (existing) await existing.goto(step.url);
            else await stagehand.context.newPage(step.url);
            break;
          }
          case "wait":
            await new Promise((res) => setTimeout(res, step.ms));
            break;
          case "assertText": {
            const deadline = Date.now() + 5000;
            const needle = step.text.toLowerCase();
            let found = false;
            while (Date.now() < deadline) {
              if (signal?.aborted) break;
              try {
                const text = await page.evaluate<string>(
                  "(document.body && document.body.innerText) || ''",
                );
                if (typeof text === "string" && text.toLowerCase().includes(needle)) {
                  found = true;
                  break;
                }
              } catch { /* retry */ }
              await new Promise((res) => setTimeout(res, 300));
            }
            if (!found) throw new Error(`text "${step.text}" not found within 5000ms`);
            break;
          }
          case "click":
          case "fill":
            throw new Error(`step kind "${step.kind}" not yet wired — use "act" instead`);
          case "act":
            data = await stagehand.act(step.instruction);
            break;
          case "extract":
            data = await stagehand.extract(step.instruction);
            break;
          case "observe":
            data = await stagehand.observe(step.instruction);
            break;
          case "collect": {
            // Scroll through the page so lazy/intersection-observer content mounts.
            try {
              for (const pct of [0, 25, 50, 75, 100]) {
                await page.evaluate(`window.scrollTo({ top: document.documentElement.scrollHeight * ${pct / 100}, behavior: 'instant' })`);
                await new Promise((res) => setTimeout(res, 400));
              }
              await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
              await new Promise((res) => setTimeout(res, 200));
              onEvent({ type: "log", message: "scrolled page to trigger lazy content" });
            } catch (e) {
              onEvent({ type: "log", message: `scroll failed: ${e instanceof Error ? e.message : String(e)}` });
            }

            const elements = await page.evaluate(COLLECT_SCRIPT);
            const all = elements as CollectedElement[];
            const filtered = filterCollected(all, step.target);
            const byCategory: Record<string, number> = {};
            const intentBreakdown: Record<string, number> = {};
            let aboveFold = 0;
            let primaryCtaCount = 0;
            let competingAboveFold = 0;
            for (const el of filtered) {
              byCategory[el.category] = (byCategory[el.category] ?? 0) + 1;
              intentBreakdown[el.intent] = (intentBreakdown[el.intent] ?? 0) + 1;
              if (el.position.viewportZone === "above_fold") aboveFold++;
              if (el.category === "cta_primary" && el.intent === "conversion") primaryCtaCount++;
              if (
                (el.category === "cta_primary" || el.category === "cta_secondary" || el.category === "form_submit") &&
                el.position.viewportZone === "above_fold" &&
                el.intent !== "navigation"
              ) competingAboveFold++;
            }
            const topVisualWeight = [...filtered]
              .sort((a, b) => b.visualWeight.score - a.visualWeight.score)
              .slice(0, 5)
              .map((el) => ({ selector: el.selector, text: el.text, score: el.visualWeight.score }));

            // Capture screenshot BEFORE drawing the live overlay, so the client
            // can render its own overlay on a clean image (and toggle it).
            let screenshot: { dataUrl: string; viewport: { w: number; h: number } } | undefined;
            try {
              const vp = (await page.evaluate<{ w: number; h: number }>(
                "({ w: window.innerWidth, h: window.innerHeight })",
              )) ?? { w: 1280, h: 720 };
              const rawFullH = (await page.evaluate<number>(
                "document.documentElement.scrollHeight",
              )) ?? vp.h;
              const fullH = Math.min(Math.max(rawFullH, vp.h), 8000);
              const buf = await page.screenshot({ type: "jpeg", quality: 50, fullPage: true });
              const b64 = Buffer.from(buf).toString("base64");
              screenshot = {
                dataUrl: `data:image/jpeg;base64,${b64}`,
                viewport: { w: vp.w, h: fullH },
              };
              onEvent({ type: "log", message: `screenshot captured (${Math.round(buf.length / 1024)}kb, fullPage ${vp.w}×${fullH})` });
            } catch (e) {
              onEvent({ type: "log", message: `screenshot failed: ${e instanceof Error ? e.message : String(e)}` });
            }

            // Subset for FrozenViewport overlay rendering.
            const overlayElements = filtered.map((el) => ({
              selector: el.selector,
              category: el.category,
              rect: el.rect,
            }));

            // Draw color-coded overlay rectangles in the live page.
            try {
              const pairs = filtered.map((el) => [el.selector, el.category]);
              await page.evaluate(`(${OVERLAY_FN.toString()})(${JSON.stringify(pairs)})`);
            } catch (e) {
              onEvent({ type: "log", message: `overlay failed: ${e instanceof Error ? e.message : String(e)}` });
            }
            data = {
              target: step.target,
              count: filtered.length,
              byCategory,
              summary: {
                total: filtered.length,
                aboveFold,
                primaryCtaCount,
                competingAboveFold,
                topVisualWeight,
                intentBreakdown,
              },
              elements: filtered,
              overlayElements,
              screenshot,
            };
            onEvent({
              type: "log",
              message: `collect ${step.target}: ${filtered.length} · ${aboveFold} above fold · ${primaryCtaCount} primary CTA · competing above fold: ${competingAboveFold}`,
            });
            break;
          }



        }

        void page;

        passed++;
        onEvent({ type: "step_passed", index, kind: step.kind, summary, durationMs: Date.now() - t0, data });
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        onEvent({ type: "step_failed", index, kind: step.kind, summary, durationMs: Date.now() - t0, error: message });
        break; // stop on first failure
      }
    }
  } catch (err) {
    crashed = true;
    throw err;
  } finally {
    // Only disconnect Stagehand if init failed or the run crashed before the
    // orchestrator's hold/close window. Otherwise leave Stagehand attached so
    // the live-view CDP/WebSocket isn't torn down — closeSession(sessionId)
    // in the orchestrator is the single source of truth for ending the session.
    if (!initialized || crashed) {
      try { await stagehand.close(); } catch { /* ignore */ }
      onEvent({ type: "log", message: "stagehand closed (init/crash cleanup)" });
    } else {
      onEvent({ type: "log", message: "stagehand left attached — session ends via closeSession()" });
    }
  }

  return { passed, failed, aborted };
}


function filterCollected(all: CollectedElement[], target: CollectTarget): CollectedElement[] {
  if (target === "buttons") {
    // Strict: real <button>, <input type=submit|button>, role=button only.
    return all.filter((el) =>
      el.tagName === "button" ||
      el.tagName === "input[type=submit]" ||
      el.tagName === "input[type=button]" ||
      el.tagName === "[role=button]"
    );
  }
  // "clickables" → everything we collected.
  return all;
}


// Runs in the browser via page.evaluate — must be self-contained string.
const COLLECT_SCRIPT = `(() => {
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

  function isVisible(el, cs, rect) {
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity || '1') === 0) return false;
    if (rect.width < 1 || rect.height < 1) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
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
    if (testId) return el.tagName.toLowerCase() + '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-') && a.value && a.value.length < 64) {
        return el.tagName.toLowerCase() + '[' + a.name + '="' + a.value.replace(/"/g, '\\\\"') + '"]';
      }
    }
    const parent = el.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      const idx = same.indexOf(el) + 1;
      return el.tagName.toLowerCase() + ':nth-of-type(' + idx + ')';
    }
    return el.tagName.toLowerCase();
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
    conversion: /(book|buy|demo|start|get started|sign[- ]?up|signup|subscribe|request|trial|checkout|order|beställ|köp|boka|prova|kom igång)/i,
    information: /(learn|read|explore|see how|how|why|about|läs|utforska|så funkar)/i,
    navigation: /(login|log in|sign in|account|menu|home|logga in|mina sidor|hem)/i,
    social: /(facebook|instagram|linkedin|twitter|youtube|tiktok|share|dela)/i,
    utility: /(search|sök|language|språk|cookie|accept|godkänn|contact|kontakt)/i,
  };

  function classifyIntent(el, text) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const isFormSubmit = (tag === 'BUTTON' && type === 'submit') || (tag === 'INPUT' && type === 'submit');
    const t = (text || '').trim();
    if (!t) return isFormSubmit ? 'conversion' : 'unknown';
    if (INTENT_RX.conversion.test(t)) return 'conversion';
    if (INTENT_RX.navigation.test(t)) return 'navigation';
    if (INTENT_RX.social.test(t)) return 'social';
    if (INTENT_RX.utility.test(t)) return 'utility';
    if (INTENT_RX.information.test(t)) return 'information';
    return isFormSubmit ? 'conversion' : 'unknown';
  }

  // WCAG relative luminance + contrast ratio
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
  function contrastRatio(a, b) {
    const la = relLum(a), lb = relLum(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  const bodyBg = parseRgb(window.getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255 };

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
    const elBg = parseRgb(cs.backgroundColor);
    const backgroundContrast = elBg ? contrastRatio(elBg, bodyBg) : 1;

    raw.push({
      el, rect, cs, text, attrs,
      docTop, docLeft, yPercent, xPercent, viewportZone,
      area, fontSize, fontWeight, backgroundContrast,
    });
  }

  // Second pass: normalize visualWeight score and emit
  const out = [];
  for (const r of raw) {
    const areaN = r.area / maxArea;                  // 0–1
    const fontN = norm(r.fontSize, 10, 48);           // 0–1
    const weightN = norm(r.fontWeight, 300, 800);     // 0–1
    const contrastN = norm(r.backgroundContrast, 1, 10); // 0–1
    const score = Math.round((areaN * 0.40 + fontN * 0.20 + weightN * 0.10 + contrastN * 0.30) * 100);

    out.push({
      text: r.text,
      tagName: classifyTag(r.el),
      selector: buildSelector(r.el),
      category: classifyCategory(r.el, r.cs, r.rect, r.text),
      intent: classifyIntent(r.el, r.text),
      href: r.el.tagName === 'A' ? (r.el.getAttribute('href') || null) : null,
      disabled: !!r.el.disabled || r.el.getAttribute('aria-disabled') === 'true',
      visible: true,
      aboveFold: r.viewportZone === 'above_fold',
      rect: { x: Math.round(r.rect.x), y: Math.round(r.rect.y), w: Math.round(r.rect.width), h: Math.round(r.rect.height) },
      position: {
        viewportZone: r.viewportZone,
        yPercent: Math.round(r.yPercent * 10) / 10,
        xPercent: Math.round(r.xPercent * 10) / 10,
      },
      visualWeight: {
        area: Math.round(r.area),
        fontSize: Math.round(r.fontSize),
        fontWeight: r.fontWeight,
        backgroundContrast: Math.round(r.backgroundContrast * 10) / 10,
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


// Injected into the live Browserbase page to draw color-coded highlight rectangles per category.
function OVERLAY_FN(pairs: Array<[string, string]>) {
  const OVERLAY_ID = "__lovable_collect_overlay__";
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const COLORS: Record<string, string> = {
    cta_primary: "#10b981",
    cta_secondary: "#22d3ee",
    form_submit: "#f59e0b",
    icon_button: "#a78bfa",
    nav_item: "#64748b",
    link: "#60a5fa",
    other: "#f472b6",
  };

  const wrap = document.createElement("div");
  wrap.id = OVERLAY_ID;
  wrap.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;";
  document.body.appendChild(wrap);

  pairs.forEach(([sel, category], i) => {
    let el: Element | null = null;
    try { el = document.querySelector(sel); } catch { el = null; }
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    const color = COLORS[category] ?? COLORS.other;

    const box = document.createElement("div");
    box.style.cssText = [
      "position:absolute",
      `top:${Math.round(r.top + window.scrollY)}px`,
      `left:${Math.round(r.left + window.scrollX)}px`,
      `width:${Math.round(r.width)}px`,
      `height:${Math.round(r.height)}px`,
      `outline:2px solid ${color}`,
      `background:${color}1f`,
      "box-sizing:border-box",
      "pointer-events:none",
    ].join(";");

    const badge = document.createElement("div");
    badge.textContent = String(i + 1);
    badge.style.cssText = [
      "position:absolute",
      "top:-10px",
      "left:-10px",
      "min-width:20px",
      "height:20px",
      "padding:0 6px",
      "border-radius:10px",
      `background:${color}`,
      "color:#fff",
      "font:bold 11px system-ui,sans-serif",
      "line-height:20px",
      "text-align:center",
      "box-shadow:0 1px 3px rgba(0,0,0,0.3)",
    ].join(";");

    box.appendChild(badge);
    wrap.appendChild(box);
  });
}

