// Sajtskapandets ENDA kärna (granskningsfynd 2026-08-19: performActivation
// duplicerade createSites regler med bara korskommentarer som synk — en
// framtida regeländring som missar spegeln forkar säkerhetssemantiken).
// Båda vägarna — dashboardens formulär och demo-aktiveringen — går nu genom
// samma steg:
//
//   1. Domän-unikhet över alla sajter. Med adoptOwnDomain (aktiveringsvägen):
//      pekar domänen på en slug ANROPAREN redan äger adopteras den sluggen i
//      stället för att vägras — "din egen domän är din egen sajt".
//   2. Slug ägd av annan användare vägras (admin får adoptera — pilotmönstret).
//   3. Create-if-absent med färsk nyckel; en befintlig rad behåller sin nyckel
//      orörd (en nyklad rad 403:ar en live-install). Nya sajter startar med
//      billing_status 'none' (serving kräver prenumeration; observation är
//      alltid fri) och consent-by-default ANONYMOUS (DB-defaulten — ingen
//      persistent besökar-id, inga beteendeevent) per docs/consent-gate.md:
//      ägaren attesterar i dashboarden/välkomstskärmen när rättslig grund
//      finns.
//   4. Idempotent ägarskap (medlemsraden).

export const genKey = (): string => "ak_" + globalThis.crypto.randomUUID().replace(/-/g, "");

export interface EnsureSiteInput {
  slug: string;
  name: string | null;
  /** Normaliserad ("exempel.se") eller null — anroparen validerar/härleder. */
  domain: string | null;
  /** Trattens härkomst: 'manual' | 'preview:<jobId>'. */
  createdFrom: string;
  /** Aktiveringsvägen: adoptera anroparens EGEN befintliga sajt när domänen
   *  redan pekar på den (i stället för domain_taken). Dashboardens formulär
   *  behåller vägran — användaren bad uttryckligen om en viss slug. */
  adoptOwnDomain?: boolean;
}

export interface EnsureSiteResult {
  ok: boolean;
  reason?: "domain_taken" | "taken" | "error";
  slug?: string;
  ingestKey?: string | null;
}

export async function ensureSiteWithOwner(
  user: { userId: string; isAdmin: boolean },
  input: EnsureSiteInput,
): Promise<EnsureSiteResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let slug = input.slug;

  // 1. Domänen är unik över alla sajter.
  if (input.domain) {
    const { data: takenBy } = await supabaseAdmin
      .from("angel_sites")
      .select("slug")
      .ilike("domain", input.domain)
      .neq("slug", slug)
      .maybeSingle();
    const takenSlug = (takenBy as { slug?: string } | null)?.slug;
    if (takenSlug) {
      if (!input.adoptOwnDomain) return { ok: false, reason: "domain_taken" };
      const { data: rows } = await supabaseAdmin
        .from("angel_site_members")
        .select("user_id")
        .eq("site_slug", takenSlug);
      const owners = ((rows ?? []) as { user_id: string }[]).map((m) => m.user_id);
      const mine = owners.includes(user.userId) || (user.isAdmin && owners.length > 0);
      if (!mine) return { ok: false, reason: "domain_taken" };
      slug = takenSlug;
    }
  }

  // 2. En slug ägd av NÅGON ANNAN vägras. Hela listan läses — en sajt kan ha
  //    flera medlemmar.
  const { data: members } = await supabaseAdmin
    .from("angel_site_members")
    .select("user_id")
    .eq("site_slug", slug);
  const ownedByOther = ((members ?? []) as { user_id: string }[]).some(
    (m) => m.user_id !== user.userId,
  );
  if (ownedByOther && !user.isAdmin) return { ok: false, reason: "taken" };

  // 3. Create-if-absent; befintlig rad behåller nyckeln (att nykla här hade
  //    tyst 403:at varje anrop från en körande install — nyckelbyte är en
  //    explicit, lösenordsgrindad handling i Settings).
  const { data: existing } = await supabaseAdmin
    .from("angel_sites")
    .select("ingest_key")
    .eq("slug", slug)
    .maybeSingle();
  let key = (existing as { ingest_key?: string | null } | null)?.ingest_key ?? null;
  if (!existing) {
    key = genKey();
    const { error } = await supabaseAdmin.from("angel_sites").insert({
      slug,
      name: input.name,
      domain: input.domain,
      billing_status: "none",
      ingest_key: key,
      created_from: input.createdFrom,
    });
    if (error) {
      console.warn(`[angel] ensureSiteWithOwner insert failed: ${error.message}`);
      return { ok: false, reason: "error" };
    }
  }

  // 4. Idempotent ägarskap.
  const { error: memErr } = await supabaseAdmin
    .from("angel_site_members")
    .upsert({ user_id: user.userId, site_slug: slug }, { onConflict: "user_id,site_slug" });
  if (memErr) {
    console.warn(`[angel] ensureSiteWithOwner membership failed: ${memErr.message}`);
    return { ok: false, reason: "error" };
  }

  return { ok: true, slug, ingestKey: key };
}
