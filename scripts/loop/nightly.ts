#!/usr/bin/env bun
// Nattloopen — "loopen utan mig" (lanserings-block 2).
//
// Körs schemalagt i GitHub Actions (nightly-loop.yml). För varje kundsajt med
// adaptations_enabled: läs rollup-löven → frys sidorna (curl-vägen; SPA-sidor
// hamnar ärligt i needs_freeze-kön) → detektera förtjänta celler → designa
// (Anthropic-adaptern) → verifiera genom HELA grindkedjan (auto-generate
// --mode=verify, riktig Chromium) → skriv in verifierade varianter direkt via
// service-klienten → svep notiserna (dag-10-mejlet).
//
// INGET serveras av den här loopen: verified → serving är alltid ägarens
// knapp. Loopen producerar bara förslag som väntar på godkännande.
//
// Fail-open till ingenting: saknade env-nycklar ⇒ loggad no-op, aldrig krasch.
//
//   bun run scripts/loop/nightly.ts [--site=<slug>] [--cap=3]

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { anthropicDesigner } from "./designer";
import { generateRedesign } from "../../src/adaptive/redesign/generate";
import { buildRedesignContext, segmentInsightFrom } from "../../src/adaptive/redesign/context";
import { extractContentModel } from "../../src/adaptive/redesign/extract";
import type { SegmentSummary } from "../../src/lib/dashboard/aggregate";
import { mirrorStorageKey } from "../../src/lib/sandbox/mirror-key";
import { RETURNING_TOKEN, segmentDims } from "../../src/lib/segment-key";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const CAP = Number(arg("cap") ?? 3); // max nya varianter per sajt och natt

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log("[loop] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas — no-op (lägg secrets i Actions).");
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("[loop] ANTHROPIC_API_KEY saknas — detektering körs men inga designs kan skapas; no-op.");
  process.exit(0);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY);
const outRoot = arg("out") ?? "nightly-out";
mkdirSync(outRoot, { recursive: true });

// ── sajturval: kundsajter som uttryckligen slagit på generativa lagret ───────
const onlySite = arg("site");
const { data: sites, error: sitesErr } = await db
  .from("angel_sites")
  .select("slug,domain,conversion_text,conversion_kind,conversion_selector,adaptations_enabled")
  .eq("adaptations_enabled", true)
  .not("slug", "like", "sandbox--%");
if (sitesErr) {
  console.error(`[loop] kunde inte läsa sajter: ${sitesErr.message}`);
  process.exit(1);
}
const targets = (sites ?? []).filter(
  (s) => s.slug !== "synthetic-lab" && (!onlySite || s.slug === onlySite),
);
console.log(`[loop] ${targets.length} sajt(er) med adaptations_enabled`);

const spawnBun = (args: string[]) => {
  const r = Bun.spawnSync(["bun", "run", ...args], { stdout: "inherit", stderr: "inherit" });
  return r.exitCode === 0;
};

for (const site of targets) {
  const dir = join(outRoot, site.slug);
  mkdirSync(dir, { recursive: true });
  console.log(`\n[loop] ── ${site.slug} ──`);
  try {
    // 1. Underlag: rollup-löv + befintliga (icke-pensionerade) variantnycklar.
    const { data: leaves } = await db.rpc("angel_page_segment_rollup", { p_site: site.slug });
    if (!Array.isArray(leaves) || leaves.length === 0) {
      console.log(`[loop] ${site.slug}: inga rollup-löv — hoppar över`);
      continue;
    }
    const { data: variants } = await db
      .from("angel_variants")
      .select("path,segment_key,status")
      .eq("site", site.slug)
      .neq("status", "retired");
    writeFileSync(join(dir, "leaves.json"), JSON.stringify(leaves));
    writeFileSync(
      join(dir, "variants.json"),
      JSON.stringify((variants ?? []).map((v) => ({ path: v.path, segmentKey: v.segment_key }))),
    );
    writeFileSync(
      join(dir, "site.json"),
      JSON.stringify({
        conversion_text: site.conversion_text,
        conversion_kind: site.conversion_kind,
        conversion_selector: site.conversion_selector,
      }),
    );

    // 2. Frys lövens sidor (curl-vägen). SPA/frysfel ⇒ sidan utelämnas ur
    //    kartan och detect köar cellen ärligt som needs_freeze.
    // Query/hash strippas defensivt även här (rollupen normaliserar numera,
    // men ett ?fbclid-filnamn fällde artefakt-uppladdningen i generalrepet
    // 2026-07-17 — filnamn får bara innehålla säkra tecken).
    // Heatmapens sidor fryses OCKSÅ: dashboardens backdrop hämtar frysta
    // kopior, och de mest positions-klickade sidorna kan ligga utanför
    // rollup-toppen (ägarfynd 2026-07-17: heatmapens sida saknade kopia och
    // föll på den blanka live-spegeln).
    const { data: clickRows } = await db
      .from("angel_events")
      .select("payload")
      .eq("site", site.slug)
      .eq("type", "element_click")
      .order("created_at", { ascending: false })
      .limit(500);
    const clickCounts = new Map<string, number>();
    for (const r of (clickRows ?? []) as { payload: { x?: unknown; path?: unknown } }[]) {
      if (typeof r.payload?.x !== "number") continue;
      const raw = typeof r.payload.path === "string" ? r.payload.path : "/";
      const p = raw.split("#")[0].split("?")[0] || "/";
      clickCounts.set(p, (clickCounts.get(p) ?? 0) + 1);
    }
    const clickPaths = [...clickCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([p]) => p);
    // Löv-toppen kapas FÖRST (10) och unionen därefter (15) — klick-sidorna
    // (max 5) får aldrig trängas ut av en lång rollup-topp.
    const leafPaths = [
      ...new Set(
        (leaves as { path?: string }[]).map(
          (l) => (l.path || "/").split("#")[0].split("?")[0] || "/",
        ),
      ),
    ].slice(0, 10);
    const paths = [...new Set([...leafPaths, ...clickPaths])].slice(0, 15);
    const pages: Record<string, string> = {};
    if (site.domain) {
      for (const p of paths) {
        const safe = p.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
        const file = join(
          dir,
          `frozen${safe === "-" || !safe ? "-home" : `-${safe.replace(/^-|-$/g, "")}`}.html`,
        );
        if (
          existsSync(file) ||
          spawnBun(["scripts/redesign/freeze-page.ts", `--url=https://${site.domain}${p}`, `--out=${file}`])
        ) {
          // Snabb SPA-koll: en fryst kopia utan rubriker kan inte designas mot.
          try {
            const model = extractContentModel(readFileSync(file, "utf8"));
            if (model.sections.length >= 2) {
              pages[p] = file;
              // Dela kopian med dashboarden: heatmap-backdroppen serverar den
              // via mirror-endpointens frozen-läge — live-spegeln kan inte
              // rendera en SPA, men den frysta kopian ÄR den renderade sidan.
              // Bäst-effort: ett uppladdningsfel fäller aldrig loopen.
              const mirrorKey = mirrorStorageKey(site.slug, p);
              const { error: mirrorErr } = await db.storage
                .from("angel-evidence")
                .upload(mirrorKey, readFileSync(file), {
                  contentType: "text/html; charset=utf-8",
                  upsert: true,
                });
              if (mirrorErr) {
                console.warn(
                  `[loop] ${site.slug}${p}: backdrop-uppladdning föll: ${mirrorErr.message}`,
                );
              }
            } else {
              console.log(
                `[loop] ${site.slug}${p}: för få sektioner i fryst kopia (SPA?) — needs_freeze`,
              );
            }
          } catch {
            /* trasig frysning → utelämna */
          }
        }
      }
    }
    writeFileSync(join(dir, "pages.json"), JSON.stringify(pages));

    // 3. Detektera förtjänta celler + bygg briefs (auto-generate --mode=detect).
    const base = site.domain ? `https://${site.domain}` : "https://example.invalid";
    if (
      !spawnBun([
        "scripts/redesign/auto-generate.ts",
        "--mode=detect",
        `--leaves=${join(dir, "leaves.json")}`,
        `--variants=${join(dir, "variants.json")}`,
        `--pages=${join(dir, "pages.json")}`,
        `--site=${site.slug}`,
        `--base-url=${base}`,
        `--site-config=${join(dir, "site.json")}`,
        `--out=${dir}`,
        `--cap=${CAP}`,
      ])
    ) {
      console.warn(`[loop] ${site.slug}: detect föll — hoppar över`);
      continue;
    }
    const earned = JSON.parse(readFileSync(join(dir, "earned.json"), "utf8")) as {
      briefed: { path: string; key: string; total: { visits: number; conversions: number }; observations: string[]; brief: string }[];
      needsFreeze: unknown[];
    };
    if (earned.needsFreeze.length) {
      console.log(`[loop] ${site.slug}: ${earned.needsFreeze.length} cell(er) väntar på browser-frysning (needs_freeze)`);
    }
    if (earned.briefed.length === 0) continue;

    // 4. Designa: EN modellkörning per brief via produktions-designern.
    //    generateRedesign validerar (verb, mål-finns, claims-vakten) — ops som
    //    faller åker ut här och cellen får försöka igen en annan natt.
    const plans: unknown[] = [];
    for (const b of earned.briefed) {
      const page = pages[b.path];
      if (!page) continue;
      const content = extractContentModel(readFileSync(page, "utf8"));
      const dims = segmentDims(b.key);
      const summary: SegmentSummary = {
        key: b.key,
        label: dims.join(" · "),
        depth: dims.length,
        channel: dims[0] ?? null,
        device: dims[1] ?? null,
        country: dims[2] ?? null,
        returning: dims.length >= 4 ? dims[3] === RETURNING_TOKEN : null,
        visits: b.total.visits,
        conversions: b.total.conversions,
        conversionRate: b.total.visits > 0 ? b.total.conversions / b.total.visits : 0,
        formStarts: 0,
        formAbandons: 0,
        adequate: true,
        recent: null,
      };
      const ctx = buildRedesignContext({
        site: site.slug,
        goal: {
          text: site.conversion_text ?? null,
          kind: site.conversion_kind ?? null,
          selector: site.conversion_selector ?? null,
        },
        page: { url: `${base}${b.path}`, frozenHtmlPath: page, screenshotPath: "", viewport: { width: 390, height: 844 } },
        content,
        segment: segmentInsightFrom(summary, { observations: b.observations }),
      });
      const plan = await generateRedesign(ctx, anthropicDesigner);
      if (plan.ops.length === 0) {
        console.log(`[loop] ${site.slug} ${b.path}×${b.key}: designern gav ingen giltig plan (${plan.note ?? "tomt"})`);
        continue;
      }
      plans.push({ path: b.path, key: b.key, total: b.total, observations: b.observations, ops: plan.ops });
    }
    if (plans.length === 0) continue;
    writeFileSync(join(dir, "plans.json"), JSON.stringify(plans));

    // 5. Verifiera genom hela grindkedjan (riktig Chromium) → results.json.
    if (
      !spawnBun([
        "scripts/redesign/auto-generate.ts",
        "--mode=verify",
        `--plans=${join(dir, "plans.json")}`,
        `--pages=${join(dir, "pages.json")}`,
        `--site=${site.slug}`,
        `--base-url=${base}`,
        `--site-config=${join(dir, "site.json")}`,
        `--out=${dir}`,
      ])
    ) {
      console.warn(`[loop] ${site.slug}: verify föll`);
      continue;
    }
    const results = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as {
      verdict: string;
      path: string;
      key: string;
      ops?: unknown;
      serveOps?: unknown;
      evidence?: { comparison?: { screenshots?: { before: string | null; after: string | null } } };
      slug?: string;
    }[];

    // 6. Verifierade → ladda upp skärmdumpar till storage + direkta inserts.
    //    Status 'verified' — ALDRIG serving; det är ägarens knapp.
    for (const r of results.filter((x) => x.verdict === "verified")) {
      const shots: { before: string | null; after: string | null; attempt1: null } = {
        before: null,
        after: null,
        attempt1: null,
      };
      if (r.slug) {
        for (const which of ["before", "after"] as const) {
          const local = join(dir, `${r.slug}-${which}.jpg`);
          if (!existsSync(local)) continue;
          const key = `${site.slug}/${r.slug}/${which}.jpg`;
          const { error: upErr } = await db.storage
            .from("angel-evidence")
            .upload(key, readFileSync(local), { contentType: "image/jpeg", upsert: true });
          if (!upErr) shots[which] = db.storage.from("angel-evidence").getPublicUrl(key).data.publicUrl;
        }
      }
      const evidence = {
        ...(r.evidence ?? {}),
        comparison: { ...(r.evidence?.comparison ?? {}), screenshots: shots },
      };
      const { error: insErr } = await db.from("angel_variants").insert({
        site: site.slug,
        path: r.path,
        segment_key: r.key,
        status: "verified",
        ops: r.ops ?? [],
        serve_ops: r.serveOps ?? [],
        evidence,
      });
      if (insErr) console.warn(`[loop] ${site.slug}: insert föll: ${insErr.message}`);
      else console.log(`[loop] ${site.slug} ${r.path}×${r.key}: VERIFIED — väntar på ägarens knapp`);
    }

    // 7. Dag-10-mejlet: svep varianter som väntar utan skickad notis.
    const { sweepVariantNotifications } = await import("../../src/adaptive/notify.server");
    await sweepVariantNotifications(site.slug);
  } catch (err) {
    console.error(`[loop] ${site.slug} föll:`, err);
  }
}
console.log("\n[loop] klar");
