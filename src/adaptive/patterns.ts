// Angel Adaptive — the Pattern Library + applier (v2: layout-safe).
//
// The step past "investigate": the snippet changes the page — but ONLY in ways
// that can't break an arbitrary third-party layout. v1 moved/cloned structural
// nodes and mangled real grids (HubSpot); v2 drops that. The safe primitives:
//   * STYLE an existing element in place (no reflow of siblings) — emphasis.
//   * PREPEND one isolated, self-contained banner at the very top of <body>
//     (shifts the page down uniformly; never injected into an internal grid).
// Both reuse content already on the page, record how to undo themselves, are
// skipped if their target is missing, and are try/caught so a failure can never
// reach the host page. The decision engine (which visitor sees which pattern)
// is a later layer; for now every applicable pattern runs once.

import type { ContentInventory } from "./inventory";

export type AppliedChange = {
  patternId: string;
  label: string;
  detail: string;
};

export type AdaptationResult = {
  applied: AppliedChange[];
  revert: () => void;
};

type ApplyCtx = { reverts: Array<() => void> };

function q(sel?: string): HTMLElement | null {
  if (!sel) return null;
  try {
    return document.querySelector(sel) as HTMLElement | null;
  } catch {
    return null;
  }
}

type Pattern = (inv: ContentInventory, ctx: ApplyCtx) => AppliedChange | null;

// Words that are navigation, not a conversion action — never emphasise these,
// even if the CTA classifier tagged one as primary (Stripe's "Products").
const NAV_WORDS =
  /^(products?|solutions?|developers?|resources?|pricing|company|about|docs?|support|contact|sign ?in|log ?in|login|menu|features?|customers?|blog|partners?|enterprise|home|search|cart)$/i;

// ── v0.5: site-aware bar theming ────────────────────────────────────────────
// One hardcoded light-blue bar looked foreign on dark sites (sentry, railway).
// Detect the page's own light/dark theme from the effective background and
// pick a bar palette that sits naturally on it. Neutral by design — matching
// the site's accent color is a later step (contrast guarantees first).
function effectiveBg(): [number, number, number] {
  let el: HTMLElement | null = document.body;
  while (el) {
    const c = window.getComputedStyle(el).backgroundColor || "";
    const m = c.match(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?\)/);
    if (m && (m[4] === undefined || parseFloat(m[4]) > 0.4)) {
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    }
    el = el.parentElement;
  }
  return [255, 255, 255];
}
function pageIsDark(): boolean {
  const [r, g, b] = effectiveBg();
  // Relative-luminance approximation is plenty for a binary theme choice.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}
// A position:FIXED top header does not participate in flow: a prepended bar
// pushes the page down but not the header, which then paints OVER the bar —
// the exact "something looks off" failure the product must never ship. Sticky
// and static headers are pushed down correctly (monday, deel — verified in
// screenshots). Detect a viewport-wide fixed bar hugging the top; when one
// exists the bar patterns REFUSE (refusal beats weirdness).
export function hasFixedTopHeader(): boolean {
  const cands = new Set<Element>([
    ...Array.from(document.querySelectorAll("header, nav, [role='banner']")),
    ...Array.from(document.body?.children ?? []),
  ]);
  for (const el of cands) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = window.getComputedStyle(el);
    if (cs.position !== "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.top <= 2 && r.height >= 24 && r.height <= 200 && r.width >= window.innerWidth * 0.8) {
      return true;
    }
  }
  return false;
}

type BarKind = "trust" | "risk";
function barPalette(kind: BarKind): { bg: string; fg: string; border: string } {
  if (pageIsDark()) {
    return kind === "trust"
      ? { bg: "rgba(23,32,52,.97)", fg: "#dbe7ff", border: "rgba(120,150,220,.35)" }
      : { bg: "rgba(16,38,28,.97)", fg: "#c9f2d9", border: "rgba(80,190,130,.35)" };
  }
  return kind === "trust"
    ? { bg: "#eaf1ff", fg: "#0b1f3a", border: "#cfe0ff" }
    : { bg: "#e8f8ee", fg: "#0a3d1f", border: "#bfe8cd" };
}
function makeBar(id: string, text: string, kind: BarKind): HTMLElement {
  const p = barPalette(kind);
  const bar = document.createElement("div");
  bar.setAttribute("data-angel-adaptation", id);
  bar.textContent = text;
  bar.style.cssText = [
    "all:initial",
    "display:block",
    "box-sizing:border-box",
    "width:100%",
    "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
    "font-size:14px",
    "font-weight:600",
    `color:${p.fg}`,
    `background:${p.bg}`,
    `border-bottom:1px solid ${p.border}`,
    "text-align:center",
    "padding:9px 16px",
    "line-height:1.35",
  ].join(";");
  return bar;
}

// ── v0.5: bar-text quality gate ─────────────────────────────────────────────
// The 101-site sweep showed weak picks: label-only strings ("Case Study",
// "Widget rating") and mid-word truncation. Score candidates — numeric claims
// first, one-line lengths preferred, bare labels rejected — and cut on a word
// boundary.
const BAR_LABEL_JUNK =
  /^[""''"]*\s*(case stud(y|ies)|widget rating|reviews?|testimonials?|customers?|ratings?|trusted|betyg|recensioner|kundcase)\s*[""''"]*$/i;
export function scoreBarText(raw: string): number {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (s.length < 12 || s.length > 200) return -1;
  if (BAR_LABEL_JUNK.test(s)) return -1;
  let score = 0;
  if (/\d/.test(s)) score += 3;
  if (/%|\/5|\+|★/.test(s)) score += 1;
  if (s.length >= 20 && s.length <= 90) score += 2;
  return score;
}
export function truncateBarText(raw: string, max = 96): string {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const atWord = cut.slice(0, Math.max(20, cut.lastIndexOf(" ")));
  return atWord + "…";
}

// Surface the strongest EXISTING trust signal as a slim bar at the very top.
// Layout-safe: one isolated, self-contained element prepended to <body> — it
// shifts the page down uniformly and is never injected into an internal grid.
const trustBar: Pattern = (inv, ctx) => {
  // v0.5: score ALL candidates through the quality gate instead of taking the
  // first — numeric claims ("Rated 4.7/5 by 10,000+ users") beat bare labels.
  const cands = [
    ...inv.trust.ratings,
    ...inv.trust.socialProof,
    ...inv.trust.trustedBy,
    ...inv.trust.testimonials,
  ]
    .map((sig) => {
      let text = (sig.text || "").replace(/\s+/g, " ").trim();
      if (sig.type === "testimonial") text = `“${truncateBarText(text, 90)}”`;
      return { text, score: scoreBarText(text) };
    })
    .filter((c) => c.score >= 1)
    .sort((a, b) => b.score - a.score);
  const best = cands[0];
  if (!best) return null;
  if (hasFixedTopHeader()) return null; // bar would paint under the fixed header
  const text = truncateBarText(best.text);

  const bar = makeBar("trust_bar", text, "trust");
  document.body.insertBefore(bar, document.body.firstChild);
  ctx.reverts.push(() => bar.remove());
  return { patternId: "trust_bar", label: "Surface trust bar", detail: text.slice(0, 60) };
};

// Emphasise the real primary conversion CTA — STYLE ONLY (no reflow), with
// careful targeting so it lands on a hero action, not a nav item.
const emphasizePrimaryCta: Pattern = (inv, ctx) => {
  const candidates = inv.ctas.filter((c) => {
    const t = (c.text || "").trim();
    return (
      t.length >= 2 &&
      c.section !== "nav" &&
      c.section !== "header" &&
      c.section !== "footer" &&
      !NAV_WORDS.test(t)
    );
  });
  const cta =
    candidates.find((c) => c.section === "hero" && c.intent === "conversion") ??
    candidates.find((c) => c.section === "hero" && c.category === "cta_primary") ??
    candidates.find((c) => c.intent === "conversion" && c.aboveFold) ??
    candidates.find((c) => c.category === "cta_primary");
  const el = q(cta?.selector);
  if (!el || !cta) return null;
  const prev = el.getAttribute("style") ?? "";
  el.style.boxShadow = "0 0 0 3px rgba(37,99,235,.55), 0 12px 30px rgba(37,99,235,.35)";
  el.style.transform = "scale(1.04)";
  el.style.transition = "transform .15s ease";
  // Tagged so visual-acceptance checks can find the emphasized element.
  el.setAttribute("data-angel-emphasis", "1");
  ctx.reverts.push(() => {
    el.setAttribute("style", prev);
    el.removeAttribute("data-angel-emphasis");
  });
  return {
    patternId: "emphasize_primary_cta",
    label: "Emphasise primary CTA",
    detail: `"${cta.text}"`,
  };
};

// Risk-reducer bar (v3): surface the page's OWN risk-killing copy — a
// money-back / free-trial / no-card guarantee or a compliance cert — as the
// top bar. The price-hesitant visitor's objection is risk; the copy that
// answers it usually sits below the fold. Same isolated-prepend primitive as
// trustBar (one bar max per page — the applier ensures the slot is free).
// v0.5: free-trial/no-card CLAIMS are the strongest risk killers on pricing
// pages, but they live in hero microcopy / headings, not the guarantee
// detector. Scan the inventory's own text fields for them as an extra source.
const FREE_TRIAL_RX =
  /\b(\d{1,2}[- ]day free trial|free \d{1,2}[- ]day trial|no credit card( required| needed)?|cancel anytime|gratis provperiod|utan kreditkort|prova gratis( i \d+ dagar)?|avsluta n[äa]r du vill|ingen bindningstid)\b/i;
function freeTrialClaim(inv: ContentInventory): string | null {
  const fields: string[] = [
    inv.page?.hero?.subheadline ?? "",
    inv.page?.hero?.headline ?? "",
    ...inv.sections.map((s) => s.heading || ""),
  ];
  for (const f of fields) {
    const m = f.match(FREE_TRIAL_RX);
    if (m) {
      const s = f.replace(/\s+/g, " ").trim();
      return s.length <= 120 ? s : m[0];
    }
  }
  return null;
}

const riskReducerBar: Pattern = (inv, ctx) => {
  if (document.querySelector('[data-angel-adaptation]')) return null; // one bar max
  const sources = [
    ...inv.trust.guarantees.map((s) => s.text || ""),
    freeTrialClaim(inv) ?? "",
    ...inv.trust.certifications.map((s) => s.text || ""),
  ];
  const best = sources
    .map((t) => ({ text: (t || "").replace(/\s+/g, " ").trim(), score: scoreBarText(t) }))
    .filter((c) => c.text.length >= 8 && c.score >= 0)
    .sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  if (hasFixedTopHeader()) return null; // bar would paint under the fixed header
  const text = truncateBarText(best.text, 120);
  const bar = makeBar("risk_reducer_bar", text, "risk");
  document.body.insertBefore(bar, document.body.firstChild);
  ctx.reverts.push(() => bar.remove());
  return { patternId: "risk_reducer_bar", label: "Surface risk-reducer", detail: text.slice(0, 60) };
};

// Pricing spotlight (v3): STYLE-only emphasis on the page's existing pricing
// section — soft tinted ring, no reflow — so the price-curious visitor finds
// it instantly. First version deliberately coarse (whole section, not a plan
// card); plan-card targeting needs card-level inventory (v4).
const pricingSpotlight: Pattern = (inv, ctx) => {
  const sec = inv.sections.find((s) => s.type === "pricing" && s.selector);
  const el = q(sec?.selector);
  if (!el || !sec) return null;
  const prev = el.getAttribute("style") ?? "";
  el.style.boxShadow = "0 0 0 3px rgba(16,122,66,.45), 0 10px 34px rgba(16,122,66,.18)";
  el.style.borderRadius = "12px";
  ctx.reverts.push(() => el.setAttribute("style", prev));
  return {
    patternId: "pricing_spotlight",
    label: "Spotlight pricing section",
    detail: sec.heading || sec.selector || "",
  };
};

// ── v0.6: visual REORDERING without touching the DOM ────────────────────────
// "Flytta runt" done safely: CSS `order` changes what the visitor SEES while
// the DOM (and the site's framework) never changes. On flex/grid parents the
// property just works; block-stacked parents are promoted to flex-column,
// which CAN shift spacing (margin collapsing differs) — so the pattern
// SELF-CHECKS: it snapshots every sibling's rect, applies, re-measures, and
// ROLLS ITSELF BACK unless everything landed within tight tolerances (same
// width/left, same height, no overlaps, total page height within 3%). A
// reorder that can't be proven invisible-but-for-the-order does not ship —
// the pattern refuses instead. The move itself: bring the social-proof
// (testimonials) section up to sit right after the hero — the classic
// "skeptical reader needs proof early" play.
const reorderProofFirst: Pattern = (inv, ctx) => {
  const secs = inv.sections;
  const ti = secs.findIndex((s) => s.type === "testimonials" && s.selector);
  if (ti < 0) return null;
  const heroI = secs.findIndex((s) => s.type === "hero" && s.selector);
  const anchorI = heroI >= 0 ? heroI : 0;
  if (ti <= anchorI + 2) return null; // proof already sits early — nothing to gain
  const testiEl = q(secs[ti].selector);
  const anchorEl = q(secs[anchorI].selector);
  if (!testiEl || !anchorEl) return null;
  const parent = testiEl.parentElement;
  if (!parent || anchorEl.parentElement !== parent) return null; // must be siblings
  const kids = Array.from(parent.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
  if (kids.length < 3 || kids.length > 40) return null;

  const before = new Map(kids.map((k) => [k, k.getBoundingClientRect()]));
  const docH = document.documentElement.scrollHeight;
  const parentPrev = parent.getAttribute("style") ?? "";
  const kidPrev = new Map(kids.map((k) => [k, k.getAttribute("style") ?? ""]));
  const undo = () => {
    parent.setAttribute("style", parentPrev);
    parent.removeAttribute("data-angel-reorder");
    for (const k of kids) k.setAttribute("style", kidPrev.get(k) ?? "");
  };

  try {
    const cs = window.getComputedStyle(parent);
    const isFlexCol =
      cs.display.indexOf("flex") !== -1 &&
      (cs.flexDirection === "column" || cs.flexDirection === "column-reverse");
    const isGrid = cs.display.indexOf("grid") !== -1;
    if (!isFlexCol && !isGrid) {
      // Block-stacked: promote to flex-column so `order` takes effect. Any
      // margin-collapse spacing drift is caught by the self-check below.
      parent.style.display = "flex";
      parent.style.flexDirection = "column";
    }
    kids.forEach((k, i) => {
      k.style.order = String(i * 2);
    });
    testiEl.style.order = String(kids.indexOf(anchorEl) * 2 + 1);
    parent.setAttribute("data-angel-reorder", "1");

    // SELF-CHECK — every sibling must land where flow says it should, changed
    // only in vertical order. Tolerances: width/left ±2px, own height ±12px,
    // no vertical overlap beyond 8px, document height within max(48px, 3%).
    let bad = false;
    const after = kids.map((k) => ({ k, r: k.getBoundingClientRect() }));
    for (const { k, r } of after) {
      const b = before.get(k)!;
      if (Math.abs(r.width - b.width) > 2 || Math.abs(r.left - b.left) > 2) { bad = true; break; }
      if (Math.abs(r.height - b.height) > 12) { bad = true; break; }
    }
    if (!bad) {
      const dh = Math.abs(document.documentElement.scrollHeight - docH);
      if (dh > Math.max(48, docH * 0.03)) bad = true;
    }
    if (!bad) {
      const vis = after.filter((x) => x.r.height > 1).sort((a, b) => a.r.top - b.r.top);
      for (let i = 1; i < vis.length; i++) {
        if (vis[i].r.top < vis[i - 1].r.bottom - 8) { bad = true; break; }
      }
    }
    if (bad) {
      undo();
      return null; // provably-clean reorder not possible here — refuse
    }
  } catch {
    undo();
    return null;
  }

  ctx.reverts.push(undo);
  return {
    patternId: "reorder_proof_first",
    label: "Move social proof up",
    detail: `"${(secs[ti].heading || "testimonials").slice(0, 40)}" → after ${secs[anchorI].type}`,
  };
};

const ALL_PATTERNS: Record<string, Pattern> = {
  trust_bar: trustBar,
  emphasize_primary_cta: emphasizePrimaryCta,
  risk_reducer_bar: riskReducerBar,
  pricing_spotlight: pricingSpotlight,
  reorder_proof_first: reorderProofFirst,
};

// ── The decision layer (v3): which visitor sees which patterns ──────────────
// A segment names a visitor situation the behavior data can support; each maps
// to an ordered pattern set. "default" preserves the v2 behavior (trust bar +
// CTA emphasis) so existing installs are unchanged.
export type Segment = "default" | "new_skimmer" | "engaged_no_click" | "price_hesitant";

export const SEGMENT_PATTERNS: Record<Segment, string[]> = {
  default: ["trust_bar", "emphasize_primary_cta"],
  // First-time visitor bouncing along the surface: earn trust immediately.
  new_skimmer: ["trust_bar"],
  // Read deep, clicked nothing: the offer is interesting but the action isn't
  // landing — bring the proof up (v0.6 reorder), emphasise the action, and
  // back it with the trust bar.
  engaged_no_click: ["reorder_proof_first", "emphasize_primary_cta", "trust_bar"],
  // Interested in price but hesitant: answer the risk objection with the
  // page's own guarantee copy and light the pricing section up.
  price_hesitant: ["risk_reducer_bar", "pricing_spotlight"],
};

// Derive a segment from THIS session's real behavior events. Deliberately
// conservative: only patterns the events can actually support; anything murky
// stays "default". (Cross-session signals — returning visitor, pricing-page
// revisits — arrive with the collector-backed profile in a later milestone.)
export function deriveSegment(
  events: Array<{ type: string; value?: number }>,
  inv: ContentInventory,
): Segment {
  const maxScroll = Math.max(0, ...events.filter((e) => e.type === "scroll_depth").map((e) => e.value ?? 0));
  const ctaClicks = events.filter((e) => e.type === "cta_click").length;
  // The tracker emits time_on_page in MILLISECONDS (Date.now() - started); the
  // thresholds here think in seconds. Normalize: anything over 1000 is ms.
  // (v0.4 compared raw ms against 15 — new_skimmer could never fire on real
  // tracker data and fired always on empty data.)
  const timeRaw = Math.max(0, ...events.filter((e) => e.type === "time_on_page").map((e) => e.value ?? 0));
  const timeSec = timeRaw > 1000 ? timeRaw / 1000 : timeRaw;
  const hasPricing = inv.sections.some((s) => s.type === "pricing");
  if (hasPricing && maxScroll >= 60 && ctaClicks === 0) return "price_hesitant";
  if (maxScroll >= 70 && ctaClicks === 0) return "engaged_no_click";
  if (maxScroll <= 25 && timeSec <= 15) return "new_skimmer";
  return "default";
}

/**
 * Apply the pattern set for a segment (default: the v2 set). Returns what
 * changed and a single `revert()` that undoes all of it. Never throws.
 */
export function applyAdaptations(inv: ContentInventory, segment: Segment = "default"): AdaptationResult {
  const ctx: ApplyCtx = { reverts: [] };
  const applied: AppliedChange[] = [];
  const ids = SEGMENT_PATTERNS[segment] ?? SEGMENT_PATTERNS.default;
  for (const id of ids) {
    const pattern = ALL_PATTERNS[id];
    if (!pattern) continue;
    try {
      const change = pattern(inv, ctx);
      if (change) applied.push(change);
    } catch {
      /* a pattern failure must never affect the host page */
    }
  }
  return {
    applied,
    revert: () => {
      for (const undo of ctx.reverts.reverse()) {
        try {
          undo();
        } catch {
          /* best-effort restore */
        }
      }
      ctx.reverts.length = 0;
    },
  };
}
