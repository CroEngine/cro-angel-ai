#!/usr/bin/env bun
// E4b — the approval state machine, CLI form. Flips one rule's status in a
// rules file: proposed → approved (records approvedAt), or --pause/--retire
// for the reverse directions. In the product this is the card's button; the
// state format is what matters — serving only ever reads `approved`.
//
// Approving a rule ALSO approves its success contract (primary metric +
// guardrails). A rule without one gets the site-type default filled in at
// approval time — the owner never activates a rule with an undefined
// definition of winning.
//
//   bun run scripts/approve-rule.ts --rules=<file> --rule=<id> [--pause|--retire]

import { readFileSync, writeFileSync } from "node:fs";

import { defaultSuccessSpec, metricById, type SuccessSpec } from "../src/adaptive/metrics";

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
  success?: SuccessSpec;
}>;
const rule = rules.find((r) => r.id === ruleId);
if (!rule) {
  console.error(`rule "${ruleId}" not found in ${rulesPath}`);
  process.exit(1);
}

function describeSuccess(s: SuccessSpec): string {
  const primary = metricById(s.primary)?.label ?? s.primary;
  const guards = s.guardrails.map((g) => metricById(g)?.label ?? g).join(", ") || "inga";
  return `primärt mål: ${primary} (MDE ±${Math.round((s.mdeRel ?? 0.1) * 100)}%) · guardrails (pausar vid skada): ${guards}`;
}

const from = rule.status;
if (flag("retire")) rule.status = "retired";
else if (flag("pause")) rule.status = "paused";
else {
  if (!rule.success) {
    rule.success = defaultSuccessSpec();
    console.log(`success-kontrakt saknades — sajttypens standard fylls i och godkänns med regeln`);
  }
  rule.status = "approved";
  rule.approvedAt = new Date().toISOString();
  console.log(`godkänner även framgångsdefinitionen — ${describeSuccess(rule.success)}`);
}
writeFileSync(rulesPath, JSON.stringify(rules, null, 1));
console.log(`${ruleId}: ${from} → ${rule.status}`);
