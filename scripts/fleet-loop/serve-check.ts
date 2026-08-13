#!/usr/bin/env bun
// Verklighetskollen (ägarens fråga 2026-08-12: "hur vet vi om det blir så i
// verkligheten? Med headern osv. Kommer det fungera felfritt eller inte är
// viktigaste frågan"): kör RIKTIGA snippeten (public/adaptive.js — exakt det
// kunder laddar) mot de frysta sidorna med de verifierade serveOps, och mät
// DOM-FAKTA i stället för skärmdumpar:
//
//   1. Applicerar snippeten varianten, eller vägrar den (fail-closed)?
//   2. Är sidhuvudet kvar överst EFTER appliceringen? (Mäts som elementet i
//      toppbandet vid scroll 0 — före och efter måste vara SAMMA element.)
//   3. Hur mycket steg målsektionen? (rect.top före/efter, dokumentkoordinat.)
//
// Bägge live-lägena körs: TIDIG apply (före FCP+500 ms — flimmervakten AV,
// paint-timing stubbas bort) och SEN apply (flimmervakten PÅ som efter #207).
// Skärmdumpar tas vid scrollTop 0 — fullskaletestets "headern flyttad till
// botten" visade sig vara en misstänkt fullPage-artefakt: position:fixed
// målas vid SKÄRMDUMPSTILLFÄLLETS scrolläge, och verify hit-testar med
// scrollIntoView utan att scrolla tillbaka (measure.ts:271). Denna harness
// avgör frågan med DOM-sanning.
//
//   bun run scripts/fleet-loop/serve-check.ts [--sites=calm,casper]
//     [--shots=calm,casper] [--out=fleet-preview/reality.json]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const OUT = arg("out") ?? join("fleet-preview", "reality.json");
const ROOT = "fleet-preview";
const SHOTS = new Set((arg("shots") ?? "calm,casper").split(",").filter(Boolean));

interface SiteResult {
  name: string;
  status: string;
  verdict: string | null;
  fallback: string | null;
  fakeTraffic: { behaviorFollowed: boolean | null } | null;
}
const results = JSON.parse(readFileSync(join(ROOT, "results.json"), "utf8")) as SiteResult[];
const wanted = arg("sites")?.split(",").filter(Boolean);
const pool = results.filter((r) =>
  wanted
    ? wanted.includes(r.name)
    : r.status === "ok" && r.verdict === "verified" && !r.fallback,
);

const snippetSrc = readFileSync("public/adaptive.js", "utf8");

interface Probe {
  /** Elementet i toppbandet (y 0–60, höjd ≥20) vid scroll 0 — identitet via
   *  outerHTML-prefix; headern flyttad ⇒ ett ANNAT element i bandet. */
  topId: string | null;
  targetTop: number | null;
  bodyChildren: number;
}
interface ModeOutcome {
  applied: boolean;
  headerIntact: boolean | null;
  sectionRosePx: number | null;
  topBefore: string | null;
  topAfter: string | null;
}
interface RealityRow {
  name: string;
  locator: string;
  early: ModeOutcome;
  late: ModeOutcome;
  error: string | null;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});

async function boot(page: Page, html: string, stubPaint: boolean): Promise<void> {
  await page.route("**/*", (r) =>
    r.request().url().startsWith("data:") ? r.continue() : r.abort(),
  );
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate(
    ({ src, stub }) => {
      (window as unknown as Record<string, unknown>).PerformanceObserver = undefined;
      (window as unknown as Record<string, unknown>).__ANGEL_HARNESS__ = true;
      if (stub) {
        // TIDIG apply: före första målningen finns ingen FCP-post — då är
        // flimmervakten av (applyGuardActive ⇒ false), exakt som live.
        performance.getEntriesByType = () => [];
      }
      const m = document.createElement("script");
      m.setAttribute("data-site", "reality");
      m.setAttribute("data-endpoint", "https://dead.invalid");
      m.setAttribute("src", "data:text/plain,adaptive.js");
      document.head.appendChild(m);
      (0, eval)(src);
    },
    { src: snippetSrc, stub: stubPaint },
  );
}

const probeFn = `(locText) => {
  window.scrollTo(0, 0);
  let topId = null;
  let best = Infinity;
  const walk = (root, depth) => {
    for (const el of root.children) {
      const r = el.getBoundingClientRect();
      if (r.height >= 20 && r.top <= 60 && r.bottom >= 0 && r.top < best) {
        best = r.top;
        topId = el.outerHTML.slice(0, 120);
      }
      if (depth < 2 && r.height >= 20) walk(el, depth + 1);
    }
  };
  walk(document.body, 0);
  let targetTop = null;
  if (locText) {
    const h = [...document.querySelectorAll("h2")].find(
      (x) => (x.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120) === locText,
    );
    if (h) targetTop = h.getBoundingClientRect().top + window.scrollY;
  }
  return { topId, targetTop, bodyChildren: document.body.children.length };
}`;

async function runMode(
  html: string,
  ops: unknown[],
  locText: string,
  early: boolean,
  shotPath: string | null,
): Promise<ModeOutcome> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await boot(page, html, early);
    const before = (await page.evaluate(`(${probeFn})(${JSON.stringify(locText)})`)) as Probe;
    const applied = (await page.evaluate(
      (v) =>
        (
          window as unknown as {
            __angel: { apply: (d: unknown) => string[] };
          }
        ).__angel.apply({ adaptations: [], variant: v }),
      { id: "reality", segmentKey: "google·mobile", ops },
    )) as string[];
    const after = (await page.evaluate(`(${probeFn})(${JSON.stringify(locText)})`)) as Probe;
    if (shotPath) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: shotPath, type: "jpeg", quality: 60 });
    }
    return {
      applied: applied.some((a) => String(a).startsWith("variant:")),
      headerIntact:
        before.topId !== null && after.topId !== null ? before.topId === after.topId : null,
      sectionRosePx:
        before.targetTop !== null && after.targetTop !== null
          ? Math.round(before.targetTop - after.targetTop)
          : null,
      topBefore: before.topId?.slice(0, 60) ?? null,
      topAfter: after.topId?.slice(0, 60) ?? null,
    };
  } finally {
    await page.close();
  }
}

const rows: RealityRow[] = [];
for (const r of pool) {
  const frozenPath = join(ROOT, r.name, "frozen-home.html");
  const reportPath = join(ROOT, r.name, "verify-report.json");
  if (!existsSync(frozenPath) || !existsSync(reportPath)) continue;
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    serveOps?: { op: string; locator?: { tag?: string; text?: string }; value?: string }[];
  }[];
  const serveOps = report[0]?.serveOps ?? [];
  const move = serveOps.find((o) => o.op === "move_up");
  if (serveOps.length === 0 || !move?.locator?.text) continue;
  const html = readFileSync(frozenPath, "utf8").replace(/<script[\s\S]*?<\/script>/gi, "");
  const locText = move.locator.text;
  try {
    const early = await runMode(
      html,
      serveOps,
      locText,
      true,
      SHOTS.has(r.name) ? join(ROOT, r.name, "reality-early-top.jpg") : null,
    );
    const late = await runMode(html, serveOps, locText, false, null);
    rows.push({ name: r.name, locator: locText.slice(0, 60), early, late, error: null });
    console.log(
      `[reality] ${r.name}: tidig ${early.applied ? "APPLICERAD" : "VÄGRAD"}` +
        ` header=${early.headerIntact === null ? "?" : early.headerIntact ? "KVAR" : "FLYTTAD"}` +
        ` steg=${early.sectionRosePx ?? "–"}px · sen ${late.applied ? "APPLICERAD" : "VÄGRAD"}`,
    );
  } catch (e) {
    rows.push({
      name: r.name,
      locator: locText.slice(0, 60),
      early: { applied: false, headerIntact: null, sectionRosePx: null, topBefore: null, topAfter: null },
      late: { applied: false, headerIntact: null, sectionRosePx: null, topBefore: null, topAfter: null },
      error: String(e).slice(0, 200),
    });
    console.log(`[reality] ${r.name}: KRASCH ${String(e).slice(0, 120)}`);
  }
}
await browser.close();

writeFileSync(OUT, JSON.stringify(rows, null, 2));
const ok = rows.filter((x) => !x.error);
const earlyApplied = ok.filter((x) => x.early.applied);
const headerMoved = ok.filter((x) => x.early.applied && x.early.headerIntact === false);
const rose = ok.filter((x) => x.early.applied && (x.early.sectionRosePx ?? 0) > 0);
console.log(`\n[reality] ═══ RIKTIGA SNIPPETEN MOT ${ok.length} FRYSTA SIDOR ═══`);
console.log(`  tidig apply applicerad : ${earlyApplied.length}/${ok.length}`);
console.log(`  headern kvar överst    : ${earlyApplied.length - headerMoved.length}/${earlyApplied.length}${headerMoved.length ? ` — FLYTTAD: ${headerMoved.map((x) => x.name).join(", ")}` : ""}`);
console.log(`  sektionen steg (>0 px) : ${rose.length}/${earlyApplied.length}`);
console.log(`  sen apply applicerad   : ${ok.filter((x) => x.late.applied).length}/${ok.length} (flimmervakten på)`);
