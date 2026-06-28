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

export interface DashboardResponse {
  site: string;
  sites: SiteRef[];
  dbAvailable: boolean;
  generatedAt: string;
  metrics: DashboardMetrics;
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
        .select("slug,name,domain")
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

      const sites = (siteRows ?? []).length ? (siteRows as SiteRef[]) : FALLBACK_SITES;

      return { site, sites, dbAvailable: true, generatedAt, metrics: aggregate(events, inventory) };
    } catch (err) {
      console.warn(`[angel] dashboard data unavailable:`, err);
      return {
        site,
        sites: FALLBACK_SITES,
        dbAvailable: false,
        generatedAt,
        metrics: aggregate([], []),
      };
    }
  });
