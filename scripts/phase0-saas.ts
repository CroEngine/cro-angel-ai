#!/usr/bin/env bun
// Phase 0b — SaaS rerun of the shadow measurement: this repo's detection engine
// on plausible.io (the live product's "Plausible Lab" site), its home turf.
// =====================================================================
// Phase 0 on glutenforum (content SPA) failed the gate — see
// docs/migration-detection-engine-phase0.md. This rerun asks the follow-up the
// findings demanded: does the engine's measured edge show up on a SaaS landing
// page? Baseline: the live system's LLM goal_candidates for this site
// (angel_sites, captured 2026-07-20): rank1 "Start free trial", rank2 "View live
// demo", rank3 "Contact us".
//
// Read-only. Same run mechanics as phase0-glutenforum.ts (Browserbase + Node):
//   bun build scripts/phase0-saas.ts --target=node --format=esm \
//     --outfile=phase0b.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node phase0b.node.mjs

import { chromium, type Page } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

import { COLLECT_SCRIPT } from "../src/lib/tests/scripts/collect";
import { runPageAudit } from "../src/lib/tests/runners/pageAudit.server";
import { normalizeCollect, normalizePageAudit } from "../src/lib/tests/snapshot/normalize";
import { EXTRACTOR_VERSION } from "../src/lib/tests/extractor-version";
import { createSession, closeSession } from "../src/lib/tests/browserbase.server";

const ORIGIN = "https://plausible.io";
const OUT_DIR = "/tmp/claude-0/-home-user-cro-angel-ai/c11460d4-452b-5901-aaf1-829bf613facc/scratchpad";

// Live LLM goal ranking for this site (angel_sites.goal_candidates, 2026-07-20).
const LIVE_GOALS = ["Start free trial", "View live demo", "Contact us"];

const PAGES: Array<{ path: string; label: string; headToHead?: boolean }> = [
  { path: "/", label: "home", headToHead: true },
  { path: "/vs-google-analytics", label: "vs-ga" },
  { path: "/register", label: "register" },
];

// Hard-junk classes that must never be a primary CTA (the live system's known
// failure modes on glutenforum). Utility-nav (login etc) is flagged separately.
const HARD_JUNK = /cookie|privacy policy|godkänn|förstora|instagram|facebook|twitter|linkedin|follow us/i;
const UTILITY = /^(log ?in|sign ?in|logga in)$/i;

const norm = (s: string) => (s || "").trim().toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForReady(page: Page) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => document.readyState).catch(() => null);
    if (ready === "complete") return;
    await sleep(150);
  }
}

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
    await sleep(180);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)).catch(() => {});
  await sleep(600);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(200);
}

type El = { text: string; category?: string; intent?: string; section?: string; aboveFold?: boolean };

interface PageResult {
  label: string;
  url: string;
  ok: boolean;
  error?: string;
  hero?: { headline: string; primaryCtaText: string; primaryCtaIntent?: string };
  ctaSummary?: { total?: number; primary?: number; aboveFold?: number };
  primaryCtaTexts?: string[];
  hardJunkInPrimary?: string[];
  utilityInPrimary?: string[];
  trust?: { total?: number; byType?: Record<string, number> };
  trustEvidence?: unknown;
  sectionOrder?: string[];
  rank1Match?: boolean;
  liveGoalsSeen?: Array<{ goal: string; engineCategory?: string; enginePrimary: boolean }>;
  screenshot?: string;
}

async function auditPage(page: Page, spec: (typeof PAGES)[number]): Promise<PageResult> {
  const url = ORIGIN + spec.path;
  const res: PageResult = { label: spec.label, url, ok: false };
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    await waitForReady(page);
    await sleep(500);
    await scrollThrough(page);

    const rawCollect = (await page.evaluate(COLLECT_SCRIPT)) as unknown;
    const collect = normalizeCollect({ target: "clickables", elements: rawCollect, count: 0 });
    const rawAudit = await runPageAudit(page as unknown as Parameters<typeof runPageAudit>[0], {
      skipScrollWarmup: true,
    });
    const audit = normalizePageAudit(rawAudit, { keepTrustEntries: true });

    res.ok = true;
    res.hero = {
      headline: audit.hero?.headline ?? "",
      primaryCtaText: audit.hero?.primaryCtaText ?? "",
      primaryCtaIntent: audit.hero?.primaryCtaIntent,
    };
    res.ctaSummary = audit.ctaSummary;
    res.trust = { total: audit.trustSummary?.total, byType: audit.trustSummary?.byType };
    res.trustEvidence = audit.trustEvidence;
    res.sectionOrder = audit.sectionOrder;

    const els = (collect.elements as El[]) || [];
    const primaries = els.filter((e) => e.category === "cta_primary");
    res.primaryCtaTexts = primaries.map((e) => e.text);
    res.hardJunkInPrimary = primaries.filter((e) => HARD_JUNK.test(e.text)).map((e) => e.text);
    res.utilityInPrimary = primaries.filter((e) => UTILITY.test(e.text)).map((e) => e.text);

    if (spec.headToHead) {
      res.rank1Match = norm(res.hero.primaryCtaText).includes(norm(LIVE_GOALS[0]));
      res.liveGoalsSeen = LIVE_GOALS.map((goal) => {
        const match = els.find((e) => norm(e.text).includes(norm(goal)));
        return { goal, engineCategory: match?.category, enginePrimary: match?.category === "cta_primary" };
      });
    }

    const shot = `${OUT_DIR}/phase0b-${spec.label}.jpg`;
    await page.screenshot({ path: shot, fullPage: true, type: "jpeg", quality: 55 }).catch(() => {});
    res.screenshot = shot;
  } catch (err) {
    res.error = err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : String(err);
  }
  return res;
}

async function main() {
  console.log(`Phase 0b — engine v${EXTRACTOR_VERSION} on ${ORIGIN} (SaaS home turf, via Browserbase)`);
  mkdirSync(OUT_DIR, { recursive: true });
  const session = await createSession();
  console.log(`browserbase session ${session.id}\n`);
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  const results: PageResult[] = [];
  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
    for (const spec of PAGES) {
      process.stdout.write(`  ${spec.label.padEnd(10)} ${spec.path} … `);
      const r = await auditPage(page, spec);
      results.push(r);
      if (r.ok) {
        console.log(
          `ok · hero-CTA ${JSON.stringify(r.hero?.primaryCtaText)} · cta ${r.ctaSummary?.total}/${r.ctaSummary?.primary}p · trust ${r.trust?.total}`,
        );
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

  console.log("\n================ PHASE 0b RESULT ================");
  const home = results.find((r) => r.label === "home");
  console.log(`pages audited            ${results.filter((r) => r.ok).length}/${PAGES.length}`);
  console.log(`\n— head-to-head on home (live LLM rank1 = ${JSON.stringify(LIVE_GOALS[0])}) —`);
  console.log(`engine deriveHero pick   ${JSON.stringify(home?.hero?.primaryCtaText)} (intent ${home?.hero?.primaryCtaIntent})`);
  console.log(`rank1 match              ${home?.rank1Match ? "YES" : "NO"}`);
  for (const g of home?.liveGoalsSeen ?? []) {
    console.log(`  live goal ${JSON.stringify(g.goal).padEnd(20)} → engine ${g.engineCategory ?? "not collected"}`);
  }
  console.log(`\n— per-page detail —`);
  for (const r of results) {
    if (!r.ok) continue;
    console.log(`\n  [${r.label}] hero ${JSON.stringify((r.hero?.headline ?? "").slice(0, 60))}`);
    console.log(`    deriveHero CTA   ${JSON.stringify(r.hero?.primaryCtaText)}`);
    console.log(`    cta_primary (${r.primaryCtaTexts?.length}): ${JSON.stringify(r.primaryCtaTexts?.slice(0, 12))}`);
    console.log(`    hard junk in primary: ${r.hardJunkInPrimary?.length ? JSON.stringify(r.hardJunkInPrimary) : "none"}`);
    console.log(`    utility in primary  : ${r.utilityInPrimary?.length ? JSON.stringify(r.utilityInPrimary) : "none"}`);
    console.log(`    trust ${r.trust?.total} ${JSON.stringify(r.trust?.byType ?? {})}`);
    console.log(`    sections: ${(r.sectionOrder ?? []).join(" › ")}`);
  }

  const outPath = `${OUT_DIR}/phase0b-plausible.json`;
  writeFileSync(outPath, JSON.stringify({ origin: ORIGIN, extractorVersion: EXTRACTOR_VERSION, liveGoals: LIVE_GOALS, results }, null, 2));
  console.log(`\nfull JSON → ${outPath}`);
  console.log(`screenshots → ${OUT_DIR}/phase0b-*.jpg`);
}

main().catch((e) => {
  console.error("phase0b failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
