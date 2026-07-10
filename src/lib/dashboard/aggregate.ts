// Angel Adaptive — dashboard aggregation (blueprint Step 8).
//
// Pure functions that turn raw angel_events rows + content inventory into the
// view model the customer dashboard renders (Overview, Visitor Segments, Live
// Adaptations, Performance, Content Inventory). No IO, no clock — so the whole
// thing is unit-tested against synthetic events. The server function in
// dashboard.functions.ts feeds it real rows from Supabase.

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
  /** Fas 2: besökargrupper (kanal×enhet×land×ny/återkommande), grov→fin, med
   *  utfall + datatillräcklighet. Insikt-substrat — ingen adaptation. */
  segmentGroups: SegmentSummary[];
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

function armValid(s: VariantStat): boolean {
  return (
    s.exposures >= MIN_ARM_EXPOSURES &&
    s.conversions >= MIN_ARM_OUTCOMES &&
    s.exposures - s.conversions >= MIN_ARM_OUTCOMES
  );
}

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
};

/** Two-proportion z score for (c1/n1) vs (c2/n2), or null if a group is empty
 *  or the pooled variance is degenerate. */
/** Standardnormalens CDF via Abramowitz–Stegun-erf — för pWin-avläsningen. */
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
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
    (perfLcp.get(e.visitorHash) ?? perfLcp.set(e.visitorHash, []).get(e.visitorHash)!).push({ t, lcp });
  }

  // Besökare -> {arm, första exponering}.
  const assignment = new Map<string, { arm: "adapted" | "control"; t: number }>();
  for (const e of events) {
    const arm =
      e.type === "adaptation_shown" ? "adapted" : e.type === "adaptation_withheld" ? "control" : null;
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
  const firstInWindow = (rows: { t: number; lcp: number }[] | undefined, from: number, until: number) => {
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
  /** Distinkta sidvägar i besöksordning (sidordningen). */
  pageOrder: string[];
  /** Element-referenser i klickordning (intent-signalen). */
  clickOrder: string[];
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

export const MAX_SESSION_SUMMARIES = 40;
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
    (shownByVisitor.get(e.visitorHash) ?? shownByVisitor.set(e.visitorHash, []).get(e.visitorHash)!).push(t);
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

    const pageOrder: string[] = [];
    const clickOrder: string[] = [];
    let engagedMs = 0;
    let formStarted = false;
    let formSubmitted = false;
    let formAbandoned = false;
    let converted = false;
    for (const e of evs) {
      const path = typeof e.payload.path === "string" ? e.payload.path : null;
      if (e.type === "pageview" && path) {
        // Distinkt sidordning: lägg bara till när sidan byts (undvik
        // hydrerings-dubbletter av samma path i rad).
        if (pageOrder[pageOrder.length - 1] !== path) pageOrder.push(path);
      } else if (e.type === "element_click") {
        const ref = typeof e.payload.ref === "string" ? e.payload.ref : "";
        if (ref) clickOrder.push(ref);
      } else if (e.type === "page_leave") {
        const ms = e.payload.engagedMs;
        if (typeof ms === "number" && isFinite(ms) && ms > 0) engagedMs += ms;
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
      landingPath: pageOrder[0] ?? null,
      pageOrder: pageOrder.slice(0, JOURNEY_STEP_CAP),
      clickOrder: clickOrder.slice(0, JOURNEY_STEP_CAP),
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

/** En dimensions token för segmentnyckeln — null/tom blir "okänd" (ärlig egen
 *  hink, aldrig påhittad). */
const segToken = (v: string | null | undefined): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || "okänd";
};

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
export function expandSegmentLeaves(
  leaves: SegmentLeaf[],
  limit = MAX_SEGMENTS,
): SegmentSummary[] {
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
      leaf.returning ? "återkommande" : "ny",
    ];
    for (let d = 1; d <= dims.length; d++) {
      const prefix = dims.slice(0, d);
      const key = prefix.join("·");
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
      returning: depth >= 4 ? a.dims[3] === "återkommande" : null,
      visits: a.visits,
      conversions: a.conversions,
      conversionRate: a.visits > 0 ? a.conversions / a.visits : 0,
      formStarts: a.formStarts,
      formAbandons: a.formAbandons,
      adequate: a.visits >= SEGMENT_MIN_VISITS && a.conversions >= SEGMENT_MIN_CONVERSIONS,
    });
  }
  // Grovast först (kortet läses top-down: kanal → kanal·enhet → …), sedan störst
  // volym, sedan nyckel för deterministisk ordning.
  out.sort((x, y) => x.depth - y.depth || y.visits - x.visits || x.key.localeCompare(y.key));
  return out.slice(0, limit);
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

function twoProportionZ(c1: number, n1: number, c2: number, n2: number): number | null {
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
      e.type === "adaptation_shown" ? "adapted" : e.type === "adaptation_withheld" ? "control" : null;
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
      ? twoProportionZ(adapted.conversions, adapted.exposures, control.conversions, control.exposures)
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
      significant:
        z !== null && Math.abs(z) >= 1.96 && armValid(adapted) && armValid(control),
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
      (a, b) => b.adapted.exposures - a.adapted.exposures || (a.segment ?? "").localeCompare(b.segment ?? ""),
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
  const hours: { visits: number; identified: Set<string> }[] = Array.from(
    { length: 24 },
    () => ({ visits: 0, identified: new Set<string>() }),
  );

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
    segmentGroups: segmentSummaries(allSessions),
  };
}
