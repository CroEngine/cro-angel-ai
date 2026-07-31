#!/usr/bin/env bun
// Flottaggregatet (ägarfrågan 2026-07-29 "har vi en tillräckligt bra stage?"):
// slår ihop vågornas results.json till talen som aldrig funnits som siffror —
// verifierad-andel på SLUTLIGA kedjan, yield per sajt (minst ett grind-rent
// drag i menyn), menystorleksfördelning, väljare-mot-golv, reserv-stegens
// användning och topp-vägransorsaker. Day0-delmängden särredovisas så talen
// är jämförbara med ADR-002:s baslinjer (61 % v1 / 55 % v2-endast).
//
//   bun run scripts/fleet-loop/aggregate-fleet.ts fil1.json [fil2.json ...] [--out=docs/x.md]

import { readFileSync, writeFileSync } from "node:fs";

import { SITES as DAY0 } from "../day0-sites";

interface SiteResult {
  name: string;
  url: string;
  status: string;
  verdict: string | null;
  fallback: string | null;
  reason: string | null;
  gateReasons: string[];
  attempts: number;
  sections: number | null;
  planOps: string[];
  planSource: string | null;
  menuSize?: number | null;
  probeCandidates?: number | null;
  probeApplicable?: number | null;
  probeGateClean?: number | null;
  ms: number;
  error: string | null;
}

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const outArg = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1];
if (files.length === 0) {
  console.error("usage: aggregate-fleet.ts results-0.json [results-100.json ...] [--out=docs/x.md]");
  process.exit(2);
}

// Senare filer vinner per sajtnamn (omkörningar skriver över vågor).
const byName = new Map<string, SiteResult>();
for (const f of files) {
  for (const r of JSON.parse(readFileSync(f, "utf8")) as SiteResult[]) byName.set(r.name, r);
}
const all = [...byName.values()];
const day0Names = new Set(DAY0.map((s) => s.name));

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 1000) / 10} %`);
const count = (rs: SiteResult[], fn: (r: SiteResult) => boolean) => rs.filter(fn).length;

function block(label: string, rs: SiteResult[]): string[] {
  const n = rs.length;
  const ok = rs.filter((r) => r.status === "ok");
  const verified = ok.filter((r) => r.verdict === "verified" || r.verdict === "verified_fallback");
  const withMenu = rs.filter((r) => (r.menuSize ?? 0) > 0);
  const withClean = rs.filter((r) => (r.probeGateClean ?? 0) > 0);
  const catalog = rs.filter((r) => r.planSource?.startsWith("katalog/"));
  const L: string[] = [];
  L.push(`### ${label} (${n} sajter)`);
  L.push("");
  L.push(`| mått | antal | andel |`);
  L.push(`|---|---:|---:|`);
  L.push(`| capture ok (status=ok) | ${ok.length} | ${pct(ok.length, n)} |`);
  L.push(`| **verifierad variant** (inkl. fallback) | **${verified.length}** | **${pct(verified.length, n)}** |`);
  L.push(`| — varav via reserv-/placeringsstegen (fallback) | ${count(verified, (r) => r.fallback != null)} | ${pct(count(verified, (r) => r.fallback != null), verified.length || 1)} av verifierade |`);
  L.push(`| verifierad-andel av capture-ok | ${verified.length} | ${pct(verified.length, ok.length)} |`);
  L.push(`| **yield: ≥1 grind-rent drag i menyn** | **${withClean.length}** | **${pct(withClean.length, n)}** |`);
  L.push(`| yield: meny fanns alls (katalogväg) | ${withMenu.length} | ${pct(withMenu.length, n)} |`);
  L.push(`| plan via katalog/selector | ${count(rs, (r) => r.planSource === "katalog/selector")} | ${pct(count(rs, (r) => r.planSource === "katalog/selector"), catalog.length || 1)} av katalogplaner |`);
  L.push(`| plan via katalog/floor (golvet) | ${count(rs, (r) => r.planSource === "katalog/floor")} | ${pct(count(rs, (r) => r.planSource === "katalog/floor"), catalog.length || 1)} av katalogplaner |`);
  L.push(`| plan via fria designern | ${count(rs, (r) => r.planSource === "designer")} | ${pct(count(rs, (r) => r.planSource === "designer"), n)} |`);
  L.push("");

  const statuses = new Map<string, number>();
  for (const r of rs) {
    const k = r.status === "ok" ? (r.verdict ?? "?") : r.status;
    statuses.set(k, (statuses.get(k) ?? 0) + 1);
  }
  L.push(`Utfallsfördelning: ${[...statuses.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(" · ")}`);
  L.push("");

  const menuHist = new Map<string, number>();
  for (const r of rs) {
    const m = r.menuSize ?? null;
    const k = m == null ? "ingen katalogväg" : m >= 4 ? "4+" : String(m);
    menuHist.set(k, (menuHist.get(k) ?? 0) + 1);
  }
  L.push(`Menystorlek: ${["ingen katalogväg", "0", "1", "2", "3", "4+"].filter((k) => menuHist.has(k)).map((k) => `${k}: ${menuHist.get(k)}`).join(" · ")}`);

  const probed = rs.filter((r) => r.probeCandidates != null);
  if (probed.length > 0) {
    const sum = (fn: (r: SiteResult) => number) => probed.reduce((a, r) => a + fn(r), 0);
    const cand = sum((r) => r.probeCandidates ?? 0);
    const appl = sum((r) => r.probeApplicable ?? 0);
    const clean = sum((r) => r.probeGateClean ?? 0);
    L.push("");
    L.push(`Kandidattratten (summerad över ${probed.length} sajter med katalogväg): genererade ${cand} → applicerbara ${appl} (${pct(appl, cand)}) → grind-rena ${clean} (${pct(clean, cand)})`);
  }
  L.push("");
  return L;
}

const L: string[] = [];
L.push(`# Flottomkörning på slutliga kedjan — aggregatet som saknades`);
L.push("");
L.push(`Kedjeversion: superset-regeln (gateClean ⊃ applicable) + viewport-fixen (390×844 genom hela render-vägen) + browser-först-frysningen. Baslinjer att jämföra mot (ADR-002): 52 % verifierade på 254 (v1 fri generering), 61 % day0-105 (v1), 55 % day0-105 (v2-endast).`);
L.push("");
L.push(...block("Hela flottan", all));
L.push(...block("Day0-105 (jämförbar med ADR-002-baslinjerna)", all.filter((r) => day0Names.has(r.name))));
L.push(...block("Breda korpusen", all.filter((r) => !day0Names.has(r.name))));

const held = all.filter((r) => r.status === "ok" && r.verdict !== "verified" && r.verdict !== "verified_fallback");
const reasons = new Map<string, number>();
for (const r of held) {
  const key = (r.gateReasons[0] ?? r.reason ?? "(okänd orsak)").slice(0, 110);
  reasons.set(key, (reasons.get(key) ?? 0) + 1);
}
L.push(`### Topp-vägransorsaker (${held.length} hållna med capture ok)`);
L.push("");
for (const [k, c] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  L.push(`- ${c} × ${k}`);
}
L.push("");
const md = L.join("\n");
if (outArg) {
  writeFileSync(outArg, md);
  console.log(`[aggregat] → ${outArg}`);
} else console.log(md);
