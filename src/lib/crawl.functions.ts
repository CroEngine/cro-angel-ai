// Auth-gated Content Inventory functions. `startCrawl` kicks the offline crawler
// (fire-and-forget, mirroring run.functions.ts); `getInventory` reads the indexed
// content + latest crawl status (RLS-scoped to the owner's site). The crawler
// itself is dynamically imported so its Browserbase chain never loads at init.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface CrawlRunStatus {
  id: string;
  status: string;
  pagesCrawled: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface InventoryItem {
  id: string;
  category: string;
  selector: string;
  text: string | null;
  sectionKind: string | null;
  aboveFold: boolean | null;
  url: string;
}

export interface InventorySummary {
  total: number;
  byCategory: { category: string; count: number }[];
  latestCrawl: CrawlRunStatus | null;
  items: InventoryItem[];
}

export const startCrawl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { siteId: string }) => z.object({ siteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ crawlRunId: string }> => {
    const { data: site, error: siteErr } = await context.supabase
      .from("sites")
      .select("id, domain")
      .eq("id", data.siteId)
      .maybeSingle();
    if (siteErr) throw new Error(siteErr.message);
    if (!site) throw new Error("Site not found.");

    const { data: run, error: runErr } = await context.supabase
      .from("crawl_runs")
      .insert({ site_id: site.id, status: "running" })
      .select("id")
      .single();
    if (runErr || !run) throw new Error(runErr?.message ?? "Could not start crawl.");

    // Kick the crawl in the background; the dynamic import keeps the Browserbase
    // chain out of this module's graph.
    const startUrl = `https://${site.domain}/`;
    const { runCrawl } = await import("@/lib/crawl/crawler.server");
    void runCrawl({ siteId: site.id, crawlRunId: run.id, urls: [startUrl] });

    return { crawlRunId: run.id };
  });

export const getInventory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { siteId: string }) => z.object({ siteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InventorySummary> => {
    const [items, crawl] = await Promise.all([
      context.supabase
        .from("content_inventory")
        .select("id, category, selector, text, section_kind, above_fold, url")
        .eq("site_id", data.siteId)
        .order("category", { ascending: true })
        .limit(1000),
      context.supabase
        .from("crawl_runs")
        .select("id, status, pages_crawled, error, started_at, finished_at")
        .eq("site_id", data.siteId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (items.error) throw new Error(items.error.message);

    const list = items.data ?? [];
    const counts = new Map<string, number>();
    for (const r of list) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    const c = crawl.data;

    return {
      total: list.length,
      byCategory: [...counts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      latestCrawl: c
        ? {
            id: c.id,
            status: c.status,
            pagesCrawled: c.pages_crawled,
            error: c.error,
            startedAt: c.started_at,
            finishedAt: c.finished_at,
          }
        : null,
      items: list.map((r) => ({
        id: r.id,
        category: r.category,
        selector: r.selector,
        text: r.text,
        sectionKind: r.section_kind,
        aboveFold: r.above_fold,
        url: r.url,
      })),
    };
  });
