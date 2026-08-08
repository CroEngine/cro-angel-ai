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
import { spawnSync } from "node:child_process";

import { anthropicDesigner } from "./designer";
import { buildCandidatePlan } from "./candidate-plan";
import { fetchSectionBehavior } from "./section-behavior";
import { generateRedesign, type RedesignOp } from "../../src/adaptive/redesign/generate";
import { buildRedesignContext, segmentInsightFrom } from "../../src/adaptive/redesign/context";
import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { segmentDims } from "../../src/lib/segment-key";
import { PREVIEW_STALE_HOURS } from "../../src/lib/preview/preview";
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

// PREVIEW_STALE_HOURS importeras från src/lib/preview (granskningsfynd
// 2026-07-28): två oberoende definitioner av samma kontrakt kunde glida isär
// — API:t hade då lovat en annan livstid än arbetaren höll.

// node:child_process i stället för Bun.spawnSync: den senare saknar timeout,
// och en hängd frysning/verify åt annars hela jobbets 15 min och lämnade
// raden permanent i running (granskningsfynd 2026-07-28, driftbugg #2).
const spawnBun = (args: string[], timeoutMs = 300_000): boolean =>
  spawnSync("bun", ["run", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
    timeout: timeoutMs,
  }).status === 0;

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
<a class="cta" target="_blank" rel="noreferrer" href="https://croengine.netlify.app/signup">Install Angel — one line of code</a>
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
// Fastnade running-rader (granskningsfynd 2026-07-28): en runner som dödas
// av jobbets timeout lämnade raden permanent i running — och POST-dedupen
// återanvände det döda jobbet för samma URL i 24 h (garanterat spinnerhaveri
// i trattens topp). 30 min mot updated_at räcker gott: arbetaren själv har
// hårdare tak per steg numera.
const runningStale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
await db
  .from("angel_preview_jobs")
  .update({ status: "failed", error: "worker_died", updated_at: new Date().toISOString() })
  .eq("status", "running")
  .lt("updated_at", runningStale);

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

// Felvägarna skriver samma diagnostik-nyckel som ok-vägen (granskningsfynd
// 2026-07-28: tre olika orsaker kollapsade till "could_not_analyze" och DB
// bar noll spårbarhet — artefakten raderades efter 7 dagar). stage berättar
// VAR kedjan föll; detail är kort och aldrig känslig.
const fail = async (id: string, error: string, stage?: string, detail?: string) => {
  await db
    .from("angel_preview_jobs")
    .update({
      status: "failed",
      error,
      findings: {
        fynd: [],
        flyttStatus: null,
        diagnostics: {
          verdict: "failed",
          stage: stage ?? error,
          ...(detail ? { detail: detail.slice(0, 200) } : {}),
          at: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    })
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
    await fail(job.id, "could_not_analyze", "freeze_failed");
    continue;
  }
  const content = extractContentModel(readFileSync(frozen, "utf8"));
  if (content.sections.length < 1) {
    console.warn(`[preview] ${job.id}: för tunn sida (${content.sections.length} sektioner)`);
    await fail(job.id, "could_not_analyze", "thin_page");
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
  // KATALOGEN FÖRST (kandidatkatalogen 2026-07-27, ägarbeslut "få ihop LLM
  // och kod"): koden genererar de lagliga dragen, DOM-proben filtrerar, LLM
  // väljer ur menyn (kan inte avvisas), golvet väljer när LLM:en tystnar.
  // Den fritt-skapande designern är RESERVEN för sidor utan katalogkandidater
  // — tratten svarar aldrig mer "kunde inte analysera" på en sida med bevis.
  let planOps: RedesignOp[];
  let altOps: RedesignOp[][] = [];
  let planSource: string;
  // Steg 10: beteende-röret är inkopplat — för prospekt finns ingen snippet-
  // data (fetchen ger null ⇒ byte-identisk katalog), men vägen är DENSAMMA
  // som installerade sajter får vid konvergensen (steg 11).
  const behavior = await fetchSectionBehavior(
    db,
    site,
    new URL(job.url).pathname || "/",
    content.sections,
  );
  const candPlan = await buildCandidatePlan({
    content,
    frozenPath: frozen,
    workDir: dir,
    segmentLabel: dims.join(" · "),
    observations,
    behavior: behavior ?? undefined,
  });
  if (candPlan) {
    planOps = candPlan.ops;
    altOps = candPlan.altOps;
    planSource = `katalog/${candPlan.source}`;
    console.log(
      `  katalogen: ${candPlan.menuSize} kandidater i menyn · val via ${candPlan.source} · ${altOps.length} reserver`,
    );
  } else {
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
      await fail(job.id, "could_not_analyze", "designer_empty", plan.note ?? undefined);
      continue;
    }
    planOps = plan.ops;
    planSource = "designer";
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
        ops: planOps,
        altOps,
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
  // SAMMA verdiktregel som nattloopen (results.filter verdict === "verified"):
  // verify-report.json innehåller ÄVEN gate_fail-poster — utan filtret sålde
  // rapporten en tillbakahållen ändring som "Verified" (pilotfynd 2026-07-27,
  // talentium: movedAboveMain + LCP-skift 671px stoppades av grinden, men
  // skalet läste aldrig domslutet).
  type ServeOpView = {
    op?: string;
    locator?: { text?: string };
    value?: string;
    why?: string;
  };
  type VerifyEntry = {
    verdict?: string;
    reason?: string;
    fallback?: string;
    serveOps?: ServeOpView[];
    attempts?: { gate?: { verdict?: string; reasons?: string[] } }[];
  };
  let verified: VerifyEntry | null = null;
  // Readern (ägarbeslut 2026-07-27): FÖRSTA resultatposten oavsett verdict —
  // diagnostiken ska berätta vad som hände även när jobbet hölls tillbaka.
  let verifyFirst: VerifyEntry | null = null;
  try {
    const results = JSON.parse(
      readFileSync(join(dir, "verify-report.json"), "utf8"),
    ) as VerifyEntry[];
    verifyFirst = results[0] ?? null;
    const passed = results.filter((r) => r.verdict === "verified");
    verified = verifyOk && passed.length > 0 ? passed[0] : null;
  } catch {
    verified = null;
  }
  const slug = `home--${key.replace(/·/g, "-")}`;
  const before = dataUri(join(dir, `${slug}-before.jpg`));
  const after = verified ? dataUri(join(dir, `${slug}-after.jpg`)) : null;
  const OP_LABEL: Record<string, string> = {
    move_up: "Lifted higher on the page",
    set_text: "Sharpened the wording",
    // Beviset kan komma från en annan sida ELLER samma sida (fallback-steget
    // 2026-07-27) — etiketten säger vad som händer, inte varifrån.
    insert_snippet: "Lifted your proof under the headline",
  };
  // Visningsraderna: VERIFIED ⇒ serve-ops (för inserts visas den insatta
  // TEXTEN — det är den ägaren känner igen; annars rubriken opsen låstes
  // mot). Gate-fail-fallback ⇒ designer-ops (targetId → rubrik ur
  // innehållsmodellen). RedesignOp bär inga locators — det gör bara ServeOp.
  const displayOps = verified?.serveOps?.length
    ? verified.serveOps.map((o) => ({
        op: o.op ?? "",
        text: (o.op === "insert_snippet" ? o.value : o.locator?.text) ?? o.locator?.text ?? "",
        why: o.why ?? "",
      }))
    : planOps.map((o) => ({
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
  // Lagringen tar typen korrekt — men Supabases PUBLIKA yta skriver om just
  // HTML till text/plain + nosniff vid servering (nätfiskeskydd på deras
  // domän; diag-matris 2026-07-27, scripts/diag/storage-content-type.ts).
  // Därför serveras rapporten via VÅR origin: /api/preview/report?id=…
  // sätter rätt headers själv. Publika URL:en i DB-raden är bara var
  // bytesen bor.
  const { error: upErr } = await db.storage
    .from("angel-evidence")
    .upload(storKey, readFileSync(reportPath), {
      contentType: "text/html; charset=utf-8",
      upsert: true,
    });
  if (upErr) {
    console.warn(`[preview] ${job.id}: uppladdning föll: ${upErr.message} — failed`);
    await fail(job.id, "upload_failed", "report_upload", upErr.message);
    continue;
  }

  // Readern (ägarbeslut 2026-07-27): hela verify-domslutet arkiveras per
  // jobb — "vad hände med alla som klistrade in" ska gå att läsa i efterhand
  // utan att köra om något. Best effort: rapporten står på egna ben.
  const vrPath = join(dir, "verify-report.json");
  if (existsSync(vrPath)) {
    const { error: vrErr } = await db.storage
      .from("angel-evidence")
      .upload(`preview/${job.id}/verify-report.json`, readFileSync(vrPath), {
        contentType: "application/json",
        upsert: true,
      });
    if (vrErr) console.warn(`[preview] ${job.id}: verify-report-arkivet föll: ${vrErr.message}`);
  }

  // Original/Variant-växlaren i /try: hela före/efter-sidorna laddas upp
  // ENDAST när grindarna släppt igenom förslaget — hållna jobb behåller den
  // ärliga rapportvyn (frånvaron av objekten ÄR grinden; /try:s probe får
  // 404). Serveras via /api/preview/page (egen origin — Supabase
  // neutraliserar HTML på publika ytan). Enhancement, inte krav: faller en
  // uppladdning loggas den och rapporten står kvar.
  if (verified) {
    const afterPage = join(dir, `${slug}-after.html`);
    const pages: [string, string][] = [
      ["page-before.html", frozen],
      ["page-after.html", afterPage],
    ];
    for (const [name, path] of pages) {
      if (!existsSync(path)) {
        console.warn(`[preview] ${job.id}: ${name} saknar källa (${path}) — växlaren utgår`);
        break;
      }
      const { error: pgErr } = await db.storage
        .from("angel-evidence")
        .upload(`preview/${job.id}/${name}`, readFileSync(path), {
          contentType: "text/html; charset=utf-8",
          upsert: true,
        });
      if (pgErr) {
        console.warn(`[preview] ${job.id}: ${name} föll: ${pgErr.message} — växlaren utgår`);
        break;
      }
    }
  }
  const publicUrl = db.storage.from("angel-evidence").getPublicUrl(storKey).data.publicUrl;

  // /try-sidans fynd-rad — skrivs i granska-formen som GET-vägens mapFindings
  // normaliserar ({fynd: [{rubrik, vikt}], flyttStatus}); min första form
  // mappades till tomhet. Hölls tillbaka ⇒ inga fynd-rader och ingen
  // lyft-text — rapporten berättar ärligheten.
  // Readern: kompakt diagnostik in i jobbraden (extra nyckel i findings-
  // jsonb:n — mapFindings visar den aldrig för besökaren, men API:t och
  // fleet-analysen kan läsa vad som faktiskt hände: verdict, orsak,
  // fallback-väg, grind-orsaker).
  const lastAttempt = verifyFirst?.attempts?.[(verifyFirst.attempts?.length ?? 1) - 1];
  const diagnostics = {
    verdict: verifyFirst?.verdict ?? (verifyOk ? "no_result" : "verify_failed"),
    fallback: verifyFirst?.fallback ?? null,
    reason: verifyFirst?.reason ?? null,
    gateReasons: (lastAttempt?.gate?.reasons ?? []).slice(0, 3),
    attempts: verifyFirst?.attempts?.length ?? 0,
    sections: content.sections.length,
    planOps: planOps.map((o) => o.op),
    planSource,
    at: new Date().toISOString(),
  };
  const findings = {
    ...(verified
      ? {
          fynd: changes.map((c, i) => ({ rubrik: c.label, vikt: i })),
          flyttStatus:
            "Verified on your page — no layout shift, LCP untouched, fully reversible",
        }
      : { fynd: [], flyttStatus: null }),
    diagnostics,
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
