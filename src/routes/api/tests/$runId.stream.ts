import { createFileRoute } from "@tanstack/react-router";
import { buildSteps } from "@/lib/tests/run.functions";

// The crawl runs INSIDE this streaming request. The serverless host keeps the
// function alive for as long as the SSE response body is open, so step
// execution happens within an active request instead of a fire-and-forget
// background task (which is frozen on serverless once the response returns).
//
// Everything the crawl needs (sessionId + url) is passed as query params, so
// this handler is fully self-contained and never depends on cross-instance
// in-memory state.
export const Route = createFileRoute("/api/tests/$runId/stream")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const runId = params.runId;
        const reqUrl = new URL(request.url);
        const sessionId = reqUrl.searchParams.get("sessionId");
        const targetUrl = reqUrl.searchParams.get("url");
        const ingestSite = reqUrl.searchParams.get("ingestSite") || undefined;

        if (!sessionId || !targetUrl) {
          return new Response("missing sessionId or url", { status: 400 });
        }

        const steps = buildSteps(targetUrl);
        const abort = new AbortController();
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
            // Initial comment so the browser opens the stream immediately.
            write(": connected\n\n");
            emit("session_started", { runId, sessionId });

            // Drive the crawl asynchronously; start() returns immediately so the
            // response begins streaming right away.
            void (async () => {
              let closeSession: ((id: string) => Promise<void>) | undefined;
              let released = false;
              // Release the Browserbase session exactly once, regardless of how
              // the run ends (success, failure, or client disconnect / cancel).
              const release = async () => {
                if (released) return;
                released = true;
                try {
                  if (closeSession) await closeSession(sessionId);
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  emit("log", { level: "warn", message: `closeSession failed: ${message}` });
                }
              };

              try {
                const [bb, eng] = await Promise.all([
                  import("@/lib/tests/browserbase.server"),
                  import("@/lib/tests/engine.server"),
                ]);
                closeSession = bb.closeSession;

                emit("log", { level: "info", message: `running ${steps.length} step(s)` });

                let firstGotoPassed = false;
                const result = await eng.runSteps(sessionId, steps, {
                  signal: abort.signal,
                  onAudit: ingestSite
                    ? async (audit) => {
                        const { ingestAudit } = await import("@/adaptive/ingest.server");
                        let domain: string | null = null;
                        try {
                          domain = new URL(targetUrl).hostname;
                        } catch {
                          /* non-fatal */
                        }
                        const res = await ingestAudit(ingestSite, audit, { domain });
                        emit("log", {
                          level: "info",
                          message: `inventory: ${res.items} items mapped, ${res.saved} saved for "${res.site}"`,
                        });
                      }
                    : undefined,
                  onEvent: (e) => {
                    if (closed) return;
                    if (e.type === "log") {
                      emit("log", { level: "debug", message: e.message });
                      return;
                    }
                    const payload: Record<string, unknown> = {
                      index: e.index,
                      kind: e.kind,
                      summary: e.summary,
                    };
                    if (e.type === "step_started") {
                      emit("step_started", payload);
                    } else if (e.type === "step_passed") {
                      payload.durationMs = e.durationMs;
                      if (e.data !== undefined) payload.data = e.data;
                      emit("step_passed", payload);
                      if (!firstGotoPassed && e.kind === "goto") {
                        firstGotoPassed = true;
                        emit("state", { phase: "idle" });
                      }
                    } else if (e.type === "step_failed") {
                      payload.durationMs = e.durationMs;
                      payload.error = e.error;
                      emit("step_failed", payload);
                    }
                  },
                });

                // Close the session before the terminal event so the client's
                // "Frozen" view (built from the collect screenshot) shows up the
                // moment the run reports done.
                await release();
                if (result.failed > 0) {
                  emit("error", {
                    message: `${result.failed} step(s) failed`,
                    passed: result.passed,
                    failed: result.failed,
                  });
                } else {
                  emit("done", { aborted: result.aborted, passed: result.passed, failed: result.failed });
                }
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                await release();
                if (abort.signal.aborted) {
                  emit("done", { aborted: true, reason: "aborted" });
                } else {
                  emit("error", { message });
                }
              } finally {
                await release();
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
            // Client disconnected (Stop button / tab close / navigation). Abort
            // the crawl; the running task's finally path releases the session.
            closed = true;
            try {
              abort.abort();
            } catch {
              /* ignore */
            }
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
