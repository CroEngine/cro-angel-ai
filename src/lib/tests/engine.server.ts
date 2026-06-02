// Stagehand-based step engine. Runs against an already-created Browserbase session.

import { Stagehand } from "@browserbasehq/stagehand";

import { COLLECT_SCRIPT } from "./scripts/collect";
import { OVERLAY_FN } from "./scripts/overlay";
import { PAGE_AUDIT_SCRIPT } from "./scripts/pageAudit";
import { SECTIONS_SCRIPT } from "./scripts/sections";
import { TRUST_SIGNALS_SCRIPT } from "./scripts/trustSignals";
import { CTAS_SCRIPT } from "./scripts/ctas";
import { FORMS_SCRIPT } from "./scripts/forms";
import { NAVIGATION_SCRIPT } from "./scripts/navigation";
import { VISUAL_HIERARCHY_SCRIPT } from "./scripts/visualHierarchy";

import {
  buildPageSummary,
  buildTrustSummary,
  deriveHero,
  enrichSections,
  groupRepeatedControls,
} from "./audit-helpers";

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
    const raw = await page.screenshot({ type: "jpeg", quality: 50, fullPage: true });
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
            if (existing) await existing.goto(step.url);
            else await stagehand.context.newPage(step.url);
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
            let primaryCtaCount = 0;
            let competingAboveFold = 0;
            for (const el of filtered) {
              if (el.groupedAway) continue; // dedupe from aggregates
              byCategory[el.category] = (byCategory[el.category] ?? 0) + 1;
              intentBreakdown[el.intent] = (intentBreakdown[el.intent] ?? 0) + 1;
              bySection[el.section] = (bySection[el.section] ?? 0) + 1;
              if (el.position.viewportZone === "above_fold") aboveFold++;
              if (el.category === "cta_primary" && el.intent === "conversion") primaryCtaCount++;
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
                primaryCtaCount,
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
              message: `collect ${step.target}: ${uniqueCount} unique (${filtered.length} total) · ${aboveFold} above fold · ${primaryCtaCount} primary CTA · competing: ${competingAboveFold} · groups: ${groups.length}`,
            });
            break;
          }

          case "pageAudit": {
            try {
              // Run base audit + all v2 extractors in PARALLEL.
              // They are independent read-only DOM scans → big speedup over the previous serial chain.
              const [
                rawAudit,
                fetched,
                sections,
                trustSignals,
                ctas,
                forms,
                navigation,
                visualHierarchy,
                dims,
              ] = await Promise.all([
                page.evaluate(PAGE_AUDIT_SCRIPT),
                page.evaluate(`
                  (async () => {
                    const origin = location.origin;
                    const out = { robots: null, sitemap: null };
                    try {
                      const r = await fetch(origin + '/robots.txt', { credentials: 'omit' });
                      if (r.ok) out.robots = await r.text();
                    } catch (e) {}
                    try {
                      const r = await fetch(origin + '/sitemap.xml', { credentials: 'omit' });
                      if (r.ok) out.sitemap = await r.text();
                    } catch (e) {}
                    return out;
                  })()
                `),
                page.evaluate(SECTIONS_SCRIPT),
                page.evaluate(TRUST_SIGNALS_SCRIPT),
                page.evaluate(CTAS_SCRIPT),
                page.evaluate(FORMS_SCRIPT),
                page.evaluate(NAVIGATION_SCRIPT),
                page.evaluate(VISUAL_HIERARCHY_SCRIPT),
                page.evaluate(
                  "({ pageHeightPx: document.documentElement.scrollHeight, foldHeightPx: window.innerHeight })",
                ),
              ]);

              const audit = rawAudit as Omit<
                PageAuditData,
                | "robotsTxt"
                | "sitemap"
                | "flags"
                | "url"
                | "sections"
                | "sectionOrder"
                | "trustSignals"
                | "trustSummary"
                | "ctas"
                | "forms"
                | "navigation"
                | "visualHierarchy"
                | "pageSummary"
                | "hero"
              > & { url: string };

              const robotsSitemap = fetched as { robots: string | null; sitemap: string | null };
              const robotsTxt = { exists: false, blocksAll: false, hasSitemap: false };
              const sitemap = { exists: false, urlCount: 0 };
              if (robotsSitemap.robots) {
                robotsTxt.exists = true;
                robotsTxt.blocksAll = /User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*$/im.test(robotsSitemap.robots);
                robotsTxt.hasSitemap = /^Sitemap:\s*\S+/im.test(robotsSitemap.robots);
              }
              if (robotsSitemap.sitemap) {
                sitemap.exists = true;
                sitemap.urlCount = (robotsSitemap.sitemap.match(/<loc>/g) ?? []).length;
              }

              // Set robotsTxtAllows + final indexable now that we know robots.txt
              if (audit.indexability) {
                audit.indexability.robotsTxtAllows = !robotsTxt.blocksAll;
                audit.indexability.indexable =
                  !audit.indexability.noindex && audit.indexability.robotsTxtAllows;
              }


              const sectionsTyped = sections as PageSection[];
              const trustTyped = trustSignals as TrustSignal[];
              const ctasTyped = ctas as CTAEntity[];
              const formsTyped = forms as FormEntity[];
              const navTyped = navigation as NavigationData;
              const hierarchyTyped = visualHierarchy as VisualHierarchyEntry[];
              const dimsTyped = dims as { pageHeightPx: number; foldHeightPx: number };

              enrichSections(sectionsTyped, ctasTyped, trustTyped, formsTyped);
              const sectionOrder = sectionsTyped.map((s) => s.type);
              const trustSummary = buildTrustSummary(trustTyped);
              const pageSummary = buildPageSummary({
                ctas: ctasTyped,
                trustSignals: trustTyped,
                trustSummary,
                forms: formsTyped,
                navigation: navTyped,
                sections: sectionsTyped,
                dims: dimsTyped,
              });
              const hero = deriveHero(sectionsTyped, ctasTyped);

              const full: PageAuditData = {
                ...audit,
                robotsTxt,
                sitemap,
                sections: sectionsTyped,
                sectionOrder,
                trustSignals: trustTyped,
                trustSummary,
                ctas: ctasTyped,
                forms: formsTyped,
                navigation: navTyped,
                visualHierarchy: hierarchyTyped,
                pageSummary,
                hero,
                // Collect-only: no derived diagnosis flags. Interpretation lives in the AI layer.
                flags: [],
              };
              data = full;
              onEvent({
                type: "log",
                message: `pageAudit: sections ${sectionsTyped.length} [${sectionOrder.slice(0, 6).join("→")}${sectionOrder.length > 6 ? "→…" : ""}] · trust ${trustTyped.length} (${trustSummary.aboveFold} af) · ctas ${ctasTyped.length} (${pageSummary.primaryCtaCount} primary) · forms ${formsTyped.length} · nav ${navTyped.topNavCount}/${navTyped.footerNavCount}`,
              });
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
