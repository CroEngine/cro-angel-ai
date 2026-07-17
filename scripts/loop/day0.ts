#!/usr/bin/env bun
// Day-0-granskningen (task #98) — dag-0-värdet i onboardingen.
//
// Varje ny kundsajt med domän får sin granskningsrapport automatiskt samma
// dag: granska-site.ts i onboarding-läge (engelsk copy, ingen pilot-pitch)
// → rapporten till angel-evidence-bucketen → sajtraden stämplas
// (day0_report_url/at/status + day0_findings). Dashboarden visar kortet
// tills första varianten finns. Ersätter pilot-outreach-flödet som
// dag-0-värde för annonskunder.
//
// Kön är implicit: domän satt + day0_report_at IS NULL. Stämpeln sätts vid
// FÖRSÖK (även misslyckade, status='failed') så en oåtkomlig sajt inte får
// runnern att banka på den varje körning; --site=<slug> kör om en specifik
// sajt oavsett stämpel (manuell retry via workflow_dispatch).
//
// Fail-open till ingenting: saknade env-nycklar ⇒ loggad no-op, aldrig krasch.
//
//   bun run scripts/loop/day0.ts [--site=<slug>] [--cap=5]

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const CAP = Number(arg("cap") ?? 5); // max granskningar per körning
const onlySite = arg("site");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log(
    "[day0] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas — no-op (lägg secrets i Actions).",
  );
  process.exit(0);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY);
const outRoot = arg("out") ?? "day0-out";

// ── kön: kundsajter med domän som saknar dag-0-stämpel ───────────────────────
let query = db
  .from("angel_sites")
  .select("slug,domain,name,conversion_text")
  .not("domain", "is", null)
  .not("slug", "like", "sandbox--%")
  .neq("slug", "synthetic-lab");
if (onlySite) query = query.eq("slug", onlySite);
else query = query.is("day0_report_at", null);
const { data: sites, error: sitesErr } = await query.limit(CAP);
if (sitesErr) {
  console.error(`[day0] kunde inte läsa kön: ${sitesErr.message}`);
  process.exit(1);
}
if (!sites?.length) {
  console.log("[day0] kön är tom — inget att granska");
  process.exit(0);
}
console.log(`[day0] ${sites.length} sajt(er) i kön`);

for (const site of sites) {
  const dir = join(outRoot, site.slug);
  const url = `https://${site.domain}`;
  console.log(`\n[day0] ── ${site.slug} (${url}) ──`);

  // Stämpla försöket FÖRST — även en krasch mitt i får inte lämna sajten i
  // kön för evig ombankning. --site-körningar skriver om stämpeln medvetet.
  const attemptedAt = new Date().toISOString();
  await db
    .from("angel_sites")
    .update({ day0_report_at: attemptedAt, day0_report_status: "running" })
    .eq("slug", site.slug);

  const r = Bun.spawnSync(
    [
      "bun",
      "run",
      "scripts/audit/granska-site.ts",
      `--url=${url}`,
      `--namn=${site.name ?? site.domain}`,
      `--out=${dir}`,
      "--mode=onboarding",
      // Ägarens konfigurerade mål (onboardingens målbekräftelse) — utan det
      // gissar granskningen från sidans länkar och kan träffa logga-länken.
      ...(site.conversion_text ? [`--goal=${site.conversion_text}`] : []),
    ],
    { stdout: "inherit", stderr: "inherit" },
  );

  const reportPath = join(dir, "rapport.html");
  if (r.exitCode !== 0 || !existsSync(reportPath)) {
    console.warn(`[day0] ${site.slug}: granskningen föll (exit ${r.exitCode}) — status=failed`);
    await db.from("angel_sites").update({ day0_report_status: "failed" }).eq("slug", site.slug);
    continue;
  }

  // Rapporten är självbärande HTML (skärmdumpar inline) — en fil per sajt.
  const key = `day0/${site.slug}/report.html`;
  const { error: upErr } = await db.storage
    .from("angel-evidence")
    .upload(key, readFileSync(reportPath), { contentType: "text/html", upsert: true });
  if (upErr) {
    console.warn(`[day0] ${site.slug}: uppladdning föll: ${upErr.message} — status=failed`);
    await db.from("angel_sites").update({ day0_report_status: "failed" }).eq("slug", site.slug);
    continue;
  }
  const publicUrl = db.storage.from("angel-evidence").getPublicUrl(key).data.publicUrl;

  // Kompakt fynd-sammanfattning för dashboard-kortet (rubrikerna räcker).
  let findings: unknown = null;
  try {
    const fynd = JSON.parse(readFileSync(join(dir, "fynd.json"), "utf8")) as {
      fynd?: { rubrik: string; vikt: number }[];
      flyttStatus?: string | null;
    };
    findings = {
      headlines: (fynd.fynd ?? [])
        .sort((a, b) => a.vikt - b.vikt)
        .slice(0, 3)
        .map((f) => f.rubrik),
      liftTest: fynd.flyttStatus ?? null,
    };
  } catch {
    /* fynd.json saknas → kortet visar bara länken */
  }

  const { error: updErr } = await db
    .from("angel_sites")
    .update({
      day0_report_url: publicUrl,
      day0_report_status: "ok",
      day0_findings: findings,
    })
    .eq("slug", site.slug);
  if (updErr) console.warn(`[day0] ${site.slug}: stämpling föll: ${updErr.message}`);
  else console.log(`[day0] ${site.slug}: rapport klar → ${publicUrl}`);
}
console.log("\n[day0] klar");
