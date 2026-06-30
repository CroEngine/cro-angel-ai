import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
// Type-only — erased by esbuild, contributes nothing to the runtime graph.
// Keep as `import type` so a future refactor can't accidentally promote it
// to a value import and re-leak Stagehand into Worker isolate-init.
import type { Step } from "./engine.server";

export function newRunId() {
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
  // When set, the page audit's content is mapped to a ContentInventory and
  // persisted for this site slug (live-crawler → saveInventory).
  ingestSite: z.string().min(1).optional(),
});

export function defaultSteps(url: string): Step[] {
  // collect runs BEFORE pageAudit so the screenshot is captured even if
  // pageAudit later fails or times out.
  return [
    { kind: "goto", url },
    { kind: "wait", ms: 500 },
    { kind: "collect", target: "clickables" },
    { kind: "pageAudit" },
  ];
}

// Build the final step list: ensure the run starts with a goto for the URL.
export function buildSteps(url: string, steps?: Step[]): Step[] {
  let final: Step[] = steps && steps.length > 0 ? steps : defaultSteps(url);
  if (final[0]?.kind !== "goto") {
    final = [{ kind: "goto", url }, ...final];
  }
  return final;
}

// startTestRun only opens the Browserbase session and hands the client back a
// liveUrl + sessionId. The crawl itself is driven by the SSE stream request
// (`/api/tests/$runId/stream`) so that step execution happens INSIDE a
// long-lived streaming request that the serverless host keeps alive.
//
// Why: a previous version ran the steps in a fire-and-forget background task
// after the HTTP response returned. On serverless hosts (Netlify Functions)
// the execution context is frozen once the response is sent, so the crawl
// never actually ran. Driving it from the stream request fixes that and also
// removes the need for a cross-instance, process-local event bus.
export const startTestRun = createServerFn({ method: "POST" })
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const runId = newRunId();

    try {
      // Lazy-load the heavy Stagehand/Browserbase chain so it isn't evaluated
      // at Worker isolate init. See .lovable/plan.md (Phase 2a).
      const bb = await import("./browserbase.server");
      const session = await bb.createSession();
      return { runId, liveUrl: session.liveUrl, sessionId: session.id, url: data.url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create Browserbase session: ${message}`);
    }
  });
