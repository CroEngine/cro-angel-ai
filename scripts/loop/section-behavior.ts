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
    const payloads = cleanEvents(site, rows)
      .map((e) => e.payload as SectionEngagementPayload & { path?: unknown })
      .filter((p) => ((typeof p?.path === "string" ? p.path : "/") || "/") === path);
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
