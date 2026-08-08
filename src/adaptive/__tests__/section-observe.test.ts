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
        body: JSON.stringify({ mode: "anonymous", holdoutPct: 0, conversion: {} }),
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
