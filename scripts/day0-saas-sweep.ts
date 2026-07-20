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
// Indices 0-12 = the original 2026-07-20 daytime sweep; 13+ = the overnight
// expansion (Nordic SaaS cluster for the home market + global PLG/sales-led
// mix). Run a slice with --from/--to (defaults: everything).
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
  // ── Nordic SaaS (SE/DK/NO — the home market) ──────────────────────────────
  { name: "teamtailor", url: "https://www.teamtailor.com/" },
  { name: "quinyx", url: "https://www.quinyx.com/" },
  { name: "getaccept", url: "https://www.getaccept.com/" },
  { name: "oneflow", url: "https://oneflow.com/" },
  { name: "scrive", url: "https://www.scrive.com/" },
  { name: "voyado", url: "https://voyado.com/" },
  { name: "funnel", url: "https://funnel.io/" },
  { name: "epidemicsound", url: "https://www.epidemicsound.com/" },
  { name: "pleo", url: "https://www.pleo.io/" },
  { name: "dixa", url: "https://www.dixa.com/" },
  { name: "whereby", url: "https://whereby.com/" },
  { name: "kahoot", url: "https://kahoot.com/" },
  { name: "unleash", url: "https://www.getunleash.io/" },
  { name: "juni", url: "https://juni.co/" },
  { name: "trustly", url: "https://www.trustly.com/" },
  // ── PLG dev-tools ─────────────────────────────────────────────────────────
  { name: "sentry", url: "https://sentry.io/" },
  { name: "retool", url: "https://retool.com/" },
  { name: "railway", url: "https://railway.app/" },
  { name: "render", url: "https://render.com/" },
  { name: "flyio", url: "https://fly.io/" },
  { name: "netlify", url: "https://www.netlify.com/" },
  { name: "neon", url: "https://neon.tech/" },
  { name: "clerk", url: "https://clerk.com/" },
  { name: "auth0", url: "https://auth0.com/" },
  { name: "algolia", url: "https://www.algolia.com/" },
  { name: "contentful", url: "https://www.contentful.com/" },
  { name: "sanity", url: "https://www.sanity.io/" },
  { name: "strapi", url: "https://strapi.io/" },
  { name: "ghost", url: "https://ghost.org/" },
  { name: "resend", url: "https://resend.com/" },
  { name: "n8n", url: "https://n8n.io/" },
  // ── Marketing / sales SaaS ────────────────────────────────────────────────
  { name: "mailchimp", url: "https://mailchimp.com/" },
  { name: "klaviyo", url: "https://www.klaviyo.com/" },
  { name: "activecampaign", url: "https://www.activecampaign.com/" },
  { name: "mailerlite", url: "https://www.mailerlite.com/" },
  { name: "beehiiv", url: "https://www.beehiiv.com/" },
  { name: "hotjar", url: "https://www.hotjar.com/" },
  { name: "mixpanel", url: "https://mixpanel.com/" },
  { name: "amplitude", url: "https://amplitude.com/" },
  { name: "segment", url: "https://segment.com/" },
  { name: "customerio", url: "https://customer.io/" },
  { name: "semrush", url: "https://www.semrush.com/" },
  { name: "ahrefs", url: "https://ahrefs.com/" },
  { name: "moz", url: "https://moz.com/" },
  { name: "surferseo", url: "https://surferseo.com/" },
  { name: "pipedrive", url: "https://www.pipedrive.com/" },
  { name: "close", url: "https://www.close.com/" },
  { name: "gorgias", url: "https://www.gorgias.com/" },
  { name: "helpscout", url: "https://www.helpscout.com/" },
  { name: "front", url: "https://front.com/" },
  { name: "aircall", url: "https://aircall.io/" },
  // ── Productivity / HR / fintech ───────────────────────────────────────────
  { name: "slack", url: "https://slack.com/" },
  { name: "dropbox", url: "https://www.dropbox.com/" },
  { name: "miro", url: "https://miro.com/" },
  { name: "canva", url: "https://www.canva.com/" },
  { name: "grammarly", url: "https://www.grammarly.com/" },
  { name: "todoist", url: "https://todoist.com/" },
  { name: "superhuman", url: "https://superhuman.com/" },
  { name: "calcom", url: "https://cal.com/" },
  { name: "toggl", url: "https://toggl.com/" },
  { name: "wrike", url: "https://www.wrike.com/" },
  { name: "smartsheet", url: "https://www.smartsheet.com/" },
  { name: "gusto", url: "https://gusto.com/" },
  { name: "rippling", url: "https://www.rippling.com/" },
  { name: "bamboohr", url: "https://www.bamboohr.com/" },
  { name: "personio", url: "https://www.personio.com/" },
  { name: "remotecom", url: "https://remote.com/" },
  { name: "ramp", url: "https://ramp.com/" },
  { name: "mercury", url: "https://mercury.com/" },
  { name: "onepassword", url: "https://1password.com/" },
  { name: "vanta", url: "https://www.vanta.com/" },
  { name: "docusign", url: "https://www.docusign.com/" },
  { name: "pandadoc", url: "https://www.pandadoc.com/" },
  { name: "chargebee", url: "https://www.chargebee.com/" },
  { name: "paddle", url: "https://www.paddle.com/" },
];
const CHUNK = 5; // sites per Browserbase session (limits blast radius of a dying session)

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  const f = process.argv.find((a) => a.startsWith(p));
  return f?.slice(p.length);
}

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
  const from = Math.max(0, Number(arg("from") ?? "0"));
  const to = Math.min(Number(arg("to") ?? String(SITES.length)), SITES.length);
  // --names=a,b,c overrides --from/--to — used for targeted re-runs (e.g. the
  // v1.20 validation pass over the sites the v1.19 sweep flagged).
  const names = arg("names")?.split(",").map((s) => s.trim()).filter(Boolean);
  const targets = names ? SITES.filter((s) => names.includes(s.name)) : SITES.slice(from, to);
  console.log(
    `Day-0 cold-start sweep — engine v${EXTRACTOR_VERSION}, ` +
      (names ? `named re-run [${targets.map((s) => s.name).join(", ")}]` : `sites ${from}..${to - 1} of ${SITES.length} (${targets.length} this run)`) +
      `, no data`,
  );
  mkdirSync(OUT_DIR, { recursive: true });
  const results: SiteResult[] = [];
  for (let i = 0; i < targets.length; i += CHUNK) {
    await runChunk(targets.slice(i, i + CHUNK), results);
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
  console.log(`audited cleanly      ${ok.length}/${targets.length}  (blocked: ${blocked.length}, failed: ${failed.length})`);
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

  const outPath = names
    ? `${OUT_DIR}/day0-sweep-rerun-v${EXTRACTOR_VERSION}.json`
    : from === 0 && to === SITES.length
      ? `${OUT_DIR}/day0-sweep.json`
      : `${OUT_DIR}/day0-sweep-${from}-${to}.json`;
  writeFileSync(outPath, JSON.stringify({ extractorVersion: EXTRACTOR_VERSION, from, to, names: names ?? null, results }, null, 2));
  console.log(`\nfull JSON → ${outPath}`);
}

main().catch((e) => {
  console.error("day0 sweep failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
