// Shared CTA-category classification — the B2 counterpart to shared/intent.ts.
//
// History: ctas.ts required 4-of-4 signals for cta_primary (above-fold was
// mandatory — a big below-fold buy button could NEVER be primary there),
// while collect.ts scored 4-of-5 with a fifth not-in-chrome signal. The same
// button was "primary-script 0" and "Primary-conversion CTAs: 1" in the same
// findings card. Both scripts now inline these exact functions via
// `${fn.toString()}`; the unified rule is collect's 5-signal version.
//
// Contract: same as shared/intent.ts — each function may only touch its
// arguments and page globals (window/document), never server state, so
// toString()-inlining into page.evaluate is safe (the isVisible pattern).

/** Non-transparent background OR a visible border — the collect.ts
 *  definition, now canonical (ctas.ts used bg-only). */
export function hasMeaningfulSurfaceShared(backgroundColor: string, border: string): boolean {
  const bg = backgroundColor || "";
  const b = border || "";
  const bgSolid = !!bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
  const hasBorder = /\d+px/.test(b) && !/0px/.test(b.split(" ")[0] || "");
  return bgSolid || hasBorder;
}

/** Ancestor walk: is this element inside nav/header/footer chrome? */
export function inNavOrFooterShared(el: Element): boolean {
  let p: Element | null = el.parentElement;
  while (p && p !== document.body) {
    const tag = p.tagName;
    const role = ((p.getAttribute && p.getAttribute("role")) || "").toLowerCase();
    if (tag === "NAV" || tag === "HEADER" || tag === "FOOTER" || role === "navigation") {
      return true;
    }
    p = p.parentElement;
  }
  return false;
}

/** The unified multi-signal category heuristic (collect's 5-signal rule):
 *  above-fold, short label, sizeable click target, visible surface, and
 *  not-in-chrome — >= 4 of 5 makes a primary, so a prominent below-fold
 *  buy button can be primary in BOTH scripts now. */
export function classifyCategoryShared(
  tagName: string,
  inputType: string,
  role: string,
  hasHref: boolean,
  rectW: number,
  rectH: number,
  rectTop: number,
  textLen: number,
  hasSurface: boolean,
  inChrome: boolean,
  viewportH: number,
  // Customer-logo / image link (B-notion): buttonish anchor with NO visible
  // text of its own whose content is an image — "trusted by" logo strips that
  // otherwise score cta_primary. Social proof, not a CTA → 'link'. Computed
  // by the caller (needs DOM); default false keeps other call sites unchanged.
  isImageOnly: boolean = false,
): "form_submit" | "icon_button" | "cta_primary" | "cta_secondary" | "nav_item" | "link" | "other" {
  const tag = (tagName || "").toUpperCase();
  const type = (inputType || "").toLowerCase();
  if ((tag === "BUTTON" && type === "submit") || (tag === "INPUT" && type === "submit")) {
    return "form_submit";
  }
  const isButtonish =
    tag === "BUTTON" || tag === "INPUT" || (role || "").toLowerCase() === "button" || (tag === "A" && hasHref);
  const area = rectW * rectH;
  const smallSquareish = rectW <= 56 && rectH <= 56;
  const shortLabel = textLen <= 2;
  if (isButtonish && smallSquareish && shortLabel) return "icon_button";
  if (isButtonish && isImageOnly) return "link";

  const aboveFold = rectTop < viewportH;
  if (isButtonish) {
    let score = 0;
    if (aboveFold) score++;
    if (textLen > 0 && textLen <= 32) score++;
    if (area >= 90 * 28) score++; // sizeable click target
    if (hasSurface) score++;
    if (!inChrome) score++;
    if (score >= 4) return "cta_primary";
    if (score >= 2 && hasSurface) return "cta_secondary";
  }
  if (tag === "A" && hasHref) return inChrome ? "nav_item" : "link";
  return "other";
}

/** Element-level "hero" boundary, in viewport heights (B3): the same element
 *  used to be hero at <1.1vh in ctas.ts/visualHierarchy.ts but <1.2/<1.0vh in
 *  collect.ts, so one report disagreed with itself about what sat in the
 *  hero. All three element-level scripts interpolate THIS constant now.
 *  NOTE: sections.ts deliberately uses a different rule (a SECTION whose top
 *  starts below ~0.4vh is not the hero section even if elements near its top
 *  are hero-zone elements) — that is section typing, not element labelling. */
export const HERO_MAX_VIEWPORTS = 1.1;
