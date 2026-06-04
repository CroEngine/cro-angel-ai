// Noise-floor harness — runs the same URL N times via the existing test
// pipeline and diffs each step's `data` payload field-by-field. Output:
// which fields vary at least once across runs (= unsafe regression signals).
//
// Manual dev tool. Not in CI. Invoke from a TanStack server function or
// a one-off script that has Browserbase credentials.
//
// Usage example (from a one-off route or REPL):
//   import { runNoiseFloor } from "@/lib/tests/scripts/noise-floor.server";
//   const report = await runNoiseFloor({
//     url: "https://www.hibob.com/se/",
//     runs: 5,
//     createSession: async () => { ... return sessionId; },
//     closeSession: async (id) => { ... },
//   });
//   console.log(JSON.stringify(report, null, 2));

import { runSteps } from "../engine.server";
import type { EngineEvent, Step } from "../schema";

export interface NoiseFloorOptions {
  url: string;
  runs?: number;
  /** Caller provides session lifecycle since this module is runtime-agnostic. */
  createSession: () => Promise<string>;
  closeSession: (sessionId: string) => Promise<void>;
}

export interface FieldDrift {
  path: string;
  uniqueValues: number;
  sample: unknown[];
}

export interface NoiseFloorReport {
  url: string;
  runs: number;
  drifting: FieldDrift[];
  stableFieldCount: number;
}

const DEFAULT_STEPS = (url: string): Step[] => [
  { kind: "goto", url },
  { kind: "wait", ms: 1200 },
  { kind: "collect", target: "clickables" },
  { kind: "pageAudit" },
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Flatten a value into { "path": leafValue } pairs.
 * Arrays use [length=N] + index keys for ordered comparison.
 * Numbers are bucketed to nearest 5 to absorb sub-pixel layout jitter
 * (rects, scores, etc.) — sub-pixel drift is expected and not interesting.
 */
function flatten(value: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value === null || value === undefined) {
    out[prefix || "$"] = value;
    return out;
  }
  if (typeof value === "number") {
    out[prefix || "$"] = Math.round(value / 5) * 5;
    return out;
  }
  if (typeof value !== "object") {
    out[prefix || "$"] = value;
    return out;
  }
  if (Array.isArray(value)) {
    out[`${prefix}.length`] = value.length;
    value.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

export async function runNoiseFloor(opts: NoiseFloorOptions): Promise<NoiseFloorReport> {
  const runs = opts.runs ?? 5;
  const steps = DEFAULT_STEPS(opts.url);
  const perRunData: Array<Record<string, unknown>> = [];

  for (let i = 0; i < runs; i++) {
    const sessionId = await opts.createSession();
    const stepData: Record<string, unknown> = {};
    try {
      await runSteps(sessionId, steps, {
        onEvent: (e: EngineEvent) => {
          if (e.type === "step_passed" && e.data !== undefined) {
            stepData[`${e.index}:${e.kind}`] = e.data;
          }
        },
      });
    } finally {
      try { await opts.closeSession(sessionId); } catch { /* ignore */ }
    }
    perRunData.push(stepData);
    // eslint-disable-next-line no-console
    console.log(`[noise-floor] run ${i + 1}/${runs} done`);
  }

  // Build flattened maps per run, then collect every path seen.
  const flattenedRuns = perRunData.map((d) => flatten(d));
  const allPaths = new Set<string>();
  for (const f of flattenedRuns) for (const k of Object.keys(f)) allPaths.add(k);

  const drifting: FieldDrift[] = [];
  let stable = 0;
  for (const path of allPaths) {
    const values = flattenedRuns.map((f) => f[path]);
    const serialized = new Set(values.map((v) => JSON.stringify(v)));
    if (serialized.size > 1) {
      drifting.push({
        path,
        uniqueValues: serialized.size,
        sample: Array.from(serialized).slice(0, 4).map((s) => JSON.parse(s)),
      });
    } else {
      stable++;
    }
  }

  drifting.sort((a, b) => b.uniqueValues - a.uniqueValues || a.path.localeCompare(b.path));
  return {
    url: opts.url,
    runs,
    drifting,
    stableFieldCount: stable,
  };
}
