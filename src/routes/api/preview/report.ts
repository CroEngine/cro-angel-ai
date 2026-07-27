// /api/preview/report?id=… — serverar förhandsvisningsrapporten från VÅR
// origin med korrekta headers.
//
// Bakgrund (pilotfynd 2026-07-27, diag-runda 1+2): Supabase storage serverar
// HTML-objekt på den publika ytan som text/plain + nosniff oavsett hur de
// laddas upp (rå Buffer + header, Blob med typ, File med .html-namn — allt
// blir text/plain). Webbläsaren TVINGAS då visa källkod. Ingen uppladdnings-
// variant kan fixa det — serveringen måste gå genom oss. Rapporten är vår
// egen genererade, självbärande HTML (inline-CSS + data-URI-bilder, inga
// skript); CSP:n nedan låser den till exakt det.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/preview/report")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(id)) {
          return new Response("bad id", { status: 400 });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.storage
            .from("angel-evidence")
            .download(`preview/${id}/report.html`);
          if (error || !data) return new Response("not found", { status: 404 });
          return new Response(data, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "X-Content-Type-Options": "nosniff",
              // Rapporten är statisk per jobb (upsert vid omkörning) — kort
              // cache räcker och låter omkörningar slå igenom snabbt.
              "Cache-Control": "public, max-age=300",
              // Självbärande dokument: inline-stilar + data-bilder, inget
              // annat. Skript, nätverk och formulär är avstängda på CSP-nivå.
              "Content-Security-Policy":
                "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
            },
          });
        } catch {
          return new Response("unavailable", { status: 503 });
        }
      },
    },
  },
});
