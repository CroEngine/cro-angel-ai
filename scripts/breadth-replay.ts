#!/usr/bin/env bun
// Re-run only the replay step against already-frozen $BREADTH_ROOT/<name>/ (default fixtures/breadth-corpus/).
import { replayCorpus } from "../src/lib/tests/snapshot/harness.server";
import { FamiliesReceiptFileSchema } from "../src/lib/tests/snapshot/render-canary-receipt";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";

const BREADTH_ROOT = process.env.BREADTH_ROOT ?? "fixtures/breadth-corpus";
const SITES = ["stripe", "intercom", "vercel"];

interface Out {
  name: string;
  replayOk: boolean;
  replayError?: string;
  gate1Total?: number;
  gate1Registered?: number;
  perFamily?: Array<{ family: string; registered: boolean; reason?: string }>;
  classification?: Record<string, number>;
  // STALE-gren: försäkring mot skip-regen / framtida schema-bumps.
  // Normal replay-väg regenererar receipt via replayCorpus() före läsning,
  // så v0→v1-uppgradering sker automatiskt på första körningen.
  staleReceipt?: string;
}

const results: Out[] = [];

for (const name of SITES) {
  console.log(`\n=== [${name}] replay ===`);
  const r: Out = { name, replayOk: false };
  try {
    await replayCorpus(name, BREADTH_ROOT);
    r.replayOk = true;
  } catch (e) {
    r.replayError = e instanceof Error ? e.message.slice(0, 400) : String(e);
  }
  const famPath = join(BREADTH_ROOT, name, "render-canary.families.json");
  if (existsSync(famPath)) {
    try {
      const raw = JSON.parse(readFileSync(famPath, "utf8"));
      const fam = FamiliesReceiptFileSchema.parse(raw);
      r.perFamily = fam.families.map((f) => ({
        family: f.family,
        registered: f.gate1.pass,
        reason: f.gate1.reason,
      }));
      r.gate1Total = fam.families.length;
      r.gate1Registered = r.perFamily.filter((f) => f.registered).length;
      const cls: Record<string, number> = {};
      for (const f of r.perFamily) {
        const k = f.registered ? "OK" : (f.reason ?? "unknown");
        cls[k] = (cls[k] ?? 0) + 1;
      }
      r.classification = cls;
    } catch (e) {
      if (e instanceof ZodError) {
        const issue = e.issues[0];
        r.staleReceipt = `${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "drift"}`;
      } else {
        // FS/JSON-parse-fel är riktiga fel, inte stale-receipt.
        throw e;
      }
    }
  }
  results.push(r);
}

console.log("\n\n========= REPLAY SUMMARY =========\n");
for (const r of results) {
  console.log(`\n--- ${r.name} ---`);
  if (r.staleReceipt) {
    console.log(`  STALE: ${r.staleReceipt} — kör replay för att regenerera`);
    continue;
  }
  if (r.gate1Total == null) {
    console.log(`  no families file. error: ${r.replayError}`);
    continue;
  }
  console.log(
    `  Gate1: ${r.gate1Registered}/${r.gate1Total} registered · ${JSON.stringify(r.classification)}`,
  );
  const misses = (r.perFamily ?? []).filter((f) => !f.registered);
  if (misses.length) {
    console.log(`  misses:`);
    for (const m of misses) console.log(`    - ${m.family} → ${m.reason ?? "?"}`);
  }
}

writeFileSync(
  join(BREADTH_ROOT, "smoke-replay-results.json"),
  JSON.stringify(results, null, 2),
);
