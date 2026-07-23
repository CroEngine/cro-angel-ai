#!/usr/bin/env bun
// Phase 0 — shadow measurement: this repo's detection engine vs the live
// angel_* product, on real glutenforum.se pages.
// =====================================================================
// Runs the EXACT production path (COLLECT_SCRIPT + runPageAudit, the same calls
// replayCorpus makes) against the LIVE pages through a Browserbase remote browser,
// then diffs the engine's per-CTA classification against what the live system
// stored in angel_content_inventory (captured 2026-07-20, hardcoded as baseline).
//
// Read-only: renders pages, writes nothing to the live product. Answers the two
// Phase-0 gate questions:
//   1. CTA precision — how many live `cta_primary` false-positives (cookie / nav /
//      image-zoom / comment / social) does this engine demote?
//   2. Trust — does this engine find trust signals where day0 reported zero?
//
// Run: local Chromium cannot egress in this sandbox and Bun's fetch bypasses the
// egress proxy, so bundle for Node and run under Node with the proxy env:
//   bun build scripts/phase0-glutenforum.ts --target=node --format=esm \
//     --outfile=phase0.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node phase0.node.mjs
// Needs BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID in env.
//
// See docs/migration-detection-engine-phase0.md for the findings this produced.

import { chromium, type Page } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

import { COLLECT_SCRIPT } from "../src/lib/tests/scripts/collect";
import { runPageAudit } from "../src/lib/tests/runners/pageAudit.server";
import { normalizeCollect, normalizePageAudit } from "../src/lib/tests/snapshot/normalize";
import { EXTRACTOR_VERSION } from "../src/lib/tests/extractor-version";
import { createSession, closeSession } from "../src/lib/tests/browserbase.server";

// Local Chromium cannot egress in this sandbox, so we drive a Browserbase remote
// browser (same capture path the freeze pipeline uses). Bun's fetch bypasses the
// egress proxy, so this must be bundled + run under Node with NODE_USE_ENV_PROXY=1.
const ORIGIN = "https://glutenforum.se";
const OUT_DIR = "/tmp/claude-0/-home-user-cro-angel-ai/c11460d4-452b-5901-aaf1-829bf613facc/scratchpad";

// Live baseline: CTAs the live angel_* system stored as `cta_primary` per page
// (from angel_content_inventory, 2026-07-20). `fp` = false-positive by the CTA's
// nature (cookie link / image-zoom / comment / social / mailto), which a precise
// detector should NOT rank primary. `tp` = a genuine acquisition CTA.
type Baseline = { text: string; kind: "fp" | "tp"; why: string };
type PageSpec = { path: string; label: string; baseline: Baseline[] };

const PAGES: PageSpec[] = [
  {
    path: "/",
    label: "home",
    baseline: [{ text: "Skapa konto", kind: "tp", why: "signup (header)" }],
  },
  {
    path: "/registrera",
    label: "registrera",
    baseline: [
      { text: "Skapa konto", kind: "tp", why: "signup" },
      { text: "Registrera med Google", kind: "tp", why: "signup" },
      { text: "Registrera med Apple", kind: "tp", why: "signup" },
    ],
  },
  {
    path: "/recept/grillad-lax-med-potatismos-glutenfri",
    label: "recept-lax",
    baseline: [
      { text: "Skapa konto", kind: "tp", why: "signup (header)" },
      { text: "Läs mer i vår cookiepolicy", kind: "fp", why: "cookie-policy link" },
    ],
  },
  {
    path: "/recept/glutenfri-gnocchi-med-korvgryta",
    label: "recept-gnocchi",
    baseline: [
      { text: "Förstora bild", kind: "fp", why: "image-zoom button" },
      { text: "Förstora bild 2", kind: "fp", why: "image-zoom button" },
    ],
  },
  {
    path: "/matvaror/butik/willys-tom-yum-risnudlar-glutenfri",
    label: "matvara-willys",
    baseline: [
      { text: "Skapa konto", kind: "tp", why: "signup (header)" },
      { text: "Kommentera", kind: "fp", why: "comment button" },
    ],
  },
  {
    path: "/manadens-glutenfria-profil/mickans-glutenfria",
    label: "profil-mickan",
    baseline: [
      { text: "E-post", kind: "fp", why: "mailto/contact" },
      { text: "Läs mer i vår cookiepolicy", kind: "fp", why: "cookie-policy link" },
      { text: "Följ på Instagram", kind: "fp", why: "social follow" },
    ],
  },
  {
    path: "/restauranger/pinchos-norrlandsgatan-stockholm-mo75csvi",
    label: "restaurang-pinchos",
    baseline: [{ text: "Läs mer i vår cookiepolicy", kind: "fp", why: "cookie-policy link" }],
  },
];

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

type CtaEl = {
  text: string;
  category?: string;
  intent?: string;
  section?: string;
  aboveFold?: boolean;
};

interface PageResult {
  label: string;
  url: string;
  ok: boolean;
  error?: string;
  hero?: { headline: string; primaryCtaText: string; primaryCtaIntent?: string };
  ctaSummary?: { total?: number; primary?: number; aboveFold?: number };
  trust?: { total?: number; byType?: Record<string, number> };
  sectionOrder?: string[];
  primaryCtas?: CtaEl[]; // engine's cta_primary elements
  comparisons?: Array<{
    text: string;
    liveKind: "fp" | "tp";
    why: string;
    found: boolean;
    enginePrimary: boolean;
    engineCategory?: string;
    engineIntent?: string;
    verdict: string;
  }>;
}

async function auditPage(page: Page, spec: PageSpec): Promise<PageResult> {
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
    const audit = normalizePageAudit(rawAudit);

    res.ok = true;
    res.hero = {
      headline: audit.hero?.headline ?? "",
      primaryCtaText: audit.hero?.primaryCtaText ?? "",
      primaryCtaIntent: audit.hero?.primaryCtaIntent,
    };
    res.ctaSummary = audit.ctaSummary;
    res.trust = {
      total: audit.trustSummary?.total,
      byType: audit.trustSummary?.byType,
    };
    res.sectionOrder = audit.sectionOrder;

    const els = (collect.elements as CtaEl[]) || [];
    res.primaryCtas = els
      .filter((e) => e.category === "cta_primary")
      .map((e) => ({ text: e.text, intent: e.intent, section: e.section, aboveFold: e.aboveFold }));

    // Compare each live-baseline CTA to what THIS engine classified it as.
    res.comparisons = spec.baseline.map((b) => {
      const match = els.find((e) => norm(e.text) === norm(b.text) || norm(e.text).includes(norm(b.text)));
      const enginePrimary = match?.category === "cta_primary";
      let verdict: string;
      if (b.kind === "fp") {
        verdict = enginePrimary ? "FP RETAINED" : match ? "FP demoted" : "FP dropped (not a CTA)";
      } else {
        verdict = enginePrimary ? "TP kept primary" : match ? "TP demoted (regression?)" : "TP missing";
      }
      return {
        text: b.text,
        liveKind: b.kind,
        why: b.why,
        found: !!match,
        enginePrimary,
        engineCategory: match?.category,
        engineIntent: match?.intent,
        verdict,
      };
    });
  } catch (err) {
    res.error = err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : String(err);
  }
  return res;
}

async function main() {
  console.log(`Phase 0 — engine v${EXTRACTOR_VERSION} vs live angel_* on ${ORIGIN} (via Browserbase)`);
  const session = await createSession();
  console.log(`browserbase session ${session.id}\n`);
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  const results: PageResult[] = [];
  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
    for (const spec of PAGES) {
      process.stdout.write(`  ${spec.label.padEnd(20)} ${spec.path} … `);
      const r = await auditPage(page, spec);
      results.push(r);
      if (r.ok) {
        const fpDemoted = (r.comparisons ?? []).filter((c) => c.liveKind === "fp" && !c.enginePrimary).length;
        const fpTotal = (r.comparisons ?? []).filter((c) => c.liveKind === "fp").length;
        console.log(
          `ok · cta ${r.ctaSummary?.total}/${r.ctaSummary?.primary}p · trust ${r.trust?.total} · FP demoted ${fpDemoted}/${fpTotal}`,
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

  // ---- aggregate the two gate metrics -------------------------------------
  const allCmp = results.flatMap((r) => r.comparisons ?? []);
  const fp = allCmp.filter((c) => c.liveKind === "fp");
  const tp = allCmp.filter((c) => c.liveKind === "tp");
  const fpDemoted = fp.filter((c) => !c.enginePrimary).length;
  const tpKept = tp.filter((c) => c.enginePrimary).length;
  const trustFound = results.reduce((n, r) => n + (r.trust?.total ?? 0), 0);
  const pagesWithTrust = results.filter((r) => (r.trust?.total ?? 0) > 0).length;

  console.log("\n================ PHASE 0 RESULT ================");
  console.log(`pages audited        ${results.filter((r) => r.ok).length}/${PAGES.length}`);
  console.log(
    `CTA false-positives  ${fpDemoted}/${fp.length} demoted  (${
      fp.length ? Math.round((fpDemoted / fp.length) * 100) : 0
    }% of live cta_primary FPs)`,
  );
  console.log(`  gate ≥30% FP reduction: ${fp.length && fpDemoted / fp.length >= 0.3 ? "PASS" : "n/a"}`);
  console.log(`true-positives kept  ${tpKept}/${tp.length} (regression check — want all kept)`);
  console.log(`trust signals found  ${trustFound} across ${pagesWithTrust} page(s)  (live day0 = 0)`);
  console.log("\nFP detail:");
  for (const c of fp) console.log(`  [${c.verdict.padEnd(22)}] "${c.text}" (${c.why})`);
  console.log("\nTP detail:");
  for (const c of tp)
    console.log(`  [${c.verdict.padEnd(22)}] "${c.text}" → ${c.engineCategory ?? "∅"}/${c.engineIntent ?? "∅"}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = `${OUT_DIR}/phase0-glutenforum.json`;
  writeFileSync(
    outPath,
    JSON.stringify(
      { origin: ORIGIN, extractorVersion: EXTRACTOR_VERSION, results }, null, 2),
  );
  console.log(`\nfull JSON → ${outPath}`);
}

main().catch((e) => {
  console.error("phase0 failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
