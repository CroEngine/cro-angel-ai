#!/usr/bin/env bun
// Claude Designer — SOLVE (E3-lite step 2): brief → reorder plan.
//
// Two transports:
//   --transport=api   Claude API (claude-opus-4-8, schema-enforced JSON) — the
//                     production path. Requires network that admits API-key
//                     auth to api.anthropic.com (the CC-sandbox gateway does
//                     NOT; run this from your own machine/CI there).
//   --transport=file  The designer answers out-of-band: this mode prints the
//                     exact same prompt per site and expects the plan at
//                     designer/plans/<site>.json. Used to validate the loop
//                     end-to-end where the API is unreachable.
//
//   bun build scripts/designer-solve.ts --target=node --format=esm \
//     --outfile=dsolve.node.mjs --external @anthropic-ai/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
//     node dsolve.node.mjs --transport=api --names=clickup,... [--round=2]
//
// Round ≥2 feeds each failed plan + its real-page failure reason back to the
// designer — the reloop that "talks to the LLM until it lands".

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const BASE =
  "/tmp/claude-0/-home-user-cro-angel-ai/c11460d4-452b-5901-aaf1-829bf613facc/scratchpad/designer";
const BRIEFS = `${BASE}/briefs`;
const PLANS = `${BASE}/plans`;

function arg(name: string, dflt?: string): string | undefined {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length) ?? dflt;
}

// The plan schema — strict JSON schema for output_config.format. The executor
// (applyPlannedReorder) re-validates semantics on the live page regardless.
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "container", "move", "after", "mode", "rationale"],
  properties: {
    action: { type: "string", enum: ["reorder", "refuse"] },
    container: { anyOf: [{ type: "string" }, { type: "null" }] },
    move: { anyOf: [{ type: "string" }, { type: "null" }] },
    after: { anyOf: [{ type: "string" }, { type: "null" }] },
    mode: { anyOf: [{ type: "string", enum: ["flex", "grid"] }, { type: "null" }] },
    rationale: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You are the layout solver for Angel Adaptive, a snippet that adapts third-party marketing pages using only safe, reversible CSS changes.

GOAL: surface the page's PROOF section (testimonials) earlier — ideally right after the hero — on pages where the automatic solver refused. You receive a structural brief: the page's detected sections, the automatic attempt trail with named refusal reasons, and a "ladder" of candidate containers (from the common ancestor of hero+proof down to the proof's own parent), each with its direct children.

MECHANICS (what a plan can do):
- A reorder happens INSIDE one container: its direct children get CSS \`order\` values; the child carrying the proof moves after a chosen sibling (or to the front). The DOM never changes.
- Block-stacked containers are promoted to flex-column (mode "flex") or single-column grid (mode "grid"). Grid stretches children like block flow and can avoid the width/height drift that flex promotion sometimes causes — prefer "grid" when the trail shows check-width-left or check-height at that container.
- Every plan is re-verified on the live page: siblings must keep width/left (±2px) and height (±12px), no overlaps, page height within 3%, the proof must lift ≥200px, never land above the hero, never land <300px from the page top, and the moved child must not carry other detected sections. A failed check rolls back invisibly and you get the named reason.

RULES:
1. Copy selectors EXACTLY from the brief ("selector" fields). Never invent selectors.
2. "move" must be the proof section itself or a child marked hasProof:true whose "sections" list contains ONLY the proof index (never a wrapper that also carries other sections).
3. "container" must be a ladder container (or a listed child that is an ancestor of the proof). "after" must be a child selector FROM THAT SAME container, or null for front-of-group.
4. Prefer the smallest move that still yields a meaningful lift. Landing right after the hero child is ideal; front-of-group is fine when the container sits below the hero.
5. The refusal trail tells you what already failed — do not repeat a failed attempt unchanged; change the container, the anchor, or the mode.
6. If no safe move exists (every child that carries the proof also carries other sections, or every container has <2 usable children), answer action "refuse" with a short rationale. Refusal is a correct answer.
7. "rationale": 1-2 sentences, written for the site owner (why this improves the page for engaged non-clicking visitors).

OUTPUT: one JSON object per the schema. action "refuse" → container/move/after/mode all null.`;

type Feedback = { plan: unknown; failReason: string } | null;

function userPrompt(brief: unknown, feedback: Feedback): string {
  let p = `BRIEF:\n${JSON.stringify(brief, null, 1)}`;
  if (feedback) {
    p +=
      `\n\nPREVIOUS ATTEMPT (round feedback): your earlier plan\n` +
      `${JSON.stringify(feedback.plan)}\n` +
      `was executed on the live page and FAILED with reason: "${feedback.failReason}".\n` +
      `Propose a different plan (other container, other anchor, or other mode) — or refuse if you now judge no safe move exists.`;
  }
  return p;
}

type Plan = {
  action: "reorder" | "refuse";
  container: string | null;
  move: string | null;
  after: string | null;
  mode: "flex" | "grid" | null;
  rationale: string;
};

function planShapeError(plan: Plan): string | null {
  if (plan.action === "refuse") return null;
  if (!plan.container) return "container missing";
  if (!plan.move) return "move missing";
  if (plan.mode !== "flex" && plan.mode !== "grid") return "mode missing";
  return null;
}

async function solveViaApi(
  client: Anthropic,
  brief: unknown,
  feedback: Feedback,
): Promise<{ plan: Plan; usage: unknown }> {
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: PLAN_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            userPrompt(brief, feedback) +
            (lastErr ? `\n\nYour previous output was invalid: ${lastErr}. Emit valid JSON per the schema.` : ""),
        },
      ],
    } as Parameters<typeof client.messages.create>[0]);
    const msg = resp as { content: Array<{ type: string; text?: string }>; usage: unknown; stop_reason: string };
    if (msg.stop_reason === "refusal") throw new Error("model refused the request");
    const text = msg.content.find((b) => b.type === "text")?.text ?? "";
    try {
      const plan = JSON.parse(text) as Plan;
      const shapeErr = planShapeError(plan);
      if (shapeErr) {
        lastErr = shapeErr;
        continue;
      }
      return { plan, usage: msg.usage };
    } catch {
      lastErr = "not parseable as JSON";
    }
  }
  throw new Error(`no valid plan after retries (${lastErr})`);
}

async function main() {
  const transport = arg("transport", "file")!;
  const round = Number(arg("round", "1"));
  const names = (arg("names") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!names.length) {
    console.error("pass --names=a,b,c");
    process.exit(1);
  }
  mkdirSync(PLANS, { recursive: true });

  const feedbackFile = `${BASE}/feedback-round${round - 1}.json`;
  const feedback: Record<string, { plan: unknown; failReason: string }> =
    round > 1 && existsSync(feedbackFile) ? JSON.parse(readFileSync(feedbackFile, "utf8")) : {};

  let client: Anthropic | null = null;
  if (transport === "api") {
    const apiKey = process.env.Claude_API ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("no API key (Claude_API / ANTHROPIC_API_KEY)");
    client = new Anthropic({ apiKey });
  }

  for (const name of names) {
    const briefPath = `${BRIEFS}/${name}.json`;
    if (!existsSync(briefPath)) {
      console.log(`  ${name.padEnd(12)} NO BRIEF (run designer-brief first)`);
      continue;
    }
    const brief = JSON.parse(readFileSync(briefPath, "utf8"));
    const fb = feedback[name] ?? null;

    if (transport === "api") {
      try {
        const { plan, usage } = await solveViaApi(client!, brief, fb);
        writeFileSync(`${PLANS}/${name}.json`, JSON.stringify(plan, null, 1));
        console.log(
          `  ${name.padEnd(12)} ${plan.action.toUpperCase()} · ${JSON.stringify(usage)} · ${plan.rationale.slice(0, 70)}`,
        );
      } catch (err) {
        console.log(`  ${name.padEnd(12)} API FAIL ${err instanceof Error ? err.message : err}`);
      }
    } else {
      // file transport: emit the exact prompt the API path would send; the
      // designer answers into designer/plans/<site>.json out-of-band.
      const promptPath = `${BASE}/prompts/${name}${round > 1 ? `-round${round}` : ""}.txt`;
      mkdirSync(`${BASE}/prompts`, { recursive: true });
      writeFileSync(promptPath, `SYSTEM:\n${SYSTEM_PROMPT}\n\nUSER:\n${userPrompt(brief, fb)}\n`);
      const has = existsSync(`${PLANS}/${name}.json`);
      console.log(`  ${name.padEnd(12)} prompt → ${promptPath}${has ? " (plan present)" : " (awaiting plan)"}`);
    }
  }
}

main().catch((e) => {
  console.error("solve failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
