import { createFileRoute } from "@tanstack/react-router";

// On-demand crawl + inventory ingest for ONE url, streamed like the other test
// routes so the serverless host stays alive during the browser work. Loads the
// page in Browserbase, runs the same pageAudit the live crawler uses, and feeds
// it through ingestAudit — which maps + CURATES + persists (replace-semantics),
// so a re-crawl overwrites a site's stored inventory with a fresh, cleaned one.
//
//   GET /api/tests/crawl/stream?url=<page>&site=<slug>&path=</path>
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

        let closed = false;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            const emit = (type: string, data: Record<string, unknown> = {}) => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(`event: ${type}\n`));
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...data, ts: Date.now() })}\n\n`));
              } catch {
                /* closed */
              }
            };
            controller.enqueue(encoder.encode(": connected\n\n"));
            emit("started", { url: targetUrl, site, path });

            void (async () => {
              let sessionId: string | null = null;
              let closeStagehand: (() => Promise<void>) | undefined;
              let closeSession: ((id: string) => Promise<void>) | undefined;
              try {
                const [bb, sess, audit, ingest, mapper] = await Promise.all([
                  import("@/lib/tests/browserbase.server"),
                  import("@/lib/tests/robustness/session.server"),
                  import("@/lib/tests/runners/pageAudit.server"),
                  import("@/adaptive/ingest.server"),
                  import("@/adaptive/crawler-inventory"),
                ]);
                closeSession = bb.closeSession;

                emit("log", { message: "creating session" });
                const session = await bb.createSession();
                sessionId = session.id;
                const opened = await sess.openPage(sessionId);
                closeStagehand = opened.close;

                emit("log", { message: `navigating to ${targetUrl}` });
                const resp = await opened.page.goto(targetUrl, {
                  waitUntil: "domcontentloaded",
                  timeoutMs: 45000,
                });
                if (resp) {
                  (opened.page as unknown as { __lovableLastResponse?: unknown }).__lovableLastResponse = {
                    status: resp.status(),
                    headers: resp.headers(),
                    url: resp.url(),
                  };
                }

                // Extraction hardening: dismiss consent gates + let SPAs hydrate
                // before auditing, so consent-walled / client-rendered pages
                // don't come back empty. Both deterministic + language-agnostic.
                emit("log", { message: "settling (consent + hydrate)" });
                await sess.dismissConsent(opened.page);
                await sess.waitForContent(opened.page);

                emit("log", { message: "auditing page" });
                const data = await audit.runPageAudit(opened.page);

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
                  emit("done", {});
                } else {
                  emit("log", { message: "mapping + curating + persisting inventory" });
                  const res = await ingest.ingestAudit(site, data, { domain, path });
                  emit("ingested", { items: res.items, saved: res.saved, drift: res.drift });
                  emit("done", {});
                }
              } catch (err) {
                emit("error", { message: err instanceof Error ? err.message : String(err) });
              } finally {
                try {
                  if (closeStagehand) await closeStagehand();
                } catch {
                  /* ignore */
                }
                try {
                  if (closeSession && sessionId) await closeSession(sessionId);
                } catch {
                  /* ignore */
                }
                closed = true;
                try {
                  controller.close();
                } catch {
                  /* already closed */
                }
              }
            })();
          },
          cancel() {
            closed = true;
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
