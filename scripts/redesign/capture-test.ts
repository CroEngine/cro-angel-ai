#!/usr/bin/env bun
// Kapacitets-test (ägaren 2026-07-25: "gör det du rekommenderar" → scoped
// Browserbase-render FÖRE de fulla 200). Jämför STATISK hämtning mot Browserbase-
// RENDER på de sajter som föll / blev tunna / hade bild-loggor i skala-testet, och
// mäter om render återhämtar innehåll golvet kan jobba på (sektioner + bevis).
// Rent GOLV (ingen LLM) — isolerar CAPTURE-frågan. Kräver BROWSERBASE_API_KEY +
// BROWSERBASE_PROJECT_ID (annars är render == statisk och testet är meningslöst).

import type { Page } from "playwright-core";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { serializeVisibleHtml } from "./visible-dom";

const EVIDENCE = new Set(["testimonials", "pricing", "logos", "stats", "comparison", "faq"]);
const CONC = 1; // DIAGNOSTIK: 1 session i taget — isolerar om samtidighet är problemet
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// Diagnostisk delmängd (~8): bekräfta att Browserbase-CDP ansluter alls (förra
// körningen timeoutade på connectOverCDP) innan vi kör de fulla ~25.
const SITES = [
  "gymshark.com", "figma.com", "notion.so", "nike.com", "airbnb.com", // SPA/thin/image
  "whoop.com", "docker.com", "stripe.com", // controls
];

async function renderPage(): Promise<{ page: Page; cleanup: () => Promise<void> }> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (apiKey && projectId) {
    // Anslut som den BEVISADE vägen (skördaren/engine.server.ts): Stagehand med
    // env:BROWSERBASE + sessionID. Raw chromium.connectOverCDP(connectUrl) time-
    // outade 8/8 i CI (capture-test #1/#2) — det var aldrig den validerade vägen.
    const { createSession, closeSession } = await import("../../src/lib/tests/browserbase.server");
    const { Stagehand } = await import("@browserbasehq/stagehand");
    const session = await createSession();
    const stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey,
      projectId,
      browserbaseSessionID: session.id,
      keepAlive: true,
      disablePino: true,
    });
    await stagehand.init();
    const page = stagehand.page as unknown as Page; // Stagehand-sidan är playwright-kompatibel
    await page.setViewportSize({ width: 390, height: 844 }).catch(() => {});
    return {
      page,
      cleanup: async () => {
        await stagehand.close().catch(() => {});
        await closeSession(session.id).catch(() => {});
      },
    };
  }
  const { chromium } = await import("playwright-core");
  const exec = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({ headless: true, executablePath: exec });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: UA });
  return { page, cleanup: async () => void (await browser.close().catch(() => {})) };
}

interface Cap { ok: boolean; err?: string; secs: number; ev: number }

async function staticCap(url: string): Promise<Cap> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (!res.ok) return { ok: false, err: `HTTP ${res.status}`, secs: 0, ev: 0 };
    const m = extractContentModel(await res.text());
    return { ok: true, secs: m.sections.length, ev: m.sections.filter((s) => EVIDENCE.has(s.type)).length };
  } catch (e) {
    return { ok: false, err: (e as Error).message.slice(0, 40), secs: 0, ev: 0 };
  }
}

async function renderedCap(url: string): Promise<Cap> {
  let cleanup = async () => {};
  try {
    const { errors } = await import("playwright-core");
    const rp = await renderPage(); // INUTI try: en connect-timeout blir ett per-sajt-fel, inte fatalt
    cleanup = rp.cleanup;
    const page = rp.page;
    await page.goto(url, { waitUntil: "load", timeout: 45_000 }).catch((err) => {
      if (!(err instanceof errors.TimeoutError)) throw err;
      return null;
    });
    // Lazy-svep så under-folden renderas, sedan tillbaka till toppen.
    await page
      .evaluate(async () => {
        await new Promise((resolve) => {
          let y = 0;
          const t = setInterval(() => {
            window.scrollBy(0, 900);
            y += 900;
            if (y >= document.body.scrollHeight - 1200 || y > 40000) {
              clearInterval(t);
              window.scrollTo(0, 0);
              resolve(null);
            }
          }, 80);
        });
      })
      .catch(() => {});
    await page.waitForTimeout(800).catch(() => {});
    const html = await serializeVisibleHtml(page);
    const m = extractContentModel(html);
    return { ok: true, secs: m.sections.length, ev: m.sections.filter((s) => EVIDENCE.has(s.type)).length };
  } catch (e) {
    return { ok: false, err: (e as Error).message.slice(0, 40), secs: 0, ev: 0 };
  } finally {
    await cleanup();
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function w() {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => w()));
  return out;
}

if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
  console.log("::warning::BROWSERBASE_API_KEY/PROJECT_ID saknas — render == statisk, testet är meningslöst.");
}

const rows = await pool(SITES, CONC, async (site) => {
  const url = site.startsWith("http") ? site : `https://${site}`;
  const s = await staticCap(url);
  const r = await renderedCap(url);
  console.log(
    `CAP|${site}|static ${s.ok ? s.secs + "sec/" + s.ev + "ev" : "✗ " + s.err}|rendered ${r.ok ? r.secs + "sec/" + r.ev + "ev" : "✗ " + r.err}`,
  );
  return { site, s, r };
});

const thinStatic = rows.filter((x) => !x.s.ok || x.s.secs < 3);
const recovered = thinStatic.filter((x) => x.r.ok && x.r.secs >= 3);
const improved = rows.filter((x) => x.r.ok && x.r.secs > x.s.secs + 1);
const regressed = rows.filter((x) => x.s.ok && x.s.secs >= 3 && (!x.r.ok || x.r.secs < x.s.secs - 1));
console.log("\n===CAP-AGG===");
console.log(`sites ${rows.length} | thin/failed static ${thinStatic.length} | rendered ok ${rows.filter((x) => x.r.ok).length}`);
console.log(`RECOVERED (thin/failed static → >=3 sec rendered): ${recovered.length} [${recovered.map((x) => x.site).join(", ")}]`);
console.log(`materially improved (rendered > static+1): ${improved.length} [${improved.map((x) => x.site).join(", ")}]`);
console.log(`regressed (control lost sections): ${regressed.length} [${regressed.map((x) => x.site).join(", ")}]`);
console.log(
  `avg sections: static ${(rows.reduce((a, x) => a + (x.s.ok ? x.s.secs : 0), 0) / rows.length).toFixed(1)} → rendered ${(rows.reduce((a, x) => a + (x.r.ok ? x.r.secs : 0), 0) / rows.length).toFixed(1)}`,
);
console.log(
  `avg evidence: static ${(rows.reduce((a, x) => a + x.s.ev, 0) / rows.length).toFixed(1)} → rendered ${(rows.reduce((a, x) => a + x.r.ev, 0) / rows.length).toFixed(1)}`,
);
