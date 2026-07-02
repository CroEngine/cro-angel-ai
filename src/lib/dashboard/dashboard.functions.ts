// Angel Adaptive — dashboard data (server function).
//
// getDashboard reads angel_sites / angel_events / angel_content_inventory via
// the service-role admin client (RLS is locked down, so reads are server-side),
// then runs the pure aggregator. It is resilient: if the service-role key or the
// tables are unavailable, it returns an empty, dbAvailable:false envelope so the
// UI renders a clean empty state instead of erroring.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { aggregate, type DashboardMetrics, type DashEvent, type InventoryEntry } from "./aggregate";

export interface SiteRef {
  slug: string;
  name: string | null;
  domain: string | null;
}

export type ConsentMode = "anonymous" | "attested";

export interface DashboardResponse {
  site: string;
  sites: SiteRef[];
  dbAvailable: boolean;
  generatedAt: string;
  metrics: DashboardMetrics;
  /** The selected site's consent mode (owner attestation). Defaults to
   *  'anonymous' when the site/store is unavailable. */
  consentMode: ConsentMode;
}

// Seeded baseline — shown in the site picker when the DB can't be reached
// (e.g. local dev without a service-role key).
const FALLBACK_SITES: SiteRef[] = [
  { slug: "demo", name: "Demo", domain: null },
  { slug: "hubspot", name: "HubSpot", domain: "hubspot.com" },
];

const EVENT_LIMIT = 5000;

export const getDashboard = createServerFn({ method: "POST" })
  .inputValidator(z.object({ site: z.string().min(1).default("demo") }))
  .handler(async ({ data }): Promise<DashboardResponse> => {
    const { site } = data;
    const generatedAt = new Date().toISOString();

    // Imported inside the handler so the service-role client never reaches the
    // client bundle.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    try {
      const { data: siteRows } = await supabaseAdmin
        .from("angel_sites")
        .select("slug,name,domain,consent_mode")
        .order("slug");

      const { data: eventRows } = await supabaseAdmin
        .from("angel_events")
        .select("type,payload,visitor_hash,decision_id,created_at")
        .eq("site", site)
        .order("created_at", { ascending: false })
        .limit(EVENT_LIMIT);

      const { data: invRows } = await supabaseAdmin
        .from("angel_content_inventory")
        .select("slot,item_id,text,selector,meta")
        .eq("site_slug", site);

      const events: DashEvent[] = (eventRows ?? []).map((r) => ({
        type: r.type,
        payload: (r.payload as Record<string, unknown>) ?? {},
        visitorHash: r.visitor_hash,
        decisionId: r.decision_id,
        createdAt: r.created_at,
      }));

      const inventory: InventoryEntry[] = (invRows ?? []).map((r) => ({
        slot: r.slot,
        id: r.item_id,
        text: r.text,
        selector: r.selector,
        meta: (r.meta as Record<string, string> | null) ?? {},
      }));

      const rows = siteRows ?? [];
      const sites = rows.length ? (rows as SiteRef[]) : FALLBACK_SITES;
      const current = rows.find(
        (r: { slug: string; consent_mode?: string }) => r.slug === site,
      ) as { consent_mode?: string } | undefined;
      const consentMode: ConsentMode = current?.consent_mode === "attested" ? "attested" : "anonymous";

      return {
        site,
        sites,
        dbAvailable: true,
        generatedAt,
        metrics: aggregate(events, inventory),
        consentMode,
      };
    } catch (err) {
      console.warn(`[angel] dashboard data unavailable:`, err);
      return {
        site,
        sites: FALLBACK_SITES,
        dbAvailable: false,
        generatedAt,
        metrics: aggregate([], []),
        consentMode: "anonymous",
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
  .inputValidator(
    z.object({
      site: z.string().min(1),
      mode: z.enum(["anonymous", "attested"]),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; mode: ConsentMode }> => {
    const { site, mode } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Ensure the row exists (a site may not be registered until its snippet
    // first runs), then set the mode. Upsert on the unique slug.
    const { error } = await supabaseAdmin
      .from("angel_sites")
      .upsert({ slug: site, consent_mode: mode }, { onConflict: "slug" });
    if (error) {
      console.warn(`[angel] setConsentMode failed: ${error.message}`);
      return { ok: false, mode };
    }
    return { ok: true, mode };
  });
