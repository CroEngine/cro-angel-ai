#!/usr/bin/env bun
// E2 journey E2E — the cross-page profile on REAL sites.
// Per site, one browser context (shared localStorage, like a real visitor):
//   1. Land on /pricing with a Google referer → profile: search touch,
//      seenPricing true.
//   2. Later, land on the HOMEPAGE via a LinkedIn campaign link → profile:
//      lastTouch social/linkedin, firstTouch still search/google, cohorts
//      carry seen:pricing.
//   3. Fabricate a price-checker session (deep scroll, no clicks) and let
//      adapt() DERIVE the segment: price_hesitant must fire on the homepage —
//      the E2 unlock (night-1 finding: 0/97 homepages could fire it).
//   4. Revert + byte-clean attribute check.
//
//   bun build scripts/journey-e2e.ts --target=node --format=esm \
//     --outfile=journey.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
//     node journey.node.mjs

import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";

const BUNDLE = readFileSync("artifacts/lab/adaptive-lab.js", "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const JOURNEYS: Array<{ name: string; pricing: string; home: string }> = [
  { name: "monday", pricing: "https://monday.com/pricing", home: "https://monday.com/" },
  { name: "asana", pricing: "https://asana.com/pricing", home: "https://asana.com/" },
  { name: "posthog", pricing: "https://posthog.com/pricing", home: "https://posthog.com/" },
  { name: "ahrefs", pricing: "https://ahrefs.com/pricing", home: "https://ahrefs.com/" },
];

const PRICE_CHECKER_EVENTS = [
  { type: "pageview", ts: 0 },
  { type: "scroll_depth", ts: 0, value: 72 },
  { type: "time_on_page", ts: 0, value: 60_000 },
];

async function inject(page: Page) {
  await page.evaluate(BUNDLE);
  await page.waitForFunction(() => (window as any).__angelAdaptive?.inventory != null, undefined, {
    timeout: 30_000,
  });
}

async function main() {
  const session = await createSession();
  console.log(`journey session ${session.id}`);
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  let failures = 0;
  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});

    for (const j of JOURNEYS) {
      process.stdout.write(`  ${j.name.padEnd(9)} `);
      try {
        // Fresh visitor per site: clear our first-party keys on the origin.
        await page.goto(j.home, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page
          .evaluate(() => {
            localStorage.removeItem("__angel_profile");
            localStorage.removeItem("__angel_vk");
          })
          .catch(() => {});

        // Step 1: google-referred pricing visit.
        await page.goto(j.pricing, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
          referer: "https://www.google.com/",
        });
        await sleep(1800);
        await inject(page);
        const step1 = await page.evaluate(() => {
          const a = (window as any).__angelAdaptive;
          return { profile: a.profile, cohorts: a.cohorts };
        });

        // Step 2: homepage via a LinkedIn campaign link.
        await page.goto(j.home + "?utm_source=linkedin&utm_medium=social", {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        await sleep(1800);
        await inject(page);
        const step2 = await page.evaluate((events) => {
          const a = (window as any).__angelAdaptive;
          a.events.push(...events);
          const applied = a.adapt(); // segment DERIVED — the assertion target
          const out = {
            segment: a.segment,
            cohorts: a.cohorts,
            profile: a.profile,
            applied: applied.map((x: { patternId: string }) => x.patternId),
            homepageHasPricingSection: a.inventory.sections.some(
              (s: { type: string }) => s.type === "pricing",
            ),
          };
          a.revert();
          return {
            ...out,
            restoredClean:
              document.querySelectorAll(
                "[data-angel-adaptation],[data-angel-reorder],[data-angel-emphasis]",
              ).length === 0,
          };
        }, PRICE_CHECKER_EVENTS);

        const p1 = step1.profile;
        const p2 = step2.profile;
        const checks: Array<[string, boolean]> = [
          ["pricing-visit recorded", !!p1?.seenPricing],
          ["search touch on step1", p1?.lastTouch?.channel === "search"],
          ["profile survived navigation", !!p2],
          ["seenPricing sticky on homepage", !!p2?.seenPricing],
          ["lastTouch social/linkedin", p2?.lastTouch?.source === "linkedin"],
          ["firstTouch still search/google", p2?.firstTouch?.source === "google"],
          ["cohort seen:pricing", (step2.cohorts as string[]).includes("seen:pricing")],
          ["cohort src:linkedin", (step2.cohorts as string[]).includes("src:linkedin")],
          ["price_hesitant derived on homepage", step2.segment === "price_hesitant"],
          ["restored clean", step2.restoredClean === true],
        ];
        const failed = checks.filter(([, ok]) => !ok);
        if (failed.length) {
          failures++;
          console.log(
            `FAIL [${failed.map(([n]) => n).join("; ")}] segment=${step2.segment} ` +
              `homePricingSection=${step2.homepageHasPricingSection} cohorts=${JSON.stringify(step2.cohorts)}`,
          );
        } else {
          console.log(
            `PASS · price_hesitant on homepage (own pricing section: ${step2.homepageHasPricingSection}) · ` +
              `cohorts=${JSON.stringify(step2.cohorts)} · applied=${step2.applied.join("+") || "none"}`,
          );
        }
      } catch (err) {
        failures++;
        console.log(`ERROR ${err instanceof Error ? err.message.split("\n")[0].slice(0, 100) : err}`);
      }
    }
  } finally {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    await closeSession(session.id).catch(() => {});
  }
  if (failures) {
    console.error(`\n${failures} journey(s) failed`);
    process.exit(1);
  }
  console.log("\nall journeys pass");
}

main().catch((e) => {
  console.error("journey e2e failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
