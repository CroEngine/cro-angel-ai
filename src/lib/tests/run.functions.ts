import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createSession, closeSession } from "./browserbase.server";
import { createRun, emit, terminate, getRun, isTerminated } from "./orchestrator.server";
import { runSteps, type Step } from "./engine.server";

function newRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const stepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("goto"), url: z.string().url() }),
  z.object({ kind: z.literal("wait"), ms: z.number().int().min(0).max(60_000) }),
  z.object({ kind: z.literal("assertText"), text: z.string().min(1) }),
  z.object({ kind: z.literal("click"), selector: z.string().min(1) }),
  z.object({ kind: z.literal("fill"), selector: z.string().min(1), value: z.string() }),
  z.object({ kind: z.literal("act"), instruction: z.string().min(1) }),
  z.object({ kind: z.literal("extract"), instruction: z.string().min(1) }),
  z.object({ kind: z.literal("observe"), instruction: z.string().min(1) }),
  z.object({ kind: z.literal("collect"), target: z.enum(["clickables", "buttons"]) }),
  z.object({ kind: z.literal("pageAudit") }),
]);

const inputSchema = z.object({
  url: z.string().url(),
  steps: z.array(stepSchema).max(50).optional(),
});

function defaultSteps(url: string): Step[] {
  // collect runs BEFORE pageAudit so the screenshot is captured even if
  // pageAudit later fails or times out.
  return [
    { kind: "goto", url },
    { kind: "wait", ms: 500 },
    { kind: "collect", target: "clickables" },
    { kind: "pageAudit" },
  ];
}


export const startTestRun = createServerFn({ method: "POST" })
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const runId = newRunId();

    // Build final steps: ensure run starts with a goto for the requested URL.
    let steps: Step[] = data.steps && data.steps.length > 0 ? data.steps : defaultSteps(data.url);
    if (steps[0]?.kind !== "goto") {
      steps = [{ kind: "goto", url: data.url }, ...steps];
    }

    let session;
    try {
      session = await createSession();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create Browserbase session: ${message}`);
    }

    const { id: sessionId, liveUrl } = session;

    const run = createRun(runId, async () => {
      await closeSession(sessionId);
    });

    emit(runId, "session_started", { runId, sessionId, liveUrl });

    // Kick off execution async — do NOT await. Frontend gets liveUrl immediately.
    (async () => {
      try {
        emit(runId, "log", { level: "info", message: `running ${steps.length} step(s)` });

        let firstGotoPassed = false;
        const result = await runSteps(sessionId, steps, {
          signal: run.abort.signal,
          onEvent: (e) => {
            if (isTerminated(runId)) return;
            if (e.type === "log") {
              emit(runId, "log", { level: "debug", message: e.message });
              return;
            }
            const payload: Record<string, unknown> = {
              index: e.index,
              kind: e.kind,
              summary: e.summary,
            };
            if (e.type === "step_started") {
              emit(runId, "step_started", payload);
            } else if (e.type === "step_passed") {
              payload.durationMs = e.durationMs;
              if (e.data !== undefined) payload.data = e.data;
              emit(runId, "step_passed", payload);
              // Promote first successful goto so the live iframe flips to "idle".
              if (!firstGotoPassed && e.kind === "goto") {
                firstGotoPassed = true;
                emit(runId, "state", { phase: "idle" });
              }
            } else if (e.type === "step_failed") {
              payload.durationMs = e.durationMs;
              payload.error = e.error;
              emit(runId, "step_failed", payload);
            }
          },
        });

        if (isTerminated(runId)) return;
        if (result.failed > 0) {
          await terminate(runId, "error", {
            message: `${result.failed} step(s) failed`,
            passed: result.passed,
            failed: result.failed,
          });
        } else {
          // Close the Browserbase session immediately after steps complete.
          // The client transitions to the "Frozen" view using the screenshot
          // captured during the collect step, so the user keeps seeing the page
          // without us paying for an idle session.
          await terminate(runId, "done", {
            aborted: result.aborted,
            passed: result.passed,
            failed: result.failed,
          });
        }

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
