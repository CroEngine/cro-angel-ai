// /api/preview/page?id=…&which=before|after — serverar före/efter-KOPIORNA av
// prospektets sida för Original/Variant-växlaren i /try, från VÅR origin med
// korrekta headers (Supabase neutraliserar HTML på den publika ytan till
// text/plain + nosniff — samma fynd som /api/preview/report).
//
// Objekten finns BARA när grindarna släppt igenom förslaget (arbetaren laddar
// aldrig upp dem för hållna jobb) — 404 här ÄR grinden, och /try:s probe
// döljer växlaren. Kopiorna är skriptstrippade frusna sidor med inlinade
// stilar och (mestadels) data-URI-bilder; CSP:n tillåter det och inget mer —
// skript och formulär är avstängda, och bara vår egen app får rama in dem.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/preview/page")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const id = params.get("id") ?? "";
        const which = params.get("which") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(id) || !/^(before|after)$/.test(which)) {
          return new Response("bad request", { status: 400 });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.storage
            .from("angel-evidence")
            .download(`preview/${id}/page-${which}.html`);
          if (error || !data) return new Response("not found", { status: 404 });
          // ?stage=1 — den uppslukande scenens variant (granskningsfynd
          // 2026-08-31, MAJOR): i naturhöjdsramen tappar v-höjder sitt ankare
          // (100vh ⇒ hela kopians höjd, och mätningen jagar sig själv), så
          // scenens kopior serveras med v-höjder omskrivna till px vid
          // frysviewporten. Rå kopia (utan parametern) förblir orörd —
          // cache-nyckeln skiljer via query-strängen.
          if (params.get("stage") === "1") {
            const { neutralizeViewportUnits } = await import("@/lib/preview/stage-css");
            const staged = neutralizeViewportUnits(await data.text());
            return new Response(staged, {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "public, max-age=300",
                "Content-Security-Policy":
                  "default-src 'none'; img-src data: https:; media-src data: https:; style-src 'unsafe-inline'; font-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
              },
            });
          }
          return new Response(data, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "public, max-age=300",
              // Frusna kopior: inline-stilar + bilder (data: och de få som
              // inte kunde inlinas), typsnitt ur inlinade stilmallar. Inga
              // skript, inga formulär, inramning endast från vår egen app.
              // media-src (fikajobs-fyndet 2026-07-28): hjältevideor är
              // vanliga (Framer-klassen: <video autoplay muted loop> utan JS)
              // — utan direktivet föll de till default-src 'none' och
              // växlaren visade ett tomt hål där sidans huvudmedia bor.
              "Content-Security-Policy":
                "default-src 'none'; img-src data: https:; media-src data: https:; style-src 'unsafe-inline'; font-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
            },
          });
        } catch {
          return new Response("unavailable", { status: 503 });
        }
      },
    },
  },
});
