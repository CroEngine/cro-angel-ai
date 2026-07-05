#!/usr/bin/env node
// Angel Adaptive — Synthetic Lab verdicts.
//
// Feeds the lab site's REAL persisted events through the EXACT attribution
// math the dashboard uses (aggregate.ts, bundled on the fly) and judges:
//
//   --expect lift  → the planted lift must be recovered and significant,
//                    and early signals must not contradict it.
//   --expect null  → NO significant lift may be called (false-positive guard).
//
//   node scripts/lab/verify-lab.mjs --events events.json --expect lift \
//     [--planted 0.20] [--tolerance 0.12]
//
// events.json: array of { type, payload, visitor_hash, decision_id, created_at }
// rows for ONE lab site (e.g. exported from angel_events).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const EVENTS_FILE = arg("events");
const EXPECT = arg("expect"); // lift | null
const PLANTED = parseFloat(arg("planted", "0.20"));
const TOLERANCE = parseFloat(arg("tolerance", "0.12"));
if (!EVENTS_FILE || !["lift", "null"].includes(EXPECT)) {
  console.error("Usage: verify-lab.mjs --events <file.json> --expect lift|null");
  process.exit(1);
}

// Bundle the dashboard's pure aggregator so the verdict uses the same math the
// customer sees — not a reimplementation.
const bundle = path.join(os.tmpdir(), `angel-aggregate-${Date.now()}.mjs`);
execFileSync(
  path.join(__dirname, "..", "..", "node_modules", ".bin", "esbuild"),
  [
    path.join(__dirname, "..", "..", "src", "lib", "dashboard", "aggregate.ts"),
    "--bundle",
    "--format=esm",
    `--outfile=${bundle}`,
  ],
  { stdio: "pipe" },
);
const { attribute } = await import(bundle);

const rows = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
const events = rows.map((r) => ({
  type: r.type,
  payload: r.payload ?? {},
  visitorHash: r.visitor_hash ?? null,
  decisionId: r.decision_id ?? null,
  createdAt: r.created_at,
}));

const attribution = attribute(events);
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---- coverage: every lever must have really fired and been recorded ---------
const shown = events.filter((e) => e.type === "adaptation_shown");
const changed = new Set(
  shown.flatMap((e) => (Array.isArray(e.payload.changes) ? e.payload.changes : []))
       .map((c) => c && c.pattern)
       .filter(Boolean),
);
for (const pattern of ["emphasize_goal", "sticky_goal_cta", "show_secondary_cta"]) {
  check(`lever recorded with changes: ${pattern}`, changed.has(pattern));
}
check(
  "conversions persisted",
  events.some((e) => e.type === "conversion"),
  `${events.filter((e) => e.type === "conversion").length} conversions`,
);
check(
  "scroll depth persisted",
  events.some((e) => e.type === "scroll_depth"),
);

// ---- the verdict: does the dashboard math recover the truth? ----------------
// Judge on the workhorse pattern every adapted visitor sees.
const row = attribution.find((r) => r.pattern === "emphasize_goal");
if (!row) {
  check("attribution row exists for emphasize_goal", false);
} else {
  const fmt = (v) => (v === null ? "null" : (v * 100).toFixed(1) + "pp");
  console.log(
    `  arms: adapted ${row.adapted.conversions}/${row.adapted.exposures}` +
      ` vs control ${row.control.conversions}/${row.control.exposures}` +
      ` → lift ${fmt(row.lift)} (z=${row.z?.toFixed(2)}, significant=${row.significant})`,
  );
  if (EXPECT === "lift") {
    check("lift recovered within tolerance", row.lift !== null && Math.abs(row.lift - PLANTED) <= TOLERANCE,
      `planted ${fmt(PLANTED)}, measured ${fmt(row.lift)}, tolerance ±${fmt(TOLERANCE)}`);
    check("lift called significant", row.significant === true);
    const microUp =
      row.adaptedMicro.deepScroll / Math.max(1, row.adapted.exposures) >=
      row.controlMicro.deepScroll / Math.max(1, row.control.exposures) - 0.15;
    check("early signals do not contradict the lift", microUp);
  } else {
    check(
      "NO significant lift called on a null effect",
      row.significant === false,
      `measured ${fmt(row.lift)} (z=${row.z?.toFixed(2)})`,
    );
  }
}

fs.unlinkSync(bundle);
const failed = checks.filter((c) => !c.ok);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
