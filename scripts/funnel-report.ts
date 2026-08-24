// Onboarding-trattens sömmar ur BEFINTLIGA rader (ägarbeslut 2026-08-18,
// 1000-sajters-målet: installs/vecka är siffran att stirra på). Ingen ny
// eventtabell — allt härleds:
//
//   paste → exempel     angel_preview_jobs (distinkta adresser, status ok)
//   aktiverade sajter   angel_sites.created_from = 'preview:…' | 'manual'
//   installerade        angel_sites.domain_verified_at (första origin-bevisade
//                       eventet — samma stämpel som day-0-mejlet)
//   mätning på          consent_mode = 'attested'
//   första förslag      angel_variants per sajt (verified/serving/winner)
//
// Körs med service-rollnycklar i miljön:  bun run scripts/funnel-report.ts
// Labbet räknas aldrig (samma regel som /api/public/stats).

import { createClient } from "@supabase/supabase-js";

import { LAB_SITES } from "../src/lib/public-stats/stats";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("[funnel] SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY krävs i miljön");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const notLab = <T extends { site?: string | null; slug?: string | null }>(rows: T[]): T[] =>
  rows.filter((r) => !LAB_SITES.includes((r.site ?? r.slug ?? "") as string));

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((100 * a) / b)}%` : "–");

/** Paginerad fullhämtning (granskningsfynd 2026-08-19): bara .select() tystas
 *  vid PostgRESTs 1000-raderstak — rapporten som ska räkna mot 1000 sajter
 *  hade slutat räkna exakt när målet närmade sig. */
async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select(cols)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function main() {
  const [jobs, sites, variants] = await Promise.all([
    fetchAll<{ url: string; status: string }>("angel_preview_jobs", "url,status"),
    fetchAll<{
      slug: string;
      created_from: string | null;
      domain_verified_at: string | null;
      consent_mode: string | null;
      created_at: string;
    }>("angel_sites", "slug,created_from,domain_verified_at,consent_mode,created_at"),
    fetchAll<{ site: string; status: string }>("angel_variants", "site,status"),
  ]);

  const pastes = new Set(jobs.map((j) => j.url)).size;
  const examplesOk = new Set(jobs.filter((j) => j.status === "ok").map((j) => j.url)).size;

  const s = notLab(sites ?? []);
  const fromPreview = s.filter((x) => (x.created_from ?? "").startsWith("preview:"));
  const manual = s.filter((x) => x.created_from === "manual");
  const legacy = s.filter((x) => !x.created_from);
  const installed = s.filter((x) => x.domain_verified_at);
  const attested = s.filter((x) => x.consent_mode === "attested");

  const v = notLab(variants ?? []);
  const sitesWithProposal = new Set(
    v.filter((x) => ["verified", "serving", "winner"].includes(x.status)).map((x) => x.site),
  ).size;

  console.log("── onboarding-tratten ───────────────────────────────");
  console.log(`inklistrade adresser (distinkta)   ${pastes}`);
  console.log(`  → byggda exempel                 ${examplesOk}  (${pct(examplesOk, pastes)})`);
  console.log(`sajter totalt (exkl. labb)         ${s.length}`);
  console.log(`  varav aktiverade ur demo         ${fromPreview.length}`);
  console.log(`  varav formulärskapade            ${manual.length}`);
  console.log(`  varav historiska (före kolumnen) ${legacy.length}`);
  console.log(
    `  → installerade (snippet sedd)    ${installed.length}  (${pct(installed.length, s.length)})`,
  );
  console.log(
    `  → mätning på (attested)          ${attested.length}  (${pct(attested.length, s.length)})`,
  );
  console.log(
    `  → med minst ett färdigt förslag  ${sitesWithProposal}  (${pct(sitesWithProposal, s.length)})`,
  );
  console.log("─────────────────────────────────────────────────────");
  console.log(`MÅLET: 1000 installerade sajter 2026-12-31 · nu: ${installed.length}`);
}

main().catch((e) => {
  console.error("[funnel] fel:", e instanceof Error ? e.message : e);
  process.exit(1);
});
