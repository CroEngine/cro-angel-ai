#!/usr/bin/env bun
// Bredd-validering smoke-test (3 sites, ej committad till corpus/).
// Skriver allt till /tmp/corpus-breadth/<name>/.
//
// B2b: efter freeze körs ett diagnostik-pass som re-läser page.pre-embed.mhtml
// (raw, före cid:-rewrite) och kallar embedMhtmlFonts med controlProbes igen
// för att producera per-URL FontFetchRecord + positive/negative kontrollprober.
// Den 4-vägs negativ-guarden bestämmer om fetcher-distributionen är tolkningsbar
// i denna miljö eller om miljö-confound dominerar.

import { freezeSite } from "../src/lib/tests/snapshot/freeze.server";
import { replayCorpus } from "../src/lib/tests/snapshot/harness.server";
import {
  embedMhtmlFonts,
  extractFontFaceDiagnostics,
  reconcileFontUrlSets,
  type ControlProbeResult,
  type FontFetchRecord,
} from "../src/lib/tests/snapshot/mhtml-fonts.server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BREADTH_ROOT = "/tmp/corpus-breadth";
const SMOKE_SITES = [
  { name: "stripe", url: "https://stripe.com" },
  { name: "intercom", url: "https://www.intercom.com" },
  { name: "vercel", url: "https://vercel.com" },
];

type GuardVerdict =
  | "ok_open_egress"        // negative=ok|http_error  → ideal: ingen miljö-block alls
  | "ok_block_validated"    // negative=env_blocked    → block existerar men detektorn validerad
  | "blocked_hard"          // positive≠ok             → miljön når inte ens CDN — stopp
  | "blocked_detector_inert"; // negative=network_error|timeout → tyst block, tolkning ogiltig

interface SiteResult {
  name: string;
  url: string;
  freezeOk: boolean;
  freezeError?: string;
  mhtmlKb?: number;
  embeddedFontCount?: number;
  embeddedFamilies?: string[];
  fontFetchFailures?: number;
  faceTotal?: number;
  faceRemote?: number;
  faceAbsoluteHttp?: number;
  faceUnresolvable?: number;
  b1ReplayUrls?: number;
  b1ReplayUrlSet?: string[];
  unresolvableRelativeUrls?: Array<{ original: string; reason: string; partIndex: number }>;
  harmonization?: {
    ok: boolean;
    p: number;
    m: number;
    onlyInP: string[];
    onlyInM: string[];
  };
  faceLocalOnly?: number;
  faceWithMetricOverrides?: number;
  replayOk?: boolean;
  replayError?: string;
  gate1Total?: number;
  gate1Registered?: number;
  perFamily?: Array<{ family: string; registered: boolean; reason?: string }>;
  classification?: Record<string, number>;
  durationMs?: number;
  // B2b-fält
  b2b?: {
    preEmbedFound: boolean;
    controlProbes?: { positive: ControlProbeResult; negative: ControlProbeResult };
    guardVerdict?: GuardVerdict;
    interpretationBlocked?: boolean;
    interpretationBlockReason?: string;
    totalOccurrences?: number;
    uniqueUrlCount?: number;
    attemptedCount?: number;
    outcomeCounts?: Record<string, number>;
    perHostEnvBlocked?: Record<string, { env_blocked: number; total: number }>;
    successRates?: { perAttempted: number; perUnique: number; perOcc: number };
  };
}

function classifyGuard(
  probes: { positive: ControlProbeResult; negative: ControlProbeResult },
): { verdict: GuardVerdict; interpretationBlocked: boolean; reason: string } {
  if (probes.positive.outcome !== "ok") {
    return {
      verdict: "blocked_hard",
      interpretationBlocked: true,
      reason: `positive probe outcome=${probes.positive.outcome} — environment cannot reach control CDN`,
    };
  }
  const n = probes.negative.outcome;
  if (n === "env_blocked") {
    return {
      verdict: "ok_block_validated",
      interpretationBlocked: false,
      reason: "negative=env_blocked → proxy signals deny, env_blocked bucket trustworthy",
    };
  }
  if (n === "ok" || n === "http_error") {
    return {
      verdict: "ok_open_egress",
      interpretationBlocked: false,
      reason: `negative=${n} from example.com host → open egress, no env confound`,
    };
  }
  // network_error | timeout | empty_body | skipped_* — alla tysta block-signaler
  return {
    verdict: "blocked_detector_inert",
    interpretationBlocked: true,
    reason: `negative=${n} → proxy may be blocking silently; env_blocked detector not validated`,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "<invalid>";
  }
}

function summarizeRecords(records: FontFetchRecord[]) {
  const outcomeCounts: Record<string, number> = {};
  const perHost: Record<string, { env_blocked: number; total: number }> = {};
  for (const r of records) {
    outcomeCounts[r.outcome] = (outcomeCounts[r.outcome] ?? 0) + 1;
    const h = hostOf(r.url);
    if (!perHost[h]) perHost[h] = { env_blocked: 0, total: 0 };
    perHost[h].total++;
    if (r.outcome === "env_blocked") perHost[h].env_blocked++;
  }
  const totalOccurrences = records.length;
  const uniqueUrlCount = new Set(records.map((r) => r.url)).size;
  const attemptedCount = records.filter((r) => r.attempted).length;
  const okCount = records.filter((r) => r.outcome === "ok").length;
  return {
    totalOccurrences,
    uniqueUrlCount,
    attemptedCount,
    outcomeCounts,
    perHostEnvBlocked: perHost,
    successRates: {
      perAttempted: attemptedCount > 0 ? okCount / attemptedCount : 0,
      perUnique: uniqueUrlCount > 0 ? okCount / uniqueUrlCount : 0,
      perOcc: totalOccurrences > 0 ? okCount / totalOccurrences : 0,
    },
  };
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

    // B1 face-diagnostik (kräver inline page.mhtml).
    const mhtmlPath = join(dir, "page.mhtml");
    if (existsSync(mhtmlPath)) {
      const raw = readFileSync(mhtmlPath, "utf8");
      const diags = extractFontFaceDiagnostics(raw);
      r.faceTotal = diags.length;
      r.faceRemote = diags.filter((d) => d.hasRemoteSrc).length;
      r.faceLocalOnly = diags.filter((d) => d.hasLocalOnly).length;
      r.faceWithMetricOverrides = diags.filter((d) => d.hasMetricOverrides).length;
      writeFileSync(
        join(dir, "face-diagnostics.json"),
        JSON.stringify(diags, null, 2),
      );
      console.log(
        `[${site.name}] B1 faces: total=${r.faceTotal} remote=${r.faceRemote} local-only=${r.faceLocalOnly} metric-overrides=${r.faceWithMetricOverrides}`,
      );
    }

    // B2b — diagnostik-pass på pre-embed-MHTML. HÅRD-FAIL om filen saknas
    // (annars mäter vi fel URL-set).
    const preEmbedPath = join(dir, "page.pre-embed.mhtml");
    r.b2b = { preEmbedFound: existsSync(preEmbedPath) };
    if (!r.b2b.preEmbedFound) {
      throw new Error(
        `[${site.name}] B2b: page.pre-embed.mhtml saknas — re-freeze krävs ` +
          `(freeze.server skriver filen sedan B2b §3; gamla freezes har den inte).`,
      );
    }
    console.log(`[${site.name}] B2b: diagnostik-pass på pre-embed-MHTML…`);
    const preEmbedRaw = readFileSync(preEmbedPath, "utf8");

    // B1-oraklet: kör diagnostik på SAMMA MHTML fetchern såg (pre-embed).
    // Annars jämför vi olika korpus (page.mhtml är post-cid-rewrite).
    const preDiags = extractFontFaceDiagnostics(preEmbedRaw);
    r.faceAbsoluteHttp = preDiags.filter((d) => d.hasAbsoluteHttpUrl).length;
    r.faceUnresolvable = preDiags.filter((d) => d.hasUnresolvableRelativeUrl).length;
    const allReplay = new Set<string>();
    for (const d of preDiags) for (const u of d.replayUrls) allReplay.add(u);
    r.b1ReplayUrls = allReplay.size;
    r.b1ReplayUrlSet = [...allReplay].sort();

    const diag = await embedMhtmlFonts(preEmbedRaw, {
      controlProbes: {}, // använd defaults: gstatic positiv, example.com negativ
    });
    const probes = diag.controlProbes!;
    r.b2b.controlProbes = probes;
    const guard = classifyGuard(probes);
    r.b2b.guardVerdict = guard.verdict;
    r.b2b.interpretationBlocked = guard.interpretationBlocked;
    r.b2b.interpretationBlockReason = guard.reason;
    const summary = summarizeRecords(diag.fetchRecords);
    Object.assign(r.b2b, summary);

    // Harmonisering: URL-mot-URL-reconciliation mellan B1-oraklet (P) och
    // B2b-fetchern (M). MISMATCH = riktig harvest-divergens (inte tautologi).
    const fetcherUrls = new Set(diag.fetchRecords.map((x) => x.url));
    const recon = reconcileFontUrlSets(allReplay, fetcherUrls);
    r.harmonization = {
      ok: recon.ok,
      p: allReplay.size,
      m: fetcherUrls.size,
      onlyInP: recon.onlyInP,
      onlyInM: recon.onlyInM,
    };
    if (!recon.ok) {
      writeFileSync(
        join(dir, "harmonization-diff.json"),
        JSON.stringify(r.harmonization, null, 2),
      );
    }
    // Hink 4 receipt — sajten flaggas men korpus-loopen fortsätter.
    r.unresolvableRelativeUrls = diag.unresolvableRelativeUrls;
    if (diag.unresolvableRelativeUrls.length > 0) {
      writeFileSync(
        join(dir, "unresolvable-font-urls.json"),
        JSON.stringify(diag.unresolvableRelativeUrls, null, 2),
      );
    }

    writeFileSync(
      join(dir, "font-fetch-records.json"),
      JSON.stringify(diag.fetchRecords, null, 2),
    );
    writeFileSync(
      join(dir, "control-probes.json"),
      JSON.stringify({ ...probes, guard }, null, 2),
    );

    console.log(
      `[${site.name}] B2b control: positive=${probes.positive.outcome} (${probes.positive.durationMs}ms) · ` +
        `negative=${probes.negative.outcome} (${probes.negative.durationMs}ms) → ${guard.verdict}`,
    );
    console.log(
      `[${site.name}] B2b records: occ=${summary.totalOccurrences} · uniq=${summary.uniqueUrlCount} · attempted=${summary.attemptedCount}`,
    );
    console.log(
      `[${site.name}] B2b outcomes: ${JSON.stringify(summary.outcomeCounts)}`,
    );
    console.log(
      `[${site.name}] B2b success: A/attempted=${summary.successRates.perAttempted.toFixed(2)} · ` +
        `A/uniq=${summary.successRates.perUnique.toFixed(2)} · ` +
        `A/occ=${summary.successRates.perOcc.toFixed(2)}`,
    );
    console.log(
      `[${site.name}] Harmonisering: P(b1_unique_abs_urls)=${r.harmonization!.p} · ` +
        `M(b2_absolute_urls)=${r.harmonization!.m} · ` +
        `invariant P==M → ${r.harmonization!.ok ? "OK" : "MISMATCH"}` +
        (!r.harmonization!.ok
          ? ` (onlyInP=${r.harmonization!.onlyInP.length}, onlyInM=${r.harmonization!.onlyInM.length} → harmonization-diff.json)`
          : ""),
    );

    console.log(`[${site.name}] replaying through canary…`);
    try {
      await replayCorpus(site.name, BREADTH_ROOT);
      r.replayOk = true;
    } catch (e) {
      r.replayOk = false;
      r.replayError = e instanceof Error ? e.message.slice(0, 200) : String(e);
    }

    const famPath = join(dir, "render-canary.families.json");
    if (existsSync(famPath)) {
      const fam = JSON.parse(readFileSync(famPath, "utf8")) as {
        families: Array<{
          family: string;
          gate1: { pass: boolean; reason: string; loadError?: string };
        }>;
      };
      // Bridge schema: render-canary.families.json carries the authoritative
      // signal in `gate1` (pass + reason). The top-level `registered`/`reason`
      // fields are stripped by the receipt writer in harness.server.ts; reading
      // them here yields `null` and collapses every family to "unknown".
      r.perFamily = fam.families.map((f) => ({
        family: f.family,
        registered: f.gate1.pass,
        reason: f.gate1.reason,
      }));
      r.gate1Total = fam.families.length;
      r.gate1Registered = fam.families.filter((f) => f.gate1.pass).length;
      const cls: Record<string, number> = {};
      for (const f of fam.families) {
        const k = f.gate1.pass ? "OK" : (f.gate1.reason ?? "unknown");
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
  console.log(`  embeddedFamilies (post-B1): ${(r.embeddedFamilies ?? []).join(", ") || "(none)"}`);
  if (r.faceTotal != null) {
    console.log(
      `  B1 faces: total=${r.faceTotal} · remote=${r.faceRemote} · local-only=${r.faceLocalOnly} · metric-overrides=${r.faceWithMetricOverrides}`,
    );
    console.log(
      `  B2-nämnare (familjer med remote-src) = ${r.faceRemote} · embedded=${r.embeddedFontCount}`,
    );
  }
  if (r.harmonization) {
    console.log(
      `  Harmonisering (B1-orakel vs B2b-fetcher, oberoende impl):`,
    );
    console.log(
      `    b1_faces_w_abs_url     = ${r.faceAbsoluteHttp} (beskrivande)`,
    );
    console.log(
      `    b1_faces_unresolvable  = ${r.faceUnresolvable} (hink 4 — relativ utan giltig base)`,
    );
    console.log(
      `    b1_replay_urls (P)     = ${r.harmonization.p}   ← hink 2 ∪ 3, dedupad på resolved`,
    );
    console.log(
      `    b2_replay_urls (M)     = ${r.harmonization.m}   ← fetcher-harvest via samma chokepoint`,
    );
    console.log(
      `    invariant P == M       → ${r.harmonization.ok ? "OK" : "MISMATCH"}`,
    );
    if (r.unresolvableRelativeUrls && r.unresolvableRelativeUrls.length > 0) {
      console.log(
        `    hink 4 unresolvable    = ${r.unresolvableRelativeUrls.length} → unresolvable-font-urls.json`,
      );
    }
    if (!r.harmonization.ok) {
      if (r.harmonization.onlyInP.length > 0) {
        console.log(`    onlyInP (fetcher missade):`);
        for (const u of r.harmonization.onlyInP) console.log(`      - ${u}`);
      }
      if (r.harmonization.onlyInM.length > 0) {
        console.log(`    onlyInM (oraklet missade):`);
        for (const u of r.harmonization.onlyInM) console.log(`      - ${u}`);
      }
    }
  }
  if (r.b2b?.controlProbes) {
    console.log(
      `  B2b guard: ${r.b2b.guardVerdict} · interpretationBlocked=${r.b2b.interpretationBlocked}`,
    );
    console.log(`    → ${r.b2b.interpretationBlockReason}`);
    console.log(
      `  B2b counts: occ=${r.b2b.totalOccurrences} · uniq=${r.b2b.uniqueUrlCount} · attempted=${r.b2b.attemptedCount}`,
    );
    console.log(`  B2b outcomes: ${JSON.stringify(r.b2b.outcomeCounts)}`);
    if (r.b2b.successRates) {
      console.log(
        `  B2b success: A/attempted=${r.b2b.successRates.perAttempted.toFixed(2)} · A/uniq=${r.b2b.successRates.perUnique.toFixed(2)} · A/occ=${r.b2b.successRates.perOcc.toFixed(2)}`,
      );
    }
    const blocked = Object.entries(r.b2b.perHostEnvBlocked ?? {}).filter(([, v]) => v.env_blocked > 0);
    if (blocked.length > 0) {
      console.log(`  B2b per-host env_blocked:`);
      for (const [h, v] of blocked) console.log(`    - ${h}: ${v.env_blocked}/${v.total}`);
    }
  }
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
