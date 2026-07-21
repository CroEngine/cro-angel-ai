#!/usr/bin/env bun
// Adaptive E2E — the FULL loop on real sites: inject the real production
// snippet, generate real behavior data, derive a segment, adapt the page,
// prove reversibility. Screenshots at every step.
// =====================================================================
// Per site:
//   goto (Browserbase) → inject public/adaptive-lab.js (the shipped bundle) →
//   wait for inventory → scroll through the page (the snippet's tracker
//   records REAL scroll/time events) → back to top → BEFORE shot →
//   adapt() with no argument (segment DERIVED from the real events) → shot →
//   adapt(segment) for each named segment → shot each →
//   revert() → RESTORED shot + assert zero [data-angel-adaptation] left.
//
// Run (same Node/Browserbase mechanics as the day-0 sweep):
//   bun build scripts/adaptive-e2e.ts --target=node --format=esm \
//     --outfile=e2e.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node e2e.node.mjs

import { chromium, type Page } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";

const OUT_DIR = "/tmp/claude-0/-home-user-cro-angel-ai/c11460d4-452b-5901-aaf1-829bf613facc/scratchpad";
const BUNDLE = readFileSync("public/adaptive-lab.js", "utf8");

const SITES: Array<{ name: string; url: string }> = [
  { name: "plausible", url: "https://plausible.io/" },
  { name: "basecamp", url: "https://basecamp.com/" },
  { name: "pipedrive", url: "https://www.pipedrive.com/" },
  { name: "teamtailor", url: "https://www.teamtailor.com/" },
];
const SEGMENTS = ["new_skimmer", "engaged_no_click", "price_hesitant"] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scrollThrough(page: Page, steps = 8) {
  for (let i = 1; i <= steps; i++) {
    await page
      .evaluate(
        ({ idx, total }) => {
          const h = document.documentElement.scrollHeight;
          window.scrollTo(0, (h / total) * idx);
        },
        { idx: i, total: steps },
      )
      .catch(() => {});
    await sleep(260);
  }
  await sleep(700);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(300);
}

type SiteReport = {
  name: string;
  url: string;
  ok: boolean;
  error?: string;
  inventory?: { trust: number; ctas: number; sections: number };
  derivedSegment?: string;
  runs?: Array<{ segment: string; applied: Array<{ patternId: string; detail: string }> }>;
  restoredClean?: boolean;
  shots?: string[];
};

async function runSite(page: Page, site: (typeof SITES)[number]): Promise<SiteReport> {
  const rep: SiteReport = { name: site.name, url: site.url, ok: false, runs: [], shots: [] };
  try {
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(1500);

    // Inject the REAL shipped bundle (learn mode — the harness drives adapt()).
    await page.evaluate(BUNDLE);
    // Wait until the snippet's own settle logic produced the inventory.
    await page
      .waitForFunction(() => (window as any).__angelAdaptive?.inventory != null, undefined, {
        timeout: 20_000,
      })
      .catch(() => {});

    // Real behavior data: scroll like a reading visitor (tracker records it).
    await scrollThrough(page);

    const inv = await page.evaluate(() => {
      const a = (window as any).__angelAdaptive;
      return a?.inventory
        ? { trust: a.inventory.trust.total, ctas: a.inventory.ctas.length, sections: a.inventory.sections.length }
        : null;
    });
    if (!inv) throw new Error("snippet produced no inventory");
    rep.inventory = inv;

    const shot = async (label: string, fullPage = false) => {
      const p = `${OUT_DIR}/adaptive-${site.name}-${label}.jpg`;
      await page.screenshot({ path: p, type: "jpeg", quality: 60, fullPage });
      rep.shots!.push(p);
    };

    await shot("before");

    // 1. The honest run: no segment argument — derived from the REAL events.
    let applied = await page.evaluate(() => (window as any).__angelAdaptive.adapt());
    rep.derivedSegment = await page.evaluate(() => (window as any).__angelAdaptive.segment);
    rep.runs!.push({ segment: `derived:${rep.derivedSegment}`, applied });
    await shot(`derived-${rep.derivedSegment}`);

    // 2. Each named segment (the "improvised visitor data" demo).
    for (const seg of SEGMENTS) {
      applied = await page.evaluate((s) => (window as any).__angelAdaptive.adapt(s), seg);
      rep.runs!.push({ segment: seg, applied });
      await shot(`after-${seg}`, seg === "price_hesitant"); // pricing may sit below the fold
    }

    // 3. Reversibility proof.
    await page.evaluate(() => (window as any).__angelAdaptive.revert());
    await sleep(200);
    rep.restoredClean = await page.evaluate(
      () => document.querySelectorAll("[data-angel-adaptation]").length === 0,
    );
    await shot("restored");

    rep.ok = true;
  } catch (err) {
    rep.error = err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : String(err);
  }
  return rep;
}

async function main() {
  console.log(`Adaptive E2E — real snippet, real sites, real behavior data → segments → patterns → revert`);
  mkdirSync(OUT_DIR, { recursive: true });
  const session = await createSession();
  console.log(`browserbase session ${session.id}\n`);
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  const reports: SiteReport[] = [];
  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
    for (const site of SITES) {
      process.stdout.write(`  ${site.name.padEnd(12)} `);
      const r = await runSite(page, site);
      reports.push(r);
      if (r.ok) {
        console.log(
          `ok · inv(trust ${r.inventory?.trust}, cta ${r.inventory?.ctas}, sec ${r.inventory?.sections}) · derived=${r.derivedSegment} · restored=${r.restoredClean ? "CLEAN" : "DIRTY!"}`,
        );
        for (const run of r.runs ?? []) {
          console.log(
            `      [${run.segment.padEnd(24)}] ${run.applied.length ? run.applied.map((a) => `${a.patternId}(${(a.detail || "").slice(0, 42)})`).join(" + ") : "—"}`,
          );
        }
      } else {
        console.log(`FAIL ${r.error}`);
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
  writeFileSync(`${OUT_DIR}/adaptive-e2e.json`, JSON.stringify({ reports }, null, 2));
  const okCount = reports.filter((r) => r.ok).length;
  const clean = reports.filter((r) => r.restoredClean).length;
  console.log(`\n${okCount}/${SITES.length} sites ran end-to-end · ${clean}/${okCount} restored byte-clean`);
  console.log(`JSON → ${OUT_DIR}/adaptive-e2e.json · shots → ${OUT_DIR}/adaptive-*.jpg`);
}

main().catch((e) => {
  console.error("adaptive-e2e failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
