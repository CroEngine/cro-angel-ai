#!/usr/bin/env bun
// Bredd-verifiering av HELA kedjan mot riktiga sajter (ägarorder 2026-07-17):
// per sajt: frysning (--render=auto, SPA-vägen inkl.) → extraktion → RIKTIG
// AI-design (anthropicDesigner — samma adapter som nattloopen) → validering →
// pixelgrindar med retry (runGatedAttempts, LCP-vakten inkl.) → FÖRE/EFTER-
// skärmdumpar → rad i rapporten. Fel per sajt isoleras — ett haveri stoppar
// aldrig resten.
//
// ÄRLIGHET: främmande sajter har ingen besöksdata i Angel — detect-steget kan
// inte köras på riktigt. Segmentunderlaget är SYNTETISKT och märks så i både
// brief och rapport. Det som verifieras är MASKINERIET från start till slut:
// skulle kedjan ha producerat en grindad, reversibel variant på den här
// sajten? Inget skrivs till angel_sites/angel_events; enda skrivningen är
// rapport + skärmdumpar till angel-evidence-bucketen (breadth/<run>/).
//
//   bun run scripts/verify/breadth-verify.ts --targets=scripts/verify/breadth-20.json \
//     --out=breadth-verify-out [--upload=1] [--run=<id>]

import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { buildRedesignContext, segmentInsightFrom } from "../../src/adaptive/redesign/context";
import { generateRedesign } from "../../src/adaptive/redesign/generate";
import { anthropicDesigner } from "../loop/designer";
import {
  captureLcpElement,
  measurePlan,
  runGatedAttempts,
  type MeasureOp,
} from "../redesign/measure";
import type { SegmentSummary } from "../../src/lib/dashboard/aggregate";

const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const targetsPath = arg("targets");
const outDir = arg("out") ?? "breadth-verify-out";
const UPLOAD = arg("upload") === "1";
const RUN_ID = arg("run") ?? `run-${Date.now()}`;
if (!targetsPath) {
  console.error("usage: breadth-verify.ts --targets=<json> [--out=dir] [--upload=1]");
  process.exit(1);
}
const targets = JSON.parse(readFileSync(targetsPath, "utf8")) as { name: string; url: string }[];
mkdirSync(outDir, { recursive: true });

// Syntetiskt segment — ÄRLIGT MÄRKT. Samma form som labbets (redesign-render).
const SYNTH_SUMMARY: SegmentSummary = {
  key: "instagram·mobile·SE",
  label: "instagram · mobile · SE",
  depth: 3,
  channel: "instagram",
  device: "mobile",
  country: "SE",
  returning: null,
  visits: 1680,
  conversions: 104,
  conversionRate: 0.062,
  formStarts: 0,
  formAbandons: 0,
  adequate: true,
  recent: { visits: 900, conversions: 80, conversionRate: 0.089, adequate: false },
};
const SYNTH_NOTE =
  "SYNTHETIC breadth-test insight — this site has no real visitor data in Angel; the segment numbers are a fixed test fixture.";

/** Sektions-id → mät-lokator — SAMMA semantik som auto-generate:s locatorFor
 *  (hjälten bor i h1, allt annat i h2). */
function locFor(content: ReturnType<typeof extractContentModel>, targetId: string) {
  const sec = content.sections.find((s) => s.id === targetId);
  if (!sec?.heading) return null;
  return { tag: sec.type === "hero" ? "h1" : "h2", text: sec.heading };
}

interface Row {
  name: string;
  url: string;
  verdict: string;
  sections?: string[];
  ctas?: string[];
  goal?: string | null;
  designOps?: { op: string; target: string; detail?: string }[];
  attempts?: number;
  reasons?: string[];
  lcpFound?: boolean;
  frozenBytes?: number;
  error?: string;
  shots?: { before?: string; after?: string };
  ms?: number;
}
const rows: Row[] = [];

const browser = await chromium.launch({ headless: true, executablePath: EXEC });

for (const t of targets) {
  const t0 = Date.now();
  const row: Row = { name: t.name, url: t.url, verdict: "error" };
  rows.push(row);
  try {
    // 1) Frys (auto: statisk → browser-fallback för SPA-skal).
    const frozen = join(outDir, `frozen-${t.name}.html`);
    if (!existsSync(frozen)) {
      const r = Bun.spawnSync(
        ["bun", "run", "scripts/redesign/freeze-page.ts", `--url=${t.url}`, `--out=${frozen}`],
        { stdout: "inherit", stderr: "inherit" },
      );
      if (r.exitCode !== 0 || !existsSync(frozen)) {
        row.verdict = "freeze_failed";
        console.log(`  ${t.name}: FRYSNING föll`);
        continue;
      }
    }
    const html = readFileSync(frozen, "utf8");
    row.frozenBytes = html.length;

    // 2) Extraktion mot frysta kopian.
    const content = extractContentModel(html);
    row.sections = content.sections.map((s) => `${s.type}:${s.heading.slice(0, 30)}`);
    const convCtas = content.ctas.filter((c) => c.intent === "conversion");
    row.ctas = convCtas.map((c) => c.text.slice(0, 25));
    if (content.sections.length < 2) {
      row.verdict = "too_few_sections";
      console.log(`  ${t.name}: för få sektioner (${content.sections.length}) — ärligt stopp`);
      continue;
    }
    const goal = convCtas.find((c) => c.aboveFold)?.text ?? convCtas[0]?.text ?? null;
    row.goal = goal;

    // 3) RIKTIG designer på ärligt märkt syntetiskt segment.
    const ctx = buildRedesignContext({
      site: `breadth--${t.name}`,
      goal: { text: goal, kind: null, selector: null },
      page: {
        url: t.url,
        frozenHtmlPath: frozen,
        screenshotPath: "",
        viewport: { width: 390, height: 844 },
      },
      content,
      segment: segmentInsightFrom(SYNTH_SUMMARY, { observations: [SYNTH_NOTE] }),
    });
    const plan = await generateRedesign(ctx, anthropicDesigner);
    if (plan.ops.length === 0) {
      row.verdict = "no_valid_plan";
      row.reasons = plan.notes ?? [];
      console.log(
        `  ${t.name}: ingen giltig plan (${(plan.notes ?? []).join("; ") || "tomt svar"})`,
      );
      continue;
    }
    row.designOps = plan.ops.map((o) => ({
      op: o.op,
      target: content.sections.find((s) => s.id === o.targetId)?.heading.slice(0, 40) ?? o.targetId,
      detail: o.op === "set_text" ? o.detail.slice(0, 60) : undefined,
    }));

    // 4) Op → mät-lokatorer (samma semantik som produktionsvägen).
    const measureOps: MeasureOp[] = [];
    for (const o of plan.ops) {
      const loc = locFor(content, o.targetId);
      if (!loc) {
        measureOps.length = 0;
        break;
      }
      measureOps.push(
        o.op === "move_up"
          ? { op: "move_up", tag: loc.tag, find: loc.text }
          : { op: "set_text", tag: loc.tag, find: loc.text, set: o.detail },
      );
    }
    if (measureOps.length !== plan.ops.length) {
      row.verdict = "no_locator";
      console.log(`  ${t.name}: lokator saknas — hålls tillbaka`);
      continue;
    }
    const ctaTexts = [...new Set(convCtas.map((c) => c.text))];

    // 5) Pixelgrindar + skärmdumpar i frysta kopian (offline utom data-URI:er).
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await context.route("**/*", (r) =>
        r.request().url().startsWith("data:") ? r.continue() : r.abort(),
      );
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(600);
      // FÖRE fullPage-dumpen — den scrollar och förorenar LCP-entries.
      const lcp = await captureLcpElement(page);
      row.lcpFound = lcp.found;
      const beforeShot = `before-${t.name}.jpg`;
      await page.screenshot({
        path: join(outDir, beforeShot),
        type: "jpeg",
        quality: 45,
        fullPage: true,
      });
      row.shots = { before: beforeShot };

      const gated = await runGatedAttempts(page, measureOps, ctaTexts);
      if (gated.unresolvable) {
        row.verdict = "not_applicable";
        row.reasons = ["v3-upplösningen vägrade (ingen ren sektionsnivå) — fail closed"];
      } else {
        const last = gated.attempts[gated.attempts.length - 1];
        row.verdict = last.gate.verdict;
        row.attempts = gated.attempts.length;
        row.reasons = last.gate.reasons;
        if (last.gate.verdict === "pass") {
          await measurePlan(page, gated.attemptOps, [], true);
          const afterShot = `after-${t.name}.jpg`;
          await page.screenshot({
            path: join(outDir, afterShot),
            type: "jpeg",
            quality: 45,
            fullPage: true,
          });
          row.shots.after = afterShot;
        }
      }
    } finally {
      await context.close();
    }
  } catch (err) {
    row.verdict = "error";
    row.error = String(err).slice(0, 300);
  }
  row.ms = Date.now() - t0;
  console.log(
    `  ${t.name}: ${row.verdict}${row.attempts ? ` (${row.attempts} försök)` : ""}${row.error ? ` · ${row.error.slice(0, 120)}` : ""} · ${Math.round((row.ms ?? 0) / 1000)}s`,
  );
}
await browser.close();

// ── rapport ──────────────────────────────────────────────────────────────────
const summary = {
  runId: RUN_ID,
  targets: targets.length,
  pass: rows.filter((r) => r.verdict === "pass").length,
  heldBack: rows.filter((r) => ["fail", "not_applicable", "no_locator"].includes(r.verdict)).length,
  noPlan: rows.filter((r) => r.verdict === "no_valid_plan").length,
  tooFewSections: rows.filter((r) => r.verdict === "too_few_sections").length,
  freezeFailed: rows.filter((r) => r.verdict === "freeze_failed").length,
  errors: rows.filter((r) => r.verdict === "error").length,
};
writeFileSync(join(outDir, "breadth-report.json"), JSON.stringify({ summary, rows }, null, 2));

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rowHtml = (r: Row) =>
  `<section class="site"><h2>${esc(r.name)} <span class="v v-${esc(r.verdict)}">${esc(r.verdict)}</span></h2>
  <div class="meta">${esc(r.url)} · ${r.sections?.length ?? 0} sektioner · mål: ${esc(r.goal ?? "—")}${r.attempts ? ` · ${r.attempts} försök` : ""}</div>
  ${r.designOps?.length ? `<ul>${r.designOps.map((o) => `<li><code>${esc(o.op)}</code> → ${esc(o.target)}${o.detail ? ` — "${esc(o.detail)}"` : ""}</li>`).join("")}</ul>` : ""}
  ${r.reasons?.length ? `<div class="reasons">${r.reasons.map((x) => esc(x)).join("<br>")}</div>` : ""}
  ${r.error ? `<div class="reasons">${esc(r.error)}</div>` : ""}
  ${r.shots ? `<div class="par">${r.shots.before ? `<figure><img src="${esc(r.shots.before)}" loading="lazy"><figcaption>FÖRE</figcaption></figure>` : ""}${r.shots.after ? `<figure><img src="${esc(r.shots.after)}" loading="lazy"><figcaption>EFTER (grindad plan applicerad)</figcaption></figure>` : ""}</div>` : ""}
  </section>`;
const reportHtml = `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Bredd-verifiering — ${esc(RUN_ID)}</title>
<style>body{font-family:ui-sans-serif,system-ui;max-width:980px;margin:2rem auto;padding:0 1rem;color:#111}
h1{font-size:1.4rem}.sum{background:#f4f4f4;border-radius:8px;padding:.8rem 1rem;margin:1rem 0}
.site{border-top:1px solid #eee;padding:1rem 0}.meta{color:#666;font-size:.85rem}
.v{font-size:.75rem;padding:.15rem .5rem;border-radius:99px;background:#eee;vertical-align:middle}
.v-pass{background:#d1fae5;color:#065f46}.v-fail,.v-error,.v-freeze_failed{background:#fee2e2;color:#991b1b}
.reasons{font-size:.85rem;color:#92400e;margin:.4rem 0}
.par{display:flex;gap:2%;margin:.6rem 0}.par figure{margin:0;width:49%}.par img{width:100%;border:1px solid #ddd;border-radius:4px}
figcaption{font-size:.75rem;color:#666;text-align:center}</style></head><body>
<h1>Bredd-verifiering av hela kedjan — ${targets.length} sajter</h1>
<div class="sum"><b>${summary.pass} pass</b> · ${summary.heldBack} ärligt tillbakahållna · ${summary.noPlan} utan giltig plan · ${summary.tooFewSections} för få sektioner · ${summary.freezeFailed} frysfel · ${summary.errors} fel.
<br>Segmentunderlaget är SYNTETISKT (märkt i varje brief) — det som verifieras är maskineriet: frysning → extraktion → AI-design → validering → pixelgrindar → reversibilitet.</div>
${rows.map(rowHtml).join("\n")}
</body></html>`;
writeFileSync(join(outDir, "report.html"), reportHtml);
console.log(`\n[breadth] ${JSON.stringify(summary)}`);

// ── uppladdning till angel-evidence (publik läsning, som day0) ───────────────
if (UPLOAD) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.log("[breadth] SUPABASE-secrets saknas — hoppar uppladdning");
  } else {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const files = ["report.html", "breadth-report.json"].concat(
      rows.flatMap((r) => [r.shots?.before, r.shots?.after].filter((x): x is string => !!x)),
      // Frysta kopiorna följer med (retestfynd 2026-07-18): utan dem går
      // runnerns grind-utfall inte att obducera — lokala omfrysningar av
      // samma sajt ger andra varianter (geo/AB/consent) och ledde fel.
      rows
        .filter((r) => typeof r.frozenBytes === "number")
        .map((r) => `frozen-${r.name}.html`)
        .filter((f) => existsSync(join(outDir, f))),
    );
    for (const f of files) {
      const type = f.endsWith(".json")
        ? "application/json"
        : f.endsWith(".jpg")
          ? "image/jpeg"
          : "text/html; charset=utf-8";
      const { error } = await db.storage
        .from("angel-evidence")
        .upload(`breadth/${RUN_ID}/${f}`, readFileSync(join(outDir, f)), {
          contentType: type,
          upsert: true,
        });
      if (error) console.warn(`[breadth] uppladdning föll (${f}): ${error.message}`);
    }
    const publicUrl = db.storage
      .from("angel-evidence")
      .getPublicUrl(`breadth/${RUN_ID}/report.html`).data.publicUrl;
    console.log(`[breadth] rapport → ${publicUrl}`);
  }
}
