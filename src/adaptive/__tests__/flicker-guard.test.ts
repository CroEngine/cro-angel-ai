// Flimmervakten ände-till-ände: den RIKTIGA kundsnippeten i riktig Chromium.
// Mätningen som drev regeln (2026-08-09): den sena omförsöks-slingan flyttade
// en sektion besökaren scrollat till 1,7–9,3 s in i läsningen — layoutskift
// 0,34 mot kontrollarmens 0. Kontraktet som bevisas här:
//   1. NÅDFÖNSTRET: en snabb applicering (≤500 ms efter första målningen) är
//      dagens beteende, även i besökarens synfält.
//   2. GLUTENFORUM-FALLET BESTÅR: sen hydrering under folden appliceras —
//      osynligt — och den sena vägen uppdaterar publika state + angel:applied
//      (buggfixen: debug-panelen sa "No adaptations" på en adapterad sida).
//   3. VAKTEN: står besökaren i regionen appliceras INGET medan den syns;
//      lämnar regionen viewporten appliceras flytten osynligt.
//   4. ÄRLIGHETEN: löper fönstret ut oapplicerat skickas variant_apply_skipped
//      med reason som skiljer vaktens nej från mål-som-aldrig-fanns.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser | null = null;
let chromiumAvailable = false;
const SNIPPET = readFileSync("public/adaptive.js", "utf8");

beforeAll(async () => {
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    browser = await chromium.launch({ headless: true, executablePath });
    chromiumAvailable = true;
  } catch {
    chromiumAvailable = false;
  }
});

afterAll(async () => {
  await browser?.close();
});

const ORIGIN = "https://angel-flicker.test";
const TARGET = "Bevis som ska lyftas";

/** Hjälte + sektioner i wrapper-mönstret (sektionsupplösningens normalform).
 *  hydrateAt > 0 ⇒ målsektionen saknas vid first paint och injiceras senare —
 *  klientrenderings-klassen som omförsöks-slingan finns för. */
function pageHtml(hydrateAt: number): string {
  const target = `<section class="tall"><h2>${TARGET}</h2><p>${"Bevis. ".repeat(40)}</p></section>`;
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><style>
    body{margin:0;font:16px/1.6 system-ui}
    section,.hero{padding:24px 16px;border-bottom:1px solid #eee}
    /* Hög sida: destinationssektionen ("Vanliga frågor", flyttens landningsplats)
       måste börja NEDANFÖR 844-viewporten — annars dömer vakten (korrekt) att
       flytten syns, och testet mäter fel sak. */
    .hero{min-height:520px}
    .tall{min-height:700px}
    h1{font-size:30px;margin:0 0 8px}h2{font-size:21px;margin:0 0 8px}
  </style></head><body><main><div class="page">
    <div class="hero"><h1>Rubrik som syns direkt</h1><p>${"Hjältetext. ".repeat(20)}</p></div>
    <div class="wrapper">
      <section class="tall"><h2>Så fungerar det</h2><p>${"Brödtext. ".repeat(50)}</p></section>
      <section class="tall"><h2>Vanliga frågor</h2><p>${"Brödtext. ".repeat(50)}</p></section>
      ${hydrateAt === 0 ? target : ""}
    </div>
  </div></main>
  ${
    hydrateAt > 0
      ? `<script>setTimeout(function(){
           var w=document.querySelector(".wrapper");
           var t=document.createElement("template");
           t.innerHTML=${JSON.stringify(target)};
           w.appendChild(t.content.firstChild);
         }, ${hydrateAt});</script>`
      : ""
  }
  <script src="${ORIGIN}/adaptive.js" data-site="e2e" data-consent="granted"></script>
  </body></html>`;
}

interface Marks {
  fcp: number | null;
  shifts: { t: number; value: number }[];
  appliedEvents: { t: number; n: number }[];
}

async function boot(
  page: Page,
  opts: { hydrateAt: number; decideDelayMs: number; targetText?: string; debug?: boolean },
): Promise<{ bodies: () => unknown[] }> {
  const captured: unknown[] = [];
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__ANGEL_HARNESS__ = true;
    try {
      Object.defineProperty(navigator, "sendBeacon", { value: undefined });
    } catch {
      /* ignorera */
    }
    const m: Marks = { fcp: null, shifts: [], appliedEvents: [] };
    w.__marks = m;
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries())
          if (e.name === "first-contentful-paint" && m.fcp === null) m.fcp = e.startTime;
      }).observe({ type: "paint", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          const s = e as unknown as { value: number; hadRecentInput: boolean };
          if (!s.hadRecentInput) m.shifts.push({ t: e.startTime, value: s.value });
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      /* ignorera */
    }
    document.addEventListener("angel:applied", () => {
      const a = (w.AngelAdaptive as { applied?: unknown[] } | undefined)?.applied;
      m.appliedEvents.push({ t: performance.now(), n: Array.isArray(a) ? a.length : -1 });
    });
  });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = route.request().url();
    if (url === `${ORIGIN}/page` || url === `${ORIGIN}/page?angel_debug=1`) {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: pageHtml(opts.hydrateAt),
      });
    }
    if (url.endsWith("/adaptive.js")) {
      return route.fulfill({ contentType: "application/javascript", body: SNIPPET });
    }
    if (url.includes("/api/adaptive/events")) {
      try {
        captured.push(JSON.parse(route.request().postData() || "{}"));
      } catch {
        captured.push({ parseError: true });
      }
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.includes("/api/adaptive/consent-config")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ mode: "anonymous", holdoutPct: 0, conversion: {} }),
      });
    }
    if (url.includes("/api/adaptive/decide")) {
      await new Promise((r) => setTimeout(r, opts.decideDelayMs));
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          decisionId: "dec-flicker",
          site: "e2e",
          adaptations: [],
          holdout: false,
          variant: {
            id: "var-flicker",
            segmentKey: "google·mobile",
            ops: [
              {
                op: "move_up",
                locator: { tag: "h2", text: opts.targetText ?? TARGET },
                why: "flimmertest",
              },
            ],
          },
          context: {},
        }),
      });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto(`${ORIGIN}/page${opts.debug ? "?angel_debug=1" : ""}`, { waitUntil: "load" });
  return { bodies: () => captured };
}

const marks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __marks: Marks }).__marks);
const isMoved = (page: Page) =>
  page.evaluate(() => !!document.querySelector("[data-angel-moved]"));
type EventsBody = { events?: { type: string; payload?: Record<string, unknown> }[] };
const allEvents = (bodies: unknown[]) =>
  bodies.flatMap((b) => ((b as EventsBody).events ?? []).map((e) => e));
/** Layoutskift som sker EFTER nådfönstret — de besökaren upplever som flimmer. */
const lateShifts = (m: Marks) =>
  m.shifts.filter((s) => s.t > (m.fcp ?? 0) + 600 && s.value >= 0.01);

describe("flimmervakten (riktig chromium, riktig snippet)", () => {
  it("nådfönstret: snabb applicering är dagens beteende — även i synfältet", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } });
    try {
      // Målet finns från start; decide svarar snabbt ⇒ appliceringen landar
      // inom nådfönstret och släpps ovaktad (uppmätt CLS 0,06 < "bra"-gränsen).
      await boot(page, { hydrateAt: 0, decideDelayMs: 40 });
      await page.waitForTimeout(1200);
      expect(await isMoved(page)).toBe(true);
      const m = await marks(page);
      expect(m.appliedEvents.some((a) => a.n > 0)).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("glutenforum-fallet består: sen hydrering under folden appliceras osynligt — och sena vägen syns i state + event", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } });
    try {
      // Sektionen hydreras 1,5 s in; besökaren står kvar på toppen. Regionen
      // ligger under folden ⇒ vakten släpper ⇒ varianten landar (utspädningen
      // slingan finns för uppstår aldrig) — utan ett enda synligt skift.
      const { bodies } = await boot(page, { hydrateAt: 1500, decideDelayMs: 60, debug: true });
      await page.waitForTimeout(4000);
      expect(await isMoved(page)).toBe(true);
      const m = await marks(page);
      // Buggfixen: den SENA appliceringen speglas i publika state + eventet.
      expect(m.appliedEvents.some((a) => a.n > 0)).toBe(true);
      const applied = await page.evaluate(
        () =>
          (window as unknown as { AngelAdaptive: { applied: unknown[] } }).AngelAdaptive.applied,
      );
      expect(applied.length).toBeGreaterThan(0);
      // Osynligt: inga layoutskift efter nådfönstret.
      expect(lateShifts(m)).toEqual([]);
      // Och ingen skip-logg — varianten LANDADE.
      expect(allEvents(bodies()).filter((e) => e.type === "variant_apply_skipped")).toEqual([]);
      // Debug-panelen: sena omritningen ersätter — EN panel, aldrig staplade.
      expect(await page.evaluate(() => document.querySelectorAll("#angel-debug").length)).toBe(1);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("vakten: inget rörs medan besökaren ser regionen — flytten sker när den lämnat vyn", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } });
    try {
      const { bodies } = await boot(page, { hydrateAt: 1200, decideDelayMs: 60 });
      // Besökaren läser sig ned till sektionsregionen INNAN hydreringen slår.
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // Hydrering vid 1,2 s + flera omförsöks-tick medan regionen är i vyn.
      await page.waitForTimeout(2600);
      expect(await isMoved(page)).toBe(false); // vakten höll — mitt i läsningen
      // Besökaren scrollar tillbaka till toppen ⇒ regionen är under folden ⇒
      // nästa tick (≤400 ms) applicerar osynligt.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(1200);
      expect(await isMoved(page)).toBe(true);
      const m = await marks(page);
      expect(lateShifts(m)).toEqual([]); // aldrig ett synligt skift
      expect(allEvents(bodies()).filter((e) => e.type === "variant_apply_skipped")).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("ärligheten, vaktens nej: parkerad besökare hela fönstret ⇒ skipped(viewport-guard), sidan orörd", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } });
    try {
      const { bodies } = await boot(page, { hydrateAt: 1200, decideDelayMs: 60 });
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // Hela omförsöks-fönstret (400 ms × 30 ≈ 12 s) med regionen i vyn.
      await page.waitForTimeout(14_000);
      expect(await isMoved(page)).toBe(false);
      const skips = allEvents(bodies()).filter((e) => e.type === "variant_apply_skipped");
      expect(skips).toHaveLength(1);
      expect(skips[0].payload?.reason).toBe("viewport-guard");
      expect(skips[0].payload?.variantId).toBe("var-flicker");
      const m = await marks(page);
      expect(lateShifts(m)).toEqual([]); // orörd sida flimrar per definition inte
    } finally {
      await page.close();
    }
  }, 40_000);

  it("ärligheten, mål som aldrig fanns ⇒ skipped(targets-missing)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } });
    try {
      const { bodies } = await boot(page, {
        hydrateAt: 0,
        decideDelayMs: 60,
        targetText: "Rubrik som inte existerar någonstans",
      });
      await page.waitForTimeout(14_000);
      expect(await isMoved(page)).toBe(false);
      const skips = allEvents(bodies()).filter((e) => e.type === "variant_apply_skipped");
      expect(skips).toHaveLength(1);
      expect(skips[0].payload?.reason).toBe("targets-missing");
    } finally {
      await page.close();
    }
  }, 40_000);
  it("wipe-ärligheten: applicerad → framework-wipe → blockerad återapplicering ⇒ skipped, aldrig tyst", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } });
    try {
      const { bodies } = await boot(page, { hydrateAt: 0, decideDelayMs: 40 });
      await page.waitForTimeout(900);
      expect(await isMoved(page)).toBe(true); // fast-vägen landade (nåden)
      // Besökaren läser sig ned till regionen; frameworket renderar om main
      // (wipe — vår residue försvinner) vid ~2,5 s.
      await page.evaluate(() => {
        (window as unknown as { __orig: string }).__orig =
          document.querySelector("main")!.innerHTML;
      });
      // Vänta ut kvarvarande överlevnadsförsök? Nej — wipe:a FÖRE 4s-försöket.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1800); // ~2,7 s in: efter 1,5s-försöket
      await page.evaluate(() => {
        const m = document.querySelector("main")!;
        m.innerHTML = (window as unknown as { __orig: string }).__orig.replace(
          / data-angel-moved=""/g,
          "",
        );
        // återställ ursprungsordningen: flytta tillbaka målsektionen sist
        const secs = m.querySelectorAll(".wrapper > section");
        m.querySelector(".wrapper")!.appendChild(secs[0]);
      });
      // 4s-försöket: regionen är i vyn (besökaren står där) ⇒ vakten blockerar
      // ⇒ SISTA försöket loggar skipped i stället för att tiga.
      await page.waitForTimeout(2600);
      expect(await isMoved(page)).toBe(false);
      const skips = allEvents(bodies()).filter((e) => e.type === "variant_apply_skipped");
      expect(skips).toHaveLength(1);
      expect(["viewport-guard", "wiped-not-restored"]).toContain(skips[0].payload?.reason);
      // Publika statet ljuger inte: efter wipe:n hävdar applied inte längre
      // en variant som inte står på skärmen (granskningsfynd 2026-08-10).
      const publicApplied = await page.evaluate(
        () =>
          (window as unknown as { AngelAdaptive: { applied: string[] } }).AngelAdaptive.applied,
      );
      expect(publicApplied).toEqual([]);
      const m = await marks(page);
      // Vår väg orsakade inga sena skift (wipe:n är sidans egen handling).
      expect(lateShifts(m).filter((s) => s.t > 2500)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);
});
