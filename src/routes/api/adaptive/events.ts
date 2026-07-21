// POST /api/adaptive/events
//
// Analytics ingest (blueprint Step 8). The snippet posts a batch of the events
// whitelisted in VALID_TYPES below — the anonymous journey (element_click,
// form lifecycle, page_leave), diagnostics (rage_click), performance (page_perf)
// and conversions. Exposure (adaptation_shown/withheld) is written authoritatively
// server-side by logDecision, not by the snippet. We persist best-effort and
// always answer 204 quickly — losing an analytics beacon must never break a
// customer's page. Accepts navigator.sendBeacon payloads.

import { createFileRoute } from "@tanstack/react-router";

import { isBotUserAgent } from "@/adaptive/bot";
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
  // Sajtsök (ägarbeslut 2026-07-19, dokumenterat undantag på integritetssidan):
  // enbart SKICKADE söktermer från dedikerade sökfält — aldrig tangenttryckningar,
  // aldrig andra formulärfält. Termen cleanText-skrubbas i buildEventRows.
  "site_search",
  // Videotittande (ägarbeslut 2026-07-19, berättelse-tidslinjen): en summerad
  // "tittade N ms"-signal per video och sidväg — aldrig innehåll eller position.
  "video_watch",
]);

export const Route = createFileRoute("/api/adaptive/events")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        // Auktoritativ bot-exkludering: batchar från bot/crawler/automations-UA
        // släpps TYST (204, aldrig persistens) — även när klient-gaten i
        // snippeten missats. En bots events skulle förorena segmenten och skeva
        // A/B-armarna när servering är på.
        if (isBotUserAgent(request.headers.get("user-agent"))) {
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
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

        // Reject writes for a keyed site without matching key, eller en
        // domän-registrerad sajt vars Origin motsäger domänen (nyckeln står i
        // publika HTML:en — Origin är beviset). Svara ändå 204 (läck aldrig
        // vilka sluggar som är skyddade, bryt aldrig beacons).
        if (
          site &&
          events.length > 0 &&
          (await siteWriteAllowed(site, batch.key, {
            origin: request.headers.get("origin"),
            referer: request.headers.get("referer"),
          }))
        ) {
          await logEvents(site, batch.visitorHash ?? null, events, batch.sessionId ?? null);
        }

        return new Response(null, { status: 204, headers: CORS_HEADERS });
      },
    },
  },
});
