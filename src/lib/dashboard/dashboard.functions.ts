// Angel Adaptive — dashboard data (server function).
//
// getDashboard reads angel_sites / angel_events / angel_content_inventory via
// the service-role admin client (RLS is locked down, so reads are server-side),
// then runs the pure aggregator. It is resilient: if the service-role key or the
// tables are unavailable, it returns an empty, dbAvailable:false envelope so the
// UI renders a clean empty state instead of erroring.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  defaultSuccessSpec,
  estimateVerdictTime,
  evaluateRuleWithSpec,
  validateSuccessSpec,
  type SuccessSpec,
} from "@/adaptive-lab/metrics";
import { metricArmsFromRpc, type ArmsRpcRow } from "@/adaptive/redesign/guardrail-sweep";
import type { Json } from "@/integrations/supabase/types";
import { GOAL_KINDS, type GoalCandidate } from "@/adaptive/crawler-inventory";
import {
  evaluateWinnerWithGuards,
  promotionBlockReason,
  type GuardArmCounts,
  type TestMetric,
} from "@/adaptive/redesign/winner";

/** DB-kolumnen är fri text bakom ett check-villkor; läs den tolerant och
 *  fall tillbaka på målet självt hellre än att lita på en okänd sträng. */
const asTestMetric = (v: unknown): TestMetric =>
  v === "continuation" || v === "bounce" ? v : "conversion";
import { loadTopReferrerDomains } from "@/adaptive/persistence.server";
import { buildJourney, type JourneyMilestone } from "./journey";
import { cleanEvents } from "./data-hygiene";
import { reusedKindOf } from "./reuse-provenance";
import {
  aggregate,
  applySkipsByVariant,
  expandSegmentLeaves,
  attachRecent,
  bestPageForSegment,
  RECENT_WINDOW_DAYS,
  SEGMENT_MIN_VISITS,
  SEGMENT_MIN_VISITS_ENGAGEMENT,
  type ApplySkipSummary,
  type DashboardMetrics,
  type DashEvent,
  type InventoryEntry,
  type PageSegmentVisits,
} from "./aggregate";

// ---- tenancy helpers (server-only) ------------------------------------------

/** Emails allowed to see/administer every site (comma-separated env). */
export function isAdminEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const set = new Set(
    (process.env.ANGEL_ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.has(email.toLowerCase());
}

export type AuthCtx = { userId: string; claims: { email?: string } };

/** True if the caller may see/configure `slug`: an admin, or a member of it. */
/** Minimal admin-klient-form retireWinner behöver — bara rpc-sömmen.
 *  PromiseLike (inte Promise): supabase-js rpc() returnerar en thenable
 *  PostgrestFilterBuilder, inte en naken Promise. */
type RpcAdmin = {
  rpc: (
    name: "angel_retire_winner",
    args: { p_site: string; p_variant: string },
  ) => PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
};

/**
 * winner→retired ATOMISKT via angel_retire_winner (granskningsfynd 2026-08-13):
 * RPC:n gör statusövergången OCH `evidence || {"wasWinner":true}` i EN sats, så
 * en samtidig nattloop-skrivning av evidence.comparison/screenshots aldrig
 * klobbras av en läs-modifiera-skriv av hela blobben. Egen exporterad hjälpare
 * så kontraktet (RPC, aldrig en evidence-blob-update; false ⇒ no-op; fel ⇒
 * write failed) kan pinnas i test utan server-fn-maskineriet.
 */
export async function retireWinner(
  admin: RpcAdmin,
  site: string,
  variantId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const { data: ok, error: rpcErr } = await admin.rpc("angel_retire_winner", {
    p_site: site,
    p_variant: variantId,
  });
  if (rpcErr) {
    console.warn(`[angel] angel_retire_winner failed: ${rpcErr.message}`);
    return { ok: false, reason: "write failed" };
  }
  // false = raden var inte längre 'winner' (samtidig/redan utförd övergång) —
  // samma no-op-semantik som det gamla optimistiska .eq(status)-låset.
  if (!ok) return { ok: false, reason: "illegal transition winner → retired" };
  return { ok: true };
}

export async function ownsSite(
  admin: { from: (t: string) => any },
  ctx: AuthCtx,
  slug: string,
): Promise<boolean> {
  if (isAdminEmail(ctx.claims?.email)) return true;
  const { data } = await admin
    .from("angel_site_members")
    .select("id")
    .eq("user_id", ctx.userId)
    .eq("site_slug", slug)
    .maybeSingle();
  return !!data;
}

const genKey = () => "ak_" + globalThis.crypto.randomUUID().replace(/-/g, "");

export interface SiteRef {
  slug: string;
  name: string | null;
  domain: string | null;
}

export type ConsentMode = "anonymous" | "attested";

/** The selected site's owner-set config (attestation + measurement), as shown
 *  and edited in the dashboard. Served to the snippet via
 *  /api/adaptive/consent-config. */
export interface SiteConfigView {
  consentMode: ConsentMode;
  holdoutPct: number;
  conversionUrl: string | null;
  conversionSelector: string | null;
  /** The goal's visible label (auto-harvested), e.g. "Skapa konto". */
  conversionText: string | null;
  /** Who set the goal: 'auto' (legacy pre-confirm pick) | 'owner' (confirmed) | null. */
  conversionSource: "auto" | "owner" | null;
  /** WHAT converting means (GoalKind), persisted at confirm; null on raw
   *  owner overrides and legacy rows. */
  conversionKind: string | null;
  /** Per-site write key gating the ingest endpoints. null = unkeyed. */
  ingestKey: string | null;
  /** Observe-first (croengine-vision.md): false (default) → Angel observerar
   *  bara, inga synliga adaptationer körs. Bevis-vyn visar då "Observera-läge"
   *  i st f en tom arm-tabell. */
  adaptationsEnabled: boolean;
  /** Fas 4 master-switch (fas4-per-segment-serving.md): false (default) → inga
   *  per-segment-varianter serveras, oavsett variantstatus. Manuell dashboard-
   *  toggle (ägarbeslut 2026-07-12). */
  servingEnabled: boolean;
  /** Fas 4 steg 3: variant-armens trafikandel (%). Manuell ramp 5 → 10 → 25 →
   *  50 (ägarbeslut 2026-07-12) — aldrig 50/50 från start. */
  rampPct: number;
  /** Testets mätmål (ägarbeslut 2026-07-20): 'conversion' (default) eller
   *  'continuation' — gick besökaren vidare till en andra sida? Nordstjärne-
   *  målet (conversionText) ändras inte; bara måttstocken för A/B-testet. */
  testMetric: TestMetric;
  /** Sajtens registrerade domän (normaliserad). null = legacy/labb. */
  domain: string | null;
  /** Stämplad av första domän-bevisade snippet-signalen — installations- och
   *  ägarskaps-kvittot i ett. Serving kräver stämpeln när domän finns. */
  domainVerifiedAt: string | null;
  /** Betalstatus (Stripe-webhooken synkar): exempt/none/trialing/active/
   *  past_due/canceled. Serving kräver exempt|trialing|active. */
  billingStatus: string;
  /** The judged business type, when detected (e.g. "comparison"). */
  businessType: string | null;
  /** Ranked conversion-goal candidates proposed at harvest — the owner confirms
   *  one to activate Angel. Empty until the first harvest judges the page. */
  goalCandidates: GoalCandidate[];
  /** Day-0-granskningen (task #98): länk till sajtens automatiska
   *  onboarding-rapport i angel-evidence. null tills runnern producerat den
   *  (eller om den föll). Dashboardkortet visas tills första varianten finns. */
  day0ReportUrl: string | null;
}

/** En redesign-variant i dashboardens livscykelvy (Fas 4), inklusive jämförelse-
 *  underlaget ur evidence så ägaren kan SE vad varianten gör (FÖRE/EFTER +
 *  grindar + skärmdumpar) innan hen fattar serveringsbeslutet. Skärmdumpar
 *  refereras som URL/sökväg (same-origin eller Storage) — aldrig inline-bytes. */
export interface VariantOpView {
  op: string;
  targetId: string;
  detail: string;
  why: string;
}

export interface VariantComparison {
  headline: string | null;
  orderBefore: string[];
  orderAfter: string[];
  movedLabel: string | null;
  screenshots: {
    before: string | null;
    after: string | null;
    attempt1: string | null;
    /** Desktop-paret finns när viewport-grindningen (Tier-1 #3) körde ett
     *  desktop-bekräftelsepass — grova segment servar alla enheter, och
     *  ägaren ska kunna se BÅDA lägena innan hen startar A/B:t. */
    desktopBefore?: string | null;
    desktopAfter?: string | null;
  };
}

/** A/B-läget för en SERVERANDE variant: armarnas räknare (hela historiken, via
 *  angel_variant_arms-RPC:n) + vinnar-utvärderarens rekommendation enligt
 *  ägarens grindar (≥1000 besök + ≥50 konv per arm, ≥95 %, ≥5 % lyft, inga
 *  försämrade skyddsmått). Systemet REKOMMENDERAR bara — byter aldrig själv. */
export interface VariantAbView {
  /** Vad `conversions`-fälten räknar: konverteringar eller "gick vidare till
   *  en andra sida" (test_metric='continuation', ägarbeslut 2026-07-20). */
  metric: TestMetric;
  variant: { visits: number; conversions: number };
  control: { visits: number; conversions: number };
  outcome: "insufficient_data" | "no_winner" | "recommend_winner" | "recommend_stop";
  reasons: string[];
  stats: {
    variantRate: number;
    controlRate: number;
    relativeLift: number | null;
  };
  /** Ärlig tidshorisont när datat inte räcker (gap-audit Tier-1: prognosen
   *  fanns i labbet men visades aldrig): hur många besökare per arm behövs för
   *  ett domslut vid deklarerad MDE, och ungefär hur många dagar det tar vid
   *  sajtens NUVARANDE trafik (null när trafiktakten är okänd). */
  prognosis?: {
    neededPerArm: number;
    estDaysAtSiteTraffic: number | null;
  };
  /** Hela mätartabellen per arm (ägarbeslut 2026-07-27: alla siffror synliga,
   *  men bara bakom ett klick på variantraden — grundvyn ska vara brusfri).
   *  Samma RPC-rader som vakterna dömer på; REN LÄSNING — domslutet fattas av
   *  huvudmåttet + skyddsvetona, aldrig av den här tabellen. Bounce härleds i
   *  klienten (visits − continuations). */
  allMetrics?: { variant: ArmAllCounts; control: ArmAllCounts };
}

/** En arms samtliga räknare ur angel_variant_arms — distinkta besökare. */
export interface ArmAllCounts {
  visits: number;
  conversions: number;
  continuations: number;
  ctaClicks: number;
  formSubmits: number;
  engaged: number;
  deepScrolls: number;
}

export interface VariantRuling {
  verdict: "win" | "loss" | "no_effect" | "inconclusive" | "guardrail_breach";
  action: "extend" | "pause" | "retire_or_redesign" | "keep_measuring";
  breachedMetrics: string[];
}

export interface VariantView {
  id: string;
  path: string;
  segmentKey: string;
  status: "candidate" | "verified" | "serving" | "winner" | "retired";
  /** Framgångskontraktet (labbets SuccessSpec) — null för äldre varianter;
   *  sätts med sajttypens standard när ägaren startar A/B:t. */
  success?: SuccessSpec | null;
  opsCount: number;
  updatedAt: string;
  /** Maskinellt serveringsstopp (drift-svepet, slice 3) — null = serverbar
   *  enligt status. Ägarens status är orörd; självläkningen släpper flaggan. */
  heldReason: string | null;
  ops: VariantOpView[];
  /** Grind-utfall ur evidence.gates (nyckel → tal/boolean), tomt när okänt. */
  gates: Record<string, number | boolean>;
  /** Planens HÄRKOMST ur evidence.planSource (steg 11): "katalog/selector" |
   *  "katalog/floor" | "designer". null för varianter födda före provenansen.
   *  Ägaren ska kunna se VAR ett förslag kom ifrån — utan den här raden var
   *  fältet skrivet men oläst (granskningsfynd 2026-08-08). */
  planSource: string | null;
  /** Blockbiblioteket steg 2 (evidence.reuse): sidan vars A/B-vinst blocket
   *  bär med sig — ägaren ska SE att förslaget är ett återbrukat bevisat
   *  block, inte en ny idé. null för allt som inte är återbruk. */
  reusedFrom: string | null;
  /** VAD som bevisades (transferformen steg 4): "text" = den ordagranna
   *  raden vann sitt A/B, "move" = att lyfta EN SEKTION AV DEN TYPEN vann.
   *  Skillnaden är hela sanningen i ägarens etikett — en flytt-överföring
   *  får aldrig påstå att texten är bevisad. null när varianten inte är
   *  återbruk. Rader födda före steg 4 saknar kind ⇒ "text" (de var det). */
  reusedKind: "text" | "move" | null;
  comparison: VariantComparison | null;
  /** Utspädningsdiagnostiken (flimmervakten 2026-08-10): laddningar i det
   *  lästa händelsefönstret där exponeringen loggades som visad variant men
   *  besökaren fick originalet — per orsak. null = inga skip i fönstret.
   *  Utspädning drar mätningen mot noll: den underskattar en bra variants
   *  lyft och kan MASKERA en skadlig variants skada — ägaren ska SE den,
   *  inte ana den. */
  applySkips: ApplySkipSummary | null;
  /** Bara för serving/winner-varianter; null tills exponeringar finns. */
  abTest: VariantAbView | null;
  /** Kontraktsdomslutet (evaluateRuleWithSpec) på LIVE-armarna: guardrail-
   *  brott ⇒ pausrekommendation på kortet. null tills kontrakt + data finns. */
  ruling: VariantRuling | null;
}

/** Zero-config default hold-out, applied on attestation so measurement is ready
 *  with no stats knowledge needed. Note (observe-first): the hold-out only
 *  measures once the site enables adaptations — until then no adapted arm runs,
 *  so the bucket withholds nothing. */
export const DEFAULT_HOLDOUT_PCT = 12;

const DEFAULT_SITE_CONFIG: SiteConfigView = {
  consentMode: "anonymous",
  holdoutPct: 0,
  conversionUrl: null,
  conversionSelector: null,
  conversionText: null,
  conversionSource: null,
  conversionKind: null,
  domain: null,
  domainVerifiedAt: null,
  billingStatus: "exempt",
  businessType: null,
  goalCandidates: [],
  ingestKey: null,
  adaptationsEnabled: false,
  servingEnabled: false,
  rampPct: 5,
  testMetric: "conversion",
  day0ReportUrl: null,
};

export interface DashboardResponse {
  site: string;
  sites: SiteRef[];
  dbAvailable: boolean;
  generatedAt: string;
  metrics: DashboardMetrics;
  /** Defaults to the anonymous, measurement-off config when unavailable. */
  siteConfig: SiteConfigView;
  /** Fas 4: sajtens redesign-varianter (alla statusar), nyast först. */
  variants: VariantView[];
  /** Resan till bevisat — stanna-tills-bevisat-berättelsen (journey.ts):
   *  varje milstolpe härledd ur datat ovan, varje detaljrad en mätning. */
  journey: JourneyMilestone[];
  /** Topp-domänerna bakom "other websites" (samla nu, visa senare 2026-07-26).
   *  Tom tills volymtröskeln nås — panelblocket är vilande till dess. */
  otherDomains?: { domain: string; visits: number }[];
  /** Admin extras (the sandbox link) render only for ANGEL_ADMIN_EMAILS. */
  isAdmin: boolean;
}

// Seeded baseline — shown in the site picker when the DB can't be reached
// (e.g. local dev without a service-role key).
const FALLBACK_SITES: SiteRef[] = [{ slug: "hubspot", name: "HubSpot", domain: "hubspot.com" }];

const EVENT_LIMIT = 5000;

export const getDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1).default(FALLBACK_SITES[0].slug),
      /** Browser tz offset (Date#getTimezoneOffset) so time buckets read as the
       *  owner's local wall-clock, not UTC. */
      tzOffsetMinutes: z.number().int().min(-840).max(840).optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<DashboardResponse> => {
    const { site, tzOffsetMinutes } = data;
    const ctx = context as unknown as AuthCtx;
    const generatedAt = new Date().toISOString();

    // Imported inside the handler so the service-role client never reaches the
    // client bundle.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    try {
      const admin = isAdminEmail(ctx.claims?.email);

      const { data: siteRows } = await supabaseAdmin
        .from("angel_sites")
        .select(
          "slug,name,domain,domain_verified_at,billing_status,consent_mode,holdout_pct,conversion_url,conversion_selector,conversion_text,conversion_source,conversion_kind,ingest_key,adaptations_enabled,serving_enabled,ramp_pct,goal_candidates,day0_report_url,test_metric",
        )
        .order("slug");
      // `sandbox--<host>` rows are the admin sandbox's private per-host scratch
      // sites (inventory the preview needs). They carry no measurement and must
      // never appear in the dashboard's site picker as if they were customers.
      const rows = (siteRows ?? []).filter(
        (r: { slug: string }) => !r.slug.startsWith("sandbox--"),
      );

      // Ownership filter: admins see every site; everyone else only their own.
      let owned: Set<string> | null = null;
      if (!admin) {
        const { data: mem } = await supabaseAdmin
          .from("angel_site_members")
          .select("site_slug")
          .eq("user_id", ctx.userId);
        owned = new Set((mem ?? []).map((r: { site_slug: string }) => r.site_slug));
      }
      const visibleRows = admin ? rows : rows.filter((r: { slug: string }) => owned!.has(r.slug));
      const sites = visibleRows as SiteRef[];
      const canView = admin || owned!.has(site);

      // Only read a site's events/inventory if the caller may view it.
      let events: DashEvent[] = [];
      let inventory: InventoryEntry[] = [];
      let siteConfig: SiteConfigView = DEFAULT_SITE_CONFIG;
      if (canView) {
        // A failed read must surface as dbAvailable:false, NOT as an empty
        // site — "no data" gates onboarding UI (the install card), so it can't
        // be allowed to masquerade as "no traffic yet".
        const { data: eventRows, error: evError } = await supabaseAdmin
          .from("angel_events")
          .select("type,payload,visitor_hash,decision_id,created_at")
          .eq("site", site)
          .order("created_at", { ascending: false })
          .limit(EVENT_LIMIT);
        if (evError) throw evError;
        const { data: invRows, error: invError } = await supabaseAdmin
          .from("angel_content_inventory")
          .select("slot,item_id,text,selector,meta")
          .eq("site_slug", site);
        if (invError) throw invError;

        // Datahygien (revisionen 2026-07-20): känd förorening (lasttest-
        // burstar, ägartrafik, simulatorkörningar, /admin) filtreras vid
        // läsning — EN gång här så alla konsumenter räknar på samma rena data.
        events = cleanEvents(
          site,
          (eventRows ?? []).map((r) => ({
            type: r.type,
            payload: (r.payload as Record<string, unknown>) ?? {},
            visitorHash: r.visitor_hash,
            decisionId: r.decision_id,
            createdAt: r.created_at,
          })),
        );
        inventory = (invRows ?? []).map((r) => ({
          slot: r.slot,
          id: r.item_id,
          text: r.text,
          selector: r.selector,
          meta: (r.meta as Record<string, string> | null) ?? {},
        }));

        const current = rows.find((r: { slug: string }) => r.slug === site) as
          | {
              consent_mode?: string;
              holdout_pct?: number;
              conversion_url?: string | null;
              conversion_selector?: string | null;
              conversion_text?: string | null;
              conversion_source?: string | null;
              conversion_kind?: string | null;
              domain?: string | null;
              domain_verified_at?: string | null;
              billing_status?: string;
              ingest_key?: string | null;
              adaptations_enabled?: boolean;
              serving_enabled?: boolean;
              ramp_pct?: number;
              test_metric?: string | null;
              goal_candidates?: { businessType?: string; goals?: GoalCandidate[] } | null;
              day0_report_url?: string | null;
            }
          | undefined;
        if (current) {
          const judged = current.goal_candidates ?? null;
          siteConfig = {
            consentMode: current.consent_mode === "attested" ? "attested" : "anonymous",
            holdoutPct: typeof current.holdout_pct === "number" ? current.holdout_pct : 0,
            conversionUrl: current.conversion_url ?? null,
            conversionSelector: current.conversion_selector ?? null,
            conversionText: current.conversion_text ?? null,
            conversionSource:
              current.conversion_source === "auto" || current.conversion_source === "owner"
                ? current.conversion_source
                : null,
            conversionKind: current.conversion_kind ?? null,
            ingestKey: current.ingest_key ?? null,
            adaptationsEnabled: current.adaptations_enabled === true,
            servingEnabled: current.serving_enabled === true,
            rampPct: typeof current.ramp_pct === "number" ? current.ramp_pct : 5,
            testMetric: asTestMetric(current.test_metric),
            domain: current.domain ?? null,
            domainVerifiedAt: current.domain_verified_at ?? null,
            billingStatus:
              typeof current.billing_status === "string" ? current.billing_status : "exempt",
            businessType: typeof judged?.businessType === "string" ? judged.businessType : null,
            goalCandidates: Array.isArray(judged?.goals) ? judged.goals.slice(0, 6) : [],
            day0ReportUrl: current.day0_report_url ?? null,
          };
        }
      }

      // Fas 4: sajtens redesign-varianter (alla statusar) för livscykelvyn,
      // inkl. jämförelse-underlaget ur evidence (ordning, grindar, skärmdumps-
      // referenser). Best-effort — tom tills genereringskedjan skriver hit.
      let variants: VariantView[] = [];
      try {
        // TENANT-VAKTEN (granskningsfynd 2026-08-10): service-role-klienten
        // kringgår RLS, så ägarskapsfiltret MÅSTE stå här — utan spärren
        // kunde varje inloggad användare läsa en annan kunds varianter
        // (ops-texter, segment, armräknare) genom att posta dess site-slug.
        // Samma dom som events/inventory ovan: får du inte se sajten är
        // listan tom, aldrig en delvis.
        const { data: vRows, error: vErr } = canView
          ? await supabaseAdmin
              .from("angel_variants")
              .select("id,path,segment_key,status,ops,evidence,held_reason,updated_at,success")
              .eq("site", site)
              .order("updated_at", { ascending: false })
              .limit(50)
          : { data: [], error: null };
        if (!vErr && Array.isArray(vRows)) {
          const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
          const strs = (v: unknown): string[] =>
            Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
          // A/B-armar + rekommendation för de varianter som faktiskt serverar.
          // En RPC per serverande variant (högst 1 per site·path·segment enligt
          // det partiella unika indexet, så listan är kort). Best-effort.
          const abById = new Map<string, VariantAbView>();
          const rulingById = new Map<string, VariantRuling>();
          const servingRows = vRows.filter((v) => v.status === "serving" || v.status === "winner");
          // Trafiktakt för prognosen — ur de redan lästa, redan städade
          // eventen (cleanEvents ovan): distinkta besökare med pageview
          // senaste 7 dygnen ⇒ dagstakt. Ingen extra DB-fråga. null när
          // fönstret är tomt ⇒ prognosen visar "N per arm" utan dagsestimat.
          let dailyVisitors: number | null = null;
          {
            const since = Date.now() - 7 * 24 * 3600 * 1000;
            const seen = new Set<string>();
            for (const e of events) {
              if (e.type !== "pageview" || !e.visitorHash) continue;
              if (Date.parse(e.createdAt) < since) continue;
              seen.add(e.visitorHash);
            }
            dailyVisitors = seen.size > 0 ? seen.size / 7 : null;
          }
          await Promise.all(
            servingRows.map(async (v) => {
              try {
                const { data: arms, error: aErr } = await supabaseAdmin.rpc("angel_variant_arms", {
                  p_site: site,
                  p_variant: v.id,
                });
                if (aErr || !Array.isArray(arms)) return;
                // Mätmålet styr vilken kolumn som är "framgång": continuation-
                // läget räknar besökare som gick vidare till en andra sida.
                const metric = siteConfig.testMetric;
                const fullArm = (name: string): GuardArmCounts => {
                  const row = (arms as ArmsRpcRow[]).find((a) => a.arm === name);
                  return {
                    visits: Number(row?.visits) || 0,
                    conversions: Number(row?.conversions) || 0,
                    continuations: Number(row?.continuations) || 0,
                    engaged: Number(row?.engaged) || 0,
                    bounces: Number(row?.bounces) || 0,
                  };
                };
                const variantFull = fullArm("variant");
                const controlFull = fullArm("control");
                if (variantFull.visits + controlFull.visits === 0) return;
                // Klick-att-fälla-ut-tabellen: samma rader, ALLA räknare.
                const allOf = (name: string): ArmAllCounts => {
                  const row = (arms as ArmsRpcRow[]).find((a) => a.arm === name);
                  return {
                    visits: Number(row?.visits) || 0,
                    conversions: Number(row?.conversions) || 0,
                    continuations: Number(row?.continuations) || 0,
                    ctaClicks: Number(row?.cta_clicks) || 0,
                    formSubmits: Number(row?.form_submits) || 0,
                    engaged: Number(row?.engaged) || 0,
                    deepScrolls: Number(row?.deep_scrolls) || 0,
                  };
                };
                const primaryOf = (a: GuardArmCounts) => ({
                  visits: a.visits,
                  conversions:
                    metric === "continuation"
                      ? a.continuations
                      : metric === "bounce"
                        ? (a.bounces ?? 0)
                        : a.conversions,
                });
                const variantArm = primaryOf(variantFull);
                const controlArm = primaryOf(controlFull);
                // Falsk-vinnar-vakten (gap-audit Tier-1): rekommendationen döms
                // ALDRIG utan sekundärvakterna — bounce/engagemang ur samma
                // armar, och under continuation-proxyt även själva MÅLET.
                const ev = evaluateWinnerWithGuards(variantFull, controlFull, metric);
                // Ärlig tidshorisont när datat inte räcker: hur långt bort är
                // ett domslut vid sajtens verkliga trafik? (Tier-1-fyndet:
                // estimateVerdictTime fanns men visades aldrig.)
                let prognosis: VariantAbView["prognosis"];
                if (ev.outcome === "insufficient_data") {
                  const spec0 = validateSuccessSpec(v.success);
                  const baseRate =
                    ev.stats.controlRate > 0
                      ? ev.stats.controlRate
                      : metric === "continuation"
                        ? 0.3
                        : metric === "bounce"
                          ? 0.57
                          : 0.04;
                  const est = estimateVerdictTime({
                    dailyMatchedVisitors: Math.max(1, dailyVisitors ?? 0),
                    baseRate,
                    mdeRel: spec0?.mdeRel,
                    ramp: siteConfig.rampPct,
                  });
                  prognosis = {
                    neededPerArm: est.nPerArm,
                    estDaysAtSiteTraffic: dailyVisitors !== null ? est.days : null,
                  };
                }
                abById.set(v.id, {
                  metric,
                  variant: variantArm,
                  control: controlArm,
                  outcome: ev.outcome,
                  reasons: ev.reasons,
                  stats: {
                    variantRate: ev.stats.variantRate,
                    controlRate: ev.stats.controlRate,
                    relativeLift: ev.stats.relativeLift,
                  },
                  ...(prognosis ? { prognosis } : {}),
                  allMetrics: { variant: allOf("variant"), control: allOf("control") },
                });
                // Kontraktsdomslut på live-armarna: variantens success-spec
                // (eller sajttypens standard om A/B:t startats utan) dömer
                // primären och prövar guardrails med kalibrerade matten.
                const spec = validateSuccessSpec(v.success) ?? defaultSuccessSpec();
                // Delad arm-mappning (EN sanning med nattloopens guardrail-svep).
                const armsByMetric = metricArmsFromRpc(arms);
                if (armsByMetric) {
                  const contractRuling = evaluateRuleWithSpec(spec, armsByMetric);
                  rulingById.set(v.id, {
                    verdict: contractRuling.verdict,
                    action: contractRuling.action,
                    breachedMetrics: contractRuling.guardrails
                      .filter((g) => g.breached)
                      .map((g) => g.metric),
                  });
                }
              } catch {
                /* arm read is best-effort */
              }
            }),
          );
          // Skip-diagnostiken ur de redan lästa, redan städade eventen —
          // ingen extra DB-fråga (samma mönster som trafiktakten ovan).
          const skipsById = applySkipsByVariant(events);
          variants = vRows.map((v) => {
            const ev = (v.evidence ?? {}) as Record<string, unknown>;
            const cmpRaw = ev.comparison as Record<string, unknown> | undefined;
            const shots = (cmpRaw?.screenshots ?? {}) as Record<string, unknown>;
            const gatesRaw = (ev.gates ?? {}) as Record<string, unknown>;
            const gates: Record<string, number | boolean> = {};
            for (const [k, val] of Object.entries(gatesRaw)) {
              if (typeof val === "number" || typeof val === "boolean") gates[k] = val;
            }
            const opsArr = Array.isArray(v.ops) ? v.ops : [];
            return {
              id: v.id,
              path: v.path,
              segmentKey: v.segment_key,
              status: v.status as VariantView["status"],
              opsCount: opsArr.length,
              updatedAt: v.updated_at,
              heldReason: typeof v.held_reason === "string" ? v.held_reason : null,
              // Tolerant läsning: ogiltigt/frånvarande kontrakt → null → UI:t
              // visar standardkontraktet i stället för att gissa.
              success: validateSuccessSpec(v.success),
              ops: opsArr.map((o) => {
                const r = (o ?? {}) as Record<string, unknown>;
                return {
                  op: str(r.op) ?? "",
                  targetId: str(r.targetId) ?? "",
                  detail: str(r.detail) ?? "",
                  why: str(r.why) ?? "",
                };
              }),
              gates,
              planSource: str(ev.planSource),
              reusedFrom: str((ev.reuse as Record<string, unknown> | undefined)?.provedOnPath),
              reusedKind: reusedKindOf(ev.reuse),
              comparison: cmpRaw
                ? {
                    headline: str(cmpRaw.headline),
                    orderBefore: strs(cmpRaw.orderBefore),
                    orderAfter: strs(cmpRaw.orderAfter),
                    movedLabel: str(cmpRaw.movedLabel),
                    screenshots: {
                      before: str(shots.before),
                      after: str(shots.after),
                      attempt1: str(shots.attempt1),
                      desktopBefore: str(shots.desktopBefore),
                      desktopAfter: str(shots.desktopAfter),
                    },
                  }
                : null,
              applySkips: skipsById.get(v.id) ?? null,
              abTest: abById.get(v.id) ?? null,
              ruling: rulingById.get(v.id) ?? null,
            };
          });
        }
      } catch (vErr) {
        console.warn(`[angel] variant list unavailable:`, vErr);
      }

      const metrics = aggregate(events, inventory, { tzOffsetMinutes });
      // Fas 2: segment över HELA historiken via angel_segment_rollup, inte
      // dashboardens EVENT_LIMIT-fönster — annars mäter volymgrinden (1000/100)
      // mot ett glidande färskt fönster och ljuger vid riktig trafik. Två anrop:
      // livstid + senaste RECENT_WINDOW_DAYS (för "över tid"-kolumnen). Bäst-
      // effort: faller tillbaka på den fönster-baserade rollupen om RPC:n dör.
      //
      // BAKOM canView (UI-buggjaktens fynd 2026-08-14, tvärtenant-läcka):
      // events/inventory/varianter grindades vid läsning ovan, men rollup-
      // RPC:erna här låg 200 rader senare och kördes för VILKEN site-slug som
      // helst — varje inloggad användare kunde läsa en annan kunds segment-
      // metrik (besök, konverteringar, per-sida-rollup). Samma dom som ovan:
      // får du inte se sajten är segmenten den tomma aggregeringens.
      if (canView)
        try {
          const [allRes, recentRes, pageRes] = await Promise.all([
            supabaseAdmin.rpc("angel_segment_rollup", { p_site: site }),
            supabaseAdmin.rpc("angel_segment_rollup", {
              p_site: site,
              p_since: new Date(Date.now() - RECENT_WINDOW_DAYS * 86_400_000).toISOString(),
            }),
            // Per-SIDA-rollupen (samma RPC nattloopen matar findEarnedCells med):
            // designer genereras per sida, så segmentkortets ärliga progress är
            // "bästa sida × grinden", inte sajtsumman ovan.
            supabaseAdmin.rpc("angel_page_segment_rollup", { p_site: site }),
          ]);
          const toLeaves = (rows: NonNullable<typeof allRes.data>) =>
            rows.map((r) => ({
              channel: r.channel,
              device: r.device,
              country: r.country,
              returning: r.is_returning === true,
              visits: Number(r.visits) || 0,
              conversions: Number(r.conversions) || 0,
              formStarts: Number(r.form_starts) || 0,
              formAbandons: Number(r.form_abandons) || 0,
            }));
          if (!allRes.error && Array.isArray(allRes.data)) {
            const allTime = expandSegmentLeaves(toLeaves(allRes.data));
            const recent =
              !recentRes.error && Array.isArray(recentRes.data)
                ? expandSegmentLeaves(toLeaves(recentRes.data))
                : [];
            metrics.segmentGroups = attachRecent(allTime, recent);
            // Ärlig per-sida-progress (glutenforum-fyndet 2026-07-26): sajtnivån
            // kan bära 230 besök medan bästa sidan har 34 — och grinden räknar
            // per sida. Bäst-effort: saknas per-sida-rollupen lämnas fältet och
            // UI:t faller tillbaka på den generiska texten.
            if (!pageRes.error && Array.isArray(pageRes.data)) {
              const pageRows: PageSegmentVisits[] = pageRes.data.map((r) => ({
                path: String(r.path ?? "/"),
                channel: String(r.channel ?? ""),
                device: String(r.device ?? ""),
                country: String(r.country ?? ""),
                returning: r.is_returning === true,
                visits: Number(r.visits) || 0,
              }));
              const gate =
                siteConfig.testMetric === "continuation"
                  ? SEGMENT_MIN_VISITS_ENGAGEMENT
                  : SEGMENT_MIN_VISITS;
              for (const g of metrics.segmentGroups) {
                const best = bestPageForSegment(pageRows, g.key);
                g.bestPage = best ? { ...best, gate } : null;
              }
            }
          }
        } catch (segErr) {
          console.warn(`[angel] segment rollup unavailable, using window fallback:`, segErr);
        }

      // Resan till bevisat (stanna-tills-bevisat, ägarmodellen 2026-07-23):
      // ren härledning ur det som redan lästs — inga extra frågor.
      const journey = buildJourney({
        pageviews: metrics.overview.pageviews,
        uniqueVisitors: metrics.overview.uniqueVisitors,
        inventoryCount: inventory.length,
        segmentGroups: metrics.segmentGroups.map((g) => ({
          label: g.label,
          depth: g.depth,
          visits: g.visits,
          conversions: g.conversions,
        })),
        variants: variants.map((v) => ({
          status: v.status,
          segmentKey: v.segmentKey,
          abOutcome: v.abTest?.outcome ?? null,
        })),
        testMetric: siteConfig.testMetric,
      });

      // "Andra hänvisande sajter"-panelen (overview-panel: segment "other"):
      // fältet fanns i payloaden och konsumenten renderade det, men loadern
      // anropades ALDRIG (UI-buggjaktens fynd 2026-08-14) — panelen kunde
      // därför aldrig visas. Bakom canView (tenant-data); bäst-effort.
      const otherDomains = canView ? await loadTopReferrerDomains(site) : [];

      return {
        site,
        sites,
        dbAvailable: true,
        generatedAt,
        metrics,
        siteConfig,
        variants,
        journey,
        otherDomains,
        isAdmin: admin,
      };
    } catch (err) {
      console.warn(`[angel] dashboard data unavailable:`, err);
      return {
        site,
        sites: FALLBACK_SITES,
        dbAvailable: false,
        generatedAt,
        metrics: aggregate([], []),
        siteConfig: DEFAULT_SITE_CONFIG,
        variants: [],
        journey: buildJourney({
          pageviews: 0,
          uniqueVisitors: 0,
          inventoryCount: 0,
          segmentGroups: [],
          variants: [],
          testMetric: "conversion",
        }),
        isAdmin: false,
      };
    }
  });

/**
 * Set a site's consent mode (owner attestation). Writing 'attested' records the
 * owner's confirmation that they have a lawful basis / visitor consent to run
 * Angel in full; 'anonymous' reverts to storage-free operation. The snippet
 * reads this via /api/adaptive/consent-config. Best-effort but surfaces failure
 * so the UI can report it — this is a legally meaningful action.
 */
export const setConsentMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1),
      mode: z.enum(["anonymous", "attested"]),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; mode: ConsentMode }> => {
    const { site, mode } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, site))) {
      return { ok: false, mode };
    }
    // Ensure the row exists (a site may not be registered until its snippet
    // first runs), then set the mode. Upsert on the unique slug.
    const { error } = await supabaseAdmin
      .from("angel_sites")
      .upsert({ slug: site, consent_mode: mode }, { onConflict: "slug" });
    if (error) {
      console.warn(`[angel] setConsentMode failed: ${error.message}`);
      return { ok: false, mode };
    }
    // Zero-config measurement: attesting turns the control group on if the
    // owner never touched it (0). An explicitly chosen value is left alone.
    if (mode === "attested") {
      await supabaseAdmin
        .from("angel_sites")
        .update({ holdout_pct: DEFAULT_HOLDOUT_PCT })
        .eq("slug", site)
        .eq("holdout_pct", 0);
    }
    return { ok: true, mode };
  });

/**
 * Fas 4 master-toggle: slå på/av per-segment-servering för en sajt (ägarbeslut
 * 2026-07-12 — aktivering är en manuell dashboard-toggle). AV som standard.
 * OBS: decide-vägen läser inte flaggan ännu — toggeln styr ingenting live förrän
 * inkopplingen (steg 3) byggs; den landar först så att kontrollen finns FÖRE
 * förmågan. Bara sajtens ägare/admin får kalla den.
 */
export const setServingEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { site, enabled } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, site))) {
      return { ok: false };
    }
    const { error } = await supabaseAdmin
      .from("angel_sites")
      .update({ serving_enabled: enabled })
      .eq("slug", site);
    if (error) {
      console.warn(`[angel] setServingEnabled failed: ${error.message}`);
      return { ok: false };
    }
    return { ok: true };
  });

/**
 * Fas 4 steg 3: sätt variant-armens trafikandel. Ägarbeslut 2026-07-12:
 * konfigurerbar manuell ramp som börjar på 5 % — bara stegen 5/10/25/50 är
 * giltiga, så en felklickning aldrig kan skicka 100 % av trafiken till en
 * ny variant. Bara sajtens ägare/admin får kalla den.
 */
export const setServingRamp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1),
      rampPct: z.union([z.literal(5), z.literal(10), z.literal(25), z.literal(50)]),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { site, rampPct } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, site))) {
      return { ok: false };
    }
    const { error } = await supabaseAdmin
      .from("angel_sites")
      .update({ ramp_pct: rampPct })
      .eq("slug", site);
    if (error) {
      console.warn(`[angel] setServingRamp failed: ${error.message}`);
      return { ok: false };
    }
    return { ok: true };
  });

/** Variantlivscykelns MANUELLA övergångar — de ägaren gör med en knapp.
 *  Allt annat (candidate→verified) sätts av verifieringskedjan, aldrig här. */
const VARIANT_TRANSITIONS: Record<string, string[]> = {
  serving: ["verified"], // aktivera A/B
  winner: ["serving"], // följ vinnar-rekommendationen
  retired: ["serving", "winner"], // stoppa / dra tillbaka
};

/**
 * Fas 4: ägarens godkännande-knapp. Systemet genererar och verifierar själv,
 * men var tredje statusbyte som rör trafik är MANUELLT (ägarbeslut 2026-07-12):
 * verified→serving (aktivera A/B:t), serving→winner (följ rekommendationen —
 * systemet byter aldrig själv), serving/winner→retired (stoppa; kontrollen
 * återtar 100 % direkt, ingen deploy). Olagliga övergångar avvisas, och det
 * partiella unika indexet (max EN serving/winner per site·path·segment) gör
 * dubbel-aktivering till ett städat fel i stället för ett odefinierat A/B.
 */
/** Ägaren redigerar framgångskontraktet — valideras hårt (metrikkatalogen);
 *  ogiltigt kontrakt avvisas i stället för att skrivas halvtrasigt. */
export const setVariantSuccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1),
      variantId: z.string().uuid(),
      success: z.unknown(),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; reason?: string }> => {
    const { site, variantId } = data;
    const spec = validateSuccessSpec(data.success);
    if (!spec) return { ok: false, reason: "invalid success contract" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, site))) {
      return { ok: false, reason: "not owner" };
    }
    const { error } = await supabaseAdmin
      .from("angel_variants")
      .update({ success: spec as unknown as Json, updated_at: new Date().toISOString() })
      .eq("id", variantId)
      .eq("site", site);
    if (error) {
      console.warn(`[angel] setVariantSuccess failed: ${error.message}`);
      return { ok: false, reason: "write failed" };
    }
    return { ok: true };
  });

export const setVariantStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1),
      variantId: z.string().uuid(),
      status: z.enum(["serving", "winner", "retired"]),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; reason?: string }> => {
    const { site, variantId, status } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, site))) {
      return { ok: false, reason: "not owner" };
    }
    const { data: row, error: readErr } = await supabaseAdmin
      .from("angel_variants")
      .select("id,status,success,evidence")
      .eq("id", variantId)
      .eq("site", site)
      .maybeSingle();
    if (readErr || !row) return { ok: false, reason: "variant not found" };
    if (!VARIANT_TRANSITIONS[status]?.includes(row.status)) {
      return { ok: false, reason: `illegal transition ${row.status} → ${status}` };
    }
    // Vinnar-grinden (gap-audit Tier-1, falsk vinnare): serving→winner FRYSER
    // A/B:t — kontrollarmen slutar fyllas, så påvisad skada blir osynlig och
    // nattens guardrail-svep förlorar sin bevisning. Maskinen vägrar därför
    // befordran vid PÅVISAD skada (kontraktsbrott/förlust/recommend_stop) —
    // och bara då: frånvaro av bevis förblir ägarens beslut (Fas 4-reglerna
    // 2026-07-12). Läsningen är best-effort: går armarna inte att läsa finns
    // ingen påvisad skada att vägra på.
    if (status === "winner") {
      try {
        const [{ data: siteRow }, { data: arms, error: aErr }] = await Promise.all([
          supabaseAdmin.from("angel_sites").select("test_metric").eq("slug", site).maybeSingle(),
          supabaseAdmin.rpc("angel_variant_arms", { p_site: site, p_variant: variantId }),
        ]);
        if (!aErr && Array.isArray(arms) && arms.length > 0) {
          const metric = siteRow?.test_metric === "continuation" ? "continuation" : "conversion";
          const fullArm = (name: string): GuardArmCounts => {
            const r = (arms as ArmsRpcRow[]).find((a) => a.arm === name);
            return {
              visits: Number(r?.visits) || 0,
              conversions: Number(r?.conversions) || 0,
              continuations: Number(r?.continuations) || 0,
              engaged: Number(r?.engaged) || 0,
            };
          };
          const variantFull = fullArm("variant");
          const controlFull = fullArm("control");
          const evaluation =
            variantFull.visits + controlFull.visits > 0
              ? evaluateWinnerWithGuards(variantFull, controlFull, metric)
              : null;
          const spec = validateSuccessSpec(row.success) ?? defaultSuccessSpec();
          const armsByMetric = metricArmsFromRpc(arms as ArmsRpcRow[]);
          const contract = armsByMetric ? evaluateRuleWithSpec(spec, armsByMetric) : null;
          const ruling = contract
            ? {
                verdict: contract.verdict,
                breachedMetrics: contract.guardrails.filter((g) => g.breached).map((g) => g.metric),
              }
            : null;
          const blocked = promotionBlockReason(evaluation, ruling);
          if (blocked) return { ok: false, reason: blocked };
        }
      } catch {
        /* best-effort: oläsbara armar är inte påvisad skada */
      }
    }
    // Att starta A/B:t ÄR godkännandet av framgångsdefinitionen: saknas
    // kontraktet fylls sajttypens standard i — ingen variant mäter med
    // odefinierad vinst (samma regel som labbets approve-rule).
    const successFill =
      status === "serving" && !validateSuccessSpec(row.success)
        ? { success: defaultSuccessSpec() as unknown as Json }
        : {};
    // Vinnar-avvecklingen (blockbibliotekets steg 3, granskningsfynd
    // 2026-08-11): winner→retired är en LEGAL ägartransition — men utan
    // markören hade transfer-lärandet läst en vunnen-och-tillbakadragen
    // återbruksvariant som ett MISSLYCKANDE och kunnat falsifiera ett block
    // som vann varje test det körde. Markören bevarar historien: raden var
    // en vinnare när den drogs tillbaka.
    //
    // ATOMISK jsonb-merge via RPC (granskningsfynd 2026-08-13): den gamla
    // vägen läste hela evidence och skrev tillbaka det — det optimistiska
    // .eq(status)-låset skyddade bara status, så en SAMTIDIG nattloop-
    // skrivning av evidence.comparison/screenshots klobbrades tyst med en
    // inaktuell kopia. angel_retire_winner gör övergången + `|| wasWinner` i
    // EN sats, så samtidiga evidence-fält överlever. Statusövergången och
    // markören är dessutom oskiljaktiga (inte två separata skrivningar som kan
    // lämna en retired rad UTAN markör).
    if (row.status === "winner" && status === "retired") {
      return await retireWinner(supabaseAdmin, site, variantId);
    }
    const { error } = await supabaseAdmin
      .from("angel_variants")
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...successFill,
      })
      .eq("id", variantId)
      .eq("site", site)
      .eq("status", row.status); // optimistiskt lås — samtidiga klick blir no-op
    if (error) {
      // 23505 = unikt index: en annan variant serverar redan detta segment.
      const conflict = error.code === "23505";
      console.warn(`[angel] setVariantStatus failed: ${error.message}`);
      return {
        ok: false,
        reason: conflict ? "en annan variant serverar redan detta segment" : "write failed",
      };
    }
    return { ok: true };
  });

/**
 * Confirm a proposed goal candidate as the site's ACTIVE conversion goal. This
 * is the "commit" half of propose→commit: it records the owner's goal
 * (conversion_source='owner') and — unlike a raw owner override — keeps the
 * harvested label (conversion_text) so click detection can fall back to it. The
 * engine only highlights/measures this goal once the site enables adaptations
 * (angel_sites.adaptations_enabled); under observe-first that flag is off by
 * default, so confirming a goal alone changes nothing visible. Only the site's
 * owner/admin may call it.
 */
export const confirmGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1),
      selector: z.string().trim().min(1).max(500),
      text: z.string().trim().max(300).optional(),
      url: z.string().trim().max(500).optional(),
      /** The confirmed candidate's judged GoalKind — WHAT converting means.
       *  Persisted so the runtime engine can condition on it (goal-aware
       *  clarify_cta etc.) instead of assuming SaaS demo/trial. */
      kind: z.enum(GOAL_KINDS as [string, ...string[]]).optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { site, selector, text, url, kind } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, site))) {
      return { ok: false };
    }
    const { error } = await supabaseAdmin.from("angel_sites").upsert(
      {
        slug: site,
        conversion_selector: selector,
        conversion_text: text || null,
        conversion_url: url || null,
        conversion_kind: kind || null,
        conversion_source: "owner",
      },
      { onConflict: "slug" },
    );
    if (error) {
      console.warn(`[angel] confirmGoal failed: ${error.message}`);
      return { ok: false };
    }
    return { ok: true };
  });

/** Verify an account password against Supabase Auth, server-side. Returns
 *  'ok' | 'password' (wrong credentials) | 'error' (rate limit / infra). The
 *  returned session is discarded — this is a yes/no check only. */
async function verifyPassword(
  email: string,
  password: string,
): Promise<"ok" | "password" | "error"> {
  const url = process.env.SUPABASE_URL;
  const apikey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !apikey) return "error";
  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return "ok";
    return res.status === 400 ? "password" : "error";
  } catch (err) {
    console.warn(`[angel] password verification unavailable:`, err);
    return "error";
  }
}

/**
 * Generate (or regenerate) a site's ingest key and return it. Rotating
 * invalidates the previous key, so the site's snippet tag must be updated with
 * the new value or its writes will be rejected. Because that can silently stop
 * a live site's data, a valid session is NOT enough: the caller's account
 * password is re-verified HERE, server-side — a client-side check could be
 * bypassed by anyone holding the session token.
 */
export const rotateIngestKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ site: z.string().min(1), password: z.string().min(1) }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; reason?: "auth" | "password" | "error"; key: string | null }> => {
      const ctx = context as unknown as AuthCtx;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      if (!(await ownsSite(supabaseAdmin, ctx, data.site))) {
        return { ok: false, reason: "auth", key: null };
      }
      const email = ctx.claims?.email;
      if (!email) return { ok: false, reason: "password", key: null };
      const verdict = await verifyPassword(email, data.password);
      if (verdict !== "ok") return { ok: false, reason: verdict, key: null };

      const key = genKey();
      const { error } = await supabaseAdmin
        .from("angel_sites")
        .upsert({ slug: data.site, ingest_key: key }, { onConflict: "slug" });
      if (error) {
        console.warn(`[angel] rotateIngestKey failed: ${error.message}`);
        return { ok: false, reason: "error", key: null };
      }
      return { ok: true, key };
    },
  );

/**
 * Create (or claim) a site and make the caller its owner. A brand-new slug is
 * inserted with a fresh ingest key; an existing but unowned slug (auto-
 * registered when a snippet first ran) is claimed; a slug already owned by
 * someone else is refused. Returns the slug + its ingest key so the dashboard
 * can render the install snippet. Auth-gated.
 */
export const createSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      slug: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9._-]*$/i, "letters, digits, . _ - only"),
      name: z.string().trim().max(120).optional(),
      domain: z.string().trim().max(200).optional(),
    }),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; reason?: string; slug?: string; ingestKey?: string }> => {
      const ctx = context as unknown as AuthCtx;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { normalizeDomain } = await import("@/adaptive/domain");
      const slug = data.slug.toLowerCase();

      // Domänen normaliseras (URL/www./versaler → "exempel.se") och är UNIK
      // över alla sajter: två konton kan aldrig registrera samma domän, och
      // Origin-grinden + verifieringsstämpeln binder sedan trafiken till den.
      const domain = normalizeDomain(data.domain) ?? null;
      if (data.domain && !domain) {
        return { ok: false, reason: "bad_domain" };
      }
      if (domain) {
        const { data: taken } = await supabaseAdmin
          .from("angel_sites")
          .select("slug")
          .ilike("domain", domain)
          .neq("slug", slug)
          .maybeSingle();
        if (taken) return { ok: false, reason: "domain_taken" };
      }

      // Refuse a slug already owned by a DIFFERENT user.
      const { data: members } = await supabaseAdmin
        .from("angel_site_members")
        .select("user_id")
        .eq("site_slug", slug);
      const ownedByOther = (members ?? []).some(
        (m: { user_id: string }) => m.user_id !== ctx.userId,
      );
      if (ownedByOther && !isAdminEmail(ctx.claims?.email)) {
        return { ok: false, reason: "taken" };
      }

      // Ensure the row exists (create-if-absent, never clobber name/domain) and
      // has a key.
      const { data: existing } = await supabaseAdmin
        .from("angel_sites")
        .select("ingest_key")
        .eq("slug", slug)
        .maybeSingle();
      let key = existing?.ingest_key ?? null;
      if (!existing) {
        key = genKey();
        const { error } = await supabaseAdmin.from("angel_sites").insert({
          slug,
          name: data.name ?? null,
          domain,
          // Nya sajter kräver prenumeration för SERVING (observation är
          // alltid fri). exempt sätts bara manuellt (pilot/labb).
          billing_status: "none",
          ingest_key: key,
          // Consent-by-default: a new site starts ANONYMOUS (the DB default —
          // no persistent visitor id, no behavioural events) and with no
          // holdout, per docs/consent-gate.md ("never assume consent") and
          // GDPR's opt-in default. The owner flips the existing dashboard
          // attestation toggle when they have a lawful basis — setConsentMode
          // then auto-enables the DEFAULT_HOLDOUT_PCT control group, so
          // measurement is still zero-config from the moment collection is
          // actually allowed. The signup checkbox alone is not a lawful basis
          // for the VISITORS of a site the account hasn't attested.
        });
        if (error) {
          console.warn(`[angel] createSite insert failed: ${error.message}`);
          return { ok: false, reason: "error" };
        }
      }
      // Claiming an existing unkeyed site must NOT auto-generate a key: the
      // site's live tag has no data-key, so keying here would silently 403
      // every request from the running install. Locking writes is an explicit,
      // password-gated action in Settings instead.

      // Claim ownership (idempotent).
      const { error: memErr } = await supabaseAdmin
        .from("angel_site_members")
        .upsert({ user_id: ctx.userId, site_slug: slug }, { onConflict: "user_id,site_slug" });
      if (memErr) {
        console.warn(`[angel] createSite membership failed: ${memErr.message}`);
        return { ok: false, reason: "error" };
      }
      return { ok: true, slug, ingestKey: key ?? undefined };
    },
  );

/**
 * Betalning (block 3, ägarbeslut 2026-07-16: 399 USD/mån, 30 dagars trial med
 * kort). Startar en Stripe Checkout-session för det inloggade kontot.
 * Returnerar checkout-URL:en, eller ok:false när Stripe inte är konfigurerat
 * (produkten fungerar i observe-läge utan betalning).
 */
export const startCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ returnUrl: z.string().url() }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; url?: string; reason?: string }> => {
    const ctx = context as unknown as AuthCtx;
    const email = ctx.claims?.email;
    if (!email) return { ok: false, reason: "no_email" };
    const { createCheckoutUrl } = await import("@/lib/billing/stripe.server");
    const url = await createCheckoutUrl(ctx.userId, email, data.returnUrl);
    return url ? { ok: true, url } : { ok: false, reason: "not_configured" };
  });

/** Stripe-kundportalen (hantera kort, säga upp). */
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ returnUrl: z.string().url() }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; url?: string; reason?: string }> => {
    const ctx = context as unknown as AuthCtx;
    const { createPortalUrl } = await import("@/lib/billing/stripe.server");
    const url = await createPortalUrl(ctx.userId, data.returnUrl);
    return url ? { ok: true, url } : { ok: false, reason: "not_configured" };
  });
