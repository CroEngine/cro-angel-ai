#!/usr/bin/env bun
// Rök-test för sektionstypnings-TAKET (LLM-revision 2026-07-24). Kör GOLVET
// (extractContentModel: rubrik-vokabulär + strukturcues) och sedan TAKET
// (refineSectionTypesLlm → det RIKTIGA Haiku-anropet) på en riktig sida och
// skriver FÖRE→EFTER: vilka generiska sektioner LLM:en befordrade och till vad,
// med utdraget den dömde på. Så man SER att taket fångar bild-/div-buret bevis
// som golvet inte når (HelloFresh-klassen).
//
//   ANTHROPIC_API_KEY=... bun run scripts/redesign/section-typer-smoke.ts --file=capture-corpus/whoop/frozen.html
//   ANTHROPIC_API_KEY=... bun run scripts/redesign/section-typer-smoke.ts --url=https://whoop.com
//
// Utan nyckel är taket en no-op (golvet ensamt) — testet säger det rakt ut och
// listar de generiska kandidaterna taket SKULLE ha skickat.

import { existsSync, readFileSync } from "node:fs";

import { extractContentModel, sectionBodyLookup } from "../../src/adaptive/redesign/extract";
import { refineSectionTypesLlm } from "../../src/adaptive/redesign/section-llm.server";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const GENERIC = new Set(["section", "content", "features"]);

async function loadHtml(): Promise<{ html: string; label: string }> {
  const file = arg("file");
  const url = arg("url");
  if (file) return { html: readFileSync(file, "utf8"), label: file };
  if (url) {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (AngelAdaptive smoke)" } });
    if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
    return { html: await res.text(), label: url };
  }
  for (const p of [
    "capture-corpus/whoop/frozen.html",
    "capture-corpus/hellofresh/frozen.html",
    "capture-corpus/gumroad/frozen.html",
  ])
    if (existsSync(p)) return { html: readFileSync(p, "utf8"), label: p };
  throw new Error("pass --file=<frozen.html> or --url=<https://…> (no corpus sample on disk)");
}

const { html, label } = await loadHtml();
const hasKey = !!process.env.ANTHROPIC_API_KEY;

const content = extractContentModel(html);
const before = content.sections.map((s) => s.type);
const bodyOf = sectionBodyLookup(html);

console.log(`\n═══ section-typer smoke — ${label} ═══`);
console.log(`floor: ${content.sections.length} sections, ${before.filter((t) => GENERIC.has(t)).length} left generic`);
console.log(`ANTHROPIC_API_KEY: ${hasKey ? "present → running the LLM ceiling" : "MISSING → ceiling is a no-op"}\n`);

if (!hasKey) {
  console.log("Generic candidates the ceiling WOULD send (heading → excerpt it would judge):");
  for (const s of content.sections.filter((x) => GENERIC.has(x.type))) {
    const ex = bodyOf(s.heading).replace(/\s+/g, " ").slice(0, 160);
    if (ex.length < 15) continue;
    console.log(`  [${s.type}] "${s.heading.slice(0, 56)}"\n     ${ex}`);
  }
  console.log("\n→ Set ANTHROPIC_API_KEY and re-run to see real promotions.");
  process.exit(0);
}

const promoted = await refineSectionTypesLlm(content, html);
console.log(`ceiling promoted ${promoted} generic section(s):\n`);
content.sections.forEach((s, i) => {
  if (s.type === before[i]) return;
  const ex = bodyOf(s.heading).replace(/\s+/g, " ").slice(0, 200);
  console.log(`  ✓ "${s.heading.slice(0, 56)}"`);
  console.log(`     ${before[i]} → ${s.type}${s.containsTrustSignals ? "  [proof]" : ""}`);
  console.log(`     judged on: ${ex || "(no text/alt — pure image)"}\n`);
});
if (promoted === 0) console.log("  (nothing crossed the 0.7 confidence floor — floor stands)\n");
