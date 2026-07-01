// Snippet robustness runner (server).
//
// Given a Stagehand page already navigated to a real, third-party page, this:
//   1. audits the page and builds a real ContentInventory (same pipeline the
//      live crawler uses) — so targeting uses the page's actual selectors;
//   2. computes a real Decision in Node via the pure engine for a persona;
//   3. loads the REAL production snippet on the page through a guarded test
//      seam (no network, CSP-exempt via CDP eval) and applies that decision;
//   4. measures targeting hit-rate, console errors, DOM impact, and — after
//      reset() — whether every change reversed.
//
// The point is a launch-confidence check: does the snippet apply and cleanly
// reverse safe adaptations across many real DOMs without breaking pages?

import type { Page } from "@browserbasehq/stagehand";

import { decide } from "@/adaptive/decide";
import { mapAuditToInventory } from "@/adaptive/crawler-inventory";
import { runPageAudit } from "../runners/pageAudit.server";
import { personaContext, type PersonaId } from "./personas";
import {
  analyze,
  type AdaptationProbe,
  type DomSignature,
  type RobustnessObservation,
  type RobustnessReport,
} from "./analyze";

// A syntactically-valid but non-resolving endpoint. The snippet auto-runs on
// load and fetches /api/adaptive/decide from here; the request fails (fail-open,
// logs console.warn — which we don't capture) so it never applies anything. Our
// controlled decision is applied explicitly via the seam instead.
const DEAD_ENDPOINT = "https://angel-harness.invalid";

const SIGNATURE_FN = `() => ({
  textLen: document.body ? document.body.textContent.length : 0,
  elementCount: document.getElementsByTagName('*').length,
  bodyChildCount: document.body ? document.body.children.length : 0,
})`;

export interface RobustnessRunOptions {
  url: string;
  /** Slug used for the synthetic decision (not persisted). */
  site: string;
  persona: PersonaId;
  /** The production snippet source (public/adaptive.js), fetched by the caller. */
  snippetSource: string;
}

async function signature(page: Page): Promise<DomSignature> {
  return (await page.evaluate(SIGNATURE_FN)) as DomSignature;
}

export async function runSnippetRobustness(
  page: Page,
  opts: RobustnessRunOptions,
): Promise<RobustnessReport> {
  const started = Date.now();
  const { url, site, persona, snippetSource } = opts;

  // Capture console errors + uncaught page errors, but only during the apply
  // window (the page's own pre-existing noise doesn't count against us).
  const consoleErrors: string[] = [];
  let collecting = false;
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (collecting && msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  };
  const onPageError = (err: unknown) => {
    if (collecting) consoleErrors.push(String(err).slice(0, 300));
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    // 1. Audit → inventory (real selectors from the live DOM).
    const audit = await runPageAudit(page);
    const inventory = mapAuditToInventory(audit, site);

    // 2. Real decision for this persona (pure engine, no persistence).
    const context = personaContext(persona, url);
    const decision = decide(site, context, inventory);
    const adaptations = decision.adaptations;

    // 3. Load the real snippet through the guarded harness seam.
    collecting = true;
    await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ src, endpoint }: any) => {
        (window as unknown as { __ANGEL_HARNESS__?: boolean }).__ANGEL_HARNESS__ = true;
        const m = document.createElement("script");
        m.type = "text/plain"; // present for findScript(), never executed
        m.setAttribute("data-site", "harness");
        m.setAttribute("data-endpoint", endpoint);
        m.setAttribute("src", "data:text/plain,adaptive.js");
        document.head.appendChild(m);
        // CDP eval context is CSP-exempt; runs the real IIFE which defines __angel.
        // eslint-disable-next-line no-eval
        (0, eval)(src);
      },
      { src: snippetSource, endpoint: DEAD_ENDPOINT },
    );

    const snippetRan = Boolean(
      await page.evaluate(
        `(typeof window.__angel === 'object' && !!window.__angel && typeof window.__angel.apply === 'function')`,
      ),
    );

    let probes: AdaptationProbe[] = [];
    let appliedCount = 0;
    let baseline: DomSignature = { textLen: 0, elementCount: 0, bodyChildCount: 0 };
    let afterApply: DomSignature = baseline;
    let afterReset: DomSignature = baseline;
    let residueAfterReset = -1;

    if (snippetRan) {
      baseline = await signature(page);

      // Per-adaptation target resolution (which locator matched, how many nodes).
      const probeRaw = (await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ads: any) =>
          (ads as any[]).map((a) => {
            const r = (window as any).__angel.probe(a);
            return { pattern: a.pattern, op: a.op, via: r.via, count: r.count };
          }),
        adaptations,
      )) as AdaptationProbe[];
      probes = probeRaw;

      // Apply the real decision, then measure.
      const applied = (await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (d: any) => (window as any).__angel.apply(d),
        decision,
      )) as string[];
      appliedCount = Array.isArray(applied) ? applied.length : 0;
      afterApply = await signature(page);

      // Reverse everything, then confirm no residue remains.
      await page.evaluate(`window.__angel.reset()`);
      afterReset = await signature(page);
      residueAfterReset = Number(await page.evaluate(`window.__angel.residue()`));
    }

    collecting = false;

    const observation: RobustnessObservation = {
      url,
      site,
      persona,
      reachable: true,
      snippetRan,
      consoleErrors,
      decidedCount: adaptations.length,
      appliedCount,
      probes,
      baseline,
      afterApply,
      afterReset,
      residueAfterReset,
      durationMs: Date.now() - started,
    };
    return analyze(observation);
  } catch (err) {
    collecting = false;
    // Navigation/audit blew up — report as unreachable rather than throwing, so
    // a batch sweep records the failure and moves on.
    return analyze({
      url,
      site,
      persona,
      reachable: false,
      snippetRan: false,
      consoleErrors: [String(err).slice(0, 300)],
      decidedCount: 0,
      appliedCount: 0,
      probes: [],
      baseline: { textLen: 0, elementCount: 0, bodyChildCount: 0 },
      afterApply: { textLen: 0, elementCount: 0, bodyChildCount: 0 },
      afterReset: { textLen: 0, elementCount: 0, bodyChildCount: 0 },
      residueAfterReset: -1,
      durationMs: Date.now() - started,
    });
  } finally {
    page.off?.("console", onConsole);
    page.off?.("pageerror", onPageError);
  }
}
