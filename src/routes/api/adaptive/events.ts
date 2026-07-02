// POST /api/adaptive/events
//
// Analytics ingest (blueprint Step 8). The snippet posts a batch of events
// (pageview, adaptation_shown, cta_click, scroll_depth, conversion). We persist
// them best-effort and always answer 204 quickly — losing an analytics beacon
// must never break a customer's page. Accepts navigator.sendBeacon payloads.

import { createFileRoute } from "@tanstack/react-router";

import { logEvents, siteWriteAllowed } from "@/adaptive/persistence.server";
import type { AngelEvent } from "@/adaptive/types";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

interface EventBatch {
  site: string;
  visitorHash?: string;
  key?: string;
  events: AngelEvent[];
}

const VALID_TYPES = new Set([
  "pageview",
  "adaptation_shown",
  "adaptation_withheld",
  "cta_click",
  "scroll_depth",
  "conversion",
]);

export const Route = createFileRoute("/api/adaptive/events")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        let batch: EventBatch;
        try {
          batch = (await request.json()) as EventBatch;
        } catch {
          // sendBeacon may send text — accept gracefully, ack anyway.
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const site = batch?.site;
        const events = Array.isArray(batch?.events)
          ? batch.events.filter((e) => e && VALID_TYPES.has(e.type)).slice(0, 100)
          : [];

        // Reject writes for a keyed site that doesn't present the matching key.
        // Still answer 204 (never leak which slugs are keyed, never break beacons).
        if (site && events.length > 0 && (await siteWriteAllowed(site, batch.key))) {
          await logEvents(site, batch.visitorHash ?? null, events);
        }

        return new Response(null, { status: 204, headers: CORS_HEADERS });
      },
    },
  },
});
