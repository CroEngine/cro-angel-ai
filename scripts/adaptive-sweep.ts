#!/usr/bin/env bun
// Adaptive sweep — the FULL write-side loop across the day-0 site list, with
// FABRICATED visitor data driving the segment engine.
// =====================================================================
// Per site: inject the shipped bundle → inventory → dismiss consent modal
// (best-effort, so demo shots aren't covered) → BEFORE shot → for each
// PERSONA: fabricate a realistic behavior-event stream (the "improvised user
// data"), call adapt() with NO argument so the segment is DERIVED from that
// data (tests decision layer + patterns together), record what applied, shot →
// revert → assert zero [data-angel-adaptation] remain.
//
//   bun build scripts/adaptive-sweep.ts --target=node --format=esm \
//     --outfile=asweep.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
//     node asweep.node.mjs --from=0 --to=12

import { chromium, type Page } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";
import { SITES } from "./day0-sites";

const OUT_DIR = "/tmp/claude-0/-home-user-cro-angel-ai/c11460d4-452b-5901-aaf1-829bf613facc/scratchpad";
const BUNDLE = readFileSync("public/adaptive.js", "utf8");
const CHUNK = 5;

// Known remote-tab crashers from the day-0 sweep — skip, don't burn time.
const SKIP = new Set(["attio", "clay", "loops"]);

// The improvised visitor data: realistic event streams (tracker shapes — note
// time_on_page is MILLISECONDS, like the real tracker emits).
const PERSONAS: Array<{ name: string; expect: string; events: Array<Record<string, unknown>> }> = [
  {
    name: "skimmer",
    expect: "new_skimmer",
    events: [
      { type: "pageview", ts: 0 },
      { type: "scroll_depth", ts: 0, value: 12 },
      { type: "time_on_page", ts: 0, value: 8_000 },
    ],
  },
  {
    name: "reader_no_click",
    expect: "engaged_no_click|price_hesitant",
    events: [
      { type: "pageview", ts: 0 },
      { type: "scroll_depth", ts: 0, value: 88 },
      { type: "time_on_page", ts: 0, value: 95_000 },
    ],
  },
  {
    name: "price_checker",
    expect: "price_hesitant|engaged_no_click",
    events: [
      { type: "pageview", ts: 0 },
      { type: "scroll_depth", ts: 0, value: 72 },
      { type: "time_on_page", ts: 0, value: 60_000 },
    ],
  },
  {
    name: "clicker_control",
    expect: "default",
    events: [
      { type: "pageview", ts: 0 },
      { type: "scroll_depth", ts: 0, value: 55 },
      { type: "cta_click", ts: 0, selector: "a", text: "x" },
      { type: "time_on_page", ts: 0, value: 40_000 },
    ],
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  const f = process.argv.find((a) => a.startsWith(p));
  return f?.slice(p.length);
}

// Best-effort consent dismissal so bars/CTAs aren't photographed under a modal.
// Conservative: visible button whose text is a clear accept phrase.
async function dismissConsent(page: Page) {
  await page
    .evaluate(() => {
      const RX = /^(accept( all)?( cookies)?|allow all|godk[äa]nn( alla)?( cookies)?|acceptera( alla)?|accept all cookies|jag f[öo]rst[åa]r|ok(ay)?|got it)$/i;
      const els = Array.from(document.querySelectorAll("button, [role=button], a"));
      for (const el of els) {
        const t = ((el as HTMLElement).innerText || "").trim();
        if (t && t.length <= 30 && RX.test(t)) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 10 && r.height > 10) {
            (el as HTMLElement).click();
            return true;
          }
        }
      }
      return false;
    })
    .catch(() => {});
  await sleep(700);
}

type PersonaRun = {
  persona: string;
  derived: string;
  matchesExpectation: boolean;
  applied: Array<{ patternId: string; detail: string }>;
};

type SiteReport = {
  name: string;
  url: string;
  ok: boolean;
  error?: string;
  inventory?: { trust: number; ctas: number; sections: number; hasPricing: boolean };
  runs?: PersonaRun[];
  restoredClean?: boolean;
};

async function runSite(page: Page, site: { name: string; url: string }): Promise<SiteReport> {
  const rep: SiteReport = { name: site.name, url: site.url, ok: false, runs: [] };
  try {
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(1500);
    await page.evaluate(BUNDLE);
    await page
      .waitForFunction(() => (window as any).__angelAdaptive?.inventory != null, undefined, { timeout: 20_000 })
      .catch(() => {});
    const inv = await page.evaluate(() => {
      const a = (window as any).__angelAdaptive;
      return a?.inventory
        ? {
            trust: a.inventory.trust.total,
            ctas: a.inventory.ctas.length,
            sections: a.inventory.sections.length,
            hasPricing: a.inventory.sections.some((s: any) => s.type === "pricing"),
          }
        : null;
    });
    if (!inv) throw new Error("snippet produced no inventory");
    rep.inventory = inv;
    await dismissConsent(page);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.screenshot({ path: `${OUT_DIR}/asweep-${site.name}-before.jpg`, type: "jpeg", quality: 55 });

    for (const persona of PERSONAS) {
      const run = (await page.evaluate((p) => {
        const a = (window as any).__angelAdaptive;
        a.events.length = 0;
        for (const e of p.events) a.events.push(e);
        const applied = a.adapt(); // segment DERIVED from the fabricated data
        return { derived: a.segment, applied };
      }, persona)) as { derived: string; applied: Array<{ patternId: string; detail: string }> };
      rep.runs!.push({
        persona: persona.name,
        derived: run.derived,
        matchesExpectation: new RegExp(`^(${persona.expect})$`).test(run.derived),
        applied: run.applied.map((a) => ({ patternId: a.patternId, detail: (a as any).detail ?? "" })),
      });
      if (persona.name === "reader_no_click") {
        await page.screenshot({ path: `${OUT_DIR}/asweep-${site.name}-after-reader.jpg`, type: "jpeg", quality: 55 });
      }
      await page.evaluate(() => (window as any).__angelAdaptive.revert());
      await sleep(120);
    }
    rep.restoredClean = await page.evaluate(
      () => document.querySelectorAll("[data-angel-adaptation]").length === 0,
    );
    rep.ok = true;
  } catch (err) {
    rep.error = err instanceof Error ? err.message.split("\n")[0].slice(0, 160) : String(err);
  }
  return rep;
}

async function main() {
  const from = Math.max(0, Number(arg("from") ?? "0"));
  const to = Math.min(Number(arg("to") ?? String(SITES.length)), SITES.length);
  const targets = SITES.slice(from, to).filter((s) => !SKIP.has(s.name));
  console.log(`Adaptive sweep — fabricated personas → derived segments → patterns · sites ${from}..${to - 1} (${targets.length})`);
  mkdirSync(OUT_DIR, { recursive: true });
  const reports: SiteReport[] = [];
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const session = await createSession();
    console.log(`\n[chunk] ${session.id} — ${chunk.map((s) => s.name).join(", ")}`);
    let browser = null as Awaited<ReturnType<typeof chromium.connectOverCDP>> | null;
    try {
      browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
      for (const site of chunk) {
        process.stdout.write(`  ${site.name.padEnd(14)} `);
        const r = await runSite(page, site);
        reports.push(r);
        if (r.ok) {
          const segs = r.runs!.map((x) => `${x.persona}→${x.derived}${x.matchesExpectation ? "" : "(!)"}`).join(" ");
          console.log(`ok · restored=${r.restoredClean ? "clean" : "DIRTY"} · ${segs}`);
        } else console.log(`FAIL ${r.error}`);
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
  const outPath = `${OUT_DIR}/adaptive-sweep-${from}-${to}.json`;
  writeFileSync(outPath, JSON.stringify({ from, to, reports }, null, 1));
  const ok = reports.filter((r) => r.ok);
  console.log(`\n${ok.length}/${reports.length} ok · JSON → ${outPath}`);
}

main().catch((e) => {
  console.error("adaptive-sweep failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
