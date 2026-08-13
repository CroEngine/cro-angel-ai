#!/usr/bin/env bun
// Verklighetskollen (ägarens fråga 2026-08-12: "hur vet vi om det blir så i
// verkligheten? Med headern osv. Kommer det fungera felfritt eller inte är
// viktigaste frågan"): kör RIKTIGA snippeten (public/adaptive.js — exakt det
// kunder laddar) mot de frysta sidorna med de verifierade serveOps, och mät
// DOM-FAKTA i stället för skärmdumpar:
//
//   1. Applicerar snippeten varianten, eller vägrar den (fail-closed)?
//   2. Är sidhuvudet kvar överst EFTER appliceringen? (Toppbandselementets
//      FINGERAVTRYCK — tagg + barnordning + textprefix — före/efter; ett
//      120-teckens outerHTML-prefix var blint när toppelementet är en
//      jättewrapper vars öppningstagg äter hela prefixet, granskningsfynd.)
//   3. Hur mycket steg målsektionen? (Målsökningen SPEGLAR snippetens
//      findByLocator — gemener + 24-teckens nål-fallback — inte en striktare
//      regel som tyst nullar mätningen, granskningsfynd.)
//
// Bägge live-lägena körs DETERMINISTISKT via paint-timing-stubbar:
//   TIDIG apply — inga paint-entries ⇒ applyGuardActive() false (vakten AV).
//   SEN apply — FCP-post med uråldrig startTime ⇒ vakten PÅ på riktigt
//   (granskningsfynd: utan stubben var "sen" i praktiken samma ovaktade väg).
//
// Skärmdumpar tas vid scrollTop 0 — fullskaletestets "headern flyttad till
// botten" visade sig vara en fullPage-artefakt: position:fixed målas vid
// SKÄRMDUMPSTILLFÄLLETS scrolläge, och verify hit-testar med scrollIntoView
// utan att scrolla tillbaka (measure.ts:271). Denna harness avgör med DOM.
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
// Flaggvakt (granskningsfynd): --sites= (tomt) gav en tom pool i stället för
// default-urvalet — tyst noll-körning som ser ut som ett svar.
const sitesRaw = arg("sites");
if (sitesRaw !== undefined && sitesRaw.split(",").filter(Boolean).length === 0) {
  console.error("[reality] --sites= är tom — ange namn eller utelämna flaggan");
  process.exit(1);
}
const wanted = sitesRaw?.split(",").filter(Boolean);

interface SiteResult {
  name: string;
  status: string;
  verdict: string | null;
  fallback: string | null;
  fakeTraffic: { behaviorFollowed: boolean | null } | null;
}
const results = JSON.parse(readFileSync(join(ROOT, "results.json"), "utf8")) as SiteResult[];
const pool = results.filter((r) =>
  wanted ? wanted.includes(r.name) : r.status === "ok" && r.verdict === "verified" && !r.fallback,
);

const snippetSrc = readFileSync("public/adaptive.js", "utf8");

interface Probe {
  /** Toppbandselementets fingeravtryck (tagg|barn-taggar|textprefix) vid
   *  scroll 0 — headern flyttad ⇒ avtrycket ändras (barnordning/text). */
  topId: string | null;
  targetTop: number | null;
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

async function boot(page: Page, html: string, lateMode: boolean): Promise<void> {
  await page.route("**/*", (r) =>
    r.request().url().startsWith("data:") ? r.continue() : r.abort(),
  );
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate(
    ({ src, late }) => {
      (window as unknown as Record<string, unknown>).PerformanceObserver = undefined;
      (window as unknown as Record<string, unknown>).__ANGEL_HARNESS__ = true;
      // Deterministiska vaktlägen via paint-stubbar: TIDIG = inga entries
      // (ingen FCP ⇒ applyGuardActive false). SEN = uråldrig FCP-post
      // (now > fcp+500 alltid sant ⇒ vakten PÅ) — utan stubben hann aldrig
      // FCP+500 ms passera och "sen" körde i praktiken ovaktat.
      const paint = late ? [{ name: "first-contentful-paint", startTime: -10_000 }] : [];
      performance.getEntriesByType = ((type: string) =>
        type === "paint" ? paint : []) as typeof performance.getEntriesByType;
      const m = document.createElement("script");
      m.setAttribute("data-site", "reality");
      m.setAttribute("data-endpoint", "https://dead.invalid");
      m.setAttribute("src", "data:text/plain,adaptive.js");
      document.head.appendChild(m);
      (0, eval)(src);
    },
    { src: snippetSrc, late: lateMode },
  );
}

const probeFn = `(loc) => {
  window.scrollTo(0, 0);
  let topEl = null;
  let best = Infinity;
  const walk = (root, depth) => {
    for (const el of root.children) {
      const r = el.getBoundingClientRect();
      if (r.height >= 20 && r.top <= 60 && r.bottom >= 0 && r.top < best) {
        best = r.top;
        topEl = el;
      }
      if (depth < 2 && r.height >= 20) walk(el, depth + 1);
    }
  };
  walk(document.body, 0);
  const fingerprint = (el) =>
    el.tagName +
    "|" +
    Array.from(el.children).slice(0, 4).map((c) => c.tagName).join(",") +
    "|" +
    (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40);
  // Målsökningen SPEGLAR snippetens findByLocator: normaliserat gemener,
  // exakt träff först, därefter 24-teckens nål-substring — och taggen från
  // lokatorn (default h1,h2,h3), inte hårdkodad h2.
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();
  let targetTop = null;
  if (loc && loc.text) {
    const want = norm(loc.text);
    const els = [...document.querySelectorAll(loc.tag || "h1,h2,h3")];
    let hit = els.find((x) => norm(x.textContent) === want);
    if (!hit && want.length >= 8) {
      const needle = want.slice(0, 24);
      hit = els.find((x) => norm(x.textContent).indexOf(needle) !== -1);
    }
    if (hit) targetTop = hit.getBoundingClientRect().top + window.scrollY;
  }
  return { topId: topEl ? fingerprint(topEl) : null, targetTop };
}`;

async function runMode(
  html: string,
  ops: unknown[],
  loc: { tag?: string; text: string },
  lateMode: boolean,
  shotPath: string | null,
): Promise<ModeOutcome> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await boot(page, html, lateMode);
    const before = (await page.evaluate(`(${probeFn})(${JSON.stringify(loc)})`)) as Probe;
    const applied = (await page.evaluate(
      (v) =>
        (
          window as unknown as {
            __angel: { apply: (d: unknown) => string[] };
          }
        ).__angel.apply({ adaptations: [], variant: v }),
      { id: "reality", segmentKey: "google·mobile", ops },
    )) as string[];
    const after = (await page.evaluate(`(${probeFn})(${JSON.stringify(loc)})`)) as Probe;
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
const skipped = new Map<string, number>();
const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
for (const r of pool) {
  const frozenPath = join(ROOT, r.name, "frozen-home.html");
  const reportPath = join(ROOT, r.name, "verify-report.json");
  if (!existsSync(frozenPath) || !existsSync(reportPath)) {
    skip("saknar frozen/verify-report");
    continue;
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    serveOps?: { op: string; locator?: { tag?: string; text?: string }; value?: string }[];
  }[];
  const serveOps = report[0]?.serveOps ?? [];
  const move = serveOps.find((o) => o.op === "move_up");
  if (serveOps.length === 0) {
    skip("inga serveOps");
    continue;
  }
  if (!move?.locator?.text) {
    skip("ingen move_up-lokator (t.ex. ren insert/retext-plan)");
    continue;
  }
  const html = readFileSync(frozenPath, "utf8").replace(/<script[\s\S]*?<\/script>/gi, "");
  const loc = { tag: move.locator.tag, text: move.locator.text };
  try {
    const early = await runMode(
      html,
      serveOps,
      loc,
      false,
      SHOTS.has(r.name) ? join(ROOT, r.name, "reality-early-top.jpg") : null,
    );
    const late = await runMode(html, serveOps, loc, true, null);
    rows.push({ name: r.name, locator: loc.text.slice(0, 60), early, late, error: null });
    const h = (m: ModeOutcome) =>
      m.headerIntact === null ? "OKÄND" : m.headerIntact ? "KVAR" : "FLYTTAD";
    console.log(
      `[reality] ${r.name}: tidig ${early.applied ? "APPLICERAD" : "VÄGRAD"}` +
        ` header=${h(early)} steg=${early.sectionRosePx ?? "–"}px` +
        ` · sen ${late.applied ? "APPLICERAD" : "VÄGRAD"} header=${h(late)}`,
    );
  } catch (e) {
    const none: ModeOutcome = {
      applied: false,
      headerIntact: null,
      sectionRosePx: null,
      topBefore: null,
      topAfter: null,
    };
    rows.push({
      name: r.name,
      locator: loc.text.slice(0, 60),
      early: none,
      late: none,
      error: String(e).slice(0, 200),
    });
    console.log(`[reality] ${r.name}: KRASCH ${String(e).slice(0, 120)}`);
  }
}
await browser.close();

writeFileSync(OUT, JSON.stringify(rows, null, 2));
const ok = rows.filter((x) => !x.error);
const earlyApplied = ok.filter((x) => x.early.applied);
// Tre hinkar — OKÄND räknas ALDRIG som "kvar" (granskningsfynd: null:ar i
// numeratorn gjorde 18 kända + 3 okända till "21/21 kvar").
const headerKept = earlyApplied.filter((x) => x.early.headerIntact === true);
const headerMoved = earlyApplied.filter((x) => x.early.headerIntact === false);
const headerUnknown = earlyApplied.filter((x) => x.early.headerIntact === null);
const rose = earlyApplied.filter((x) => (x.early.sectionRosePx ?? 0) > 0);
const roseUnknown = earlyApplied.filter((x) => x.early.sectionRosePx === null);
console.log(`\n[reality] ═══ RIKTIGA SNIPPETEN MOT ${ok.length} FRYSTA SIDOR ═══`);
console.log(`  tidig apply applicerad : ${earlyApplied.length}/${ok.length}`);
console.log(
  `  headern kvar överst    : ${headerKept.length} kvar · ${headerMoved.length} flyttade · ${headerUnknown.length} okända (${headerUnknown.map((x) => x.name).join(", ") || "–"})${headerMoved.length ? ` — FLYTTADE: ${headerMoved.map((x) => x.name).join(", ")}` : ""}`,
);
console.log(
  `  sektionen steg (>0 px) : ${rose.length}/${earlyApplied.length}${roseUnknown.length ? ` · ${roseUnknown.length} omätbara (${roseUnknown.map((x) => x.name).join(", ")})` : ""}`,
);
console.log(
  `  sen apply (vakt PÅ)    : ${ok.filter((x) => x.late.applied).length}/${ok.length} applicerade`,
);
for (const [reason, n] of skipped) console.log(`  hoppade: ${reason}: ${n}`);
if (skipped.size === 0 && pool.length !== rows.length) {
  console.log(`  OBS: ${pool.length - rows.length} sajter föll bort oväntat`);
}
