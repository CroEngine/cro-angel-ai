// Notiser (block 1c) — loopen stannar när något väntar på ägarens knapp och
// ägaren inte tittar. Få händelser, få mejl — varje mejl ska bära något:
//
//   installed        — snippetens första domän-bevisade signal (dag 0-kvittot)
//   week_one_digest  — ETT ärligt läges-mejl ~dag 5 när ingen variant ännu
//                      finns (stanna-tills-bevisat: insamlingen ska synas)
//   variant_ready    — en verifierad variant väntar på godkännande (dag ~10)
//   variant_held     — maskinell paus, ingen åtgärd krävs (självläkningen)
//   test_result      — mätningen har något att säga
//
// Kontrakt:
//   * Idempotent per (site, kind, dedupe_key, email) — unik-nyckeln i
//     angel_notifications ÄR spärren; en trigger som råkar köra tio gånger
//     skickar ändå ett mejl.
//   * Provider-agnostisk: RESEND_API_KEY + NOTIFY_FROM satta → Resend;
//     annars log-läge (raden skrivs ändå, channel='log') så flödet kan byggas
//     och testas innan avsändardomänen finns.
//   * Best-effort: får ALDRIG blockera eller fälla anropsvägen (ingest).

import { supabaseAdmin } from "@/integrations/supabase/client.server";

import type { Json } from "@/integrations/supabase/types";

/** Appens publika bas-URL — EN inställning vid domänbyte (APP_ORIGIN i
 *  Netlify-miljön), aldrig hårdkodade länkar i mejlen. */
const APP_ORIGIN = (process.env.APP_ORIGIN ?? "https://croengine.netlify.app").replace(/\/$/, "");

export type NotificationKind =
  "installed" | "variant_ready" | "test_result" | "variant_held" | "week_one_digest";

/** Ägarnas e-postadresser för en sajt (medlemmar → auth-användare). */
async function ownerEmails(site: string): Promise<string[]> {
  const { data: members, error } = await supabaseAdmin
    .from("angel_site_members")
    .select("user_id")
    .eq("site_slug", site);
  if (error || !members?.length) return [];
  const emails: string[] = [];
  for (const m of members as { user_id: string }[]) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
      const email = data?.user?.email;
      if (email) emails.push(email);
    } catch {
      /* en trasig medlem stoppar inte de andra */
    }
  }
  return [...new Set(emails)];
}

async function deliver(to: string, subject: string, text: string): Promise<"resend" | "log"> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM; // t.ex. "CROENGINE <notiser@croengine.se>"
  if (!key || !from) {
    console.log(`[angel notify:log] till=${to} ämne="${subject}"`);
    return "log";
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}`);
  return "resend";
}

/**
 * Skicka en notis till sajtens ägare. Idempotent via dedupe_key; best-effort.
 * Returnerar antal faktiskt skickade (0 = redan skickad eller inga ägare).
 */
export async function notifyOwners(
  site: string,
  kind: NotificationKind,
  dedupeKey: string,
  subject: string,
  text: string,
  payload: Json = {},
): Promise<number> {
  try {
    const emails = await ownerEmails(site);
    let sent = 0;
    for (const email of emails) {
      // Reservera dedupe-raden FÖRST — vinner insert:en är mejlet vårt att
      // skicka; förlorar vi (unik-krock) har någon annan körning redan tagit det.
      const { error } = await supabaseAdmin
        .from("angel_notifications")
        .insert({ site, kind, dedupe_key: dedupeKey, email, channel: "pending", payload });
      if (error) continue; // 23505 = redan skickad — exakt vad spärren är till för
      try {
        const channel = await deliver(email, subject, text);
        await supabaseAdmin
          .from("angel_notifications")
          .update({ channel })
          .eq("site", site)
          .eq("kind", kind)
          .eq("dedupe_key", dedupeKey)
          .eq("email", email);
        sent++;
      } catch (err) {
        // Leveransen föll — släpp reservationen så nästa körning försöker igen.
        console.warn(`[angel notify] leverans föll (${kind} → ${email}):`, err);
        await supabaseAdmin
          .from("angel_notifications")
          .delete()
          .eq("site", site)
          .eq("kind", kind)
          .eq("dedupe_key", dedupeKey)
          .eq("email", email);
      }
    }
    return sent;
  } catch (err) {
    console.warn(`[angel notify] otillgänglig (${kind}):`, err);
    return 0;
  }
}

/** Dag 0: domänen bevisad — installationen fungerar, data rullar in. */
export function notifyInstalled(site: string, domain: string): Promise<number> {
  return notifyOwners(
    site,
    "installed",
    domain,
    `Installation confirmed — ${domain} is sending data`,
    [
      `Hi!`,
      ``,
      `Your snippet on ${domain} has sent its first signal and the domain is verified.`,
      `Data is now being collected — nothing changes for your visitors until you approve it yourself.`,
      ``,
      `Sign in to the dashboard to confirm your conversion goal (2 minutes):`,
      `${APP_ORIGIN}/dashboard`,
      ``,
      `— CROENGINE`,
    ].join("\n"),
    { domain },
  );
}

/** Dag ~10: en verifierad variant väntar på ägarens knapp — affärens viktigaste mejl. */
export function notifyVariantReady(
  site: string,
  variantId: string,
  label: string,
): Promise<number> {
  return notifyOwners(
    site,
    "variant_ready",
    variantId,
    `An improvement to your page is ready to review`,
    [
      `Hi!`,
      ``,
      `The system has generated and verified a variant of your page (${label}).`,
      `It passed every check — but no visitor sees it until you approve.`,
      ``,
      `Review the before/after and approve with one click (2 minutes):`,
      `${APP_ORIGIN}/dashboard`,
      ``,
      `On the free-until-proven plan, your subscription starts 7 days after`,
      `your first verified variant — this is that moment. Cancel anytime.`,
      ``,
      `— CROENGINE`,
    ].join("\n"),
    { variantId, label },
  );
}

/** Självläkningen (korssid-lyftet slice 3): ett insatt citats källtext ändrades
 *  — varianten är maskinellt pausad tills nya texten passerat grindarna igen.
 *  Ägaren informeras men behöver inte göra något (ägarbeslut 2026-07-18).
 *  Dedupe per (variant, hold-ögonblick) så en NY prisändring ger ett nytt mejl
 *  men samma pågående hold aldrig spammar. */
export function notifyVariantHeld(
  site: string,
  variantId: string,
  label: string,
  reason: string,
  heldAtIso: string,
): Promise<number> {
  return notifyOwners(
    site,
    "variant_held",
    `${variantId}:${heldAtIso}`,
    `We paused one of your page variants — no action needed`,
    [
      `Hi!`,
      ``,
      `The source content behind one of your page variants changed`,
      `(${label}), so we paused it automatically rather than show`,
      `outdated information: ${reason}`,
      ``,
      `The system will re-verify the updated content and resume the`,
      `variant on its own — you don't need to do anything.`,
      ``,
      `You can review it any time: ${APP_ORIGIN}/dashboard`,
      ``,
      `— CROENGINE`,
    ].join("\n"),
    { variantId, label, reason },
  );
}

/** Vecka-1-digesten (stanna-tills-bevisat, ägarmodellen 2026-07-23): mellan
 *  installationen och första varianten är dashboarden annars tyst — där bor
 *  churnen. ETT mejl, ~5 dygn efter första signalen, som visar att insamlingen
 *  ARBETAR (ärliga räknare, aldrig löften) och pekar mot resan i dashboarden.
 *  Dedupe per sajt (notifyOwners) — kan svepas hur ofta som helst, skickas en
 *  gång. Skickas ALDRIG när en variant redan finns (då äger dag-10-mejlet
 *  berättelsen — avsändarens ansvar att kolla, se nightly steg 7b). */
export function notifyWeekOneDigest(
  site: string,
  stats: { visitors: number; pageviews: number; topGroup: string | null },
): Promise<number> {
  return notifyOwners(
    site,
    "week_one_digest",
    "week-one",
    `Week one: Angel is measuring — here's what it sees so far`,
    [
      `Hi!`,
      ``,
      `A quick honest status from your first week:`,
      ``,
      `  · ${stats.visitors.toLocaleString("en-US")} distinct visitors profiled (${stats.pageviews.toLocaleString("en-US")} pageviews)`,
      ...(stats.topGroup
        ? [`  · Largest visitor group so far: ${stats.topGroup}`]
        : [`  · Visitor groups are still forming — they build as traffic arrives`]),
      ``,
      `Nothing on your page has changed, and nothing will without your click.`,
      `A group of visitors earns its own design once it carries enough data to`,
      `measure honestly — no shortcuts: designs are earned by data, not guessed.`,
      ``,
      `Follow the road to proven live on your dashboard:`,
      `${APP_ORIGIN}/dashboard`,
      ``,
      `— CROENGINE`,
    ].join("\n"),
    stats,
  );
}

/**
 * Svep: hitta verifierade varianter som väntar på godkännande utan att någon
 * notis skickats, och skicka. Körs best-effort från inventeringens ingest
 * (≈ dagligt hjärtslag per sajt) tills den schemalagda loopen (block 5) tar
 * över. Idempotensen bor i notifyOwners — svepet kan köras hur ofta som helst.
 */
export async function sweepVariantNotifications(site: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("angel_variants")
      .select("id,segment_key,path,status")
      .eq("site", site)
      .eq("status", "verified");
    if (error || !data?.length) return;
    for (const v of data as { id: string; segment_key: string; path: string }[]) {
      await notifyVariantReady(site, v.id, `${v.path} · ${v.segment_key}`);
    }
  } catch (err) {
    console.warn(`[angel notify] svep otillgängligt:`, err);
  }
}
