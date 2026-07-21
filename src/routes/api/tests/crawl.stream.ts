import { createFileRoute } from "@tanstack/react-router";

import { sseStream, withBrowserPage } from "@/lib/tests/sse.server";

// On-demand crawl + inventory ingest for ONE url, streamed like the other test
// routes so the serverless host stays alive during the browser work. Loads the
// page in Browserbase, runs the same pageAudit the live crawler uses, and feeds
// it through ingestAudit — which maps + CURATES + persists (replace-semantics),
// so a re-crawl overwrites a site's stored inventory with a fresh, cleaned one.
//
//   GET /api/tests/crawl/stream?url=<page>&site=<slug>&path=</path>&dry=1
export const Route = createFileRoute("/api/tests/crawl/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const targetUrl = reqUrl.searchParams.get("url");
        const site = reqUrl.searchParams.get("site");
        // dry=1: audit + map + curate, but DON'T persist — return the inventory
        // (counts + kept text) so a quality sweep can inspect it without writing.
        const dry = reqUrl.searchParams.get("dry") === "1";
        if (!targetUrl || !site) return new Response("missing url or site", { status: 400 });
        let path = reqUrl.searchParams.get("path") || "";
        if (!path) {
          try {
            path = new URL(targetUrl).pathname || "/";
          } catch {
            path = "/";
          }
        }

        return sseStream(async ({ emit }) => {
          emit("started", { url: targetUrl, site, path });
          const [audit, ingest, mapper] = await Promise.all([
            import("@/lib/tests/runners/pageAudit.server"),
            import("@/adaptive/ingest.server"),
            import("@/adaptive/crawler-inventory"),
          ]);

          await withBrowserPage(async (page) => {
            emit("log", { message: `navigating to ${targetUrl}` });
            const resp = await page.goto(targetUrl, {
              waitUntil: "domcontentloaded",
              timeoutMs: 45000,
            });
            if (resp) {
              (page as unknown as { __lovableLastResponse?: unknown }).__lovableLastResponse = {
                status: resp.status(),
                headers: resp.headers(),
                url: resp.url(),
              };
            }

            const { dismissConsent, waitForContent } = await import(
              "@/lib/tests/robustness/session.server"
            );
            emit("log", { message: "settling (consent + hydrate)" });
            await dismissConsent(page);
            await waitForContent(page);

            emit("log", { message: "auditing page" });
            const data = await audit.runPageAudit(page);

            let domain: string | null = null;
            try {
              domain = new URL(targetUrl).hostname;
            } catch {
              /* non-fatal */
            }

            if (dry) {
              emit("log", { message: "mapping + curating (dry — not persisted)" });
              const inv = mapper.mapAuditToInventory(data, site);
              const slots: Record<string, (string | null)[]> = {};
              const counts: Record<string, number> = {};
              for (const [slot, items] of Object.entries(inv.slots)) {
                const list = (items ?? []).map((it) => it.text ?? null);
                slots[slot] = list;
                counts[slot] = list.length;
              }
              emit("inventory", { slots, counts });
            } else {
              emit("log", { message: "mapping + curating + persisting inventory" });
              const res = await ingest.ingestAudit(site, data, { domain, path });
              emit("ingested", { items: res.items, saved: res.saved, drift: res.drift });
            }
          });

          emit("done", {});
        });
      },
    },
  },
});
