// Angel Adaptive — the Pattern Library + applier.
//
// This is the step past "investigate": the snippet now CHANGES the page. But it
// changes it the safe way the vision demands:
//   * only PRE-DEFINED patterns run (no free-form AI edits);
//   * every pattern reuses content that ALREADY EXISTS on the page (it moves,
//     clones or restyles real elements — it never invents copy or claims);
//   * every change records how to undo it, so `revert()` restores the page;
//   * a pattern that can't find its target is skipped, never forced;
//   * a throw can never reach the host page (each pattern is try/caught).
//
// A pattern is chosen from the Content Inventory (what content is available).
// The visitor-context decision engine (which visitor sees which pattern) is a
// later layer; for now the applier runs every applicable pattern once.

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

// Emphasise the primary conversion CTA — restyle an EXISTING button, reversibly.
const emphasizePrimaryCta: Pattern = (inv, ctx) => {
  const cta =
    inv.ctas.find((c) => c.category === "cta_primary" && c.intent === "conversion") ??
    inv.ctas.find((c) => c.intent === "conversion");
  const el = q(cta?.selector);
  if (!el || !cta) return null;
  const prev = el.getAttribute("style") ?? "";
  el.style.transform = "scale(1.06)";
  el.style.boxShadow = "0 10px 28px rgba(37,99,235,.45)";
  el.style.outline = "2px solid #2563eb";
  el.style.outlineOffset = "2px";
  el.style.transition = "transform .15s ease";
  ctx.reverts.push(() => el.setAttribute("style", prev));
  return {
    patternId: "emphasize_primary_cta",
    label: "Emphasise primary CTA",
    detail: `"${cta.text}"`,
  };
};

// Surface a trust signal right under the hero — CLONE an existing testimonial /
// rating / social-proof element (never invents one), reversibly (remove clone).
const promoteTrustToHero: Pattern = (inv, ctx) => {
  const sig = inv.trust.testimonials[0] ?? inv.trust.ratings[0] ?? inv.trust.socialProof[0];
  const src = q(sig?.selector);
  if (!src || !sig) return null;
  const heroSel = inv.sections.find((s) => s.type === "hero")?.selector;
  const heroEl = q(heroSel) ?? document.querySelector("section");
  if (!heroEl || !heroEl.parentElement || heroEl.contains(src)) return null;

  const clone = src.cloneNode(true) as HTMLElement;
  const wrap = document.createElement("div");
  wrap.setAttribute("data-angel-adaptation", "promote_trust_to_hero");
  wrap.style.cssText = "max-width:720px;margin:4px auto 8px;padding:12px 32px;text-align:center;";
  wrap.appendChild(clone);
  heroEl.parentElement.insertBefore(wrap, heroEl.nextSibling);
  ctx.reverts.push(() => wrap.remove());
  return {
    patternId: "promote_trust_to_hero",
    label: "Surface trust near hero",
    detail: `${sig.type}: "${(sig.text || "").slice(0, 44)}"`,
  };
};

// Order matters only for visual stacking; both are independent + reversible.
const PATTERNS: Pattern[] = [promoteTrustToHero, emphasizePrimaryCta];

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
