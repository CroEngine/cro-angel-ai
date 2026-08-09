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
/** Tak per sats. Nås det kan vi inte längre BEVISA vilka id:n som exponerats
 *  (trunkeringen döljer resten) ⇒ hela svaret blir null. */
const EXPOSURE_LIMIT = 20_000;

/** Arm-stängslet (granskningsfynd 2026-08-08, den självförstärkande klassen):
 *  laddningar där VI SJÄLVA flyttade om sidan får aldrig bli "besökarnas
 *  beteende". En serverad move_up lyfter sektionen ovanför folden, dwell-
 *  mätningen stiger, nästa natt rankar sätet samma sektion högst — och
 *  menyraden påstår att BESÖKARNA gjorde det. Repot stängslar redan exakt den
 *  här klassen för skördaren (adaptedThisLoad); censusen saknade stängslet.
 *
 *  Mekanik: logDecision skriver EN adaptation_shown-rad per serverad laddning
 *  (kontrollarmen får adaptation_withheld) med samma decision_id som
 *  section_engagement bär. Vi släpper varje census-rad vars decision_id
 *  förekommer som adaptation_shown på SAMMA sida i fönstret.
 *
 *  Trubbigheten är MEDVETEN och åt rätt håll: decisionId är en kontext-hash
 *  som delas av båda armarna, så kontrollarmens rena laddningar faller med.
 *  Hellre ett mindre men oförorenat underlag än en vikt vi inte kan försvara.
 *  Returnerar null när stängslet inte kan bevisas komplett (db-fel/trunkering)
 *  — samma "hellre tyst än gissa" som resten av röret. */
async function exposedDecisionIds(
  db: SupabaseClient,
  site: string,
  path: string,
  cutoff: string,
  ids: string[],
): Promise<Set<string> | null> {
  const exposed = new Set<string>();
  for (let i = 0; i < ids.length; i += EXPOSURE_ID_BATCH) {
    const batch = ids.slice(i, i + EXPOSURE_ID_BATCH);
    const { data, error } = await db
      .from("angel_events")
      .select("decision_id")
      .eq("site", site)
      .eq("type", "adaptation_shown")
      .eq("payload->>path", path)
      .gte("created_at", cutoff)
      .in("decision_id", batch)
      .limit(EXPOSURE_LIMIT);
    if (error || !data) return null;
    const rows = data as { decision_id: string | null }[];
    // Trunkering ⇒ okänd rest ⇒ stängslet kan inte bevisas komplett.
    if (rows.length >= EXPOSURE_LIMIT) return null;
    for (const r of rows) if (r.decision_id) exposed.add(r.decision_id);
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
    // Arm-stängslet: släpp census-rader från laddningar där en variant VISADES.
    const candidateIds = [...new Set(clean.map((e) => e.decisionId).filter((d): d is string => !!d))];
    let organic = clean;
    if (candidateIds.length > 0) {
      const exposed = await exposedDecisionIds(db, site, path, cutoff, candidateIds);
      if (!exposed) return null; // stängslet kunde inte bevisas ⇒ hellre tyst
      if (exposed.size > 0) {
        organic = clean.filter((e) => !(e.decisionId && exposed.has(e.decisionId)));
        console.log(
          `  [beteende] ${path}: ${clean.length - organic.length}/${clean.length} census-rader låg i en serverad arm — stängslade (självmätning)`,
        );
      }
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
