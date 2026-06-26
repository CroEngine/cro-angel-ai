// GET /api/plan — the public, CORS-open endpoint the snippet calls to ask "what
// should I do for this visitor?". Mirrors the route idiom in api/ingest.ts (CORS
// headers + OPTIONS 204). Returns a PlanResponse: the served AdaptationPlan plus
// the inventory content it references, resolved server-side.
//
// The decision engine (segment behavior → plan) lands here in a later slice. Until
// then this serves a noop — the snippet's apply-path is live and exercised on every
// page load, and the customer's page stays exactly as it loaded.

import { createFileRoute } from "@tanstack/react-router";

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
      GET: async () => {
        const body: PlanResponse = { plan: null, content: {} };
        return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
      },
    },
  },
});
