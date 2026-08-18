// DB-hämtningen bakom /api/public/stats. Aggregat ENBART — inga sajtnamn,
// inga rader, ingen tenant-läcka: svaret är fyra räknare och en tidsstämpel
// över hela flottan (minus labbet). Fel kastas uppåt — hellre 503 än delvis
// felaktiga siffror på en sida vars hela poäng är ärlighet.
//
// SERVERINGSVÄGENS SANNING (granskningsfynd 2026-08-18): räknarna speglar
// samma villkor som avgör om en variant faktiskt når besökare, inte bara
// status-kolumnen. En maskinhållen rad (held_reason satt — vaktsvepet fann
// skada eller drift) serveras aldrig (loadServableVariants filtrerar
// held_reason null), och en "serving"-rad på en sajt med serving_enabled=false
// mäter ingenting. Att räkna dem som "mäts just nu"/"bevisad vinnare" vore
// exakt den sortens osann siffra startsidan lovar bort.

import { LAB_SITES, type PublicStats } from "./stats";

export async function fetchPublicStats(): Promise<PublicStats> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  /** Sajter där servering faktiskt är på — "mäts just nu" kräver medlemskap. */
  const servingSites = async (): Promise<string[]> => {
    const { data, error } = await supabaseAdmin
      .from("angel_sites")
      .select("slug")
      .eq("serving_enabled", true);
    if (error) throw new Error(`serving sites: ${error.message}`);
    return (data ?? [])
      .map((r) => (r as { slug: string }).slug)
      .filter((s) => !LAB_SITES.includes(s));
  };

  /** Variant-räknare: alltid ohållna (held_reason null), alltid utan labbet.
   *  Med sites-lista begränsas räkningen till de sajterna; tom lista ⇒ 0
   *  utan fråga. */
  const variantCount = async (status: string, sites?: string[]): Promise<number> => {
    if (sites && sites.length === 0) return 0;
    let q = supabaseAdmin
      .from("angel_variants")
      .select("id", { count: "exact", head: true })
      .eq("status", status)
      .is("held_reason", null);
    if (sites) {
      q = q.in("site", sites);
    } else {
      for (const site of LAB_SITES) q = q.neq("site", site);
    }
    const { count, error } = await q;
    if (error) throw new Error(`variant count ${status}: ${error.message}`);
    return count ?? 0;
  };

  const lastEngineAction = async (): Promise<string | null> => {
    let q = supabaseAdmin.from("angel_variants").select("updated_at");
    for (const site of LAB_SITES) q = q.neq("site", site);
    const { data, error } = await q
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`last action: ${error.message}`);
    return (data as { updated_at?: string | null } | null)?.updated_at ?? null;
  };

  /** DISTINKTA adresser, inte jobbrader (granskningsfynd 2026-08-18): samma
   *  URL inklistrad flera gånger — eller våra egna QA-körningar av samma
   *  sajt — ska inte räknas som flera byggda exempel. Tabellen är liten
   *  (rate limit 3/dygn/avsändare); växer den, flytta dedupen till SQL. */
  const previewsBuilt = async (): Promise<number> => {
    const { data, error } = await supabaseAdmin
      .from("angel_preview_jobs")
      .select("url")
      .eq("status", "ok");
    if (error) throw new Error(`preview count: ${error.message}`);
    return new Set((data ?? []).map((r) => (r as { url: string }).url)).size;
  };

  const sites = await servingSites();
  const [awaitingApproval, measuringNow, provenWinners, previews, lastAction] = await Promise.all([
    variantCount("verified"),
    variantCount("serving", sites),
    variantCount("winner"),
    previewsBuilt(),
    lastEngineAction(),
  ]);

  return {
    awaitingApproval,
    measuringNow,
    provenWinners,
    previewsBuilt: previews,
    lastEngineActionAt: lastAction,
  };
}
