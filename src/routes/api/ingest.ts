// POST /api/ingest — the public, unauthenticated, CORS-open endpoint the snippet
// beacons visitor events to. Mirrors the route idiom in
// src/routes/api/public/corpus.$.ts (CORS headers + OPTIONS 204). Authenticates by
// public_site_key + origin allow-list, never by user auth. Kept cheap and
// non-blocking; all heavy aggregation happens later in the rollup, not here.

import { createFileRoute } from "@tanstack/react-router";

import type { RequestGeo } from "@/lib/ingest/event-sink";
import { ingestBatch, IngestError } from "@/lib/ingest/ingest.server";
import { SupabaseEventSink } from "@/lib/ingest/supabase-sink.server";
import { IngestBatchSchema } from "@/snippet/contract";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Origin",
  "Access-Control-Max-Age": "86400",
};

const sink = new SupabaseEventSink();

export const Route = createFileRoute("/api/ingest")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        // sendBeacon sends text/plain; read raw and parse, then validate.
        let batch;
        try {
          batch = IngestBatchSchema.parse(JSON.parse(await request.text()));
        } catch {
          return new Response("bad request", { status: 400, headers: CORS_HEADERS });
        }

        // Geo is derived server-side from the edge request (the snippet sends no IP).
        const cf = (request as unknown as { cf?: RequestGeo }).cf;
        const geo: RequestGeo = {
          country: cf?.country ?? request.headers.get("cf-ipcountry") ?? undefined,
          region: cf?.region,
          city: cf?.city,
        };

        try {
          await ingestBatch(batch, geo, request.headers.get("origin"), sink);
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        } catch (err) {
          const status = err instanceof IngestError ? err.status : 500;
          return new Response(null, { status, headers: CORS_HEADERS });
        }
      },
    },
  },
});
