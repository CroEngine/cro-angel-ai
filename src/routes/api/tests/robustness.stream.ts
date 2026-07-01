import { createFileRoute } from "@tanstack/react-router";

import { isPersona, DEFAULT_PERSONA, type PersonaId } from "@/lib/tests/robustness/personas";

// Self-contained robustness check for ONE url, streamed like the crawl so the
// serverless host keeps the function alive while the browser work runs.
//
// It loads a real page in Browserbase, computes a real Decision for a persona,
// applies the REAL production snippet via its guarded test seam, and reports
// whether targeting hit real elements, the page stayed intact, and every change
// reversed. Nothing is persisted. Batch = call this N times (one session each,
// so failures isolate and runs parallelize).
//
//   GET /api/tests/robustness/stream?url=<page>&persona=<id>&site=<slug>
export const Route = createFileRoute("/api/tests/robustness/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const targetUrl = reqUrl.searchParams.get("url");
        const personaParam = reqUrl.searchParams.get("persona") || DEFAULT_PERSONA;
        const site = reqUrl.searchParams.get("site") || "robustness";
        const persona: PersonaId = isPersona(personaParam) ? personaParam : DEFAULT_PERSONA;

        if (!targetUrl) return new Response("missing url", { status: 400 });

        const origin = reqUrl.origin;
        let closed = false;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            const write = (chunk: string) => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(chunk));
              } catch {
                /* closed */
              }
            };
            const emit = (type: string, data: Record<string, unknown> = {}) => {
              write(`event: ${type}\n`);
              write(`data: ${JSON.stringify({ ...data, ts: Date.now() })}\n\n`);
            };
            write(": connected\n\n");
            emit("started", { url: targetUrl, persona, site });

            void (async () => {
              let sessionId: string | null = null;
              let closeStagehand: (() => Promise<void>) | undefined;
              let closeSession: ((id: string) => Promise<void>) | undefined;

              try {
                const [bb, sess, runnerMod] = await Promise.all([
                  import("@/lib/tests/browserbase.server"),
                  import("@/lib/tests/robustness/session.server"),
                  import("@/lib/tests/robustness/runner.server"),
                ]);
                closeSession = bb.closeSession;

                // Fetch the production snippet (same origin as this function).
                emit("log", { message: "loading snippet source" });
                const snippetRes = await fetch(`${origin}/adaptive.js`);
                if (!snippetRes.ok) throw new Error(`adaptive.js fetch ${snippetRes.status}`);
                const snippetSource = await snippetRes.text();

                emit("log", { message: "creating browser session" });
                const session = await bb.createSession();
                sessionId = session.id;

                const opened = await sess.openPage(sessionId);
                closeStagehand = opened.close;
                const page = opened.page;

                emit("log", { message: `navigating to ${targetUrl}` });
                await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

                emit("log", { message: "auditing + applying snippet" });
                const report = await runnerMod.runSnippetRobustness(page, {
                  url: targetUrl,
                  site,
                  persona,
                  snippetSource,
                });

                emit("report", { report });
                emit("done", { verdict: report.verdict });
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                emit("error", { message });
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
