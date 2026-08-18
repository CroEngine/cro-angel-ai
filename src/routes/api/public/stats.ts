// /api/public/stats — startsidans live-siffror (ägarbeslut 2026-08-18:
// äkta statistik på startsidan, aldrig påhittad). Publika AGGREGAT över
// motorns riktiga tillstånd: hur många förslag som väntar på ägarknappen,
// hur många som mäts mot kontroll, byggda förhandsexempel — inga sajtnamn,
// inga rader, ingen parameter in. Cachebar 5 min: siffrorna rör sig i
// natt-takt, och en delad CDN-cache är ofarlig när svaret är identiskt för
// alla anropare.

import { createFileRoute } from "@tanstack/react-router";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": cache,
    },
  });
}

export const Route = createFileRoute("/api/public/stats")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      GET: async () => {
        try {
          const { fetchPublicStats } = await import("@/lib/public-stats/stats.server");
          const stats = await fetchPublicStats();
          return json({ ok: true, stats }, 200, "public, max-age=300");
        } catch {
          // Admin-klienten kastar när miljönycklarna saknas, hämtningen när en
          // fråga fallerar — ärligt 503 utan cache: hellre inga siffror än
          // gamla/halva på en sida vars poäng är ärlighet.
          return json({ ok: false, reason: "unavailable" }, 503);
        }
      },
    },
  },
});
