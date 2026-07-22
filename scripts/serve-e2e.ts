#!/usr/bin/env bun
// E4 serve E2E — approval-gated, cohort-matched rule serving on a REAL site.
// One sentry pageload arriving via a LinkedIn campaign link, then serve() a
// rule list exercising the whole gate matrix:
//   R1 approved + cohort src:linkedin + ramp 100  → must SERVE (or refuse
//      with a named self-check reason — refusal is the safety net, but on
//      sentry this exact plan is validated)
//   R2 approved + cohort src:facebook             → not_matched
//   R3 approved + src:linkedin + ramp 0           → holdout (+ event)
//   R4 proposed + src:linkedin                    → not_matched (not approved)
// Then revert + attribute-clean check, and rule_* events present in events.
//
//   bun build scripts/serve-e2e.ts --target=node --format=esm \
//     --outfile=serve.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node serve.node.mjs

import { chromium } from "playwright";
import { readFileSync } from "node:fs";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";

const BUNDLE = readFileSync("artifacts/lab/adaptive-lab.js", "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SENTRY_PLAN = {
  action: "reorder",
  container: "#main-content",
  move: "#main-content > div:nth-of-type(5)",
  after: "#main-content > div:nth-of-type(2)",
  mode: "grid",
};

const RULES = [
  {
    id: "sentry-bar-linkedin",
    cohorts: ["src:linkedin"],
    action: { kind: "pattern", patternId: "trust_bar" },
    status: "approved",
    ramp: 100,
    evidence: { rationale: "LinkedIn arrivals respond to peer proof — surface it immediately." },
  },
  {
    id: "sentry-proof-linkedin",
    cohorts: ["src:linkedin"],
    action: { kind: "planned_reorder", plan: SENTRY_PLAN },
    status: "approved",
    ramp: 100,
    evidence: { rationale: "LinkedIn arrivals respond to peer proof — surface it first." },
  },
  {
    id: "wrong-cohort",
    cohorts: ["src:facebook"],
    action: { kind: "planned_reorder", plan: SENTRY_PLAN },
    status: "approved",
    ramp: 100,
  },
  {
    id: "holdout-rule",
    cohorts: ["src:linkedin"],
    action: { kind: "pattern", patternId: "trust_bar" },
    status: "approved",
    ramp: 0,
  },
  {
    id: "not-yet-approved",
    cohorts: ["src:linkedin"],
    action: { kind: "pattern", patternId: "trust_bar" },
    status: "proposed",
  },
];

async function main() {
  const session = await createSession();
  console.log(`serve session ${session.id}`);
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  let failed: string[] = [];
  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});

    await page.goto("https://sentry.io/?utm_source=linkedin&utm_medium=social", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await sleep(2000);
    await page.evaluate(BUNDLE);
    await page.waitForFunction(() => (window as any).__angelAdaptive?.inventory != null, undefined, {
      timeout: 30_000,
    });

    const res = await page.evaluate((rules) => {
      const a = (window as any).__angelAdaptive;
      const outcomes = a.serve(rules);
      const byId: Record<string, { outcome: string; detail?: string }> = {};
      for (const o of outcomes) byId[o.ruleId] = { outcome: o.outcome, detail: o.detail };
      const ruleEvents = a.events
        .filter((e: { type: string }) => e.type.indexOf("rule_") === 0)
        .map((e: { type: string; meta?: { ruleId?: string } }) => e.type + ":" + (e.meta?.ruleId ?? ""));
      const reorderAttr = document.querySelectorAll("[data-angel-reorder]").length;
      a.revert();
      const clean =
        document.querySelectorAll(
          "[data-angel-adaptation],[data-angel-reorder],[data-angel-emphasis]",
        ).length === 0;
      return { byId, ruleEvents, cohorts: a.cohorts, reorderAttr, clean };
    }, RULES);

    console.log("cohorts:", JSON.stringify(res.cohorts));
    console.log("outcomes:", JSON.stringify(res.byId, null, 1));
    console.log("rule events:", res.ruleEvents.join(", ") || "(none)");

    const check = (name: string, ok: boolean) => {
      if (!ok) failed.push(name);
      console.log(`  ${ok ? "PASS" : "FAIL"} ${name}`);
    };
    check("visitor is src:linkedin", res.cohorts.includes("src:linkedin"));
    check("R1 pattern rule served", res.byId["sentry-bar-linkedin"]?.outcome === "served");
    const reorder = res.byId["sentry-proof-linkedin"];
    check(
      "R-reorder served, or refused with a NAMED per-view reason (live-page drift protection)",
      reorder?.outcome === "served" || (reorder?.outcome === "refused" && !!reorder?.detail),
    );
    console.log(`       (reorder outcome this load: ${reorder?.outcome}${reorder?.detail ? " — " + reorder.detail : ""})`);
    check("R2 wrong cohort → not_matched", res.byId["wrong-cohort"]?.outcome === "not_matched");
    check("R3 ramp 0 → holdout", res.byId["holdout-rule"]?.outcome === "holdout");
    check("R4 proposed → not_matched", res.byId["not-yet-approved"]?.outcome === "not_matched");
    check(
      "events carry served + holdout",
      res.ruleEvents.includes("rule_served:sentry-bar-linkedin") &&
        res.ruleEvents.includes("rule_holdout:holdout-rule"),
    );
    check("restored clean", res.clean);
  } catch (err) {
    failed.push(`harness: ${err instanceof Error ? err.message.split("\n")[0].slice(0, 120) : err}`);
  } finally {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    await closeSession(session.id).catch(() => {});
  }
  if (failed.length) {
    console.error(`\nFAILED: ${failed.join("; ")}`);
    process.exit(1);
  }
  console.log("\nserve e2e: all checks pass");
}

main().catch((e) => {
  console.error("serve e2e failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
