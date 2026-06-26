// Angel Adaptive — the snippet (`adaptive.js`), entry point.
//
//   <script src="https://app.angeladaptive.com/adaptive.js"
//           data-site-id="xxxx"></script>
//
// v1 scope: READ-ONLY. The snippet builds the page's Content Inventory in the
// visitor's browser and reports it. It applies NO changes to the page yet —
// visitor context, the decision engine, the pattern library and DOM adaptation
// are later steps. Getting the crawl correct and complete first is the whole
// point of this stage: every later decision relies on an accurate inventory of
// what content already exists.
//
// Safety contract honoured here: never mutates the DOM, never injects content,
// only reads. The inventory is exposed on `window.__angelAdaptive` and, if a
// `data-endpoint` is configured, POSTed best-effort to the collector.

import { INVENTORY_SCRIPT, type ContentInventory } from "./inventory";
import { applyAdaptations, type AppliedChange, type AdaptationResult } from "./patterns";

const VERSION = "0.2.0";

type AngelGlobal = {
  version: string;
  siteId: string | null;
  mode: "inventory" | "adapt";
  inventory: ContentInventory | null;
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

// Build the inventory by running the composed detector script against the live
// DOM. `new Function` (not direct eval) keeps it out of this module's scope —
// the script only touches `document`/`window`.
function collectInventory(): ContentInventory {
  return new Function("return " + INVENTORY_SCRIPT)() as ContentInventory;
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
let mode: "inventory" | "adapt" = "inventory";
let activeAdaptation: AdaptationResult | null = null;

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
  // Read-only by default. Adaptation only runs when explicitly opted in with
  // data-mode="adapt" (or via the exposed adapt() call) — safe by default.
  mode = script?.getAttribute("data-mode") === "adapt" ? "adapt" : "inventory";
  angel = {
    version: VERSION,
    siteId,
    mode,
    inventory: null,
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

  // Apply patterns automatically only when opted in; default stays read-only.
  if (mode === "adapt") adapt();

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
