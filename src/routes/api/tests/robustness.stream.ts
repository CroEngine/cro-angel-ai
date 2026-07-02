import { createFileRoute } from "@tanstack/react-router";

import {
  isPersona,
  DEFAULT_PERSONA,
  ALL_PERSONAS,
  type PersonaId,
} from "@/lib/tests/robustness/personas";

// Self-contained robustness sweep, streamed like the crawl so the serverless
// host keeps the function alive while the browser work runs.
//
// For each url it loads the page in Browserbase, computes a real Decision per
// persona, applies the REAL production snippet via its guarded test seam, and
// reports whether targeting hit real elements, the page stayed intact, and
// every change reversed. Nothing is persisted. A final `summary` event carries
// the summarize() aggregate — the launch-gate view (pass/warn/fail, avg
// targeting, irreversible count).
//
//   GET /api/tests/robustness/stream
//        ?url=<page>            single page, or
//        ?urls=<a,b,c>          batch (each its own session; capped)
//        &persona=<id|all>      one persona (default) or the full matrix
//        &site=<slug>
export const Route = createFileRoute("/api/tests/robustness/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const single = reqUrl.searchParams.get("url");
        const many = reqUrl.searchParams.get("urls");
        const personaParam = reqUrl.searchParams.get("persona") || DEFAULT_PERSONA;
        const site = reqUrl.searchParams.get("site") || "robustness";
        const captureShots = reqUrl.searchParams.get("shots") === "1";

        const urls = (many ? many.split(",") : single ? [single] : [])
          .map((u) => u.trim())
          .filter(Boolean)
          .slice(0, 25); // cap one request; larger sweeps parallelize client-side
        if (urls.length === 0) return new Response("missing url or urls", { status: 400 });

        const personas: PersonaId[] =
          personaParam === "all"
            ? ALL_PERSONAS
            : [isPersona(personaParam) ? personaParam : DEFAULT_PERSONA];

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
            emit("started", { urls, personas, site });

            void (async () => {
              try {
                const [bb, sess, runnerMod, analyzeMod] = await Promise.all([
                  import("@/lib/tests/browserbase.server"),
                  import("@/lib/tests/robustness/session.server"),
                  import("@/lib/tests/robustness/runner.server"),
                  import("@/lib/tests/robustness/analyze"),
                ]);

                emit("log", { message: "loading snippet source" });
                const snippetRes = await fetch(`${origin}/adaptive.js`);
                if (!snippetRes.ok) throw new Error(`adaptive.js fetch ${snippetRes.status}`);
                const snippetSource = await snippetRes.text();

                const allReports: import("@/lib/tests/robustness/analyze").RobustnessReport[] = [];

                for (const targetUrl of urls) {
                  let sessionId: string | null = null;
                  let closeStagehand: (() => Promise<void>) | undefined;
                  try {
                    emit("log", { message: `[${targetUrl}] creating session` });
                    const session = await bb.createSession();
                    sessionId = session.id;
                    const opened = await sess.openPage(sessionId);
                    closeStagehand = opened.close;

                    emit("log", { message: `[${targetUrl}] navigating` });
                    await opened.page.goto(targetUrl, {
                      waitUntil: "domcontentloaded",
                      timeoutMs: 45000,
                    });

                    emit("log", { message: `[${targetUrl}] auditing + applying (${personas.length} persona(s))` });
                    const reports = await runnerMod.runSnippetRobustness(opened.page, {
                      url: targetUrl,
                      site,
                      personas,
                      snippetSource,
                      captureShots,
                      onShot: captureShots
                        ? (shot) =>
                            emit("shot", {
                              url: targetUrl,
                              persona: shot.persona,
                              phase: shot.phase,
                              jpeg: shot.jpegBase64,
                            })
                        : undefined,
                    });
                    for (const report of reports) {
                      allReports.push(report);
                      emit("report", { report });
                    }
                  } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    emit("site_error", { url: targetUrl, message });
                    // Record a fail so the aggregate reflects it.
                    for (const persona of personas) {
                      allReports.push(
                        analyzeMod.analyze({
                          url: targetUrl,
                          site,
                          persona,
                          reachable: false,
                          snippetRan: false,
                          consoleErrors: [message],
                          decidedCount: 0,
                          appliedCount: 0,
                          probes: [],
                          baseline: { textLen: 0, elementCount: 0, bodyChildCount: 0 },
                          afterApply: { textLen: 0, elementCount: 0, bodyChildCount: 0 },
                          afterReset: { textLen: 0, elementCount: 0, bodyChildCount: 0 },
                          layout: {
                            matched: 0,
                            shiftedCount: 0,
                            shiftedFraction: 0,
                            controlShiftedFraction: 0,
                            maxMove: 0,
                          },
                          residueAfterReset: -1,
                          durationMs: 0,
                        }),
                      );
                    }
                  } finally {
                    try {
                      if (closeStagehand) await closeStagehand();
                    } catch {
                      /* ignore */
                    }
                    try {
                      if (sessionId) await bb.closeSession(sessionId);
                    } catch {
                      /* ignore */
                    }
                  }
                }

                emit("summary", { summary: analyzeMod.summarize(allReports) });
                emit("done", {});
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                emit("error", { message });
              } finally {
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
