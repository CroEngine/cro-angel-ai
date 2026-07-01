// POST /api/adaptive/inventory
//
// Alternative inventory ingest: instead of our headless crawler visiting the
// URL, the on-page snippet harvests the live DOM (highest fidelity — the real
// visitor's rendered page) and POSTs an audit here. The server sanitizes it and
// runs the SAME mapping + drift pipeline the crawler uses (ingestAudit), so
// drift tracking is source-agnostic.
//
// Phase 1: homepage only. The `path` (or url pathname) must be the site root;
// other pages are accepted but skipped until per-page inventory lands. Nothing
// ships to the snippet yet — this endpoint is inert until Phase 2 wires it, so
// it can be deployed and parity-tested against the crawler's audit safely.

import { createFileRoute } from "@tanstack/react-router";

import { ingestAudit } from "@/adaptive/ingest.server";
import { sanitizeAudit } from "@/adaptive/harvest/sanitize";

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

/** Homepage-only gate (Phase 1). Root path, ignoring query/hash. */
function isHomePath(path: string): boolean {
  const p = path.split("?")[0].split("#")[0];
  return p === "" || p === "/";
}

interface InventoryBody {
  site?: string;
  url?: string;
  path?: string;
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

        // Prefer an explicit path; fall back to the URL's pathname.
        let path = typeof body?.path === "string" ? body.path : "";
        if (!path && typeof body?.url === "string") {
          try {
            path = new URL(body.url).pathname;
          } catch {
            /* ignore */
          }
        }
        if (!isHomePath(path)) {
          return json({ ok: false, reason: "not_homepage", path });
        }

        const audit = sanitizeAudit(body?.audit);

        let domain: string | null = null;
        if (typeof body?.url === "string") {
          try {
            domain = new URL(body.url).hostname;
          } catch {
            /* non-fatal */
          }
        }

        const res = await ingestAudit(site, audit, { domain });
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
