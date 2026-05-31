import { createFileRoute } from "@tanstack/react-router";
import { getRun, subscribe } from "@/lib/tests/orchestrator.server";

export const Route = createFileRoute("/api/tests/$runId/stream")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const runId = params.runId;
        const run = getRun(runId);
        if (!run) {
          return new Response("run not found", { status: 404 });
        }

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            const write = (chunk: string) => {
              try {
                controller.enqueue(encoder.encode(chunk));
              } catch {
                /* closed */
              }
            };
            // Initial comment so the browser opens the stream immediately.
            write(": connected\n\n");

            const unsub = subscribe(runId, (event) => {
              write(`event: ${event.type}\n`);
              write(`data: ${JSON.stringify({ ...event.data, ts: event.ts })}\n\n`);
              if (event.type === "done" || event.type === "error") {
                unsub();
                try { controller.close(); } catch { /* ignore */ }
              }
            });
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
