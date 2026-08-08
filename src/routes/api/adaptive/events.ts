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

// Server-skrivna typer (adaptation_shown/withheld via logDecision,
// page_structure via inventory-endpointen) togs UR klient-whitelisten
// (granskningsfynd 2026-07-28): window.AngelAdaptive.track är publikt och
// decisionId valideras inte — fabricerade exponeringsrader kunde skeva
// A/B-armarna som vinnarutvärderingen läser. Symmetri är inte ett skäl
// att öppna en förgiftningsdörr.
const VALID_TYPES = new Set([
  "pageview",
  "cta_click",
  "scroll_depth",
  "conversion",
  // Observe-only: fältmätt prestanda (CWV + navigation-timing), en gång per
  // sidladdning. Diagnos, aldrig behandling.
  "page_perf",
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
  // Per-sektion-synlighet (steg 9, CRO-planen): EN händelse per sidladdning
  // med {sections: [{h: rubrik, n: instanser, d: sedd-ms}]} — datat
  // beteende-rankningen (steg 7-8) står på. Opt-in per install
  // (data-observe-sections). Rubriker är sidans egen publika copy; payloaden
  // saneras + cappas hårt i buildEventRows.
  "section_engagement",
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
        // Payload-tak (granskningsfynd 2026-07-28): antalet events kappades
        // till 100 men inte BYTES — jsonb-lagringen kunde förgiftas med
        // godtyckligt stora rader. 128 kB rymmer varje legitim batch med
        // bred marginal; större släpps tyst (204 — bryt aldrig beacons).
        const rawBody = await request.text();
        if (rawBody.length > 128 * 1024) {
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        let batch: EventBatch;
        try {
          batch = JSON.parse(rawBody) as EventBatch;
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
