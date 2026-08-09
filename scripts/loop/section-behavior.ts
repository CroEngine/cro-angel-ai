// Steg 10: hela beteende-röret för katalog-anropare — events → observationer
// → rollup → BehaviorInput. Tunn db-hämtning ovanpå RENA delar (aggregering
// + rollup är src-side och CI-grindade); null hela vägen när datan inte bär
// (ingen snippet-data, tunn data, hög join-miss) ⇒ katalogen byte-identisk
// med idag. Prospekt-förhandsvisningar har per definition ingen data (sajten
// är oinstallerad) — röret är ändå inkopplat där, så konvergensen (steg 11)
// bara behöver peka installerade sajters flöde genom SAMMA väg.

import type { SupabaseClient } from "@supabase/supabase-js";

import { scrubPath, stripQueryHash } from "../../src/adaptive/harvest/sanitize";
import { cleanEvents } from "../../src/lib/dashboard/data-hygiene";
import type { DashEvent } from "../../src/lib/dashboard/aggregate";
import type { BehaviorInput } from "../../src/adaptive/redesign/candidates";
import { rollupEngagement } from "../../src/adaptive/redesign/engagement-rollup";
import {
  aggregateSectionObservations,
  type SectionEngagementPayload,
} from "../../src/adaptive/redesign/section-events";

/** Senaste-fönstret: nog för tunn-grindens 1000-laddningsgolv per sida med
 *  god marginal, litet nog att en query räcker. */
const FETCH_LIMIT = 5000;
/** Färskhetsfönster (granskningsfynd 2026-08-08: utan tidsgräns blandades
 *  månadsgamla layouters events in och kunde dominera dagens sida): samma
 *  30-dagarshorisont som kohortplaneraren räknar mätbarhet på. */
const FRESH_DAYS = 30;
/** Exponerings-uppslaget (arm-stängslet nedan) hämtas i satser — decisionId
 *  är en KONTEXT-hash, så antalet distinkta id:n är litet även på stora
 *  strömmar; satsen håller URL-längden nere. */
const EXPOSURE_ID_BATCH = 100;
/** Tak per sats. Nås det är svaret komplett bara upp till det sist sedda
 *  id:t — resten stängslas konservativt (se exposedDecisionIds). */
const EXPOSURE_LIMIT = 20_000;

/** OMARKERADE EVENTS arm-stängsel (granskningsfynd 2026-08-08). Census-rader
 *  bär `payload.adapted` (0/1) — en exakt PER-LADDNING-markör som filtreras
 *  redan i SQL. En rad utan markören har bara decision_id att gå på, och den
 *  är en KONTEXT-hash: delad av båda armarna och av varje laddning i samma
 *  kontext. Stängslet nedan är därför trubbigt — kontrollarmens rena mätningar
 *  faller med — men trubbigheten pekar åt rätt håll (hellre mindre underlag än
 *  en vikt vi inte kan försvara).
 *
 *  MÄTT LÄGE 2026-08-09: noll section_engagement-rader finns i produktion
 *  (ingen sajt har slagit på observationen ännu), så varje rad som någonsin
 *  skrivs bär markören. Vägen här är försvarsdjup — mot en framtida klient som
 *  inte sätter fältet — inte en väg vi räknar med att gå.
 *
 *  Mekanik: logDecision skriver EN adaptation_shown-rad per serverad laddning
 *  (kontrollarmen får adaptation_withheld) med samma decision_id som
 *  section_engagement bär. Varje omarkerad census-rad vars decision_id
 *  förekommer som adaptation_shown på SAMMA sida i fönstret släpps.
 *
 *  Returnerar null när uppslaget faller — "hellre tyst än gissa". */
async function exposedDecisionIds(
  db: SupabaseClient,
  site: string,
  path: string,
  cutoff: string,
  ids: string[],
): Promise<Set<string> | null> {
  const exposed = new Set<string>();
  for (let i = 0; i < ids.length; i += EXPOSURE_ID_BATCH) {
    // SORTERAD sats + sorterat svar: det gör trunkeringen hanterbar i stället
    // för fatal (se nedan).
    const batch = ids.slice(i, i + EXPOSURE_ID_BATCH);
    const { data, error, count } = await db
      .from("angel_events")
      .select("decision_id", { count: "exact" })
      .eq("site", site)
      .eq("type", "adaptation_shown")
      .eq("payload->>path", path)
      .gte("created_at", cutoff)
      .in("decision_id", batch)
      .limit(EXPOSURE_LIMIT);
    if (error || !data) return null;
    const rows = data as { decision_id: string | null }[];
    for (const r of rows) if (r.decision_id) exposed.add(r.decision_id);
    // TRUNKERING mäts mot serverns EGET facit (count: "exact"), inte mot vår
    // begärda limit (granskningsfynd 2026-08-08: PostgREST kan ha ett eget
    // radtak, och då hade `rows.length >= EXPOSURE_LIMIT` aldrig slagit till —
    // stängslet blivit tyst ofullständigt). Fattas rader vet vi inte vilka
    // id:n de bar ⇒ hela satsen stängslas. Okänt får aldrig bli "oexponerad".
    if (typeof count === "number" && rows.length < count) {
      for (const id of batch) exposed.add(id);
    }
  }
  return exposed;
}

export async function fetchSectionBehavior(
  db: SupabaseClient,
  site: string,
  pagePath: string,
  sections: { id: string; type: string; heading: string }[],
): Promise<BehaviorInput | null> {
  try {
    // SAMMA transform som skriv-sidan (granskningsfynd 2026-08-08: lagrade
    // paths är scrubPath(stripQueryHash(...)) — "/artikel/12345678" lagras som
    // "/artikel/[redacted]"; en RÅ jämförelse matchar aldrig på id-bärande
    // sidor och rollupen blev null för evigt just där).
    const path = scrubPath(stripQueryHash(pagePath)) || "/";
    const cutoff = new Date(Date.now() - FRESH_DAYS * 24 * 3600 * 1000).toISOString();
    const { data, error } = await db
      .from("angel_events")
      .select("type, payload, visitor_hash, decision_id, created_at")
      .eq("site", site)
      .eq("type", "section_engagement")
      // PATH-FILTRET I SQL (granskningsfynd 2026-08-08: global limit FÖRE
      // klient-filtret svalt tysta sidor på livliga sajter — en sida med 2 %
      // av strömmen kom aldrig över tunn-golvet hur mycket data den än hade).
      .eq("payload->>path", path)
      .gte("created_at", cutoff)
      // ARM-FILTRET I SQL (granskningsfynd 2026-08-08): stängslades armen först
      // på klienten åt de adapterade raderna upp FETCH_LIMIT-taket, så en sida
      // med en serverad variant fick ett stympat organiskt underlag och sätet
      // tystnade av fel skäl. Äldre rader saknar fältet (is.null) och stängslas
      // i stället via decision_id nedan.
      .or("payload->>adapted.is.null,payload->>adapted.eq.0")
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);
    if (error || !data) return null;
    // HELA läs-hygienkontraktet, inte ett eget urval (granskningsdom
    // 2026-08-08: bara simulated-flaggan räckte inte — cleanEvents är samma
    // filter som dashboard/motor-läsarna kör: simulated + lasttest-fönster +
    // ägar-/dev-hashar + ägarsessioner + simulatorkällor). Syntetiska eller
    // ägar-genererade besök får aldrig bli beteendevikter.
    const rows: DashEvent[] = (data as {
      type: string;
      payload: SectionEngagementPayload & { path?: unknown };
      visitor_hash: string | null;
      decision_id: string | null;
      created_at: string;
    }[]).map((r) => ({
      type: r.type,
      payload: r.payload as Record<string, unknown>,
      visitorHash: r.visitor_hash,
      decisionId: r.decision_id,
      createdAt: r.created_at,
    }));
    const clean = cleanEvents(site, rows).filter(
      (e) =>
        ((typeof (e.payload as { path?: unknown })?.path === "string"
          ? ((e.payload as { path?: string }).path as string)
          : "/") || "/") === path,
    );
    // ARM-STÄNGSLET, två lager.
    // 1) Markerade rader: `adapted` är en exakt per-laddnings-sanning från
    //    samma snippet som mätte dwell-tiderna. SQL har redan släppt 1:orna;
    //    den här raden är bältet till hängslena om filtret skulle glida.
    const marked = clean.filter((e) => (e.payload as { adapted?: unknown }).adapted !== undefined);
    const unmarked = clean.filter(
      (e) => (e.payload as { adapted?: unknown }).adapted === undefined,
    );
    const markedOrganic = marked.filter((e) => !(e.payload as { adapted?: unknown }).adapted);
    // 2) Omarkerade (äldre) rader: bara kontext-hashen finns — trubbigt
    //    stängsel, se exposedDecisionIds.
    let legacyOrganic = unmarked;
    const legacyIds = [
      ...new Set(unmarked.map((e) => e.decisionId).filter((d): d is string => !!d)),
    ];
    if (legacyIds.length > 0) {
      const exposed = await exposedDecisionIds(db, site, path, cutoff, legacyIds);
      if (!exposed) return null; // stängslet kunde inte bevisas ⇒ hellre tyst
      if (exposed.size > 0) {
        legacyOrganic = unmarked.filter((e) => !(e.decisionId && exposed.has(e.decisionId)));
      }
    }
    const organic = [...markedOrganic, ...legacyOrganic];
    const fenced = clean.length - organic.length;
    if (fenced > 0) {
      console.log(
        `  [beteende] ${path}: ${fenced}/${clean.length} census-rader låg i en serverad arm — stängslade (självmätning)`,
      );
    }
    const payloads = organic.map((e) => e.payload as SectionEngagementPayload & { path?: unknown });
    const observations = aggregateSectionObservations(payloads);
    if (observations.length === 0) return null;
    const rollup = rollupEngagement(sections, observations);
    if (!rollup) return null;
    console.log(
      `  [beteende] ${path}: ${rollup.totalVisits} besök, ${Math.round(rollup.attributedMass * 100)}% krediterat över ${Object.keys(rollup.sectionWeight).length} sektioner — sätet matas`,
    );
    return { sectionWeight: rollup.sectionWeight };
  } catch {
    return null; // beteendedata är alltid valfritt — aldrig fälla en preview
  }
}
