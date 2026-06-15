// Render-driven font canary. Gate before Phase 2 (subsetting).
//
// Two gates, surfaced as named reasons rather than a boolean blob:
//
//   Gate 1 (always run): "did the page actually render this family, or did it
//   silently fall back to OS fonts?" Reference = system fallback (monospace).
//   Per family, |w_with - w_fallback| > EPSILON_LOAD_PX is the loaded signal;
//   document.fonts.check is the tie-breaker for the metric-twin edge case.
//
//   Gate 2 (opt-in): "did the subset preserve the original font's metrics?"
//   Reference = the original un-subset face, registered as a FontFace from
//   originalUrl, measured the same way. Boundary documented in plan.md: this
//   catches advance/kerning drift only; outline/hinting drift that preserves
//   advance width is invisible to width-diff.
//
// Reason taxonomy is the load-bearing diagnostic surface — callers (Vitest,
// scripts/render-canary, CI dashboards) read these strings, not the booleans:
//
//   unresolved    — document.fonts.load REJECTED. The cid:-fast-reject case
//                   under file:// replay. loadError populated. Gate-1 fail.
//   timeout       — Promise.race against fontLoadTimeoutMs lost. Rare on
//                   file:// (rejections are fast); mostly network-face hangs.
//   fallback      — load resolved but width identical to fallback AND
//                   fonts.check === false. Silent fall-through. Gate-1 fail.
//   metric_twin   — load resolved, fonts.check === true, width identical to
//                   fallback. The loaded face is metric-compatible with its
//                   fallback. Gate-1 PASS (logged) — width-diff alone can't
//                   distinguish this from "never loaded".
//   check_mismatch— width says loaded (>EPS), fonts.check === false. Almost
//                   always a family-string mismatch between the @font-face
//                   descriptor and what was passed to the canary. Gate-1 FAIL
//                   — refuses to silently pass on a misconfiguration.
//   ok            — width > EPS AND fonts.check === true.

import type { Page } from "playwright";

import {
  CANARY_SAMPLE_TEXT,
  EPSILON_LOAD_PX,
  EPSILON_FIDELITY_PX,
  FONT_LOAD_TIMEOUT_MS,
} from "./canary-constants";

export type Gate1Reason =
  | "ok"
  | "unresolved"
  | "fallback"
  | "metric_twin"
  | "check_mismatch"
  | "timeout";

export type Gate2Reason = "ok" | "drift" | "skipped";

export interface Gate1Report {
  wWith: number;
  wFallback: number;
  deltaLoad: number;
  fontsCheckPass: boolean;
  pass: boolean;
  reason: Gate1Reason;
  loadError?: string;
}

export interface Gate2Report {
  wOrig: number;
  deltaSubset: number;
  pass: boolean;
  reason: Gate2Reason;
}

export interface FamilyReport {
  family: string;
  registered: boolean;
  loadedCount: number;
  totalCount: number;
  sampleText: string;
  /** Source of truth is the @font-face descriptor (sampleSource always "default"
   *  now that the canary takes its expected families from the MHTML manifest).
   *  Kept on the report so older dashboards reading sampleSource don't break. */
  sampleSource: "dom" | "default";
  gate1: Gate1Report;
  gate2?: Gate2Report;

  /** @deprecated one-cycle alias for gate1.{wWith,wFallback,deltaLoad,...} +
   *  the legacy `distinct` boolean. Will be removed once external readers
   *  (render-canary.families.json consumers, dashboards) migrate to gate1. */
  widthVsFallback: {
    embedded: number;
    fallback: number;
    diff: number;
    distinct: boolean;
  };
  /** @deprecated alias for gate1.fontsCheckPass. */
  fontsCheckPass: boolean;
}

export interface RenderCanaryReport {
  ok: boolean;
  expected: string[];
  diagnostics: {
    documentFontsSize: number;
    documentFontsLoaded: number;
    documentFontsFamilies: string[];
  };
  families: FamilyReport[];
  /** Families absent from document.fonts entirely (never registered). */
  missing: string[];
  /** Families that registered but render identically to fallback — informational. */
  unusedRegistered: string[];
  failures: string[];
  thresholdPx: number;
  /** Per-call settings for reproducibility. */
  settings: {
    sampleText: string;
    epsilonLoadPx: number;
    epsilonFidelityPx: number;
    fontLoadTimeoutMs: number;
    gate2Enabled: boolean;
  };
}

export interface Gate2Source {
  /** Verbatim @font-face descriptor for the family. */
  family: string;
  /** URL the original (un-subset) font binary can be loaded from at canary
   *  time. Typically a file:// path written next to the subset, or a cid:
   *  registered in the MHTML alongside the subset. Must be reachable from
   *  the page context. */
  originalUrl: string;
}

export interface RunCanaryOpts {
  /** Override the Gate-1 threshold. Defaults to EPSILON_LOAD_PX. */
  epsilonLoadPx?: number;
  /** Override the Gate-2 threshold. Defaults to EPSILON_FIDELITY_PX. */
  epsilonFidelityPx?: number;
  /** Override the per-family load timeout. Vitest negative cases pass a small
   *  value so a fast-reject doesn't burn the full default. */
  fontLoadTimeoutMs?: number;
  /** When non-empty, Gate 2 runs for the listed families using each entry's
   *  originalUrl as the un-subset reference. Families not in this list get
   *  gate2.reason = "skipped". */
  gate2Sources?: Gate2Source[];
}

export async function runRenderCanary(
  page: Page,
  expectedFamilies: string[],
  opts: RunCanaryOpts = {},
): Promise<RenderCanaryReport> {
  const epsilonLoadPx = opts.epsilonLoadPx ?? EPSILON_LOAD_PX;
  const epsilonFidelityPx = opts.epsilonFidelityPx ?? EPSILON_FIDELITY_PX;
  const fontLoadTimeoutMs = opts.fontLoadTimeoutMs ?? FONT_LOAD_TIMEOUT_MS;
  const gate2Map = new Map((opts.gate2Sources ?? []).map((s) => [s.family, s.originalUrl]));

  // Best-effort settle. Don't block on rejected loads — we want to record
  // the rejection per family below.
  await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});

  const raw = (await page.evaluate(
    async ({
      families,
      sampleText,
      epsilonLoadPx,
      fontLoadTimeoutMs,
      gate2Entries,
      epsilonFidelityPx,
    }: {
      families: string[];
      sampleText: string;
      epsilonLoadPx: number;
      fontLoadTimeoutMs: number;
      gate2Entries: Array<[string, string]>;
      epsilonFidelityPx: number;
    }) => {
      const stripQuotes = (s: string): string => s.replace(/^['"]|['"]$/g, "").trim();
      const quote = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;
      const all = Array.from(document.fonts as unknown as Iterable<FontFace>);
      const diagnostics = {
        documentFontsSize: document.fonts.size,
        documentFontsLoaded: all.filter((f) => f.status === "loaded").length,
        documentFontsFamilies: Array.from(new Set(all.map((f) => stripQuotes(f.family)))),
      };

      // Hidden-but-laid-out measuring node. position:absolute + visibility:hidden
      // keeps the element in the layout tree (so width is real and faces load)
      // while keeping it off-screen and unpainted. display:none would zero the
      // width AND skip face load — exactly the failure the canary exists to
      // detect would silently null the measurement.
      function measureWidth(text: string, fontFamily: string): number {
        const span = document.createElement("span");
        span.textContent = text;
        span.style.cssText =
          "position:absolute;left:-99999px;top:-99999px;visibility:hidden;" +
          `white-space:pre;font:16px ${fontFamily};letter-spacing:normal;`;
        document.body.appendChild(span);
        const w = span.getBoundingClientRect().width;
        span.remove();
        return w;
      }

      function timeoutPromise(ms: number): Promise<{ kind: "timeout" }> {
        return new Promise((resolve) => setTimeout(() => resolve({ kind: "timeout" }), ms));
      }

      type LoadResult =
        | { kind: "loaded"; faceCount: number }
        | { kind: "rejected"; error: string }
        | { kind: "timeout" };

      async function tryLoad(family: string): Promise<LoadResult> {
        const loadPromise = document.fonts
          .load(`1em ${quote(family)}`, sampleText)
          .then((faces): LoadResult => ({
            kind: "loaded",
            faceCount: Array.isArray(faces) ? faces.length : 0,
          }))
          .catch((e): LoadResult => ({
            kind: "rejected",
            error: e instanceof Error ? e.message : String(e),
          }));
        return Promise.race([loadPromise, timeoutPromise(fontLoadTimeoutMs)]);
      }

      // A2 discriminator: document.fonts.load(family, text) resolves to []
      // in TWO distinct cases. Pick by iterating document.fonts for a
      // descriptor match (case/quote-normalized), NOT by collapsing both
      // to check_mismatch:
      //   - no descriptor match     → genuine name mismatch → check_mismatch
      //   - descriptor match exists → unicode-range excluded the sample →
      //     fall through to the normal width+check path (yields fallback)
      function hasDescriptorMatch(family: string): boolean {
        const target = stripQuotes(family).toLowerCase();
        return all.some((f) => stripQuotes(f.family).toLowerCase() === target);
      }

      const gate2Lookup = new Map(gate2Entries);

      async function runGate2(family: string): Promise<{
        wOrig: number;
        deltaSubset: number;
        pass: boolean;
        reason: "ok" | "drift" | "skipped";
      } | undefined> {
        const url = gate2Lookup.get(family);
        if (!url) {
          return { wOrig: 0, deltaSubset: 0, pass: true, reason: "skipped" };
        }
        // Register the original under a synthetic family name so it never
        // collides with the subset already in document.fonts.
        const origFamily = `__canary_orig_${family}`;
        try {
          const face = new FontFace(origFamily, `url("${url}")`);
          await face.load();
          document.fonts.add(face);
          const wOrig = measureWidth(sampleText, `${quote(origFamily)}, monospace`);
          const wSubset = measureWidth(sampleText, `${quote(family)}, monospace`);
          const deltaSubset = Math.abs(wSubset - wOrig);
          const pass = deltaSubset < epsilonFidelityPx;
          return { wOrig, deltaSubset, pass, reason: pass ? "ok" : "drift" };
        } catch {
          // If the original can't be loaded, treat Gate 2 as skipped rather
          // than as a Gate-2 fail — the test is "did the subset drift", not
          // "is the original reachable". The harness logs the family.
          return { wOrig: 0, deltaSubset: 0, pass: true, reason: "skipped" };
        }
      }

      const out = [];
      for (const family of families) {
        const familyFaces = all.filter(
          (f) => stripQuotes(f.family).toLowerCase() === family.toLowerCase(),
        );
        const registered = familyFaces.length > 0;
        const loadedCount = familyFaces.filter((f) => f.status === "loaded").length;
        const totalCount = familyFaces.length;

        const loadResult = await tryLoad(family);

        let fontsCheckPass = false;
        try {
          fontsCheckPass = document.fonts.check(`16px ${quote(family)}`, sampleText);
        } catch {
          fontsCheckPass = false;
        }

        const wWith = measureWidth(sampleText, `${quote(family)}, monospace`);
        const wFallback = measureWidth(sampleText, `monospace`);
        const deltaLoad = Math.abs(wWith - wFallback);
        const distinct = deltaLoad > epsilonLoadPx;

        let reason: "ok" | "unresolved" | "fallback" | "metric_twin" | "check_mismatch" | "timeout";
        let loadError: string | undefined;
        let pass: boolean;
        if (loadResult.kind === "rejected") {
          reason = "unresolved";
          loadError = loadResult.error;
          pass = false;
        } else if (loadResult.kind === "timeout") {
          reason = "timeout";
          pass = false;
        } else if (distinct && fontsCheckPass) {
          reason = "ok";
          pass = true;
        } else if (distinct && !fontsCheckPass) {
          reason = "check_mismatch";
          pass = false;
        } else if (!distinct && fontsCheckPass) {
          reason = "metric_twin";
          pass = true;
        } else {
          reason = "fallback";
          pass = false;
        }

        const gate2 = await runGate2(family);

        out.push({
          family,
          registered,
          loadedCount,
          totalCount,
          sampleText,
          sampleSource: "default" as const,
          gate1: {
            wWith,
            wFallback,
            deltaLoad,
            fontsCheckPass,
            pass,
            reason,
            ...(loadError ? { loadError } : {}),
          },
          gate2,
          // Deprecated aliases (one migration cycle).
          widthVsFallback: {
            embedded: wWith,
            fallback: wFallback,
            diff: deltaLoad,
            distinct,
          },
          fontsCheckPass,
        });
      }

      return { diagnostics, families: out };
    },
    {
      families: expectedFamilies,
      sampleText: CANARY_SAMPLE_TEXT,
      epsilonLoadPx,
      fontLoadTimeoutMs,
      gate2Entries: Array.from(gate2Map.entries()),
      epsilonFidelityPx,
    },
  )) as {
    diagnostics: RenderCanaryReport["diagnostics"];
    families: FamilyReport[];
  };

  const families = raw.families;
  const missing = families.filter((f) => !f.registered).map((f) => f.family);
  // Informational: registered family whose width is identical to fallback.
  // Doesn't block — that's a Gate-1 reason now (fallback / metric_twin).
  const unusedRegistered = families
    .filter((f) => f.registered && !f.widthVsFallback.distinct)
    .map((f) => f.family);

  const failures: string[] = [];
  if (missing.length > 0) {
    failures.push(`missing families: ${missing.join(", ")}`);
  }
  for (const f of families) {
    if (!f.gate1.pass) {
      const detail =
        f.gate1.reason === "unresolved"
          ? ` loadError=${f.gate1.loadError ?? "?"}`
          : ` wWith=${f.gate1.wWith.toFixed(2)} wFallback=${f.gate1.wFallback.toFixed(2)} ` +
            `delta=${f.gate1.deltaLoad.toFixed(2)} fontsCheck=${f.gate1.fontsCheckPass}`;
      failures.push(`gate1 ${f.gate1.reason}: "${f.family}"${detail}`);
    }
    if (f.gate2 && !f.gate2.pass) {
      failures.push(
        `gate2 ${f.gate2.reason}: "${f.family}" deltaSubset=${f.gate2.deltaSubset.toFixed(2)}`,
      );
    }
  }

  return {
    ok: failures.length === 0,
    expected: expectedFamilies,
    diagnostics: raw.diagnostics,
    families,
    missing,
    unusedRegistered,
    failures,
    thresholdPx: epsilonLoadPx,
    settings: {
      sampleText: CANARY_SAMPLE_TEXT,
      epsilonLoadPx,
      epsilonFidelityPx,
      fontLoadTimeoutMs,
      gate2Enabled: gate2Map.size > 0,
    },
  };
}
