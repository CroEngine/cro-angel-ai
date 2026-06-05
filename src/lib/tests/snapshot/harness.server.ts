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

// Probe page.evaluate until it survives `need` consecutive ticks against the
// same URL. A delayed MHTML commit tears the execution context down mid-call,
// so evaluate throws — reset streak and keep going. Throws if the context
// never stabilizes, since downstream work would be unreliable.
async function waitForStableContext(
  page: Page,
  { tries = 20, gapMs = 150, need = 2 }: { tries?: number; gapMs?: number; need?: number } = {},
): Promise<string> {
  let streak = 0;
  let lastUrl = "";
  for (let i = 0; i < tries; i++) {
    try {
      const url = await page.evaluate(() => location.href);
      streak = url === lastUrl ? streak + 1 : 1;
      lastUrl = url;
      if (streak >= need) return url;
    } catch {
      streak = 0;
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  throw new Error(`[replay] context never stabilized after ${tries} tries`);
}

// Node-driven scroll loop. Re-reads scrollHeight before each step so lazy-load
// expansion is not missed. Each evaluate is short; on failure we re-gate and
// retry the step once so a transient context tear-down doesn't silently
// shrink scroll coverage (which would make the diff flaky).
async function nodeLoopScroll(page: Page, steps = 8, gapMs = 150): Promise<void> {
  const safeStep = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      await waitForStableContext(page);
      await fn().catch(() => {
        /* one retry; if it still fails, fall through */
      });
    }
  };

  for (let i = 1; i <= steps; i++) {
    await safeStep(async () => {
      await page.evaluate(
        ({ idx, total }) => {
          const h = document.documentElement.scrollHeight;
          window.scrollTo(0, (h / total) * idx);
        },
        { idx: i, total: steps },
      );
    });
    await new Promise((r) => setTimeout(r, gapMs));
  }

  // Final bottom pin (re-read scrollHeight one more time) + settle + return to top.
  await safeStep(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  });
  await new Promise((r) => setTimeout(r, 600));
  await safeStep(async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
  });
  await new Promise((r) => setTimeout(r, 200));
}

// Node-driven cookie-banner stamping. Mirrors the in-page poll from
// runPageAudit but as short Node-driven evaluates so a pending IIFE can never
// outlive an MHTML commit.
async function nodeLoopStampCookieRoot(page: Page, budgetMs = 2500, gapMs = 150): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    let done = false;
    try {
      done = (await page.evaluate(() => {
        const SEL = [
          '#onetrust-consent-sdk', '#onetrust-banner-sdk', '#onetrust-accept-btn-handler',
          '[id*="onetrust" i]', '[class*="onetrust" i]',
          '#osano-cm-window', '[class*="osano-cm" i]',
          '[id*="cookiebot" i]', '[id^="CybotCookiebot" i]',
          '[id*="cookie-banner" i]', '[id*="cookie-consent" i]',
          '[class*="cookie-banner" i]', '[class*="cookie-consent" i]',
          '[id*="truste" i]', '[class*="truste" i]',
          '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
          '[id*="usercentrics" i]', '[id*="didomi" i]', '[class*="didomi" i]',
        ].join(",");
        const ROOT_SEL =
          '#onetrust-consent-sdk, [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [id*="onetrust" i]';
        const found = Array.from(document.querySelectorAll(SEL)).find(
          (el) => el.tagName !== "STYLE" && el.tagName !== "SCRIPT" && el.tagName !== "LINK",
        );
        if (!found) return false;
        const r = found.getBoundingClientRect();
        const isKnownVendor = /onetrust|cookiebot|usercentrics|didomi|osano/i.test(found.id || "");
        if (!(isKnownVendor || (r.width > 50 && r.height > 30))) return false;
        const root = (found.closest && found.closest(ROOT_SEL)) || found;
        try {
          root.setAttribute("data-lovable-cookie-root", "1");
        } catch {
          /* ignore */
        }
        return true;
      })) as boolean;
    } catch {
      await waitForStableContext(page);
    }
    if (done) return;
    await new Promise((r) => setTimeout(r, gapMs));
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

    // Frozen pages often contain SPA code that reads location and forces a
    // redirect back to the canonical https:// origin ("if location.hostname
    // !== 'foo.com' location.replace(...)"). That redirect destroys evaluate
    // contexts mid-test. Block both vectors:
    //   1) network — any outbound request from the frozen page is aborted.
    //   2) navigation API — neutralize location.assign/replace/href setter,
    //      history.pushState/replaceState. The page's own scripts still run
    //      (animations, IntersectionObservers), but can't move us off the doc.
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("file://")) return route.continue();
      return route.abort();
    });
    await context.addInitScript(() => {
      try {
        const noop = () => {};
        history.pushState = noop as typeof history.pushState;
        history.replaceState = noop as typeof history.replaceState;
        // Best-effort: location is non-configurable, but assign/replace are
        // overridable.
        (window.location as unknown as { assign: () => void }).assign = noop;
        (window.location as unknown as { replace: () => void }).replace = noop;
      } catch {
        /* ignore */
      }
    });
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

    // Context-stabilitets-gate: a pending evaluate is what kills us, so before
    // running anything page-affecting we require that page.evaluate survives
    // N consecutive ticks against the same URL. If it throws (context torn down
    // mid-evaluate by a delayed MHTML commit), reset streak and keep polling.
    await waitForStableContext(page);

    // eslint-disable-next-line no-console
    console.log(`[replay] url=${page.url()} navHistory=${JSON.stringify(seenUrls)}`);

    // Node-driven scroll. Each step is a trivially short evaluate, so a torn
    // context costs one step (caught + recovered via the gate) instead of a
    // long pending IIFE crashing the whole audit.
    await nodeLoopScroll(page);

    // Node-driven cookie-root stamping. Same principle: short evaluates only.
    await nodeLoopStampCookieRoot(page);

    const elements = (await page.evaluate(COLLECT_SCRIPT)) as CollectedElement[];
    // eslint-disable-next-line no-console
    console.log(`[replay] collected ${elements.length} elements`);
    const pageAudit = await runPageAudit(
      page as unknown as Parameters<typeof runPageAudit>[0],
      { skipScrollWarmup: true, skipCookiePoll: true },
    );

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
