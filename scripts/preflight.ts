#!/usr/bin/env bun
// Visuell pre-flight: kör Angel mot en riktig sida i Browserbase och svara på
// EN fråga — "blir det snyggt, eller riskerar vi att försämra sidan?" — INNAN
// något visas för en besökare.
//
//   bun run scripts/preflight.ts --url=https://kund.se/sida \
//     [--site=kund.se] [--personas=google_desktop,google_mobile] \
//     [--goal-selector='...' --goal-text='...' --goal-kind=signup --goal-url=/x] \
//     [--out=preflight-out]
//
// För varje persona: riktig audit → riktig inventory → riktiga snippeten →
// decide+apply → FÖRE/EFTER-skärmdumpar + hela robustness-mätningen inkl.
// skönhetsgrindarna (VisualSanity: flyttat-ovanför-huvudinnehåll, introducerad
// horisontell overflow) → verdikt per persona. Allt skrivs till --out som
// JPEG:er + report.json; exit 1 om någon persona failar.
//
// Nätverk: Browserbase-hosts måste ligga i NO_PROXY/no_proxy i den här miljön
// (samma som freeze): api.browserbase.com,.browserbase.com,connect.browserbase.com

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";
import { openPage, dismissConsent, waitForContent } from "../src/lib/tests/robustness/session.server";
import { runSnippetRobustness, type Shot } from "../src/lib/tests/robustness/runner.server";
import { ALL_PERSONAS, type PersonaId } from "../src/lib/tests/robustness/personas";
import type { SiteGoal } from "@/adaptive/decide";

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : undefined;
}

const url = arg("url");
if (!url) {
  console.error("Usage: bun run scripts/preflight.ts --url=https://... [--site=] [--personas=] [--goal-selector= --goal-text= --goal-kind= --goal-url=] [--out=]");
  process.exit(1);
}
const site = arg("site") ?? new URL(url).hostname.replace(/^www\./, "");
const outDir = arg("out") ?? "preflight-out";
const personas = ((arg("personas")?.split(",") as PersonaId[] | undefined) ?? ALL_PERSONAS).filter(
  (p) => (ALL_PERSONAS as readonly string[]).includes(p),
);

const goal: SiteGoal | null =
  arg("goal-selector") || arg("goal-text")
    ? {
        selector: arg("goal-selector") ?? null,
        text: arg("goal-text") ?? null,
        kind: arg("goal-kind") ?? null,
        url: arg("goal-url") ?? null,
      }
    : null;

const snippetSource = readFileSync("public/adaptive.js", "utf8");

mkdirSync(outDir, { recursive: true });

console.log(`[preflight] ${url} · site=${site} · personas=${personas.join(",")}${goal ? ` · goal="${goal.text}" (${goal.kind ?? "?"})` : " · goal=deterministic floor"}`);

const session = await createSession();
let exitCode = 0;
try {
  const { page, close } = await openPage(session.id);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await waitForContent(page);
    await dismissConsent(page);
    await new Promise((r) => setTimeout(r, 1200));

    const shots: Shot[] = [];
    const reports = await runSnippetRobustness(page, {
      url,
      site,
      personas,
      snippetSource,
      goal,
      captureShots: true,
      onShot: (s) => shots.push(s),
    });

    for (const s of shots) {
      const p = join(outDir, `${s.persona}-${s.phase}.jpg`);
      writeFileSync(p, Buffer.from(s.jpegBase64, "base64"));
    }
    writeFileSync(join(outDir, "report.json"), JSON.stringify(reports, null, 2));

    for (const r of reports) {
      const v = r.metrics.visual;
      const line = [
        r.verdict.toUpperCase().padEnd(5),
        r.persona.padEnd(18),
        `decided=${r.metrics.decided}`,
        `targeted=${r.metrics.targeted}`,
        `shift=${Math.round(r.metrics.layout.shiftedFraction * 100)}%`,
        v ? `movedAboveMain=${v.movedAboveMain}` : "",
        v ? `hOverflow=${v.hOverflowIntroducedPx}px` : "",
        `reversible=${r.metrics.reversible}`,
      ].join("  ");
      console.log(line);
      for (const reason of r.reasons) console.log(`      · ${reason}`);
      for (const d of r.declined ?? []) console.log(`      ø ${d.pattern}: ${d.reason}`);
      if (r.verdict === "fail") exitCode = 1;
    }
    console.log(`[preflight] shots + report.json -> ${outDir}/`);
  } finally {
    await close();
  }
} finally {
  await closeSession(session.id).catch(() => {});
}
process.exit(exitCode);
