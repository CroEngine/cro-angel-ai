#!/usr/bin/env bun
// Showcase pass — gallery-grade BEFORE/AFTER full-page pairs for sites where
// the reorder applied. Cookie banners are dismissed (and, as a last resort,
// hidden — PHOTO RIG ONLY, never the product), the page is scrolled through so
// lazy sections render, then: BEFORE (original order) and AFTER (reorder +
// segment patterns) full-page shots with identical conditions.
//
//   bun build scripts/showcase-reorder.ts --target=node --format=esm \
//     --outfile=showcase.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
//     node showcase.node.mjs --names=monday,asana,...

import { chromium, type Page } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";
import { SITES } from "./day0-sites";

const OUT_DIR = "/tmp/claude-0/-home-user-cro-angel-ai/c11460d4-452b-5901-aaf1-829bf613facc/scratchpad/showcase";
const BUNDLE = readFileSync("public/adaptive.js", "utf8");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  const f = process.argv.find((a) => a.startsWith(p));
  return f?.slice(p.length);
}

async function dismissAndHideConsent(page: Page) {
  // 1) polite: click a clear accept button
  await page
    .evaluate(() => {
      const RX = /^(accept( all)?( cookies)?|allow all( cookies)?|godk[äa]nn( alla)?( cookies)?|acceptera( alla)?( cookies)?|jag f[öo]rst[åa]r|ok(ay)?|got it)$/i;
      for (const el of Array.from(document.querySelectorAll("button, [role=button], a"))) {
        const t = ((el as HTMLElement).innerText || "").trim();
        if (t && t.length <= 30 && RX.test(t)) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 10 && r.height > 10) {
            (el as HTMLElement).click();
            return;
          }
        }
      }
    })
    .catch(() => {});
  await sleep(900);
  // 2) photo-rig only: hide any surviving known CMP containers so the gallery
  //    shows the page, not the banner. NEVER part of the product.
  await page
    .evaluate(() => {
      const SEL = [
        "#onetrust-consent-sdk",
        '[id*="cookiebot" i]',
        '[id^="CybotCookiebot" i]',
        '[id*="usercentrics" i]',
        '[id*="didomi" i]',
        '[class*="osano-cm" i]',
        '[id*="hs-eu-cookie" i]',
        '[id*="ppms" i]',
        '[id*="cookie-banner" i]',
        '[class*="cookie-banner" i]',
        '[id*="cookie-consent" i]',
        '[class*="cookie-consent" i]',
        '[id*="cookieconsent" i]',
        '[class*="cookieconsent" i]',
        '[id*="coi-banner" i]',
        '[class*="cky-consent" i]',
      ].join(",");
      for (const el of Array.from(document.querySelectorAll(SEL))) {
        (el as HTMLElement).style.setProperty("display", "none", "important");
      }
      // generic: fixed, viewport-wide low box mentioning cookies
      for (const el of Array.from(document.querySelectorAll("div, section, aside"))) {
        const h = el as HTMLElement;
        const cs = window.getComputedStyle(h);
        if (cs.position !== "fixed") continue;
        const r = h.getBoundingClientRect();
        if (r.height < 40 || r.height > 420) continue;
        if (r.width < window.innerWidth * 0.5) continue;
        if (!/cookie|kakor|consent/i.test(h.innerText || "")) continue;
        h.style.setProperty("display", "none", "important");
      }
    })
    .catch(() => {});
  await sleep(300);
}

async function scrollThrough(page: Page, steps = 10) {
  for (let i = 1; i <= steps; i++) {
    await page
      .evaluate(
        ({ idx, total }) => {
          const h = document.documentElement.scrollHeight;
          window.scrollTo(0, (h / total) * idx);
        },
        { idx: i, total: steps },
      )
      .catch(() => {});
    await sleep(280);
  }
  await sleep(600);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(400);
}

async function main() {
  const names = (arg("names") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const targets = SITES.filter((s) => names.includes(s.name));
  if (!targets.length) {
    console.error("no targets — pass --names=a,b,c");
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const session = await createSession();
  console.log(`showcase session ${session.id} — ${targets.map((t) => t.name).join(", ")}`);
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
    for (const site of targets) {
      process.stdout.write(`  ${site.name.padEnd(12)} `);
      try {
        await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await sleep(1500);
        await dismissAndHideConsent(page);
        await page.evaluate(BUNDLE);
        await page
          .waitForFunction(() => (window as any).__angelAdaptive?.inventory != null, undefined, {
            timeout: 30_000,
          })
          .catch(() => {});
        await scrollThrough(page); // render lazy sections BEFORE the before-shot
        await dismissAndHideConsent(page); // late-mounting banners
        await page.screenshot({
          path: `${OUT_DIR}/${site.name}-1-before.jpg`,
          fullPage: true,
          type: "jpeg",
          quality: 50,
        });
        const applied = (await page.evaluate(
          () => (window as any).__angelAdaptive.adapt("engaged_no_click"),
        )) as Array<{ patternId: string }>;
        const reordered = applied.some((a) => a.patternId === "reorder_proof_first");
        await scrollThrough(page); // re-render at the new positions
        await dismissAndHideConsent(page);
        await page.screenshot({
          path: `${OUT_DIR}/${site.name}-2-after.jpg`,
          fullPage: true,
          type: "jpeg",
          quality: 50,
        });
        await page.evaluate(() => (window as any).__angelAdaptive.revert()).catch(() => {});
        console.log(
          `${reordered ? "REORDERED" : "no-reorder"} · patterns: ${applied.map((a) => a.patternId).join("+") || "none"}`,
        );
      } catch (err) {
        console.log(`FAIL ${err instanceof Error ? err.message.split("\n")[0].slice(0, 120) : err}`);
      }
    }
  } finally {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    await closeSession(session.id).catch(() => {});
  }
  console.log(`\npairs → ${OUT_DIR}/<site>-1-before.jpg / -2-after.jpg`);
}

main().catch((e) => {
  console.error("showcase failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
