// Angel Adaptive — the snippet (`adaptive.js`), entry point.
//
//   <script src="https://app.angeladaptive.com/adaptive.js"
//           data-site-id="xxxx"></script>
//
// Phases (mirror sites.phase: learn -> intelligence -> adaptive):
//   * "learn" (DEFAULT): collect only. Build the Content Inventory AND track
//     behavior (scroll, CTA clicks, time). Changes NOTHING on the page. This is
//     the safe default — "first we collect data, then we optimise".
//   * "adaptive" (opt-in via data-mode="adaptive"): also apply the safe patterns.
//
// The inventory + events are exposed on window.__angelAdaptive and, once a
// `data-endpoint` is configured, POSTed best-effort to the collector — together
// they are the per-site "CRO-bank" the decision engine will read.

import { collectInventory, type ContentInventory } from "./inventory";
import { applyAdaptations, type AppliedChange, type AdaptationResult } from "./patterns";
import { trackBehavior, type BehaviorEvent, type BehaviorTracker } from "./behavior";

const VERSION = "0.3.0";

type AngelGlobal = {
  version: string;
  siteId: string | null;
  mode: "learn" | "adaptive";
  inventory: ContentInventory | null;
  events: BehaviorEvent[];
  applied: AppliedChange[];
  collect: () => ContentInventory;
  adapt: () => AppliedChange[];
  revert: () => void;
};

function currentScript(): HTMLScriptElement | null {
  if (document.currentScript instanceof HTMLScriptElement) return document.currentScript;
  // Fallback when the bundle runs async/deferred: last script that pulled adaptive(.js).
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[data-site-id]"));
  return scripts.length ? scripts[scripts.length - 1] : null;
}

function summarize(inv: ContentInventory): string {
  const present = Object.keys(inv.available).filter((k) => inv.available[k]);
  return (
    `[Angel Adaptive] inventory ready — ${inv.trust.total} trust signals, ` +
    `${inv.ctas.length} CTAs, ${inv.sections.length} sections. ` +
    `Available content: ${present.join(", ") || "none detected"}.`
  );
}

let angel: AngelGlobal | null = null;
let siteId: string | null = null;
let endpoint: string | null = null;
let mode: "learn" | "adaptive" = "learn";
let activeAdaptation: AdaptationResult | null = null;
let tracker: BehaviorTracker | null = null;

// Apply the safe patterns to the page. Idempotent: reverts any prior run first.
// Exposed as window.__angelAdaptive.adapt() so it works from the console too.
function adapt(): AppliedChange[] {
  if (!angel || !angel.inventory) return [];
  revertAdaptation();
  activeAdaptation = applyAdaptations(angel.inventory);
  angel.applied = activeAdaptation.applied;
  if (activeAdaptation.applied.length) {
    console.info(
      `[Angel Adaptive] applied ${activeAdaptation.applied.length} adaptation(s): ` +
        activeAdaptation.applied.map((a) => a.label).join(", "),
    );
  }
  return angel.applied;
}

// Undo every applied change, restoring the original page.
function revertAdaptation(): void {
  if (activeAdaptation) {
    activeAdaptation.revert();
    activeAdaptation = null;
  }
  if (angel) angel.applied = [];
}

function init(): void {
  const script = currentScript();
  siteId = script?.getAttribute("data-site-id") ?? null;
  endpoint = script?.getAttribute("data-endpoint") ?? null;
  // Learn by default — collect data, change nothing. Adaptation only runs when
  // explicitly opted in with data-mode="adaptive" (or the exposed adapt() call).
  mode = script?.getAttribute("data-mode") === "adaptive" ? "adaptive" : "learn";
  angel = {
    version: VERSION,
    siteId,
    mode,
    inventory: null,
    events: [],
    applied: [],
    collect: collectInventory,
    adapt,
    revert: revertAdaptation,
  };
  (window as unknown as { __angelAdaptive: AngelGlobal }).__angelAdaptive = angel;
}

function crawl(): void {
  if (!angel) return;
  let inventory: ContentInventory;
  try {
    inventory = collectInventory();
  } catch (err) {
    // Read-only: a failure here can never harm the host page. Log and bail.
    console.error("[Angel Adaptive] inventory extraction failed:", err);
    return;
  }
  angel.inventory = inventory;
  console.info(summarize(inventory));

  // Learn-mode (default): start passive behavior tracking once. This is the
  // "collect data" half — scroll depth, CTA clicks, time on page — and it runs
  // in BOTH modes (adaptation needs the same telemetry to learn from). Read-only.
  if (!tracker) {
    try {
      tracker = trackBehavior(inventory);
      angel.events = tracker.events;
    } catch (err) {
      console.error("[Angel Adaptive] behavior tracking failed to start:", err);
    }
  }

  // Apply patterns automatically only when opted in; default stays read-only.
  if (mode === "adaptive") adapt();

  if (endpoint) {
    try {
      void fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, version: VERSION, inventory }),
        keepalive: true,
        credentials: "omit",
      }).catch(() => {
        /* best-effort; never block or throw on the host page */
      });
    } catch {
      /* ignore */
    }
  }
}

// Most modern sites — and every SPA (React/Vue/…) — render their content with
// JavaScript AFTER DOMContentLoaded; at parse time the <body> is an empty shell
// (glutenforum.se is one: `<div id="root">` + a JS bundle). Crawling then would
// see nothing. So wait until the visible text has rendered and stopped growing
// (stable across a couple of polls), capped by a hard timeout so a perpetually
// animating page is still crawled once.
function whenContentReady(cb: () => void): void {
  const STEP = 250;
  const MAX_MS = 6000;
  const NEED = 2;
  const MIN_TEXT = 200;
  let lastLen = -1;
  let stable = 0;
  let elapsed = 0;
  const tick = () => {
    const len = document.body?.innerText?.length ?? 0;
    stable = len > MIN_TEXT && len === lastLen ? stable + 1 : 0;
    lastLen = len;
    elapsed += STEP;
    if ((stable >= NEED && len > MIN_TEXT) || elapsed >= MAX_MS) {
      cb();
      return;
    }
    window.setTimeout(tick, STEP);
  };
  tick();
}

// Re-crawl on SPA route changes (pushState/replaceState/popstate), debounced and
// re-settled, so the inventory tracks the page the visitor is actually on.
function hookSpaNavigation(onChange: () => void): void {
  let timer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => whenContentReady(onChange), 300);
  };
  const h = history as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const key of ["pushState", "replaceState"]) {
    const orig = h[key];
    if (typeof orig !== "function") continue;
    h[key] = function (this: unknown, ...args: unknown[]) {
      const r = orig.apply(this, args);
      schedule();
      return r;
    };
  }
  window.addEventListener("popstate", schedule);
}

init();
whenContentReady(crawl);
hookSpaNavigation(crawl);
