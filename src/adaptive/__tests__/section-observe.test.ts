// Steg 9 ände-till-ände: den RIKTIGA kundsnippeten (public/adaptive.js) i
// riktig Chromium — inte en modul-omkompilering. Bevisar tre saker:
//   1. OPT-IN: med data-observe-sections skickas EN section_engagement vid
//      pagehide, rubrik-keyad + instansräknad enligt rollupens kontrakt.
//   2. Synlighetsandelen är riktig: sedd sektion får d > 0, aldrig-scrollad
//      sektion får d = 0 (IntersectionObserver-vägen, inte en stub).
//   3. REVERSIBELT: utan attributet skickas ingen section_engagement alls —
//      exakt dagens snippet (ägarlöftet "av = som förut").
// Samma probe/skip-mönster som applier.test.ts; CI har chromium.
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

const ORIGIN = "https://angel-e2e.test";

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><h2>Header heading — aldrig i censusen</h2></header>
<main>
  <h1>Build faster with Acme</h1>
  <div style="height:200px">intro</div>
  <h2>Simple honest pricing</h2>
  <div style="height:300px">pricing body</div>
  <h2>Loved by teams</h2>
  <div style="height:2600px">tall spacer — nästa rubrik kräver scroll</div>
  <h2>Never scrolled into view</h2>
  <div style="height:900px">bottom body</div>
</main>
<footer><h2>Footer heading — aldrig i censusen</h2></footer>
<script src="${ORIGIN}/adaptive.js" data-site="e2e" data-consent="granted" DATA_ATTR_SLOT></script>
</body></html>`;

/** Boot the real snippet on a routed origin; capture every events-POST body.
 *  Dokumentet SERVERAS via routen (goto → riktig navigation) — goto-följt-av-
 *  setContent racear ("Execution context was destroyed"). */
async function boot(
  page: Page,
  observeAttr: string,
  htmlOverride?: string,
  /** Svar från /api/adaptive/decide. Utelämnat ⇒ 500 (snippetens catch-väg,
   *  sidan orörd). Sätts för att köra laddningen som en VARIANT-arm. */
  decideBody?: Record<string, unknown>,
  /** Svar från /api/adaptive/consent-config. Utelämnat ⇒ dagens default
   *  (anonymt, ingen sektionsobservation). */
  configBody?: Record<string, unknown>,
): Promise<{ bodies: () => unknown[] }> {
  const captured: unknown[] = [];
  const html = (htmlOverride ?? PAGE_HTML).replace(
    "DATA_ATTR_SLOT",
    observeAttr ? `data-observe-sections="${observeAttr}"` : "",
  );
  // sendBeacon är svår-interceptad i vissa miljöer — tvinga fetch-fallbacken
  // (snippetens egen reservväg), som page.route fångar tillförlitligt. Och
  // harness-flaggan: snippetens bot-vakt (navigator.webdriver) avbryter annars
  // hela IIFE:n i headless — luckan finns exakt för testharness.
  await page.addInitScript(() => {
    (window as unknown as { __ANGEL_HARNESS__: boolean }).__ANGEL_HARNESS__ = true;
    try {
      Object.defineProperty(navigator, "sendBeacon", { value: undefined });
    } catch {
      /* ignore */
    }
  });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = route.request().url();
    if (url === `${ORIGIN}/page`) {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
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
        body: JSON.stringify(
          configBody ?? { mode: "anonymous", holdoutPct: 0, conversion: {} },
        ),
      });
    }
    if (decideBody && url.includes("/api/adaptive/decide")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(decideBody),
      });
    }
    // decide m.fl. — snippetens catch-vägar tål 500 (wireJourney körs ändå).
    return route.fulfill({ status: 500, body: "" });
  });
  await page.goto(`${ORIGIN}/page`, { waitUntil: "load" });
  return { bodies: () => captured };
}

async function settle(page: Page, ms: number): Promise<void> {
  await page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);
}

type EventsBody = { events?: { type: string; payload?: Record<string, unknown> }[] };
const allEvents = (bodies: unknown[]) =>
  bodies.flatMap((b) => ((b as EventsBody).events ?? []).map((e) => e));

describe("snippetens per-sektion-synlighet (steg 9, riktig chromium)", () => {
  it("SAJTKONFIGEN kan slå på observationen utan taggattribut — och taggen vinner alltid", async (ctx) => {
    // Steg 1 i uppföljningsplanen: observationen ska gå att slå på (och av)
    // från vår sida, utan en release på kundens sajt. Kontraktet är samma som
    // hold-out/konverteringsmål: taggen är en explicit per-install-override.
    if (!chromiumAvailable) return ctx.skip();

    // (a) Ingen tagg + konfig på ⇒ censusen körs.
    const onPage = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const { bodies } = await boot(onPage, "", undefined, undefined, {
        mode: "anonymous",
        holdoutPct: 0,
        conversion: {},
        observeSections: true,
      });
      await settle(onPage, 1300);
      await onPage.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(onPage, 300);
      const sec = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(sec).toHaveLength(1);
      expect(Array.isArray(sec[0].payload?.sections)).toBe(true);
    } finally {
      await onPage.close();
    }

    // (b) Tagg "0" + konfig på ⇒ AVSTÄNGD. Ett install som uttryckligen sagt
    //     nej får aldrig slås på av en dashboard-flagga.
    const offPage = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const { bodies } = await boot(offPage, "0", undefined, undefined, {
        mode: "anonymous",
        holdoutPct: 0,
        conversion: {},
        observeSections: true,
      });
      await settle(offPage, 1300);
      await offPage.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(offPage, 300);
      expect(allEvents(bodies()).filter((e) => e.type === "section_engagement")).toHaveLength(0);
    } finally {
      await offPage.close();
    }

    // (c) Konfig AV (default) och ingen tagg ⇒ exakt dagens snippet.
    const defPage = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const { bodies } = await boot(defPage, "", undefined, undefined, {
        mode: "anonymous",
        holdoutPct: 0,
        conversion: {},
        observeSections: false,
      });
      await settle(defPage, 1300);
      await defPage.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(defPage, 300);
      expect(allEvents(bodies()).filter((e) => e.type === "section_engagement")).toHaveLength(0);
    } finally {
      await defPage.close();
    }
  });

  it("ARM-MARKÖREN: orörd laddning stämplas 0, variant-arm stämplas 1", async (ctx) => {
    // Steg 11-stängslets grund: läsvägen kan bara skilja vår EGEN omflyttning
    // från besökarnas beteende om censusen bär armen PER LADDNING. Utan den
    // fanns bara decisionId, som är en kontext-hash delad av båda armarna.
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      // decide faller (500) ⇒ sidan är orörd ⇒ 0.
      const { bodies } = await boot(page, "1");
      await settle(page, 1300);
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(page, 300);
      const plain = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(plain).toHaveLength(1);
      expect(plain[0].payload?.adapted).toBe(0);
    } finally {
      await page.close();
    }

    const armed = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      // En BESLUTAD variant i variant-armen ⇒ 1, även om ops-listan är tom och
      // ingenting hann appliceras (samma pessimism som skörde-spärren).
      const { bodies } = await boot(armed, "1", undefined, {
        decisionId: "dec-e2e",
        site: "e2e",
        adaptations: [],
        holdout: false,
        variant: { id: "var-1", segmentKey: "google·desktop", ops: [] },
        context: {},
      });
      await settle(armed, 1300);
      await armed.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(armed, 300);
      const sec = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(sec).toHaveLength(1);
      expect(sec[0].payload?.adapted).toBe(1);
    } finally {
      await armed.close();
    }

    // KONTROLLARMEN är hela poängen med stängslet: sidan är ORÖRD trots att ett
    // beslut finns, så dess mätning är äkta besökarbeteende och MÅSTE räknas.
    // Stämplas den 1 kastar stängslet bort exakt den data det finns till för
    // att bevara (granskningsfynd 2026-08-08: e2e:t saknade fallet).
    const held = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const { bodies } = await boot(held, "1", undefined, {
        decisionId: "dec-holdout",
        site: "e2e",
        adaptations: [],
        holdout: true,
        variant: null,
        context: {},
      });
      await settle(held, 1300);
      await held.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(held, 300);
      const sec = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(sec).toHaveLength(1);
      expect(sec[0].payload?.adapted).toBe(0);
    } finally {
      await held.close();
    }
  });

  it("opt-in: EN section_engagement vid pagehide — rätt census, rätt dwell-mönster", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const { bodies } = await boot(page, "1");
      // Toppen synlig ≥1s (pricing + loved-by ovanför folden på 900px höjd).
      await settle(page, 1300);
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(page, 300);
      const secEvents = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(secEvents).toHaveLength(1);
      const sections = (secEvents[0].payload?.sections ?? []) as {
        h: string;
        n: number;
        d: number;
      }[];
      const byH = Object.fromEntries(sections.map((s) => [s.h, s]));
      // Censusen: main-h2:or — aldrig header/footer, aldrig h1:an.
      expect(byH["Simple honest pricing"]).toBeTruthy();
      expect(byH["Loved by teams"]).toBeTruthy();
      expect(byH["Never scrolled into view"]).toBeTruthy();
      expect(byH["Header heading — aldrig i censusen"]).toBeUndefined();
      expect(byH["Footer heading — aldrig i censusen"]).toBeUndefined();
      expect(byH["Build faster with Acme"]).toBeUndefined();
      // Synlighetsmönstret: sedda sektioner bär dwell, osedd bär 0.
      expect(byH["Simple honest pricing"].d).toBeGreaterThan(800);
      expect(byH["Never scrolled into view"].d).toBe(0);
      // Instansfältet: unika rubriker ⇒ n = 1 (rollupens kontrakt).
      for (const s of sections) expect(s.n).toBe(1);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("dubblettrubriker rapporteras med n = antal instanser", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const { bodies } = await boot(
        page,
        "1",
        `<!doctype html><html><body><main>
          <h2>Our plans</h2><div style="height:150px"></div>
          <h2>Our plans</h2><div style="height:150px"></div>
          <h2>Unique heading here</h2>
        </main>
        <script src="${ORIGIN}/adaptive.js" data-site="e2e" data-consent="granted" DATA_ATTR_SLOT></script>
        </body></html>`,
      );
      await settle(page, 400);
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(page, 300);
      const secEvents = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(secEvents).toHaveLength(1);
      const sections = (secEvents[0].payload?.sections ?? []) as { h: string; n: number }[];
      const plans = sections.filter((s) => s.h === "Our plans");
      expect(plans).toHaveLength(2); // bägge instanser rapporteras...
      for (const p of plans) expect(p.n).toBe(2); // ...och bär instansantalet
      expect(sections.find((s) => s.h === "Unique heading here")?.n).toBe(1);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("instansräkningen överlever cappen och långa rubriker (granskningsfixar)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      // 26 main-h2:or: dubbletten ligger på position 1 och 26 (bortom 24-
      // cappen) — n måste ändå bli 2. Plus ett 138-teckens dubblettpar där
      // nyckeln måste vara 120-slicad för att träffa.
      const longH = "This is a deliberately very long heading that keeps going well past one hundred and twenty characters to exercise key slicing";
      const mids = Array.from(
        { length: 21 },
        (_, i) => `<h2>Filler section number ${i + 1}</h2><div style="height:40px"></div>`,
      ).join("");
      const { bodies } = await boot(
        page,
        "1",
        `<!doctype html><html><body><main>
          <h2>Dup heading</h2><div style="height:40px"></div>
          <h2>${longH} A</h2><div style="height:40px"></div>
          <h2>${longH} B</h2><div style="height:40px"></div>
          ${mids}
          <h2>Dup heading</h2>
        </main>
        <script src="${ORIGIN}/adaptive.js" data-site="e2e" data-consent="granted" DATA_ATTR_SLOT></script>
        </body></html>`,
      );
      await settle(page, 400);
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(page, 300);
      const secEvents = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(secEvents).toHaveLength(1);
      const sections = (secEvents[0].payload?.sections ?? []) as { h: string; n: number }[];
      expect(sections.length).toBeLessThanOrEqual(24); // observations-cappen håller
      // Dubblett bortom cappen räknas ändå i n (räkningen sker före cappen).
      expect(sections.find((s) => s.h === "Dup heading")?.n).toBe(2);
      // 120-slicade nycklar: de två långa rubrikerna delar nyckel ⇒ n=2 på bägge.
      const longs = sections.filter((s) => s.h.length === 120);
      expect(longs.length).toBeGreaterThanOrEqual(2);
      for (const l of longs) expect(l.n).toBe(2);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("SPA-ruttbyte flushar med HEMVIST-rutten — aldrig nya ruttens stämpel på gamla sektioner", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const { bodies } = await boot(page, "1");
      await settle(page, 1200); // dwell på ursprungssidan
      await page.evaluate(() => history.pushState({}, "", "/other-route"));
      await settle(page, 300);
      const afterRoute = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(afterRoute).toHaveLength(1); // flushad AV ruttbytet...
      expect(afterRoute[0].payload?.path).toBe("/page"); // ...med hemvist-rutten
      // ...och pagehide efteråt ger INGEN andra händelse (en per sida).
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(page, 300);
      const all = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(all).toHaveLength(1);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("sen hydrering: h2:or som dyker upp EFTER wiring fångas av re-census-slingan", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      // Main är TOM vid load — sektionerna hydreras in efter 1,2 s (SPA-
      // klassen; applierns glutenforum-race). Utan slingan blev observatören
      // tyst hela laddningen.
      const { bodies } = await boot(
        page,
        "1",
        `<!doctype html><html><body><main id="root"></main>
        <script src="${ORIGIN}/adaptive.js" data-site="e2e" data-consent="granted" DATA_ATTR_SLOT></script>
        <script>
          setTimeout(function () {
            document.getElementById("root").innerHTML =
              "<h1>Hydrated hero</h1><h2>Late pricing section</h2><div style='height:200px'></div><h2>Late testimonials</h2>";
          }, 1200);
        </script>
        </body></html>`,
      );
      await settle(page, 3400); // hydrering + minst en retry-tick + ≥1s dwell
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(page, 300);
      const secEvents = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(secEvents).toHaveLength(1);
      const sections = (secEvents[0].payload?.sections ?? []) as { h: string; d: number }[];
      expect(sections.map((s) => s.h)).toContain("Late pricing section");
      expect(sections.map((s) => s.h)).toContain("Late testimonials");
      expect(sections.find((s) => s.h === "Late pricing section")!.d).toBeGreaterThan(800);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("censusen flushas vid HIDDEN (mobilens verkliga exit), pausen håller, och aldrig två payloads", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const { bodies } = await boot(
        page,
        "1",
        `<!doctype html><html><body><main>
          <h2>Pause section</h2><div style="height:120px"></div>
          <div style="height:3000px">spacer</div>
          <h2>Below fold section</h2>
        </main>
        <script src="${ORIGIN}/adaptive.js" data-site="e2e" data-consent="granted" DATA_ATTR_SLOT></script>
        </body></html>`,
      );
      // Fas 1: synlig ~700 ms.
      await settle(page, 700);
      // Fas 2: fliken göms. NYTT KONTRAKT (mätt 2026-08-09: bara 27,2 % av
      // sidvisningarna nådde ett pagehide-flush): censusen skickas HÄR, för
      // hidden är det tillfälle som faktiskt inträffar på mobil.
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await settle(page, 300);
      const atHide = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(atHide).toHaveLength(1);
      const sections = (atHide[0].payload?.sections ?? []) as { h: string; d: number }[];
      const d = sections.find((s) => s.h === "Pause section")!.d;
      // Dwell = fas 1 ≈ 700 ms. Pausen gäller alltjämt: hade bakgrundstiden
      // räknats vore talet mycket större. Generösa CI-band.
      expect(d).toBeGreaterThan(350);
      expect(d).toBeLessThan(1400);

      // Fas 3-4: besökaren kommer TILLBAKA, tittar mer och lämnar sedan sidan.
      // Priset för det nya kontraktet, uttalat i test: den tiden mäts inte —
      // men det får ALDRIG bli en andra payload (aggregeringen räknar en
      // payload = en laddning; två hade dubbelräknat laddningen).
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await settle(page, 700);
      await page.evaluate(() => window.scrollTo(0, 1800));
      await settle(page, 400);
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(page, 300);
      const secEvents = allEvents(bodies()).filter((e) => e.type === "section_engagement");
      expect(secEvents).toHaveLength(1);
      // …och exit-vägen är orörd: page_leave skickas fortfarande vid pagehide,
      // aldrig vid flikväxlingen.
      expect(allEvents(bodies()).filter((e) => e.type === "page_leave")).toHaveLength(1);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("REVERSIBELT: utan attributet skickas ingen section_engagement (av = dagens snippet)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const { bodies } = await boot(page, "");
      await settle(page, 600);
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await settle(page, 300);
      const types = allEvents(bodies()).map((e) => e.type);
      expect(types).not.toContain("section_engagement");
      // ...men journey-flödet i övrigt lever (page_leave skickas som vanligt).
      expect(types).toContain("page_leave");
    } finally {
      await page.close();
    }
  }, 30_000);
});
