#!/usr/bin/env bun
// Minimal MHTML capture via Browserbase — for benchmark fixtures (gitignored),
// NOT the promoted determinism corpus (that path is freeze-site.ts with the
// full consent/font/canary pipeline). Use for trust-eval / structure-eval
// fixtures where the runner loads page.mhtml directly.
//
//   bun build scripts/capture-mhtml.ts --target=node --format=esm \
//     --outfile=capture.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
//     node capture.node.mjs --url=https://plausible.io/ --out=fixtures/drift-survey/saas-landing/plausible
//
// Writes <out>/page.mhtml + <out>/screenshot.jpg + <out>/meta.json.

import { chromium, type Page } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  const f = process.argv.find((a) => a.startsWith(p));
  return f?.slice(p.length);
}

const url = arg("url");
const outDir = arg("out");
if (!url || !outDir) {
  console.error("Usage: --url=https://… --out=fixtures/…/name");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lazyScroll(page: Page, steps = 10) {
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
    await sleep(250);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)).catch(() => {});
  await sleep(800);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(400);
}

const session = await createSession();
console.log(`[capture] browserbase session ${session.id}`);
const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
try {
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
  console.log(`[capture] goto ${url}`);
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await sleep(1500);
  await lazyScroll(page);

  const cdp = await ctx.newCDPSession(page);
  const { data } = (await cdp.send("Page.captureSnapshot", { format: "mhtml" })) as { data: string };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "page.mhtml"), data);
  await page.screenshot({ path: join(outDir, "screenshot.jpg"), fullPage: true, type: "jpeg", quality: 55 });
  writeFileSync(
    join(outDir, "meta.json"),
    JSON.stringify(
      {
        url,
        frozenAt: new Date().toISOString(),
        viewport: { width: 1280, height: 720 },
        capturedBy: "scripts/capture-mhtml.ts (browserbase, minimal — benchmark fixture)",
      },
      null,
      2,
    ),
  );
  console.log(`[capture] OK -> ${outDir}/page.mhtml (${Math.round(data.length / 1024)} kb)`);
} finally {
  try {
    await browser.close();
  } catch {
    /* ignore */
  }
  await closeSession(session.id).catch(() => {});
}
