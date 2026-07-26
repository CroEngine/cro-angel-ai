#!/usr/bin/env bun
// Bevis-RANKNING i CI (ägaren: "kör"). Per sajt: golv (extractContentModel) →
// tak (classifySectionsLlm på generiska) → gruppera konsekutiva band av samma
// effektiva typ → för varje FLER-objekts-block: ranka objekten på bevis-styrka
// (rankProofItems). Skriver läsbara block + rad-orienterade RANKITEM-rader som
// section-map-generatorn kan lägga på (★ på starkaste, styrke-stapel per objekt).
//
//   ANTHROPIC_API_KEY=... bun run scripts/redesign/proof-rank-report.ts [--urls=a.com,b.com]
//
// Rad-orienterat med flit: GitHub-loggen radbryter långa JSON-rader, men rader
// överlever. Utan nyckel står golvet ensamt (inga rankningar).

import { extractContentModel, sectionBodyLookup } from "../../src/adaptive/redesign/extract";
import { classifySectionsLlm } from "../../src/adaptive/redesign/section-llm.server";
import { rankProofItems } from "../../src/adaptive/redesign/proof-rank.server";

const GENERIC = new Set(["section", "content"]);
const PROMOTABLE = new Set(["testimonials", "pricing", "logos", "stats", "comparison", "faq", "features", "cta", "video", "integrations"]);
const FLOOR = 0.7;

const DEFAULT_URLS = [
  "whoop.com", "hellofresh.com", "docker.com", "mailchimp.com", "casper.com",
  "coursera.org", "wise.com", "calendly.com", "pipedrive.com", "gumroad.com",
];
const urlsArg = process.argv.find((a) => a.startsWith("--urls="))?.split("=")[1];
const URLS = urlsArg ? urlsArg.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_URLS;

interface Item { heading: string; body: string; type: string }

for (const url of URLS) {
  const full = url.startsWith("http") ? url : `https://${url}`;
  const host = full.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  try {
    const res = await fetch(full, { headers: { "user-agent": "Mozilla/5.0 (AngelAdaptive rank)" }, signal: AbortSignal.timeout(20000), redirect: "follow" });
    if (!res.ok) { console.log(`\n### RANK ${full} — ✗ HTTP ${res.status}`); continue; }
    const html = await res.text();
    const model = extractContentModel(html);
    const bodyOf = sectionBodyLookup(html);

    // effektiv typ: tak-domen om den lyfte, annars golvet
    const generics = model.sections.filter((s) => GENERIC.has(s.type) || s.type === "features");
    const labels = await classifySectionsLlm(
      generics.map((s) => ({ heading: s.heading, body: bodyOf(s.heading) })),
    );
    const lblMap = new Map<string, string>();
    generics.forEach((s, i) => {
      const l = labels?.[i];
      if (l && l.confidence >= FLOOR && PROMOTABLE.has(l.type)) lblMap.set(s.heading, l.type);
    });
    const eff = (s: { heading: string; type: string }) => lblMap.get(s.heading) ?? s.type;

    // gruppera konsekutiva band av samma effektiva typ (ej rena generiska)
    const groups: Item[][] = [];
    let cur: Item[] = [];
    let curType = "";
    for (const s of model.sections) {
      const t = eff(s);
      const it: Item = { heading: s.heading, body: bodyOf(s.heading), type: t };
      if (cur.length && curType === t && !GENERIC.has(t)) cur.push(it);
      else { if (cur.length) groups.push(cur); cur = [it]; curType = t; }
    }
    if (cur.length) groups.push(cur);

    console.log(`\n### RANK ${full}  (${model.sections.length} sec)`);
    let ranked = 0;
    for (const g of groups) {
      if (g.length < 2) continue; // bara fler-objekts-block rankas
      const scores = await rankProofItems(g[0].type, g.map((i) => ({ heading: i.heading, body: i.body })));
      const rows = g.map((it, i) => ({ h: it.heading, s: scores?.[i]?.strength ?? 0, r: scores?.[i]?.reason ?? "" }));
      rows.sort((a, b) => b.s - a.s);
      console.log(`  [${g[0].type} ×${g.length}]`);
      rows.forEach((row, idx) => {
        const star = idx === 0 ? "★" : " ";
        console.log(`   ${star} ${row.s.toFixed(2)}  #${idx + 1}  "${row.h.slice(0, 62)}"${row.r ? "  — " + row.r : ""}`);
        // rad-orienterat maskinblock (överlever loggens radbrytning)
        console.log(`RANKITEM|${host}|${row.s.toFixed(2)}|${idx + 1}|${row.h.slice(0, 60).replace(/\|/g, "/")}`);
      });
      ranked++;
    }
    if (ranked === 0) console.log("  (inga fler-objekts-bevisblock att ranka)");
  } catch (e) {
    console.log(`\n### RANK ${full} — ✗ ${(e as Error).message.slice(0, 60)}`);
  }
}
