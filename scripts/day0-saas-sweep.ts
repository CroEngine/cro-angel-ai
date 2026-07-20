#!/usr/bin/env bun
// Day-0 cold-start sweep — the engine meets N fresh SaaS sites with NO data.
// =====================================================================
// Simulates the new-prospect moment end to end: no database, no baseline, no
// install — render the live homepage, run the real production engine (v1.19
// COLLECT_SCRIPT + runPageAudit) and report what Angel understood: hero,
// primary CTA, per-element CTA precision, trust signals (with evidence text),
// section map. Screenshots (above-fold + full-page) are captured so every
// claim can be verified against the rendered page.
//
// Sites are deliberately OUTSIDE the benchmark corpus — a true hold-out.
//
// Run (local Chromium can't egress in this sandbox; Bun's fetch bypasses the
// egress proxy, so bundle for Node and drive Browserbase):
//   bun build scripts/day0-saas-sweep.ts --target=node --format=esm \
//     --outfile=day0.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node day0.node.mjs
// Needs BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID.

import { chromium, type Browser, type Page } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

import { COLLECT_SCRIPT } from "../src/lib/tests/scripts/collect";
import { runPageAudit } from "../src/lib/tests/runners/pageAudit.server";
import { normalizeCollect, normalizePageAudit } from "../src/lib/tests/snapshot/normalize";
import { EXTRACTOR_VERSION } from "../src/lib/tests/extractor-version";
import { createSession, closeSession } from "../src/lib/tests/browserbase.server";

const OUT_DIR = "/tmp/claude-0/-home-user-cro-angel-ai/c11460d4-452b-5901-aaf1-829bf613facc/scratchpad";

// Hold-out set: none of these are in trust-eval/structure-eval corpora.
// mentimeter + fortnox = Swedish SaaS (the home market).
const SITES: Array<{ name: string; url: string }> = [
  { name: "monday", url: "https://monday.com/" },
  { name: "asana", url: "https://asana.com/" },
  { name: "clickup", url: "https://clickup.com/" },
  { name: "calendly", url: "https://calendly.com/" },
  { name: "zapier", url: "https://zapier.com/" },
  { name: "airtable", url: "https://www.airtable.com/" },
  { name: "webflow", url: "https://webflow.com/" },
  { name: "typeform", url: "https://www.typeform.com/" },
  { name: "posthog", url: "https://posthog.com/" },
  { name: "basecamp", url: "https://basecamp.com/" },
  { name: "deel", url: "https://www.deel.com/" },
  { name: "mentimeter", url: "https://www.mentimeter.com/" },
  { name: "fortnox", url: "https://www.fortnox.se/" },
];
const CHUNK = 5; // sites per Browserbase session (limits blast radius of a dying session)

// Junk classes that must never be "primary" (the failure modes seen in the wild).
const HARD_JUNK = /cookie|privacy policy|godkänn|förstora|instagram|facebook|twitter|linkedin|follow us/i;
const UTILITY = /^(log ?in|sign ?in|logga in)$/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForReady(page: Page, maxMs = 20_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => document.readyState).catch(() => null);
    if (ready === "complete") return;
    await sleep(200);
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
    await sleep(200);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)).catch(() => {});
  await sleep(700);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(300);
}

type El = { text: string; category?: string; intent?: string };

interface SiteResult {
  name: string;
  url: string;
  ok: boolean;
  error?: string;
  title?: string;
  h1Count?: number;
  hero?: { headline: string; primaryCtaText: string; primaryCtaIntent?: string; aboveFold?: boolean };
  ctaSummary?: { total?: number; primary?: number; aboveFold?: number };
  primaryCtaTexts?: string[];
  hardJunkInPrimary?: string[];
  utilityInPrimary?: string[];
  trust?: { total?: number; byType?: Record<string, number> };
  trustTexts?: Array<{ type: string; text: string }>;
  sectionOrder?: string[];
  suspectBlocked?: boolean;
  screenshotFold?: string;
  screenshotFull?: string;
}

async function auditSite(page: Page, site: { name: string; url: string }): Promise<SiteResult> {
  const res: SiteResult = { name: site.name, url: site.url, ok: false };
  try {
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForReady(page);
    await sleep(1200);
    await scrollThrough(page);

    const rawCollect = (await page.evaluate(COLLECT_SCRIPT)) as unknown;
    const collect = normalizeCollect({ target: "clickables", elements: rawCollect, count: 0 });
    const rawAudit = await runPageAudit(page as unknown as Parameters<typeof runPageAudit>[0], {
      skipScrollWarmup: true,
    });
    const audit = normalizePageAudit(rawAudit);

    res.ok = true;
    res.title = ((audit.head?.title as string) ?? "").slice(0, 90);
    res.h1Count = audit.headings?.h1Count;
    res.hero = {
      headline: audit.hero?.headline ?? "",
      primaryCtaText: audit.hero?.primaryCtaText ?? "",
      primaryCtaIntent: audit.hero?.primaryCtaIntent,
      aboveFold: audit.hero?.aboveFold,
    };
    res.ctaSummary = audit.ctaSummary;
    res.trust = { total: audit.trustSummary?.total, byType: audit.trustSummary?.byType };
    res.trustTexts = ((rawAudit as { trustSignals?: Array<{ type: string; text: string }> }).trustSignals ?? [])
      .map((s) => ({ type: s.type, text: (s.text || "").slice(0, 110) }));
    res.sectionOrder = audit.sectionOrder;

    const els = (collect.elements as El[]) || [];
    const primaries = els.filter((e) => e.category === "cta_primary");
    res.primaryCtaTexts = primaries.map((e) => e.text).slice(0, 15);
    res.hardJunkInPrimary = primaries.filter((e) => HARD_JUNK.test(e.text)).map((e) => e.text);
    res.utilityInPrimary = primaries.filter((e) => UTILITY.test(e.text)).map((e) => e.text);

    // Bot-wall heuristic: challenge pages have no h1/hero/CTAs and telltale titles.
    const t = (res.title || "").toLowerCase();
    res.suspectBlocked =
      /just a moment|attention required|access denied|verify you are|are you a robot/.test(t) ||
      ((res.h1Count ?? 0) === 0 && (res.ctaSummary?.total ?? 0) === 0);

    res.screenshotFold = `${OUT_DIR}/day0-${site.name}-fold.jpg`;
    await page.screenshot({ path: res.screenshotFold, type: "jpeg", quality: 60 }).catch(() => {});
    res.screenshotFull = `${OUT_DIR}/day0-${site.name}-full.jpg`;
    await page
      .screenshot({ path: res.screenshotFull, fullPage: true, type: "jpeg", quality: 45 })
      .catch(() => {});
  } catch (err) {
    res.error = err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : String(err);
  }
  return res;
}

async function runChunk(sites: Array<{ name: string; url: string }>, results: SiteResult[]) {
  const session = await createSession();
  console.log(`\n[chunk] browserbase session ${session.id} for: ${sites.map((s) => s.name).join(", ")}`);
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
    for (const site of sites) {
      process.stdout.write(`  ${site.name.padEnd(12)} `);
      const r = await auditSite(page, site);
      results.push(r);
      if (r.ok) {
        const junk = (r.hardJunkInPrimary?.length ?? 0) + (r.utilityInPrimary?.length ?? 0);
        console.log(
          `ok${r.suspectBlocked ? " (SUSPECT-BLOCKED)" : ""} · hero-CTA ${JSON.stringify(r.hero?.primaryCtaText)} · cta ${r.ctaSummary?.total}/${r.ctaSummary?.primary}p junk:${junk} · trust ${r.trust?.total} · ${r.sectionOrder?.length} sections`,
        );
      } else {
        console.log(`FAIL ${r.error}`);
      }
    }
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
    await closeSession(session.id).catch(() => {});
  }
}

async function main() {
  console.log(`Day-0 cold-start sweep — engine v${EXTRACTOR_VERSION}, ${SITES.length} hold-out SaaS sites, no data`);
  mkdirSync(OUT_DIR, { recursive: true });
  const results: SiteResult[] = [];
  for (let i = 0; i < SITES.length; i += CHUNK) {
    await runChunk(SITES.slice(i, i + CHUNK), results);
  }

  const ok = results.filter((r) => r.ok && !r.suspectBlocked);
  const blocked = results.filter((r) => r.ok && r.suspectBlocked);
  const failed = results.filter((r) => !r.ok);
  const withHeroCta = ok.filter((r) => (r.hero?.primaryCtaText ?? "") !== "");
  const junkFree = ok.filter(
    (r) => (r.hardJunkInPrimary?.length ?? 0) === 0 && (r.utilityInPrimary?.length ?? 0) === 0,
  );
  const withTrust = ok.filter((r) => (r.trust?.total ?? 0) > 0);

  console.log("\n================ DAY-0 SWEEP SUMMARY ================");
  console.log(`audited cleanly      ${ok.length}/${SITES.length}  (blocked: ${blocked.length}, failed: ${failed.length})`);
  console.log(`hero CTA asserted    ${withHeroCta.length}/${ok.length}`);
  console.log(`junk-free primaries  ${junkFree.length}/${ok.length}`);
  console.log(`trust signals found  ${withTrust.length}/${ok.length}`);
  for (const r of results) {
    if (!r.ok) {
      console.log(`  ✗ ${r.name}: ${r.error}`);
      continue;
    }
    console.log(`\n  ── ${r.name}${r.suspectBlocked ? "  ⚠ SUSPECT-BLOCKED" : ""} ─ ${r.title}`);
    console.log(`     h1 ${JSON.stringify((r.hero?.headline ?? "").slice(0, 70))}`);
    console.log(`     primary ${JSON.stringify(r.hero?.primaryCtaText)} (${r.hero?.primaryCtaIntent})`);
    console.log(`     cta_primary: ${JSON.stringify(r.primaryCtaTexts?.slice(0, 8))}`);
    if (r.hardJunkInPrimary?.length) console.log(`     HARD JUNK: ${JSON.stringify(r.hardJunkInPrimary)}`);
    if (r.utilityInPrimary?.length) console.log(`     utility: ${JSON.stringify(r.utilityInPrimary)}`);
    console.log(`     trust ${r.trust?.total}: ${JSON.stringify(r.trust?.byType ?? {})}`);
    for (const t of (r.trustTexts ?? []).slice(0, 6)) console.log(`       · [${t.type}] "${t.text.slice(0, 80)}"`);
    console.log(`     sections: ${(r.sectionOrder ?? []).join(" › ")}`);
  }

  const outPath = `${OUT_DIR}/day0-sweep.json`;
  writeFileSync(outPath, JSON.stringify({ extractorVersion: EXTRACTOR_VERSION, results }, null, 2));
  console.log(`\nfull JSON → ${outPath}`);
}

main().catch((e) => {
  console.error("day0 sweep failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
