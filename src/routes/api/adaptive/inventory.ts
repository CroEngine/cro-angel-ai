// POST /api/adaptive/inventory
//
// Alternative inventory ingest: instead of our headless crawler visiting the
// URL, the on-page snippet harvests the live DOM (highest fidelity — the real
// visitor's rendered page) and POSTs an audit here. The server sanitizes it and
// runs the SAME mapping + drift pipeline the crawler uses (ingestAudit), so
// drift tracking is source-agnostic.
//
// Per-page: inventory är scopat till (site, path). Skörden på klienten väljs
// per (site, path, dag), så täckningen byggs upp över HELA sajten allt eftersom
// besökare hittar olika sidor — inte bara startsidan. (En äldre kommentar
// sa "Phase 1: homepage only"; det stämmer inte längre — ingestAudit lagrar
// per path och decide läser per path.)

import { createFileRoute } from "@tanstack/react-router";

import { ingestAudit } from "@/adaptive/ingest.server";
import { logEvents, siteWriteAllowed } from "@/adaptive/persistence.server";
import { sanitizeAudit, sanitizeObserve } from "@/adaptive/harvest/sanitize";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Normalize a path: strip query/hash, default to the homepage. */
function normalizePath(path: string): string {
  const p = (path || "").split("?")[0].split("#")[0];
  return p || "/";
}

interface InventoryBody {
  site?: string;
  url?: string;
  path?: string;
  key?: string;
  audit?: unknown;
}

export const Route = createFileRoute("/api/adaptive/inventory")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        // Dark switch — inert if explicitly disabled. Default on; harmless while
        // no client calls it (Phase 2 wires the snippet).
        if (process.env.ANGEL_INVENTORY_INGEST === "0") {
          return json({ ok: false, reason: "disabled" });
        }

        let body: InventoryBody;
        try {
          body = (await request.json()) as InventoryBody;
        } catch {
          return json({ ok: false, reason: "bad_json" }, 400);
        }

        const site = typeof body?.site === "string" ? body.site.trim() : "";
        if (!site) return json({ ok: false, reason: "no_site" }, 400);

        // Keyed sites must present the matching write key, else the harvested
        // inventory (which decide serves back onto the live page) could be
        // spoofed for an arbitrary slug.
        if (!(await siteWriteAllowed(site, body?.key))) {
          return json({ ok: false, reason: "unauthorized" }, 403);
        }

        // Prefer an explicit path; fall back to the URL's pathname. Any page is
        // accepted now — inventory is stored per (site, path).
        let path = typeof body?.path === "string" ? body.path : "";
        if (!path && typeof body?.url === "string") {
          try {
            path = new URL(body.url).pathname;
          } catch {
            /* ignore */
          }
        }
        path = normalizePath(path);

        const audit = sanitizeAudit(body?.audit);

        let domain: string | null = null;
        if (typeof body?.url === "string") {
          try {
            domain = new URL(body.url).hostname;
          } catch {
            /* non-fatal */
          }
        }

        const res = await ingestAudit(site, audit, { domain, path });

        // Observe-only strukturskikt (formulär/nav/pris): diagnos, matar aldrig
        // en mönster-beslut, så det går INTE via inventory-mappern. Skrivs som
        // en visitor-lös page_structure-händelse (logEvents är redan
        // sandbox-gatad, så förhandsgranskningar skriver inget). Bäst-i-mån.
        const observe = sanitizeObserve(body?.audit);
        if (observe) {
          await logEvents(site, null, [
            { type: "page_structure", payload: { path, ...observe } },
          ]);
        }

        return json({
          ok: true,
          items: res.items,
          saved: res.saved,
          drift: res.drift,
        });
      },
    },
  },
});
