// GET /api/plan — the public, CORS-open endpoint the snippet calls to ask "what
// should I do for this visitor?". Mirrors the route idiom in api/ingest.ts (CORS
// headers + OPTIONS 204). Returns a PlanResponse: the served AdaptationPlan plus
// the inventory content it references, resolved server-side.
//
// The decision engine (segment behavior → plan) lands here in a later slice. Until
// then this serves a noop — the snippet's apply-path is live and exercised on every
// page load, and the customer's page stays exactly as it loaded.

import { createFileRoute } from "@tanstack/react-router";

import type { Json } from "@/integrations/supabase/types";
import { buildPlan, type InventoryRow, segmentUuid } from "@/lib/adapt/decision";
import { db } from "@/lib/ingest/db-bridge.server";
import { aggregateSegments, type SessionLite } from "@/lib/segments/aggregate";
import { EXTRACTOR_VERSION } from "@/lib/tests/extractor-version";
import type { PlanResponse } from "@/snippet/contract";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Origin",
  "Access-Control-Max-Age": "86400",
};

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

export const Route = createFileRoute("/api/plan")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const siteKey = url.searchParams.get("site");
        const sessionId = url.searchParams.get("session");
        const noop: PlanResponse = { plan: null, content: {} };
        if (!siteKey) return json(noop);

        // Resolve the site (service role — the snippet is unauthenticated).
        const { data: site } = await db
          .from("sites")
          .select("id")
          .eq("public_site_key", siteKey)
          .maybeSingle();
        if (!site) return json(noop);

        // This visitor's segment = their session's derived source. The session may
        // not exist yet on a first pageview (its first ingest batch hasn't landed) —
        // we fall back to "direct" until then.
        let source = "direct";
        if (sessionId) {
          const { data: s } = await db
            .from("sessions")
            .select("source")
            .eq("id", sessionId)
            .eq("site_id", site.id)
            .maybeSingle();
          if (s?.source) source = s.source;
        }

        // Behavior (for the segment model) + inventory (the universe of safe ops),
        // both scoped to this site. NOTE: this is a compute-on-read path on the
        // visitor's critical path; precomputing per-segment plans into an edge cache
        // is the next optimization (see the latency lane in ARCHITECTURE).
        const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
        const [sessionsRes, invRes] = await Promise.all([
          db
            .from("sessions")
            .select("source, visitor_id, bounced, max_scroll_pct, duration_ms")
            .eq("site_id", site.id)
            .gte("started_at", since)
            .limit(20_000),
          db
            .from("content_inventory")
            .select(
              "id, category, selector, text, section_kind, above_fold, visual_weight, extractor_version, rect",
            )
            .eq("site_id", site.id)
            .limit(2000),
        ]);

        const { baseline, segments } = aggregateSegments((sessionsRes.data ?? []) as SessionLite[]);
        const segment = segments.find((s) => s.source === source);
        const invRows = invRes.data ?? [];
        if (!segment || invRows.length === 0) return json(noop);

        const inventory: InventoryRow[] = invRows.map((r) => ({
          id: r.id,
          category: r.category,
          selector: r.selector,
          text: r.text,
          sectionKind: r.section_kind,
          aboveFold: r.above_fold,
          visualWeight: r.visual_weight,
          top: rectTop(r.rect),
        }));

        const built = buildPlan({
          siteId: site.id,
          segmentId: segmentUuid(site.id, source),
          extractorVersion: invRows[0]?.extractor_version ?? EXTRACTOR_VERSION,
          segment,
          baseline,
          inventory,
        });
        return json(built ? { plan: built.plan, content: built.content } : noop);
      },
    },
  },
});

function json(body: PlanResponse): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

// content_inventory.rect is freeform Json from the extractor; read a numeric top
// for ordering/anchoring, tolerating shape drift.
function rectTop(rect: Json): number | null {
  if (rect && typeof rect === "object" && !Array.isArray(rect)) {
    const r = rect as Record<string, unknown>;
    if (typeof r.top === "number") return r.top;
    if (typeof r.y === "number") return r.y;
  }
  return null;
}
