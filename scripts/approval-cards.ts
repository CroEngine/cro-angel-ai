#!/usr/bin/env bun
// E4b — generate the OWNER APPROVAL cards from designer-run artifacts.
// Each card is the approval unit made visible: the cohort, the change
// (before/after full-page evidence), the rationale, the safety contract and
// the ramp — plus the exact rule JSON the approval activates. Output is a
// single self-contained HTML file (images inlined as data URIs).
//
//   bun run scripts/approval-cards.ts <shotsDir> <outHtml> <outRulesJson>

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  defaultSuccessSpec,
  estimateVerdictTime,
  metricById,
} from "../src/adaptive-lab/metrics";

type CardDef = {
  site: string;
  title: string;
  cohorts: string[];
  cohortLabel: string;
  rationale: string;
  detail: string;
  // Illustrative traffic assumptions for the time-to-verdict line — clearly
  // labeled as assumptions until collector data replaces them.
  assumedDailyMatched: number;
  plan: {
    action: "reorder";
    container: string;
    move: string;
    after: string | null;
    mode: "flex" | "grid";
  };
};

const CARDS: CardDef[] = [
  {
    site: "sentry",
    title: "”Loved by developers worldwide” direkt efter hero",
    cohorts: ["src:linkedin"],
    cohortLabel: "Besökare från LinkedIn",
    rationale:
      "LinkedIn-ankomster är kollegor som utvärderar — peer-bevis väger tyngst. Utvecklarcitaten flyttas från ~55 % ner på sidan till direkt under hero + logotyper.",
    detail: "Verifierad: designer-runda 8 + serve-E2E (servad till src:linkedin-kohorten).",
    assumedDailyMatched: 400,
    plan: {
      action: "reorder",
      container: "#main-content",
      move: "#main-content > div:nth-of-type(5)",
      after: "#main-content > div:nth-of-type(2)",
      mode: "grid",
    },
  },
  {
    site: "wrike",
    title: "”Your work, delivered. 30,000+ times over” direkt efter hero",
    cohorts: ["seen:pricing"],
    cohortLabel: "Har besökt prissidan",
    rationale:
      "Besökare som redan sett priserna väger värde mot kostnad — kundkarusellen med Nvidia/Walmart-citaten möter dem direkt i stället för 6 600 px ner.",
    detail: "Verifierad: designer-runda 8 (grid-promotion, tag-selektor efter omladdningsfix).",
    assumedDailyMatched: 250,
    plan: {
      action: "reorder",
      container: "website-widgets-loader",
      move: "website-widget-loader:nth-of-type(8)",
      after: "website-widget-loader:nth-of-type(1)",
      mode: "grid",
    },
  },
  {
    site: "pandadoc",
    title: "Kundcaset (Nomad, 92 % / 20 %) direkt efter hero",
    cohorts: ["ch:search"],
    cohortLabel: "Besökare från sök",
    rationale:
      "Sök-ankomster jämför alternativ — Will O'Neils berättelse med mätbara resultat (92 % snabbare offertskapande) svarar på ”varför just PandaDoc” före featurelistan.",
    detail: "Verifierad: designer-runda 5 (första grid-vinsten).",
    assumedDailyMatched: 600,
    plan: {
      action: "reorder",
      container: "#main-content > div:nth-of-type(1) > div:nth-of-type(1)",
      move: "#main-content > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(5)",
      after: "#main-content > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1)",
      mode: "grid",
    },
  },
];

function dataUri(path: string): string {
  return "data:image/jpeg;base64," + readFileSync(path).toString("base64");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function main() {
  const [shotsDir, outHtml, outRules] = process.argv.slice(2);
  if (!shotsDir || !outHtml || !outRules) {
    console.error("usage: approval-cards.ts <shotsDir> <outHtml> <outRulesJson>");
    process.exit(1);
  }

  const rules = CARDS.map((c) => ({
    id: `${c.site}-proof-first`,
    siteId: c.site,
    cohorts: c.cohorts,
    action: { kind: "planned_reorder", plan: c.plan },
    status: "proposed",
    ramp: 50,
    // The success contract is PART of what the owner approves: judged on the
    // primary only; guardrails can only pause. Site-type default until the
    // owner edits it on the card.
    success: defaultSuccessSpec("saas"),
    evidence: { rationale: c.rationale },
  }));
  mkdirSync(dirname(outRules), { recursive: true });
  writeFileSync(outRules, JSON.stringify(rules, null, 1));

  const cardsHtml = CARDS.map((c) => {
    const rule = rules.find((r) => r.siteId === c.site)!;
    const before = dataUri(`${shotsDir}/${c.site}-1-before-sm.jpg`);
    const after = dataUri(`${shotsDir}/${c.site}-2-after-sm.jpg`);
    const spec = rule.success;
    const primaryDef = metricById(spec.primary)!;
    // Time-to-verdict at a typical designer effect (+30 %) — detection time
    // scales with the TRUE effect, so this is "if the effect is this big".
    const verdictEst = estimateVerdictTime({
      dailyMatchedVisitors: c.assumedDailyMatched,
      baseRate: primaryDef.baseRateHint,
      mdeRel: 0.3,
      ramp: 50,
    });
    const earlyEst = estimateVerdictTime({
      dailyMatchedVisitors: c.assumedDailyMatched,
      baseRate: metricById("engaged")!.baseRateHint,
      mdeRel: 0.3,
      ramp: 50,
    });
    const guardChips = spec.guardrails
      .map((g) => {
        const def = metricById(g)!;
        const arrow = def.direction === "down" ? "↑ ⇒ paus" : "↓ ⇒ paus";
        return `<span class="chip guard">${esc(def.label.split(" (")[0])} ${arrow}</span>`;
      })
      .join("\n      ");
    return `
<article class="card">
  <div class="meta">
    <div class="site-row">
      <span class="site">${esc(c.site)}.com</span>
      <span class="status">FÖRSLAG</span>
    </div>
    <h2>${esc(c.title)}</h2>
    <div class="chips">
      <span class="chip" title="${esc(c.cohorts.join(", "))}">${esc(c.cohortLabel)}</span>
      <span class="chip ramp">Ramp 50 % · resten mäts som holdout</span>
    </div>
    <p class="rationale">${esc(c.rationale)}</p>
    <p class="verified">${esc(c.detail)}</p>
    <div class="success-def">
      <strong>Vad som räknas som vinst — godkänns tillsammans med ändringen:</strong>
      <div class="chips">
        <span class="chip primary-metric">Primärt mål: ${esc(primaryDef.label)} · MDE ±${Math.round((spec.mdeRel ?? 0.1) * 100)} %</span>
        ${guardChips}
      </div>
      <p class="timing">Domslut fälls ENDAST på primärmålet. Vid ~${c.assumedDailyMatched} matchande
      besökare/dag (antagande tills collector-data finns) och en effekt på ±30 %:
      domslut om ~${verdictEst.days} dagar (${verdictEst.nPerArm.toLocaleString("sv-SE")}/arm).
      Tidig riktningssignal via engagemang: ~${earlyEst.days} ${earlyEst.days === 1 ? "dag" : "dagar"} —
      indikation, aldrig domslut.</p>
    </div>
    <div class="safety">
      <strong>Säkerhetsnätet följer med:</strong> varje sidvisning kör om
      självkontrollerna (geometri, lyft, aldrig ovanför hero). Ändras sajten
      så att flytten inte längre håller refuserar den visningen tyst och
      regeln flaggas för omprövning. Guardrails ovan pausar regeln automatiskt
      vid uppmätt skada — även om primärmålet ser ut att vinna.
    </div>
    <details>
      <summary>Regeln som aktiveras</summary>
      <pre>${esc(JSON.stringify(rule, null, 1))}</pre>
    </details>
    <div class="approve-row">
      <span class="approve-btn" role="button" aria-disabled="true">Godkänn regeln</span>
      <code>bun run scripts/approve-rule.ts --rules=&lt;fil&gt; --rule=${esc(rule.id)}</code>
    </div>
  </div>
  <div class="evidence">
    <figure>
      <figcaption>FÖRE</figcaption>
      <div class="pane"><img src="${before}" alt="${esc(c.site)} före ändringen — hela sidan" loading="lazy"></div>
    </figure>
    <figure>
      <figcaption class="after">EFTER</figcaption>
      <div class="pane"><img src="${after}" alt="${esc(c.site)} efter ändringen — hela sidan" loading="lazy"></div>
    </figure>
  </div>
</article>`;
  }).join("\n");

  const html = `<title>Angel Adaptive — godkännandekö</title>
<style>
  :root {
    --bg: #F7F8FA; --surface: #FFFFFF; --ink: #1B2430; --ink-soft: #55616E;
    --line: #DCE3E6; --accent: #0E7A5F; --accent-ink: #FFFFFF;
    --status: #B26A00; --status-bg: #FBF3E4; --pane-bg: #EDF0F3;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #101418; --surface: #171D23; --ink: #E8ECF1; --ink-soft: #9AA7B4;
      --line: #273038; --accent: #34C79A; --accent-ink: #0B1210;
      --status: #E3A44C; --status-bg: #2A2115; --pane-bg: #0C1013;
    }
  }
  :root[data-theme="dark"] {
    --bg: #101418; --surface: #171D23; --ink: #E8ECF1; --ink-soft: #9AA7B4;
    --line: #273038; --accent: #34C79A; --accent-ink: #0B1210;
    --status: #E3A44C; --status-bg: #2A2115; --pane-bg: #0C1013;
  }
  :root[data-theme="light"] {
    --bg: #F7F8FA; --surface: #FFFFFF; --ink: #1B2430; --ink-soft: #55616E;
    --line: #DCE3E6; --accent: #0E7A5F; --accent-ink: #FFFFFF;
    --status: #B26A00; --status-bg: #FBF3E4; --pane-bg: #EDF0F3;
  }
  body { background: var(--bg); color: var(--ink); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 32px 20px 64px; }
  .wrap { max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }
  header h1 { font-size: 26px; font-weight: 650; letter-spacing: -0.015em; margin: 0 0 6px; text-wrap: balance; }
  header p { color: var(--ink-soft); max-width: 68ch; margin: 0; }
  header .step { text-transform: uppercase; letter-spacing: 0.08em; font-size: 11.5px; color: var(--accent); font-weight: 600; margin-bottom: 10px; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; display: grid; grid-template-columns: minmax(300px, 5fr) minmax(340px, 7fr); gap: 0; overflow: hidden; }
  .meta { padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; border-right: 1px solid var(--line); }
  .site-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .site { font-weight: 650; font-size: 13px; letter-spacing: 0.02em; color: var(--ink-soft); }
  .status { font-size: 10.5px; font-weight: 700; letter-spacing: 0.1em; color: var(--status); background: var(--status-bg); padding: 3px 9px; border-radius: 999px; }
  .meta h2 { font-size: 18.5px; font-weight: 650; letter-spacing: -0.01em; line-height: 1.3; margin: 0; text-wrap: balance; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font-size: 12px; font-weight: 600; border: 1px solid var(--line); border-radius: 999px; padding: 4px 11px; color: var(--ink); }
  .chip.ramp { color: var(--ink-soft); font-weight: 500; }
  .rationale { margin: 0; max-width: 58ch; }
  .verified { margin: 0; color: var(--ink-soft); font-size: 13px; }
  .safety { font-size: 13px; color: var(--ink-soft); border-left: 3px solid var(--accent); padding: 8px 12px; background: color-mix(in srgb, var(--accent) 6%, transparent); border-radius: 0 6px 6px 0; }
  .safety strong { color: var(--ink); }
  .success-def { font-size: 13px; border-left: 3px solid var(--status); padding: 8px 12px; background: color-mix(in srgb, var(--status) 7%, transparent); border-radius: 0 6px 6px 0; display: flex; flex-direction: column; gap: 8px; }
  .success-def strong { color: var(--ink); }
  .chip.primary-metric { border-color: var(--status); color: var(--ink); font-weight: 650; }
  .chip.guard { color: var(--ink-soft); font-weight: 500; }
  .timing { margin: 0; color: var(--ink-soft); }
  details { font-size: 13px; }
  details summary { cursor: pointer; color: var(--ink-soft); font-weight: 600; }
  details pre { background: var(--pane-bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow-x: auto; font: 11.5px/1.5 ui-monospace, "SF Mono", "Cascadia Code", monospace; }
  .approve-row { display: flex; flex-direction: column; gap: 8px; margin-top: auto; padding-top: 8px; }
  .approve-btn { display: inline-block; align-self: flex-start; background: var(--accent); color: var(--accent-ink); font-weight: 650; font-size: 14px; padding: 9px 22px; border-radius: 8px; cursor: default; }
  .approve-row code { font: 11.5px/1.4 ui-monospace, "SF Mono", monospace; color: var(--ink-soft); overflow-x: auto; }
  .evidence { display: grid; grid-template-columns: 1fr 1fr; gap: 0; background: var(--pane-bg); }
  .evidence figure { margin: 0; display: flex; flex-direction: column; min-width: 0; }
  .evidence figure + figure { border-left: 1px solid var(--line); }
  .evidence figcaption { font-size: 10.5px; font-weight: 700; letter-spacing: 0.12em; padding: 8px 12px; color: var(--ink-soft); border-bottom: 1px solid var(--line); background: var(--surface); }
  .evidence figcaption.after { color: var(--accent); }
  .pane { height: 560px; overflow-y: auto; overscroll-behavior: contain; }
  .pane img { display: block; width: 100%; max-width: 100%; height: auto; }
  footer { color: var(--ink-soft); font-size: 12.5px; max-width: 76ch; }
  @media (max-width: 900px) {
    .card { grid-template-columns: 1fr; }
    .meta { border-right: none; border-bottom: 1px solid var(--line); }
  }
</style>
<div class="wrap">
  <header>
    <div class="step">Angel Adaptive · E4b</div>
    <h1>Godkännandekö — tre regelförslag med bevis</h1>
    <p>Godkännandet gäller REGELN (kohort + förändring) OCH dess framgångsdefinition:
    vilket mått som får fälla domslutet (primärt mål) och vilka mått som bara kan
    pausa regeln vid skada (guardrails). Ett klick aktiverar regeln för alla
    matchande besökare, med halva trafiken i holdout för mätning. Skärmdumparna är
    verkliga fullsidor från valideringen — scrolla i panelerna. Knappen är en
    förhandsvisning av produktflödet; i dag vänds status via CLI-kommandot under den.</p>
  </header>
  ${cardsHtml}
  <footer>Reglerna ligger i <code>rules-proposed.json</code> (status: proposed,
  inkl. <code>success</code>-kontraktet). Serveringen accepterar bara
  <code>approved</code>, matchar kohorterna med OCH-logik, delar trafiken
  deterministiskt per besökare (FNV-hash mot ramp) och kör om varje applicerings
  självkontroller per sidvisning — refusal slår weirdness, varje gång. Mätningen är
  bunden av kontraktet: domslut endast på primärmålet, guardrails pausar vid skada,
  och underpowered världar blir ”fortsätt mäta”, aldrig felaktig pensionering —
  kalibrerat på 200 simulerade världar i <code>docs/metric-hierarchy.md</code>.</footer>
</div>`;

  mkdirSync(dirname(outHtml), { recursive: true });
  writeFileSync(outHtml, html);
  console.log(`cards → ${outHtml} (${Math.round(html.length / 1024)} KB)`);
  console.log(`rules → ${outRules} (${rules.length} proposed)`);
}

main();
