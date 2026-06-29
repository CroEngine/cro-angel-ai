// POST /api/adaptive/decide
//
// The snippet posts the visitor's client signals; we enrich them with
// header-derived server signals, load the site's content inventory, run the
// decision engine, log the decision (best-effort), and return the adaptations
// for the browser to apply. CORS-open: customers call this from their own
// origin via the snippet.

import { createFileRoute } from "@tanstack/react-router";

import { buildVisitorContext, readServerSignals } from "@/adaptive/context";
import { decide } from "@/adaptive/decide";
import { resolveInventory } from "@/adaptive/inventory.server";
import { logDecision } from "@/adaptive/persistence.server";
import type { ClientSignals } from "@/adaptive/types";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });

export const Route = createFileRoute("/api/adaptive/decide")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        let client: ClientSignals;
        try {
          client = (await request.json()) as ClientSignals;
        } catch {
          return json({ error: "invalid JSON body" }, 400);
        }
        if (!client?.site || !client?.url) {
          return json({ error: "missing required fields: site, url" }, 400);
        }

        const server = readServerSignals(request);
        const context = buildVisitorContext(server, client);
        const inventory = await resolveInventory(client.site);
        const decision = decide(client.site, context, inventory);

        // Best-effort log; never blocks or fails the decision.
        await logDecision(
          decision.site,
          decision.decisionId,
          context,
          decision.adaptations.map((a) => a.pattern),
          { referrer: client.referrer || server.referrer, userAgent: server.userAgent },
        );

        return json(decision);
      },
    },
  },
});
