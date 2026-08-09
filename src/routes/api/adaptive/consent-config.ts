// GET /api/adaptive/consent-config?site=SLUG
//
// The snippet fetches this once on load to learn how the SITE OWNER configured
// their install. Despite the historical name, it carries the full dashboard-set
// site config (the route is kept stable because deployed snippets fetch it):
//
//   mode        — 'attested' means the owner (data controller) confirmed a
//                 lawful basis in the dashboard, so the snippet runs at a
//                 consented baseline. GPC/DNT are honoured client-side
//                 regardless — attestation never overrides a visitor opt-out.
//   holdoutPct  — % of consented visitors held out as measurement control.
//   conversion  — what counts as a conversion (URL substring / CSS selector).
//   observeSections — per-section visibility measurement on/off for the site.
//
// Tag attributes (data-holdout, data-conversion-*) win over these values, as
// explicit per-install overrides. See docs/consent-gate.md.
//
// CORS-open + short-cached: this is non-personal site config, called from the
// customer's own origin by the snippet. Degrades to the anonymous,
// measurement-off default.

import { createFileRoute } from "@tanstack/react-router";

import { loadSiteConfig } from "@/adaptive/persistence.server";
import { originVerdict } from "@/adaptive/domain";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, cache: string) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache,
      ...CORS_HEADERS,
    },
  });

const ANON = {
  mode: "anonymous",
  holdoutPct: 0,
  conversion: { url: null, selector: null, text: null },
  // Mätning är avstängd i den anonyma defaulten — en obevisad origin ska
  // aldrig kunna starta sektionsobservationen.
  observeSections: false,
};

export const Route = createFileRoute("/api/adaptive/consent-config")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async ({ request }) => {
        const site = new URL(request.url).searchParams.get("site")?.trim() || "";
        // No site → privacy-safe default, don't cache the miss.
        if (!site) return json(ANON, "no-store");
        const cfg = await loadSiteConfig(site);
        // Origin-grind, HÅRDARE än decide/events (granskningsfynd 2026-07-28):
        // svaret bär kundens konverteringsmål (URL/selector/text = hela
        // funnel-definitionen), så för domän-registrerade sajter krävs
        // BEVISAD origin — snippetens fetch från kundens sida är alltid
        // cross-origin och bär Origin, medan curl/utländska sajter får den
        // anonyma defaulten (som inte avslöjar något). Sandbox-mappningens
        // läcka ("?site=sandbox--kund.se") stängs av samma regel. Sajter
        // utan registrerad domän (legacy/labb) behåller gamla beteendet —
        // de har inget att bevisa mot.
        const dv = originVerdict(
          cfg.domain,
          request.headers.get("origin"),
          request.headers.get("referer"),
        );
        if (cfg.domain ? !dv.proved : !dv.allowed) return json(ANON, "no-store");
        // Cache at the edge/browser for 5 min: config changes rarely and a stale
        // 'anonymous' only ever under-collects (never over-collects).
        return json(
          {
            mode: cfg.mode,
            holdoutPct: cfg.holdoutPct,
            conversion: {
              url: cfg.conversionUrl,
              selector: cfg.conversionSelector,
              text: cfg.conversionText,
            },
            // Per-sektion-synligheten (CRO-planen steg 9): sajt-konfig i
            // stället för enbart taggattribut, så påslag och — viktigare —
            // AVSTÄNGNING inte kräver en release på kundens sajt. OBS cachen
            // ovan (5 min): en ändring slår igenom inom det fönstret, inte
            // omedelbart. Taggens data-observe-sections vinner fortfarande
            // (explicit per-install-override).
            observeSections: cfg.observeSections,
          },
          "public, max-age=300",
        );
      },
    },
  },
});
