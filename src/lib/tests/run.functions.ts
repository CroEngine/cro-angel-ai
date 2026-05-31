import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createSession, closeSession, navigateViaCDP } from "./browserbase.server";
import { createRun, emit, terminate, getRun, isTerminated } from "./orchestrator.server";

function newRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const startTestRun = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }) => {
    const runId = newRunId();

    let session;
    try {
      session = await createSession();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create Browserbase session: ${message}`);
    }

    const { id: sessionId, connectUrl, liveUrl } = session;

    const run = createRun(runId, async () => {
      await closeSession(sessionId);
    });

    emit(runId, "session_started", { runId, sessionId, liveUrl });

    // Kick off navigation async — do NOT await. Frontend gets liveUrl immediately.
    (async () => {
      try {
        emit(runId, "log", { level: "info", message: `navigating to ${data.url}` });
        await navigateViaCDP(connectUrl, data.url, {
          signal: run.abort.signal,
          timeoutMs: 30_000,
          onLog: (m) => emit(runId, "log", { level: "debug", message: m }),
        });
        if (isTerminated(runId)) return;
        emit(runId, "log", { level: "info", message: "navigation complete" });
        await terminate(runId, "done", { aborted: false });
      } catch (err) {
        if (isTerminated(runId)) return;
        const message = err instanceof Error ? err.message : String(err);
        if (run.abort.signal.aborted) {
          await terminate(runId, "done", { aborted: true, reason: "aborted" });
        } else {
          await terminate(runId, "error", { message });
        }
      }
    })();

    return { runId, liveUrl, sessionId };
  });

export const stopTestRun = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ runId: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const run = getRun(data.runId);
    if (!run) return { stopped: false, reason: "not_found" };
    await terminate(data.runId, "done", { aborted: true, reason: "user_stop" });
    return { stopped: true };
  });
