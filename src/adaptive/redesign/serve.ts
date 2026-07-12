// Fas 4 (core) — pick the verified variant to serve a visitor's segment. PURE.
//
// This is the ONE decision-independent piece of per-segment serving (see
// docs/fas4-per-segment-serving.md): given a visitor's segment and the set of
// verified variants, which variant (if any) serves them? The business decisions —
// how serving is switched on, the A/B split, the win criterion, baseline swap —
// live elsewhere and do not affect this matching.
//
// It is deliberately NOT wired into the live decide path. Nothing here routes real
// traffic; it is the library the eventual serving step calls. Serving stays OFF
// until the owner turns it on per segment.
//
// The segment key format MIRRORS the dashboard rollup (aggregate.ts) exactly —
// `channel·device·country·returning`, coarse→fine — so serving and segment
// analysis speak one language and a variant authored for "google·mobile·se" lines
// up with the same bucket the dashboard reports.

import type { RedesignOp } from "./generate";

export type VariantStatus = "candidate" | "verified" | "serving" | "winner" | "retired";

/** Only these statuses are ever served to a real visitor: a variant must have
 *  passed Fas 3 verification AND been switched on (serving), or won its A/B
 *  (winner). candidate/verified/retired never serve. */
const SERVABLE: ReadonlySet<VariantStatus> = new Set<VariantStatus>(["serving", "winner"]);

/** The visitor's segment dimensions — the four the decide context already carries
 *  (context.trafficSource / device / country / isReturning). */
export interface VisitorSegment {
  channel: string | null;
  device: string | null;
  country: string | null;
  isReturning: boolean;
}

/** A verified redesign variant, keyed to a segment PREFIX. Its ops are the same
 *  reversible vocabulary the snippet already applies. */
export interface ServableVariant {
  id: string;
  site: string;
  path: string;
  /** A coarse→fine segment key prefix, e.g. "google" or "google·mobile·se". */
  segmentKey: string;
  status: VariantStatus;
  ops: RedesignOp[];
}

// Same tokenization as aggregate.ts's segToken + returning token, so keys match.
const token = (v: string | null | undefined): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || "okänd";
};

/** Build the FULL coarse→fine segment key for a visitor — identical format to the
 *  dashboard rollup, so a variant's prefix key can be matched against it. */
export function visitorSegmentKey(seg: VisitorSegment): string {
  return [token(seg.channel), token(seg.device), token(seg.country), seg.isReturning ? "återkommande" : "ny"].join(
    "·",
  );
}

/** Is `prefix` a coarse→fine prefix of `full` — compared DIMENSION-WISE (not raw
 *  string prefix, so "go" never matches "google" and "google" matches only the
 *  whole "google" token). */
export function isSegmentPrefix(prefix: string, full: string): boolean {
  if (!prefix) return false;
  const p = prefix.split("·");
  const f = full.split("·");
  if (p.length > f.length) return false;
  return p.every((tok, i) => tok === f[i]);
}

/** The variant to serve a visitor, or null. Among the site+path's SERVABLE
 *  variants whose segmentKey is a prefix of the visitor's full key, the FINEST
 *  (longest prefix) wins; a coarser one borrows strength until the fine variant
 *  exists. Deterministic id tiebreak. Pure — routes nothing on its own. */
export function matchVariant(
  variants: ServableVariant[],
  visitor: { site: string; path: string; segment: VisitorSegment },
): ServableVariant | null {
  const key = visitorSegmentKey(visitor.segment);
  const servable = variants.filter(
    (v) =>
      v.site === visitor.site &&
      v.path === visitor.path &&
      SERVABLE.has(v.status) &&
      isSegmentPrefix(v.segmentKey, key),
  );
  if (servable.length === 0) return null;
  servable.sort((a, b) => {
    const depth = b.segmentKey.split("·").length - a.segmentKey.split("·").length;
    return depth !== 0 ? depth : a.id.localeCompare(b.id);
  });
  return servable[0];
}
