// "Resan till bevisat" — stanna-tills-bevisat-berättelsen (ägarmodellen
// 2026-07-23). Mellan installationen och första verifierade varianten går det
// dagar–veckor där kunden annars ser en tyst dashboard — där bor churnen.
// Den här RENA byggaren gör insamlingsperioden till en synlig berättelse:
// varje milstolpe är härledd ur data som redan finns (översikten, inventariet,
// segmentgrupperna, varianterna) och varje detaljrad är en MÄTNING, aldrig
// marknadsföring. Samma ärlighetskontrakt som resten av produkten — väntan
// ska kännas som pågående mätning, inte som tystnad.
//
// Prissättningens dramaturgi är inbyggd: milstolpe 6 (verifierad variant) ÄR
// bevishändelsen som startar 7-dagarsvarslet ("free until your first verified
// variant", billing.ts PLAN) — resan visar kunden exakt var på vägen dit hen är.

import {
  SEGMENT_MIN_CONVERSIONS,
  SEGMENT_MIN_VISITS,
  SEGMENT_MIN_VISITS_ENGAGEMENT,
} from "./aggregate";

export type JourneyState = "done" | "current" | "upcoming";

export interface JourneyMilestone {
  id:
    | "install"
    | "mapped"
    | "profiled"
    | "segments"
    | "earned"
    | "verified"
    | "measuring"
    | "verdict";
  title: string;
  state: JourneyState;
  /** Ärlig, databärande enradare — en mätning, aldrig ett löfte. */
  detail: string;
}

/** Golv för "besökare profilerade" — under det är segmentbilden bara brus. */
export const JOURNEY_PROFILE_MIN = 50;
/** En grupp "tar form" från den här volymen (samma golv som arm-validiteten). */
export const JOURNEY_GROUP_MIN_VISITS = 30;

export interface JourneyInput {
  pageviews: number;
  uniqueVisitors: number;
  /** Antal kartlagda innehållsbitar (inventariets alla poster). */
  inventoryCount: number;
  segmentGroups: {
    label: string;
    depth: number;
    visits: number;
    conversions: number;
  }[];
  variants: {
    status: "candidate" | "verified" | "serving" | "winner" | "retired";
    segmentKey: string;
    abOutcome?: string | null;
  }[];
  testMetric: "conversion" | "continuation";
}

const fmt = (n: number): string => n.toLocaleString("en-US");

/** Bygg resan: första ej-klara milstolpen är "current", allt efter "upcoming".
 *  Ren — inga sidoeffekter, ingen tid (allt är räknare ur nuläget). */
export function buildJourney(input: JourneyInput): JourneyMilestone[] {
  const active = input.variants.filter((v) => v.status !== "retired");
  const anyVariant = active.length > 0;
  const verifiedPlus = active.filter(
    (v) => v.status === "verified" || v.status === "serving" || v.status === "winner",
  );
  const live = active.filter((v) => v.status === "serving" || v.status === "winner");
  const winner = active.find((v) => v.status === "winner");
  const readOutcome = active.find(
    (v) =>
      v.abOutcome === "recommend_winner" ||
      v.abOutcome === "recommend_stop" ||
      v.abOutcome === "no_winner",
  );

  const groups = input.segmentGroups.filter((g) => g.depth >= 2);
  const forming = groups.filter((g) => g.visits >= JOURNEY_GROUP_MIN_VISITS);
  const biggest = [...forming].sort((a, b) => b.visits - a.visits)[0] ?? null;

  // Närmast förtjänad grupp — ärlig progress mot volymgolvet (continuation-
  // läget kräver bara besök; conversion-läget även konverteringar).
  const needVisits =
    input.testMetric === "continuation" ? SEGMENT_MIN_VISITS_ENGAGEMENT : SEGMENT_MIN_VISITS;
  const needConv = input.testMetric === "continuation" ? 0 : SEGMENT_MIN_CONVERSIONS;
  const progressOf = (g: { visits: number; conversions: number }): number =>
    Math.min(
      g.visits / needVisits,
      needConv > 0 ? Math.max(g.conversions / needConv, 0) : g.visits / needVisits,
    );
  const closest = [...groups].sort((a, b) => progressOf(b) - progressOf(a))[0] ?? biggest ?? null;

  const done = {
    install: input.pageviews > 0,
    mapped: input.inventoryCount > 0,
    profiled: input.uniqueVisitors >= JOURNEY_PROFILE_MIN,
    segments: forming.length > 0,
    earned: anyVariant,
    verified: verifiedPlus.length > 0,
    measuring: live.length > 0,
    verdict: !!winner || !!readOutcome,
  };

  const milestones: JourneyMilestone[] = [
    {
      id: "install",
      title: "Snippet live",
      state: "upcoming",
      detail: done.install
        ? `${fmt(input.pageviews)} pageviews from ${fmt(input.uniqueVisitors)} visitors so far — nothing changes for them until you approve it.`
        : "Install the one-line snippet. Angel observes first — nothing changes for your visitors.",
    },
    {
      id: "mapped",
      title: "Your page mapped",
      state: "upcoming",
      detail: done.mapped
        ? `${fmt(input.inventoryCount)} content pieces mapped from your own page — the only material Angel ever uses.`
        : "Angel reads your page's own sections, proof and CTAs — it never invents content.",
    },
    {
      id: "profiled",
      title: "Visitors profiled",
      state: "upcoming",
      detail: done.profiled
        ? `${fmt(input.uniqueVisitors)} distinct visitors profiled.`
        : `${fmt(input.uniqueVisitors)}/${JOURNEY_PROFILE_MIN} distinct visitors — below this, any pattern is noise.`,
    },
    {
      id: "segments",
      title: "Visitor groups forming",
      state: "upcoming",
      detail: done.segments
        ? `${fmt(forming.length)} groups have real volume — largest: ${biggest!.label} (${fmt(biggest!.visits)} visits).`
        : "Channel × device × country groups build as traffic arrives.",
    },
    {
      id: "earned",
      title: "A group earns a design",
      state: "upcoming",
      detail: done.earned
        ? `${active[0].segmentKey} earned a design — the designer works only with content you already published.`
        : closest
          ? `Closest: ${closest.label} — ${fmt(closest.visits)}/${fmt(needVisits)} visits${
              needConv > 0 ? ` and ${fmt(closest.conversions)}/${fmt(needConv)} conversions` : ""
            } toward the bar. No shortcuts: designs are earned by data, not guessed.`
          : "A group earns its own design once it carries enough data to measure honestly.",
    },
    {
      id: "verified",
      title: "Variant verified — review it",
      state: "upcoming",
      detail: done.verified
        ? "Before/after screenshots, every gate passed, both viewports. This is the free-until-proven moment: your 7-day notice starts here, and nothing serves without your click."
        : "Every design must pass reversibility, layout and Core-Web-Vitals gates on both mobile and desktop before you ever see it.",
    },
    {
      id: "measuring",
      title: "A/B live",
      state: "upcoming",
      detail: done.measuring
        ? "Serving to a small ramp against a held-back control — guardrails watch bounce, engagement and your goal nightly."
        : "You press start; Angel serves a small ramp against a held-back control group.",
    },
    {
      id: "verdict",
      title: "An honest verdict",
      state: "upcoming",
      detail: winner
        ? "Winner promoted — the improvement is your new baseline."
        : readOutcome
          ? "The A/B has an honest read — see the recommendation on the variant."
          : "Win, loss or no-effect — the dashboard tells you which, and how long a verdict needs at your traffic.",
    },
  ];

  // Första ej-klara = current; allt före done; allt efter upcoming.
  let currentSet = false;
  for (const m of milestones) {
    if (done[m.id]) {
      m.state = "done";
    } else if (!currentSet) {
      m.state = "current";
      currentSet = true;
    }
  }
  return milestones;
}
