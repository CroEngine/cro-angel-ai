// Snippet robustness runner (server).
//
// Given a Stagehand page already navigated to a real, third-party page, this:
//   1. audits the page and builds a real ContentInventory (same pipeline the
//      live crawler uses) — so targeting uses the page's actual selectors;
//   2. loads the REAL production snippet on the page through a guarded test
//      seam (no network, CSP-exempt via CDP eval);
//   3. for each persona: computes a real Decision, applies it, measures
//      targeting / console errors / DOM impact, then reset()s and checks that
//      every change reversed.
//
// The audit + snippet load happen ONCE; personas are measured in sequence on
// the same page (each reset()s back to baseline). Every phase is wrapped in a
// timeout so a hung page yields a `fail` report instead of a dead stream — the
// batch use-case (sweep thousands, surface only failures) depends on that.

import type { Page } from "@browserbasehq/stagehand";

import { decide } from "@/adaptive/decide";
import { mapAuditToInventory } from "@/adaptive/crawler-inventory";
import type { ContentInventory } from "@/adaptive/types";
import { runPageAudit } from "../runners/pageAudit.server";
import { personaContext, type PersonaId } from "./personas";
import {
  analyze,
  type AdaptationProbe,
  type DomSignature,
  type LayoutDiff,
  type RerenderProbe,
  type RobustnessObservation,
  type RobustnessReport,
} from "./analyze";

/** Screenshot emitted for human review when captureShots is on. */
export interface Shot {
  persona: string;
  phase: "before" | "after";
  jpegBase64: string;
}

// Syntactically valid, non-resolving endpoint for the snippet's auto-run fetch —
// it fails (fail-open, console.warn only) so it never applies anything; our
// controlled decision is applied explicitly via the seam instead.
const DEAD_ENDPOINT = "https://angel-harness.invalid";

const DEFAULT_PREPARE_TIMEOUT_MS = 40_000;
const DEFAULT_PERSONA_TIMEOUT_MS = 15_000;

export interface RobustnessRunOptions {
  url: string;
  /** Slug used for the synthetic decision (not persisted). */
  site: string;
  personas: PersonaId[];
  /** The production snippet source (public/adaptive.js), fetched by the caller. */
  snippetSource: string;
  prepareTimeoutMs?: number;
  personaTimeoutMs?: number;
  /** Capture before/after screenshots for human review (heavier). */
  captureShots?: boolean;
  onShot?: (shot: Shot) => void;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${label} exceeded ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function signature(page: Page): Promise<DomSignature> {
  // Function form (not a string) so Playwright CALLS it and returns the object.
  return (await page.evaluate(() => ({
    textLen: document.body ? document.body.textContent.length : 0,
    elementCount: document.getElementsByTagName("*").length,
    bodyChildCount: document.body ? document.body.children.length : 0,
  }))) as DomSignature;
}

const EMPTY_SIG: DomSignature = { textLen: 0, elementCount: 0, bodyChildCount: 0 };
const EMPTY_LAYOUT: LayoutDiff = {
  matched: 0,
  shiftedCount: 0,
  shiftedFraction: 0,
  controlShiftedFraction: 0,
  maxMove: 0,
};

const EMPTY_RERENDER: RerenderProbe = { residueAfterApply: 0, residueAfterRerender: 0 };

/** How long to watch the page's own motion before applying, to net it out. */
const CONTROL_MS = 500;

type Rect = { k: number; x: number; y: number; w: number; h: number };
type RectSet = { vw: number; vh: number; rects: Rect[] };
type Movement = { matched: number; shiftedCount: number; shiftedFraction: number; maxMove: number };

/** Read current rects for the elements stamped by the `before` pass. */
async function readRects(page: Page): Promise<RectSet> {
  return (await page.evaluate(() => {
    const els = document.querySelectorAll("[data-angel-vk]");
    const rects: { k: number; x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const k = Number(el.getAttribute("data-angel-vk"));
      const r = el.getBoundingClientRect();
      rects.push({ k, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return { vw: window.innerWidth || 1, vh: window.innerHeight || 1, rects };
  })) as RectSet;
}

/** Measure how far the stamped elements moved relative to a recorded rect set. */
async function measureAgainst(page: Page, baseRects: RectSet): Promise<Movement> {
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b: any) => {
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const vpArea = Math.max(1, vw * vh);
      let shiftedCount = 0;
      let shiftedArea = 0;
      let maxMove = 0;
      let matched = 0;
      for (const rec of b.rects as { k: number; x: number; y: number; w: number; h: number }[]) {
        const el = document.querySelector('[data-angel-vk="' + rec.k + '"]');
        if (!el) continue;
        matched++;
        const r = el.getBoundingClientRect();
        const move = Math.max(Math.abs(r.left - rec.x), Math.abs(r.top - rec.y));
        if (move > maxMove) maxMove = move;
        if (move > 4) {
          shiftedCount++;
          shiftedArea += Math.min(vpArea, rec.w * rec.h);
        }
      }
      return {
        matched,
        shiftedCount,
        shiftedFraction: Math.min(1, shiftedArea / vpArea),
        maxMove: Math.round(maxMove),
      };
    },
    baseRects,
  )) as Movement;
}

function failReport(
  url: string,
  site: string,
  persona: string,
  reason: string,
  opts: { reachable?: boolean; snippetRan?: boolean } = {},
): RobustnessReport {
  return analyze({
    url,
    site,
    persona,
    reachable: opts.reachable ?? false,
    snippetRan: opts.snippetRan ?? false,
    consoleErrors: [reason],
    decidedCount: 0,
    appliedCount: 0,
    probes: [],
    baseline: EMPTY_SIG,
    afterApply: EMPTY_SIG,
    afterReset: EMPTY_SIG,
    layout: EMPTY_LAYOUT,
    rerender: EMPTY_RERENDER,
    residueAfterReset: -1,
    durationMs: 0,
  });
}

/** Provoke the kinds of things that make a framework re-render, without
 *  navigating away: scroll the page, fire resize/scroll/visibility, settle. */
async function provokeRerender(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      window.scrollTo(0, (document.body && document.body.scrollHeight) || 3000);
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("scroll"));
      document.dispatchEvent(new Event("visibilitychange"));
    } catch {
      /* non-fatal */
    }
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    try {
      window.scrollTo(0, 0);
      window.dispatchEvent(new Event("resize"));
    } catch {
      /* non-fatal */
    }
  });
  await new Promise((r) => setTimeout(r, 400));
}

export async function runSnippetRobustness(
  page: Page,
  opts: RobustnessRunOptions,
): Promise<RobustnessReport[]> {
  const { url, site, personas, snippetSource } = opts;
  const prepareTimeout = opts.prepareTimeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS;
  const personaTimeout = opts.personaTimeoutMs ?? DEFAULT_PERSONA_TIMEOUT_MS;

  // Capture console errors during the apply window only. Stagehand's page proxy
  // supports a subset of events; attach defensively so an unsupported one
  // doesn't abort the run.
  const consoleErrors: string[] = [];
  let collecting = false;
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (collecting && msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  };
  const safeOn = (event: string, fn: (arg: never) => void) => {
    try {
      (page as unknown as { on: (e: string, f: (a: never) => void) => void }).on(event, fn);
    } catch {
      /* unsupported event — skip */
    }
  };
  safeOn("console", onConsole as (a: never) => void);

  let inventory: ContentInventory | null = null;
  let snippetRan = false;
  let baseline: DomSignature = EMPTY_SIG;

  // --- prepare: audit + inject snippet (once) ---
  try {
    const audit = await withTimeout(runPageAudit(page), prepareTimeout, "audit");
    inventory = mapAuditToInventory(audit, site);

    collecting = true;
    await withTimeout(
      page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ src, endpoint }: any) => {
          (window as unknown as { __ANGEL_HARNESS__?: boolean }).__ANGEL_HARNESS__ = true;
          const m = document.createElement("script");
          m.type = "text/plain"; // present for findScript(), never executed
          m.setAttribute("data-site", "harness");
          m.setAttribute("data-endpoint", endpoint);
          m.setAttribute("src", "data:text/plain,adaptive.js");
          document.head.appendChild(m);
          // CDP eval is CSP-exempt; runs the real IIFE which defines __angel.
          // eslint-disable-next-line no-eval
          (0, eval)(src);
        },
        { src: snippetSource, endpoint: DEAD_ENDPOINT },
      ),
      personaTimeout,
      "inject",
    );

    snippetRan = Boolean(
      await page.evaluate(
        `(typeof window.__angel === 'object' && !!window.__angel && typeof window.__angel.apply === 'function')`,
      ),
    );
    baseline = await signature(page);
  } catch (err) {
    collecting = false;
    detach(page, onConsole);
    const reason = err instanceof Error ? err.message : String(err);
    // Whole page failed to prepare → one fail report per persona.
    return personas.map((p) => failReport(url, site, p, reason, { reachable: inventory !== null }));
  }

  if (!snippetRan) {
    collecting = false;
    detach(page, onConsole);
    return personas.map((p) =>
      failReport(url, site, p, "snippet did not initialize", { reachable: true }),
    );
  }

  // --- measure each persona in sequence (reset() between them) ---
  const reports: RobustnessReport[] = [];
  for (const persona of personas) {
    const started = Date.now();
    const errBefore = consoleErrors.length;
    try {
      const report = await withTimeout(
        measurePersona(page, {
          url,
          site,
          persona,
          inventory,
          baseline,
          started,
          errBefore,
          consoleErrors,
          captureShots: opts.captureShots ?? false,
          onShot: opts.onShot,
        }),
        personaTimeout,
        `persona ${persona}`,
      );
      reports.push(report);
    } catch (err) {
      // Try to leave the page clean for the next persona.
      try {
        await page.evaluate(`window.__angel && window.__angel.reset()`);
      } catch {
        /* ignore */
      }
      const reason = err instanceof Error ? err.message : String(err);
      reports.push(failReport(url, site, persona, reason, { reachable: true, snippetRan: true }));
    }
  }

  collecting = false;
  detach(page, onConsole);
  return reports;
}

function detach(page: Page, onConsole: (arg: never) => void) {
  try {
    (page as unknown as { off?: (e: string, f: (a: never) => void) => void }).off?.(
      "console",
      onConsole as (a: never) => void,
    );
  } catch {
    /* ignore */
  }
}

async function shoot(page: Page): Promise<string> {
  const buf = (await page.screenshot({ type: "jpeg", quality: 55 })) as Buffer;
  return buf.toString("base64");
}

async function measurePersona(
  page: Page,
  args: {
    url: string;
    site: string;
    persona: PersonaId;
    inventory: ContentInventory;
    baseline: DomSignature;
    started: number;
    errBefore: number;
    consoleErrors: string[];
    captureShots: boolean;
    onShot?: (shot: Shot) => void;
  },
): Promise<RobustnessReport> {
  const { url, site, persona, inventory, baseline, started, errBefore, consoleErrors } = args;
  const context = personaContext(persona, url);
  const decision = decide(site, context, inventory);
  const adaptations = decision.adaptations;

  const probes = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ads: any) =>
      (ads as any[]).map((a) => {
        const r = (window as any).__angel.probe(a);
        return { pattern: a.pattern, op: a.op, via: r.via, count: r.count };
      }),
    adaptations,
  )) as AdaptationProbe[];

  // Stamp visible in-viewport elements and record their rects (R0). We then
  // watch the page's OWN motion over a control window (carousels, autoplay,
  // gradient animations) and net it out, so the reported shift reflects Angel's
  // change — not the page animating itself.
  const r0 = (await page.evaluate(() => {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const all = document.body ? document.body.getElementsByTagName("*") : [];
    const rects: { k: number; x: number; y: number; w: number; h: number }[] = [];
    let k = 0;
    for (let i = 0; i < all.length && k < 1500; i++) {
      const el = all[i] as HTMLElement;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      el.setAttribute("data-angel-vk", String(k));
      rects.push({ k, x: r.left, y: r.top, w: r.width, h: r.height });
      k++;
    }
    return { vw, vh, rects };
  })) as RectSet;

  // Ambient motion over the control window (no apply).
  await new Promise((r) => setTimeout(r, CONTROL_MS));
  const control = await measureAgainst(page, r0);

  // Re-baseline to the positions right before apply, so apply-motion excludes
  // the drift that already happened during the control window.
  const r1 = await readRects(page);

  if (args.captureShots && args.onShot) {
    args.onShot({ persona, phase: "before", jpegBase64: await shoot(page) });
  }

  const applied = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d: any) => (window as any).__angel.apply(d),
    decision,
  )) as string[];
  const afterApply = await signature(page);

  const applyMove = await measureAgainst(page, r1);

  // Net out the ambient rate: the honest Angel-attributable shift.
  const netFraction = Math.max(0, applyMove.shiftedFraction - control.shiftedFraction);
  const layout: LayoutDiff = {
    matched: applyMove.matched,
    shiftedCount: applyMove.shiftedCount,
    shiftedFraction: netFraction,
    controlShiftedFraction: control.shiftedFraction,
    maxMove: applyMove.maxMove,
  };

  if (args.captureShots && args.onShot) {
    args.onShot({ persona, phase: "after", jpegBase64: await shoot(page) });
  }

  // Post-re-render stability: does our change survive a framework re-render?
  const residueAfterApply = Number(await page.evaluate(`window.__angel.residue()`));
  await provokeRerender(page);
  const residueAfterRerender = Number(await page.evaluate(`window.__angel.residue()`));
  const rerender: RerenderProbe = { residueAfterApply, residueAfterRerender };

  await page.evaluate(`window.__angel.reset()`);
  const afterReset = await signature(page);
  const residueAfterReset = Number(await page.evaluate(`window.__angel.residue()`));

  const observation: RobustnessObservation = {
    url,
    site,
    persona,
    reachable: true,
    snippetRan: true,
    consoleErrors: consoleErrors.slice(errBefore),
    decidedCount: adaptations.length,
    appliedCount: Array.isArray(applied) ? applied.length : 0,
    probes,
    baseline,
    afterApply,
    afterReset,
    layout,
    rerender,
    residueAfterReset,
    durationMs: Date.now() - started,
  };
  return analyze(observation);
}
