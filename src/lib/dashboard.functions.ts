// Auth-gated dashboard data. Every function runs as the logged-in user via the
// `requireSupabaseAuth` middleware, so `context.supabase` is RLS-scoped (anon key
// + the user's JWT) — it sees only the user's own sites/sessions. No service-role
// key is involved. The dashboard reads session dimensions directly for M1; the
// events_rollup path (scale + section-level insight) lands in M2.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface DashboardSite {
  id: string;
  domain: string;
  public_site_key: string;
  phase: string;
  created_at: string;
}

export interface SiteAnalytics {
  totals: { sessions: number; visitors: number };
  byDay: { date: string; sessions: number }[];
  bySource: { name: string; value: number }[];
  byDevice: { name: string; value: number }[];
  byCountry: { name: string; value: number }[];
  recent: {
    id: string;
    startedAt: string;
    source: string;
    device: string;
    country: string;
    scrollPct: number | null;
    durationMs: number | null;
    entryUrl: string | null;
  }[];
}

const SITE_COLS = "id, domain, public_site_key, phase, created_at";

function normalizeDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

function newSiteKey(): string {
  return "as_" + crypto.randomUUID().replace(/-/g, "");
}

export const listSites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardSite[]> => {
    const { data, error } = await context.supabase
      .from("sites")
      .select(SITE_COLS)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { domain: string }) =>
    z.object({ domain: z.string().min(1).max(255) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<DashboardSite> => {
    const domain = normalizeDomain(data.domain);
    if (!domain) throw new Error("Please enter a valid domain.");

    const { data: site, error } = await context.supabase
      .from("sites")
      .insert({
        owner_user_id: context.userId,
        domain,
        public_site_key: newSiteKey(),
      })
      .select(SITE_COLS)
      .single();
    if (error) throw new Error(error.message);
    return site;
  });

// Flip a site's phase. The gate that matters: only `adaptive` makes /api/plan serve
// live plans; `learn`/`intelligence` keep the site observe-only. RLS (sites_update_own)
// guarantees an owner can only change their own site.
export const setSitePhase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { siteId: string; phase: "learn" | "intelligence" | "adaptive" }) =>
    z
      .object({
        siteId: z.string().uuid(),
        phase: z.enum(["learn", "intelligence", "adaptive"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<DashboardSite> => {
    const { data: site, error } = await context.supabase
      .from("sites")
      .update({ phase: data.phase, updated_at: new Date().toISOString() })
      .eq("id", data.siteId)
      .select(SITE_COLS)
      .single();
    if (error) throw new Error(error.message);
    return site;
  });

export const getSiteAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { siteId: string; days?: number }) =>
    z
      .object({ siteId: z.string().uuid(), days: z.number().int().min(1).max(90).optional() })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<SiteAnalytics> => {
    const days = data.days ?? 7;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    // RLS confines this to sessions of sites the user owns; the eq() narrows to one.
    const { data: rows, error } = await context.supabase
      .from("sessions")
      .select(
        "id, started_at, source, device, geo, visitor_id, max_scroll_pct, duration_ms, entry_url",
      )
      .eq("site_id", data.siteId)
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    return aggregate(rows ?? [], days);
  });

type SessionRowLite = {
  id: string;
  started_at: string;
  source: string | null;
  device: unknown;
  geo: unknown;
  visitor_id: string;
  max_scroll_pct: number | null;
  duration_ms: number | null;
  entry_url: string | null;
};

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topN(map: Map<string, number>, n = 8): { name: string; value: number }[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, value]) => ({ name, value }));
}

function aggregate(rows: SessionRowLite[], days: number): SiteAnalytics {
  const dayCounts = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    dayCounts.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), 0);
  }

  const bySource = new Map<string, number>();
  const byDevice = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const visitors = new Set<string>();

  for (const r of rows) {
    visitors.add(r.visitor_id);
    const day = r.started_at.slice(0, 10);
    if (dayCounts.has(day)) bump(dayCounts, day);
    bump(bySource, r.source ?? "direct");
    bump(byDevice, (r.device as { type?: string } | null)?.type ?? "unknown");
    bump(byCountry, (r.geo as { country?: string } | null)?.country ?? "—");
  }

  return {
    totals: { sessions: rows.length, visitors: visitors.size },
    byDay: [...dayCounts.entries()].map(([date, sessions]) => ({ date, sessions })),
    bySource: topN(bySource),
    byDevice: topN(byDevice),
    byCountry: topN(byCountry, 6),
    recent: rows.slice(0, 20).map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      source: r.source ?? "direct",
      device: (r.device as { type?: string } | null)?.type ?? "—",
      country: (r.geo as { country?: string } | null)?.country ?? "—",
      scrollPct: r.max_scroll_pct,
      durationMs: r.duration_ms,
      entryUrl: r.entry_url,
    })),
  };
}
