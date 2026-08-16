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
import { generateRedesign, type RedesignOp } from "../../src/adaptive/redesign/generate";
import { buildCandidatePlan } from "./candidate-plan";
import { catalogEligible, cellWorkDir, freezePriority, planRow } from "./cell-plan";
import { fetchSectionBehavior } from "./section-behavior";
import {
  REUSE_FALSIFIED_AT,
  blockTransferRecords,
  decorateMoveSeedsWithTransfer,
  decorateSeedsWithTransfer,
  filterViableSeeds,
  flattenHtml,
  harvestMoveSeeds,
  harvestReuseSeeds,
  moveSectionType,
  moveTransferRecords,
  offerMoveSeedsForCell,
  offerSeedsForCell,
  partitionFalsified,
  partitionFalsifiedMoves,
  type BlockTransferRecord,
  type MoveSeed,
  type ReuseSeed,
  type ReuseVariantRow,
} from "../../src/adaptive/redesign/reuse";
import { generateCandidates } from "../../src/adaptive/redesign/candidates";
import {
  buildRedesignContext,
  DEFAULT_REDESIGN_GUARDRAILS,
  segmentInsightFrom,
} from "../../src/adaptive/redesign/context";
import { extractContentModel, extractQuotables } from "../../src/adaptive/redesign/extract";
import { filterToTemplateSections } from "../../src/adaptive/redesign/template-content";
import {
  DRIFT_HOLD_PREFIX,
  dependenciesOf,
  planDependencySweep,
} from "../../src/adaptive/redesign/drift";
import {
  metricArmsFromRpc,
  planGuardrailSweep,
  type GuardrailSweepVariant,
} from "../../src/adaptive/redesign/guardrail-sweep";
import {
  cohortBriefLines,
  planCohortScopes,
  segmentKeyForScope,
} from "../../src/adaptive/redesign/cohort-scopes";
import { defaultSuccessSpec, validateSuccessSpec } from "../../src/adaptive-lab/metrics";
import { segmentSummaryFor } from "../../src/lib/dashboard/segment-summary";
import { mirrorStorageKey } from "../../src/lib/sandbox/mirror-key";
import { isSegmentPrefix, segmentDims } from "../../src/lib/segment-key";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const CAP = Number(arg("cap") ?? 3); // max nya varianter per sajt och natt

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log(
    "[loop] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas — no-op (lägg secrets i Actions).",
  );
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.log(
    "[loop] ANTHROPIC_API_KEY saknas — detektering körs men inga designs kan skapas; no-op.",
  );
  process.exit(0);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY);
const outRoot = arg("out") ?? "nightly-out";
mkdirSync(outRoot, { recursive: true });

// ── sajturval: kundsajter som uttryckligen slagit på generativa lagret ───────
// adaptations_enabled betyder sedan 2026-07-20 ENBART detta (nattloopens
// opt-in). Legacy-livevägen i decide-routen — som samma flagga tidigare också
// väckte — är pensionerad: inget synligt kan hända live utan en ägargodkänd
// variant bakom serving_enabled.
const onlySite = arg("site");
const { data: sites, error: sitesErr } = await db
  .from("angel_sites")
  .select(
    "slug,domain,conversion_text,conversion_kind,conversion_selector,adaptations_enabled,test_metric",
  )
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
    // id/held/evidence/ops behövs för drift-svepet (slice 3) — variants.json
    // till detect behåller sin gamla smala form (path + segmentKey).
    const { data: variants } = await db
      .from("angel_variants")
      .select("id,path,segment_key,status,held_reason,ops,evidence,success,required_cohorts")
      .eq("site", site.slug)
      .neq("status", "retired")
      // Deterministisk ordning (granskningsfynd 2026-08-11): utan ORDER BY
      // var återbrukets text-dedup ("äldsta vinnaren äger blocket"),
      // per-cell-taket och rins-id:na körningsberoende. created_at + id
      // (uuid-tiebreak vid transaktionslika tider) ger en total ordning.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    // Transfer-lärandet (steg 3): misslyckandena bor i PENSIONERADE
    // återbruksrader, som huvudläsningen ovan exkluderar — hämtas separat
    // (bara rader födda som återbruk: evidence.reuse satt). Bäst-effort:
    // faller läsningen körs natten utan meriter, aldrig utan frön.
    const { data: retiredReuse, error: retiredReuseErr } = await db
      .from("angel_variants")
      .select("id,path,status,held_reason,ops,evidence")
      .eq("site", site.slug)
      .eq("status", "retired")
      .not("evidence->reuse", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    // Sidflödet (korssid-lyftets signal, task #117): "andel av segmentet som
    // landar på P och senare når Q". Tomt är ett ÄRLIGT utfall (ensidiga
    // sessioner) — detect-steget kräver volym innan observationen skrivs.
    const { data: flows } = await db.rpc("angel_page_flow_rollup", { p_site: site.slug });
    writeFileSync(join(dir, "flows.json"), JSON.stringify(flows ?? []));
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
    // Personbläddrarens sidor fryses OCKSÅ (ägarfynd 2026-07-19: en SPA-sida
    // utan fryst kopia blir en blank live-spegel i steg-för-steg-spelaren).
    // Mest BESÖKTA sidor (pageviews) — en resa går ofta genom sidor som ingen
    // positions-klickar på, så klick-toppen räcker inte.
    const { data: pvRows } = await db
      .from("angel_events")
      .select("payload")
      .eq("site", site.slug)
      .eq("type", "pageview")
      .order("created_at", { ascending: false })
      .limit(500);
    const pvCounts = new Map<string, number>();
    for (const r of (pvRows ?? []) as { payload: { path?: unknown } }[]) {
      const raw = typeof r.payload?.path === "string" ? r.payload.path : "/";
      const p = raw.split("#")[0].split("?")[0] || "/";
      pvCounts.set(p, (pvCounts.get(p) ?? 0) + 1);
    }
    const journeyPaths = [...pvCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([p]) => p);
    // Löv-toppen: TRAFIK-rankad med mall-topp-upp (freezePriority — se
    // granskningsfyndet där: den gamla kapningen tog de 10 FÖRSTA i databasens
    // ordning, så "/restauranger/…" föll för "/blogg/…" alfabetiskt varje natt
    // och mallcellen med sajtens näst största trafik stod i needs_freeze i
    // veckor). (Heatmap-vyn är pensionerad 2026-07-26 — klick-topparna fryses
    // inte längre; resespelarens och flödesmålens sidor räcker som backdrops.)
    const leafPaths = freezePriority(leaves as { path?: string; visits?: number }[]);
    // Flödesdestinationerna fryses också (korssid-lyftet): en insert_snippet-op
    // kan bara citera en FRYST källsida — utan kopian tappas signalen tyst.
    const destCounts = new Map<string, number>();
    for (const f of (flows ?? []) as { dest_path?: string; reached?: number }[]) {
      if (typeof f.dest_path !== "string" || typeof f.reached !== "number") continue;
      destCounts.set(f.dest_path, (destCounts.get(f.dest_path) ?? 0) + f.reached);
    }
    const flowDests = [...destCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([p]) => p);
    // Beroende-sidorna fryses ALLTID (utanför 15-taket): drift-svepet agerar
    // bara på en lyckad omfrysning, och en variants landningssida behövs för
    // omverifieringen. Mängden är liten (max en källa + en landning per
    // beroende-variant), så taket behåller sin mening för rullnings-toppen.
    const depVariants = (variants ?? []).filter((v) => dependenciesOf(v.evidence).length > 0);
    // Blockbiblioteket steg 2: vinnarnas bevisade block skördas HÄR (samma
    // radläsning som drift-svepet) — deras källsidor måste också frysas, för
    // ett frö vars whitelist inte kan byggas om är inget erbjudande.
    //
    // VOKABULÄRSGRINDEN (granskningsfynd 2026-08-15): ett textfrö är ett
    // insert_snippet. Med move-only vokabulär kan det aldrig bli en kandidat,
    // och skörden hade då kostat en riktig webbläsarfrysning per frö och
    // källsida varje natt — utanför 20-sidorstaket — för ingenting. Värre:
    // erbjudandena hade fortsatt räknas mot mättnadstaken (natt-erbjudande-
    // raderna nedanför), så block som ALDRIG stod i en meny hade blockerat
    // sig själva från framtida erbjudanden. Flytt-fröna är oberörda; de bär
    // ingen text och behöver ingen källsida.
    const textReuseEnabled = DEFAULT_REDESIGN_GUARDRAILS.ops.includes("insert_snippet");
    const reuseSeeds = textReuseEnabled ? harvestReuseSeeds(variants ?? []) : [];
    if (!textReuseEnabled) {
      const dormant = harvestReuseSeeds(variants ?? []).length;
      if (dormant > 0)
        console.log(
          `[loop] ${site.slug}: ${dormant} textåterbruksfrö vilar — vokabulären är move-only (ägarbeslut 2026-08-15), inget insert_snippet kan genereras`,
        );
    }
    // Transferformen steg 4: flytt-vinnarnas typklasser. Till skillnad från
    // textfröna behöver de INGEN källsida fryst — fröet bär bara typklassen,
    // och målsidans egen katalog är hela viabilitetskollen.
    const moveSeeds = harvestMoveSeeds(variants ?? []);
    const depPaths = [
      ...new Set([
        ...depVariants.flatMap((v) => [v.path, ...dependenciesOf(v.evidence).map((d) => d.path)]),
        ...reuseSeeds.map((s) => s.sourcePath),
      ]),
    ];
    // Taket höjt 15 → 20 när resesidorna kom in (spelarens backdrops) —
    // resesidorna står SIST i prioritetsordningen och tar bara platser som
    // löv/klick/flödes-topparna lämnar. Beroende-sidorna ligger kvar utanför
    // taket som förut.
    const paths = [
      ...new Set([
        ...[...new Set([...leafPaths, ...flowDests, ...journeyPaths])].slice(0, 20),
        ...depPaths,
      ]),
    ];
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
          spawnBun([
            "scripts/redesign/freeze-page.ts",
            `--url=https://${site.domain}${p}`,
            `--out=${file}`,
          ])
        ) {
          // Snabb SPA-koll: en fryst kopia utan rubriker kan inte designas mot.
          try {
            const model = extractContentModel(readFileSync(file, "utf8"));
            if (model.sections.length >= 2) {
              pages[p] = file;
              // Dela kopian med spegel-endpointens frozen-läge: live-spegeln
              // kan inte rendera en SPA, men den frysta kopian ÄR den
              // renderade sidan. (Heat-vyn som läste den är pensionerad
              // 2026-07-26; kopiorna behålls för resespelarens parkerade
              // sidbilds-spår, ägarbeslut 2026-07-20.) Bäst-effort: ett
              // uppladdningsfel fäller aldrig loopen.
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

    // Blockbiblioteket steg 2 — VIABILITETSKOLLEN (ren funktion i reuse.ts,
    // testbar): ett frö erbjuds bara om vinnartexten fortfarande finns i
    // källsidans NYFRYSTA quotables-whitelist (samma dom som driftsvepet,
    // samma likhet som validateOps). Sållning är synlig i loggen, aldrig tyst.
    const quotablesCache = new Map<string, string[] | null>();
    const quotablesFor = (sourcePath: string): string[] | null => {
      if (!quotablesCache.has(sourcePath)) {
        const srcFile = pages[sourcePath];
        quotablesCache.set(
          sourcePath,
          srcFile
            ? extractQuotables(readFileSync(srcFile, "utf8")).snippets.map((s) => s.text)
            : null,
        );
      }
      return quotablesCache.get(sourcePath)!;
    };
    const { viable: viableReuseSeeds, dropped: droppedSeeds } = filterViableSeeds(
      reuseSeeds,
      quotablesFor,
    );
    for (const d of droppedSeeds) {
      console.log(
        d.reason === "unfrozen"
          ? `[loop] ${site.slug}: återbruksfrö från ${d.seed.provedOnPath} sållas — källsidan ${d.seed.sourcePath} kunde inte frysas`
          : `[loop] ${site.slug}: återbruksfrö från ${d.seed.provedOnPath} sållas — texten finns inte längre i ${d.seed.sourcePath}:s whitelist (driftsvepet tar vinnaren)`,
      );
    }
    if (viableReuseSeeds.length > 0) {
      console.log(
        `[loop] ${site.slug}: ${viableReuseSeeds.length} bevisat block redo för återbruk (av ${reuseSeeds.length} skördade)`,
      );
    }
    // Nattens maskinella holds (granskningsfynd 2026-08-11): skörden läste
    // start-snapshotens held_reason, men guardrail-/driftsvepen nedanför kan
    // hålla en vinnare I NATT — och ett hållet bevis är inget bevis. Varje
    // hold registreras här och sållas vid erbjudandet. Deklarerad FÖRE
    // svepets try (scoping-läxan 2026-07-26 — läses efter catch:en).
    const heldTonight = new Set<string>();

    // 2b. Självläkningen (korssid-lyftet slice 3, ägarbeslut 2026-07-18):
    //     varianter vars insatta citat pekar på en källsida kontrolleras mot
    //     nattens NYFRYSTA kopia. Källtext kvar → inget händer (eller vårt
    //     eget drift-hold släpps). Priset ändrat → nya texten genom EXAKT
    //     samma grindkedja som första gången; passerar den uppdateras
    //     varianten och håll-flaggan släpps — kunden gör ingenting. Går det
    //     inte att verifiera i natt → maskinellt hold + ägarnotis. Ägarens
    //     STATUS rörs aldrig (policyn 2026-07-12) — bara held_reason/held_at.
    // Deklarerad FÖRE svepets try (scoping-fyndet 2026-07-26, första riktiga
    // mall-körningen): `let` inne i try-blocket + användning EFTER catch:en är
    // en körtids-ReferenceError som tsc aldrig ser (scripts/ ligger utanför
    // include) — den åt upp glutenforums två första mall-celler före design.
    let cohortScopes: ReturnType<typeof planCohortScopes> = [];
    try {
      const sweepable = depVariants.filter(
        (v) => v.status === "verified" || v.status === "serving" || v.status === "winner",
      );
      const sweepInput = sweepable.map((v) => ({
        id: v.id,
        heldReason: v.held_reason ?? null,
        dependencies: dependenciesOf(v.evidence),
      }));
      const freshSnippets: Record<string, string[] | null> = {};
      for (const sv of sweepInput) {
        for (const d of sv.dependencies) {
          if (freshSnippets[d.path] !== undefined) continue;
          // SAMMA läsning som detect/verify (extractQuotables): priser när de
          // finns, annars offert-svaret — svepet vaktar det som citerades.
          freshSnippets[d.path] = pages[d.path]
            ? extractQuotables(readFileSync(pages[d.path], "utf8")).snippets.map((s) => s.text)
            : null;
        }
      }
      const holdVariant = async (id: string, label: string, reason: string) => {
        // Återbruket sållar nattens holds vid erbjudandet — registrera FÖRE
        // db-skrivningen så sållningen håller även om uppdateringen faller
        // (konservativ riktning: hellre ett tappat erbjudande än ett hållet
        // "bevis" i menyn).
        heldTonight.add(id);
        const heldAt = new Date().toISOString();
        await db
          .from("angel_variants")
          .update({ held_reason: reason, held_at: heldAt })
          .eq("id", id);
        const { notifyVariantHeld } = await import("../../src/adaptive/notify.server");
        await notifyVariantHeld(site.slug, id, label, reason, heldAt);
        console.log(`[loop] ${site.slug} ${label}: HÅLLS maskinellt — ${reason}`);
      };
      // ── Kohort-scopes: var är nästa kohortscopade variant designvärdig? ──
      // Ren planerare på exponeringarnas dims (30 d): bara scopes som kan nå
      // ett domslut inom 45 dagar föreslås. Förslag, inte generering — de
      // skrivs till körkatalogen och loggen; den generativa våningen läser dem.
      try {
        const { data: cohortRows } = await db.rpc("angel_cohort_traffic", {
          p_site: site.slug,
          p_days: 30,
        });
        cohortScopes = planCohortScopes(Array.isArray(cohortRows) ? cohortRows : [], {
          windowDays: 30,
          // Basraten per mått: conversion ~4 %, continuation ~40 %, bounce
          // 57 % (uppmätt på glutenforum 2026-08-15). Fel basrat gör bara
          // dagar-till-domslut-SKATTNINGEN skev — men en bounce-sajt med
          // conversionens 0,04 hade fått varje kohortscope avfärdat som
          // "domslut om ~450 dagar" och förslagslistan hade gått tom.
          baseRate:
            site.test_metric === "continuation" ? 0.4 : site.test_metric === "bounce" ? 0.57 : 0.04,
        });
        writeFileSync(
          join(dir, "cohort-opportunities.json"),
          JSON.stringify(cohortScopes, null, 1),
        );
        for (const sc of cohortScopes) {
          console.log(
            `[loop] ${site.slug} kohort-scope: ${sc.cohorts.join("+")} — ${sc.visitorsInWindow} besökare/30d, domslut ~${sc.estimatedDaysToVerdict} d`,
          );
        }
      } catch (err) {
        console.warn(`[loop] ${site.slug} kohorttrafik otillgänglig:`, err);
      }

      // ── Guardrail-svepet (kontraktsskydden, ren planerare) ─────────────
      // Live-armarna döms mot variantens framgångskontrakt varje natt:
      // signifikant skyddsskada eller primärförlust ⇒ maskinellt hold via
      // samma held_reason-mekanism som drift-svepet (ägarstatus orörd,
      // självläkning släpper). Falska stopp ~1 %/variant — billiga åt rätt håll.
      {
        const guardable = ((variants ?? []) as typeof variants & object[]).filter(
          (v: { status: string }) => v.status === "serving" || v.status === "winner",
        ) as {
          id: string;
          path: string;
          segment_key: string;
          held_reason: string | null;
          success: unknown;
        }[];
        const guardInput: GuardrailSweepVariant[] = [];
        for (const v of guardable) {
          const { data: armRows } = await db.rpc("angel_variant_arms", {
            p_site: site.slug,
            p_variant: v.id,
          });
          guardInput.push({
            id: v.id,
            heldReason: v.held_reason ?? null,
            success: v.success,
            // Kartan bär varje mått för sig; sajtens primärval avgörs av
            // variantens success-kontrakt, inte av hur armarna byggs.
            arms: Array.isArray(armRows) ? metricArmsFromRpc(armRows) : null,
          });
        }
        for (const action of planGuardrailSweep(guardInput)) {
          if (action.action === "keep") continue;
          const row = guardable.find((v) => v.id === action.id)!;
          const label = `${row.path} · ${row.segment_key}`;
          if (action.action === "hold") {
            await holdVariant(action.id, label, action.reason);
            continue;
          }
          await db
            .from("angel_variants")
            .update({ held_reason: null, held_at: null })
            .eq("id", action.id);
          console.log(`[loop] ${site.slug} ${label}: skydden gröna igen — guardrail-hold släppt`);
        }
      }

      for (const action of planDependencySweep(sweepInput, freshSnippets)) {
        const row = sweepable.find((v) => v.id === action.id)!;
        const label = `${row.path} · ${row.segment_key}`;
        if (action.action === "keep") continue;
        if (action.action === "release") {
          await db
            .from("angel_variants")
            .update({ held_reason: null, held_at: null })
            .eq("id", action.id);
          console.log(`[loop] ${site.slug} ${label}: källan läkt — drift-hold släppt`);
          continue;
        }
        if (action.action === "hold") {
          await holdVariant(action.id, label, action.reason);
          continue;
        }
        // refresh — kräver att LANDNINGSSIDAN också frystes i natt; annars kan
        // grindarna inte köras och hellre paus än overifierad text.
        if (!pages[row.path]) {
          await holdVariant(
            action.id,
            label,
            `${DRIFT_HOLD_PREFIX}priset ändrades på ${action.path} men landningssidan kunde inte frysas om i natt`,
          );
          continue;
        }
        const oldOps = (Array.isArray(row.ops) ? row.ops : []) as {
          op: string;
          detail?: string;
          sourcePath?: string;
          [k: string]: unknown;
        }[];
        const refreshedOps = oldOps.map((o) =>
          o.op === "insert_snippet" && o.sourcePath === action.path
            ? { ...o, detail: action.newText }
            : o,
        );
        const ev = (row.evidence ?? {}) as {
          brief?: { total?: { visits: number; conversions: number }; observations?: string[] };
          planSource?: unknown;
        };
        const refreshDir = join(dir, `refresh-${action.id}`);
        mkdirSync(refreshDir, { recursive: true });
        writeFileSync(
          join(refreshDir, "plans.json"),
          JSON.stringify([
            {
              path: row.path,
              key: row.segment_key,
              total: ev.brief?.total ?? { visits: 0, conversions: 0 },
              observations: ev.brief?.observations ?? [],
              sourcePaths: [action.path],
              ops: refreshedOps,
              // Vokabulären varianten FÖDDES med (granskningsfynd
              // 2026-08-15). Refreshen byter EN textrad i en redan verifierad
              // plan — den ska granskas mot samma ops som en gång godkändes,
              // inte mot dagens generationsvokabulär. Utan detta avvisar
              // validateOps varje insert_snippet efter ägarbeslutet "endast
              // flytta sektioner", och grenen nedanför håller varianten med
              // skälet "föll i grindkedjan" trots att grindkedjan aldrig kördes.
              existingOps: [...new Set(oldOps.map((o) => o.op))],
            },
          ]),
        );
        const ok = spawnBun([
          "scripts/redesign/auto-generate.ts",
          "--mode=verify",
          `--plans=${join(refreshDir, "plans.json")}`,
          `--pages=${join(dir, "pages.json")}`,
          `--site=${site.slug}`,
          `--base-url=${site.domain ? `https://${site.domain}` : "https://example.invalid"}`,
          `--site-config=${join(dir, "site.json")}`,
          `--out=${refreshDir}`,
        ]);
        const refreshed = ok
          ? (
              JSON.parse(readFileSync(join(refreshDir, "verify-report.json"), "utf8")) as {
                verdict: string;
                ops?: unknown;
                serveOps?: unknown;
                evidence?: Record<string, unknown>;
                slug?: string;
              }[]
            )[0]
          : null;
        if (!refreshed || refreshed.verdict !== "verified") {
          await holdVariant(
            action.id,
            label,
            `${DRIFT_HOLD_PREFIX}nya priset ("${action.newText.slice(0, 60)}") på ${action.path} föll i grindkedjan i natt`,
          );
          continue;
        }
        // Nya texten grindad OK → uppdatera varianten och släpp hållningen.
        // Skärmdumparna laddas upp på SAMMA nycklar som originalet (slug är
        // härledd ur path+key) så dashboardens bevisbilder visar nya läget.
        const shots: {
          before: string | null;
          after: string | null;
          attempt1: null;
          desktopBefore?: string;
          desktopAfter?: string;
        } = { before: null, after: null, attempt1: null };
        if (refreshed.slug) {
          const shotKeyOf = {
            before: "before",
            after: "after",
            "desktop-before": "desktopBefore",
            "desktop-after": "desktopAfter",
          } as const;
          for (const which of ["before", "after", "desktop-before", "desktop-after"] as const) {
            const local = join(refreshDir, `${refreshed.slug}-${which}.jpg`);
            if (!existsSync(local)) continue;
            const key = `${site.slug}/${refreshed.slug}/${which}.jpg`;
            const { error: upErr } = await db.storage
              .from("angel-evidence")
              .upload(key, readFileSync(local), { contentType: "image/jpeg", upsert: true });
            if (!upErr) {
              const url = db.storage.from("angel-evidence").getPublicUrl(key).data.publicUrl;
              shots[shotKeyOf[which]] = url;
            }
          }
        }
        const newEvidence = {
          ...(refreshed.evidence ?? {}),
          comparison: {
            ...((refreshed.evidence as { comparison?: object } | undefined)?.comparison ?? {}),
            screenshots: shots,
          },
          // Provenance överlever prisuppdateringen (granskningsfynd
          // 2026-08-08): refresh-planen bär inget planSource och verify-
          // rapportens evidence saknar det — utan sammanslagningen hade
          // varje refresh tyst nollställt variantens härkomst. Källan är
          // OFÖRÄNDRAD av en textuppdatering, så gamla värdet är sanningen.
          planSource: typeof ev.planSource === "string" ? ev.planSource : "designer",
          // Blockbiblioteket steg 2 (granskningsfynd 2026-08-11): en drift-
          // uppdaterad vinnare bär text som ALDRIG körde sitt A/B — vinsten
          // tillhör den gamla lydelsen. Markören stoppar återbruksskörden
          // från att sätta [proven:]-etiketten på den nya texten.
          refreshedAt: new Date().toISOString(),
        };
        const { error: updErr } = await db
          .from("angel_variants")
          .update({
            ops: refreshed.ops ?? [],
            serve_ops: refreshed.serveOps ?? [],
            evidence: newEvidence,
            held_reason: null,
            held_at: null,
          })
          .eq("id", action.id);
        if (updErr)
          console.warn(`[loop] ${site.slug} ${label}: refresh-uppdatering föll: ${updErr.message}`);
        else
          console.log(
            `[loop] ${site.slug} ${label}: källpriset ändrat → ny text grindad OK → varianten uppdaterad + släppt`,
          );
      }
    } catch (err) {
      console.warn(`[loop] ${site.slug}: drift-svepet föll (fail-open):`, err);
    }

    // 3. Detektera förtjänta celler + bygg briefs (auto-generate --mode=detect).
    const base = site.domain ? `https://${site.domain}` : "https://example.invalid";
    if (
      !spawnBun([
        "scripts/redesign/auto-generate.ts",
        "--mode=detect",
        `--leaves=${join(dir, "leaves.json")}`,
        `--variants=${join(dir, "variants.json")}`,
        `--flows=${join(dir, "flows.json")}`,
        `--pages=${join(dir, "pages.json")}`,
        `--site=${site.slug}`,
        `--base-url=${base}`,
        `--site-config=${join(dir, "site.json")}`,
        `--out=${dir}`,
        `--cap=${CAP}`,
        // Proxymåtten (continuation/bounce) passerar orörda — bara okända
        // värden faller till conversion (samma vitlista som auto-generate).
        `--metric=${site.test_metric === "continuation" || site.test_metric === "bounce" ? site.test_metric : "conversion"}`,
      ])
    ) {
      console.warn(`[loop] ${site.slug}: detect föll — hoppar över`);
      continue;
    }
    const earned = JSON.parse(readFileSync(join(dir, "earned.json"), "utf8")) as {
      briefed: {
        path: string;
        key: string;
        total: { visits: number; conversions: number };
        observations: string[];
        sourcePaths?: string[];
        brief: string;
        cohorts?: string[];
        /** Mall-celler (mall-nivå 2026-07-26): path är ett mönster ("/blogg/*"),
         *  exemplaren konkreta sidor, repPath den briefen byggdes ur och
         *  sharedHeadings mall-snittet (designytan). */
        templatePages?: string[];
        repPath?: string;
        sharedHeadings?: string[];
      }[];
      needsFreeze: unknown[];
    };
    if (earned.needsFreeze.length) {
      console.log(
        `[loop] ${site.slug}: ${earned.needsFreeze.length} cell(er) väntar på browser-frysning (needs_freeze)`,
      );
    }
    // Kohortceller (generativa våningen): för det snabbaste serverbara
    // src:-scopet designas en EGEN variant av startsidan — kohortens intent i
    // briefen, samma grindkedja som allt annat, född grindad + kontrakterad
    // vid insert. Max EN per natt och sajt; hoppa om ett kohortscopat A/B för
    // nyckeln redan finns eller startsidan saknar fryst kopia.
    {
      const existingCohortKeys = new Set(
        ((variants ?? []) as { segment_key: string; required_cohorts: unknown }[])
          .filter((v) => Array.isArray(v.required_cohorts) && v.required_cohorts.length > 0)
          .map((v) => v.segment_key),
      );
      // Ett PÅGÅENDE test vars nyckel TÄCKER kohortnyckeln spärrar också
      // (granskningsfynd 2026-08-16, jokerns följdrisk): en servande/briefad
      // "alla"-variant på "/" äger hela trafiken — att rista ur en kohortcell
      // mitt i hade tagit dess besökare ur bägge armarna (matchVariant väljer
      // specifikast) och förgiftat sajtvitt-testets mätning. Prefixkollen är
      // samma delade primitiv som serve/detektor (isSegmentPrefix), så domen
      // kan inte glida: det som skulle serva över kohorten spärrar den.
      const coveringKeys = [
        ...((variants ?? []) as { path: string; segment_key: string }[])
          .filter((v) => v.path === "/")
          .map((v) => v.segment_key),
        ...earned.briefed.filter((b) => b.path === "/").map((b) => b.key),
      ];
      const candidate = cohortScopes.find((sc) => {
        const key = segmentKeyForScope(sc);
        return (
          key !== null &&
          !existingCohortKeys.has(key) &&
          !earned.briefed.some((b) => b.key === key) &&
          !coveringKeys.some((k) => isSegmentPrefix(k, key)) &&
          !!pages["/"]
        );
      });
      if (candidate) {
        const key = segmentKeyForScope(candidate)!;
        earned.briefed.push({
          path: "/",
          key,
          total: { visits: candidate.visitorsInWindow, conversions: 0 },
          observations: cohortBriefLines(candidate),
          sourcePaths: [],
          brief: "",
          cohorts: candidate.cohorts,
        });
        console.log(
          `[loop] ${site.slug} kohortcell: designar /×${key} för ${candidate.cohorts.join("+")}`,
        );
      }
    }
    if (earned.briefed.length === 0) continue;

    // 4. Designa: EN modellkörning per brief via produktions-designern.
    //    generateRedesign validerar (verb, mål-finns, claims-vakten) — ops som
    //    faller åker ut här och cellen får försöka igen en annan natt.
    const plans: unknown[] = [];
    // Blockbiblioteket steg 2 — nattens egna erbjudanden räknas (gransknings-
    // fynd 2026-08-11): mättnadstaket och redan-här-vakten dömde annars mot
    // start-snapshoten, så EN natt kunde erbjuda samma block till fler celler
    // än taket tillåter. Varje cell vars plan bär erbjudanden lägger
    // syntetiska rader i offerRows, som nästa cell dömer mot. Att räkna
    // ERBJUDANDEN (inte adopterade varianter) är den konservativa riktningen.
    const offerRows: ReuseVariantRow[] = [...(variants ?? [])];
    // Nattens holds sållas EN gång, synligt — inte per cell (logg-brus).
    const unheldSeeds = viableReuseSeeds.filter((s) => {
      if (!heldTonight.has(s.variantId)) return true;
      console.log(
        `[loop] ${site.slug}: återbruksfrö från ${s.provedOnPath} sållas — vinnaren hölls i nattens svep (ett hållet bevis är inget bevis)`,
      );
      return false;
    });
    // Transfer-lärandet (steg 3): meriterna byggs ur levande rader + de
    // pensionerade återbruksraderna; falsifierade block (fallna på
    // REUSE_FALSIFIED_AT distinkta sidor) lämnar biblioteket — synligt.
    // Resten dekoreras med meritlistan och rankas: bevisade resenärer först.
    // TVÅ vakter (granskningsfynd 2026-08-11): (a) faller misslyckande-
    // läsningen körs natten UTAN erbjudanden — meriter utan demeriter vore
    // fel åt det anti-konservativa hållet (falsifierade block hade smugit
    // tillbaka); (b) vinnare som hölls I NATT räknas inte som vinster i
    // meritlistan — samma dom som frö-sållningen ("ett hållet bevis är
    // inget bevis"), annars hade menyraden skrutit om en vinst svepet
    // just höll för uppmätt skada.
    let offerableSeeds: ReuseSeed[] = [];
    let cellRecords: Map<string, BlockTransferRecord> | undefined;
    // Transferformen steg 4: flytt-frönas motsvarigheter — samma två vakter
    // (hållna vinnare räknas inte, misslyckande-läsningen måste ha gått).
    let offerableMoveSeeds: MoveSeed[] = [];
    let cellMoveRecords: Map<string, BlockTransferRecord> | undefined;
    const unheldMoveSeeds = moveSeeds.filter((s) => {
      if (!heldTonight.has(s.variantId)) return true;
      console.log(
        `[loop] ${site.slug}: flytt-frö (${s.sectionType}) från ${s.provedOnPath} sållas — vinnaren hölls i nattens svep (ett hållet bevis är inget bevis)`,
      );
      return false;
    });
    if (retiredReuseErr) {
      if (unheldSeeds.length > 0 || unheldMoveSeeds.length > 0) {
        console.warn(
          `[loop] ${site.slug}: misslyckande-läsningen föll (${retiredReuseErr.message}) — inga återbrukserbjudanden i natt (meriter utan demeriter vore skevt)`,
        );
      }
    } else {
      const liveRows = (variants ?? []).filter((v) => !heldTonight.has(v.id));
      const retiredRows = (retiredReuse ?? []) as ReuseVariantRow[];
      const transferRecords = blockTransferRecords([...liveRows, ...retiredRows]);
      const { kept: unfalsifiedSeeds, falsified } = partitionFalsified(
        unheldSeeds,
        transferRecords,
      );
      for (const s of falsified) {
        console.log(
          `[loop] ${site.slug}: återbruksfrö från ${s.provedOnPath} FALSIFIERAT — pensionerat på ${REUSE_FALSIFIED_AT}+ sidor, blocket lämnar biblioteket`,
        );
      }
      offerableSeeds = decorateSeedsWithTransfer(unfalsifiedSeeds, transferRecords);
      cellRecords = transferRecords;

      const moveRecords = moveTransferRecords([...liveRows, ...retiredRows]);
      const { kept: unfalsifiedMoves, falsified: falsifiedMoves } = partitionFalsifiedMoves(
        unheldMoveSeeds,
        moveRecords,
      );
      for (const s of falsifiedMoves) {
        console.log(
          `[loop] ${site.slug}: flytt-frö (${s.sectionType}) från ${s.provedOnPath} FALSIFIERAT — pensionerat på ${REUSE_FALSIFIED_AT}+ sidor, typklassen lämnar biblioteket`,
        );
      }
      offerableMoveSeeds = decorateMoveSeedsWithTransfer(unfalsifiedMoves, moveRecords);
      cellMoveRecords = moveRecords;
    }
    for (const b of earned.briefed) {
      // Mall-celler: designen byggs ur representant-exemplaret, FILTRERAT till
      // mall-snittet — designern kan bara måla mot sektioner som finns på alla
      // exemplar, och verify räknar om snittet ur samma frysta filer.
      const isTpl = Array.isArray(b.templatePages) && b.templatePages.length >= 2;
      const pagePath = isTpl ? (b.repPath ?? b.templatePages![0]) : b.path;
      const page = pages[pagePath];
      if (!page) continue;
      let content = extractContentModel(readFileSync(page, "utf8"));
      if (isTpl) content = filterToTemplateSections(content, b.sharedHeadings ?? []);
      if (isTpl && content.sections.length === 0) {
        console.log(`[loop] ${site.slug} ${b.path}×${b.key}: tomt mall-snitt — hoppar`);
        continue;
      }
      // dims används även nedanför (segmentLabel till katalogen) — behåll den.
      const dims = segmentDims(b.key);
      const summary = segmentSummaryFor(b.key, b.total);
      // Källsidorna (korssid-lyftet): samma frysta kopior och SAMMA läsning som
      // detect, verify och drift-svepet — extractQuotables, inte den snävare
      // extractPriceSnippets (granskningsfynd 2026-08-08). Skillnaden är inte
      // kosmetisk: en offertsida utan priser ger [] ur prisläsaren men en
      // citerbar huvudutsaga ur quotables. Med den gamla läsningen såg cellen
      // källlös ut här — designern fick inget att citera, och efter steg 11
      // föll dessutom korssid-carve-outen så katalogen tog cellen som om
      // signalen aldrig funnits. `kind` följer med så prompten renderar
      // offert-formen (context.ts branchar på den).
      const sourcePages: {
        path: string;
        snippets: { text: string; tag: string }[];
        kind?: "price" | "answer";
      }[] = [];
      for (const sp of b.sourcePaths ?? []) {
        const srcFile = pages[sp];
        if (!srcFile) continue;
        const q = extractQuotables(readFileSync(srcFile, "utf8"));
        if (q.snippets.length > 0)
          sourcePages.push({ path: sp, snippets: q.snippets, kind: q.kind });
      }
      // KATALOGEN FÖRST (steg 11-konvergensen — planens sista steg): samma
      // superset som preview/fleet kör sedan kandidatkatalogen 2026-07-27 —
      // koden genererar de lagliga dragen, DOM-proben filtrerar, LLM väljer ur
      // menyn (kan inte avvisas), golvet väljer när den tystnar; fri-designern
      // är RESERVEN för celler utan katalogkandidater. Beteende-sätet matas av
      // steg 10-röret: events → rollup → BehaviorInput, null hela vägen vid
      // tunn/oren data ⇒ typ-priorn ensam, byte-identisk katalog (kedjetest-
      // låst kontrakt). Live-grinden är OFÖRÄNDRAD och täcker källorna lika:
      // verify → ägarens knapp → ramp → guardrail-svepets hold på uppmätt
      // förlust/breach — icke-underlägsenheten döms av riktiga armar, aldrig
      // bara offline-tal. Mall-carve-outen lyft 2026-08-16 — katalogen äger
      // även mall-celler (probe mot representanten); alt-stegen vid GRINDFALL
      // är fortsatt avstängd för mallar (v1-rest).
      let planOps: RedesignOp[] | null = null;
      let planAltOps: RedesignOp[][] = [];
      let planSource = "designer";
      // Blockbiblioteket steg 2: cellens erbjudna återbruksfrön — fylls bara
      // på katalogvägen (designer-/mall-celler får inga i v1), men läses vid
      // planRow-bygget nedanför, så deklarationen bor här (scoping-läxan
      // 2026-07-26: let-i-try + användning efter är en körtidsbomb tsc
      // aldrig ser i scripts/).
      let cellReuse: ReuseSeed[] = [];
      // Transferformen steg 4: samma sak för flytt-fröna (typklasserna).
      let cellMoveReuse: MoveSeed[] = [];
      // KORSSID-CELLERNA STANNAR HOS DESIGNERN (granskningsfynd 2026-08-08):
      // en cell som FÖRTJÄNATS på pris-flödessignalen (detect ger den
      // sourcePaths, och nattloopen fryser flödesmålen just för den) kan bara
      // betjänas av designern — katalogen genererar enbart drag på den egna
      // sidan och kan aldrig producera ett insert_snippet som CITERAR en annan
      // sida. Utan undantaget hade konvergensen tyst tagit bort korssid-lyftet
      // (och därmed drift-självläkningen, som lever på evidence.dependencies)
      // för exakt de celler som förtjänats på den signalen.
      // VARJE väg till designern SÄGS ut (granskningsfynd 2026-08-08): förut
      // loggade bara katalog-vägen, så en natt där alla celler var mall-celler
      // såg identisk ut med "katalogen körde och valde ingenting". Operatören
      // ska kunna läsa VARFÖR ur loggen, inte gissa ur frånvaron av rader.
      const eligibility = catalogEligible({
        crossPageSources: sourcePages.length,
        // Ägarbeslut 2026-08-15: med move-only vokabulär finns inget korssid-
        // citat att skydda, så carve-outen faller och katalogen tar cellen.
        mayInsert: DEFAULT_REDESIGN_GUARDRAILS.ops.includes("insert_snippet"),
      });
      // Mall-carve-outen lyft 2026-08-16 (se catalogEligible): katalogen äger
      // nu även mall-celler — content är mall-snittet, proben går mot
      // representantens frysta fil, precis som designervägens verify.
      if (isTpl && eligibility.eligible) {
        console.log(
          `[loop] ${site.slug} ${b.path}×${b.key}: mall-cell (${b.templatePages?.length ?? 0} exemplar) — katalogen tar den, probe mot representanten`,
        );
      }
      if (eligibility.skip === "cross-page") {
        console.log(
          `[loop] ${site.slug} ${b.path}×${b.key}: korssid-cell (${sourcePages.map((s) => s.path).join(", ")}) — designern äger den, katalogen hoppas över`,
        );
      }
      if (eligibility.eligible) {
        // Katalogens arbetsfiler är per CELL — kollisionsfri katalog (se
        // cellWorkDir: teckenvitlistan ensam kunde vika två olika (path, key)-
        // par till samma namn och cellerna skrev över varandras probe-filer).
        const cellDir = cellWorkDir(dir, b.path, b.key);
        mkdirSync(cellDir, { recursive: true });
        const behavior = await fetchSectionBehavior(db, site.slug, pagePath, content.sections);
        // Blockbiblioteket steg 2: cellens återbrukserbjudanden — frö-vakterna
        // (egen sida, dubbelvisning, redan-här, mättnadstak) döms i
        // offerSeedsForCell mot den frysta målsidan + sajtens variantrader.
        cellReuse = offerSeedsForCell({
          seeds: offerableSeeds,
          cellPath: b.path,
          landingFlatHtml: flattenHtml(readFileSync(page, "utf8")),
          rows: offerRows,
          records: cellRecords,
        });
        if (cellReuse.length > 0) {
          console.log(
            `[loop] ${site.slug} ${b.path}×${b.key}: ${cellReuse.length} bevisat block i menyn (från ${cellReuse.map((s) => s.provedOnPath).join(", ")})`,
          );
        }
        // Transferformen steg 4: viabiliteten ÄR målsidans egen katalog —
        // typerna hämtas ur generateCandidates på samma innehållsmodell
        // buildCandidatePlan kör (utan säte: beteendet ändrar poäng, aldrig
        // VILKA move-kandidater som finns), så viabilitetsregeln aldrig kan
        // drifta från kandidatgenereringen.
        cellMoveReuse = offerMoveSeedsForCell({
          seeds: offerableMoveSeeds,
          cellPath: b.path,
          catalogMoveTypes: new Set(
            generateCandidates(content)
              .filter((c) => c.kind === "move_up")
              .map((c) => moveSectionType(c.targetId))
              .filter((t): t is string => t !== null),
          ),
          rows: offerRows,
          records: cellMoveRecords,
        });
        if (cellMoveReuse.length > 0) {
          console.log(
            `[loop] ${site.slug} ${b.path}×${b.key}: ${cellMoveReuse.length} bevisad flytt-typklass i menyn (${cellMoveReuse.map((s) => `${s.sectionType} från ${s.provedOnPath}`).join(", ")})`,
          );
        }
        const candPlan = await buildCandidatePlan({
          content,
          frozenPath: page,
          workDir: cellDir,
          segmentLabel: dims.join(" · "),
          observations: b.observations,
          behavior: behavior ?? undefined,
          reuse: cellReuse.length > 0 ? cellReuse : undefined,
          moveReuse: cellMoveReuse.length > 0 ? cellMoveReuse : undefined,
          // Ägarens mål ur angel_sites — probens grind vaktar samma element
          // som verify (måltext + mål-selector), aldrig en delmängd.
          goal: {
            text: site.conversion_text ?? null,
            selector: site.conversion_selector ?? null,
          },
        });
        if (candPlan) {
          planOps = candPlan.ops;
          planAltOps = candPlan.altOps;
          planSource = `katalog/${candPlan.source}`;
          console.log(
            `[loop] ${site.slug} ${b.path}×${b.key}: katalogen — ${candPlan.menuSize} i menyn · val via ${candPlan.source}${behavior ? " · beteende-säte matat" : " · utan beteendedata (priorn)"}`,
          );
        } else {
          console.log(
            `[loop] ${site.slug} ${b.path}×${b.key}: katalogen gav ingen kandidat (tom meny eller fallen probe) — fria designern tar över`,
          );
        }
      }
      if (!planOps) {
        const ctx = buildRedesignContext({
          site: site.slug,
          goal: {
            text: site.conversion_text ?? null,
            kind: site.conversion_kind ?? null,
            selector: site.conversion_selector ?? null,
          },
          page: {
            url: `${base}${pagePath}`,
            frozenHtmlPath: page,
            screenshotPath: "",
            viewport: { width: 390, height: 844 },
          },
          content,
          segment: segmentInsightFrom(summary, { observations: b.observations }),
          sourcePages,
        });
        const plan = await generateRedesign(ctx, anthropicDesigner);
        if (plan.ops.length === 0) {
          console.log(
            `[loop] ${site.slug} ${b.path}×${b.key}: designern gav ingen giltig plan (${plan.note ?? "tomt"})`,
          );
          continue;
        }
        planOps = plan.ops;
      }
      // Raden byggs av den RENA producenten (cell-plan.ts) — samma funktion
      // som gränssnitts-testet matar verify med, så plans.json-formen inte kan
      // glida isär från PlanIn utan att ett test faller.
      // Blockbiblioteket steg 2: planRow äger gate-beslutet (källsidornas
      // union in i sourcePaths + reuseOffers bara på katalog-planer) —
      // uttrycket här styr enbart nattens offerRows-ackumulator.
      const catalogRanWithReuse = planSource.startsWith("katalog") && cellReuse.length > 0;
      // Nattens erbjudanden in i vakternas underlag (se offerRows ovan):
      // syntetiska icke-pensionerade rader med exakt den form seedSaturated/
      // alreadyHere räknar på (path + insert-detail).
      if (catalogRanWithReuse) {
        for (const s of cellReuse) {
          offerRows.push({
            id: `natt-erbjudande-${s.variantId}-${b.path}-${b.key}`,
            path: b.path,
            status: "verified",
            ops: [{ op: "insert_snippet", detail: s.text, sourcePath: s.sourcePath }],
          });
        }
      }
      // Transferformen steg 4: samma ackumulator för flytt-erbjudandena, med
      // den form moveSeedSaturated/alreadyHere räknar på (path + move-op).
      // targetId måste bära sec-N-typ-formen — moveSectionType parsar den.
      // evidence.reuse.kind = "move" krävs av mättnadsräkningen (den räknar
      // bibliotekets spridning, inte organiska flyttar) — utan markören hade
      // nattens egna erbjudanden inte räknats mot taket.
      if (planSource.startsWith("katalog") && cellMoveReuse.length > 0) {
        for (const s of cellMoveReuse) {
          offerRows.push({
            id: `natt-flytterbjudande-${s.variantId}-${b.path}-${b.key}`,
            path: b.path,
            status: "verified",
            ops: [{ op: "move_up", targetId: `sec-0-${s.sectionType}` }],
            evidence: { reuse: { kind: "move", provedOnPath: s.provedOnPath } },
          });
        }
      }
      plans.push(
        planRow({
          path: b.path,
          key: b.key,
          total: b.total,
          observations: b.observations,
          sourcePaths: b.sourcePaths ?? [],
          // Mall-planer: exemplaren + representanten följer med till verify,
          // som grindar opsen på VARJE fryst exemplar. path förblir mönstret —
          // exakt värdet decide-vägen matchar via templateOf.
          ...(isTpl ? { templatePages: b.templatePages, repPath: pagePath } : {}),
          ops: planOps,
          // Katalogens rankade reserver — verify provar dem i ordning (auto-
          // generate:s alt-stege) innan bevis-lyftets nödfall.
          altOps: planAltOps,
          // Provenance: ekas genom verify in i variantens evidence.
          planSource,
          // Återbrukserbjudandena — planRow gate:ar dem på planSource och
          // unionar källsidorna in i sourcePaths (verify:s whitelist).
          ...(cellReuse.length > 0 ? { reuseOffers: cellReuse } : {}),
          // Flytt-erbjudandena (transferformen steg 4) — samma gate, ingen
          // sourcePaths-union (en flytt citerar ingen källsida).
          ...(cellMoveReuse.length > 0
            ? {
                moveReuseOffers: cellMoveReuse.map((s) => ({
                  variantId: s.variantId,
                  provedOnPath: s.provedOnPath,
                  sectionType: s.sectionType,
                })),
              }
            : {}),
          cohorts: b.cohorts,
        }),
      );
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
    // OBS filnamnet: verify-steget skriver verify-report.json — "results.json"
    // här var en latent ENOENT som per-sajt-catchen svalde (fixad 2026-07-18;
    // ingen sajt hade ännu nått hit med planer).
    const results = JSON.parse(readFileSync(join(dir, "verify-report.json"), "utf8")) as {
      verdict: string;
      path: string;
      key: string;
      ops?: unknown;
      serveOps?: unknown;
      evidence?: { comparison?: { screenshots?: { before: string | null; after: string | null } } };
      slug?: string;
      /** Ekade ur plans.json av verify (typkollsfynd 2026-07-28) — förut
       *  tappades de på vägen och required_cohorts blev alltid null. */
      cohorts?: unknown;
      success?: unknown;
      planSource?: string;
    }[];

    // 6. Verifierade → ladda upp skärmdumpar till storage + direkta inserts.
    //    Status 'verified' — ALDRIG serving; det är ägarens knapp.
    for (const r of results.filter((x) => x.verdict === "verified")) {
      // desktop-paret finns bara när ett desktop-bekräftelsepass kördes
      // (viewport-grindningen, Tier-1 #3) — saknade filer hoppas tyst.
      const shots: {
        before: string | null;
        after: string | null;
        attempt1: null;
        desktopBefore?: string;
        desktopAfter?: string;
      } = { before: null, after: null, attempt1: null };
      if (r.slug) {
        const shotKeyOf = {
          before: "before",
          after: "after",
          "desktop-before": "desktopBefore",
          "desktop-after": "desktopAfter",
        } as const;
        for (const which of ["before", "after", "desktop-before", "desktop-after"] as const) {
          const local = join(dir, `${r.slug}-${which}.jpg`);
          if (!existsSync(local)) continue;
          const key = `${site.slug}/${r.slug}/${which}.jpg`;
          const { error: upErr } = await db.storage
            .from("angel-evidence")
            .upload(key, readFileSync(local), { contentType: "image/jpeg", upsert: true });
          if (!upErr) {
            const url = db.storage.from("angel-evidence").getPublicUrl(key).data.publicUrl;
            shots[shotKeyOf[which]] = url;
          }
        }
      }
      const evidence = {
        ...(r.evidence ?? {}),
        comparison: { ...(r.evidence?.comparison ?? {}), screenshots: shots },
        // Provenance (steg 11): "katalog/selector" | "katalog/floor" |
        // "designer" — LÄSES av dashboardens variantlista (VariantView.
        // planSource → "from catalog (model pick)" m.fl.), så ägaren ser var
        // förslaget kom ifrån. Guardrail-svepet ser den INTE: planGuardrailSweep
        // får bara {id, heldReason, success, arms} och dömer på uppmätta armar
        // — härkomst får aldrig påverka ett skyddsbeslut. I evidence-jsonb:n
        // (spårbarhetspåsen) — ingen migration.
        planSource: typeof r.planSource === "string" ? r.planSource : "designer",
      };
      const { error: insErr } = await db.from("angel_variants").insert({
        site: site.slug,
        path: r.path,
        segment_key: r.key,
        status: "verified",
        ops: r.ops ?? [],
        serve_ops: r.serveOps ?? [],
        evidence,
        // Kohortscopade planer (den generativa våningen läser
        // cohort-opportunities.json) föds med sitt scope + kontrakt — samma
        // fält live-vägen grindar respektive mäter på. Utan scope: null = som förut.
        required_cohorts: Array.isArray(r.cohorts)
          ? r.cohorts.filter((c): c is string => typeof c === "string")
          : null,
        success: validateSuccessSpec(r.success) ?? (defaultSuccessSpec() as unknown as null),
      });
      if (insErr) console.warn(`[loop] ${site.slug}: insert föll: ${insErr.message}`);
      else
        console.log(`[loop] ${site.slug} ${r.path}×${r.key}: VERIFIED — väntar på ägarens knapp`);
    }

    // 7. Dag-10-mejlet: svep varianter som väntar utan skickad notis.
    const { sweepVariantNotifications } = await import("../../src/adaptive/notify.server");
    await sweepVariantNotifications(site.slug);

    // 7b. Vecka-1-digesten (stanna-tills-bevisat): ETT mejl ~dag 5 när ingen
    //     variant ännu finns — insamlingsperioden ska synas, inte vara tyst.
    //     Ärliga räknare ur rollup-löven som redan är lästa (steg 1); dedupen
    //     bor i notifyOwners så svepet är idempotent. Finns en variant äger
    //     dag-10-mejlet berättelsen och digesten skickas aldrig.
    try {
      const { count: variantCount } = await db
        .from("angel_variants")
        .select("id", { count: "exact", head: true })
        .eq("site", site.slug);
      if (!variantCount) {
        const { data: firstEv } = await db
          .from("angel_events")
          .select("created_at")
          .eq("site", site.slug)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        const ageDays = firstEv ? (Date.now() - Date.parse(firstEv.created_at)) / 86_400_000 : 0;
        if (ageDays >= 5) {
          const byGroup = new Map<string, number>();
          let visitors = 0;
          for (const l of leaves as { channel?: string; device?: string; visits?: number }[]) {
            const v = Number(l.visits) || 0;
            visitors += v;
            if (l.channel && l.device) {
              const key = `${l.channel} · ${l.device}`;
              byGroup.set(key, (byGroup.get(key) ?? 0) + v);
            }
          }
          const top = [...byGroup.entries()].sort((a, b) => b[1] - a[1])[0];
          const { count: pageviews } = await db
            .from("angel_events")
            .select("id", { count: "exact", head: true })
            .eq("site", site.slug)
            .eq("type", "pageview");
          const { notifyWeekOneDigest } = await import("../../src/adaptive/notify.server");
          await notifyWeekOneDigest(site.slug, {
            visitors,
            pageviews: pageviews ?? 0,
            topGroup: top ? `${top[0]} (${top[1].toLocaleString("en-US")} visits)` : null,
          });
        }
      }
    } catch (dgErr) {
      console.warn(`[loop] ${site.slug}: vecka-1-digesten föll (icke-fatalt):`, dgErr);
    }
  } catch (err) {
    console.error(`[loop] ${site.slug} föll:`, err);
  }
}

// 8. Prismodellens svep (globalt, idempotent): stämpla first_verified_at och
//    korta trialing-ägares trial till graceDays varsel — "gratis tills
//    bevisad" (ägarbeslut 2026-07-17). Fail-open utan STRIPE_SECRET_KEY.
try {
  const { sweepProvenBilling } = await import("../../src/lib/billing/stripe.server");
  await sweepProvenBilling();
} catch (err) {
  console.warn("[loop] billing-svepet föll (fail-open):", err);
}
console.log("\n[loop] klar");
