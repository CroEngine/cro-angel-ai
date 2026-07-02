// Shared plumbing for the Browserbase-driven test routes.
//
// Every such route streams Server-Sent Events while a browser task runs inside
// the request (so the serverless host stays alive), and most also create a
// one-off Browserbase session + Stagehand page and release both when done.
// These two helpers capture that boilerplate so each route is just its task.

export interface SseEmitter {
  /** Emit a named SSE event with a JSON payload (a `ts` is added). */
  emit: (type: string, data?: Record<string, unknown>) => void;
  /** True once the client disconnected or the task finished. */
  isClosed: () => boolean;
}

/**
 * Build an SSE Response that runs `task` to completion inside the stream. The
 * task gets an emitter; a thrown error becomes an `error` event; the stream is
 * always closed in `finally`. Client disconnect flips `isClosed()` so long
 * loops can bail early.
 */
export function sseStream(task: (sse: SseEmitter) => Promise<void>): Response {
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* already closed */
        }
      };
      const emit = (type: string, data: Record<string, unknown> = {}) => {
        write(`event: ${type}\n`);
        write(`data: ${JSON.stringify({ ...data, ts: Date.now() })}\n\n`);
      };
      write(": connected\n\n");

      void (async () => {
        try {
          await task({ emit, isClosed: () => closed });
        } catch (err) {
          emit("error", { message: err instanceof Error ? err.message : String(err) });
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
}

/**
 * Create a fresh Browserbase session + Stagehand page, run `fn`, and release
 * both (Stagehand disconnect + session release) no matter how `fn` ends.
 */
export async function withBrowserPage<T>(
  fn: (page: import("@browserbasehq/stagehand").Page) => Promise<T>,
): Promise<T> {
  const [bb, sess] = await Promise.all([
    import("./browserbase.server"),
    import("./robustness/session.server"),
  ]);
  const session = await bb.createSession();
  const opened = await sess.openPage(session.id);
  try {
    return await fn(opened.page);
  } finally {
    try {
      await opened.close();
    } catch {
      /* ignore */
    }
    try {
      await bb.closeSession(session.id);
    } catch {
      /* ignore */
    }
  }
}
