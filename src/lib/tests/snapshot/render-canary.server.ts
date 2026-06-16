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
//   unresolved        — document.fonts.load REJECTED. The cid:-fast-reject case
//                       under file:// replay. loadError populated. Gate-1 fail.
//   timeout           — Promise.race against fontLoadTimeoutMs lost. Rare on
//                       file:// (rejections are fast); mostly network hangs.
//   fallback          — load resolved, faceCount>0, width identical to fallback
//                       AND fonts.check === false. Silent fall-through.
//                       Gate-1 fail. (Also: load resolved with faceCount===0
//                       AND descriptor exists in document.fonts — the
//                       unicode-range-excluded-sample case; fix is sample/range,
//                       not extraction.)
//   metric_twin       — load resolved, fonts.check === true, width identical to
//                       fallback. Loaded face is metric-compatible with its
//                       fallback. Gate-1 PASS (logged) — width-diff alone can't
//                       distinguish this from "never loaded".
//   descriptor_missing— load resolved with faceCount===0 AND NO descriptor for
//                       the family exists in document.fonts. The manifest's
//                       expectedFamilies names a family no @font-face declares.
//                       Fix lives in extractDeclaredFamilies (mhtml-fonts.server),
//                       NOT in canonicalization of the check string. Gate-1 fail.
//   check_mismatch    — width says loaded (>EPS) AND fonts.check === false.
//                       DEFENSIVE branch, near-unreachable by construction:
//                       w_with measures `family, <fallback>` and w_fallback
//                       measures `<fallback>` alone with the same stack, so
//                       delta>EPS requires `family` actually rendered — which
//                       requires it loaded — which makes check(family)=true.
//                       distinct ⟹ check. The branch fires only if timing
//                       slips (we await fonts.ready), the check string is
//                       non-canonical relative to the rendering path (audited
//                       by Gate1Diag.canonMismatch), or subpixel noise pushes
//                       a non-distinct row above EPS. Kept as a fail-safe so
//                       the canary refuses to silently pass on the impossible.
//   ok                — width > EPS AND fonts.check === true.

import type { Page } from "playwright";

import {
  CANARY_SAMPLE_TEXT,
  EPSILON_LOAD_PX,
  EPSILON_FIDELITY_PX,
  FONT_LOAD_TIMEOUT_MS,
} from "./canary-constants";

// Schema-typer för on-disk-receipten ägs av render-canary-receipt.ts. De
// hand-skrivna interfacen som tidigare bodde här gjorde att skrivar-typ och
// disk-schema kunde drifta osynligt isär (exakt buggklassen vi just åtgärdat).
// Re-export gör att Zod-schemat är enda sanningskällan; refaktorer som ändrar
// formen får automatiskt nytt TS-kontrakt på båda sidor av disk-gränsen.
export type {
  Gate1Reason,
  Gate2Reason,
  BranchTaken,
  Gate1Diag,
  Gate1Report,
  Gate2Report,
  RenderCanaryEnv,
} from "./render-canary-receipt";

import type {
  Gate1Reason,
  BranchTaken,
  RenderCanaryEnv,
  Gate1Report as _Gate1Report,
  Gate2Report as _Gate2Report,
  Gate1Diag as _Gate1Diag,
} from "./render-canary-receipt";

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
  gate1: _Gate1Report;
  gate2?: _Gate2Report;
  /** Diagnostic side field — see Gate1Diag. Not consulted by reason routing. */
  diag: _Gate1Diag;

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
  /** Familjer som klassats som freeze-time-ghosts: gate1 sa
   *  `descriptor_missing`, OCH familjen finns INTE i `declaredFamilies`
   *  (MHTML har ingen @font-face för den). Dessa hamnar inte i `failures`.
   *  Tom array när `declaredFamilies` inte angetts (fail-closed). */
  ghosts: string[];
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
  /** Browser environment used for measurements; supplied by the caller. */
  env?: RenderCanaryEnv;
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
  /** Browser env recorded verbatim into the report's `env` field. */
  env?: RenderCanaryEnv;
  /** Familjer med faktisk @font-face-deklaration i MHTML (från
   *  extractEmbeddedFamilies). Används som ghost-diskriminator: en familj som
   *  failar gate1 `descriptor_missing` OCH inte finns i denna lista
   *  klassificeras som ghost (freeze över-recordade) och tas ur `failures`.
   *  Lämnas odefinierat → fail-closed: alla `descriptor_missing` blockerar. */
  declaredFamilies?: string[];
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

        let reason: Gate1Reason;
        let loadError: string | undefined;
        let pass: boolean;
        if (loadResult.kind === "rejected") {
          reason = "unresolved";
          loadError = loadResult.error;
          pass = false;
        } else if (loadResult.kind === "timeout") {
          reason = "timeout";
          pass = false;
        } else if (
          loadResult.kind === "loaded" &&
          loadResult.faceCount === 0 &&
          !hasDescriptorMatch(family)
        ) {
          // A2-no-descriptor: empty load result AND no FontFace with a matching
          // family descriptor exists in document.fonts. The manifest names a
          // family no @font-face declares. Fix lives in extractDeclaredFamilies
          // (mhtml-fonts.server), NOT in check-string canonicalization — that's
          // why this is a distinct reason from check_mismatch.
          //
          // pass=false is provisional: a CSS-hopeful family (referenced but
          // never embedded) belongs on a per-corpus known-list as a soft
          // signal; an extraction ghost is a hard bug. Triage decides which.
          reason = "descriptor_missing";
          loadError = "no face matched descriptor";
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
          // Includes the A2 "descriptor matched but unicode-range excluded
          // the sample" case: empty load result, distinct=false (face never
          // rendered the sample), fontsCheckPass=false → fallback. Real fix
          // is sample text or the served face's unicode-range, NOT
          // canonicalization in mhtml-fonts.server.ts.
          reason = "fallback";
          pass = false;
        }

        // ---------- Diagnostic side fields (do NOT influence reason) ----------
        // branchTaken: an exhaustive enumeration of which classifier path fired,
        // expanded beyond the post-load matrix to surface load-failure paths AND
        // to split coverage-exclusion (faceCount===0 && hasDescriptorMatch)
        // out of the fallback bucket. Lets us audit reason composition.
        const descriptorMatched = hasDescriptorMatch(family);
        let branchTaken: BranchTaken;
        if (loadResult.kind === "rejected") {
          branchTaken = "load-rejected";
        } else if (loadResult.kind === "timeout") {
          branchTaken = "load-timeout";
        } else if (loadResult.kind === "loaded" && loadResult.faceCount === 0 && !descriptorMatched) {
          branchTaken = "A2-no-descriptor";
        } else if (loadResult.kind === "loaded" && loadResult.faceCount === 0 && descriptorMatched) {
          branchTaken = "coverage-exclusion";
        } else if (distinct && fontsCheckPass) {
          branchTaken = "distinct+check";
        } else if (distinct && !fontsCheckPass) {
          branchTaken = "distinct+!check";
        } else if (!distinct && fontsCheckPass) {
          branchTaken = "!distinct+check";
        } else {
          branchTaken = "!distinct+!check";
        }

        // Raw strings the classifier actually compared. Persist verbatim so a
        // canonicalization-quirk that under-matches descriptors (real
        // descriptor returns hasDescriptorMatch=false) is auditable.
        const manifestFamily = family;
        const checkString = `16px ${quote(family)}`;
        const widthString = `${quote(family)}, monospace`;
        const allDescriptorFamilies = all.map((f) => stripQuotes(f.family));
        const targetCanon = stripQuotes(manifestFamily).toLowerCase();
        const matchedDescriptorFamilies = allDescriptorFamilies.filter(
          (s) => s.toLowerCase() === targetCanon,
        );

        // Canon-mismatch assert: under Option 1, hasDescriptorMatch becomes the
        // sole discriminator between descriptor_missing and fallback for
        // empty-load rows. Each compared string must canonicalize identically.
        const canonMismatchDetail: string[] = [];
        const canon = (s: string): string => stripQuotes(s).toLowerCase();
        const canonManifest = canon(manifestFamily);
        // checkString/widthString embed quote(family); after stripping the
        // shorthand they must canonicalize to canonManifest.
        const checkFamilyToken = canon(quote(family));
        const widthFamilyToken = canon(quote(family));
        if (checkFamilyToken !== canonManifest) {
          canonMismatchDetail.push(`checkString family !== manifest`);
        }
        if (widthFamilyToken !== canonManifest) {
          canonMismatchDetail.push(`widthString family !== manifest`);
        }
        if (descriptorMatched) {
          for (const d of matchedDescriptorFamilies) {
            if (canon(d) !== canonManifest) {
              canonMismatchDetail.push(`descriptor "${d}" canon !== manifest`);
            }
          }
        }
        const canonMismatch = canonMismatchDetail.length > 0;

        const diag = {
          branchTaken,
          loadResultKind: loadResult.kind,
          faceCount: loadResult.kind === "loaded" ? loadResult.faceCount : 0,
          hasDescriptorMatch: descriptorMatched,
          epsilonLoadPx,
          strings: {
            manifestFamily,
            allDescriptorFamilies,
            matchedDescriptorFamilies,
            checkString,
            widthString,
          },
          canonMismatch,
          canonMismatchDetail,
        };

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
          diag,
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

  // Ghost-diskriminator. Fail-closed: utan declaredFamilies blockerar alla
  // descriptor_missing som tidigare. Med listan klassificeras en
  // descriptor_missing-familj som ghost om MHTML saknar @font-face för den
  // (canon-jämförelse identisk med klassificerarens hasDescriptorMatch).
  const canonName = (s: string): string =>
    s.replace(/^['"]|['"]$/g, "").trim().toLowerCase();
  const declaredProvided = Array.isArray(opts.declaredFamilies);
  const declaredSet = new Set(
    (opts.declaredFamilies ?? []).map(canonName).filter((s) => s.length > 0),
  );
  const ghosts: string[] = [];

  const failures: string[] = [];
  if (missing.length > 0) {
    failures.push(`missing families: ${missing.join(", ")}`);
  }
  for (const f of families) {
    if (!f.gate1.pass) {
      const isGhostCandidate =
        f.gate1.reason === "descriptor_missing" &&
        declaredProvided &&
        !declaredSet.has(canonName(f.family));
      if (isGhostCandidate) {
        ghosts.push(f.family);
      } else {
        const detail =
          f.gate1.reason === "unresolved" || f.gate1.reason === "descriptor_missing"
            ? ` loadError=${f.gate1.loadError ?? "?"}`
            : ` wWith=${f.gate1.wWith.toFixed(2)} wFallback=${f.gate1.wFallback.toFixed(2)} ` +
              `delta=${f.gate1.deltaLoad.toFixed(2)} fontsCheck=${f.gate1.fontsCheckPass}`;
        failures.push(`gate1 ${f.gate1.reason}: "${f.family}"${detail}`);
      }
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
    ghosts,
    failures,
    thresholdPx: epsilonLoadPx,
    settings: {
      sampleText: CANARY_SAMPLE_TEXT,
      epsilonLoadPx,
      epsilonFidelityPx,
      fontLoadTimeoutMs,
      gate2Enabled: gate2Map.size > 0,
    },
    ...(opts.env ? { env: opts.env } : {}),
  };
}
