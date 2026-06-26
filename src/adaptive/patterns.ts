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

const PATTERNS: Pattern[] = [trustBar, emphasizePrimaryCta];

/**
 * Apply every applicable pattern once. Returns what changed and a single
 * `revert()` that undoes all of them (in reverse order). Never throws.
 */
export function applyAdaptations(inv: ContentInventory): AdaptationResult {
  const ctx: ApplyCtx = { reverts: [] };
  const applied: AppliedChange[] = [];
  for (const pattern of PATTERNS) {
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
