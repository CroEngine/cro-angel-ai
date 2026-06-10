#!/usr/bin/env bun
// CLI: kör render-canary genom replayCorpus mot en eller alla siter i SITES.
//
//   bun run scripts/render-canary.ts --name=hibob
//   bun run scripts/render-canary.ts --all
//
// Exit 1 om någon site fail:ar canary-gaten. Rapporten per site skrivs av
// replayCorpus till corpus/<name>/render-canary.json.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { replayCorpus } from "../src/lib/tests/snapshot/harness.server";
import { SITES } from "../corpus/sites";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const name = arg("name");
const all = flag("all");

if (!name && !all) {
  console.error("Usage: bun run scripts/render-canary.ts (--name=<name> | --all)");
  process.exit(1);
}

const targets = all ? SITES.map((s) => s.name) : [name!];

interface Row {
  name: string;
  ok: boolean;
  expected: number;
  missing: number;
  unused: number;
  failures: string[];
  error?: string;
}

const rows: Row[] = [];

for (const target of targets) {
  process.stdout.write(`[canary] ${target} ... `);
  try {
    await replayCorpus(target);
    const reportPath = join("corpus", target, "render-canary.json");
    if (!existsSync(reportPath)) {
      rows.push({
        name: target,
        ok: false,
        expected: 0,
        missing: 0,
        unused: 0,
        failures: ["render-canary.json saknas efter replay"],
      });
      console.log("FAIL (no report)");
      continue;
    }
    const r = JSON.parse(readFileSync(reportPath, "utf8"));
    rows.push({
      name: target,
      ok: !!r.ok,
      expected: r.expected?.length ?? 0,
      missing: r.missing?.length ?? 0,
      unused: r.unusedRegistered?.length ?? 0,
      failures: r.failures ?? [],
    });
    console.log(r.ok ? "OK" : "FAIL");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    rows.push({
      name: target,
      ok: false,
      expected: 0,
      missing: 0,
      unused: 0,
      failures: [],
      error: msg,
    });
    console.log(`THROW (${msg.split("\n")[0]})`);
  }
}

console.log("");
console.log("site                 ok  expected missing unused");
console.log("-----------------------------------------------");
for (const r of rows) {
  console.log(
    `${r.name.padEnd(20)} ${r.ok ? "✓ " : "✗ "} ${String(r.expected).padStart(8)} ${String(
      r.missing,
    ).padStart(7)} ${String(r.unused).padStart(6)}`,
  );
  if (r.error) console.log(`    error: ${r.error}`);
  for (const f of r.failures) console.log(`    - ${f}`);
}

const failed = rows.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} site(s) failed canary`);
  process.exit(1);
}
