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
  consentDismissCheck?: "detached" | "hidden"; // how we verify the click took
  consentInstruction?: string; // Stagehand fallback ("click the Accept all button")
  outDir?: string; // defaults to corpus/<name>
  notes?: string;
}

export interface FreezeResult {
  dir: string;
  mhtmlBytes: number;
  screenshotBytes: number;
}

async function lazyScroll(page: import("@browserbasehq/stagehand").Page) {
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

    await page.setViewportSize(FREEZE_VIEWPORT.width, FREEZE_VIEWPORT.height);
    // "load" istället för "networkidle": sajter med långlivade trackers
    // (chat widgets, marketo, segment) blir aldrig idle och timear ut capturen.
    // En kort settle efteråt täcker post-load-hydrering.
    await page.goto(opts.url, { waitUntil: "load", timeoutMs: 60_000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Consent: hård assertion. Vi vill hellre avbryta capturen än fryser in
    // en banner tyst. Stale selektor, A/B-variant eller sent-laddad banner ska
    // alla bli synliga som freeze-fel — inte som "Accept All"/"Decline All" i
    // golden veckor senare.
    const dismissState = opts.consentDismissCheck ?? "detached";
    if (opts.consentSelector) {
      await page.locator(opts.consentSelector).click(); // INGEN try/catch
      await page
        .waitForSelector(opts.consentSelector, {
          state: dismissState,
          timeout: 5000,
        })
        .catch(() => {
          throw new Error(
            `[freeze] consent kvar efter klick (state=${dismissState}): ${opts.name} — capture avbruten. ` +
              `Byt consentDismissCheck i corpus/sites.ts (detached↔hidden) eller uppdatera selektorn.`,
          );
        });
      await new Promise((r) => setTimeout(r, 800));
    } else if (opts.consentInstruction) {
      // Stagehand-fallback har ingen selektor att assertera mot. Kräv att
      // caller ändå anger consentSelector för verifiering — annars vägrar vi.
      throw new Error(
        `[freeze] consentInstruction utan consentSelector för verifiering: ${opts.name}. ` +
          `Lägg till consentSelector i corpus/sites.ts så vi kan assertera att klicket tog.`,
      );
    }

    await lazyScroll(page);

    // CDP MHTML capture — inlines CSS/images/fonts.
    const snap = await page.sendCDP<{ data: string }>("Page.captureSnapshot", {
      format: "mhtml",
    });
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
      screenshotBytes: shot.byteLength,
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
