// GET /api/adaptive/consent-config?site=SLUG
//
// The snippet fetches this once on load to learn how the SITE OWNER configured
// consent for their install. The owner is the data controller: from the
// dashboard they can attest to a lawful basis (mode='attested'), which lets the
// snippet run at a consented baseline. Absent that, mode='anonymous' and the
// snippet stays storage-free until an on-page CMP grants. GPC/DNT are honoured
// client-side regardless of this value — attestation never overrides a visitor
// opt-out. See docs/consent-gate.md.
//
// CORS-open + short-cached: this is non-personal site config, called from the
// customer's own origin by the snippet. Degrades to {"mode":"anonymous"}.

import { createFileRoute } from "@tanstack/react-router";

import { loadConsentMode } from "@/adaptive/persistence.server";

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

export const Route = createFileRoute("/api/adaptive/consent-config")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async ({ request }) => {
        const site = new URL(request.url).searchParams.get("site")?.trim() || "";
        // No site → privacy-safe default, don't cache the miss.
        if (!site) return json({ mode: "anonymous" }, "no-store");
        const mode = await loadConsentMode(site);
        // Cache at the edge/browser for 5 min: config changes rarely and a stale
        // 'anonymous' only ever under-collects (never over-collects).
        return json({ mode }, "public, max-age=300");
      },
    },
  },
});
