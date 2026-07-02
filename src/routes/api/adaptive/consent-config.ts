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
//
// Tag attributes (data-holdout, data-conversion-*) win over these values, as
// explicit per-install overrides. See docs/consent-gate.md.
//
// CORS-open + short-cached: this is non-personal site config, called from the
// customer's own origin by the snippet. Degrades to the anonymous,
// measurement-off default.

import { createFileRoute } from "@tanstack/react-router";

import { loadSiteConfig } from "@/adaptive/persistence.server";

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

const ANON = { mode: "anonymous", holdoutPct: 0, conversion: { url: null, selector: null } };

export const Route = createFileRoute("/api/adaptive/consent-config")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async ({ request }) => {
        const site = new URL(request.url).searchParams.get("site")?.trim() || "";
        // No site → privacy-safe default, don't cache the miss.
        if (!site) return json(ANON, "no-store");
        const cfg = await loadSiteConfig(site);
        // Cache at the edge/browser for 5 min: config changes rarely and a stale
        // 'anonymous' only ever under-collects (never over-collects).
        return json(
          {
            mode: cfg.mode,
            holdoutPct: cfg.holdoutPct,
            conversion: { url: cfg.conversionUrl, selector: cfg.conversionSelector },
          },
          "public, max-age=300",
        );
      },
    },
  },
});
