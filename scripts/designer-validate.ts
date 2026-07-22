#!/usr/bin/env bun
// Claude Designer — VALIDATE (E3-lite step 3): execute plans on live pages.
// Per site: BEFORE fullpage shot (scroll-rendered original) → fresh reload →
// planReorder(plan) at load-time (the production moment) → self-checks decide
// → on success scroll-render + AFTER shot → revert + byte-clean check. Every
// failure reason lands in feedback-round<N>.json — the input for the next
// designer round.
//
//   bun build scripts/designer-validate.ts --target=node --format=esm \
//     --outfile=dvalidate.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
//     node dvalidate.node.mjs --names=clickup,... [--round=1]

import { chromium, type Page } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";
import { SITES } from "./day0-sites";

const BASE =
  "/tmp/claude-0/-home-user-cro-angel-ai/c11460d4-452b-5901-aaf1-829bf613facc/scratchpad/designer";
const PLANS = `${BASE}/plans`;
const SHOTS = `${BASE}/shots`;
const BUNDLE = readFileSync("artifacts/lab/adaptive-lab.js", "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string, dflt?: string): string | undefined {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length) ?? dflt;
}

async function dismissAndHideConsent(page: Page) {
  await page
    .evaluate(() => {
      const RX =
        /^(accept( all)?( cookies)?|allow all( cookies)?|godk[äa]nn( alla)?( cookies)?|acceptera( alla)?( cookies)?|jag f[öo]rst[åa]r|ok(ay)?|got it)$/i;
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
  await sleep(800);
  // Photo-rig only (same stance as showcase-reorder): hide surviving CMP
  // containers so gallery shots show the page. Never part of the product.
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
    await sleep(260);
  }
  await sleep(500);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(400);
}

async function loadWithSnippet(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(1800);
  await dismissAndHideConsent(page);
  await page.evaluate(BUNDLE);
  await page.waitForFunction(() => (window as any).__angelAdaptive?.inventory != null, undefined, {
    timeout: 30_000,
  });
}

async function main() {
  const names = (arg("names") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const round = Number(arg("round", "1"));
  if (!names.length) {
    console.error("pass --names=a,b,c");
    process.exit(1);
  }
  mkdirSync(SHOTS, { recursive: true });

  const results: Record<
    string,
    { ok: boolean; reason?: string; detail?: string; restoredClean?: boolean; plan: unknown }
  > = {};
  const feedback: Record<string, { plan: unknown; failReason: string }> = {};

  const session = await createSession();
  console.log(`validate session ${session.id} — round ${round}`);
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});

    for (const name of names) {
      process.stdout.write(`  ${name.padEnd(12)} `);
      const planPath = `${PLANS}/${name}.json`;
      if (!existsSync(planPath)) {
        console.log("NO PLAN");
        continue;
      }
      const plan = JSON.parse(readFileSync(planPath, "utf8"));
      if (plan.action === "refuse") {
        results[name] = { ok: false, reason: "designer-refused", plan };
        console.log(`designer refused · ${String(plan.rationale ?? "").slice(0, 70)}`);
        continue;
      }
      const site = SITES.find((s) => s.name === name);
      if (!site) {
        console.log("UNKNOWN SITE");
        continue;
      }
      try {
        // BEFORE: original page, scroll-rendered.
        await loadWithSnippet(page, site.url);
        await scrollThrough(page);
        await dismissAndHideConsent(page);
        await page.screenshot({
          path: `${SHOTS}/${name}-1-before.jpg`,
          fullPage: true,
          type: "jpeg",
          quality: 50,
        });

        // AFTER: fresh load, plan applied pre-scroll (production moment).
        await loadWithSnippet(page, site.url);
        const res = (await page.evaluate(
          (p) => (window as any).__angelAdaptive.planReorder(p),
          plan,
        )) as { ok: boolean; reason?: string; detail?: string };

        if (res.ok) {
          await scrollThrough(page);
          await dismissAndHideConsent(page);
          await page.screenshot({
            path: `${SHOTS}/${name}-2-after.jpg`,
            fullPage: true,
            type: "jpeg",
            quality: 50,
          });
        }
        const restoredClean = (await page.evaluate(() => {
          (window as any).__angelAdaptive.revert();
          return (
            document.querySelectorAll(
              "[data-angel-adaptation],[data-angel-reorder],[data-angel-emphasis]",
            ).length === 0
          );
        })) as boolean;

        results[name] = { ...res, restoredClean, plan };
        if (!res.ok) feedback[name] = { plan, failReason: res.reason ?? "unknown" };
        console.log(
          res.ok
            ? `APPLIED · ${res.detail ?? ""} · restored=${restoredClean ? "clean" : "DIRTY"}`
            : `refused: ${res.reason}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message.split("\n")[0].slice(0, 100) : String(err);
        results[name] = { ok: false, reason: `harness: ${msg}`, plan };
        console.log(`FAIL ${msg}`);
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

  writeFileSync(`${BASE}/results-round${round}.json`, JSON.stringify(results, null, 1));
  writeFileSync(`${BASE}/feedback-round${round}.json`, JSON.stringify(feedback, null, 1));
  const okCount = Object.values(results).filter((r) => r.ok).length;
  console.log(
    `\n${okCount}/${Object.keys(results).length} plans applied clean · results-round${round}.json · feedback for ${Object.keys(feedback).length} site(s)`,
  );
}

main().catch((e) => {
  console.error("validate failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
