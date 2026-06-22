#!/usr/bin/env bun
// The Angel CLI — run the advisory CRO read over a frozen page's projection.
//
// The Angel is the non-deterministic narrative layer. It consumes the
// DETERMINISTIC `golden.croProjection` and turns it into prioritized, plain-
// language recommendations. It never writes back into the golden — the
// "same MHTML + same extractor → same golden" contract is untouched.
//
// Usage:
//   bun run angel --name=hubspot                 # read corpus/hubspot/golden.json
//   bun run angel --golden=path/to/golden.json   # read an explicit golden
//   bun run angel --demo                          # built-in example projection
//   bun run angel --name=hubspot --dry-run        # print the prompt, don't call
//   bun run angel --demo --effort=medium          # tune reasoning depth
//
// Needs ANTHROPIC_API_KEY unless --dry-run. With --dry-run it prints the exact
// prompt that WOULD be sent, so it's useful even with no key and no corpus.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { projectCro } from "../src/lib/tests/croProjection";
import { scoreCro } from "../src/lib/tests/croScore";
import type { CroProjection } from "../src/lib/tests/croProjection";
import { ANGEL_MODEL, ANGEL_SYSTEM_PROMPT, buildAngelUserPrompt } from "../src/lib/tests/angel";
import { runAngel, AngelConfigError } from "../src/lib/tests/angel.server";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// A small, realistic example so the CLI is demonstrable without a corpus.
// Built through the real projectCro/scoreCro path, not hand-faked — a generic
// SaaS landing whose primary CTA loses salience and competes above the fold.
function demoProjection(): CroProjection {
  const collect = {
    elements: [
      {
        text: "Get a demo",
        category: "cta_primary",
        intent: "conversion",
        section: "hero",
        aboveFold: true,
        visible: true,
        score: 62,
      },
      {
        text: "Start free trial",
        category: "cta_secondary",
        intent: "conversion",
        section: "hero",
        aboveFold: true,
        visible: true,
        score: 58,
      },
      {
        text: "Watch the keynote",
        category: "cta_secondary",
        intent: "engagement",
        section: "hero",
        aboveFold: true,
        visible: true,
        score: 88,
      },
      ...Array.from({ length: 7 }, (_, i) => ({
        text: `Nav ${i + 1}`,
        category: "nav_item",
        intent: "navigation",
        section: "nav",
        aboveFold: true,
        visible: true,
        score: 20,
      })),
    ],
  };
  const pageAudit = {
    hero: { headline: "The platform for modern teams" },
    headings: { h1Count: 1, h1Texts: ["The platform for modern teams"] },
    trustSummary: { total: 1, aboveFold: 0, byType: { customer_logos: 1 } },
    images: { total: 6, missingAlt: 2 },
    head: { title: "Acme — The platform for modern teams" },
    sectionOrder: ["nav", "hero", "logos", "features", "pricing", "footer"],
  };
  const croScore = scoreCro({ collect, pageAudit });
  return projectCro({ collect, pageAudit, croScore });
}

function loadProjection(): { projection: CroProjection; source: string } {
  if (flag("demo")) return { projection: demoProjection(), source: "built-in demo" };

  const explicit = arg("golden");
  const name = arg("name");
  const path = explicit ?? (name ? join("corpus", name, "golden.json") : undefined);
  if (!path) {
    throw new Error(
      "Provide --name=<corpus>, --golden=<path>, or --demo.\n" +
        "  e.g. bun run angel --name=hubspot   (reads corpus/hubspot/golden.json)\n" +
        "       bun run angel --demo            (built-in example, no corpus needed)",
    );
  }
  if (!existsSync(path)) {
    throw new Error(
      `No golden at ${path}. Freeze + snapshot the site first ` +
        `(bun run freeze --url=… --name=… ; bun run snapshot:update), or use --demo.`,
    );
  }
  const golden = JSON.parse(readFileSync(path, "utf8"));
  // Prefer the stored projection; recompute from collect+pageAudit for older
  // goldens that predate croProjection (keeps the CLI forward/backward safe).
  const projection: CroProjection =
    golden.croProjection ??
    projectCro({
      collect: golden.collect,
      pageAudit: golden.pageAudit,
      croScore: golden.croScore ?? scoreCro(golden),
    });
  return { projection, source: path };
}

function printReport(r: Awaited<ReturnType<typeof runAngel>>): void {
  const { report, model, usage } = r;
  console.log("");
  console.log("╔" + "═".repeat(72));
  console.log("║ " + report.headline);
  console.log("╚" + "═".repeat(72));
  console.log("");
  console.log(report.summary);
  console.log("");
  report.recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. [${rec.priority.toUpperCase()}] ${rec.title}`);
    console.log(`   Dimension : ${rec.dimension}`);
    console.log(`   Problem   : ${rec.problem}`);
    console.log(`   Fix       : ${rec.recommendation}`);
    console.log(`   Impact    : ${rec.expectedImpact}`);
    if (rec.evidence.length) console.log(`   Evidence  : ${rec.evidence.join("; ")}`);
    console.log("");
  });
  console.log(`— ${model} · ${usage.inputTokens} in / ${usage.outputTokens} out tokens`);
}

async function main(): Promise<number> {
  const { projection, source } = loadProjection();
  console.error(
    `Angel · ${source} · ${projection.pageType} (conf ${projection.pageTypeConfidence}) · ` +
      `score ${projection.score.overall}/100 ${projection.score.grade} · ${projection.priorities.length} priorities`,
  );

  if (flag("dry-run")) {
    console.log("=== SYSTEM ===\n");
    console.log(ANGEL_SYSTEM_PROMPT);
    console.log("\n=== USER ===\n");
    console.log(buildAngelUserPrompt(projection));
    console.log(`\n=== (dry run — would call ${ANGEL_MODEL}) ===`);
    return 0;
  }

  try {
    const result = await runAngel(projection, {
      effort: arg("effort") as "low" | "medium" | "high" | "xhigh" | "max" | undefined,
    });
    printReport(result);
    return 0;
  } catch (e) {
    if (e instanceof AngelConfigError) {
      console.error(`\n${e.message}\n`);
      console.error("Tip: re-run with --dry-run to see the exact prompt without a key.");
      return 2;
    }
    throw e;
  }
}

main().then((code) => process.exit(code));
