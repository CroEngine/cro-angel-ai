// Freeze a live site into corpus/<name>/ for snapshot regression testing.
//
// Capture flow (Browserbase so viewport + UA match prod):
//   goto -> network idle -> optional consent dismiss -> lazy-scroll
//   -> scroll to top -> wait -> CDP Page.captureSnapshot (MHTML)
//   -> screenshot (full page) -> meta.json
//
// MHTML inlines stylesheets/images/fonts so replay sees the same CSSOM the
// collector saw at capture time. page.content() would NOT do this — its
// external <link> references would re-fetch live (or fall back to UA defaults),
// breaking salience / contrast / visibility checks.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { Stagehand } from "@browserbasehq/stagehand";

import { createSession, closeSession } from "../browserbase.server";

// Must match the viewport Browserbase uses for live test runs so aboveFold /
// section bucketing in golden.json matches what the live engine produces.
export const FREEZE_VIEWPORT = { width: 1280, height: 720 } as const;

export interface FreezeOptions {
  url: string;
  name: string;
  consentSelector?: string; // CSS for cookie-banner dismiss button
  consentInstruction?: string; // Stagehand fallback ("click the Accept all button")
  outDir?: string; // defaults to corpus/<name>
  notes?: string;
}

export interface FreezeResult {
  dir: string;
  mhtmlBytes: number;
  screenshotBytes: number;
}

async function lazyScroll(page: any) {
  for (const pct of [0, 25, 50, 75, 100]) {
    await page.evaluate(
      `window.scrollTo({ top: document.documentElement.scrollHeight * ${pct / 100}, behavior: 'instant' })`,
    );
    await new Promise((r) => setTimeout(r, 500));
  }
  await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
  await new Promise((r) => setTimeout(r, 400));
}

export async function freezeSite(opts: FreezeOptions): Promise<FreezeResult> {
  const dir = opts.outDir ?? join("corpus", opts.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID required for freeze");
  }

  const session = await createSession();
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    browserbaseSessionID: session.id,
    keepAlive: false,
  });

  try {
    await stagehand.init();
    const page = stagehand.context.pages()[0] ?? (await stagehand.context.newPage());

    await page.setViewportSize(FREEZE_VIEWPORT);
    await page.goto(opts.url, { waitUntil: "networkidle", timeout: 45_000 });

    // Consent: try CSS selector first (deterministic), Stagehand as fallback.
    if (opts.consentSelector) {
      try {
        await page.click(opts.consentSelector, { timeout: 4000 });
        await new Promise((r) => setTimeout(r, 800));
      } catch {
        /* maybe already dismissed */
      }
    } else if (opts.consentInstruction) {
      try {
        await stagehand.act(opts.consentInstruction);
        await new Promise((r) => setTimeout(r, 800));
      } catch {
        /* no banner */
      }
    }

    await lazyScroll(page);

    // CDP MHTML capture — inlines CSS/images/fonts.
    const cdp = await page.context().newCDPSession(page);
    const snap = (await cdp.send("Page.captureSnapshot", { format: "mhtml" })) as {
      data: string;
    };
    const mhtmlPath = join(dir, "page.mhtml");
    writeFileSync(mhtmlPath, snap.data, "utf8");

    // Visual reference.
    const shot = await page.screenshot({ type: "jpeg", quality: 70, fullPage: true });
    const shotPath = join(dir, "screenshot.jpg");
    writeFileSync(shotPath, Buffer.from(shot));

    // Meta.
    const meta = {
      url: opts.url,
      name: opts.name,
      captured_at: new Date().toISOString(),
      viewport: FREEZE_VIEWPORT,
      consentSelector: opts.consentSelector ?? null,
      consentInstruction: opts.consentInstruction ?? null,
      notes: opts.notes ?? null,
    };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));

    return {
      dir,
      mhtmlBytes: Buffer.byteLength(snap.data, "utf8"),
      screenshotBytes: shot.byteLength ?? (shot as Buffer).length,
    };
  } finally {
    try {
      await stagehand.close();
    } catch {
      /* ignore */
    }
    await closeSession(session.id);
  }
}
