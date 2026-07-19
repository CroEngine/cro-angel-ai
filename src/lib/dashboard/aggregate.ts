// Angel Adaptive — dashboard aggregation (blueprint Step 8).
//
// Pure functions that turn raw angel_events rows + content inventory into the
// view model the customer dashboard renders (Overview, Visitor Segments, Live
// Adaptations, Performance, Content Inventory). No IO, no clock — so the whole
// thing is unit-tested against synthetic events. The server function in
// dashboard.functions.ts feeds it real rows from Supabase.

import { stripQueryHash } from "../../adaptive/harvest/sanitize";
import { RETURNING_TOKEN, returningToken, segToken, segmentKeyOf } from "../segment-key";

/** A minimal projection of an angel_events row. */
export interface DashEvent {
  type: string;
  payload: Record<string, unknown>;
  visitorHash: string | null;
  decisionId: string | null;
  createdAt: string; // ISO timestamp
}

/** A minimal projection of an angel_content_inventory row. */
export interface InventoryEntry {
  slot: string;
  id: string;
  text: string | null;
  selector: string | null;
  meta: Record<string, string>;
}

export interface Overview {
  pageviews: number;
  uniqueVisitors: number;
  adaptationsShown: number;
  ctaClicks: number;
  conversions: number;
  /** Share of identified visitors who converted: distinct converted visitors
   *  / distinct identified visitors, 0..1 (D1). The SAME species of number as
   *  VariantStat.rate, so the headline is directly comparable with the lift
   *  table — the old conversions/pageviews mixed event counts with visit
   *  counts and read ~5x lower than the per-visitor rates beside it. */
  conversionRate: number;
}

export interface SegmentBar {
  key: string;
  pageviews: number;
}

export interface LiveAdaptation {
  decisionId: string;
  patterns: string[];
  trafficSource: string | null;
  device: string | null;
  at: string;
}

export interface PatternStat {
  pattern: string;
  shown: number;
}

/** Conversion outcome for one variant (adapted vs control) of a pattern. */
export interface VariantStat {
  /** Distinct visitors exposed to (or withheld from) this pattern. */
  exposures: number;
  /** Distinct exposed visitors who converted within the attribution window. */
  conversions: number;
  /** conversions / exposures, 0..1 (0 when no exposures). */
  rate: number;
}

/** Micro-conversions: steps on the way to the goal, counted per distinct
 *  exposed visitor who did NOT convert in the window (D2) — a visitor who
 *  converted already gave the terminal signal, and counting their missing
 *  scroll/return against a pattern punished exactly the patterns that convert
 *  people fast. They NEVER enter the headline lift — they exist so the
 *  engine (and the owner) can read direction long before final conversions
 *  reach significance on low-volume sites. */
export interface MicroStats {
  /** Non-converted visitors who scrolled ≥75% within the attribution window. */
  deepScroll: number;
  /** Non-converted visitors with ≥2 pageviews within the attribution window. */
  multiPage: number;
  /** Non-converted visitors who came back (a pageview after the window, within 7 days). */
  returned: number;
}

/**
 * "What's working": per-pattern causal read. Joins each visitor's earliest
 * `adaptation_shown` (adapted) / `adaptation_withheld` (control) to any later
 * `conversion` by that same visitor within ATTRIBUTION_WINDOW_MS.
 */
export interface PatternAttribution {
  pattern: string;
  /** null = the overall (all-traffic) row. A string (trafficSource) marks a
   *  per-segment row (D4): a pattern can win on linkedin and lose on paid —
   *  one blended verdict would suppress it sitewide, including where it wins.
   *  Segment rows exist only where an arm reaches MIN_ARM_EXPOSURES. */
  segment: string | null;
  adapted: VariantStat;
  control: VariantStat;
  /** Micro-conversion counts for the same exposed-visitor sets. */
  adaptedMicro: MicroStats;
  controlMicro: MicroStats;
  /** adapted.rate − control.rate; null when there's no control group to
   *  compare against (holdout off / no withheld exposures yet). */
  lift: number | null;
  /** Two-proportion z score for the rate difference; null without both groups. */
  z: number | null;
  /** True when both variants have exposures and |z| ≥ 1.96 (~95%). */
  significant: boolean;
}

export interface InventoryGroup {
  slot: string;
  items: InventoryEntry[];
}

/** One day's traffic in the display timezone. `visits` counts exposures
 *  (adaptation_shown + adaptation_withheld — the server logs one per page
 *  render, for ALL traffic including anonymous); `identified` counts distinct
 *  consented visitors (non-null hash) seen that day. */
export interface DayPoint {
  /** YYYY-MM-DD in the display timezone. */
  day: string;
  visits: number;
  identified: number;
  conversions: number;
}

/** Aggregated time-of-day profile across the whole window (display tz). */
export interface HourPoint {
  /** 0..23 in the display timezone. */
  hour: number;
  visits: number;
  identified: number;
}

/** One identified (consented) visitor's footprint — anonymous traffic carries
 *  no id by design and can't appear here. */
export interface VisitorSummary {
  hash: string;
  firstSeen: string;
  lastSeen: string;
  events: number;
  pageviews: number;
  ctaClicks: number;
  /** Deepest scroll bucket reached: 0 | 25 | 50 | 75 | 100. */
  maxScroll: number;
  conversions: number;
  /** Distinct patterns this visitor was exposed to (shown or withheld). */
  patterns: string[];
  /** Which measurement arm they landed in, if any. */
  arm: "adapted" | "control" | "mixed" | null;
  device: string | null;
  country: string | null;
  trafficSource: string | null;
  browser: string | null;
}

/** En arm i v1-beviset (docs/v1-testdefinition.md): distinkta exponerade
 *  besökare och deras utfall inom attributionsfönstret. */
export interface ArmProof {
  visitors: number;
  /** Besökare som klickade på MÅLET (cta_click med path≠"assist"). Angels
   *  egna genvägar räknas inte här — de finns bara i adapterade armen och
   *  skulle blåsa upp jämförelsen strukturellt. */
  ctaClicks: number;
  /** Besökare med minst ett genvägsklick (cta_click path="assist") i
   *  fönstret. Kan ÖVERLAPPA ctaClicks — en besökare som tappar pillret på
   *  laddning 1 och klickar målet på laddning 2 räknas i bägge kolumnerna
   *  (separata mått, ingen partition). Per konstruktion 0 i kontrollarmen —
   *  redovisas separat, aldrig i pWin. */
  assistClicks: number;
  conversions: number;
  /** Återbesök 6h–7d efter exponeringen — retention-proxy (nedströmsmåttet). */
  returns: number;
  ctaClickRate: number;
  assistRate: number;
  conversionRate: number;
  returnRate: number;
  /** Median fältmätt LCP (ms) för armens besökare — RISK-mätaren "vi får inte
   *  försämra sidan". Om adapterade armens LCP är påtagligt sämre än
   *  kontrollens har en injektion kostat prestanda. null när för få page_perf-
   *  händelser finns. */
  lcpMedianMs: number | null;
}

/** Bevis-vyn: adapterad arm vs hold-out på sajtnivå. Success-mätaren är
 *  CTA-klick per exponerad besökare; avläsningen är BAYESIANSK — på SMB-
 *  trafik kan fasta test sällan detektera < ~20–30 % relativ lift, så vi
 *  rapporterar P(adapterad > kontroll) i stället för binära signifikanser. */
export interface ProofSummary {
  adapted: ArmProof;
  control: ArmProof;
  /** P(adapterad arm > kontroll) på MÅL-klickfrekvensen (ctaClicks, aldrig
   *  assist). Beta(1,1)-posterior per arm, normalapproximation av
   *  differensen. null när hold-out saknas ELLER när evidensen är för tunn
   *  för att siffran ska betyda något: med Beta(1,1)-priors och olikstora
   *  armar (t.ex. 88/12) ger NOLL klick i bägge armarna ~19 % — en
   *  självsäkert felaktig avläsning ur ren prior. Grinden (bägge armarna ≥
   *  MIN_ARM_EXPOSURES besökare och ≥ MIN_ARM_OUTCOMES mål-klick totalt)
   *  gör null = "för tidigt att säga", som UI:t visar explicit. */
  pWin: number | null;
  holdoutActive: boolean;
}

export interface DashboardMetrics {
  overview: Overview;
  /** v1-beviset — null tills det finns minst en exponering. */
  proof: ProofSummary | null;
  segments: {
    byTrafficSource: SegmentBar[];
    byDevice: SegmentBar[];
    byCountry: SegmentBar[];
    byBrowser: SegmentBar[];
    byLanguage: SegmentBar[];
    byCampaign: SegmentBar[];
  };
  timeseries: {
    daily: DayPoint[];
    hourly: HourPoint[];
  };
  visitors: VisitorSummary[];
  liveAdaptations: LiveAdaptation[];
  performance: PatternStat[];
  attribution: PatternAttribution[];
  inventory: InventoryGroup[];
  /** Nivå 2: de senaste anonyma besöksresorna (journey intelligence). */
  sessions: SessionSummary[];
  /** Frustrationssignaler: mest rage-klickade element (ref → bursts).
   *  Diagnostik — driver aldrig en automatisk ändring. */
  rageClicks: RageSignal[];
  /** Klick-heatmapen (Journeys & signals): täthet + rage-punkter per position,
   *  en post per sida rankad efter klickvolym (sidväljaren). Diagnostik,
   *  aldrig behandling. */
  heatPages: ClickHeat[];
  /** Sajtsökningar per term (ägarbeslut 2026-07-19) — vad besökarna letar
   *  efter men kanske inte hittar. Tom lista tills sajten har sökningar. */
  searches: SearchTerm[];
  /** Fas 2: besökargrupper (kanal×enhet×land×ny/återkommande), grov→fin, med
   *  utfall + datatillräcklighet. Insikt-substrat — ingen adaptation. */
  segmentGroups: SegmentSummary[];
}

/** En upprullad sajtsökning. Termen är server-skrubbad (cleanText: mejl +
 *  långa siffror redakterade, längd-kapad) innan den når event-loggen —
 *  rollupen normaliserar bara till gemener. */
export interface SearchTerm {
  term: string;
  count: number;
  lastSeen: string;
}

/** En klick-täthetspunkt för heatmapen: sid-relativ position (heltals-%,
 *  x av viewportbredd, y av dokumenthöjd) → antal klick i 5 %-rutan. */
export interface HeatSpot {
  x: number;
  y: number;
  n: number;
}

/** En rage-punkt för heatmapen: elementets ref + medelposition + bursts. */
export interface RageSpot {
  ref: string;
  x: number;
  y: number;
  n: number;
}

/** Ena layoutvyn av heatmapen: punkter + rage för EN enhetsklass. `sampled` =
 *  antal positionsbärande klick i vyn — 0 ger ett ärligt "samlar in"-läge. */
/** Scrolldjups-räckvidd för en sida+layoutklass (attention map-underlaget):
 *  hur många besök som nådde 25/50/75/100 % av sidans scroll. `views` är
 *  nämnaren — pageviews attribuerade till sidan+enheten. Bygger på
 *  scroll_depth-events MED path (äldre snippets skickade utan — de kan inte
 *  placeras per sida och räknas ärligt inte). */
export interface ScrollReach {
  views: number;
  p25: number;
  p50: number;
  p75: number;
  p100: number;
}

export interface ClickHeatView {
  clicks: HeatSpot[];
  rage: RageSpot[];
  sampled: number;
  reach: ScrollReach;
}

/** Klick-heatmapens underlag för sajtens mest klickade sida, delat per
 *  layoutklass. x är % av BESÖKARENS viewportbredd och y % av DERAS dokument-
 *  höjd — punkterna är bara meningsfulla mot en spegel i samma layoutbredd,
 *  därför attribueras varje klick till mobil/desktop via besökarens pageview-
 *  enhet (tablet ⇒ desktop, närmast den layoutbredden). Klick vars besökare
 *  saknar pageview i fönstret kan inte placeras ärligt — de räknas i
 *  `unattributed` och ritas inte. */
export interface ClickHeat {
  path: string;
  mobile: ClickHeatView;
  desktop: ClickHeatView;
  unattributed: number;
}

/** Ett rage-klickat element, upprullat över alla besökare. */
export interface RageSignal {
  /** PII-skrubbad elementreferens (samma ref som journey-events, server-skrubbad). */
  ref: string;
  /** Antal rage-bursts på elementet (varje burst = ett frustrationstillfälle). */
  bursts: number;
  /** Distinkta besökare som rage-klickade elementet. */
  visitors: number;
}

/** Hur många rage-signaler dashboarden visar (mest frustrerande först). */
export const MAX_RAGE_SIGNALS = 15;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function patternsOf(payload: Record<string, unknown>): string[] {
  const p = payload.patterns;
  return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
}

/** Count occurrences of a key into a sorted (desc) bar list. */
function tally(pairs: (string | null)[], fallback = "unknown"): SegmentBar[] {
  const counts = new Map<string, number>();
  for (const raw of pairs) {
    const key = raw ?? fallback;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, pageviews]) => ({ key, pageviews }))
    .sort((a, b) => b.pageviews - a.pageviews || a.key.localeCompare(b.key));
}

export const MAX_LIVE_ADAPTATIONS = 25;

/** Longest daily series the chart renders — older buckets are dropped. */
export const MAX_DAY_POINTS = 90;

/** Longest visitor list the dashboard shows (newest activity first). */
export const MAX_VISITORS = 50;

/** How long after an exposure a conversion still counts toward it (24 h). */
export const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A pageview after the attribution window but within this horizon counts as
 *  a return visit (micro-conversion). */
export const MICRO_RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Deep scroll = at least this bucket. */
export const DEEP_SCROLL_DEPTH = 75;

// Minimum evidence before a lift may be called "significant". Without this a
// couple of lucky conversions cross |z| ≥ 1.96 and the bandit (which gates on
// `significant`) would flip or permanently suppress a pattern on pure noise.
// The thresholds enforce the normal-approximation validity condition for a
// two-proportion test: each arm needs ≥ MIN_ARM_EXPOSURES visitors and at least
// MIN_ARM_OUTCOMES conversions AND non-conversions (the "success–failure" rule).
export const MIN_ARM_EXPOSURES = 30;
export const MIN_ARM_OUTCOMES = 5;
/** Minsta antal page_perf-LCP-mätningar per arm innan medianen visas — under
 *  detta är enskilda långsamma laddningar för brusiga för en risk-avläsning. */
export const MIN_PERF_SAMPLES = 8;

/** Success–failure-regeln som EN exporterad predikat: armen har nog exponeringar
 *  OCH nog konverteringar OCH nog icke-konverteringar för att normal-
 *  approximationen ska hålla. winner.ts (A/B-utvärderaren) använder samma
 *  predikat — en regel, två domare, ingen drift. */
export function armStatValid(exposures: number, conversions: number): boolean {
  return (
    exposures >= MIN_ARM_EXPOSURES &&
    conversions >= MIN_ARM_OUTCOMES &&
    exposures - conversions >= MIN_ARM_OUTCOMES
  );
}

const armValid = (s: VariantStat): boolean => armStatValid(s.exposures, s.conversions);

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
};

/** Two-proportion z score for (c1/n1) vs (c2/n2), or null if a group is empty
 *  or the pooled variance is degenerate. */
/** Standardnormalens CDF via Abramowitz–Stegun-erf — för pWin-avläsningen. */
function phi(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** P(pA > pB) med Beta(1,1)-posterior per arm, normalapproximation av
 *  differensen. Grov men monoton och deterministisk — pilotavläsning, inte
 *  publikationsstatistik. */
function pBetaGreater(sA: number, nA: number, sB: number, nB: number): number {
  const moments = (s: number, n: number) => {
    const a = s + 1;
    const b = n - s + 1;
    const mean = a / (a + b);
    const variance = (a * b) / ((a + b) * (a + b) * (a + b + 1));
    return { mean, variance };
  };
  const A = moments(sA, nA);
  const B = moments(sB, nB);
  const denom = Math.sqrt(A.variance + B.variance);
  if (denom === 0) return 0.5;
  return phi((A.mean - B.mean) / denom);
}

/** Återbesöksfönstret för retention-proxyn: en NY pageview tidigast 6h och
 *  senast 7d efter exponeringen räknas som återbesök. */
const RETURN_MIN_MS = 6 * 60 * 60 * 1000;
const RETURN_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * v1-beviset (docs/v1-testdefinition.md): sajtnivå-jämförelse adapterad vs
 * hold-out. Varje besökare tillhör armen från sin FÖRSTA exponering
 * (deterministisk bucketing gör att arm-byten inte ska förekomma; om de ändå
 * gör det vinner den första observationen). Utfall räknas i attributions-
 * fönstret från den exponeringen: cta_click (success-mätaren), conversion,
 * och återbesök 6h–7d (nedströms/retention-proxyn).
 */
export function proofSummary(events: DashEvent[]): ProofSummary | null {
  const byVisitor = (
    type: string,
    keep: (e: DashEvent) => boolean = () => true,
  ): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (const e of events) {
      if (e.type !== type || !e.visitorHash || !keep(e)) continue;
      const t = ms(e.createdAt);
      if (Number.isNaN(t)) continue;
      (m.get(e.visitorHash) ?? m.set(e.visitorHash, []).get(e.visitorHash)!).push(t);
    }
    for (const times of m.values()) times.sort((a, b) => a - b);
    return m;
  };
  // Mål-klick vs Angel-genvägsklick hålls isär: "assist" finns bara i den
  // adapterade armen (kontrollen har inga injicerade genvägar), så att blanda
  // in dem i jämförelsen vore ett strukturellt tummen-på-vågen. Saknad path
  // räknas som mål-klick.
  const clicks = byVisitor("cta_click", (e) => e.payload.path !== "assist");
  const assists = byVisitor("cta_click", (e) => e.payload.path === "assist");
  const convs = byVisitor("conversion");
  const views = byVisitor("pageview");
  // Fältmätt LCP per besökare (risk-mätaren). Alla page_perf-lcp inom
  // attributionsfönstret samlas; medianen per arm jämförs.
  const perfLcp = new Map<string, { t: number; lcp: number }[]>();
  for (const e of events) {
    if (e.type !== "page_perf" || !e.visitorHash) continue;
    const lcp = e.payload.lcp;
    if (typeof lcp !== "number" || !isFinite(lcp) || lcp <= 0) continue;
    const t = ms(e.createdAt);
    if (Number.isNaN(t)) continue;
    (perfLcp.get(e.visitorHash) ?? perfLcp.set(e.visitorHash, []).get(e.visitorHash)!).push({
      t,
      lcp,
    });
  }

  // Besökare -> {arm, första exponering}.
  const assignment = new Map<string, { arm: "adapted" | "control"; t: number }>();
  for (const e of events) {
    const arm =
      e.type === "adaptation_shown"
        ? "adapted"
        : e.type === "adaptation_withheld"
          ? "control"
          : null;
    if (!arm || !e.visitorHash) continue;
    const t = ms(e.createdAt);
    if (Number.isNaN(t)) continue;
    const prev = assignment.get(e.visitorHash);
    if (!prev || t < prev.t) assignment.set(e.visitorHash, { arm, t });
  }
  if (assignment.size === 0) return null;

  const anyIn = (times: number[] | undefined, from: number, until: number): boolean => {
    if (!times) return false;
    for (const t of times) {
      if (t > until) break;
      if (t >= from) return true;
    }
    return false;
  };

  const empty = (): ArmProof => ({
    visitors: 0,
    ctaClicks: 0,
    assistClicks: 0,
    conversions: 0,
    returns: 0,
    ctaClickRate: 0,
    assistRate: 0,
    conversionRate: 0,
    returnRate: 0,
    lcpMedianMs: null,
  });
  const arms = { adapted: empty(), control: empty() };
  const lcpByArm = { adapted: [] as number[], control: [] as number[] };
  const firstInWindow = (
    rows: { t: number; lcp: number }[] | undefined,
    from: number,
    until: number,
  ) => {
    if (!rows) return null;
    for (const r of rows) if (r.t >= from && r.t <= until) return r.lcp;
    return null;
  };
  for (const [visitor, { arm, t }] of assignment) {
    const a = arms[arm];
    a.visitors++;
    if (anyIn(clicks.get(visitor), t, t + ATTRIBUTION_WINDOW_MS)) a.ctaClicks++;
    if (anyIn(assists.get(visitor), t, t + ATTRIBUTION_WINDOW_MS)) a.assistClicks++;
    if (anyIn(convs.get(visitor), t, t + ATTRIBUTION_WINDOW_MS)) a.conversions++;
    if (anyIn(views.get(visitor), t + RETURN_MIN_MS, t + RETURN_MAX_MS)) a.returns++;
    const lcp = firstInWindow(perfLcp.get(visitor), t, t + ATTRIBUTION_WINDOW_MS);
    if (lcp !== null) lcpByArm[arm].push(lcp);
  }
  const median = (xs: number[]): number | null => {
    if (xs.length < MIN_PERF_SAMPLES) return null; // för tunt för att lita på
    const s = [...xs].sort((x, y) => x - y);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  };
  for (const a of [arms.adapted, arms.control]) {
    a.ctaClickRate = a.visitors > 0 ? a.ctaClicks / a.visitors : 0;
    a.assistRate = a.visitors > 0 ? a.assistClicks / a.visitors : 0;
    a.conversionRate = a.visitors > 0 ? a.conversions / a.visitors : 0;
    a.returnRate = a.visitors > 0 ? a.returns / a.visitors : 0;
  }
  arms.adapted.lcpMedianMs = median(lcpByArm.adapted);
  arms.control.lcpMedianMs = median(lcpByArm.control);

  const holdoutActive = arms.control.visitors > 0;
  // Evidensgrind (se ProofSummary.pWin-kommentaren): under de här trösklarna
  // domineras posteriorn av prior + armstorleks-asymmetri och siffran ljuger.
  const enoughEvidence =
    arms.adapted.visitors >= MIN_ARM_EXPOSURES &&
    arms.control.visitors >= MIN_ARM_EXPOSURES &&
    arms.adapted.ctaClicks + arms.control.ctaClicks >= MIN_ARM_OUTCOMES;
  const pWin =
    holdoutActive && enoughEvidence
      ? pBetaGreater(
          arms.adapted.ctaClicks,
          arms.adapted.visitors,
          arms.control.ctaClicks,
          arms.control.visitors,
        )
      : null;

  return { adapted: arms.adapted, control: arms.control, pWin, holdoutActive };
}

/** Nivå 2 (docs/journey-intelligence.md): en anonym besöksRESA per session_id,
 *  rekonstruerad på läs-tid ur rå events (nivå 1). Det här är det motorn ska
 *  översätta till beslut — kanal, sidordning, klickordning, drop-off, utfall. */
/** Ett klick i ett sidsteg. x är % av besökarens viewportbredd, y % av
 *  dokumenthöjden (samma koordinatsemantik som heatmapens HeatSpot) — null
 *  för klick från snippet-versioner utan koordinater. */
export interface StepClick {
  ref: string;
  x: number | null;
  y: number | null;
  /** Ms sedan stegets början (ur eventens tidsstämplar) — Play-reprisens
   *  verkliga rytm: snabba klick i följd och tvekan syns som de var.
   *  Saknas när tidsstämpeln inte gick att tolka. */
  tMs?: number;
}

/** Ett sidsteg i en enskild besökares resa: sidan, klicken som föll på den
 *  och aktiv tid. Grunden för personläget i Journeys (steg-för-steg-spelaren,
 *  ägarorder 2026-07-18). */
export interface SessionStep {
  path: string;
  clicks: StepClick[];
  engagedMs: number;
  /** Djupaste scrollbucket (25/50/75/100) besökaren nådde på steget —
   *  personlägets "Scrolled to here"-linje. Saknas för events från äldre
   *  snippets (scroll_depth utan path kan inte placeras per steg). */
  scrollPct?: number | null;
  /** Sökningar på steget (berättelse-tidslinjen): term + ms sedan stegstart. */
  searches?: { term: string; tMs?: number }[];
  /** Videotittande på steget: elementref + summerad tittartid (flera flushar
   *  för samma video slås ihop). */
  videos?: { ref: string; watchedMs: number }[];
  /** Rage-klickade element på steget (samtyckesfiltrerade, dedupade). */
  rageRefs?: string[];
}

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  /** Kanal (trafficSource) från sessionens första pageview. */
  channel: string | null;
  device: string | null;
  /** Land (från första pageviewens kontext) — segmentdimension (Fas 2). */
  country: string | null;
  /** Ny vs återkommande besökare — segmentdimension (Fas 2). */
  isReturning: boolean;
  landingPath: string | null;
  /** Sidvägar i stegordning — en per sidsteg, härledd ur `steps`; samma sida
   *  kan återkomma senare i resan (bara direkta dubbletter slås ihop). */
  pageOrder: string[];
  /** Element-referenser i klickordning (intent-signalen). */
  clickOrder: string[];
  /** Sidsteg i ordning med klick + aktiv tid per steg (personläget). */
  steps: SessionStep[];
  /** Aktiv (synlig) tid summerad över sessionens page_leave. */
  engagedMs: number;
  formStarted: boolean;
  formSubmitted: boolean;
  formAbandoned: boolean;
  converted: boolean;
  /** Såg besökaren en adaptation (adapterad arm)? Best-effort via visitor_hash
   *  — exponeringar är inte session-taggade, men en session tillhör en hash. */
  sawAdaptation: boolean;
}

// Höjd 40 → 150 för Journeys v2: vägträdet + personbläddraren beräknas i
// klienten över listan, och 40 sessioner var för tunt underlag för flödet.
// Kortet i översikten visar fortfarande bara de 3 senaste.
export const MAX_SESSION_SUMMARIES = 150;
const JOURNEY_STEP_CAP = 20; // håll sido-/klickordningen bounded i UI:t

/** Rekonstruera de senaste sessionernas resor. Grupperar på payload.sessionId
 *  (äldre/anonyma events utan id hoppas över). Ren funktion. */
export function sessionSummaries(
  events: DashEvent[],
  limit = MAX_SESSION_SUMMARIES,
): SessionSummary[] {
  // adaptation_shown-tidsstämplar per besökare — så sawAdaptation kan scopas
  // till DENNA sessions fönster (exponeringar är inte session-taggade; att bara
  // flagga "besökaren adapterades någonstans" över-påstår för sessioner där
  // inget visades, eller som slutade före adaptationen).
  const shownByVisitor = new Map<string, number[]>();
  for (const e of events) {
    if (e.type !== "adaptation_shown" || !e.visitorHash) continue;
    const t = ms(e.createdAt);
    if (Number.isNaN(t)) continue;
    (
      shownByVisitor.get(e.visitorHash) ?? shownByVisitor.set(e.visitorHash, []).get(e.visitorHash)!
    ).push(t);
  }

  const bySession = new Map<string, DashEvent[]>();
  for (const e of events) {
    const sid = typeof e.payload.sessionId === "string" ? e.payload.sessionId : null;
    if (!sid) continue;
    (bySession.get(sid) ?? bySession.set(sid, []).get(sid)!).push(e);
  }

  // Kronologisk sortering NUMERISKT — localeCompare på ISO-strängar mis-ordnar
  // PostgREST-tidsstämplar där mikrosekunderna är 0 (bråkdelen utelämnas, så
  // '…:00+00:00' sorteras efter '…:00.24+00:00' lexikalt). Ostabila events
  // (oparsbar tid) läggs sist.
  const sortKey = (e: DashEvent) => {
    const t = ms(e.createdAt);
    return Number.isNaN(t) ? Infinity : t;
  };

  const summaries: SessionSummary[] = [];
  for (const [sessionId, evs] of bySession) {
    evs.sort((a, b) => sortKey(a) - sortKey(b));
    const firstPv = evs.find((e) => e.type === "pageview");
    const visitorHash = evs.find((e) => e.visitorHash)?.visitorHash ?? null;
    const startMs = sortKey(evs[0]);
    const endMs = sortKey(evs[evs.length - 1]);

    const clickOrder: string[] = [];
    const steps: SessionStep[] = [];
    let engagedMs = 0;
    let formStarted = false;
    let formSubmitted = false;
    let formAbandoned = false;
    let converted = false;
    // Stegens starttider (eventets tidsstämpel när steget skapades) — ger
    // klickens tMs-offset så Play-reprisen kan spela besökarens VERKLIGA
    // rytm. Lokal karta, aldrig del av resultatet.
    const stepStart = new Map<SessionStep, number>();
    for (const e of evs) {
      // Normalisera till pathname — heatmapen, frysnycklarna och nattloopens
      // frysurval strippar redan query/hash, och ett allowlistat query-byte
      // (utm_source=fb → tw) på samma sida är inte ett sidsteg.
      const path = typeof e.payload.path === "string" ? stripQueryHash(e.payload.path) : null;
      const eMs = Date.parse(e.createdAt);
      if (e.type === "pageview" && path) {
        // Nytt sidsteg på sidbyte — dubblett-pageviews fortsätter samma steg.
        // (Sidordningen härleds ur stegen efter loopen — EN sanning för
        // träd/lista/spelare.)
        if (steps[steps.length - 1]?.path !== path && steps.length < JOURNEY_STEP_CAP) {
          const st: SessionStep = { path, clicks: [], engagedMs: 0 };
          steps.push(st);
          if (Number.isFinite(eMs)) stepStart.set(st, eMs);
        }
      } else if (e.type === "element_click") {
        const ref = typeof e.payload.ref === "string" ? e.payload.ref : "";
        // Samtyckes-klick är bannerns UX, inte sajtens — bort ur resan
        // (retro-filtret; nya snippets skickar dem inte alls).
        if (ref && !isConsentRef(ref)) {
          clickOrder.push(ref);
          // Klicket hör till sitt EGET path när det finns (sena events kan
          // anlända efter nästa pageview), annars pågående steget.
          let step = path
            ? [...steps].reverse().find((s) => s.path === path)
            : steps[steps.length - 1];
          // Klick-räddningen (SPA-fyndet 2026-07-19): äldre snippets skickar
          // ingen pageview vid klientruttbyte — ett klick på en OSEDD path är
          // beviset på att besökaren navigerat dit. Nytt steg i klickordning,
          // så resan går att följa även i historisk data.
          if (!step && path && steps.length < JOURNEY_STEP_CAP) {
            step = { path, clicks: [], engagedMs: 0 };
            steps.push(step);
            if (Number.isFinite(eMs)) stepStart.set(step, eMs);
          }
          // Klick med känd path som ändå saknar steg (steg-taket nått) lämnas
          // utan stegattribuering — det finns kvar i clickOrder, men bokförs
          // ALDRIG på en sida payloaden uttryckligen motsäger.
          if (step && step.clicks.length < JOURNEY_STEP_CAP) {
            const x = e.payload.x;
            const y = e.payload.y;
            const start = stepStart.get(step);
            step.clicks.push({
              ref,
              x: typeof x === "number" && isFinite(x) ? x : null,
              y: typeof y === "number" && isFinite(y) ? y : null,
              ...(start !== undefined && Number.isFinite(eMs)
                ? { tMs: Math.max(0, eMs - start) }
                : {}),
            });
          }
        }
      } else if (e.type === "scroll_depth") {
        // Besökarens djupaste scroll per steg — samma path-matchning som
        // klick/page_leave; legacy-events utan path hoppas ärligt.
        const depth = e.payload.depth;
        if (path && (depth === 25 || depth === 50 || depth === 75 || depth === 100)) {
          const step = [...steps].reverse().find((s) => s.path === path);
          if (step) step.scrollPct = Math.max(step.scrollPct ?? 0, depth);
        }
      } else if (e.type === "site_search") {
        // Söksteg i berättelsen — samma path-attribuering som klicken (eventet
        // bär sitt eget path; path-lösa faller till pågående steget).
        const term = typeof e.payload.term === "string" ? e.payload.term : "";
        const step = path
          ? [...steps].reverse().find((s) => s.path === path)
          : steps[steps.length - 1];
        if (term && step && (step.searches?.length ?? 0) < JOURNEY_STEP_CAP) {
          const start = stepStart.get(step);
          (step.searches ??= []).push({
            term,
            ...(start !== undefined && Number.isFinite(eMs)
              ? { tMs: Math.max(0, eMs - start) }
              : {}),
          });
        }
      } else if (e.type === "video_watch") {
        // Videotid per steg — snippeten flushar per ruttbyte + pagehide, så
        // samma video kan ge flera events; summera per ref.
        const ref = typeof e.payload.ref === "string" ? e.payload.ref : "";
        const w = e.payload.watchedMs;
        const step = path
          ? [...steps].reverse().find((s) => s.path === path)
          : steps[steps.length - 1];
        if (ref && step && typeof w === "number" && isFinite(w) && w > 0) {
          const vids = (step.videos ??= []);
          const existing = vids.find((v) => v.ref === ref);
          if (existing) existing.watchedMs += w;
          else if (vids.length < JOURNEY_STEP_CAP) vids.push({ ref, watchedMs: w });
        }
      } else if (e.type === "rage_click") {
        // Frustrationsraden i berättelsen — samtyckesfiltrerad som klicken.
        const ref = typeof e.payload.ref === "string" ? e.payload.ref : "";
        const step = path
          ? [...steps].reverse().find((s) => s.path === path)
          : steps[steps.length - 1];
        if (ref && !isConsentRef(ref) && step) {
          const rr = (step.rageRefs ??= []);
          if (!rr.includes(ref) && rr.length < JOURNEY_STEP_CAP) rr.push(ref);
        }
      } else if (e.type === "page_leave") {
        const ms = e.payload.engagedMs;
        if (typeof ms === "number" && isFinite(ms) && ms > 0) {
          engagedMs += ms;
          // Samma semantik som klick-grenen: tiden hör till sitt EGET sidsteg
          // när path finns; bara path-lösa page_leave faller till pågående
          // steget. Matchar inget steg bokförs tiden inte per steg (den ingår
          // ändå i sessionens total) — hellre tappad än på fel sida.
          const step = path
            ? [...steps].reverse().find((s) => s.path === path)
            : steps[steps.length - 1];
          if (step) step.engagedMs += ms;
        }
      } else if (e.type === "form_start") formStarted = true;
      else if (e.type === "form_submit") formSubmitted = true;
      else if (e.type === "form_abandon") formAbandoned = true;
      else if (e.type === "conversion") converted = true;
    }

    summaries.push({
      sessionId,
      startedAt: evs[0].createdAt,
      endedAt: evs[evs.length - 1].createdAt,
      channel: firstPv ? str(firstPv.payload.trafficSource) : null,
      device: firstPv ? str(firstPv.payload.device) : null,
      country: firstPv ? str(firstPv.payload.country) : null,
      isReturning: firstPv ? firstPv.payload.isReturning === true : false,
      landingPath: steps[0]?.path ?? null,
      pageOrder: steps.map((st) => st.path),
      clickOrder: clickOrder.slice(0, JOURNEY_STEP_CAP),
      steps,
      engagedMs,
      formStarted,
      formSubmitted,
      // ENBART klientens form_abandon-flagga (snippeten fyrar den på pagehide
      // för startat-men-ej-submittat formulär). Den tidigare fallback-
      // heuristiken kollade page_leave över HELA sessionen och flaggade ett
      // pågående formulär som övergivet så fort besökaren sett en tidigare
      // sida (granskningsfynd).
      formAbandoned,
      converted,
      // Adaptation VISAD inom den här sessionens fönster (inte "besökaren
      // adapterades någonsin").
      sawAdaptation: visitorHash
        ? (shownByVisitor.get(visitorHash) ?? []).some((t) => t >= startMs && t <= endMs)
        : false,
    });
  }

  // Nyaste först — numeriskt (samma anledning som per-event-sorteringen).
  const endKey = (iso: string) => {
    const t = ms(iso);
    return Number.isNaN(t) ? -Infinity : t;
  };
  summaries.sort((a, b) => endKey(b.endedAt) - endKey(a.endedAt));
  return summaries.slice(0, limit);
}

/** Fas 2 (docs/fas2-segment-grouping.md): en besökargrupp, byggd ur en ORDNAD
 *  dimensionshierarki [kanal, enhet, land, ny/återkommande]. Ett segment = ett
 *  PREFIX av den (depth 2 = "google_phone"). Insikt — INGEN adaptation. */
export interface SegmentSummary {
  /** Stabil nyckel grov→fin, t.ex. "google" | "google·phone" | "google·phone·se". */
  key: string;
  /** Läsbar etikett ("google · phone"). */
  label: string;
  /** Antal bundna dimensioner (1..4). 2 = kanal×enhet. */
  depth: number;
  channel: string | null;
  device: string | null;
  country: string | null;
  /** null tills ny/återkommande-dimensionen är bunden (depth 4). */
  returning: boolean | null;
  visits: number;
  conversions: number;
  conversionRate: number;
  formStarts: number;
  formAbandons: number;
  /** Datatillräcklighet mot volymgrinden (SEGMENT_MIN_*). false = "för tunt för
   *  beslut" — visas ärligt, driver ingen ändring. */
  adequate: boolean;
  /** Samma segment över ett NYLIGT fönster (senaste RECENT_WINDOW_DAYS) — så
   *  ägaren ser om gruppen ändras över tid. null när den nyliga hinken saknas
   *  eller är under display-tröskeln (ärligt: ingen trend på tunn data). */
  recent: SegmentWindow | null;
}

/** En segmentmätning över ett tidsfönster (t.ex. senaste 30 dgr). */
export interface SegmentWindow {
  visits: number;
  conversions: number;
  conversionRate: number;
  adequate: boolean;
}

/** Volymgrind (riktvärde ur croengine-vision.md): ett segment bär en meningsfull
 *  avläsning först vid ~1000 besök / 100 konverteringar. Under det är siffrorna
 *  brus och märks som sådant. */
export const SEGMENT_MIN_VISITS = 1000;
export const SEGMENT_MIN_CONVERSIONS = 100;
/** Dölj enstaka-besök-brus i kortet (ett segment med 2 besök säger inget). */
export const SEGMENT_MIN_DISPLAY = 5;
/** Håll segmentlistan bounded i UI:t. */
export const MAX_SEGMENTS = 30;
/** Tidsfönster för "senaste"-jämförelsen per segment (dagar). */
export const RECENT_WINDOW_DAYS = 30;

// Nyckelsemantiken (segToken/returningToken/segmentKeyOf) bor i
// src/lib/segment-key.ts (task #89) — samma byggare som serve-vägen, så
// rollupens nycklar och variantmatchningen aldrig kan glida isär.

/** En förskotts-aggregerad segment-lövnod: finaste grain
 *  (kanal·enhet·land·ny/återkommande) med räknare. Både server-rollupen
 *  (`angel_segment_rollup`, HELA historiken) och JS-fallbacken
 *  (`segmentSummaries`, event-fönstret) matar in dessa till `expandSegmentLeaves`
 *  — en delad kärna, samma resultat oavsett källa. */
export interface SegmentLeaf {
  channel: string;
  device: string;
  country: string;
  returning: boolean;
  visits: number;
  conversions: number;
  formStarts: number;
  formAbandons: number;
}

/** Expandera finaste-grain-löv till grov→fin-prefix. Varje löv bidrar till ALLA
 *  sina prefix: en google·mobile·se-nod räknas också i google·mobile och google
 *  — så grova grupper alltid har mest data ("låna styrka"). Volymgrind +
 *  display-tröskel + deterministisk sortering. Ren. */
export function expandSegmentLeaves(leaves: SegmentLeaf[], limit = MAX_SEGMENTS): SegmentSummary[] {
  type Acc = {
    dims: string[];
    visits: number;
    conversions: number;
    formStarts: number;
    formAbandons: number;
  };
  const byKey = new Map<string, Acc>();
  for (const leaf of leaves) {
    const dims = [
      segToken(leaf.channel),
      segToken(leaf.device),
      segToken(leaf.country),
      returningToken(leaf.returning),
    ];
    for (let d = 1; d <= dims.length; d++) {
      const prefix = dims.slice(0, d);
      const key = segmentKeyOf(prefix);
      const acc =
        byKey.get(key) ??
        (byKey
          .set(key, { dims: prefix, visits: 0, conversions: 0, formStarts: 0, formAbandons: 0 })
          .get(key) as Acc);
      acc.visits += leaf.visits;
      acc.conversions += leaf.conversions;
      acc.formStarts += leaf.formStarts;
      acc.formAbandons += leaf.formAbandons;
    }
  }

  const out: SegmentSummary[] = [];
  for (const [key, a] of byKey) {
    if (a.visits < SEGMENT_MIN_DISPLAY) continue; // dölj enstaka-besök-brus
    const depth = a.dims.length;
    out.push({
      key,
      label: a.dims.join(" · "),
      depth,
      channel: a.dims[0] ?? null,
      device: depth >= 2 ? a.dims[1] : null,
      country: depth >= 3 ? a.dims[2] : null,
      returning: depth >= 4 ? a.dims[3] === RETURNING_TOKEN : null,
      visits: a.visits,
      conversions: a.conversions,
      conversionRate: a.visits > 0 ? a.conversions / a.visits : 0,
      formStarts: a.formStarts,
      formAbandons: a.formAbandons,
      adequate: a.visits >= SEGMENT_MIN_VISITS && a.conversions >= SEGMENT_MIN_CONVERSIONS,
      // Nyligt fönster fylls i av attachRecent (server-vägen); null tills dess.
      recent: null,
    });
  }
  // Grovast först (kortet läses top-down: kanal → kanal·enhet → …), sedan störst
  // volym, sedan nyckel för deterministisk ordning.
  out.sort((x, y) => x.depth - y.depth || y.visits - x.visits || x.key.localeCompare(y.key));
  return out.slice(0, limit);
}

/** Slå ihop en NYLIG segment-rollup (samma expandSegmentLeaves, men bara events
 *  inom fönstret) på den livstids-baserade listan: varje livstidssegment får
 *  `recent` = sitt nyliga motsvarighet per nyckel, eller null om den nyliga
 *  hinken saknas/är för tunn. Ren — livstidslistan är sanningen för vilka rader
 *  som visas; recent är bara en extra kolumn. */
export function attachRecent(
  allTime: SegmentSummary[],
  recent: SegmentSummary[],
): SegmentSummary[] {
  const byKey = new Map(recent.map((s) => [s.key, s]));
  return allTime.map((s) => {
    const r = byKey.get(s.key);
    return {
      ...s,
      recent: r
        ? {
            visits: r.visits,
            conversions: r.conversions,
            conversionRate: r.conversionRate,
            adequate: r.adequate,
          }
        : null,
    };
  });
}

/** En nod i Journeys-flödets rankade vägträd. */
export interface FlowNode {
  /** Sidväg — eller null för "övriga"-hinken (svansen bortom topplistan). */
  path: string | null;
  /** Sessioner vars resa passerade noden (via prefixet ovanför den). */
  sessions: number;
  /** ...varav sessioner som någon gång under besöket konverterade. */
  converted: number;
  /** ...varav sessioner vars resa SLUTADE här (inga fler sidsteg). */
  exited: number;
  /** Nästa sidsteg rankade efter volym. Tom på maxdjup och i övriga-hinken. */
  children: FlowNode[];
}

export interface JourneyFlow {
  /** Sessioner med minst ett sidsteg (basen för procenttalen). */
  totalSessions: number;
  /** Entrésidor rankade efter volym (+ ev. övriga-hink sist). */
  entries: FlowNode[];
}

export const FLOW_DEPTH = 3;
export const FLOW_TOP_PER_LEVEL = 5;

/** Journeys v2 (ägarorder 2026-07-18, Clarity-formen vald): rulla upp
 *  sessionernas sidordningar till ett rankat vägträd — entrésidor → nästa
 *  steg → utfall, topp-N per nivå med en ärlig "övriga"-hink för svansen.
 *  Tål tunn data: tio sessioner ger ett litet men korrekt träd, aldrig en
 *  trasig graf. Ren funktion. */
export function journeyFlow(
  sessions: SessionSummary[],
  depth = FLOW_DEPTH,
  top = FLOW_TOP_PER_LEVEL,
): JourneyFlow {
  const build = (group: SessionSummary[], level: number): FlowNode[] => {
    const byPath = new Map<string, SessionSummary[]>();
    for (const s of group) {
      const p = s.pageOrder[level];
      if (!p) continue;
      (byPath.get(p) ?? byPath.set(p, []).get(p)!).push(s);
    }
    // Tiebreak på kodpunkter, INTE localeCompare — funktionen kör i besökarens
    // browser och topp-N/övriga-gränsen får inte bero på betraktarens locale.
    const ranked = [...byPath.entries()].sort(
      (a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    );
    const node = (path: string | null, g: SessionSummary[], recurse: boolean): FlowNode => ({
      path,
      sessions: g.length,
      converted: g.filter((s) => s.converted).length,
      exited: g.filter((s) => s.pageOrder.length === level + 1).length,
      children: recurse && level + 1 < depth ? build(g, level + 1) : [],
    });
    const nodes = ranked.slice(0, top).map(([p, g]) => node(p, g, true));
    const tail = ranked.slice(top).flatMap(([, g]) => g);
    if (tail.length > 0) nodes.push(node(null, tail, false));
    return nodes;
  };
  return {
    // SAMMA predikat som build-loopens truthy-filter — en session som inte kan
    // hamna i någon entry-nod får inte heller räknas in i procentbasen.
    totalSessions: sessions.filter((s) => !!s.pageOrder[0]).length,
    entries: build(sessions, 0),
  };
}

/** JS-fallback (och testyta): rulla upp sessioner till segment när server-
 *  rollupen inte är tillgänglig. Varje session = ett löv (visits=1). Samma kärna
 *  som server-vägen via `expandSegmentLeaves`. OBS: kapat till dashboardens
 *  event-fönster (EVENT_LIMIT) — server-rollupen ser HELA historiken, vilket är
 *  det som gör volymgrinden pålitlig vid riktig trafik. */
export function segmentSummaries(
  sessions: SessionSummary[],
  limit = MAX_SEGMENTS,
): SegmentSummary[] {
  return expandSegmentLeaves(
    sessions.map((s) => ({
      channel: s.channel ?? "",
      device: s.device ?? "",
      country: s.country ?? "",
      returning: s.isReturning,
      visits: 1,
      conversions: s.converted ? 1 : 0,
      formStarts: s.formStarted ? 1 : 0,
      formAbandons: s.formAbandoned ? 1 : 0,
    })),
    limit,
  );
}

/** Exported so the variant winner-evaluator (adaptive/redesign/winner.ts) reuses
 *  the SAME significance math as pattern attribution — one definition, no drift. */
export function twoProportionZ(c1: number, n1: number, c2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const pooled = (c1 + c2) / (n1 + n2);
  const denom = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (denom === 0) return null;
  return (p1 - p2) / denom;
}

/**
 * Attribute conversions to the patterns a visitor was exposed to. For every
 * (pattern, variant) we take each visitor's EARLIEST exposure and count them as
 * converted if that same visitor has any conversion in
 * [exposure, exposure + window]. Distinct-visitor throughout, so repeat
 * pageviews don't inflate the numbers. Exposures without a visitorHash can't be
 * joined and are ignored.
 */
export function attribute(events: DashEvent[]): PatternAttribution[] {
  // Per-visitor event timelines (ms, sorted): conversions for the headline
  // metric, deep scrolls + pageviews for the micro-conversions.
  const conversionsByVisitor = new Map<string, number[]>();
  const deepScrollsByVisitor = new Map<string, number[]>();
  const pageviewsByVisitor = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, visitor: string, t: number) =>
    (map.get(visitor) ?? map.set(visitor, []).get(visitor)!).push(t);
  for (const e of events) {
    if (!e.visitorHash) continue;
    const t = ms(e.createdAt);
    if (Number.isNaN(t)) continue;
    if (e.type === "conversion") push(conversionsByVisitor, e.visitorHash, t);
    else if (e.type === "pageview") push(pageviewsByVisitor, e.visitorHash, t);
    else if (
      e.type === "scroll_depth" &&
      typeof e.payload.depth === "number" &&
      e.payload.depth >= DEEP_SCROLL_DEPTH
    ) {
      push(deepScrollsByVisitor, e.visitorHash, t);
    }
  }
  for (const map of [conversionsByVisitor, deepScrollsByVisitor, pageviewsByVisitor]) {
    for (const times of map.values()) times.sort((a, b) => a - b);
  }

  const countIn = (times: number[] | undefined, from: number, until: number): number => {
    if (!times) return 0;
    let n = 0;
    for (const t of times) if (t >= from && t <= until) n++;
    return n;
  };

  const converted = (visitor: string, from: number): boolean =>
    countIn(conversionsByVisitor.get(visitor), from, from + ATTRIBUTION_WINDOW_MS) > 0;

  // pattern -> variant -> visitor -> earliest exposure time (ms)
  type VariantKey = "adapted" | "control";
  type Arms = Record<VariantKey, Map<string, number>>;
  const newArms = (): Arms => ({ adapted: new Map(), control: new Map() });
  const exposures = new Map<string, Arms>();
  // Per (pattern, trafficSource) exposure sets (D4): the doc-specified
  // "per pattern × segment" read. Same earliest-exposure semantics.
  const segExposures = new Map<string, Map<string, Arms>>();
  for (const e of events) {
    const variant: VariantKey | null =
      e.type === "adaptation_shown"
        ? "adapted"
        : e.type === "adaptation_withheld"
          ? "control"
          : null;
    if (!variant || !e.visitorHash) continue;
    const t = ms(e.createdAt);
    if (Number.isNaN(t)) continue;
    const segment = str(e.payload.trafficSource);
    for (const pattern of patternsOf(e.payload)) {
      let byVariant = exposures.get(pattern);
      if (!byVariant) {
        byVariant = newArms();
        exposures.set(pattern, byVariant);
      }
      const seen = byVariant[variant];
      const prev = seen.get(e.visitorHash);
      if (prev === undefined || t < prev) seen.set(e.visitorHash, t);
      if (segment) {
        let bySeg = segExposures.get(pattern);
        if (!bySeg) {
          bySeg = new Map();
          segExposures.set(pattern, bySeg);
        }
        let segArms = bySeg.get(segment);
        if (!segArms) {
          segArms = newArms();
          bySeg.set(segment, segArms);
        }
        const segSeen = segArms[variant];
        const segPrev = segSeen.get(e.visitorHash);
        if (segPrev === undefined || t < segPrev) segSeen.set(e.visitorHash, t);
      }
    }
  }

  const stat = (visitors: Map<string, number>): VariantStat => {
    let conversions = 0;
    for (const [visitor, from] of visitors) if (converted(visitor, from)) conversions++;
    const exp = visitors.size;
    return { exposures: exp, conversions, rate: exp > 0 ? conversions / exp : 0 };
  };

  // Engagement among NON-converters only (D2): a converted visitor already
  // gave the terminal signal — counting their missing scroll/return against
  // a pattern punished exactly the patterns that convert people fast.
  const microStat = (visitors: Map<string, number>): MicroStats => {
    const m: MicroStats = { deepScroll: 0, multiPage: 0, returned: 0 };
    for (const [visitor, from] of visitors) {
      if (converted(visitor, from)) continue;
      const until = from + ATTRIBUTION_WINDOW_MS;
      if (countIn(deepScrollsByVisitor.get(visitor), from, until) > 0) m.deepScroll++;
      if (countIn(pageviewsByVisitor.get(visitor), from, until) >= 2) m.multiPage++;
      if (countIn(pageviewsByVisitor.get(visitor), until, from + MICRO_RETURN_WINDOW_MS) > 0) {
        m.returned++;
      }
    }
    return m;
  };

  const rowFor = (pattern: string, segment: string | null, arms: Arms): PatternAttribution => {
    const adapted = stat(arms.adapted);
    const control = stat(arms.control);
    const hasBoth = adapted.exposures > 0 && control.exposures > 0;
    const z = hasBoth
      ? twoProportionZ(
          adapted.conversions,
          adapted.exposures,
          control.conversions,
          control.exposures,
        )
      : null;
    return {
      pattern,
      segment,
      adapted,
      control,
      adaptedMicro: microStat(arms.adapted),
      controlMicro: microStat(arms.control),
      lift: hasBoth ? adapted.rate - control.rate : null,
      z,
      // Require a valid, adequately-powered sample in BOTH arms, not just a
      // z-crossing — otherwise tiny-n noise reads as a proven win/loss.
      significant: z !== null && Math.abs(z) >= 1.96 && armValid(adapted) && armValid(control),
    };
  };

  const out: PatternAttribution[] = [];
  for (const [pattern, byVariant] of exposures) {
    out.push(rowFor(pattern, null, byVariant));
    // Segment rows only where an arm is adequately powered — thin segments
    // would just be noise rows in the dashboard.
    const bySeg = segExposures.get(pattern);
    if (!bySeg) continue;
    const segRows: PatternAttribution[] = [];
    for (const [segment, arms] of bySeg) {
      if (arms.adapted.size >= MIN_ARM_EXPOSURES || arms.control.size >= MIN_ARM_EXPOSURES) {
        segRows.push(rowFor(pattern, segment, arms));
      }
    }
    segRows.sort(
      (a, b) =>
        b.adapted.exposures - a.adapted.exposures ||
        (a.segment ?? "").localeCompare(b.segment ?? ""),
    );
    out.push(...segRows);
  }

  // Overall rows keep the original ordering contract; each pattern's segment
  // rows follow their overall row directly (already appended in order).
  const overallOrder = new Map(
    [...exposures.entries()]
      .map(([pattern, arms]) => ({ pattern, exp: arms.adapted.size }))
      .sort((a, b) => b.exp - a.exp || a.pattern.localeCompare(b.pattern))
      .map((e, i) => [e.pattern, i] as const),
  );
  return out.sort(
    (a, b) =>
      (overallOrder.get(a.pattern) ?? 0) - (overallOrder.get(b.pattern) ?? 0) ||
      Number(a.segment !== null) - Number(b.segment !== null) ||
      b.adapted.exposures - a.adapted.exposures ||
      (a.segment ?? "").localeCompare(b.segment ?? ""),
  );
}

// ---- time bucketing ----------------------------------------------------------

/** Exposure events: one per page render, logged server-side for ALL traffic
 *  (anonymous included) — the closest thing we store to "a visit". */
const isExposure = (t: string) => t === "adaptation_shown" || t === "adaptation_withheld";

/** Shift an event's UTC ms into the display timezone so its UTC getters read as
 *  local wall-clock. `tzOffsetMinutes` uses Date#getTimezoneOffset semantics
 *  (UTC − local, so Stockholm in summer is −120). */
const shifted = (iso: string, tzOffsetMinutes: number): Date | null => {
  const t = ms(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t - tzOffsetMinutes * 60_000);
};

/**
 * Bucket traffic by calendar day and by hour of day (both in the display tz).
 * Days are gap-filled with zeros between the first and last event so the chart
 * has a continuous axis; the series is capped to the newest MAX_DAY_POINTS.
 * Hours are always the full 0..23 profile aggregated across the window. Pure —
 * buckets derive only from event timestamps, never the clock.
 */
export function bucketByTime(
  events: DashEvent[],
  tzOffsetMinutes = 0,
): { daily: DayPoint[]; hourly: HourPoint[] } {
  type DayAcc = { visits: number; identified: Set<string>; conversions: number };
  const days = new Map<string, DayAcc>();
  const hours: { visits: number; identified: Set<string> }[] = Array.from({ length: 24 }, () => ({
    visits: 0,
    identified: new Set<string>(),
  }));

  for (const e of events) {
    const d = shifted(e.createdAt, tzOffsetMinutes);
    if (!d) continue;
    const dayKey = d.toISOString().slice(0, 10);
    const hour = d.getUTCHours();
    let day = days.get(dayKey);
    if (!day) {
      day = { visits: 0, identified: new Set(), conversions: 0 };
      days.set(dayKey, day);
    }
    if (isExposure(e.type)) {
      day.visits++;
      hours[hour].visits++;
    }
    if (e.visitorHash) {
      day.identified.add(e.visitorHash);
      hours[hour].identified.add(e.visitorHash);
    }
    if (e.type === "conversion") day.conversions++;
  }

  // Gap-fill: walk day by day from the earliest to the latest bucket. Stepping
  // in whole UTC days over the shifted timeline is DST-safe.
  const daily: DayPoint[] = [];
  const keys = [...days.keys()].sort();
  if (keys.length > 0) {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const first = Date.parse(`${keys[0]}T00:00:00Z`);
    const last = Date.parse(`${keys[keys.length - 1]}T00:00:00Z`);
    for (let t = first; t <= last; t += DAY_MS) {
      const key = new Date(t).toISOString().slice(0, 10);
      const acc = days.get(key);
      daily.push({
        day: key,
        visits: acc?.visits ?? 0,
        identified: acc?.identified.size ?? 0,
        conversions: acc?.conversions ?? 0,
      });
    }
  }

  return {
    daily: daily.slice(-MAX_DAY_POINTS),
    hourly: hours.map((h, hour) => ({ hour, visits: h.visits, identified: h.identified.size })),
  };
}

/**
 * Group events into per-visitor footprints (identified visitors only —
 * anonymous traffic has no id and is unlinkable by design). Sorted by most
 * recent activity, capped at MAX_VISITORS. Order-independent: the context
 * columns come from the NEWEST pageview by timestamp, not input position.
 */
export function summarizeVisitors(events: DashEvent[]): VisitorSummary[] {
  type Acc = {
    first: string;
    last: string;
    events: number;
    pageviews: number;
    ctaClicks: number;
    maxScroll: number;
    conversions: number;
    patterns: Set<string>;
    adapted: boolean;
    control: boolean;
    /** Timestamp of the pageview the context columns came from. */
    ctxAt: string | null;
    device: string | null;
    country: string | null;
    trafficSource: string | null;
    browser: string | null;
  };
  const byVisitor = new Map<string, Acc>();

  for (const e of events) {
    if (!e.visitorHash) continue;
    let acc = byVisitor.get(e.visitorHash);
    if (!acc) {
      acc = {
        first: e.createdAt,
        last: e.createdAt,
        events: 0,
        pageviews: 0,
        ctaClicks: 0,
        maxScroll: 0,
        conversions: 0,
        patterns: new Set(),
        adapted: false,
        control: false,
        ctxAt: null,
        device: null,
        country: null,
        trafficSource: null,
        browser: null,
      };
      byVisitor.set(e.visitorHash, acc);
    }
    acc.events++;
    if (e.createdAt < acc.first) acc.first = e.createdAt;
    if (e.createdAt > acc.last) acc.last = e.createdAt;
    if (e.type === "pageview") {
      acc.pageviews++;
      // The newest pageview (by timestamp — input order varies) provides the
      // context columns.
      if (acc.ctxAt === null || e.createdAt >= acc.ctxAt) {
        acc.ctxAt = e.createdAt;
        acc.device = str(e.payload.device) ?? acc.device;
        acc.country = str(e.payload.country) ?? acc.country;
        acc.trafficSource = str(e.payload.trafficSource) ?? acc.trafficSource;
        acc.browser = str(e.payload.browser) ?? acc.browser;
      }
    } else if (e.type === "cta_click") {
      acc.ctaClicks++;
    } else if (e.type === "scroll_depth") {
      const depth = typeof e.payload.depth === "number" ? e.payload.depth : 0;
      if (depth > acc.maxScroll) acc.maxScroll = depth;
    } else if (e.type === "conversion") {
      acc.conversions++;
    } else if (isExposure(e.type)) {
      for (const p of patternsOf(e.payload)) acc.patterns.add(p);
      if (e.type === "adaptation_shown") acc.adapted = true;
      else acc.control = true;
    }
  }

  return [...byVisitor.entries()]
    .map(([hash, a]) => ({
      hash,
      firstSeen: a.first,
      lastSeen: a.last,
      events: a.events,
      pageviews: a.pageviews,
      ctaClicks: a.ctaClicks,
      maxScroll: a.maxScroll,
      conversions: a.conversions,
      patterns: [...a.patterns].sort(),
      arm: (a.adapted && a.control
        ? "mixed"
        : a.adapted
          ? "adapted"
          : a.control
            ? "control"
            : null) as VisitorSummary["arm"],
      device: a.device,
      country: a.country,
      trafficSource: a.trafficSource,
      browser: a.browser,
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.hash.localeCompare(b.hash))
    .slice(0, MAX_VISITORS);
}

/** "Mest rage-klickade element" — rulla upp rage_click-events (ref → bursts).
 *  Varje event är redan EN burst (snippeten fyrar en per ≥3-klicksfönster);
 *  vi räknar bursts + distinkta besökare per ref. Diagnostik för ägaren/AI:n
 *  — driver aldrig en automatisk ändring. Ref:en är redan server-skrubbad
 *  (scrubPath i buildEventRows), så ingen PII-yta här. */
export function rageSignals(events: DashEvent[], limit = MAX_RAGE_SIGNALS): RageSignal[] {
  const byRef = new Map<string, { bursts: number; visitors: Set<string> }>();
  for (const e of events) {
    if (e.type !== "rage_click") continue;
    const ref = str(e.payload.ref);
    if (!ref) continue;
    // Frustration på cookiebannern är bannerns problem, inte sajtens —
    // ägaren kan inte åtgärda den via Angel (retro-filtret).
    if (isConsentRef(ref)) continue;
    const cur = byRef.get(ref) ?? { bursts: 0, visitors: new Set<string>() };
    cur.bursts++;
    if (e.visitorHash) cur.visitors.add(e.visitorHash);
    byRef.set(ref, cur);
  }
  return [...byRef.entries()]
    .map(([ref, v]) => ({ ref, bursts: v.bursts, visitors: v.visitors.size }))
    .sort((a, b) => b.bursts - a.bursts || a.ref.localeCompare(b.ref))
    .slice(0, limit);
}

/** Klick-heatmapens rollup. Positionsbärande klick (x/y-heltals-% ur snippeten)
 *  på sajtens mest klickade sida bucketas i 5 %-rutor per layoutklass (mobil/
 *  desktop via besökarens pageview-enhet); rage-punkter grupperas per element
 *  med medelposition. Sidvägen query-strippas — klick-events lagrade före
 *  sidvägs-normaliseringen (#126) bär ?fbclid och skulle annars fragmentera
 *  sidräkningen. Gamla events utan koordinater ignoreras — `sampled` säger
 *  ärligt hur mycket underlag varje vy har. Ren; aldrig throw. */
/** Hur många sidor heatmapen erbjuder i sidväljaren (mest klickade först).
 *  Ägarfynd 2026-07-19: en enda sajtvid toppsida "drog mot restauranger" —
 *  kartan behöver kunna visas per sida. */
export const MAX_HEAT_PAGES = 8;

/** Klick-heatmap för de mest positions-klickade sidorna (upp till maxPages),
 *  rankade efter klickvolym. Alltid minst en post (tom "/" utan underlag) så
 *  konsumenterna slipper null-vägar. */
export function clickHeatPages(
  events: DashEvent[],
  maxPages = MAX_HEAT_PAGES,
  maxSpots = 60,
  maxRage = 8,
): ClickHeat[] {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  // Besökare → layoutklass, ur pageview-events (klick-events bär ingen enhet).
  const deviceOf = new Map<string, "mobile" | "desktop">();
  for (const e of events) {
    if (e.type !== "pageview" || !e.visitorHash) continue;
    const d = str(e.payload.device);
    if (!d) continue;
    deviceOf.set(e.visitorHash, d === "mobile" ? "mobile" : "desktop");
  }
  type Pos = { x: number; y: number; path: string; dev: "mobile" | "desktop" | null };
  const clicks: Pos[] = [];
  const rageRaw: (Pos & { ref: string })[] = [];
  // Attention map-underlaget: sidvisningar (nämnaren) + scrolldjups-buckets
  // per sida+enhet. Samma enhetsattribution som klicken (besökarens pageview).
  const views = new Map<string, number>();
  const depths = new Map<string, { p25: number; p50: number; p75: number; p100: number }>();
  const key = (path: string, dev: "mobile" | "desktop") => `${dev}|${path}`;
  for (const e of events) {
    if (e.type === "pageview" || e.type === "scroll_depth") {
      const path = stripQueryHash(str(e.payload.path)) || (e.type === "pageview" ? "/" : "");
      const dev = (e.visitorHash && deviceOf.get(e.visitorHash)) || null;
      if (!path || !dev) continue;
      if (e.type === "pageview") {
        views.set(key(path, dev), (views.get(key(path, dev)) ?? 0) + 1);
      } else {
        const depth = e.payload.depth;
        if (depth === 25 || depth === 50 || depth === 75 || depth === 100) {
          const cur = depths.get(key(path, dev)) ?? { p25: 0, p50: 0, p75: 0, p100: 0 };
          cur[`p${depth}`]++;
          depths.set(key(path, dev), cur);
        }
      }
      continue;
    }
    if (e.type !== "element_click" && e.type !== "rage_click") continue;
    const x = num(e.payload.x);
    const y = num(e.payload.y);
    if (x === null || y === null) continue;
    // Samtyckes-klick ritas aldrig: bannern är fast-positionerad så punkten
    // kan inte mappas mot dokumentet — och det är bannerns UX, inte sidans.
    if (isConsentRef(str(e.payload.ref) ?? "")) continue;
    const path = stripQueryHash(str(e.payload.path)) || "/";
    const dev = (e.visitorHash && deviceOf.get(e.visitorHash)) || null;
    if (e.type === "element_click") clicks.push({ x, y, path, dev });
    else rageRaw.push({ x, y, path, dev, ref: str(e.payload.ref) || "?" });
  }
  // Sidorna rankas efter klickvolym — heatmapen visar EN sida i taget,
  // ärligt namngiven, och sidväljaren erbjuder toppen.
  const byPath = new Map<string, number>();
  for (const c of clicks) byPath.set(c.path, (byPath.get(c.path) ?? 0) + 1);
  const rankedPaths = [...byPath.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxPages)
    .map(([p]) => p);
  if (rankedPaths.length === 0) rankedPaths.push("/");

  const view = (path: string, dev: "mobile" | "desktop"): ClickHeatView => {
    const grid = new Map<string, { x: number; y: number; n: number }>();
    let sampled = 0;
    for (const c of clicks) {
      if (c.path !== path || c.dev !== dev) continue;
      sampled++;
      const bx = Math.min(19, Math.floor(c.x / 5));
      const by = Math.min(19, Math.floor(c.y / 5));
      const k = `${bx}:${by}`;
      const cur = grid.get(k) ?? { x: bx * 5 + 2, y: by * 5 + 2, n: 0 };
      cur.n++;
      grid.set(k, cur);
    }
    const byRef = new Map<string, { sx: number; sy: number; n: number }>();
    for (const r of rageRaw) {
      if (r.path !== path || r.dev !== dev) continue;
      const cur = byRef.get(r.ref) ?? { sx: 0, sy: 0, n: 0 };
      cur.sx += r.x;
      cur.sy += r.y;
      cur.n++;
      byRef.set(r.ref, cur);
    }
    const d = depths.get(key(path, dev)) ?? { p25: 0, p50: 0, p75: 0, p100: 0 };
    return {
      clicks: [...grid.values()].sort((a, b) => b.n - a.n).slice(0, maxSpots),
      rage: [...byRef.entries()]
        .map(([ref, v]) => ({ ref, x: Math.round(v.sx / v.n), y: Math.round(v.sy / v.n), n: v.n }))
        .sort((a, b) => b.n - a.n || a.ref.localeCompare(b.ref))
        .slice(0, maxRage),
      sampled,
      reach: { views: views.get(key(path, dev)) ?? 0, ...d },
    };
  };
  return rankedPaths.map((path) => ({
    path,
    mobile: view(path, "mobile"),
    desktop: view(path, "desktop"),
    unattributed:
      clicks.filter((c) => c.path === path && c.dev === null).length +
      rageRaw.filter((r) => r.path === path && r.dev === null).length,
  }));
}

/** Bakåtkompatibel yta: sajtens mest klickade sida (sidväljarens default). */
export function clickHeat(events: DashEvent[], maxSpots = 60, maxRage = 8): ClickHeat {
  return clickHeatPages(events, 1, maxSpots, maxRage)[0];
}

export function aggregate(
  events: DashEvent[],
  inventory: InventoryEntry[],
  opts: { tzOffsetMinutes?: number } = {},
): DashboardMetrics {
  const pageviewEvents = events.filter((e) => e.type === "pageview");
  const shownEvents = events.filter((e) => e.type === "adaptation_shown");
  // Alla sessioner rekonstrueras en gång och delas av sessions-kortet (senaste
  // 40) och segment-rollupen (alla) — undvik dubbel återuppbyggnad.
  const allSessions = sessionSummaries(events, Number.MAX_SAFE_INTEGER);

  const visitors = new Set<string>();
  for (const e of events) if (e.visitorHash) visitors.add(e.visitorHash);

  const pageviews = pageviewEvents.length;
  const conversions = events.filter((e) => e.type === "conversion").length;
  // Per-visitor conversion rate (D1): distinct converted / distinct
  // identified — the same denominator species as the lift table's arms, so a
  // double-fired convert() can no longer inflate the headline.
  const convertedVisitors = new Set<string>();
  for (const e of events) {
    if (e.type === "conversion" && e.visitorHash) convertedVisitors.add(e.visitorHash);
  }

  const overview: Overview = {
    pageviews,
    uniqueVisitors: visitors.size,
    adaptationsShown: shownEvents.length,
    ctaClicks: events.filter((e) => e.type === "cta_click").length,
    conversions,
    conversionRate: visitors.size > 0 ? convertedVisitors.size / visitors.size : 0,
  };

  const proof = proofSummary(events);

  const segments = {
    byTrafficSource: tally(pageviewEvents.map((e) => str(e.payload.trafficSource))),
    byDevice: tally(pageviewEvents.map((e) => str(e.payload.device))),
    byCountry: tally(pageviewEvents.map((e) => str(e.payload.country))),
    byBrowser: tally(pageviewEvents.map((e) => str(e.payload.browser))),
    byLanguage: tally(pageviewEvents.map((e) => str(e.payload.language))),
    byCampaign: tally(
      pageviewEvents.map((e) => str(e.payload.campaign)),
      "(ingen)",
    ),
  };

  const liveAdaptations: LiveAdaptation[] = [...shownEvents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_LIVE_ADAPTATIONS)
    .map((e) => ({
      decisionId: e.decisionId ?? "",
      patterns: patternsOf(e.payload),
      trafficSource: str(e.payload.trafficSource),
      device: str(e.payload.device),
      at: e.createdAt,
    }));

  const patternCounts = new Map<string, number>();
  for (const e of shownEvents) {
    for (const p of patternsOf(e.payload)) {
      patternCounts.set(p, (patternCounts.get(p) ?? 0) + 1);
    }
  }
  const performance: PatternStat[] = [...patternCounts.entries()]
    .map(([pattern, shown]) => ({ pattern, shown }))
    .sort((a, b) => b.shown - a.shown || a.pattern.localeCompare(b.pattern));

  const bySlot = new Map<string, InventoryEntry[]>();
  for (const item of inventory) {
    (bySlot.get(item.slot) ?? bySlot.set(item.slot, []).get(item.slot)!).push(item);
  }
  const inventoryGroups: InventoryGroup[] = [...bySlot.entries()]
    .map(([slot, items]) => ({ slot, items }))
    .sort((a, b) => a.slot.localeCompare(b.slot));

  const attribution = attribute(events);

  return {
    overview,
    proof,
    segments,
    timeseries: bucketByTime(events, opts.tzOffsetMinutes ?? 0),
    visitors: summarizeVisitors(events),
    liveAdaptations,
    performance,
    attribution,
    inventory: inventoryGroups,
    // Rekonstruera sessionerna EN gång: kortet visar de senaste 40, segment-
    // rollupen använder alla (annars vore grupperna trunkerade till 40 besök).
    sessions: allSessions.slice(0, MAX_SESSION_SUMMARIES),
    rageClicks: rageSignals(events),
    heatPages: clickHeatPages(events),
    searches: siteSearches(events),
    segmentGroups: segmentSummaries(allSessions),
  };
}

/** Samtyckes-knapptexter (pilotfynd 2026-07-19: Lovable-byggda banners saknar
 *  igenkännbara id:n — snippetens selektor-spärr kan inte se dem, men
 *  knapptexten är omisskännlig). EXAKTA fraser, aldrig delsträngar — "Kakor"
 *  är en receptkategori på pilotsajten. Spegelvänd lista i snippetens
 *  CONSENT_TEXT (framåt-spärren) — håll i synk. Detta är RETRO-filtret: det
 *  städar events som redan lagrats och events från gamla cachade snippets. */
const CONSENT_REF =
  /^(acceptera alla|godkänn alla|tillåt alla|endast nödvändiga|neka alla|avvisa alla|accept all( cookies)?|allow all( cookies)?|reject all( cookies)?|only necessary|necessary only|accept cookies|acceptera cookies|cookie settings|cookieinställningar|hantera cookies|manage cookies|jag förstår|got it)$/;

/** Är elementreferensen ett samtyckes-klick (cookiebannerns UX, inte sajtens)?
 *  Ren; används av stegbyggaren, klickordningen och heatmapen. */
export function isConsentRef(ref: string): boolean {
  const t = ref.replace(/\s+/g, " ").trim().toLowerCase();
  return t.length <= 40 && CONSENT_REF.test(t);
}

/** Sajtsökningar upprullade per term, mest sökta först. Enbart SKICKADE
 *  söktermer från dedikerade sökfält når hit (snippetens vakter + serverns
 *  cleanText-skrubb) — aldrig tangenttryckningar, aldrig andra formulärfält.
 *  Undantaget är dokumenterat på integritetssidan. Ren; aldrig throw. */
export function siteSearches(events: DashEvent[], cap = 15): SearchTerm[] {
  const byTerm = new Map<string, { count: number; lastSeen: string }>();
  for (const e of events) {
    if (e.type !== "site_search") continue;
    const raw = typeof e.payload.term === "string" ? e.payload.term : "";
    const term = raw.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
    if (!term) continue;
    const cur = byTerm.get(term) ?? { count: 0, lastSeen: e.createdAt };
    cur.count++;
    if (e.createdAt > cur.lastSeen) cur.lastSeen = e.createdAt;
    byTerm.set(term, cur);
  }
  return [...byTerm.entries()]
    .map(([term, v]) => ({ term, count: v.count, lastSeen: v.lastSeen }))
    .sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .slice(0, cap);
}
