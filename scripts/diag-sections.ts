#!/usr/bin/env bun
// One-off diagnostic: print a site's detected sections + rects + reorder trail.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";

const BUNDLE = readFileSync("public/adaptive-lab.js", "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const url = process.argv[2] ?? "https://webflow.com/";
  const session = await createSession();
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(2500);
    await page.evaluate(BUNDLE);
    await page
      .waitForFunction(() => (window as any).__angelAdaptive?.inventory != null, undefined, { timeout: 30_000 })
      .catch(() => {});
    const out = await page.evaluate(() => {
      const a = (window as any).__angelAdaptive;
      const inv = a.inventory;
      const rows = inv.sections.map((s: any, i: number) => {
        let rect = null;
        try {
          const el = s.selector ? document.querySelector(s.selector) : null;
          if (el) {
            const r = (el as HTMLElement).getBoundingClientRect();
            rect = { top: Math.round(r.top + window.scrollY), h: Math.round(r.height) };
          }
        } catch {}
        return { i, type: s.type, heading: (s.heading || "").slice(0, 50), sel: (s.selector || "").slice(0, 70), rect };
      });
      const applied = a.adapt("engaged_no_click");
      const why = (window as any).__angelReorderWhy ?? "";
      const testi = inv.sections.find((s: any) => s.type === "testimonials");
      let testiAfter = null;
      try {
        const el = testi?.selector ? document.querySelector(testi.selector) : null;
        if (el) {
          const r = (el as HTMLElement).getBoundingClientRect();
          testiAfter = { top: Math.round(r.top + window.scrollY), h: Math.round(r.height) };
        }
      } catch {}
      a.revert();
      return { rows, why, applied: applied.map((x: any) => x.patternId + "|" + (x.detail || "")), testiAfter };
    });
    for (const r of out.rows) {
      console.log(
        `${String(r.i).padStart(2)} ${r.type.padEnd(14)} top=${r.rect ? String(r.rect.top).padStart(6) : "  MISS"} h=${r.rect ? String(r.rect.h).padStart(5) : "    -"}  "${r.heading}"  ${r.sel}`,
      );
    }
    console.log(`\ntrail: ${out.why}`);
    console.log(`applied: ${out.applied.join(" ; ")}`);
    console.log(`testi rect AFTER adapt: ${JSON.stringify(out.testiAfter)}`);
  } finally {
    try {
      await browser.close();
    } catch {}
    await closeSession(session.id).catch(() => {});
  }
}

main().catch((e) => {
  console.error("diag failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
