// Lean CRO projection — the curated, deterministic signal view of the golden.
//
// collect.elements is the FULL record (~78% low-signal for CRO: the hidden nav
// IA, chrome, "®" fragments, empty-text links). This projects it down to the
// handful of signals a CRO analysis actually needs — value prop, the conversion
// path, trust, friction, visual hierarchy, page flow, and the score — so the
// Angel LLM (and any analytics) reasons over signal, not noise.
//
// Pure + deterministic, no IO (like croScore.ts / llmContext.ts). Stored in the
// golden as the ready LLM input and regression-tested by the same snapshot diff.
// The full collect.elements stays as the substrate; this is the curated lens.

import { EXTRACTOR_VERSION } from "./extractor-version";
import type { CroScore, PageType } from "./croScore";

interface ProjEl {
  text: string;
  category: string;
  intent: string;
  section: string;
  aboveFold?: boolean;
  visible?: boolean;
  score?: number;
}
interface GoldenIn {
  collect?: { elements?: ProjEl[] } | null;
  pageAudit?: {
    hero?: { headline?: string; primaryCtaText?: string } | null;
    trustSummary?: { total?: number; aboveFold?: number; byType?: Record<string, number> } | null;
    sectionOrder?: string[] | null;
  } | null;
  croScore?: CroScore | null;
}

export interface ProjCta {
  text: string;
  intent: string;
  section: string;
  aboveFold: boolean;
  salience: number;
}

export interface CroProjection {
  extractorVersion: string;
  pageType: PageType;
  pageTypeConfidence: number;
  /** The page's value proposition (hero headline) — what it promises. */
  valueProp: { headline: string };
  /** The single strongest conversion action — what the page wants the visitor to do. */
  primaryCta: ProjCta | null;
  /** Distinct conversion actions, strongest first (deduped, capped). */
  conversionPath: ProjCta[];
  /** Distinct conversion CTAs above the fold — >1 dilutes focus. */
  competingAboveFold: number;
  trust: { total: number; aboveFold: number; types: string[] };
  /** Distraction load: nav options + interactive elements competing above the fold. */
  friction: { aboveFoldNavItems: number; aboveFoldInteractive: number };
  /** Does the eye land on the CTA? topSalient = strongest above-fold elements. */
  hierarchy: { primaryCtaWinsSalience: boolean | null; topSalient: { text: string; salience: number }[] };
  /** Section order — the persuasive narrative. */
  flow: string[];
  score: { overall: number; grade: CroScore["grade"]; dimensions: { id: string; score: number }[] };
}

const isCtaish = (e: ProjEl) =>
  e.category === "cta_primary" || e.category === "cta_secondary" || e.category === "form_submit";
const isConversion = (e: ProjEl) => e.intent === "conversion" || e.category === "form_submit";

function toCta(e: ProjEl): ProjCta {
  return {
    text: (e.text || "").trim(),
    intent: e.intent,
    section: e.section,
    aboveFold: !!e.aboveFold,
    salience: e.score ?? 0,
  };
}

// Strength of a CTA instance: above-fold dominates, then salience. The same
// action repeated in sticky-nav + hero must collapse to its STRONGEST instance,
// not the first one seen (else the below-fold copy can mask the above-fold one).
const ctaRank = (e: ProjEl) => (e.aboveFold ? 1000 : 0) + (e.score ?? 0);

// Distinct conversion CTAs, deduped to the strongest instance per action, then
// ranked above-fold-first then by salience with a deterministic text tiebreak.
function distinctConversionCtas(visible: ProjEl[]): ProjCta[] {
  const best = new Map<string, ProjEl>();
  const empties: ProjEl[] = []; // text-less CTAs aren't deduped together
  for (const e of visible) {
    if (!isCtaish(e) || !isConversion(e)) continue;
    const t = (e.text || "").trim().toLowerCase();
    if (!t) {
      empties.push(e);
      continue;
    }
    const key = `${t}|${e.intent}`;
    const cur = best.get(key);
    if (!cur || ctaRank(e) > ctaRank(cur)) best.set(key, e);
  }
  const out = [...best.values(), ...empties].map(toCta);
  out.sort(
    (a, b) =>
      Number(b.aboveFold) - Number(a.aboveFold) ||
      b.salience - a.salience ||
      a.text.localeCompare(b.text),
  );
  return out;
}

const CONVERSION_PATH_CAP = 6;
const TOP_SALIENT_CAP = 3;

export function projectCro(golden: GoldenIn): CroProjection {
  const elements = golden.collect?.elements ?? [];
  const visible = elements.filter((e) => e.visible !== false);
  const audit = golden.pageAudit ?? {};
  const cro = golden.croScore;

  const conversion = distinctConversionCtas(visible);
  const primaryCta = conversion[0] ?? null;
  const competingAboveFold = conversion.filter((c) => c.aboveFold).length;

  const aboveFoldVisible = visible.filter((e) => e.aboveFold);
  const maxSalience = aboveFoldVisible.reduce((m, e) => Math.max(m, e.score ?? 0), 0);
  const topSalient = aboveFoldVisible
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.text || "").localeCompare(b.text || ""))
    .slice(0, TOP_SALIENT_CAP)
    .map((e) => ({ text: (e.text || "").trim(), salience: e.score ?? 0 }));

  const byType = audit.trustSummary?.byType ?? {};
  const trustTypes = Object.entries(byType)
    .filter(([, n]) => n > 0)
    .map(([k]) => k)
    .sort();

  return {
    extractorVersion: EXTRACTOR_VERSION,
    pageType: cro?.pageType ?? "generic",
    pageTypeConfidence: cro?.pageTypeConfidence ?? 0,
    valueProp: { headline: (audit.hero?.headline || "").trim() },
    primaryCta,
    conversionPath: conversion.slice(0, CONVERSION_PATH_CAP),
    competingAboveFold,
    trust: {
      total: audit.trustSummary?.total ?? 0,
      aboveFold: audit.trustSummary?.aboveFold ?? 0,
      types: trustTypes,
    },
    friction: {
      aboveFoldNavItems: aboveFoldVisible.filter((e) => e.category === "nav_item").length,
      aboveFoldInteractive: aboveFoldVisible.filter((e) => isCtaish(e)).length,
    },
    hierarchy: {
      // Null when there's no above-fold conversion CTA to anchor on.
      primaryCtaWinsSalience:
        primaryCta && primaryCta.aboveFold && maxSalience > 0
          ? primaryCta.salience >= maxSalience
          : null,
      topSalient,
    },
    flow: audit.sectionOrder ?? [],
    score: {
      overall: cro?.overall ?? 0,
      grade: cro?.grade ?? "F",
      dimensions: (cro?.dimensions ?? []).map((d) => ({ id: d.id, score: d.score })),
    },
  };
}
