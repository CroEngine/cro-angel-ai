// Collapses volatile capture noise (selectors, sub-pixel rects, array order,
// raw computed styles, timestamps) so a plain deep-equal diff surfaces ONLY
// real behaviour changes: a CTA that flipped category/intent, a count that moved,
// the hero headline changing, etc.
//
// Phase-2 building block. Run normalize() on both the golden and the fresh
// capture, then diff. Pre-refactor: feed it the whole `collect`/`pageAudit`.
// Post record-split: feed it the findings produced from frozen records.

type Json = unknown;

const round = (n: number, step: number) => Math.round(n / step) * step;

// 1 significant figure — area values jitter heavily between replays
// (font-metrics, sub-pixel layout, lazy-load timing). We only care about
// order-of-magnitude; finer resolution just produces flaky diffs.
const sig1 = (n: number) => {
  if (!n) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(n))));
  return Math.round(n / mag) * mag;
};

// Cookie/consent banner elements appear/disappear between replays depending
// on when the banner-dismiss JS fires relative to the collector. Their text
// and ordering are pure noise for regression purposes — strip them before
// diffing. Real cookie-policy footer links stay in (they don't match
// "accept/decline/reject all" etc).
const COOKIE_BANNER_RX =
  /\b(accept all|decline all|reject all|allow all|deny all|manage cookies|cookie settings|cookie preferences|consent preferences)\b/i;

function isCookieBannerElement(e: any): boolean {
  const text = (e?.text || "").trim();
  return !!text && COOKIE_BANNER_RX.test(text);
}

// --- collect.elements -> stable semantic fingerprint -------------------------
// Drop everything that is an INPUT to classification (selector, attributes,
// computedStyles, exact rect) and keep only the OUTPUTS we regression-test.
function normElement(e: any) {
  const vw = e.visualWeight || {};
  return {
    text: (e.text || "").trim(),
    tagName: e.tagName,
    category: e.category,
    intent: e.intent,
    section: e.section,
    // Completeness flag: hidden interactive surfaces (collapsed menus, tab
    // panels) are now collected with visible:false. Legacy data without the
    // field is treated as visible (the old extractor only ever kept visible).
    visible: e.visible !== false,
    aboveFold: !!e.aboveFold,
    href: e.href ? hostOnly(e.href) : null, // path/query are volatile; host is the signal
    disabled: !!e.disabled,
    // geometry: very coarse — enough to catch "moved to a different band", not jitter
    yBand: round(e.rect?.y ?? 0, 200),
    score: round(vw.score ?? 0, 10),
    salience: vw.salience != null ? round(vw.salience, 0.2) : undefined,
    bgContrast: vw.backgroundContrast != null ? round(vw.backgroundContrast, 1) : undefined,
    area: sig1(vw.area ?? 0),
  };
}

function hostOnly(href: string): string {
  try {
    return new URL(href, "https://x").host || href;
  } catch {
    return href;
  }
}

// Stable sort key so array ORDER is never counted as a change.
function elementKey(n: ReturnType<typeof normElement>): string {
  // Sort by STABLE identity (section/category/intent/visible/text) first; yBand
  // LAST as a tiebreak for true duplicates only. Putting yBand before text let a
  // sub-pixel band-crossing reshuffle the whole adjacent run, turning one real
  // change into a cascade of positional diffs (masking genuine drift). visible
  // split keeps a hidden + visible element with identical text as distinct rows.
  return [n.section, n.category, n.intent, n.visible ? "v" : "h", n.text, n.yBand].join("\u0001");
}

export function normalizeCollect(collect: any) {
  const rawEls = (collect?.elements || []).filter((e: any) => !isCookieBannerElement(e));
  const els = rawEls.map(normElement);
  els.sort((a: any, b: any) => elementKey(a).localeCompare(elementKey(b)));
  const s = collect?.summary || {};
  return {
    target: collect?.target,
    // count reflects the filtered element list so a flaky cookie banner can't
    // shift the total. visible/hidden split makes the completeness recovery
    // (interaction-gated surfaces kept with visible:false) legible in the diff.
    count: els.length,
    visibleCount: els.filter((e: any) => e.visible).length,
    hiddenCount: els.filter((e: any) => !e.visible).length,
    byCategory: sortObj(collect?.byCategory),
    summary: {
      total: s.total,
      aboveFold: s.aboveFold,
      primaryConversionCtaCount: s.primaryConversionCtaCount,
      competingAboveFold: s.competingAboveFold,
      intentBreakdown: sortObj(s.intentBreakdown),
      bySection: sortObj(s.bySection),
      // topVisualWeight: keep text + coarse score, drop selector
      topVisualWeight: (s.topVisualWeight || [])
        .filter((t: any) => !COOKIE_BANNER_RX.test((t.text || "").trim()))
        .map((t: any) => ({
          text: (t.text || "").trim(),
          score: round(t.score ?? 0, 10),
        })),
    },
    elements: els,
  };
}

// --- pageAudit -> keep the findings, drop the volatile scaffolding -----------
export function normalizePageAudit(a: any, opts: { keepTrustEntries?: boolean } = {}) {
  if (!a) return a;
  return {
    head: {
      title: a.head?.title ?? null,
      hasDescription: !!a.head?.description,
      canonical: a.head?.canonical ?? null,
      lang: a.head?.lang ?? null,
    },
    headings: {
      h1Count: a.headings?.h1Count,
      h1: (a.headings?.h1Texts || []).map((s: string) => s.trim()),
    },
    hero: {
      headline: (a.hero?.headline || "").trim(),
      primaryCtaText: (a.hero?.primaryCtaText || "").trim(),
      primaryCtaIntent: a.hero?.primaryCtaIntent,
      aboveFold: !!a.hero?.aboveFold,
    },
    images: {
      total: a.images?.total,
      missingAlt: a.images?.missingAlt,
      modernCount: a.images?.modernCount,
      legacyCount: a.images?.legacyCount,
      formats: sortObj(a.images?.formats),
    },
    trustSummary: a.trustSummary,
    // Evidence trail: WHY signals were dropped, so a count change is explainable.
    // Selectors are dropped (random widget/swiper IDs are pure noise across builds).
    // Default to rollup-only — carousel rotation makes `entries` flap between captures.
    trustEvidence: normTrustDebug(a.trustDebug, opts.keepTrustEntries === true),
    ctaSummary: {
      total: (a.ctas || []).length,
      primary: (a.ctas || []).filter((c: any) => c.category === "cta_primary").length,
      aboveFold: a.pageSummary?.aboveFoldCtaCount,
    },
    sectionOrder: a.sectionOrder,
    // intentionally dropped: auditedAt, httpHeaders, sections rects, etc.
  };
}

// trustDebug -> stable evidence: drop volatile selectors, keep stage/decision/
// reason + the text that was judged, plus a roll-up so a flipped count is traceable.
function normTrustDebug(td: any, keepEntries: boolean): any {
  if (!Array.isArray(td)) return undefined;
  const entries = td.map((e: any) => ({
    stage: e.stage,
    decision: e.decision,
    reason: e.reason,
    text: (e.text || "").trim().slice(0, 80),
    matchedText: e.matchedText ? String(e.matchedText).trim().slice(0, 60) : undefined,
  }));
  entries.sort((a: any, b: any) =>
    [a.stage, a.decision, a.reason, a.text]
      .join("\u0001")
      .localeCompare([b.stage, b.decision, b.reason, b.text].join("\u0001")),
  );
  // roll-up: "stage/decision/reason" -> count
  const rollup: Record<string, number> = {};
  for (const e of entries) {
    const k = `${e.stage}/${e.decision}/${e.reason}`;
    rollup[k] = (rollup[k] || 0) + 1;
  }
  return keepEntries ? { rollup: sortObj(rollup), entries } : { rollup: sortObj(rollup) };
}

function sortObj(o: any) {
  if (!o || typeof o !== "object") return o;
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

// --- readable diff -----------------------------------------------------------
// Returns a flat list of "path: old -> new" lines. Empty array == no change.
export function diffNormalized(golden: Json, fresh: Json, path = ""): string[] {
  const out: string[] = [];
  if (JSON.stringify(golden) === JSON.stringify(fresh)) return out;

  if (Array.isArray(golden) && Array.isArray(fresh)) {
    const n = Math.max(golden.length, fresh.length);
    if (golden.length !== fresh.length)
      out.push(`${path}.length: ${golden.length} -> ${fresh.length}`);
    for (let i = 0; i < n; i++)
      out.push(...diffNormalized(golden[i], fresh[i], `${path}[${i}]`));
    return out;
  }

  if (isObj(golden) && isObj(fresh)) {
    const keys = new Set([...Object.keys(golden), ...Object.keys(fresh)]);
    for (const k of keys)
      out.push(
        ...diffNormalized(
          (golden as any)[k],
          (fresh as any)[k],
          path ? `${path}.${k}` : k,
        ),
      );
    return out;
  }

  out.push(`${path}: ${fmt(golden)} -> ${fmt(fresh)}`);
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const fmt = (v: unknown) => (v === undefined ? "∅" : JSON.stringify(v));
