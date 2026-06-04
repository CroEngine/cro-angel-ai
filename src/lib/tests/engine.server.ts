// Stagehand-based step engine. Runs against an already-created Browserbase session.

import { Stagehand } from "@browserbasehq/stagehand";

import { COLLECT_SCRIPT } from "./scripts/collect";
import { OVERLAY_FN } from "./scripts/overlay";
import { runPageAudit, runMobilePass } from "./runners/pageAudit.server";
import { waitForSettled } from "./runners/settle.server";

import { groupRepeatedControls } from "./audit-helpers";


import type {
  CollectedElement,
  CollectTarget,
  CTAEntity,
  EngineEvent,
  FormEntity,
  NavigationData,
  PageAuditData,
  PageSection,
  PageSummary,
  Rect,
  RepeatedGroup,
  SectionKind,
  SectionType,
  Step,
  TrustSignal,
  TrustSignalType,
  TrustSummary,
  ViewportZone,
  VisualHierarchyEntry,
} from "./schema";

// Re-export schema types so existing imports of `engine.server` keep working.
export type {
  CollectData,
  CollectedElement,
  CollectSummary,
  CollectTarget,
  CTAEntity,
  ElementCategory,
  ElementIntent,
  EngineEvent,
  FormEntity,
  FormField,
  HeroContent,
  NavigationData,
  PageAuditData,
  PageSection,
  PageSummary,
  Rect,
  RepeatedGroup,
  SectionKind,
  SectionType,
  Step,
  TrustSignal,
  TrustSignalType,
  TrustSummary,
  ViewportZone,
  VisualHierarchyEntry,
} from "./schema";

function readJpegDimensions(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSOF) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { w, h };
    }
    const segLen = buf.readUInt16BE(i + 2);
    i += 2 + segLen;
  }
  return null;
}

function summarize(step: Step): string {
  switch (step.kind) {
    case "goto": return `goto ${step.url}`;
    case "wait": return `wait ${step.ms}ms`;
    case "assertText": return `assertText "${step.text}"`;
    case "click": return `click ${step.selector}`;
    case "fill": return `fill ${step.selector} = "${step.value}"`;
    case "act": return `act ${step.instruction}`;
    case "extract": return `extract ${step.instruction}`;
    case "observe": return `observe ${step.instruction}`;
    case "collect": return `collect ${step.target}`;
    case "pageAudit": return `pageAudit`;
  }
}

function filterCollected(all: CollectedElement[], target: CollectTarget): CollectedElement[] {
  if (target === "buttons") {
    // Strict: real <button>, <input type=submit|button>, role=button only.
    return all.filter((el) =>
      el.tagName === "button" ||
      el.tagName === "input[type=submit]" ||
      el.tagName === "input[type=button]" ||
      el.tagName === "[role=button]"
    );
  }
  // "clickables" → everything we collected.
  return all;
}

async function scrollWarmup(page: import("@browserbasehq/stagehand").Page, onEvent: (e: EngineEvent) => void) {
  try {
    for (const pct of [0, 25, 50, 75, 100]) {
      await page.evaluate(
        `window.scrollTo({ top: document.documentElement.scrollHeight * ${pct / 100}, behavior: 'instant' })`,
      );
      await new Promise((res) => setTimeout(res, 400));
    }
    await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
    await new Promise((res) => setTimeout(res, 200));
    onEvent({ type: "log", message: "scrolled page to trigger lazy content" });
  } catch (e) {
    onEvent({ type: "log", message: `scroll failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}

async function captureScreenshot(
  page: import("@browserbasehq/stagehand").Page,
  onEvent: (e: EngineEvent) => void,
): Promise<{ dataUrl: string; viewport: { w: number; h: number } } | undefined> {
  try {
    const raw = await page.screenshot({ type: "jpeg", quality: 60, fullPage: true });
    const buf = Buffer.from(raw);

    const dims = readJpegDimensions(buf);
    let vp: { w: number; h: number };
    if (dims) {
      vp = dims;
    } else {
      const win = (await page.evaluate<{ w: number; h: number }>(
        "({ w: window.innerWidth, h: window.innerHeight })",
      )) ?? { w: 1280, h: 720 };
      const docH = (await page.evaluate<number>("document.documentElement.scrollHeight")) ?? win.h;
      vp = { w: win.w, h: Math.max(docH, win.h) };
    }

    const b64 = buf.toString("base64");
    const kb = Math.round(buf.length / 1024);
    onEvent({ type: "log", message: `screenshot captured (${kb}kb, ${vp.w}×${vp.h}${dims ? "" : " · fallback dims"})` });
    if (buf.length > 6 * 1024 * 1024 || vp.h > 10000) {
      onEvent({ type: "log", message: `warn: screenshot is large (${kb}kb, ${vp.h}px tall) — consider storage-upload soon` });
    }
    return { dataUrl: `data:image/jpeg;base64,${b64}`, viewport: vp };
  } catch (e) {
    onEvent({ type: "log", message: `screenshot failed: ${e instanceof Error ? e.message : String(e)}` });
    return undefined;
  }
}

export async function runSteps(
  sessionId: string,
  steps: Step[],
  opts: { onEvent: (e: EngineEvent) => void; signal?: AbortSignal },
): Promise<{ passed: number; failed: number; aborted: boolean }> {
  const { onEvent, signal } = opts;
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY missing");
  if (!projectId) throw new Error("BROWSERBASE_PROJECT_ID missing");

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    browserbaseSessionID: sessionId,
    // keepAlive: stagehand.close() should disconnect Stagehand only,
    // not terminate the Browserbase session — the session lives on so the
    // live iframe can keep showing the collect overlay until closeSession()
    // in the orchestrator's terminate() callback runs.
    keepAlive: true,
  });

  let passed = 0;
  let failed = 0;
  let aborted = false;
  let initialized = false;
  let crashed = false;

  try {
    await stagehand.init();
    initialized = true;

    for (let i = 0; i < steps.length; i++) {
      if (signal?.aborted) { aborted = true; break; }

      const step = steps[i];
      const summary = summarize(step);
      const index = i + 1;
      onEvent({ type: "step_started", index, kind: step.kind, summary });
      const t0 = Date.now();

      try {
        const page = stagehand.context.pages()[0] ?? (await stagehand.context.newPage());
        let data: unknown = undefined;

        switch (step.kind) {
          case "goto": {
            const existing = stagehand.context.pages()[0];
            if (existing) {
              const response = await existing.goto(step.url);
              if (response) {
                // Stash:a response-metadata på page-objektet så pageAudit-steget
                // kan plocka upp HTTP-headers (X-Robots-Tag, Cache-Control, etc.).
                (existing as unknown as { __lovableLastResponse?: unknown }).__lovableLastResponse = {
                  status: response.status(),
                  headers: response.headers(), // Playwright lowercase:ar nycklar
                  url: response.url(),
                };
              }
            } else {
              await stagehand.context.newPage(step.url);
            }
            break;
          }
          case "wait":
            await new Promise((res) => setTimeout(res, step.ms));
            break;
          case "assertText": {
            const deadline = Date.now() + 5000;
            const needle = step.text.toLowerCase();
            let found = false;
            while (Date.now() < deadline) {
              if (signal?.aborted) break;
              try {
                const text = await page.evaluate<string>(
                  "(document.body && document.body.innerText) || ''",
                );
                if (typeof text === "string" && text.toLowerCase().includes(needle)) {
                  found = true;
                  break;
                }
              } catch { /* retry */ }
              await new Promise((res) => setTimeout(res, 300));
            }
            if (!found) throw new Error(`text "${step.text}" not found within 5000ms`);
            break;
          }
          case "click":
          case "fill":
            throw new Error(`step kind "${step.kind}" not yet wired — use "act" instead`);
          case "act":
            data = await stagehand.act(step.instruction);
            break;
          case "extract":
            data = await stagehand.extract(step.instruction);
            break;
          case "observe":
            data = await stagehand.observe(step.instruction);
            break;
          case "collect": {
            await scrollWarmup(page, onEvent);
            const settle = await waitForSettled(page);
            onEvent({ type: "log", message: `settle (collect): ${settle.reason} in ${settle.durationMs}ms` });

            // Screenshot FIRST — Playwright's fullPage scroll may trigger more
            // lazy content; we want rects measured against the same final height.
            const screenshot = await captureScreenshot(page, onEvent);

            // Scroll back to top and let layout settle before measuring rects.
            try {
              await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
              await new Promise((res) => setTimeout(res, 300));
            } catch { /* ignore */ }

            // Now run COLLECT_SCRIPT — document height matches the JPEG.
            const elements = (await page.evaluate(COLLECT_SCRIPT)) as CollectedElement[];
            const filtered = filterCollected(elements, step.target);

            // Mark duplicate controls as groupedAway so aggregates aren't dominated.
            const groups = groupRepeatedControls(filtered);

            const byCategory: Record<string, number> = {};
            const intentBreakdown: Record<string, number> = {};
            const bySection: Record<string, number> = {};
            let aboveFold = 0;
            let primaryConversionCtaCount = 0;
            let competingAboveFold = 0;
            for (const el of filtered) {
              if (el.groupedAway) continue; // dedupe from aggregates
              byCategory[el.category] = (byCategory[el.category] ?? 0) + 1;
              intentBreakdown[el.intent] = (intentBreakdown[el.intent] ?? 0) + 1;
              bySection[el.section] = (bySection[el.section] ?? 0) + 1;
              if (el.position.viewportZone === "above_fold") aboveFold++;
              if (el.category === "cta_primary" && el.intent === "conversion") primaryConversionCtaCount++;
              if (
                (el.category === "cta_primary" ||
                  el.category === "cta_secondary" ||
                  el.category === "form_submit") &&
                el.position.viewportZone === "above_fold" &&
                el.intent !== "navigation"
              ) competingAboveFold++;
            }
            const topVisualWeight = [...filtered]
              .filter((el) => !el.groupedAway)
              .sort((a, b) => b.visualWeight.score - a.visualWeight.score)
              .slice(0, 5)
              .map((el) => ({ selector: el.selector, text: el.text, score: el.visualWeight.score }));

            // Overlay still draws on ALL elements so user sees real density.
            const overlayElements = filtered.map((el) => ({
              selector: el.selector,
              category: el.category,
              rect: el.rect,
            }));
            try {
              const pairs = filtered.map((el) => [el.selector, el.category]);
              await page.evaluate(`(${OVERLAY_FN.toString()})(${JSON.stringify(pairs)})`);
            } catch (e) {
              onEvent({ type: "log", message: `overlay failed: ${e instanceof Error ? e.message : String(e)}` });
            }

            const uniqueCount = filtered.filter((el) => !el.groupedAway).length;
            data = {
              target: step.target,
              count: uniqueCount,
              totalCount: filtered.length,
              byCategory,
              summary: {
                total: uniqueCount,
                aboveFold,
                primaryConversionCtaCount,
                competingAboveFold,
                topVisualWeight,
                intentBreakdown,
                bySection,
                groups,
              },
              elements: filtered,
              overlayElements,
              screenshot,
            };
            onEvent({
              type: "log",
              message: `collect ${step.target}: ${uniqueCount} unique (${filtered.length} total) · ${aboveFold} above fold · ${primaryConversionCtaCount} primary-conversion CTA · competing: ${competingAboveFold} · groups: ${groups.length}`,
            });
            break;
          }


          case "pageAudit": {
            try {
              const full = await runPageAudit(page);
              data = full;
              const sectionOrder = full.sectionOrder;
              // Overlay trust signals on the live page so the user sees what was detected.
              const TRUST_LABELS: Record<string, string> = {
                testimonial: "TE",
                review_rating: "RR",
                stars: "★",
                trusted_by: "TB",
                customer_logos: "LO",
                review_badges: "RB",
                certification: "CE",
                guarantee: "GU",
                secure_payment: "SP",
                contact_info: "CI",
                org_number: "OR",
                press_mention: "PR",
                social_proof_count: "SC",
              };
              const trustPairs: Array<[string, string, string]> = full.trustSignals
                .filter((t) => !!t.selector && !!t.rect)
                .map((t) => [t.selector!, t.type, TRUST_LABELS[t.type] ?? "?"]);
              try {
                await page.evaluate(`(${OVERLAY_FN.toString()})(${JSON.stringify(trustPairs)})`);
              } catch (e) {
                onEvent({ type: "log", message: `overlay failed: ${e instanceof Error ? e.message : String(e)}` });
              }
              // Emit overlay rects for the frozen viewport (scoped to the three
              // trust types the user requested to see marked on the screenshot).
              const trustOverlay = full.trustSignals
                .filter((t) => !!t.selector && !!t.rect &&
                  (t.type === "testimonial" ||
                   t.type === "review_badges" ||
                   t.type === "social_proof_count" ||
                   t.type === "trusted_by" ||
                   t.type === "customer_logos"))
                .map((t) => ({ selector: t.selector!, category: t.type, rect: t.rect! }));
              // Strip selector from snapshot arrays now that overlay is built.
              const trustForSnapshot = full.trustSignals.map((t) => {
                const { selector: _s, _block, ...rest } = t as typeof t & { _block?: unknown };
                return rest;
              });
              const ctasForSnapshot = full.ctas.map(({ selector: _s, ...rest }) => rest);
              data = {
                ...full,
                trustSignals: trustForSnapshot,
                ctas: ctasForSnapshot,
                overlayElements: trustOverlay,
              };
              onEvent({
                type: "log",
                message: `pageAudit: sections ${full.sections.length} [${sectionOrder.slice(0, 6).join("→")}${sectionOrder.length > 6 ? "→…" : ""}] · trust ${full.trustSignals.length} (${full.trustSummary.aboveFold} af) · ctas ${full.ctas.length} (${full.pageSummary.primaryCtaCount} primary) · forms ${full.forms.length} · nav ${full.navigation.topNavCount}/${full.navigation.footerNavCount} · trustDebug ${((full as unknown as { trustDebug?: unknown[] }).trustDebug || []).length}`,
              });

              // Mobile viewport pass — last DOM-dependent step. Reload in mobile
              // emulation gives mobile-rendered DOM (hamburger menu, real mobile
              // layout). Failure leaves layout.mobile/viewportDelta as null.
              if (full.layout) {
                const mobilePass = await runMobilePass(page, full.navigation, full.layout.desktop);
                if (mobilePass.mobile && mobilePass.viewportDelta) {
                  data = {
                    ...(data as typeof full & { overlayElements?: unknown }),
                    layout: {
                      ...full.layout,
                      mobile: mobilePass.mobile,
                    },
                    viewportDelta: mobilePass.viewportDelta,
                  };
                  const vd = mobilePass.viewportDelta;
                  onEvent({
                    type: "log",
                    message: `pageAudit/mobile: af cta ${vd.aboveFoldCtaCount.desktop}→${vd.aboveFoldCtaCount.mobile} · foldDepth ${vd.foldDepthFirstCtaPx.desktop}→${vd.foldDepthFirstCtaPx.mobile}px · af trust ${vd.aboveFoldTrustCount.desktop}→${vd.aboveFoldTrustCount.mobile} · heroVisible ${vd.heroVisibleMobile}`,
                  });
                } else {
                  data = {
                    ...(data as typeof full & { overlayElements?: unknown }),
                    layout: {
                      ...full.layout,
                      mobile: null,
                    },
                    viewportDelta: null,
                  };
                  onEvent({ type: "log", message: `pageAudit/mobile: skipped` });
                }
              }
            } catch (e) {
              throw new Error(`pageAudit failed: ${e instanceof Error ? e.message : String(e)}`);
            }
            break;
          }

        }


        void page;

        passed++;
        onEvent({ type: "step_passed", index, kind: step.kind, summary, durationMs: Date.now() - t0, data });
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        onEvent({ type: "step_failed", index, kind: step.kind, summary, durationMs: Date.now() - t0, error: message });
        break; // stop on first failure
      }
    }
  } catch (err) {
    crashed = true;
    throw err;
  } finally {
    // Only disconnect Stagehand if init failed or the run crashed before the
    // orchestrator's hold/close window. Otherwise leave Stagehand attached so
    // the live-view CDP/WebSocket isn't torn down — closeSession(sessionId)
    // in the orchestrator is the single source of truth for ending the session.
    if (!initialized || crashed) {
      try { await stagehand.close(); } catch { /* ignore */ }
      onEvent({ type: "log", message: "stagehand closed (init/crash cleanup)" });
    } else {
      onEvent({ type: "log", message: "stagehand left attached — session ends via closeSession()" });
    }
  }

  return { passed, failed, aborted };
}
