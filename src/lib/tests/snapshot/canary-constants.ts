// Single source of truth for the render-canary measurement primitives.
//
// Both the page-eval inside runRenderCanary AND the Vitest harness import from
// here. Drift in the constants must break the tests, not silently weaken
// production gates — so this file owns the values, no literal copies.
//
// Design notes:
// - CANARY_SAMPLE_TEXT is fixed and long enough that any per-glyph metric
//   contribution to width sums into a clearly-distinguishable signal between
//   loaded vs fallback (>> EPSILON_LOAD_PX). Mixed letters + digits cover the
//   common subset surface (basic Latin + ASCII digits).
// - EPSILON_LOAD_PX (Gate 1): well below the loaded-vs-fallback gap for brand
//   fonts on the sample (typically tens of px), well above sub-pixel rounding
//   noise at deviceScaleFactor=1. 2px is a safe middle.
// - EPSILON_FIDELITY_PX (Gate 2): tighter, because here we expect near-zero
//   diff between original and subset. 0.5px tolerates one-pixel rounding,
//   nothing more.
// - CANARY_VIEWPORT.deviceScaleFactor MUST be set at context creation in
//   Playwright — setting it after setViewportSize does not retroactively
//   re-render. The harness is responsible for honoring this.
// - FONT_LOAD_TIMEOUT_MS is overridable per call so negative Vitest cases
//   don't each wait the full default.

export const CANARY_SAMPLE_TEXT =
  "The quick brown fox jumps over the lazy dog 0123456789";

/** Gate 1 threshold (px). delta_load > EPS ⇒ family clearly distinct from fallback. */
export const EPSILON_LOAD_PX = 2;

/** Gate 2 threshold (px). delta_subset < EPS ⇒ subset metrically faithful to original. */
export const EPSILON_FIDELITY_PX = 0.5;

/** Pinned viewport + DPR for the canary. deviceScaleFactor MUST be set at
 *  Playwright context creation, not via setViewportSize after the fact. */
export const CANARY_VIEWPORT = {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
} as const;

/** Per-family load timeout (ms). Vitest negative cases override this via
 *  runRenderCanary({ fontLoadTimeoutMs }) so a 404 cid doesn't burn the full
 *  default while we wait for a hang that never comes. */
export const FONT_LOAD_TIMEOUT_MS = 3000;
