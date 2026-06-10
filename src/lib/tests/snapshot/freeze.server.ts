// Freeze a live site into corpus/<name>/ for snapshot regression testing.
//
// Capture flow (Browserbase so viewport + UA match prod):
//   goto -> settle -> wait for consent selector visible -> [optional before-screenshot]
//   -> click consent -> assert banner detached/hidden -> measure postDismissDomHits
//   -> lazy-scroll -> CDP Page.captureSnapshot (MHTML) -> screenshot -> meta.json
//   -> ALWAYS write freeze-report.json (in finally — receipt survives hard fails)
//
// MHTML inlines stylesheets/images/fonts so replay sees the same CSSOM the
// collector saw at capture time. page.content() would NOT do this — its
// external <link> references would re-fetch live (or fall back to UA defaults),
// breaking salience / contrast / visibility checks.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Stagehand } from "@browserbasehq/stagehand";

import { createSession, closeSession } from "../browserbase.server";
import { embedMhtmlFonts } from "./mhtml-fonts.server";
import {
  MHTML_INLINE_THRESHOLD_BYTES,
  uploadAsset,
  type AssetPointer,
} from "./externalize.server";

// Must match the viewport Browserbase uses for live test runs so aboveFold /
// section bucketing in golden.json matches what the live engine produces.
export const FREEZE_VIEWPORT = { width: 1280, height: 720 } as const;

// Substrings vi observerar i post-dismiss-DOM. Lowercase — haystack lowercases:as
// före match. OBSERVATION-only: ingen hård gate här. När vi har baseline från
// 3–4 siter kan vi promovera "accept all"/"decline all"/"reject all" till gate.
// "cookie" behålls för observation men ska ALDRIG bli gate — matchar footer-
// policy-länkar som är legitima.
const POST_DISMISS_NEEDLES = ["accept all", "decline all", "reject all", "cookie"] as const;

export interface FreezeOptions {
  url: string;
  name: string;
  consentSelector?: string;
  consentDismissCheck?: "detached" | "hidden";
  consentInstruction?: string;
  outDir?: string;
  notes?: string;
  /** Skip writes to corpus/. Receipt still written to /tmp. */
  dryRun?: boolean;
  /** Extra screenshot before consent click — visual sanity for matchCountBeforeClick. */
  screenshotBeforeDismiss?: boolean;
}

export interface FreezeResult {
  dir: string;
  mhtmlBytes: number;
  screenshotBytes: number;
  reportPath: string;
  ok: boolean;
}

interface FreezeReport {
  ok: boolean;
  error: string | null;
  dryRun: boolean;
  consent: {
    selector: string | null;
    dismissCheck: "detached" | "hidden" | null;
    matchCountBeforeClick: number | null;
    visibleBeforeClick: boolean | null;
    dismissedAfterMs: number | null;
    postDismissDomHits: Record<string, number> | null;
  };
  capture: {
    mhtmlKb: number;
    screenshotKb: number;
    beforeDismissScreenshotPath: string | null;
    // A2 — font-embedding (post-capture rewrite, see mhtml-fonts.server.ts).
    // externalFontSrcCount is the form-agnostic success gate per plan
    // beslutspunkt 3: must be 0 after rewrite. embeddedFontCount and
    // fetchFailures are diagnostics; mhtmlKbBeforeFontEmbed lets us see
    // the size delta the embedding added.
    externalFontSrcCount: number | null;
    embeddedFontCount: number | null;
    mhtmlKbBeforeFontEmbed: number | null;
    fontFetchFailures: { url: string; error: string }[] | null;
    // Stora MHTML (> MHTML_INLINE_THRESHOLD_BYTES) skickas till CDN via
    // lovable-assets i stället för att skrivas till repo (10 MB-tak). Pekaren
    // hamnar i page.mhtml.asset.json bredvid där page.mhtml hade legat.
    externalized: boolean;
    externalAssetUrl: string | null;
  };
  timing: {
    gotoMs: number;
    consentMs: number;
    scrollMs: number;
    captureMs: number;
  };
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

// In-page synlig-text-extraktion. Speglar collectorns synlighetsregler
// (bbox > 0, computed display/visibility/opacity, traversar shadow roots) men
// är medvetet lokal — receiptet ska vara stabilt även om COLLECT_SCRIPT refactoras.
// Returnerar { hit-keys: count } för varje nyckel som hittades i synlig text.
// SYNK-KONTRAKT: synlighetsreglerna nedan MÅSTE matcha
// src/lib/tests/scripts/collect.ts::isVisible. Receiptets prediktiva kraft
// mot golden bygger på den överenskommelsen — om reglerna divergerar kan
// receiptet säga 0 medan collectorn plockar upp elementet (falskt självförtroende).
// Tester i __tests__/freeze-visibility.test.ts låser kontraktet och blir röda
// vid drift. Ändra båda samtidigt eller ändra ingen.
//
// Needle-kontrakt: needles MÅSTE vara lowercase. Haystacken lowercases:as före
// substring-match; needles görs INTE. Skickar du "Accept All" matchar inget.
export const POST_DISMISS_HITS_FN = `(needles) => {
  const hits = Object.fromEntries(needles.map(n => [n, 0]));
  const seen = new Set();
  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }
  function walk(root) {
    const nodes = root.querySelectorAll('*');
    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.shadowRoot) walk(el.shadowRoot);
      if (!isVisible(el)) continue;
      // Leaf-text only — undvik dubbelräkning från parent.
      let text = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += ' ' + (child.nodeValue || '');
      }
      if (!text.trim()) continue;
      const hay = text.toLowerCase();
      for (const n of needles) if (hay.includes(n)) hits[n] += 1;
    }
  }
  walk(document);
  return hits;
}`;

async function measurePostDismissDomHits(
  page: import("@browserbasehq/stagehand").Page,
  needles: readonly string[],
): Promise<Record<string, number>> {
  // Stagehand's page.evaluate tar bara en string (ingen arg-overload som Playwright),
  // så vi inlinear argumentet via JSON.stringify och kallar den exporterade funktionen.
  // Samma POST_DISMISS_HITS_FN-källa körs i testen — det är hela poängen med
  // konstanten: bara en kod-sanning.
  const script = `(${POST_DISMISS_HITS_FN})(${JSON.stringify(needles)})`;
  return (await page.evaluate(script)) as Record<string, number>;
}


export async function freezeSite(opts: FreezeOptions): Promise<FreezeResult> {
  const dir = opts.outDir ?? join("corpus", opts.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID required for freeze");
  }

  // Receipt lives outside corpus/ in dry-run so we never touch the committed baseline.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = opts.dryRun
    ? join(tmpdir(), `freeze-${opts.name}-${ts}.json`)
    : join(dir, "freeze-report.json");

  const report: FreezeReport = {
    ok: false,
    error: null,
    dryRun: !!opts.dryRun,
    consent: {
      selector: opts.consentSelector ?? null,
      dismissCheck: opts.consentSelector ? opts.consentDismissCheck ?? "detached" : null,
      matchCountBeforeClick: null,
      visibleBeforeClick: null,
      dismissedAfterMs: null,
      postDismissDomHits: null,
    },
    capture: {
      mhtmlKb: 0,
      screenshotKb: 0,
      beforeDismissScreenshotPath: null,
      externalFontSrcCount: null,
      embeddedFontCount: null,
      mhtmlKbBeforeFontEmbed: null,
      fontFetchFailures: null,
      externalized: false,
      externalAssetUrl: null,
    },
    timing: { gotoMs: 0, consentMs: 0, scrollMs: 0, captureMs: 0 },
  };

  let mhtmlBytes = 0;
  let screenshotBytes = 0;

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

    const tGoto = Date.now();
    await page.goto(opts.url, { waitUntil: "load", timeoutMs: 60_000 });
    await new Promise((r) => setTimeout(r, 1500));
    report.timing.gotoMs = Date.now() - tGoto;

    // Consent: hård assertion + mätning. Allt mäts in i `report` löpande så
    // receipten är användbar även när vi throwar.
    const tConsent = Date.now();
    const dismissState = opts.consentDismissCheck ?? "detached";
    if (opts.consentSelector) {
      // Vänta in bannern (consent injiceras ofta async via taghanterare).
      // Om DENNA waiten timear ut är det stale selektor / banner laddade aldrig
      // — det är ett legitimt freeze-fel och vi loggar det explicit i error.
      try {
        await page.waitForSelector(opts.consentSelector, {
          state: "visible",
          timeout: 5000,
        });
      } catch {
        // Spara debug-screenshot om begärt — annars är felet en ren gissning.
        if (opts.screenshotBeforeDismiss) {
          try {
            const failShot = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
            const failPath = opts.dryRun
              ? join(tmpdir(), `freeze-${opts.name}-${ts}.timeout.jpg`)
              : join(dir, "screenshot.timeout.jpg");
            writeFileSync(failPath, Buffer.from(failShot));
            report.capture.beforeDismissScreenshotPath = failPath;
          } catch {
            /* screenshot best-effort */
          }
        }
        throw new Error(
          `[freeze] consent-selektor blev aldrig synlig inom 5s: ${opts.consentSelector} (${opts.name}). ` +
            `Stale selektor, A/B-variant, eller banner laddade aldrig. Verifiera i --dry-run med --screenshot-before-dismiss.`,
        );
      }

      // Mät EFTER settle, inte vid rå load — undviker spöke-nollor.
      report.consent.matchCountBeforeClick = (await page.evaluate(
        `document.querySelectorAll(${JSON.stringify(opts.consentSelector)}).length`,
      )) as number;
      report.consent.visibleBeforeClick = true; // waitForSelector(visible) lyckades

      if (opts.screenshotBeforeDismiss) {
        const beforeShot = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
        const beforePath = opts.dryRun
          ? join(tmpdir(), `freeze-${opts.name}-${ts}.before-dismiss.jpg`)
          : join(dir, "screenshot.before-dismiss.jpg");
        writeFileSync(beforePath, Buffer.from(beforeShot));
        report.capture.beforeDismissScreenshotPath = beforePath;
      }

      const tClick = Date.now();
      await page.locator(opts.consentSelector).click(); // INGEN try/catch
      try {
        await page.waitForSelector(opts.consentSelector, {
          state: dismissState,
          timeout: 5000,
        });
      } catch {
        throw new Error(
          `[freeze] consent kvar efter klick (state=${dismissState}): ${opts.name} — capture avbruten. ` +
            `Byt consentDismissCheck i corpus/sites.ts (detached↔hidden) eller uppdatera selektorn.`,
        );
      }
      report.consent.dismissedAfterMs = Date.now() - tClick;
      await new Promise((r) => setTimeout(r, 800));

      // Mät synlig text i post-dismiss-DOM. Detta är den pålitliga check som
      // ersätter rg-mot-MHTML — speglar collectorns synlighetslogik så
      // postDismissDomHits["accept all"]=0 faktiskt förutsäger en ren golden.
      report.consent.postDismissDomHits = await measurePostDismissDomHits(
        page,
        POST_DISMISS_NEEDLES,
      );
    } else if (opts.consentInstruction) {
      throw new Error(
        `[freeze] consentInstruction utan consentSelector för verifiering: ${opts.name}. ` +
          `Lägg till consentSelector i corpus/sites.ts så vi kan assertera att klicket tog.`,
      );
    }
    report.timing.consentMs = Date.now() - tConsent;

    const tScroll = Date.now();
    await lazyScroll(page);
    report.timing.scrollMs = Date.now() - tScroll;

    const tCapture = Date.now();
    const snap = await page.sendCDP<{ data: string }>("Page.captureSnapshot", {
      format: "mhtml",
    });
    const rawMhtmlBytes = Buffer.byteLength(snap.data, "utf8");
    report.capture.mhtmlKbBeforeFontEmbed = Math.round(rawMhtmlBytes / 1024);

    // A2 — embed external font binaries as cid: parts so replay doesn't fall
    // back to OS fonts. The hard-assert below (externalFontSrcCount === 0) is
    // the form-agnostic success gate per plan beslutspunkt 3.
    const embedded = await embedMhtmlFonts(snap.data);
    const finalMhtml = embedded.mhtml;
    mhtmlBytes = Buffer.byteLength(finalMhtml, "utf8");
    report.capture.mhtmlKb = Math.round(mhtmlBytes / 1024);
    report.capture.externalFontSrcCount = embedded.externalFontSrcCount;
    report.capture.embeddedFontCount = embedded.embeddedFontCount;
    report.capture.fontFetchFailures = embedded.fetchFailures;

    if (embedded.externalFontSrcCount > 0) {
      throw new Error(
        `[freeze] A2 gate: externalFontSrcCount=${embedded.externalFontSrcCount} after rewrite ` +
          `(embedded=${embedded.embeddedFontCount}, failures=${embedded.fetchFailures.length}). ` +
          `Replay will fall back to OS fonts for unembedded URLs → area/yBand drift. ` +
          `Inspect freeze-report.json fontFetchFailures.`,
      );
    }

    const shot = await page.screenshot({ type: "jpeg", quality: 70, fullPage: true });
    screenshotBytes = shot.byteLength;
    report.capture.screenshotKb = Math.round(screenshotBytes / 1024);
    report.timing.captureMs = Date.now() - tCapture;

    if (!opts.dryRun) {
      writeFileSync(join(dir, "page.mhtml"), finalMhtml, "utf8");
      writeFileSync(join(dir, "screenshot.jpg"), Buffer.from(shot));
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
    }

    report.ok = true;
    return {
      dir,
      mhtmlBytes,
      screenshotBytes,
      reportPath,
      ok: true,
    };
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    // Receipt flushas ALLTID. Detta är hela poängen — utan finally blir
    // hard-fail (stale selektor → assertion throw) en blind körning där du
    // inte kan se matchCountBeforeClick=0 i efterhand.
    try {
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      // eslint-disable-next-line no-console
      console.log(`[freeze] report -> ${reportPath}`);
    } catch (writeErr) {
      // eslint-disable-next-line no-console
      console.error(`[freeze] kunde inte skriva report: ${writeErr}`);
    }
    try {
      await stagehand.close();
    } catch {
      /* ignore */
    }
    await closeSession(session.id);
  }
}
