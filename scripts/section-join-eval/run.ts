// SEKTIONS-JOIN-EVAL (steg 5, D3): kan runtime-engagemang kopplas tillbaka
// till extract.ts sektions-id:n — de nycklar beteende-sätet (BehaviorInput,
// steg 7) rankar på? Detta är sista okända faktorn före insamlingen (steg
// 8–9): når join-täckningen inte upp går rollupens "hög join-miss ⇒ null"-
// grind av oftare än sätet får data.
//
// Mätningen är ÄNDA-TILL-ÄNDA mot produktionens båda sidor, offline:
//   • Sida B (runtime): den RIKTIGA skörde-censusen — runPageAudit kör samma
//     SECTIONS_SCRIPT-sträng som public/adaptive-harvest.js serverar riktiga
//     besökare (ingen TS-omport — kritikerns krav) — via page.evaluate mot den
//     frusna DOM:en i pinnad chromium.
//   • Sida A (server): samma väg som nightly/auto-generate — synlig-DOM-
//     serialisering (serializeVisibleHtml) → extractContentModel → sektioner
//     med id "sec-N-typ", plus generateCandidates för att peka ut just de
//     sektioner sätet faktiskt rankar (flyttmålen).
//
// Join-regeln SPEGLAR produktionens serving-lokator (applier.ts findByLocator,
// CI-pinnad in i public/adaptive.js): pass 1 exakt normaliserad rubrik, pass 2
// 24-teckens prefix-substräng. Domen per A-sektion lånar atlas-graderingen:
//   UNIK      exakt en B-träff — engagemang kan krediteras rätt id
//   FLERTYDIG flera B-träffar — kreditering vore en gissning (räknas som miss)
//   OUPPLÖST  ingen B-träff — signalen kan inte nå id:t alls
//
//   bun run join-eval                 (hela korpusen)
//   bun run join-eval hubspot linear  (delmängd)
// Lib: evalSectionJoin() — CI-regressionstestet återanvänder samma funktion.

import { chromium, type Browser, type Page } from "playwright";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { serializeVisibleHtml } from "../redesign/visible-dom";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { generateCandidates } from "../../src/adaptive/redesign/candidates";
import { runPageAudit } from "../../src/lib/tests/runners/pageAudit.server";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

/** Korpusen: alla fullkontrakts-captures i corpus/ (auto-upptäckta, så nya
 *  frysningar följer med) + de etiketterade marknadssidorna ur drift-svepet.
 *  Cookie-wall/iframe/media-kontrollerna utelämnas medvetet: de är etiketterade
 *  med NOLL sektionstyper (negativa kontroller) och har inget engagemang att
 *  kreditera. */
function corpusSites(): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  const corpusDir = join(REPO_ROOT, "corpus");
  if (existsSync(corpusDir)) {
    for (const d of readdirSync(corpusDir, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(corpusDir, d.name, "page.mhtml")))
        out.push({ name: d.name, path: join("corpus", d.name, "page.mhtml") });
    }
  }
  const drift = (cat: string, name: string) => ({
    name,
    path: join("fixtures", "drift-survey", cat, name, "page.mhtml"),
  });
  out.push(
    drift("saas-landing", "intercom"),
    drift("saas-landing", "supabase"),
    drift("saas-landing", "stripe"),
    drift("saas-landing", "notion"),
    drift("saas-landing", "loom"),
    drift("saas-landing", "vercel"),
    drift("spa", "trello"),
    drift("i18n-routing", "klarna"),
    drift("i18n-routing", "uber"),
    drift("ecommerce", "patagonia"),
  );
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitStable(page: Page, tries = 45, gap = 200, need = 2): Promise<void> {
  let s = 0;
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const u = await page.evaluate(() => location.href);
      s = u === last ? s + 1 : 1;
      last = u;
      if (s >= need) return;
    } catch {
      s = 0;
    }
    await sleep(gap);
  }
}

/** Scroll-uppvärmning med harnessets korrigeringar (som structure-evalens
 *  kopia saknar): instant scrollTo vid återgången + verifierad scrollY===0 —
 *  smooth-scroll-sajter animerar annars och censusen mäter mitt i flykten. */
async function nodeScroll(page: Page, steps = 8, gap = 150): Promise<void> {
  const safe = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      await waitStable(page);
      await fn().catch(() => {});
    }
  };
  for (let i = 1; i <= steps; i++) {
    await safe(() =>
      page.evaluate(
        ({ idx, total }) => {
          const h = document.documentElement.scrollHeight;
          window.scrollTo(0, (h / total) * idx);
        },
        { idx: i, total: steps },
      ),
    );
    await sleep(gap);
  }
  await safe(() => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)));
  await sleep(600);
  await safe(() =>
    page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior })),
  );
  for (let i = 0; i < 20; i++) {
    const y = await page.evaluate(() => window.scrollY).catch(() => -1);
    if (y === 0) break;
    await sleep(100);
  }
}

/** Applierns normalisering, byte-speglad (applier.ts:153): ihopfällt blanksteg,
 *  trim, gemener. */
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export type JoinVerdict = "UNIK" | "FLERTYDIG" | "OUPPLÖST";

export interface SectionJoin {
  aId: string;
  aType: string;
  aHeading: string;
  isCandidateTarget: boolean;
  verdict: JoinVerdict;
  /** Vilken pass som avgjorde (exakt/prefix) — bara för UNIK/FLERTYDIG. */
  via: "exact" | "prefix" | null;
  matchedBHeadings: string[];
}

export interface SiteJoinResult {
  site: string;
  aSections: number;
  bSections: number;
  /** B-sektioner utanför nav/header/footer/aside — de engagemang kan bo i. */
  bContent: number;
  joins: SectionJoin[];
  unik: number;
  flertydig: number;
  oupplöst: number;
  /** UNIK / A-sektioner: kan sektionens id nås alls från runtime-rubriker? */
  coverage: number;
  candTotal: number;
  candUnik: number;
  /** UNIK över kandidat-flyttmålen — talet som avgör steg 8:s rollup. */
  candCoverage: number;
  /** Omvänt: B-innehållssektioner (med rubrik) vars rubrik exakt når någon
   *  A-sektion — engagemang på resten kan aldrig krediteras något id. */
  reverseExact: number;
  bContentWithHeading: number;
  reverseCoverage: number;
  error?: string;
}

interface BSection {
  type: string;
  heading: string;
}

/** Joina EN A-sektion mot census-rubrikerna med applierns tvåpass-regel. Ren
 *  funktion — testbar utan chromium. */
export function joinSection(
  a: { id: string; type: string; heading: string },
  bHeadings: string[],
  isCandidateTarget: boolean,
): SectionJoin {
  const aKey = norm(a.heading);
  const base = { aId: a.id, aType: a.type, aHeading: a.heading, isCandidateTarget };
  if (!aKey) return { ...base, verdict: "OUPPLÖST", via: null, matchedBHeadings: [] };
  const exact = bHeadings.filter((b) => norm(b) === aKey);
  if (exact.length === 1) return { ...base, verdict: "UNIK", via: "exact", matchedBHeadings: exact };
  if (exact.length > 1)
    return { ...base, verdict: "FLERTYDIG", via: "exact", matchedBHeadings: exact };
  // Pass 2 — applierns driftstoleranta 24-teckens prefix (indexOf, inte bara
  // startsWith: speglar applier.ts:168 exakt).
  const needle = aKey.slice(0, 24);
  const prefix = bHeadings.filter((b) => norm(b).indexOf(needle) >= 0);
  if (prefix.length === 1)
    return { ...base, verdict: "UNIK", via: "prefix", matchedBHeadings: prefix };
  if (prefix.length > 1)
    return { ...base, verdict: "FLERTYDIG", via: "prefix", matchedBHeadings: prefix };
  return { ...base, verdict: "OUPPLÖST", via: null, matchedBHeadings: [] };
}

/** Räkna ihop en sajts join ur redan-insamlade sidor — ren funktion, testbar
 *  utan chromium; chromium-vägen nedan är bara insamling. */
export function scoreSiteJoin(
  site: string,
  aModelSections: { id: string; type: string; heading: string }[],
  candidateTargetIds: Set<string>,
  bSectionsAll: BSection[],
): SiteJoinResult {
  const NON_CONTENT = new Set(["nav", "header", "footer", "aside"]);
  const bContentSections = bSectionsAll.filter((b) => !NON_CONTENT.has(b.type));
  const bHeadings = bContentSections.map((b) => b.heading).filter((h) => h.length > 0);
  const joins = aModelSections.map((a) => joinSection(a, bHeadings, candidateTargetIds.has(a.id)));
  const unik = joins.filter((j) => j.verdict === "UNIK").length;
  const flertydig = joins.filter((j) => j.verdict === "FLERTYDIG").length;
  const oupplöst = joins.filter((j) => j.verdict === "OUPPLÖST").length;
  const cand = joins.filter((j) => j.isCandidateTarget);
  const candUnik = cand.filter((j) => j.verdict === "UNIK").length;
  const aKeys = new Set(aModelSections.map((a) => norm(a.heading)).filter(Boolean));
  const reverseExact = bHeadings.filter((b) => aKeys.has(norm(b))).length;
  return {
    site,
    aSections: aModelSections.length,
    bSections: bSectionsAll.length,
    bContent: bContentSections.length,
    joins,
    unik,
    flertydig,
    oupplöst,
    coverage: aModelSections.length ? unik / aModelSections.length : 1,
    candTotal: cand.length,
    candUnik,
    candCoverage: cand.length ? candUnik / cand.length : 1,
    reverseExact,
    bContentWithHeading: bHeadings.length,
    reverseCoverage: bHeadings.length ? reverseExact / bHeadings.length : 1,
  };
}

async function collectSite(browser: Browser, capturePath: string): Promise<{
  aSections: { id: string; type: string; heading: string }[];
  candidateTargetIds: Set<string>;
  bSections: BSection[];
}> {
  const tmp = mkdtempSync(join(tmpdir(), "section-join-"));
  const tmpFile = join(tmp, "page.mhtml");
  copyFileSync(capturePath, tmpFile);
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  await ctx.route("**/*", (r) =>
    r.request().url().startsWith("file://") ? r.continue() : r.abort(),
  );
  await ctx.addInitScript(() => {
    try {
      const n = () => {};
      history.pushState = n as typeof history.pushState;
      history.replaceState = n as typeof history.replaceState;
      (window.location as unknown as { assign: () => void }).assign = n;
      (window.location as unknown as { replace: () => void }).replace = n;
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`file://${tmpFile}`, { waitUntil: "load", timeout: 30_000 });
    let lu = page.url();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const now = page.url();
      if (now === lu && i > 1) break;
      lu = now;
    }
    await sleep(600);
    await waitStable(page);
    await nodeScroll(page);
    await waitStable(page);

    // Sida A FÖRST, på ostörd sida: produktionens exakta väg (auto-generate
    // :135) — synlig-DOM-serialisering in i extractContentModel.
    const visibleHtml = await serializeVisibleHtml(page);
    const model = extractContentModel(visibleHtml);
    const candidateTargetIds = new Set(
      generateCandidates(model)
        .filter((c) => c.kind === "move_up")
        .map((c) => c.targetId),
    );

    // Sida B: den riktiga skörde-censusen (SECTIONS_SCRIPT via runPageAudit).
    type Audit = { sections?: Array<{ type: string; heading?: string; displayHeading?: string }> };
    let audit: Audit | null = null;
    for (let a = 0; a < 3 && !audit; a++) {
      try {
        audit = (await runPageAudit(page as unknown as Parameters<typeof runPageAudit>[0], {
          skipScrollWarmup: true,
          skipCookiePoll: true,
        })) as Audit;
      } catch (e) {
        await waitStable(page);
        if (a === 2) throw e;
      }
    }
    // Rubriknyckeln som skulle bära engagemanget: census-rubriken, med
    // displayHeading som reserv — samma prioritet som lab-inventeringen
    // (inventory.ts: sec.heading || sec.displayHeading).
    const bSections: BSection[] = (audit!.sections ?? []).map((s) => ({
      type: s.type,
      heading: (s.heading || s.displayHeading || "").slice(0, 200),
    }));
    return {
      aSections: model.sections.map((s) => ({ id: s.id, type: s.type, heading: s.heading })),
      candidateTargetIds,
      bSections,
    };
  } finally {
    await ctx.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface JoinEvalResult {
  scored: SiteJoinResult[];
  skipped: string[];
  /** Viktade aggregat över alla sajter (summa täljare / summa nämnare). */
  totalA: number;
  totalUnik: number;
  totalFlertydig: number;
  totalOupplöst: number;
  coverage: number;
  totalCand: number;
  totalCandUnik: number;
  candCoverage: number;
  totalBContentWithHeading: number;
  totalReverseExact: number;
  reverseCoverage: number;
}

export async function evalSectionJoin(
  opts: { only?: string[]; executablePath?: string } = {},
): Promise<JoinEvalResult> {
  const all = corpusSites().filter(
    (s) => !opts.only || opts.only.length === 0 || opts.only.includes(s.name),
  );
  const present = all.filter((s) => existsSync(join(REPO_ROOT, s.path)));
  const skipped = all.filter((s) => !present.includes(s)).map((s) => s.name);
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      opts.executablePath || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const scored: SiteJoinResult[] = [];
  try {
    for (const s of present) {
      try {
        const { aSections, candidateTargetIds, bSections } = await collectSite(
          browser,
          join(REPO_ROOT, s.path),
        );
        scored.push(scoreSiteJoin(s.name, aSections, candidateTargetIds, bSections));
      } catch (e) {
        scored.push({
          site: s.name,
          aSections: 0,
          bSections: 0,
          bContent: 0,
          joins: [],
          unik: 0,
          flertydig: 0,
          oupplöst: 0,
          coverage: 0,
          candTotal: 0,
          candUnik: 0,
          candCoverage: 0,
          reverseExact: 0,
          bContentWithHeading: 0,
          reverseCoverage: 0,
          error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
        });
      }
    }
  } finally {
    await browser.close();
  }
  const sum = (f: (r: SiteJoinResult) => number) => scored.reduce((a, r) => a + f(r), 0);
  const totalA = sum((r) => r.aSections);
  const totalUnik = sum((r) => r.unik);
  const totalCand = sum((r) => r.candTotal);
  const totalCandUnik = sum((r) => r.candUnik);
  const totalBContentWithHeading = sum((r) => r.bContentWithHeading);
  const totalReverseExact = sum((r) => r.reverseExact);
  return {
    scored,
    skipped,
    totalA,
    totalUnik,
    totalFlertydig: sum((r) => r.flertydig),
    totalOupplöst: sum((r) => r.oupplöst),
    coverage: totalA ? totalUnik / totalA : 0,
    totalCand,
    totalCandUnik,
    candCoverage: totalCand ? totalCandUnik / totalCand : 0,
    totalBContentWithHeading,
    totalReverseExact,
    reverseCoverage: totalBContentWithHeading ? totalReverseExact / totalBContentWithHeading : 0,
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  evalSectionJoin({ only }).then((r) => {
    const pct = (x: number) => (x * 100).toFixed(1) + "%";
    console.log(`\n===== SEKTIONS-JOIN (runtime-census ↔ extract.ts sektions-id) =====`);
    console.log(`sajter: ${r.scored.length}${r.skipped.length ? `  (hoppade: ${r.skipped.join(", ")})` : ""}`);
    console.log(``);
    console.log(
      `  ${"sajt".padEnd(18)} ${"A-sekt".padStart(6)} ${"B-inneh".padStart(7)} ${"UNIK".padStart(5)} ${"FLER".padStart(5)} ${"OUPP".padStart(5)} ${"täckn".padStart(7)} ${"kand".padStart(9)} ${"omvänd".padStart(7)}`,
    );
    for (const s of r.scored) {
      if (s.error) {
        console.log(`  ${s.site.padEnd(18)} FEL: ${s.error}`);
        continue;
      }
      console.log(
        `  ${s.site.padEnd(18)} ${String(s.aSections).padStart(6)} ${String(s.bContent).padStart(7)} ${String(s.unik).padStart(5)} ${String(s.flertydig).padStart(5)} ${String(s.oupplöst).padStart(5)} ${pct(s.coverage).padStart(7)} ${`${s.candUnik}/${s.candTotal}`.padStart(9)} ${pct(s.reverseCoverage).padStart(7)}`,
      );
    }
    console.log(``);
    console.log(`AGGREGAT (viktat)`);
    console.log(
      `  A-sektioner → unik B-träff  : ${pct(r.coverage)}  (${r.totalUnik}/${r.totalA}; FLERTYDIG ${r.totalFlertydig}, OUPPLÖST ${r.totalOupplöst})`,
    );
    console.log(
      `  KANDIDAT-flyttmål → unik    : ${pct(r.candCoverage)}  (${r.totalCandUnik}/${r.totalCand})   <- talet steg 8:s rollup står på`,
    );
    console.log(
      `  omvänt: B-rubrik → någon A  : ${pct(r.reverseCoverage)}  (${r.totalReverseExact}/${r.totalBContentWithHeading}; resten kan aldrig krediteras)`,
    );
    console.log(``);
    for (const s of r.scored) {
      const misses = s.joins.filter((j) => j.verdict !== "UNIK");
      if (!misses.length) continue;
      console.log(`  ${s.site} — icke-UNIK:`);
      for (const m of misses)
        console.log(
          `    ${m.verdict.padEnd(9)} ${m.aId}${m.isCandidateTarget ? " [kandidat]" : ""} "${m.aHeading.slice(0, 60)}"${m.matchedBHeadings.length ? ` ↔ ${m.matchedBHeadings.length} B-träffar` : ""}`,
        );
    }
    process.exit(0);
  });
}
