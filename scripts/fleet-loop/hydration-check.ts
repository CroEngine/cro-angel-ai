#!/usr/bin/env bun
// Hydreringscertifieringen (ägarens "Kör" 2026-08-13 — sista biten av
// "kommer det fungera felfritt live?"): riktiga sajter ritar om sin DOM
// efter laddning (React/Vue-hydrering, klient-re-render) och kan skriva
// över våra applicerade ändringar. Harnessen kör HELA riktiga pipelinen —
// snippet-boot → decide-svar (routat) → apply → överlevnadstimers — och
// angriper sedan DOM:en som ett framework gör, i två verkliga lägen:
//
//   A. REMOUNT: hela body ersätts med originalmarkupen (klient-re-render
//      efter hydration-mismatch) — noder återskapas, markörer försvinner.
//      Förväntat: överlevnadskollen ser residue 0 och återapplicerar.
//   B. RECONCILE: noderna ÅTERANVÄNDS (Reacts reconciliation) — sektionen
//      flyttas tillbaka till sin ursprungsplats med attributen bevarade.
//      Kodläsning förutsäger HÅLET: residue > 0 ⇒ ingen återapplicering,
//      och applyVariants toppvakt ("markör finns ⇒ applicerad") hävdar
//      varianten fast baslinjen står på skärmen.
//
// Ärlighetsinvarianten som certifieras, per sajt och läge:
//   SURVIVED    — ordningen är variantens OCH varianten hävdas.
//   HONEST_SKIP — ordningen är baslinjens OCH applied=[] OCH
//                 variant_apply_skipped spårades (wiped-not-restored).
//   LIE         — ordningen är baslinjens MEN varianten fortfarande hävdas
//                 (mätningen tror på en flytt besökaren aldrig ser).
//
//   bun run scripts/fleet-loop/hydration-check.ts [--sites=calm,casper]
//     [--out=fleet-preview/hydration.json]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const OUT = arg("out") ?? join("fleet-preview", "hydration.json");
const ROOT = "fleet-preview";
const sitesRaw = arg("sites");
if (sitesRaw !== undefined && sitesRaw.split(",").filter(Boolean).length === 0) {
  console.error("[hydration] --sites= är tom — ange namn eller utelämna flaggan");
  process.exit(1);
}
const wanted = sitesRaw?.split(",").filter(Boolean);

interface SiteResult {
  name: string;
  status: string;
  verdict: string | null;
  fallback: string | null;
}
const results = JSON.parse(readFileSync(join(ROOT, "results.json"), "utf8")) as SiteResult[];
const pool = results.filter((r) =>
  wanted ? wanted.includes(r.name) : r.status === "ok" && r.verdict === "verified" && !r.fallback,
);

const snippetSrc = readFileSync("public/adaptive.js", "utf8");

type Mode = "remount" | "reconcile";
type Bucket = "SURVIVED" | "HONEST_SKIP" | "LIE" | "NO_APPLY" | "OTHER";
interface ModeResult {
  bucket: Bucket;
  orderIsVariant: boolean | null;
  claimedApplied: boolean;
  residue: number;
  skipReason: string | null;
  detail: string | null;
}
interface HydrationRow {
  name: string;
  locator: string;
  remount: ModeResult | null;
  reconcile: ModeResult | null;
  error: string | null;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});

/** Överlevnadsfönstren är 1,5 s + 4 s efter apply — mät efter bägge. */
const SURVIVAL_SETTLE_MS = 6_500;

async function runMode(
  html: string,
  ops: unknown[],
  locText: string,
  mode: Mode,
): Promise<ModeResult> {
  const page: Page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const nodeEvents: string[] = [];
  try {
    // Beacons fångas TVÅVÄGS (svelte-fyndet: skip-eventet gick via fetch-
    // vägen, inte sendBeacon — stubben ensam missade det och den ÄRLIGA
    // skippen felklassades som OTHER): sendBeacon-stub i sidan + events-
    // routen fulfillad här med kroppen sparad Node-sidigt.
    await page.route("**/api/adaptive/events", (r) => {
      nodeEvents.push(r.request().postData() ?? "");
      return r.fulfill({ status: 204, body: "" });
    });
    await page.route("**/api/adaptive/decide", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          decisionId: "hyd-1",
          holdout: false,
          adaptations: [],
          variant: { id: "hyd", segmentKey: "google·mobile", ops },
        }),
      }),
    );
    await page.route("**/*", (r) => {
      const u = r.request().url();
      if (u.startsWith("data:")) return r.continue();
      // fallback(), INTE continue(): continue() skickar requesten till
      // riktiga nätet (DNS-fel på harness.invalid) — fallback() låter den
      // falla vidare till decide/events-handlarna som registrerades före.
      if (u.includes("/api/adaptive/decide") || u.includes("/api/adaptive/events"))
        return r.fallback();
      return r.abort();
    });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Före snippeten: frys originalläget — body-markup för remount-läget,
    // målsektionens (element, nästa-syskon)-par för reconcile-läget, och
    // målrubrikens dokument-topp som baslinjeposition.
    await page.evaluate((loc) => {
      const w = window as unknown as Record<string, unknown>;
      w.__beacons = [];
      navigator.sendBeacon = ((url: string, body?: BodyInit) => {
        try {
          (w.__beacons as unknown[]).push(String(body ?? ""));
        } catch {
          /* aldrig störa värdsidan */
        }
        return true;
      }) as typeof navigator.sendBeacon;
      w.__origBody = document.body.innerHTML;
      const norm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
      const want = norm(loc);
      const els = Array.from(document.querySelectorAll("h1,h2,h3"));
      let hit = els.find((x) => norm(x.textContent) === want);
      if (!hit && want.length >= 8) {
        const needle = want.slice(0, 24);
        hit = els.find((x) => norm(x.textContent).indexOf(needle) !== -1);
      }
      w.__targetTopBaseline = hit ? hit.getBoundingClientRect().top + window.scrollY : null;
    }, locText);

    // Boota riktiga snippeten — decide går genom dess egen fetch.
    await page.evaluate((src) => {
      (window as unknown as Record<string, unknown>).PerformanceObserver = undefined;
      (window as unknown as Record<string, unknown>).__ANGEL_HARNESS__ = true;
      const m = document.createElement("script");
      m.setAttribute("data-site", "reality");
      m.setAttribute("data-endpoint", "https://harness.invalid");
      m.setAttribute("src", "data:text/plain,adaptive.js");
      document.head.appendChild(m);
      (0, eval)(src);
    }, snippetSrc);

    // Vänta tills varianten hävdas applicerad (decide + apply är asynkrona).
    const appliedOk = await page
      .waitForFunction(
        () => {
          const aa = (window as unknown as { AngelAdaptive?: { applied?: unknown[] } })
            .AngelAdaptive;
          return !!aa && Array.isArray(aa.applied) && aa.applied.length > 0;
        },
        undefined,
        { timeout: 12_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!appliedOk) {
      return {
        bucket: "NO_APPLY",
        orderIsVariant: null,
        claimedApplied: false,
        residue: 0,
        skipReason: null,
        detail: "varianten applicerades aldrig (decide/apply nådde inte fram)",
      };
    }

    // Fientlig hydrering.
    await page.evaluate((m) => {
      const w = window as unknown as Record<string, unknown>;
      if (m === "remount") {
        // Klient-re-render: hela trädet återskapas från originalmarkupen —
        // alla markörer och flyttar försvinner i ett svep.
        document.body.innerHTML = String(w.__origBody);
      } else {
        // Reconciliation: noden ÅTERANVÄNDS — flytta tillbaka den till
        // ursprungsplatsen utan att röra attributen (data-angel-moved kvar).
        // Originalpositionen härleds ur den frysta originalmarkupen: hitta
        // motsvarigheten till det flyttade elementet där, ta syskonet som
        // FÖLJDE det, hitta samma syskon i levande DOM och insertBefore.
        const moved = document.querySelector("[data-angel-moved]");
        const parent = moved?.parentElement ?? null;
        if (moved && parent) {
          const key = (el: Element) =>
            (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
          const tpl = document.createElement("template");
          tpl.innerHTML = String(w.__origBody);
          let origEl: Element | null = null;
          for (const el of Array.from(tpl.content.querySelectorAll(moved.tagName))) {
            if (key(el) === key(moved)) {
              origEl = el;
              break;
            }
          }
          const origNext = origEl?.nextElementSibling ?? null;
          if (origNext) {
            let liveNext: Element | null = null;
            for (const el of Array.from(parent.children)) {
              if (el !== moved && el.tagName === origNext.tagName && key(el) === key(origNext)) {
                liveNext = el;
                break;
              }
            }
            if (liveNext) parent.insertBefore(moved, liveNext);
          } else if (origEl) {
            // Originalet låg sist bland sina syskon.
            parent.appendChild(moved);
          }
        }
      }
    }, mode);

    return await finishMeasure(page, locText, nodeEvents);
  } finally {
    await page.close();
  }
}

/** Mät sluttillståndet efter överlevnadsfönstren. */
async function finishMeasure(
  page: Page,
  locText: string,
  nodeEvents: string[],
): Promise<ModeResult> {
  await page.waitForTimeout(SURVIVAL_SETTLE_MS);
  const state = (await page.evaluate((loc) => {
    const w = window as unknown as Record<string, unknown>;
    const norm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const want = norm(loc);
    const els = Array.from(document.querySelectorAll("h1,h2,h3"));
    let hit = els.find((x) => norm(x.textContent) === want);
    if (!hit && want.length >= 8) {
      const needle = want.slice(0, 24);
      hit = els.find((x) => norm(x.textContent).indexOf(needle) !== -1);
    }
    const targetTop = hit ? hit.getBoundingClientRect().top + window.scrollY : null;
    const aa = (w.AngelAdaptive ?? null) as { applied?: unknown[] } | null;
    const beacons = (w.__beacons ?? []) as string[];
    let skipReason: string | null = null;
    for (const b of beacons) {
      try {
        const rows = JSON.parse(b) as { type?: string; payload?: { reason?: string } }[];
        for (const row of Array.isArray(rows) ? rows : []) {
          if (row.type === "variant_apply_skipped") skipReason = row.payload?.reason ?? "?";
        }
      } catch {
        /* icke-JSON-beacon */
      }
    }
    return {
      targetTop,
      baseline: (w.__targetTopBaseline ?? null) as number | null,
      claimedApplied: !!aa && Array.isArray(aa.applied) && aa.applied.length > 0,
      residue: document.querySelectorAll(
        ".angel-revealed,.angel-emphasized,.angel-condensed,[data-angel-injected],[data-angel-moved],[data-angel-retext],[data-angel-inserted]",
      ).length,
      skipReason,
    };
  }, locText)) as {
    targetTop: number | null;
    baseline: number | null;
    claimedApplied: boolean;
    residue: number;
    skipReason: string | null;
  };

  // Skip-eventen kan ha gått via fetch-vägen — slå ihop med Node-fångsten.
  if (!state.skipReason) {
    for (const b of nodeEvents) {
      try {
        const rows = JSON.parse(b) as { type?: string; payload?: { reason?: string } }[];
        for (const row of Array.isArray(rows) ? rows : []) {
          if (row.type === "variant_apply_skipped") state.skipReason = row.payload?.reason ?? "?";
        }
      } catch {
        /* icke-JSON */
      }
    }
  }

  // Ordningen är "variantens" om målet står KLART högre än baslinjen
  // (flyttarna i flottan steg 122–2353 px; 60 px-marginalen slukar brus).
  const orderIsVariant =
    state.targetTop !== null && state.baseline !== null
      ? state.baseline - state.targetTop > 60
      : null;
  let bucket: Bucket;
  if (orderIsVariant === null) bucket = "OTHER";
  else if (orderIsVariant && state.claimedApplied) bucket = "SURVIVED";
  else if (!orderIsVariant && !state.claimedApplied) {
    // Ärlighetsinvarianten är PUBLIKA STATET (applied nollat) — beaconen
    // batchas och kan flusha efter harnessfönstret (svelte-fyndet: track()
    // bevisligen kallad, kroppen låg kvar i bufferten vid mätningen).
    bucket = "HONEST_SKIP";
    if (!state.skipReason) state.skipReason = "(publikt state nollat; beacon efter fönstret)";
  } else if (!orderIsVariant && state.claimedApplied) bucket = "LIE";
  else bucket = "OTHER";
  return {
    bucket,
    orderIsVariant,
    claimedApplied: state.claimedApplied,
    residue: state.residue,
    skipReason: state.skipReason,
    detail: null,
  };
}

const rows: HydrationRow[] = [];
const skipped = new Map<string, number>();
for (const r of pool) {
  const frozenPath = join(ROOT, r.name, "frozen-home.html");
  const reportPath = join(ROOT, r.name, "verify-report.json");
  if (!existsSync(frozenPath) || !existsSync(reportPath)) {
    skipped.set("saknar filer", (skipped.get("saknar filer") ?? 0) + 1);
    continue;
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    serveOps?: { op: string; locator?: { tag?: string; text?: string } }[];
  }[];
  const serveOps = report[0]?.serveOps ?? [];
  const move = serveOps.find((o) => o.op === "move_up");
  if (!move?.locator?.text) {
    skipped.set("ingen flytt-lokator", (skipped.get("ingen flytt-lokator") ?? 0) + 1);
    continue;
  }
  try {
    const html = readFileSync(frozenPath, "utf8").replace(/<script[\s\S]*?<\/script>/gi, "");
    const remount = await runMode(html, serveOps, move.locator.text, "remount");
    const reconcile = await runMode(html, serveOps, move.locator.text, "reconcile");
    rows.push({
      name: r.name,
      locator: move.locator.text.slice(0, 60),
      remount,
      reconcile,
      error: null,
    });
    console.log(
      `[hydration] ${r.name}: remount=${remount.bucket} · reconcile=${reconcile.bucket}` +
        (reconcile.bucket === "LIE" ? " ← baslinje på skärmen, variant hävdad" : ""),
    );
  } catch (e) {
    rows.push({
      name: r.name,
      locator: move.locator.text.slice(0, 60),
      remount: null,
      reconcile: null,
      error: String(e).slice(0, 200),
    });
    console.log(`[hydration] ${r.name}: KRASCH ${String(e).slice(0, 120)}`);
  }
}
await browser.close();

writeFileSync(OUT, JSON.stringify(rows, null, 2));
const ok = rows.filter((x) => !x.error);
const count = (m: Mode, b: Bucket) => ok.filter((x) => x[m]?.bucket === b).length;
console.log(`\n[hydration] ═══ FIENTLIG HYDRERING MOT ${ok.length} SIDOR ═══`);
for (const m of ["remount", "reconcile"] as Mode[]) {
  console.log(
    `  ${m.padEnd(9)}: SURVIVED ${count(m, "SURVIVED")} · HONEST_SKIP ${count(m, "HONEST_SKIP")} · LIE ${count(m, "LIE")} · NO_APPLY ${count(m, "NO_APPLY")} · OTHER ${count(m, "OTHER")}`,
  );
}
for (const [reason, n] of skipped) console.log(`  hoppade: ${reason}: ${n}`);
