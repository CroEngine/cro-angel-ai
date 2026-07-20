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

// Surface the strongest EXISTING trust signal as a slim bar at the very top.
// Layout-safe: one isolated, self-contained element prepended to <body> — it
// shifts the page down uniformly and is never injected into an internal grid.
const trustBar: Pattern = (inv, ctx) => {
  const sig =
    inv.trust.ratings[0] ??
    inv.trust.socialProof[0] ??
    inv.trust.trustedBy[0] ??
    inv.trust.testimonials[0];
  if (!sig) return null;
  let text = (sig.text || "").replace(/\s+/g, " ").trim();
  if (sig.type === "testimonial") text = `“${text.slice(0, 96)}${text.length > 96 ? "…" : ""}”`;
  if (text.length < 3) return null;

  const bar = document.createElement("div");
  bar.setAttribute("data-angel-adaptation", "trust_bar");
  bar.textContent = text;
  // `all:initial` isolates the bar from the host page's CSS; the rest styles it.
  bar.style.cssText = [
    "all:initial",
    "display:block",
    "box-sizing:border-box",
    "width:100%",
    "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
    "font-size:14px",
    "font-weight:600",
    "color:#0b1f3a",
    "background:#eaf1ff",
    "border-bottom:1px solid #cfe0ff",
    "text-align:center",
    "padding:9px 16px",
    "line-height:1.35",
  ].join(";");
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
  ctx.reverts.push(() => el.setAttribute("style", prev));
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
const riskReducerBar: Pattern = (inv, ctx) => {
  if (document.querySelector('[data-angel-adaptation]')) return null; // one bar max
  const sig = inv.trust.guarantees[0] ?? inv.trust.certifications[0];
  if (!sig) return null;
  const text = (sig.text || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (text.length < 3) return null;
  const bar = document.createElement("div");
  bar.setAttribute("data-angel-adaptation", "risk_reducer_bar");
  bar.textContent = text;
  bar.style.cssText = [
    "all:initial",
    "display:block",
    "box-sizing:border-box",
    "width:100%",
    "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
    "font-size:14px",
    "font-weight:600",
    "color:#0a3d1f",
    "background:#e8f8ee",
    "border-bottom:1px solid #bfe8cd",
    "text-align:center",
    "padding:9px 16px",
    "line-height:1.35",
  ].join(";");
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

const ALL_PATTERNS: Record<string, Pattern> = {
  trust_bar: trustBar,
  emphasize_primary_cta: emphasizePrimaryCta,
  risk_reducer_bar: riskReducerBar,
  pricing_spotlight: pricingSpotlight,
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
  // landing — emphasise it and back it with proof.
  engaged_no_click: ["emphasize_primary_cta", "trust_bar"],
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
