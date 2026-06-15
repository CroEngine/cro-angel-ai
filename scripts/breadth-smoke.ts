#!/usr/bin/env bun
// Bredd-validering smoke-test (3 sites, ej committad till corpus/).
// Skriver allt till /tmp/corpus-breadth/<name>/ och rapporterar klassificering
// per site: embeddedFamilies (extractor) vs Gate1-reasons (rendering).
//
// Klassificeringsregel (per familj som missar Gate1):
//   - registered=true                              → OK (ingen miss)
//   - reason="descriptor_missing"                  → A1 (extractor-spöke) eller
//                                                    A2 (iframe-only) — kräver
//                                                    manuell triage per familj
//   - reason="check_mismatch"                      → A3b-misstanke (canon-fel)
//   - reason="unexpected_family"                   → ny felmod (CSS-in-JS?)

import { freezeSite } from "../src/lib/tests/snapshot/freeze.server";
import { replayCorpus } from "../src/lib/tests/snapshot/harness.server";
import { extractFontFaceDiagnostics } from "../src/lib/tests/snapshot/mhtml-fonts.server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BREADTH_ROOT = "/tmp/corpus-breadth";
const SMOKE_SITES = [
  { name: "stripe", url: "https://stripe.com" },
  { name: "intercom", url: "https://www.intercom.com" },
  { name: "vercel", url: "https://vercel.com" },
];

interface SiteResult {
  name: string;
  url: string;
  freezeOk: boolean;
  freezeError?: string;
  mhtmlKb?: number;
  embeddedFontCount?: number;
  embeddedFamilies?: string[];
  fontFetchFailures?: number;
  // B1 diagnostik från extractFontFaceDiagnostics
  faceTotal?: number;
  faceRemote?: number;
  faceLocalOnly?: number;
  faceWithMetricOverrides?: number;
  replayOk?: boolean;
  replayError?: string;
  gate1Total?: number;
  gate1Registered?: number;
  perFamily?: Array<{ family: string; registered: boolean; reason?: string }>;
  classification?: Record<string, number>;
  durationMs?: number;
}

mkdirSync(BREADTH_ROOT, { recursive: true });

const results: SiteResult[] = [];

for (const site of SMOKE_SITES) {
  const t0 = Date.now();
  console.log(`\n=== [${site.name}] freezing ${site.url} ===`);
  const dir = join(BREADTH_ROOT, site.name);
  mkdirSync(dir, { recursive: true });
  const r: SiteResult = { name: site.name, url: site.url, freezeOk: false };

  try {
    await freezeSite({
      url: site.url,
      name: site.name,
      outDir: dir,
      notes: "breadth smoke-test, no consent dismissal",
    });
    r.freezeOk = true;

    const report = JSON.parse(
      readFileSync(join(dir, "freeze-report.json"), "utf8"),
    ) as {
      capture: {
        mhtmlKb: number;
        embeddedFontCount: number | null;
        embeddedFamilies: string[] | null;
        fontFetchFailures: unknown[] | null;
      };
    };
    r.mhtmlKb = report.capture.mhtmlKb;
    r.embeddedFontCount = report.capture.embeddedFontCount ?? undefined;
    r.embeddedFamilies = report.capture.embeddedFamilies ?? [];
    r.fontFetchFailures = report.capture.fontFetchFailures?.length ?? 0;

    console.log(
      `[${site.name}] freeze OK · ${r.mhtmlKb}kb · ${r.embeddedFontCount} fonts · ${r.embeddedFamilies?.length} families`,
    );

    console.log(`[${site.name}] replaying through canary…`);
    try {
      await replayCorpus(site.name, BREADTH_ROOT);
      r.replayOk = true;
    } catch (e) {
      // replayCorpus throws on Gate1 misses — that's expected/normal here.
      r.replayOk = false;
      r.replayError = e instanceof Error ? e.message.slice(0, 200) : String(e);
    }

    const famPath = join(dir, "render-canary.families.json");
    if (existsSync(famPath)) {
      const fam = JSON.parse(readFileSync(famPath, "utf8")) as {
        families: Array<{ family: string; registered: boolean; reason?: string }>;
      };
      r.perFamily = fam.families;
      r.gate1Total = fam.families.length;
      r.gate1Registered = fam.families.filter((f) => f.registered).length;
      const cls: Record<string, number> = {};
      for (const f of fam.families) {
        const k = f.registered ? "OK" : (f.reason ?? "unknown");
        cls[k] = (cls[k] ?? 0) + 1;
      }
      r.classification = cls;
    }
  } catch (e) {
    r.freezeError = e instanceof Error ? e.message.slice(0, 300) : String(e);
    console.error(`[${site.name}] FAIL: ${r.freezeError}`);
  }

  r.durationMs = Date.now() - t0;
  results.push(r);
}

console.log("\n\n========= BREADTH SMOKE-TEST SUMMARY =========\n");
for (const r of results) {
  console.log(`\n--- ${r.name} (${r.url}) ---`);
  console.log(`  duration: ${Math.round((r.durationMs ?? 0) / 1000)}s`);
  if (!r.freezeOk) {
    console.log(`  freeze: FAIL — ${r.freezeError}`);
    continue;
  }
  console.log(
    `  freeze: OK · ${r.mhtmlKb}kb · ${r.embeddedFontCount} embedded fonts · ${r.embeddedFamilies?.length} extracted families · ${r.fontFetchFailures} fetch failures`,
  );
  console.log(`  embeddedFamilies: ${(r.embeddedFamilies ?? []).join(", ") || "(none)"}`);
  if (r.gate1Total != null) {
    console.log(
      `  Gate1: ${r.gate1Registered}/${r.gate1Total} registered · classification: ${JSON.stringify(r.classification)}`,
    );
    const misses = (r.perFamily ?? []).filter((f) => !f.registered);
    if (misses.length > 0) {
      console.log(`  misses:`);
      for (const m of misses) console.log(`    - ${m.family} → ${m.reason ?? "?"}`);
    }
  } else {
    console.log(`  Gate1: render-canary.families.json missing (${r.replayError ?? "unknown"})`);
  }
}

writeFileSync(
  join(BREADTH_ROOT, "smoke-results.json"),
  JSON.stringify(results, null, 2),
);
console.log(`\n\nFull JSON: ${join(BREADTH_ROOT, "smoke-results.json")}`);
