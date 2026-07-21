#!/usr/bin/env bun
// Plausible Lab — serveringssimulering (Fas 4 steg 3, generalrepetitionen).
//
// Labbet har inga riktiga besökare (trafiken är seedade rader), så serveringen
// demonstreras med SIMULERADE besökare som går genom den RIKTIGA armvals-koden:
// varje besökare får sin arm av serveDecision (samma rena funktion decide-vägen
// kör live) — finaste matchande variant, deterministisk ramp-bucket per
// besökare·variant, ramp-schema 5 → 10 → 25 → 50 % över de simulerade dagarna.
// Det enda påhittade är besökarna själva och deras konverteringssannolikheter;
// armtilldelning, nyckelmatchning och mätvägen (angel_variant_arms-RPC:n +
// evaluateWinner) är produktionskoden.
//
// Berättelsen är designad att visa alla fyra utfallen ärligt:
//   instagram  → recommend_winner   (tydligt bättre, fulla volymgrindar)
//   google     → no_winner          (ingen skillnad att tala om ännu)
//   återkommande → insufficient_data (för liten kohort — grindarna håller emot)
//   facebook   → recommend_stop     (signifikant sämre — dras innan vinnarvolym)
//
// Kör:  bun run scripts/lab/simulate-serving.ts fixtures/lab/variants.json <out-dir> <base-iso>
// Ut:   batch-NNN.sql (angel_events-inserts) + summary.json (förväntade armar)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { serveDecision, type ServableVariant } from "../../src/adaptive/redesign/serve";

const [variantsPath, outDir, baseIso] = process.argv.slice(2);
if (!variantsPath || !outDir || !baseIso) {
  console.error("usage: simulate-serving.ts <variants.json> <out-dir> <base-iso>");
  process.exit(1);
}
const variants = JSON.parse(readFileSync(variantsPath, "utf8")) as ServableVariant[];
const BASE = new Date(baseIso).getTime();
mkdirSync(outDir, { recursive: true });

// Deterministisk RNG — delad mulberry32 (scripts/lab/rng.mjs).
import { mulberry32 as rng } from "./rng.mjs";

// Ramp-schemat över de 14 simulerade dagarna (ägarens beslutade steg).
const DAYS = 14;
const rampFor = (day: number): number => (day < 1 ? 5 : day < 2 ? 10 : day < 4 ? 25 : 50);

interface Cohort {
  key: string;
  segment: { channel: string; device: string; country: string; isReturning: boolean };
  visitors: number;
  /** Designade konverteringsgrader per arm — det enda "påhittade". */
  crVariant: number;
  crControl: number;
}

const COHORTS: Cohort[] = [
  { key: "instagram", segment: { channel: "instagram", device: "mobile", country: "SE", isReturning: false }, visitors: 2700, crVariant: 0.096, crControl: 0.071 },
  { key: "google",    segment: { channel: "google", device: "desktop", country: "US", isReturning: false },   visitors: 2700, crVariant: 0.073, crControl: 0.071 },
  { key: "aterkommande", segment: { channel: "direct", device: "desktop", country: "SE", isReturning: true }, visitors: 400,  crVariant: 0.088, crControl: 0.079 },
  { key: "facebook",  segment: { channel: "facebook", device: "mobile", country: "US", isReturning: false },  visitors: 2400, crVariant: 0.042, crControl: 0.075 },
];

// Kompakt SQL per kohort: det enda som måste komma från skriptet är VAD den
// riktiga koden bestämde — vilka besökar-index som fick variant-armen
// (serveDecision) och vilka som konverterade (designad rate, seedad RNG).
// Själva raderna genereras DB-sidigt (generate_series + jsonb_build_object),
// så seedningen blir kilobyte i stället för megabyte.
const summary: Record<string, { variantId: string; variant: { visits: number; conversions: number }; control: { visits: number; conversions: number } }> = {};
let totalRows = 0;
let fileNo = 0;

for (const c of COHORTS) {
  const rand = rng(c.key.length * 7919 + c.visitors);
  const variantIdx: number[] = [];
  const convIdx: number[] = [];
  let variantId = "";
  for (let i = 0; i < c.visitors; i++) {
    const day = Math.floor((i / c.visitors) * DAYS); // jämn spridning över perioden
    const vh = `sim-${c.key}-${i}`;
    const verdict = serveDecision(
      { servingEnabled: true, rampPct: rampFor(day) },
      variants,
      { site: "synthetic-lab", path: "/", segment: c.segment },
      vh,
    );
    rand(); // håll RNG-strömmen stabil oavsett utfall
    if (!verdict) continue; // kohort utan matchande variant simuleras inte
    variantId = verdict.variant.id;
    const arm = verdict.arm;
    if (arm === "variant") variantIdx.push(i);
    const s = (summary[c.key] ??= {
      variantId,
      variant: { visits: 0, conversions: 0 },
      control: { visits: 0, conversions: 0 },
    });
    const armStat = arm === "variant" ? s.variant : s.control;
    armStat.visits++;
    if (rand() < (arm === "variant" ? c.crVariant : c.crControl)) {
      armStat.conversions++;
      convIdx.push(i);
    }
  }
  if (!variantId) continue;
  const baseEpoch = Math.floor(BASE / 1000);
  // Exponerings-timestamp: dagens start + deterministiskt jitter inom dygnet.
  const tExpr = (iVar: string) =>
    `to_timestamp(${baseEpoch} - (${DAYS} - (${iVar} * ${DAYS} / ${c.visitors})) * 86400 + mod(${iVar} * 7919, 79200))`;
  const seg = c.segment;
  const payload = `jsonb_build_object('patterns', jsonb_build_array('variant:${variantId}'), 'path','/', 'trafficSource','${seg.channel}', 'device','${seg.device}', 'country','${seg.country}', 'isReturning',${seg.isReturning})`;
  const sql = `insert into angel_events (site,type,decision_id,visitor_hash,payload,created_at)
select 'synthetic-lab',
  case when i = any(array[${variantIdx.join(",")}]::int[]) then 'adaptation_shown' else 'adaptation_withheld' end,
  'sim-dec-${c.key}-'||i, 'sim-${c.key}-'||i,
  ${payload},
  ${tExpr("i")}
from generate_series(0, ${c.visitors - 1}) i;

insert into angel_events (site,type,decision_id,visitor_hash,payload,created_at)
select 'synthetic-lab','conversion','sim-dec-${c.key}-'||x.i,'sim-${c.key}-'||x.i,'{"path":"/"}'::jsonb,
  ${tExpr("x.i")} + make_interval(secs => 300 + mod(x.i * 104729, 2100))
from unnest(array[${convIdx.join(",")}]::int[]) as x(i);
`;
  writeFileSync(join(outDir, `cohort-${String(fileNo).padStart(2, "0")}-${c.key}.sql`), sql);
  fileNo++;
  totalRows += c.visitors + convIdx.length;
}

writeFileSync(join(outDir, "summary.json"), JSON.stringify({ totalRows, cohortFiles: fileNo, summary }, null, 2));
console.log(`rows=${totalRows} cohortFiles=${fileNo}`);
console.log(JSON.stringify(summary, null, 2));
