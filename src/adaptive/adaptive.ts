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
import {
  applyAdaptations,
  applyPlannedReorder,
  deriveSegment,
  SEGMENT_PATTERNS,
  type AppliedChange,
  type AdaptationResult,
  type PlannedReorder,
  type PlannedResult,
  type Segment,
} from "./patterns";
import { trackBehavior, type BehaviorEvent, type BehaviorTracker } from "./behavior";
import { deriveViewMetrics } from "./metrics";
import { updateProfile, deriveCohorts, type AngelProfile } from "./profile";
import { serveRules, validateRules, type AngelRule, type RuleOutcome } from "./rules";
import { visitorKey, sessionId, sendInventory, installEventCollector } from "./collector";

const VERSION = "0.12.0";

type AngelGlobal = {
  version: string;
  siteId: string | null;
  mode: "learn" | "adaptive";
  inventory: ContentInventory | null;
  events: BehaviorEvent[];
  applied: AppliedChange[];
  segment: Segment | null;
  segments: string[];
  // E2: the visitor's cross-page journey memory + the cohort keys derived
  // from it (the vocabulary cohort-scoped rules match on).
  profile: AngelProfile | null;
  cohorts: string[];
  collect: () => ContentInventory;
  adapt: (segment?: Segment) => AppliedChange[];
  // E3: apply a Claude-designed reorder plan (validation/serving harnesses
  // call this explicitly; it never runs automatically). Same self-checks and
  // rollback as the automatic ladder; revert() undoes it too.
  planReorder: (plan: PlannedReorder) => PlannedResult;
  // E4: serve owner-approved rules to this visitor (cohort-matched, holdout-
  // assigned, per-view self-checked). Explicit call or data-rules-src only.
  serve: (rules?: unknown) => RuleOutcome[];
  // v0.12: what this pageview looks like in the metric catalog's terms —
  // the client-decidable half of the success contract (QA/console aid; the
  // collector derives the same from the shipped events).
  metrics: () => Record<string, boolean>;
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
let collectorInstalled = false;

// Apply the safe patterns for a segment. Idempotent: reverts any prior run
// first. Segment resolution order: explicit argument (console/harness) →
// data-angel-segment attribute (demo/QA override) → derived from this
// session's real behavior events → "default".
// Exposed as window.__angelAdaptive.adapt(segment?) so it works from the console.
function adapt(segmentArg?: Segment): AppliedChange[] {
  if (!angel || !angel.inventory) return [];
  revertAdaptation();
  const attr = currentScript()?.getAttribute("data-angel-segment") as Segment | null;
  const segment: Segment =
    segmentArg ??
    (attr && attr in SEGMENT_PATTERNS ? attr : null) ??
    deriveSegment(angel.events, angel.inventory, angel.profile);
  angel.segment = segment;
  activeAdaptation = applyAdaptations(angel.inventory, segment);
  angel.applied = activeAdaptation.applied;
  if (activeAdaptation.applied.length) {
    console.info(
      `[Angel Adaptive] segment "${segment}" — applied ${activeAdaptation.applied.length} adaptation(s): ` +
        activeAdaptation.applied.map((a) => a.label).join(", "),
    );
  }
  return angel.applied;
}

// E3: planned-reorder reverts, drained together with the pattern reverts.
// Sequencing contract: adapt() begins with a FULL revert, so it also undoes
// any applied plan — plans and segment patterns do not compose yet. The E4
// serving layer must apply the plan AFTER adapt() (or teach adapt() to
// re-apply stored plans) before the two run together in production.
const planReverts: Array<() => void> = [];

function planReorder(plan: PlannedReorder): PlannedResult {
  if (!angel || !angel.inventory) return { ok: false, reason: "no-inventory" };
  const res = applyPlannedReorder(angel.inventory, plan);
  if (res.ok && res.revert) {
    planReverts.push(res.revert);
    console.info(`[Angel Adaptive] planned reorder applied — ${res.detail ?? ""}`);
  }
  // The revert handle stays internal; callers revert via __angelAdaptive.revert().
  return { ok: res.ok, reason: res.reason, detail: res.detail };
}

// E4: serve approved rules. Rules come from the explicit argument (harness/
// console) or the source configured via data-rules-src. Serving reuses the
// standard appliers, so every application self-checks per view; reverts
// drain through revert() like everything else.
let fetchedRules: AngelRule[] | null = null;

function serve(rulesArg?: unknown): RuleOutcome[] {
  if (!angel || !angel.inventory) return [];
  const rules = rulesArg !== undefined ? validateRules(rulesArg) : (fetchedRules ?? []);
  if (!rules.length) return [];
  const segment =
    angel.segment ?? deriveSegment(angel.events, angel.inventory, angel.profile);
  const res = serveRules(rules, {
    inv: angel.inventory,
    cohorts: angel.cohorts,
    segment,
    visitorKey: visitorKey(),
  });
  for (const undo of res.reverts) planReverts.push(undo);
  for (const ev of res.events) {
    angel.events.push({ type: ev.type, ts: ev.ts, meta: { ruleId: ev.ruleId, detail: ev.detail } } as unknown as BehaviorEvent);
  }
  const servedCount = res.outcomes.filter((o) => o.outcome === "served").length;
  if (servedCount) {
    console.info(`[Angel Adaptive] served ${servedCount} rule(s) to cohorts [${angel.cohorts.join(", ")}]`);
  }
  return res.outcomes;
}

// Best-effort rules fetch (size-capped, validated); serving after fetch only
// happens in adaptive mode — learn mode stays inert even with a source set.
function fetchRules(src: string): void {
  try {
    void fetch(src, { credentials: "omit" })
      .then((r) => (r.ok ? r.text() : null))
      .then((text) => {
        if (!text || text.length > 200_000) return;
        try {
          fetchedRules = validateRules(JSON.parse(text));
        } catch {
          fetchedRules = null;
        }
        if (fetchedRules && fetchedRules.length && mode === "adaptive" && angel?.inventory) {
          serve();
        }
      })
      .catch(() => {
        /* best-effort */
      });
  } catch {
    /* ignore */
  }
}

// Undo every applied change, restoring the original page.
function revertAdaptation(): void {
  if (activeAdaptation) {
    activeAdaptation.revert();
    activeAdaptation = null;
  }
  for (const undo of planReverts.reverse()) {
    try {
      undo();
    } catch {
      /* best-effort restore */
    }
  }
  planReverts.length = 0;
  if (angel) angel.applied = [];
}

function init(): void {
  const script = currentScript();
  siteId = script?.getAttribute("data-site-id") ?? null;
  endpoint = script?.getAttribute("data-endpoint") ?? null;
  // Learn by default — collect data, change nothing. Adaptation only runs when
  // explicitly opted in with data-mode="adaptive" (or the exposed adapt() call).
  mode = script?.getAttribute("data-mode") === "adaptive" ? "adaptive" : "learn";
  const rulesSrc = script?.getAttribute("data-rules-src");
  if (rulesSrc) fetchRules(rulesSrc);
  angel = {
    version: VERSION,
    siteId,
    mode,
    inventory: null,
    events: [],
    applied: [],
    segment: null,
    segments: Object.keys(SEGMENT_PATTERNS),
    profile: null,
    cohorts: [],
    collect: collectInventory,
    adapt,
    planReorder,
    serve,
    metrics: () => deriveViewMetrics(angel?.events ?? [], angel?.profile),
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

  // E2: record this pageview in the first-party journey profile. Best-effort
  // and storage-only — a failure can never affect the host page.
  try {
    angel.profile = updateProfile(inventory);
    angel.cohorts = deriveCohorts(angel.profile);
  } catch {
    /* profile is optional */
  }

  // Learn-mode (default): start passive behavior tracking once. This is the
  // "collect data" half — scroll depth, CTA clicks, form submits, time on
  // page, plus the owner-declared goal (data-goal-click / data-goal-url) —
  // and it runs in BOTH modes (adaptation needs the same telemetry to learn
  // from). Read-only.
  if (!tracker) {
    try {
      const script = currentScript();
      tracker = trackBehavior(inventory, undefined, {
        clickSelector: script?.getAttribute("data-goal-click"),
        urlPattern: script?.getAttribute("data-goal-url"),
      });
      angel.events = tracker.events;
    } catch (err) {
      console.error("[Angel Adaptive] behavior tracking failed to start:", err);
    }
  }

  // Apply patterns automatically only when opted in; default stays read-only.
  if (mode === "adaptive") adapt();

  // Ship to the collector when a data-endpoint is configured. The inventory goes
  // every crawl (cheap upsert server-side; tracks SPA route changes); the events
  // collector is installed once and flushes the buffer on page-hide.
  if (endpoint && siteId) {
    const id = {
      endpoint,
      siteId,
      version: VERSION,
      visitorKey: visitorKey(),
      sessionId: sessionId(),
    };
    try {
      sendInventory(id, inventory);
      if (!collectorInstalled && angel) {
        const a = angel;
        installEventCollector(id, () => a.events);
        collectorInstalled = true;
      }
    } catch (err) {
      console.error("[Angel Adaptive] collector failed:", err);
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
