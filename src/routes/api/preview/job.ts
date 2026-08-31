// /api/preview/job — prospekt-förhandsvisningens publika yta (trattens topp).
//
//   POST { url }  → validera (publika http(s)-värdar, SSRF-hygien) →
//                   takt-begränsa (hashad avsändare, max 3/dygn) →
//                   dedupe (samma URL < 24h ⇒ återanvänd jobbet) →
//                   köa raden + (best-effort) väck Actions-arbetaren →
//                   { ok, id }
//   GET  ?id=…    → { status, reportUrl, findings, error } — /try-sidan pollar.
//
// Ingen auth: prospektet är inte registrerat än — det är poängen. All skriv-
// åtkomst går via service-klienten; RLS utan policies stänger allt annat.
// Jobbet KÖRS aldrig här (serverless kan inte hålla en browser) — arbetaren
// är .github/workflows/preview-jobs.yml, samma isolerade mönster som day0.

import { createFileRoute } from "@tanstack/react-router";

import {
  mapFindings,
  previewAllowed,
  requesterHash,
  validatePreviewUrl,
} from "@/lib/preview/preview";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Avsändarens IP. Netlifys egen header först (granskningsfynd 2026-07-28):
 *  x-forwarded-for:s VÄNSTRA post är klient-satt — Netlify appenderar den
 *  riktiga IP:n — så en angripare kunde välja sin rate-limit-nyckel fritt
 *  och taket 3/dygn var i praktiken avstängt. x-nf-client-connection-ip
 *  sätts av plattformen och kan inte spoofas; XFF:s SISTA post är reserven. */
function clientIp(request: Request): string | null {
  const nf = request.headers.get("x-nf-client-connection-ip");
  if (nf) return nf.trim();
  const xf = request.headers.get("x-forwarded-for");
  if (xf) {
    const parts = xf.split(",");
    return parts[parts.length - 1].trim();
  }
  return request.headers.get("x-real-ip");
}

/** Best-effort: väck preview-arbetaren direkt via workflow_dispatch så
 *  prospektet slipper vänta på schemat. Kräver ANGEL_GH_DISPATCH_TOKEN +
 *  ANGEL_GH_REPO ("owner/repo") i miljön; utan dem tar cron-svepet jobbet. */
async function dispatchWorker(): Promise<void> {
  const token = process.env.ANGEL_GH_DISPATCH_TOKEN;
  const repo = process.env.ANGEL_GH_REPO;
  if (!token || !repo) return;
  try {
    await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/preview-jobs.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      },
    );
  } catch {
    /* cron-svepet är reservvägen */
  }
}

export const Route = createFileRoute("/api/preview/job")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        if (process.env.ANGEL_PREVIEW_FUNNEL === "0") {
          return json({ ok: false, reason: "disabled" }, 503);
        }
        let body: { url?: string };
        try {
          body = (await request.json()) as { url?: string };
        } catch {
          return json({ ok: false, reason: "bad_json" }, 400);
        }
        const validated = validatePreviewUrl(body?.url ?? "");
        if (!validated.ok) return json({ ok: false, reason: validated.reason }, 400);

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const hash = requesterHash(clientIp(request));
          const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

          // Dedupe före takt: samma URL det senaste dygnet ⇒ samma jobb (gratis
          // för avsändaren — exemplet finns/byggs redan).
          const { data: existing } = await supabaseAdmin
            .from("angel_preview_jobs")
            .select("id,status")
            .eq("url", validated.url)
            .gte("created_at", dayAgo)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (existing && existing.status !== "failed") {
            return json({ ok: true, id: existing.id, deduped: true });
          }

          const { count } = await supabaseAdmin
            .from("angel_preview_jobs")
            .select("id", { count: "exact", head: true })
            .eq("requester_hash", hash)
            .gte("created_at", dayAgo);
          if (!previewAllowed(count ?? 0)) {
            return json({ ok: false, reason: "rate_limited" }, 429);
          }

          const { data: row, error } = await supabaseAdmin
            .from("angel_preview_jobs")
            .insert({ url: validated.url, requester_hash: hash })
            .select("id")
            .single();
          if (error || !row) return json({ ok: false, reason: "write_failed" }, 500);

          // AWAIT, inte fire-and-forget (pilotfynd 2026-07-27): serverless
          // fryser funktionen när svaret skickats — ett void:at fetch-anrop
          // avbryts i flykten och GitHub-väckningen gick ALDRIG iväg. De
          // ~200 ms väntan är försumbara; dispatchWorker sväljer själv fel.
          await dispatchWorker();
          return json({ ok: true, id: row.id });
        } catch {
          // Admin-klienten kastar när miljönycklarna saknas — ärligt 503,
          // aldrig en krasch i trattens topp.
          return json({ ok: false, reason: "unavailable" }, 503);
        }
      },

      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, reason: "bad_id" }, 400);
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: row } = await supabaseAdmin
            .from("angel_preview_jobs")
            .select("status,stage,report_url,findings,error,url")
            .eq("id", id)
            .maybeSingle();
          if (!row) return json({ ok: false, reason: "not_found" }, 404);
          // Rapporten serveras via VÅR origin (/api/preview/report) — Supabase
          // neutraliserar HTML på den publika ytan till text/plain + nosniff
          // (diag 2026-07-27), så storage-URL:en visar källkod i stället för
          // rapporten. DB-raden behåller storage-URL:en som sanning om var
          // bytesen bor; äldre rader med annat nyckelformat lämnas orörda.
          const ownReport = row.report_url?.includes(`/preview/${id}/report.html`)
            ? `/api/preview/report?id=${id}`
            : row.report_url;
          // Readern (2026-07-27): diagnostiken följer med svaret — verdict,
          // orsak och fallback-väg per jobb. Jobb-id:n är ogissbara uuid:n
          // och innehållet är vår egen grind-vokabulär om prospektets EGEN
          // sida — inget känsligt läcker.
          const diag =
            (row.findings as { diagnostics?: unknown } | null)?.diagnostics ?? null;
          return json({
            ok: true,
            status: row.status,
            // Arbetarens grovfas (freeze | analyze | verify, null = köad/äldre
            // rad) — /try:s väntesteg ritas ur den.
            stage: row.stage ?? null,
            url: row.url,
            reportUrl: ownReport,
            findings: mapFindings(row.findings) ?? row.findings ?? null,
            diag,
            error: row.error,
          });
        } catch {
          return json({ ok: false, reason: "unavailable" }, 503);
        }
      },
    },
  },
});
