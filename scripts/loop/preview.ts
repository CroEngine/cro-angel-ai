#!/usr/bin/env bun
// Prospekt-förhandsvisningens arbetare (trattens topp, ägarmodellen
// 2026-07-23) — samma isolerade mönster som day0-svepet: dränera kön i
// angel_preview_jobs, kör granska-site.ts i prospect-läge på prospektets URL,
// ladda upp den självbärande rapporten till angel-evidence under jobbets
// o-gissningsbara uuid, stämpla raden ok/failed. /try-sidan pollar raden.
//
// Ärlighetskontraktet gäller hela vägen: rapporten visar bara mätta fynd och
// före/efter BARA när grindarna gav rent pass — prospektets första möte med
// produkten ska vara samma ärlighet som produkten säljer.
//
// Fail-open till ingenting: saknade env-nycklar ⇒ loggad no-op, aldrig krasch.
//
//   bun run scripts/loop/preview.ts [--cap=3]

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { mapFindings, PREVIEW_STALE_HOURS } from "../../src/lib/preview/preview";

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

// ── förlegade jobb: äldre än PREVIEW_STALE_HOURS utan körning ⇒ failed ───────
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

for (const job of jobs) {
  const dir = join(outRoot, job.id);
  console.log(`\n[preview] ── ${job.id} (${job.url}) ──`);
  await db
    .from("angel_preview_jobs")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", job.id);

  const r = Bun.spawnSync(
    [
      "bun",
      "run",
      "scripts/audit/granska-site.ts",
      `--url=${job.url}`,
      `--out=${dir}`,
      // Onboarding-läget ÄR prospektläget: engelsk copy, inga priser, ingen
      // pilot-pitch — bara mätta fynd + före/efter när grindarna passerat.
      "--mode=onboarding",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );

  const reportPath = join(dir, "rapport.html");
  if (r.exitCode !== 0 || !existsSync(reportPath)) {
    console.warn(`[preview] ${job.id}: granskningen föll (exit ${r.exitCode}) — failed`);
    await db
      .from("angel_preview_jobs")
      .update({
        status: "failed",
        error: "could_not_analyze",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    continue;
  }

  const key = `preview/${job.id}/report.html`;
  const { error: upErr } = await db.storage
    .from("angel-evidence")
    .upload(key, readFileSync(reportPath), { contentType: "text/html", upsert: true });
  if (upErr) {
    console.warn(`[preview] ${job.id}: uppladdning föll: ${upErr.message} — failed`);
    await db
      .from("angel_preview_jobs")
      .update({ status: "failed", error: "upload_failed", updated_at: new Date().toISOString() })
      .eq("id", job.id);
    continue;
  }
  const publicUrl = db.storage.from("angel-evidence").getPublicUrl(key).data.publicUrl;

  let findings: unknown = null;
  try {
    findings = mapFindings(JSON.parse(readFileSync(join(dir, "fynd.json"), "utf8")));
  } catch {
    /* fynd.json saknas → /try visar bara rapporten */
  }

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
  else console.log(`[preview] ${job.id}: rapport klar → ${publicUrl}`);
}
console.log("\n[preview] klar");
