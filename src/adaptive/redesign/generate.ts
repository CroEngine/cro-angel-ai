// Fas 3 (slice 2) — redesign generation + guard.
//
// Given the assembled brief (slice 1), get the design LLM to propose a short list
// of reversible ops, then VALIDATE them — the LLM is never trusted. An op
// survives only if (a) its verb is in the allowed vocabulary and (b) its target
// is a section THAT EXISTS on the page. That structurally enforces "never
// invent": you cannot move / retext / reveal something that isn't already there.
//
// Pure + framework-free. The actual model call is injected (see generate.server.ts
// for the Anthropic adapter) so this stays unit-testable with a stub.

import { renderRedesignPrompt, type RedesignContext } from "./context";
import { introducedClaims } from "./claims";

export interface RedesignOp {
  op: "move_up" | "set_text" | "condense" | "reveal";
  /** An EXISTING section id from the content model (the [bracketed] ids). */
  targetId: string;
  detail: string;
  why: string;
}

export interface RedesignPlan {
  /** Validated, safe-to-preflight ops. */
  ops: RedesignOp[];
  /** LLM proposals that failed the guard, with why — surfaced, never silently dropped. */
  rejected: { op: unknown; reason: string }[];
  /** The LLM's own note (e.g. "segment too thin, no change proposed"). */
  note?: string;
}

/** "En liten ändring i taget" — cap how much one variant may touch. */
export const MAX_OPS = 5;

/** Extract the ops payload from the LLM's raw text (tolerates ```json fences and
 *  either a bare array or a { ops, note } object). Never throws. */
export function parseOpsResponse(text: string): { ops: unknown[]; note?: string } {
  const cleaned = text
    .replace(/^```(json)?/i, "")
    .replace(/```$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ops: [] };
  }
  if (Array.isArray(parsed)) return { ops: parsed };
  if (parsed && typeof parsed === "object") {
    const o = parsed as { ops?: unknown; note?: unknown };
    return {
      ops: Array.isArray(o.ops) ? o.ops : [],
      note: typeof o.note === "string" ? o.note : undefined,
    };
  }
  return { ops: [] };
}

/** The set of targets an op may legally reference: the page's existing section
 *  ids (+ a synthetic "hero" when the page has a hero block). Anything else is a
 *  fabricated target and is rejected. */
function validTargets(ctx: RedesignContext): Set<string> {
  const ids = new Set(ctx.content.sections.map((s) => s.id));
  if (ctx.content.hero) ids.add("hero");
  return ids;
}

/** Ops that REWRITE copy (their `detail` is the literal new text) and therefore
 *  need the semantic claims guard. move_up / reveal only move blocks. */
const REWRITE_OPS = new Set(["set_text", "condense"]);

/** All the text the page ALREADY publishes — the grounding corpus a rewrite's new
 *  copy is checked against. A set_text/condense may re-tighten any of this, but
 *  may not introduce a number / superlative / promise that appears nowhere in it. */
function groundingCorpus(ctx: RedesignContext): string {
  const c = ctx.content;
  return [
    c.hero?.headline,
    c.hero?.subheadline,
    ...c.sections.map((s) => s.heading),
    ...c.trustSignals.map((t) => t.text),
    ...c.ctas.map((t) => t.text),
  ]
    .filter(Boolean)
    .join(" \n ");
}

/** Validate raw LLM ops against the guardrails + content model. Pure. Every
 *  surviving op is expressible as a reversible op on EXISTING content. */
export function validateOps(rawOps: unknown[], ctx: RedesignContext): RedesignPlan {
  const allowed = new Set(ctx.guardrails.ops);
  const targets = validTargets(ctx);
  const corpus = groundingCorpus(ctx);
  const ops: RedesignOp[] = [];
  const rejected: { op: unknown; reason: string }[] = [];

  for (const raw of rawOps) {
    if (ops.length >= MAX_OPS) {
      rejected.push({ op: raw, reason: `over MAX_OPS (${MAX_OPS}) — keep changes minimal` });
      continue;
    }
    if (!raw || typeof raw !== "object") {
      rejected.push({ op: raw, reason: "not an object" });
      continue;
    }
    const o = raw as Record<string, unknown>;
    const op = typeof o.op === "string" ? o.op : "";
    const targetId = typeof o.targetId === "string" ? o.targetId : "";
    const detail = typeof o.detail === "string" ? o.detail : "";
    if (!allowed.has(op)) {
      rejected.push({ op: raw, reason: `op "${op}" not in allowed vocabulary` });
      continue;
    }
    if (!targets.has(targetId)) {
      rejected.push({
        op: raw,
        reason: `targetId "${targetId}" is not an existing section (invented)`,
      });
      continue;
    }
    // Semantic guard: a rewrite's new copy may re-tighten existing text but must
    // not fabricate a number / superlative / promise absent from the page.
    if (REWRITE_OPS.has(op) && detail) {
      const invented = introducedClaims(detail, corpus);
      if (invented.length > 0) {
        rejected.push({
          op: raw,
          reason: `"${op}" introduces claim(s) not on the page: ${invented
            .map((c) => `${c.text} (${c.kind})`)
            .join(", ")}`,
        });
        continue;
      }
    }
    ops.push({
      op: op as RedesignOp["op"],
      targetId,
      detail,
      why: typeof o.why === "string" ? o.why : "",
    });
  }
  return { ops, rejected };
}

/** Generate a validated redesign plan for one segment. `complete` performs the
 *  actual model call (prompt + screenshot → raw text); it is injected so this is
 *  testable and provider-agnostic. Returns an empty plan (never throws) when the
 *  model is unavailable. */
export async function generateRedesign(
  ctx: RedesignContext,
  complete: (prompt: string, screenshotPath: string) => Promise<string | null>,
): Promise<RedesignPlan> {
  const raw = await complete(renderRedesignPrompt(ctx), ctx.page.screenshotPath);
  if (raw === null || raw.trim() === "") {
    return { ops: [], rejected: [], note: "generation unavailable (no model / empty response)" };
  }
  const { ops, note } = parseOpsResponse(raw);
  const plan = validateOps(ops, ctx);
  return { ...plan, note: note ?? plan.note };
}
