#!/usr/bin/env bun
// Prospekt-förhandsvisningens arbetare (trattens topp) — kör NATTLOPPENS EGEN
// kedja på prospektets URL (ägarbeslut 2026-07-27: "samma kod på samma
// ställe"): freeze-page (Browserbase-fallback för SPA) → extractContentModel →
// produktions-designern → auto-generate verify (samma rendergrindar, samma
// skärmdumpar). Varje framtida motorförbättring ärvs av demon automatiskt —
// den gamla granska-site-vägen driftade (SPA-blind) för att den var separat.
//
// Ärlighetskontraktet: den syntetiska cellen ("mobil Google-besökare") driver
// bara maskineriet och MÄRKS som illustrativ i rapporten — det äkta är
// before/after-skärmdumparna från prospektets riktiga sida och de verifierade
// ändringarna. Grind-fail ⇒ ärlig "hölls tillbaka"-rapport, aldrig fejkat
// efter-läge. Skriver ALDRIG i variant-/mättabeller — bara jobbraden +
// preview-lagringen.
//
// Fail-open till ingenting: saknade env-nycklar ⇒ loggad no-op, aldrig krasch.
//
//   bun run scripts/loop/preview.ts [--cap=3]

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { anthropicDesigner } from "./designer";
import { generateRedesign } from "../../src/adaptive/redesign/generate";
import { buildRedesignContext, segmentInsightFrom } from "../../src/adaptive/redesign/context";
import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { segmentDims } from "../../src/lib/segment-key";
import type { SegmentSummary } from "../../src/lib/dashboard/aggregate";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const CAP = Number(arg("cap") ?? 3);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log(
    "[preview] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas — no-op (lägg secrets i Actions).",
  );
  process.exit(0);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY);
const outRoot = arg("out") ?? "preview-out";

const PREVIEW_STALE_HOURS = 48;

const spawnBun = (args: string[]): boolean =>
  Bun.spawnSync(["bun", "run", ...args], { stdout: "inherit", stderr: "inherit" }).exitCode === 0;

const dataUri = (p: string): string | null => {
  try {
    return `data:image/jpeg;base64,${readFileSync(p).toString("base64")}`;
  } catch {
    return null;
  }
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Självbärande rapport (data-URI-bilder — inga externa beroenden). Det äkta
 *  lyfts, det syntetiska märks: samma ärlighet som produkten säljer. */
function renderReport(o: {
  host: string;
  verified: boolean;
  before: string | null;
  after: string | null;
  changes: { label: string; why: string }[];
}): string {
  const shots =
    o.verified && o.before && o.after
      ? `<div class="pair"><figure><figcaption>Before — your page today</figcaption><img src="${o.before}" alt="before"></figure>
         <figure><figcaption>After — with Angel's verified change</figcaption><img src="${o.after}" alt="after"></figure></div>`
      : o.before
        ? `<div class="pair"><figure><figcaption>Your page as Angel read it</figcaption><img src="${o.before}" alt="page"></figure></div>`
        : "";
  const changeRows = o.changes
    .map((c) => `<li><strong>${esc(c.label)}</strong>${c.why ? ` — ${esc(c.why)}` : ""}</li>`)
    .join("");
  const verdictBlock = o.verified
    ? `<p class="ok">✓ Verified on your actual page: no layout shift, your largest content element untouched, fully reversible.</p>`
    : `<p class="held">Angel drafted a change but its safety gates didn't clear it this time — so it shows you nothing rather than something worse. That refusal is the same honesty that guards your site in production.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>What Angel would change on ${esc(o.host)}</title>
<style>
  body{margin:0;background:#fafaf9;color:#1c1917;font:15px/1.6 system-ui,sans-serif}
  main{max-width:880px;margin:0 auto;padding:40px 20px}
  h1{font-size:26px;letter-spacing:-.01em}
  .kicker{font:11px/1 ui-monospace,monospace;letter-spacing:.12em;color:#a8a29e;text-transform:uppercase}
  .pair{display:grid;gap:16px;grid-template-columns:1fr;margin:24px 0}
  @media(min-width:720px){.pair{grid-template-columns:1fr 1fr}}
  figure{margin:0;border:1px solid #e7e5e4;border-radius:12px;overflow:hidden;background:#fff}
  figcaption{padding:8px 12px;font-size:12px;color:#78716c;border-bottom:1px solid #f0eee9}
  img{display:block;width:100%}
  ul{padding-left:20px}
  .ok{color:#047857;font-weight:600}
  .held{color:#b45309}
  .note{font-size:12.5px;color:#a8a29e;border-top:1px solid #e7e5e4;padding-top:14px;margin-top:28px}
  .cta{display:inline-block;margin-top:18px;background:#047857;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px}
</style></head><body><main>
<div class="kicker">[ angel · free example ]</div>
<h1>What Angel would change on ${esc(o.host)}</h1>
${verdictBlock}
${shots}
${changeRows ? `<h2>The change, in plain words</h2><ul>${changeRows}</ul>` : ""}
<p>Angel reads what your site already publishes and re-surfaces your strongest content per visitor — then proves the lift against a held-back control group once installed.</p>
<a class="cta" href="https://croengine.netlify.app/signup">Install Angel — one line of code</a>
<p class="note">Honesty note: the visitor scenario used here (a mobile visitor arriving from Google) is illustrative — Angel hasn't seen your real visitors yet. The screenshots and the change above are real and were verified on your actual page. After install, proposals are earned from your real traffic and A/B-proven before anything is called a win.</p>
</main></body></html>`;
}

// ── förlegade jobb ───────────────────────────────────────────────────────────
const staleBefore = new Date(Date.now() - PREVIEW_STALE_HOURS * 3600 * 1000).toISOString();
await db
  .from("angel_preview_jobs")
  .update({ status: "failed", error: "expired", updated_at: new Date().toISOString() })
  .eq("status", "queued")
  .lt("created_at", staleBefore);

// ── kön ──────────────────────────────────────────────────────────────────────
const { data: jobs, error: qErr } = await db
  .from("angel_preview_jobs")
  .select("id,url")
  .eq("status", "queued")
  .order("created_at", { ascending: true })
  .limit(CAP);
if (qErr) {
  console.error(`[preview] kunde inte läsa kön: ${qErr.message}`);
  process.exit(1);
}
if (!jobs?.length) {
  console.log("[preview] kön är tom");
  process.exit(0);
}
console.log(`[preview] ${jobs.length} jobb i kön`);

const fail = async (id: string, error: string) => {
  await db
    .from("angel_preview_jobs")
    .update({ status: "failed", error, updated_at: new Date().toISOString() })
    .eq("id", id);
};

for (const job of jobs) {
  const dir = join(outRoot, job.id);
  mkdirSync(dir, { recursive: true });
  console.log(`\n[preview] ── ${job.id} (${job.url}) ──`);
  await db
    .from("angel_preview_jobs")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", job.id);

  const host = new URL(job.url).hostname;
  const site = `preview--${host}`;
  const frozen = join(dir, "frozen-home.html");

  // 1. Frys prospektets sida — freeze-page:s auto-läge tar Browserbase när
  //    det statiska skalet är för tunt (SPA-luckan som fällde granska-vägen).
  if (!spawnBun(["scripts/redesign/freeze-page.ts", `--url=${job.url}`, `--out=${frozen}`])) {
    console.warn(`[preview] ${job.id}: frysningen föll — failed`);
    await fail(job.id, "could_not_analyze");
    continue;
  }
  const content = extractContentModel(readFileSync(frozen, "utf8"));
  if (content.sections.length < 1) {
    console.warn(`[preview] ${job.id}: för tunn sida (${content.sections.length} sektioner)`);
    await fail(job.id, "could_not_analyze");
    continue;
  }

  // 2. Designa med produktions-designern — syntetisk cell, ärligt märkt.
  //    visits 0 är sant: ingen besöksdata finns före installation.
  const key = "google·mobile";
  const dims = segmentDims(key);
  const observations = [
    "FÖRHANDSVISNING (prospekt): snippeten är inte installerad — ingen riktig besöksdata finns.",
    "Designa för ett generellt men vanligt scenario: en mobil besökare som landar från Google.",
    "Föreslå EN tydlig, säker förbättring som går att verifiera visuellt på den frysta sidan.",
  ];
  const summary: SegmentSummary = {
    key,
    label: dims.join(" · "),
    depth: dims.length,
    channel: dims[0] ?? null,
    device: dims[1] ?? null,
    country: null,
    returning: null,
    visits: 0,
    conversions: 0,
    conversionRate: 0,
    formStarts: 0,
    formAbandons: 0,
    adequate: true,
    recent: null,
  };
  const ctx = buildRedesignContext({
    site,
    goal: { text: null, kind: null, selector: null },
    page: {
      url: job.url,
      frozenHtmlPath: frozen,
      screenshotPath: "",
      viewport: { width: 390, height: 844 },
    },
    content,
    segment: segmentInsightFrom(summary, { observations }),
    sourcePages: [],
  });
  const plan = await generateRedesign(ctx, anthropicDesigner);
  if (plan.ops.length === 0) {
    console.warn(`[preview] ${job.id}: designern gav ingen giltig plan (${plan.note ?? "tomt"})`);
    await fail(job.id, "could_not_analyze");
    continue;
  }

  // 3. Verifiera genom SAMMA grindkedja som produktionen (auto-generate
  //    verify: riktig Chromium, rendergrindar, before/after-skärmdumpar).
  writeFileSync(join(dir, "pages.json"), JSON.stringify({ "/": frozen }));
  writeFileSync(
    join(dir, "site.json"),
    JSON.stringify({ conversion_text: null, conversion_kind: null, conversion_selector: null }),
  );
  writeFileSync(
    join(dir, "plans.json"),
    JSON.stringify([
      {
        path: "/",
        key,
        total: { visits: 0, conversions: 0 },
        observations,
        sourcePaths: [],
        ops: plan.ops,
      },
    ]),
  );
  const verifyOk = spawnBun([
    "scripts/redesign/auto-generate.ts",
    "--mode=verify",
    `--plans=${join(dir, "plans.json")}`,
    `--pages=${join(dir, "pages.json")}`,
    `--site=${site}`,
    `--base-url=https://${host}`,
    `--site-config=${join(dir, "site.json")}`,
    `--out=${dir}`,
  ]);

  // 4. Rapport ur verify-bevisen. VERIFIED ⇒ riktiga before/after; grind-fail
  //    ⇒ ärlig "hölls tillbaka" med före-bilden. Slug-regeln speglar
  //    auto-generate ("home--google-mobile").
  let verified: { serveOps?: { op?: string; locator?: { text?: string }; why?: string }[] } | null =
    null;
  try {
    const results = JSON.parse(readFileSync(join(dir, "verify-report.json"), "utf8")) as {
      serveOps?: { op?: string; locator?: { text?: string }; why?: string }[];
    }[];
    verified = verifyOk && results.length > 0 ? results[0] : null;
  } catch {
    verified = null;
  }
  const slug = `home--${key.replace(/·/g, "-")}`;
  const before = dataUri(join(dir, `${slug}-before.jpg`));
  const after = verified ? dataUri(join(dir, `${slug}-after.jpg`)) : null;
  const OP_LABEL: Record<string, string> = {
    move_up: "Lifted higher on the page",
    set_text: "Sharpened the wording",
    insert_snippet: "Surfaced proof from another page",
  };
  // Visningsraderna: VERIFIED ⇒ serve-ops (locator.text är rubriken opsen
  // låstes mot). Gate-fail-fallback ⇒ designer-ops (targetId → rubrik ur
  // innehållsmodellen). RedesignOp bär inga locators — det gör bara ServeOp.
  const displayOps = verified?.serveOps?.length
    ? verified.serveOps.map((o) => ({ op: o.op ?? "", text: o.locator?.text ?? "", why: o.why ?? "" }))
    : plan.ops.map((o) => ({
        op: o.op,
        text: content.sections.find((s) => s.id === o.targetId)?.heading ?? o.targetId,
        why: o.why,
      }));
  const changes = displayOps.map((o) => ({
    label: `${OP_LABEL[o.op] ?? "Change"}: “${o.text}”`,
    why: o.why,
  }));
  const reportHtml = renderReport({
    host,
    verified: !!(verified && before && after),
    before,
    after,
    changes,
  });
  const reportPath = join(dir, "rapport.html");
  writeFileSync(reportPath, reportHtml);

  const storKey = `preview/${job.id}/report.html`;
  const { error: upErr } = await db.storage
    .from("angel-evidence")
    .upload(storKey, readFileSync(reportPath), { contentType: "text/html", upsert: true });
  if (upErr) {
    console.warn(`[preview] ${job.id}: uppladdning föll: ${upErr.message} — failed`);
    await fail(job.id, "upload_failed");
    continue;
  }
  const publicUrl = db.storage.from("angel-evidence").getPublicUrl(storKey).data.publicUrl;

  // /try-sidans fynd-rad: rubrikerna designern målade mot + verdiktet.
  const findings = {
    headlines: changes.map((c) => c.label).slice(0, 3),
    liftTest: verified
      ? "Verified on your page — no layout shift, LCP untouched, fully reversible"
      : null,
  };

  const { error: updErr } = await db
    .from("angel_preview_jobs")
    .update({
      status: "ok",
      report_url: publicUrl,
      findings,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (updErr) console.warn(`[preview] ${job.id}: stämpling föll: ${updErr.message}`);
  else
    console.log(
      `[preview] ${job.id}: ${verified ? "VERIFIED" : "hölls tillbaka"} · rapport → ${publicUrl}`,
    );
}
console.log("\n[preview] klar");
