// POST /api/adaptive/events
//
// Analytics ingest (blueprint Step 8). The snippet posts a batch of events
// (pageview, adaptation_shown, cta_click, scroll_depth, conversion, page_perf).
// We persist them best-effort and always answer 204 quickly — losing an
// analytics beacon must never break a customer's page. Accepts
// navigator.sendBeacon payloads.

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
  /** Anonymt per-flik-id som binder samman resan (journey intelligence). */
  sessionId?: string;
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
  // Observe-only: fältmätt prestanda (CWV + navigation-timing), en gång per
  // sidladdning. Diagnos, aldrig behandling.
  "page_perf",
  // Observe-only: strukturell diagnos (formulär/nav/pris) — skrivs server-side
  // av inventory-endpointen, inte av snippeten, men vitlistas här för symmetri.
  "page_structure",
  // Journey intelligence (docs/journey-intelligence.md): anonym beteenderesa.
  // element_click bär klickORDNINGEN (intent-signalen); form-lifecyclen visar
  // drop-off; page_leave bär aktiv tid + exit. Aldrig fältvärden.
  "element_click",
  "form_start",
  "form_submit",
  "form_abandon",
  "page_leave",
  // Rage-click (croengine-vision.md): ≥3 snabba klick på samma ref = frustrations-
  // signal. Diagnostik — driver aldrig en automatisk ändring.
  "rage_click",
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
          await logEvents(site, batch.visitorHash ?? null, events, batch.sessionId ?? null);
        }

        return new Response(null, { status: 204, headers: CORS_HEADERS });
      },
    },
  },
});
