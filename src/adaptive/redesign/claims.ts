// Fas 3 — semantic guard for retext ops (pure).
//
// move_up / reveal move existing blocks — they cannot invent, by construction.
// set_text / condense REWRITE copy, so "same meaning, fewer words — never new
// claims" needs an actual check on the proposed text, not just "the target
// exists". This is that check: a deterministic claims-diff.
//
// It does NOT try to judge meaning (paraphrase detection is unreliable and would
// reject honest tightening). Instead it catches the concrete, high-value ways a
// rewrite fabricates: a NUMBER, a SUPERLATIVE, or a PROMISE that is not already
// published somewhere on the page. Those are exactly the claims a CRO rewrite is
// tempted to invent ("19,000 customers" → "50,000 customers"; "analytics" →
// "the #1 analytics"; adding "money-back guarantee"). Everything the page already
// says is fair game to re-tighten; anything new in these three categories is not.
//
// A structural proxy for a fuzzy property — same spirit as the beauty gates.

import { normalizeLabel } from "../crawler-inventory";

export type ClaimKind = "number" | "superlative" | "promise";

export interface Claim {
  kind: ClaimKind;
  /** The text as it appeared. */
  text: string;
  /** Normalized key for grounding comparison (case/format-insensitive). */
  norm: string;
}

// Curated superlative / absolute lexicon — the words a rewrite reaches for to
// inflate a claim. Word-boundary matched, case-insensitive.
const SUPERLATIVES = [
  "best",
  "#1",
  "number one",
  "no. 1",
  "top-rated",
  "top rated",
  "highest-rated",
  "fastest",
  "leading",
  "market-leading",
  "guaranteed",
  "unlimited",
  "lifetime",
  "forever",
  "world-class",
  "world class",
  "award-winning",
  "most popular",
  "unbeatable",
  "unrivaled",
  "unrivalled",
  "flawless",
  "perfect",
  "the only",
  "industry-leading",
];

// Promise / risk-reversal phrases — commitments a rewrite must not fabricate.
const PROMISES = [
  "money-back",
  "money back",
  "risk-free",
  "risk free",
  "no credit card",
  "cancel anytime",
  "cancel any time",
  "satisfaction guaranteed",
  "free forever",
  "no commitment",
  "full refund",
  "30-day guarantee",
  "no questions asked",
];

/** A digit-bearing token: 19,000 · 99.99% · 260B · 10x · $49 · 3-day. */
const NUMBER_RE = /\$?\d[\d,.]*\s?(?:%|percent|k|m|b|bn|x|\+)?(?:-?(?:day|month|year|hour|min)s?)?/gi;

function normNumber(s: string): string {
  return s
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/percent/g, "%")
    .replace(/bn\b/g, "b")
    .replace(/\.0+(\D|$)/, "$1"); // 99.0% ≈ 99%
}

// Dedup-normaliseringen är crawler-inventoriets normalizeLabel — samma jobb,
// en implementation (trim/collapse kommuterar; utfallet är byte-identiskt).
const norm = normalizeLabel;

/** Extract the claim tokens (numbers, superlatives, promises) from a piece of
 *  text. Pure; order-independent. */
export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  const lower = ` ${text.toLowerCase()} `;

  for (const m of text.matchAll(NUMBER_RE)) {
    const t = m[0].trim();
    if (/\d/.test(t)) claims.push({ kind: "number", text: t, norm: normNumber(t) });
  }
  for (const s of SUPERLATIVES) {
    if (lower.includes(` ${s} `) || lower.includes(` ${s}.`) || lower.includes(` ${s},`)) {
      claims.push({ kind: "superlative", text: s, norm: norm(s) });
    }
  }
  for (const p of PROMISES) {
    if (lower.includes(p)) claims.push({ kind: "promise", text: p, norm: norm(p) });
  }
  return claims;
}

/** Claims present in `proposed` that are NOT grounded anywhere in `corpus` — the
 *  fabricated ones. A claim is grounded if the same normalized token (of the same
 *  kind) appears in the corpus. Pure. */
export function introducedClaims(proposed: string, corpus: string): Claim[] {
  const grounded = new Set(extractClaims(corpus).map((c) => `${c.kind}:${c.norm}`));
  const seen = new Set<string>();
  const out: Claim[] = [];
  for (const c of extractClaims(proposed)) {
    const key = `${c.kind}:${c.norm}`;
    if (grounded.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Convenience: is the proposed copy free of fabricated claims vs the corpus? */
export function retextIsGrounded(proposed: string, corpus: string): boolean {
  return introducedClaims(proposed, corpus).length === 0;
}
