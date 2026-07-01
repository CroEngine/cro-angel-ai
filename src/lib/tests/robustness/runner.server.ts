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
  type RobustnessObservation,
  type RobustnessReport,
} from "./analyze";

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
    residueAfterReset: -1,
    durationMs: 0,
  });
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
        measurePersona(page, { url, site, persona, inventory, baseline, started, errBefore, consoleErrors }),
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

  const applied = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d: any) => (window as any).__angel.apply(d),
    decision,
  )) as string[];
  const afterApply = await signature(page);

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
    residueAfterReset,
    durationMs: Date.now() - started,
  };
  return analyze(observation);
}
