#!/usr/bin/env bun
// Bredd-test: håller frysning → extraktion → pixelgrindar på OLIKA riktiga
// sajter? Kör kedjans mekaniska del (inga LLM-designer) mot en lista frysta
// sidor — korpusens MHTML-frysningar (browser-vägen) och färska curl-frysningar
// (freeze-page.ts) — och rapporterar per sajt:
//
//   * laddar kopian i Chromium?
//   * hittar extraktionen sidans sektioner/CTA:er?
//   * klarar en mekanisk omflyttning (lyft en under-folden-sektion ×2) alla
//     pixelgrindar — inkl. kollisions-retryn — och är den byte-exakt reversibel?
//
// Detta testar MASKINERIET, inte designsmak: en sajt som faller här skulle
// falla för varje riktig design. Fel per sajt fångas och rapporteras — ett
// haveri stoppar inte resten.
//
//   bun run scripts/redesign/breadth-test.ts --targets=targets.json --out=out
//   targets.json: [{ "name": "hubspot", "type": "mhtml"|"html", "path": "..." }]

import { chromium, type Page } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { runGatedAttempts, type MeasureOp } from "./measure";

const EXEC =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const targets = JSON.parse(readFileSync(arg("targets")!, "utf8")) as {
  name: string;
  type: "mhtml" | "html";
  path: string;
}[];
const outDir = arg("out") ?? "breadth-test-out";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: EXEC });
const report: Record<string, unknown>[] = [];

for (const t of targets) {
  const row: Record<string, unknown> = { name: t.name, type: t.type };
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    if (t.type === "mhtml") {
      // file:// är Chromiums enda MHTML-transport (samma väg som snapshot-harnesset).
      const tmp = join(mkdtempSync(join(tmpdir(), "breadth-")), "page.mhtml");
      copyFileSync(t.path, tmp);
      await page.goto(`file://${tmp}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } else {
      await page.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
      await page.setContent(readFileSync(t.path, "utf8"), { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await page.waitForTimeout(600);

    // Extraktion mot den RENDERADE dom:en (mhtml kan skilja sig från rå html).
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    const content = extractContentModel(html);
    row.sections = content.sections.map((s) => `${s.type}:${s.heading.slice(0, 30)}`);
    row.ctas = content.ctas.filter((c) => c.intent === "conversion").map((c) => c.text.slice(0, 25));
    row.trust = content.trustSignals.length;

    if (content.sections.length < 2) {
      row.verdict = "too_few_sections";
      report.push(row);
      await context.close();
      continue;
    }
    // Mekanisk plan: lyft den mest bevis-artade under-folden-sektionen ×2,
    // annars sista sektionen — testar lokatorer + grindar, inte designsmak.
    const prefer = ["testimonials", "comparison", "pricing", "faq"];
    const candidates = content.sections.slice(2);
    const target =
      prefer.map((p) => candidates.find((s) => s.type === p)).find(Boolean) ??
      candidates[candidates.length - 1] ??
      content.sections[content.sections.length - 1];
    row.movePlan = `${target.type}: ${target.heading.slice(0, 40)} ×2`;
    const ctaTexts = content.ctas.filter((c) => c.intent === "conversion").map((c) => c.text);

    // Samma delade tvåfas-mätning OCH grind-loop som verifieringspipelinen
    // (measure.ts runGatedAttempts) — ingen egen kopia av semantiken eller
    // retry-räkningen.
    const baseOps: MeasureOp[] = [
      { op: "move_up", find: target.heading },
      { op: "move_up", find: target.heading },
    ];
    const gated = await runGatedAttempts(page, baseOps, ctaTexts);
    const last = gated.attempts[gated.attempts.length - 1] ?? null;
    const attempts = gated.attempts.length;
    if (gated.unresolvable) {
      row.verdict = "not_applicable";
      row.reasons = ["v3-upplösningen vägrade (ingen ren sektionsnivå för målet) — fail closed"];
      await context.close();
      report.push(row);
      console.log(`  ${t.name}: ${row.verdict} · plan: ${row.movePlan}`);
      continue;
    }
    row.verdict = last!.gate.verdict;
    row.attempts = attempts;
    row.gates = {
      overlapIntroducedPx: last!.gate.verticalOverlapIntroducedPx,
      hOverflowIntroducedPx: last!.gate.hOverflowIntroducedPx,
      movedAboveMain: last!.measurements.movedAboveMain,
      ctaChecked: last!.measurements.ctaChecked,
      ctaBroken: last!.measurements.ctaBroken,
      appliedMoves: `${last!.measurements.appliedMoves}/${last!.measurements.requestedMoves}`,
      reversible: last!.measurements.reversedOrderMatches,
    };
    row.reasons = last!.gate.reasons;
    await page.screenshot({ path: join(outDir, `${t.name}-before.jpg`), type: "jpeg", quality: 50 });
    await context.close();
  } catch (err) {
    row.verdict = "error";
    row.error = String(err).slice(0, 300);
  }
  report.push(row);
  console.log(
    `  ${t.name}: ${row.verdict}${row.movePlan ? ` · plan: ${row.movePlan}` : ""}${row.error ? ` · ${row.error}` : ""}`,
  );
}

await browser.close();
writeFileSync(join(outDir, "breadth-report.json"), JSON.stringify(report, null, 2));
console.log(`\nreport: ${outDir}/breadth-report.json`);
