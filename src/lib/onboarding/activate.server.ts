// Aktiveringens kärna: demo-jobb → sajt. Härleder domän/slug/namn ur jobbets
// URL (inget frågas om igen) och lämnar själva sajtskapandet till den DELADE
// kärnan ensureSiteWithOwner (src/lib/sites/ensure-site.server.ts) — samma
// regler som dashboardens formulär, så de två vägarna aldrig kan forka
// (granskningsfynd 2026-08-19). Aktiveringsvägen adopterar anroparens EGEN
// befintliga sajt när domänen redan pekar på den.
// Testas via husets mock-söm (vi.mock av client.server).

import { ensureSiteWithOwner } from "../sites/ensure-site.server";
import { deriveActivation } from "./derive";

export interface ActivationResult {
  ok: boolean;
  reason?: "job_not_found" | "bad_domain" | "domain_taken" | "taken" | "error";
  slug?: string;
  domain?: string;
  name?: string;
  ingestKey?: string | null;
}

export async function performActivation(
  user: { userId: string; isAdmin: boolean },
  jobId: string,
): Promise<ActivationResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Jobbet bär URL:en — status kvittar (även ett misslyckat exempel pekar på
  // en verklig sajt prospektet äger frågan om).
  const { data: job } = await supabaseAdmin
    .from("angel_preview_jobs")
    .select("url")
    .eq("id", jobId)
    .maybeSingle();
  const url = (job as { url?: string } | null)?.url;
  if (!url) return { ok: false, reason: "job_not_found" };

  const derived = deriveActivation(url);
  if (!derived) return { ok: false, reason: "bad_domain" };

  const r = await ensureSiteWithOwner(user, {
    slug: derived.slug,
    name: derived.name,
    domain: derived.domain,
    createdFrom: `preview:${jobId}`,
    adoptOwnDomain: true,
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  return {
    ok: true,
    slug: r.slug,
    domain: derived.domain,
    name: derived.name,
    ingestKey: r.ingestKey,
  };
}
