// Regression (B6): JSON-LD trust entries are anchored to <body>. Because
// body.contains(x) is true for every element, hierarchyDedup used to keep the
// invisible schema entry (depth 0) and silently delete every VISIBLE signal of
// the same type — a Trustpilot widget, a "4.7 av 5" text — from the findings,
// the trust summary and the goal judge's input. Doc-level entries now carry no
// _block (dedup skips them), section 'document' and aboveFold=false, so schema
// corroboration and visible widgets coexist.
//
// Runs the REAL TRUST_SIGNALS_SCRIPT in Playwright Chromium (same pattern as
// freeze-visibility.test.ts): real layout, no DOM stubs. Skips gracefully when
// Chromium can't start (sandboxes without Playwright sysdeps).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { TRUST_SIGNALS_SCRIPT } from "../trustSignals";

interface TrustSignalOut {
  type: string;
  text: string;
  source: string;
  section: string;
  aboveFold: boolean;
  rating?: number;
  reviewCount?: number;
  reviewSource?: string;
}

let browser: Browser | null = null;
let context: BrowserContext;
let page: Page;
let chromiumAvailable = false;

beforeAll(async () => {
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    browser = await chromium.launch({ headless: true, executablePath });
    context = await browser.newContext();
    page = await context.newPage();
    chromiumAvailable = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[trust-signals-schema.test] Chromium kunde inte starta — skip:ar suiten. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
});

afterAll(async () => {
  await browser?.close();
});

async function runScript(html: string): Promise<TrustSignalOut[]> {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  const result = (await page.evaluate(TRUST_SIGNALS_SCRIPT)) as {
    signals: TrustSignalOut[];
  };
  return result.signals;
}

describe("trust signals — JSON-LD vs visible widgets (B6)", () => {
  it("keeps the visible review widget when JSON-LD AggregateRating is present", async () => {
    if (!chromiumAvailable) return;
    const signals = await runScript(`
      <div class="trustpilot-widget" data-rating="4.7" style="width:300px;height:60px">
        Trustpilot
      </div>
      <script type="application/ld+json">
        {"@type":"AggregateRating","ratingValue":4.7,"reviewCount":1234}
      </script>
    `);
    const reviews = signals.filter((s) => s.type === "review_rating");

    // The visible widget must survive the hierarchy dedup...
    const widget = reviews.find((s) => s.source === "attr");
    expect(widget).toBeDefined();
    expect(widget?.reviewSource).toBe("Trustpilot");
    expect(widget?.aboveFold).toBe(true);

    // ...and the schema entry stays as non-positional corroboration.
    const schema = reviews.find((s) => s.source === "schema");
    expect(schema).toBeDefined();
    expect(schema?.section).toBe("document");
    expect(schema?.aboveFold).toBe(false);
  });

  it("doc-level schema entries never count as above-fold signals", async () => {
    if (!chromiumAvailable) return;
    const signals = await runScript(`
      <script type="application/ld+json">
        {"@type":"Organization","telephone":"+468123456","address":"Storgatan 1"}
      </script>
    `);
    const contact = signals.find((s) => s.type === "contact_info" && s.source === "schema");
    expect(contact).toBeDefined();
    expect(contact?.section).toBe("document");
    expect(contact?.aboveFold).toBe(false);
  });

  it("visible same-type entries still dedupe hierarchically among themselves", async () => {
    if (!chromiumAvailable) return;
    // Outer microdata block dominating an inner one: outer kept, inner dropped
    // — the dedup's original purpose, unchanged by the doc-level fix.
    const signals = await runScript(`
      <div itemprop="aggregateRating" style="width:400px">
        <span itemprop="ratingValue">4.8</span>
        <div itemprop="aggregateRating"><span itemprop="ratingValue">4.8</span></div>
      </div>
    `);
    const reviews = signals.filter((s) => s.type === "review_rating");
    expect(reviews).toHaveLength(1);
  });
});
