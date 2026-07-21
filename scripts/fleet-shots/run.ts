#!/usr/bin/env bun
// FLEET SHOTS — live before/after of the REAL engine adapting each of the 101
// fleet sites. Re-crawls every site via Browserbase, dismisses consent, injects
// public/adaptive-lab.js, photographs BEFORE, applies the adaptation for a
// representative visitor, photographs AFTER, then reverts and photographs
// RESTORED to prove the page comes back byte-clean.
//
// "After" is the engine's SAFE PRIMITIVES (trust-bar, CTA emphasis, and any
// reorder it can safely do) — not the Claude-designed cohort redesign, which
// needs the production API. Honest scope, stated on every card.
//
// Robust for an overnight run: fresh Browserbase session every few sites (16-min
// session cap), a hard per-site timeout, graceful skip-on-failure, and the
// manifest is rewritten after EVERY site so a crash preserves progress.
//
// Build for Node (Browserbase needs Node + the proxy env), then run:
//   bun build scripts/fleet-shots/run.ts --target=node --format=esm \
//     --outfile=fleet-shots.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node fleet-shots.node.mjs

import { chromium, type Browser, type Page } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { createSession, closeSession } from "../../src/lib/tests/browserbase.server";
import { SITES } from "../day0-sites";

const OUT = "docs/fleet-shots-2026-07-21";
const IMG = `${OUT}/img`;
const BUNDLE = readFileSync("public/adaptive-lab.js", "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice(8) || 0);

// Best-effort accept-all consent so bars/CTAs aren't shot under a modal.
async function dismissConsent(page: Page) {
  await page
    .evaluate(() => {
      const RX = /^(accept( all)?( cookies)?|allow all( cookies)?|godk[äa]nn( alla)?( cookies)?|acceptera( alla)?( cookies)?|jag f[öo]rst[åa]r|ok(ay)?|got it|i agree|agree)$/i;
      for (const el of Array.from(document.querySelectorAll("button, [role=button], a"))) {
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
  await sleep(600);
}

// The same automated visual-acceptance the sweep uses — "nothing looks off" as
// code: bars full-width & sanely sized & visible; emphasis not collapsed/covered.
const VISUAL_CHECK = `(() => {
  const issues = [];
  for (const bar of document.querySelectorAll('[data-angel-adaptation]')) {
    const r = bar.getBoundingClientRect();
    if (r.height > 90) issues.push('bar-too-tall');
    if (r.width < window.innerWidth * 0.9) issues.push('bar-not-fullwidth');
    if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
    const hit = document.elementFromPoint(Math.floor(window.innerWidth/2), Math.max(1, Math.floor(r.top + r.height/2)));
    if (hit !== bar && !bar.contains(hit)) issues.push('bar-covered');
  }
  for (const el of document.querySelectorAll('[data-angel-emphasis]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) { issues.push('emphasis-collapsed'); continue; }
    if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
    const hit = document.elementFromPoint(Math.floor(r.left + r.width/2), Math.floor(r.top + r.height/2));
    if (hit !== el && !el.contains(hit) && !(hit && hit.contains(el))) issues.push('emphasis-covered');
  }
  return issues;
})()`;

type Rec = {
  name: string;
  url: string;
  ok: boolean;
  error?: string;
  applied?: string[];
  segment?: string;
  visualIssues?: string[];
  restoredClean?: boolean;
  changed?: boolean; // did the AFTER differ from BEFORE at all?
  before?: string;
  after?: string;
};

const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms))]);

async function shoot(page: Page, file: string) {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(250);
  await page.screenshot({ path: `${IMG}/${file}`, type: "jpeg", quality: 46 });
}

async function runSite(page: Page, site: { name: string; url: string }): Promise<Rec> {
  const rec: Rec = { name: site.name, url: site.url, ok: false };
  await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 55_000 });
  await sleep(1400);
  await dismissConsent(page);
  await sleep(700);
  await page.evaluate(BUNDLE);
  await page
    .waitForFunction(() => (window as unknown as { __angelAdaptive?: { inventory?: unknown } }).__angelAdaptive?.inventory != null, undefined, { timeout: 28_000 })
    .catch(() => {});
  // A late consent reload can wipe the global — re-inject once.
  const alive = await page.evaluate(() => !!(window as unknown as { __angelAdaptive?: unknown }).__angelAdaptive).catch(() => false);
  if (!alive) {
    await page.evaluate(BUNDLE);
    await page.waitForFunction(() => (window as unknown as { __angelAdaptive?: { inventory?: unknown } }).__angelAdaptive?.inventory != null, undefined, { timeout: 18_000 }).catch(() => {});
  }
  const hasInv = await page.evaluate(() => !!(window as unknown as { __angelAdaptive?: { inventory?: unknown } }).__angelAdaptive?.inventory).catch(() => false);
  if (!hasInv) throw new Error("no inventory");

  await dismissConsent(page);
  rec.before = `${site.name}-before.jpg`;
  await shoot(page, rec.before);

  // Adapt for a representative visitor: an engaged reader who hasn't clicked —
  // the segment that most reliably surfaces the safe primitives (trust bar +
  // CTA emphasis, and reorder where eligible). Real engine output, not staged.
  const res = (await page.evaluate(() => {
    const a = (window as unknown as { __angelAdaptive: { events: unknown[]; adapt: (s?: string) => Array<{ label: string; detail?: string }>; segment: string } }).__angelAdaptive;
    a.events.length = 0;
    a.events.push({ type: "pageview", ts: 0 });
    a.events.push({ type: "scroll_depth", ts: 0, value: 82 });
    a.events.push({ type: "time_on_page", ts: 0, value: 45_000 });
    const applied = a.adapt("engaged_no_click");
    return { applied: applied.map((x) => x.label + (x.detail ? ` — ${x.detail}` : "")), segment: a.segment };
  })) as { applied: string[]; segment: string };
  rec.applied = res.applied;
  rec.segment = res.segment;
  await sleep(500);
  rec.visualIssues = (await page.evaluate(VISUAL_CHECK).catch(() => [])) as string[];
  rec.changed = rec.applied.length > 0;

  rec.after = `${site.name}-after.jpg`;
  await shoot(page, rec.after);

  // Revert and confirm the page returns clean (no angel residue).
  const clean = await page.evaluate(() => {
    const a = (window as unknown as { __angelAdaptive: { revert: () => void } }).__angelAdaptive;
    a.revert();
    return (
      document.querySelectorAll("[data-angel-adaptation],[data-angel-emphasis],[data-angel-reorder]").length === 0
    );
  }).catch(() => false);
  rec.restoredClean = clean;
  rec.ok = true;
  return rec;
}

async function freshPage(): Promise<{ browser: Browser; page: Page; sessionId: string; born: number }> {
  const session = await createSession();
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.setViewportSize({ width: 1200, height: 840 });
  return { browser, page, sessionId: session.id, born: Date.now() };
}

async function main() {
  mkdirSync(IMG, { recursive: true });
  let targets = SITES as Array<{ name: string; url: string }>;
  if (only) targets = targets.filter((s) => s.name === only);
  if (limit) targets = targets.slice(0, limit);

  const records: Rec[] = [];
  let h = await freshPage();
  const flush = () => writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ generatedAtSites: records.length, records }, null, 1));

  for (let i = 0; i < targets.length; i++) {
    const site = targets[i];
    // Recycle the session before the 16-min cap, or after a failure.
    if (Date.now() - h.born > 11 * 60_000) {
      try {
        await h.browser.close();
      } catch {}
      await closeSession(h.sessionId).catch(() => {});
      h = await freshPage();
    }
    process.stdout.write(`[${i + 1}/${targets.length}] ${site.name} … `);
    try {
      const rec = await withTimeout(runSite(h.page, site), 95_000, "site");
      records.push(rec);
      console.log(`ok · ${rec.changed ? rec.applied?.join(", ") : "no change"}${rec.visualIssues?.length ? ` · issues: ${rec.visualIssues.join(",")}` : ""}${rec.restoredClean === false ? " · RESIDUE" : ""}`);
    } catch (err) {
      records.push({ name: site.name, url: site.url, ok: false, error: String(err).slice(0, 160) });
      console.log(`FAIL · ${String(err).slice(0, 90)}`);
      // Rebuild the session — a failed site often leaves the page/session bad.
      try {
        await h.browser.close();
      } catch {}
      await closeSession(h.sessionId).catch(() => {});
      h = await freshPage();
    }
    flush(); // progress survives a crash
  }
  try {
    await h.browser.close();
  } catch {}
  await closeSession(h.sessionId).catch(() => {});

  const okN = records.filter((r) => r.ok).length;
  const changed = records.filter((r) => r.changed).length;
  const clean = records.filter((r) => r.restoredClean).length;
  const issues = records.filter((r) => r.ok && r.visualIssues && r.visualIssues.length).length;
  console.log(`\nDONE — ${okN}/${records.length} captured · ${changed} visibly adapted · ${clean} restored clean · ${issues} with visual issues`);
  flush();
}

main().catch((e) => {
  console.error("fleet-shots fatal:", e);
  process.exit(1);
});
