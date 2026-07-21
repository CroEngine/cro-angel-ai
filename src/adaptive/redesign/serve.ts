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

import { fnv1a32 } from "../hash";
import { fullSegmentKey, isSegmentPrefix, segmentDepth } from "../../lib/segment-key";

import { cohortsSatisfied } from "../context";
import type { RedesignOp } from "./generate";

// Nyckelsemantiken bor i src/lib/segment-key.ts (task #89) — samma byggare/
// matchare som rollupen och dashboarden. Re-exporteras här för serve-vägens
// befintliga importörer (serve.test.ts pinnar beteendet).
export { isSegmentPrefix };

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

/** One machine-servable op, resolved at VERIFICATION time. The plan ops
 *  (RedesignOp) carry section ids + prose — meaningless in a visitor's browser.
 *  A serve op instead carries a DOM locator (the section's heading text, the
 *  most drift-tolerant handle a frozen page offers) and the literal new text.
 *  The apply semantics MIRROR the render harness that verified the plan:
 *  move_up = lift the located section ONE step earlier (per op — two ops, two
 *  steps), never "to the top". */
export interface ServeOp {
  op: "move_up" | "set_text" | "insert_snippet";
  /** insert_snippet: locates the HERO heading (h1) — the verified block is
   *  inserted directly after the hero's top-level block, as plain text in a
   *  <p> styled by the page's own cascade (aldrig rå HTML — texten är data,
   *  inte markup, så DB-raden kan aldrig bli en injektionskanal). */
  locator: { tag?: string; text: string };
  /** set_text: the exact verified replacement text.
   *  insert_snippet: the exact verbatim quote from the source page. */
  value?: string;
  /** insert_snippet: citatets källsida som klickväg — ALLTID en sajt-egen
   *  absolut path ("/priser"), aldrig extern URL eller protokoll (validerat
   *  hårt i serveOpValid; ogiltig ⇒ hela varianten vägras). */
  href?: string;
  /** insert_snippet: stil-donatorn (ägarbeslut 2026-07-18 alt. D) — en
   *  klass som redan finns på landningssidan; sajtens egen stilmall klär
   *  blocket. Utseendet grindas + ägargodkänns per variant. */
  styleClass?: string;
  why?: string;
}

/** Sajt-egen absolut path: börjar med EXAKT ett "/", bär inget protokoll och
 *  ingen möjlighet att bli extern ("//host") eller aktiv ("javascript:"). */
export function isSameSitePath(href: string): boolean {
  return (
    typeof href === "string" &&
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !href.includes(":") &&
    !/\s/.test(href) &&
    href.length <= 300
  );
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
  /** Browser-applicable ops (see ServeOp). Empty/invalid ⇒ never served. */
  serveOps?: ServeOp[];
  /** Kohortkrav ur den ägargodkända regeln (labbets vokabulär ch:/src:/ret:/
   *  seen:) — ALLA nycklar måste finnas på besökaren (OCH, samma semantik som
   *  ruleMatches). Frånvarande/tom ⇒ ingen grindning. Servern härleder
   *  besökarens nycklar själv (cohortsForVisitor) — inget klientförtroende. */
  requiredCohorts?: string[];
}

/** Build the FULL coarse→fine segment key for a visitor — identical format to the
 *  dashboard rollup, so a variant's prefix key can be matched against it. */
export function visitorSegmentKey(seg: VisitorSegment): string {
  return fullSegmentKey(seg.channel, seg.device, seg.country, seg.isReturning);
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
    const depth = segmentDepth(b.segmentKey) - segmentDepth(a.segmentKey);
    return depth !== 0 ? depth : a.id.localeCompare(b.id);
  });
  return servable[0];
}

// ---- steg 3: ramp + arm-val (pure) -----------------------------------------

/** A serve op the browser can actually perform. Fail closed: anything else
 *  (unknown verb, missing locator/value) disqualifies the WHOLE variant. */
function serveOpValid(o: ServeOp): boolean {
  const text = o?.locator?.text;
  if (typeof text !== "string" || !text.trim()) return false;
  if (o.op === "move_up") return true;
  if (o.op === "set_text") return typeof o.value === "string" && o.value.trim().length > 0;
  if (o.op === "insert_snippet") {
    if (typeof o.value !== "string" || o.value.trim().length === 0) return false;
    // href/styleClass är frivilliga — men FINNS de måste de vara säkra:
    // en ogiltig klickväg eller en misstänkt klass fäller HELA varianten.
    if (o.href !== undefined && !isSameSitePath(o.href)) return false;
    if (
      o.styleClass !== undefined &&
      !(typeof o.styleClass === "string" && /^[\w -]{1,120}$/.test(o.styleClass))
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/** Deterministic 0..99 bucket for the RAMP split — FNV-1a over
 *  visitorHash·variantId. Salting with the variant id decorrelates this from
 *  the measurement-holdout bucket (plain visitorHash): a visitor who is
 *  "always control" there must not be "always control" here too. */
export function rampBucket(visitorHash: string, variantId: string): number {
  return fnv1a32(`${visitorHash}·${variantId}`) % 100;
}

export interface ServeVerdict {
  variant: ServableVariant;
  /** "variant" ⇒ the visitor gets the ops; "control" ⇒ page as-is, exposure
   *  logged as withheld so the arms stay comparable. */
  arm: "variant" | "control";
}

/**
 * The whole per-visitor serving decision, pure (owner rules 2026-07-12):
 *  - master switch off ⇒ null (nothing is even considered),
 *  - no visitorHash ⇒ null — without a stable id there is no deterministic arm
 *    and no conversion join, so serving would be unmeasurable noise,
 *  - no matching variant, or a match whose serveOps are missing/invalid ⇒ null
 *    (fail closed — a variant the browser can't faithfully apply never serves),
 *  - otherwise: rampPct % of visitors (deterministic per visitor+variant) get
 *    the variant, the rest are the control arm. Ramp starts at 5 and is raised
 *    manually (5 → 10 → 25 → 50) — never 50/50 from day one.
 *  - status "winner" ⇒ 100 %: ägarens "gör till ny standard"-knapp ÄR beslutet
 *    att sluta mäta för det segmentet — alla segment-matchade besökare får
 *    varianten, ingen kontrollarm. A/B-läsningen för vinnaren fryser vid de
 *    siffror som avgjorde den (kontrollarmen slutar fyllas på) — by design.
 */
export function serveDecision(
  cfg: { servingEnabled: boolean; rampPct: number },
  variants: ServableVariant[],
  visitor: { site: string; path: string; segment: VisitorSegment; cohorts?: string[] },
  visitorHash: string | null | undefined,
): ServeVerdict | null {
  if (!cfg.servingEnabled) return null;
  if (!visitorHash) return null;
  // Kohortgrinden körs FÖRE matchningen: en kohortscopad variant som inte
  // passar besökaren försvinner ur kandidatlistan, så en grövre variant
  // fortfarande kan serva (samma lån-styrka-tanke som segmentprefixen).
  const have = visitor.cohorts ?? [];
  const eligible = variants.filter(
    (v) => !v.requiredCohorts?.length || cohortsSatisfied(v.requiredCohorts, have),
  );
  const match = matchVariant(eligible, visitor);
  if (!match) return null;
  const ops = match.serveOps ?? [];
  if (ops.length === 0 || !ops.every(serveOpValid)) return null;
  if (match.status === "winner") return { variant: match, arm: "variant" };
  const ramp = Math.max(1, Math.min(50, Math.floor(cfg.rampPct) || 5));
  const arm = rampBucket(visitorHash, match.id) < ramp ? "variant" : "control";
  return { variant: match, arm };
}
