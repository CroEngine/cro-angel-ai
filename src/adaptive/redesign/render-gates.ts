// Fas 3 (slice 3b) — pixel-half beauty gates (pure).
//
// The structural preview (slice 3a) answered "does the new ORDER make sense?"
// without a browser. This is the other half: after the plan is actually applied
// to a rendered DOM and measured, decide "blir det snyggt, eller försämrade vi
// sidan?" — the same question preflight asks of the old pattern engine, phrased
// for the redesign plan.
//
// This module is the PURE verdict over the browser's measurements (the DOM work
// + screenshots live in render.server.ts). It deliberately reuses the exact gate
// thresholds the robustness analyzer already trusts (analyze.ts): a moved block
// must not cross above the page's main content, apply must not introduce
// horizontal scroll, no interactive element may become unclickable, and the whole
// thing must reverse. Keeping the thresholds identical means the redesign path is
// held to the same "never degrade the page" bar as everything else.

/** Raw measurements the browser harness captures around apply. */
export interface RenderMeasurements {
  /** Section labels in DOM order BEFORE apply. */
  beforeOrder: string[];
  /** Section labels in DOM order AFTER apply. */
  afterOrder: string[];
  /** documentElement.scrollWidth − clientWidth BEFORE apply (the page's own). */
  hOverflowBeforePx: number;
  /** …AFTER apply. */
  hOverflowAfterPx: number;
  /** Vertical overlap (px) the reorder INTRODUCED between adjacent sections —
   *  the biggest new amount by which one section's box now sits over its
   *  neighbour's. Sections legitimately overlap by design (rounded cards, negative
   *  margins), so only the INTRODUCED delta counts. Catches the collision class the
   *  horizontal-overflow gate is blind to (a floating hero CTA landing on top of a
   *  block that was moved up under it). Optional: older observations omit it. */
  verticalOverlapIntroducedPx?: number;
  /** Sections that were actually moved (tagged data-angel-moved). */
  movedCount: number;
  /** Moved sections whose top landed ABOVE the page's main anchor (h1/main) —
   *  the "hero demoted / above the fold headline" breakage. */
  movedAboveMain: number;
  /** Was an h1/main anchor found to measure against? */
  mainAnchorFound: boolean;
  /** Conversion CTAs that were hit-testable (clickable) BEFORE apply. */
  ctaChecked: number;
  /** …how many became unclickable (covered/detached/hidden) AFTER apply. */
  ctaBroken: number;
  /** move ops the plan requested. */
  requestedMoves: number;
  /** move ops that were SAFELY applicable (target + predecessor were siblings). */
  appliedMoves: number;
  /** Applied moves whose section did NOT actually rise (per step, < 1px lift) —
   *  DOM order ≠ visual order in that container, so the "move up" left the
   *  section where it was or sent it DOWN. Mirrors the snippet's reorder self-
   *  check (src/adaptive/runtime/applier.ts, ADR-001 step 2), which rolls the
   *  WHOLE variant back fail-closed on such a move. >0 ⇒ the variant can never
   *  serve (like opsTouchingLcp). Optional: absent on older observations. */
  moveNoRise?: number;
  /** Applied moves that tripped the client self-check's OTHER conditions, per
   *  step with the client's exact thresholds: |Δ scrollHeight| > max(48, 3%),
   *  new horizontal overflow (> +2px), or the section collapsing (< 1px).
   *  Any of these rolls the whole variant back on the client — so >0 here is
   *  the same unservable class. Optional: absent on older observations. */
  moveUnsafe?: number;
  /** Requested moves whose target had NO valid previous sibling (after the
   *  divider skip). The client fails the WHOLE variant on this (ok=false); the
   *  harness used to skip silently with only a warn — same unservable class,
   *  now a hard fail. Optional: absent on older observations. */
  moveUnappliable?: number;
  /** After reset(), does the DOM order equal beforeOrder exactly? */
  reversedOrderMatches: boolean;
  /** Did the harness observe an LCP element to check ops against? Optional:
   *  older observations omit it (absent = check not run, no verdict impact). */
  lcpFound?: boolean;
  /** Resolved ops whose target IS / wraps / lives inside the page's LCP
   *  element. The snippet's serve-time CWV guard (touchesLcp) rolls the WHOLE
   *  variant back, fail closed, when any op touches it — so >0 means the
   *  variant can never reach a real visitor (only sandbox mirrors bypass the
   *  guard). Optional as above. */
  opsTouchingLcp?: number;
  /** How far (px) the LCP element's absolute document position moved between
   *  BEFORE and AFTER apply. touchesLcp only sees ops ON the element — an
   *  insert/move ABOVE it shifts it without touching it, and that shift is a
   *  real layout-shift for every visitor. Optional: older observations omit
   *  it (and pages without an observed LCP element report nothing). */
  lcpShiftPx?: number;
  /** insert_snippet ops the plan requested / actually applied (task #117).
   *  All optional — absent on observations from before the op existed. */
  requestedInserts?: number;
  appliedInserts?: number;
  /** Inserted blocks whose position landed ABOVE the hero block. */
  insertedAboveMain?: number;
  /** Largest gap (px) between the hero h1's bottom and an inserted block's top
   *  — thousands means the anchor was a page-wrapping div and "below the hero"
   *  silently became "bottom of the page". */
  insertedGapToHeroPx?: number;
  /** Was every inserted block hit-testable after apply (not covered/hidden)? */
  insertedVisible?: boolean;
  /** Did reset() actually detach every inserted node? The section-identity
   *  order check cannot see a stray inserted node — this can. */
  insertedRemoved?: boolean;
  /** Largest absolute distance (px) any moved section actually travelled.
   *  The order lists only see census sections — a move across a HEADING-LESS
   *  neighbour (breadth finding 1, the Trello autopsy) is a real visual change
   *  the lists are blind to. Optional: older observations omit it. */
  movedShiftPx?: number;
}

export type RenderVerdict = "pass" | "warn" | "fail";

export interface RenderGateResult {
  verdict: RenderVerdict;
  /** Human-readable issues, most severe first. Empty on a clean pass. */
  reasons: string[];
  /** Horizontal overflow (px) apply INTRODUCED (0 when the page already had it). */
  hOverflowIntroducedPx: number;
  /** Vertical section overlap (px) apply INTRODUCED (0 when unmeasured/none). */
  verticalOverlapIntroducedPx: number;
  /** Did the applied order differ from before (i.e. a real reorder happened)? */
  reordered: boolean;
}

/** THE overflow threshold: >8px of NEWLY introduced horizontal scroll fails.
 *  analyze.ts and the dashboard's gate labels import this — one number, three
 *  judges, no drift. */
export const H_OVERFLOW_FAIL_PX = 8;

/** Introduced vertical overlap beyond this is a collision, not a nudge. Heuristic:
 *  a clean reorder shifts adjacent-section overlap by tens of px (rounded cards
 *  legitimately tuck); a section landing under a floating hero CTA introduces
 *  hundreds. Calibrated on plausible.io (clean reorder +48px passes; the collision
 *  case +320px fails). */
export const V_OVERLAP_FAIL_PX = 100;

/** LCP-elementet får inte SKJUTAS av en applicering (task #117): serve-vaktens
 *  touchesLcp ser bara ops på själva elementet, men en insättning/flytt ovanför
 *  det förskjuter largest paint för varje riktig besökare — layout-shift på det
 *  viktigaste elementet. Samma stränghetsklass som overflow-grinden. */
export const LCP_SHIFT_FAIL_PX = 8;

/** "Direkt under hjälten" ska betyda just det: större gap mellan hjälte-h1:ans
 *  botten och det insatta blockets topp än så här betyder att ankaret var en
 *  sid-omslutande wrapper och blocket i praktiken landade långt ner. En mobil
 *  hjälte (390×844-viewporten) är sällan högre än ~1,5 skärmar. */
export const INSERT_GAP_WARN_PX = 1200;

/** En flytt som förflyttade sektionen mindre än så här är i praktiken en
 *  no-op (platsbyte med en divider, eller flyttar som tog ut varandra) — men
 *  har den rest längre än så är förändringen visuellt äkta även när census-
 *  ordningen står still (flytt över rubriklös grannsektion, breddfynd 1). */
export const MOVE_SHIFT_MIN_PX = 40;

/** Evaluate the beauty gates over one apply's measurements. Pure. */
export function evaluateRenderGates(m: RenderMeasurements): RenderGateResult {
  const hOverflowIntroducedPx = Math.max(0, m.hOverflowAfterPx - m.hOverflowBeforePx);
  const reordered = !sameOrder(m.beforeOrder, m.afterOrder);

  const reasons: string[] = [];
  let verdict: RenderVerdict = "pass";
  const fail = (r: string) => {
    reasons.push(r);
    verdict = "fail";
  };
  const warn = (r: string) => {
    reasons.push(r);
    if (verdict !== "fail") verdict = "warn";
  };

  // Hard failures — a customer would see these as damage.
  // Unservable beats everything: the snippet's serve-time CWV guard refuses
  // any op touching the LCP element and rolls the whole variant back for
  // every real visitor — a "verified" variant that can never serve would
  // make the A/B test measure original vs original (task #105).
  const lcpTouches = m.opsTouchingLcp ?? 0;
  if (lcpTouches > 0) {
    fail(
      `${lcpTouches} op(s) target the page's LCP element — the serve-time CWV guard rolls the whole variant back for every real visitor (unservable)`,
    );
  }
  // Same unservable class as the LCP touch above: the snippet's reorder self-
  // check (ADR-001 step 2) rolls the WHOLE variant back for every visitor when a
  // move does not actually lift its section (DOM order ≠ visual order — the
  // section lands before a visually-lower sibling and stays put or drops). A
  // "verified" variant the client always reverts would make the A/B arm measure
  // original vs original — so it must fail here, not pass.
  const moveNoRise = m.moveNoRise ?? 0;
  if (moveNoRise > 0) {
    fail(
      `${moveNoRise} move(s) did not lift their section (DOM order ≠ visual order) — the snippet's reorder self-check rolls the whole variant back for every real visitor (unservable)`,
    );
  }
  // The client self-check's remaining conditions, mirrored per-move with its
  // exact thresholds (docHeight/overflow/collapse) — and the no-valid-prev
  // case, where the client also fails the whole variant. Same unservable
  // class as above: a "verified" variant the client always reverts makes the
  // A/B arm measure original vs original.
  const moveUnsafe = m.moveUnsafe ?? 0;
  if (moveUnsafe > 0) {
    fail(
      `${moveUnsafe} move(s) tripped the client self-check thresholds (document height/overflow/collapse) — the snippet rolls the whole variant back for every real visitor (unservable)`,
    );
  }
  const moveUnappliable = m.moveUnappliable ?? 0;
  if (moveUnappliable > 0) {
    fail(
      `${moveUnappliable} move(s) have no valid previous sibling to land above — the snippet fails the whole variant on this (unservable)`,
    );
  }
  if (m.movedAboveMain > 0) {
    fail(
      `${m.movedAboveMain} moved section(s) placed ABOVE the page's main content — would look broken`,
    );
  }
  if (hOverflowIntroducedPx > H_OVERFLOW_FAIL_PX) {
    fail(`apply introduced ${hOverflowIntroducedPx}px of horizontal overflow`);
  }
  const vOverlap = m.verticalOverlapIntroducedPx ?? 0;
  if (vOverlap > V_OVERLAP_FAIL_PX) {
    fail(
      `apply introduced ${vOverlap}px of vertical overlap between sections (a moved block collides with its neighbour)`,
    );
  }
  if (m.ctaBroken > 0) {
    fail(
      `${m.ctaBroken} conversion CTA(s) became unclickable after apply (covered / hidden / detached)`,
    );
  }
  if (!m.reversedOrderMatches) {
    fail("reset() did not restore the original section order — change is not reversible");
  }
  // Insättnings-grindarna (task #117) — alla fält frivilliga: en äldre
  // observation (eller en plan utan inserts) påverkas inte; bara explicit
  // dåliga värden fäller.
  if ((m.lcpShiftPx ?? 0) > LCP_SHIFT_FAIL_PX) {
    fail(
      `apply shifted the page's LCP element by ${m.lcpShiftPx}px — a layout shift on the largest paint for every visitor`,
    );
  }
  if ((m.insertedAboveMain ?? 0) > 0) {
    fail(
      `${m.insertedAboveMain} inserted block(s) landed ABOVE the hero — inserts only ever go below it`,
    );
  }
  if (m.insertedVisible === false) {
    fail("an inserted block is not hit-testable after apply (covered or hidden) — it helps no one");
  }
  if (m.insertedRemoved === false) {
    fail("reset() left an inserted node in the DOM — change is not reversible");
  }

  // Soft signals — surfaced, not blocking (but note: the auto-generate loop
  // accepts only a clean pass, so these DO hold a variant back there).
  if (m.ctaChecked === 0) {
    // The CTA-breakage gate protected NOTHING this run: no conversion CTA was
    // hit-testable before apply. Either the page truly has none, or extraction/
    // goal config failed to name it — the gate can't tell the difference, so it
    // says so instead of passing vacuously (breadth finding 2).
    warn(
      "0 conversion CTAs were hit-testable before apply — the CTA gate was vacuous (no extracted CTAs and no goal text/selector present on the page)",
    );
  }
  if (m.lcpFound === false) {
    // Explicit false (the harness looked and found nothing) — absent means an
    // older observation where the check didn't exist. Without an LCP element
    // we cannot prove the serve-time guard would let this variant through, so
    // the vacuity must be visible instead of passing silently.
    warn(
      "no LCP element was observed — the LCP servability check was vacuous (cannot prove the serve-time CWV guard would allow this variant)",
    );
  }
  if (m.requestedMoves > 0 && m.appliedMoves < m.requestedMoves) {
    warn(
      `${m.requestedMoves - m.appliedMoves}/${m.requestedMoves} move(s) could not be applied safely (target not a clean sibling)`,
    );
  }
  if (m.movedCount > 0 && !m.mainAnchorFound) {
    warn("section(s) moved but no h1/main anchor to judge against — review screenshots");
  }
  if ((m.requestedInserts ?? 0) > 0 && (m.appliedInserts ?? 0) < (m.requestedInserts ?? 0)) {
    warn(
      `${(m.requestedInserts ?? 0) - (m.appliedInserts ?? 0)}/${m.requestedInserts} insert(s) could not be applied`,
    );
  }
  if ((m.insertedGapToHeroPx ?? 0) > INSERT_GAP_WARN_PX) {
    warn(
      `inserted block landed ${m.insertedGapToHeroPx}px below the hero headline — the anchor was likely a page-wrapping container, review screenshots`,
    );
  }
  if (m.requestedMoves > 0 && m.appliedMoves === 0) {
    warn("no moves were applied — nothing to preview");
  } else if (
    m.appliedMoves > 0 &&
    !reordered &&
    (m.movedShiftPx ?? 0) < MOVE_SHIFT_MIN_PX &&
    verdict === "pass"
  ) {
    // Applied a move but nothing actually travelled: order lists unchanged AND
    // the moved section barely shifted. A big movedShiftPx with unchanged lists
    // is a REAL move across a heading-less neighbour — not warned (breadth
    // finding 1). Older observations without movedShiftPx keep the old, purely
    // order-based semantics via the ?? 0.
    warn("apply reported moves but the section order is unchanged");
  }

  return {
    verdict,
    reasons,
    hOverflowIntroducedPx,
    verticalOverlapIntroducedPx: vOverlap,
    reordered,
  };
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
