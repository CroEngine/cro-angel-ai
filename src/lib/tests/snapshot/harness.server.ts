// Replay a frozen corpus page through COLLECT_SCRIPT + pageAudit, producing
// the same shape the live engine produces — so normalize.ts can diff it
// against corpus/<name>/golden.json.
//
// Replay runs in **local Playwright** (pinned chromium), not Browserbase:
//   - file:// MHTML is the only Chromium-supported MHTML transport. data: URLs
//     and Fetch-intercepted https:// responses are silently rejected.
//   - Browserbase adds zero value at replay (residential proxy is irrelevant
//     when loading a frozen file with no network).
//   - A pinned `playwright` version pins the Chromium build, so golden vs
//     fresh always share the exact same browser. A playwright upgrade is a
//     deliberate "re-bless goldens" event.
//
// Capture still runs on Browserbase (anti-bot); see freeze.server.ts.

import { readFileSync, existsSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { chromium, type Page } from "playwright";

import { COLLECT_SCRIPT } from "../scripts/collect";
import { runPageAudit } from "../runners/pageAudit.server";

import type { CollectedElement } from "../schema";

export interface ReplayResult {
  collect: unknown;
  pageAudit: unknown;
}

interface Meta {
  viewport: { width: number; height: number };
}

function readMeta(dir: string): Meta {
  const raw = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  if (!raw?.viewport?.width || !raw?.viewport?.height) {
    throw new Error(`corpus meta.json missing viewport: ${dir}`);
  }
  return { viewport: raw.viewport };
}

async function waitForReady(page: Page) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => document.readyState).catch(() => null);
    if (ready === "complete") return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

export async function replayCorpus(name: string, corpusRoot = "corpus"): Promise<ReplayResult> {
  const dir = join(corpusRoot, name);
  const mhtmlPath = join(dir, "page.mhtml");
  if (!existsSync(mhtmlPath)) {
    throw new Error(`corpus/${name}/page.mhtml not found — run freeze-site first`);
  }
  const meta = readMeta(dir);

  // MHTML must live on disk so Chromium can render it via file://; copying to
  // tmp keeps the corpus path clean and lets us nuke our scratch on cleanup.
  const tmpDir = mkdtempSync(join(tmpdir(), "snapshot-replay-"));
  const tmpFile = join(tmpDir, "page.mhtml");
  copyFileSync(mhtmlPath, tmpFile);
  const fileUrl = `file://${tmpFile}`;

  // Default: Playwright's pinned bundled Chromium (deterministic across machines).
  // Override only when running in an env that can't install Playwright's system
  // deps (e.g. some sandboxes); the user-visible flow uses the pinned binary.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    // Keep JS enabled — MHTML loaded from file:// does NOT auto-navigate to
    // the embedded URL (we verified URL stays on file://...), and disabling JS
    // breaks async evaluate IIFEs in some Playwright builds. Page scripts that
    // try to fetch live mostly fail silently since their network is gone.
    const context = await browser.newContext({
      viewport: meta.viewport,
    });
    const page = await context.newPage();

    // Track navigations: when Chromium opens a .mhtml from file://, it first
    // loads the wrapper then "unwraps" to the embedded document URL (e.g.
    // https://www.hibob.com/). That second navigation destroys evaluate
    // contexts mid-test, so we wait for the URL to stop moving before doing
    // anything else.
    const seenUrls: string[] = [];
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) seenUrls.push(f.url());
    });

    await page.goto(fileUrl, { waitUntil: "load", timeout: 30_000 });
    await waitForReady(page);

    // URL-stabilization: poll until two consecutive 250ms ticks see the same URL.
    let lastUrl = page.url();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const now = page.url();
      if (now === lastUrl && i > 1) break;
      lastUrl = now;
    }
    // CSSOM / layout settle.
    await new Promise((r) => setTimeout(r, 600));

    // eslint-disable-next-line no-console
    console.log(`[replay] url=${page.url()} navHistory=${JSON.stringify(seenUrls)}`);

    const elements = (await page.evaluate(COLLECT_SCRIPT)) as CollectedElement[];
    // eslint-disable-next-line no-console
    console.log(`[replay] collected ${elements.length} elements`);
    const pageAudit = await runPageAudit(page as unknown as Parameters<typeof runPageAudit>[0]);

    return {
      collect: { target: "clickables", elements, count: elements.length },
      pageAudit,
    };
  } finally {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
