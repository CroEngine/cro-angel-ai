// The Angel — server IO. Calls Claude over the lean projection and returns a
// validated advisory report. This is the ONLY place the Anthropic SDK is
// touched; the schema and the (deterministic) prompt live in the pure angel.ts.
//
// Determinism boundary: this module is never imported by the snapshot/golden
// pipeline. It is an advisory consumer of `golden.croProjection`, run on demand
// (CLI / API handler), never written back into the golden.

import Anthropic from "@anthropic-ai/sdk";

import type { CroProjection } from "./croProjection";
import {
  ANGEL_EFFORT,
  ANGEL_MAX_TOKENS,
  ANGEL_MODEL,
  ANGEL_SYSTEM_PROMPT,
  AngelReportSchema,
  buildAngelOutputFormat,
  buildAngelUserPrompt,
  type AngelReport,
} from "./angel";

// Thrown when the call can't run because the environment isn't configured —
// distinct from an API error, so callers can give a clean "set your key" hint.
export class AngelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AngelConfigError";
  }
}

export interface AngelResult {
  report: AngelReport;
  model: string;
  stopReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

export interface RunAngelOptions {
  /** Override the API key (else read from ANTHROPIC_API_KEY per-call). */
  apiKey?: string;
  /** Request timeout in ms. Generous default: adaptive thinking can run long. */
  timeoutMs?: number;
  /** Effort level for the rubric read. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * Run the Angel over a deterministic projection and return a validated report.
 * Pure prompt in, advisory narrative out. Throws AngelConfigError if no API key.
 */
export async function runAngel(
  projection: CroProjection,
  opts: RunAngelOptions = {},
): Promise<AngelResult> {
  // Read env INSIDE the function (server-config convention) so it resolves
  // per-request on Workers, not at module load.
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AngelConfigError(
      "ANTHROPIC_API_KEY is not set. The Angel needs a Claude API key to run — " +
        "set ANTHROPIC_API_KEY in the environment, or pass { apiKey } to runAngel().",
    );
  }

  const client = new Anthropic({ apiKey });

  // messages.parse: structured output validated against the Zod schema. The
  // CRO report is a bounded structured artifact (a handful of recommendations),
  // so a single parsed call is the right shape here — not open-ended streaming.
  // Adaptive thinking lets Opus reason over the signals; effort tunes depth.
  const response = await client.messages.parse(
    {
      model: ANGEL_MODEL,
      max_tokens: ANGEL_MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: {
        effort: opts.effort ?? ANGEL_EFFORT,
        format: buildAngelOutputFormat(),
      },
      system: ANGEL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildAngelUserPrompt(projection) }],
    },
    // Adaptive thinking can run for several minutes; give it room rather than
    // tripping the SDK's default request timeout.
    { timeout: opts.timeoutMs ?? 10 * 60 * 1000 },
  );

  if (response.stop_reason === "refusal") {
    throw new Error(
      `The Angel call was refused by the safety system (${
        response.stop_details?.explanation ?? "no detail"
      }).`,
    );
  }

  // parsed_output is populated when the model honored the schema. Fall back to
  // parsing the text block ourselves so a transient null doesn't lose the run.
  let report = response.parsed_output as AngelReport | null;
  if (!report) {
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const json = stripJsonFence(text);
    report = AngelReportSchema.parse(JSON.parse(json));
  }

  return {
    report,
    model: response.model,
    stopReason: response.stop_reason,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

// If the model wrapped JSON in a ```json fence, peel it. No-op otherwise.
function stripJsonFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return (fenced ? fenced[1] : text).trim();
}
