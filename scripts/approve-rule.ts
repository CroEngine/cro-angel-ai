#!/usr/bin/env bun
// E4b — the approval state machine, CLI form. Flips one rule's status in a
// rules file: proposed → approved (records approvedAt), or --pause/--retire
// for the reverse directions. In the product this is the card's button; the
// state format is what matters — serving only ever reads `approved`.
//
//   bun run scripts/approve-rule.ts --rules=<file> --rule=<id> [--pause|--retire]

import { readFileSync, writeFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const rulesPath = arg("rules");
const ruleId = arg("rule");
if (!rulesPath || !ruleId) {
  console.error("usage: approve-rule.ts --rules=<file> --rule=<id> [--pause|--retire]");
  process.exit(1);
}

const rules = JSON.parse(readFileSync(rulesPath, "utf8")) as Array<{
  id: string;
  status: string;
  approvedAt?: string;
}>;
const rule = rules.find((r) => r.id === ruleId);
if (!rule) {
  console.error(`rule "${ruleId}" not found in ${rulesPath}`);
  process.exit(1);
}

const from = rule.status;
if (flag("retire")) rule.status = "retired";
else if (flag("pause")) rule.status = "paused";
else {
  rule.status = "approved";
  rule.approvedAt = new Date().toISOString();
}
writeFileSync(rulesPath, JSON.stringify(rules, null, 1));
console.log(`${ruleId}: ${from} → ${rule.status}`);
