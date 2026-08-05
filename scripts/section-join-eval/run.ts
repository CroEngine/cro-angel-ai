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
//   • Sida A (server): PRODUKTIONENS SERIALISERINGSPOLICY — nightly/auto-
//     generate kör extractContentModel på freeze-page-utdata, som är RÅ
//     `"<!doctype html>\n" + document.documentElement.outerHTML` (dolda
//     delträd KVAR — granskningsfynd 2026-08-05: en tidigare version använde
//     serializeVisibleHtml här, vilket mätte en RENARE modell än produktionen
//     har). Sedan generateCandidates för sätets faktiska nycklar (flyttmålen).
//     Ärliga avvikelser som INTE går att brygga offline: produktionens
//     redesign-frys renderas 390×844 (mobil) medan korpusens mhtml är frysta
//     vid sina egna viewports, och nightly kan efter extraktionen köra LLM-
//     om-typaren som byter typ-SUFFIXET i id:t (`sec-N-typ`) — rubriken,
//     join-nyckeln här, rörs aldrig av den, men konsumenter måste slå upp id
//     via modellens AKTUELLA sektioner, aldrig via sparade id-strängar.
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
  // ALLA drift-survey-sidor med sektions-etiketter i structure-eval/labels.json
  // (granskningsfynd 2026-08-05: ett tidigare urval utelämnade 8 etiketterade
  // sidor — 6 av dem ecommerce, just den klass som översegmenterar — och
  // README:n påstod ändå komplett urval). Utanför står bara de etiketterade
  // NOLL-sektions-kontrollerna (cookie-wall/iframe/media/spa-flöden).
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
    drift("i18n-routing", "booking"),
    drift("i18n-routing", "tradera"),
    drift("ecommerce", "patagonia"),
    drift("ecommerce", "glossier"),
    drift("ecommerce", "ikea-se"),
    drift("ecommerce", "rei"),
    drift("ecommerce", "shopify-store-allbirds"),
    drift("ecommerce", "shopify-store-gymshark"),
    drift("ecommerce", "warby-parker"),
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

// Join-kärnan (norm/joinSection/injektivitet) BOR i src/adaptive/redesign/
// section-join.ts sedan steg 8 — produktionens rollup och den här eval:en
// måste döma exakt likadant, så regeln finns på ETT ställe. Re-exporteras för
// bakåtkompatibla imports i testerna.
import {
  claimJoins,
  joinSection,
  normHeadingKey as norm,
  type JoinVerdict,
  type SectionJoin,
} from "../../src/adaptive/redesign/section-join";

export { joinSection, type JoinVerdict, type SectionJoin };

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
  /** B-innehållssektioner (med rubrik) som är NÅGON A-sektions unika mål
   *  efter injektivitetspasset — engagemang där KAN krediteras ett id.
   *  Resten är förlorad signal (granskningsfix 2026-08-05: räknades förut
   *  exakt-bara, vilket falskt stämplade prefix-räddade rubriker — hubspots
   *  hero! — som "aldrig krediterbara" samtidigt som framåt-joinen
   *  krediterade dem). */
  creditedB: number;
  bContentWithHeading: number;
  creditRate: number;
  error?: string;
}

interface BSection {
  type: string;
  heading: string;
}

/** Räkna ihop en sajts join ur redan-insamlade sidor — ren funktion, testbar
 *  utan chromium; chromium-vägen nedan är bara insamling. Joinen + injektivi-
 *  tetspasset är den DELADE kärnan (claimJoins) — samma dom som rollupen. */
export function scoreSiteJoin(
  site: string,
  aModelSections: { id: string; type: string; heading: string }[],
  candidateTargetIds: Set<string>,
  bSectionsAll: BSection[],
): SiteJoinResult {
  const NON_CONTENT = new Set(["nav", "header", "footer", "aside"]);
  const bContentSections = bSectionsAll.filter((b) => !NON_CONTENT.has(b.type));
  const bHeadings = bContentSections.map((b) => b.heading).filter((h) => h.length > 0);
  const { joins, claimedBy } = claimJoins(aModelSections, bHeadings, candidateTargetIds);

  const unik = joins.filter((j) => j.verdict === "UNIK").length;
  const flertydig = joins.filter((j) => j.verdict === "FLERTYDIG").length;
  const oupplöst = joins.filter((j) => j.verdict === "OUPPLÖST").length;
  const cand = joins.filter((j) => j.isCandidateTarget);
  const candUnik = cand.filter((j) => j.verdict === "UNIK").length;

  // Krediterbarhet: en B-rubrik KAN krediteras omm den är någon A-sektions
  // unika mål efter injektivitetspasset — SAMMA upplösning (claimedBy) som
  // rollupen krediterar genom, inte en egen sidoregel.
  const creditedKeys = new Set(claimedBy.keys());
  const creditedB = bHeadings.filter((b) => creditedKeys.has(norm(b))).length;
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
    creditedB,
    bContentWithHeading: bHeadings.length,
    creditRate: bHeadings.length ? creditedB / bHeadings.length : 1,
  };
}

async function collectSite(browser: Browser, capturePath: string): Promise<{
  aSections: { id: string; type: string; heading: string }[];
  candidateTargetIds: Set<string>;
  bSections: BSection[];
}> {
  // ALLT förvärv sker inne i try:n (granskningsfix 2026-08-05: mkdtemp/copy/
  // newContext låg före — en krasch i fönstret läckte tmp-katalog + context
  // per kvarvarande sajt efter en webbläsardöd, ~100 MB på ett 20-sajtsvep).
  let tmp: string | null = null;
  let ctx: Awaited<ReturnType<Browser["newContext"]>> | null = null;
  try {
    tmp = mkdtempSync(join(tmpdir(), "section-join-"));
    const tmpFile = join(tmp, "page.mhtml");
    copyFileSync(capturePath, tmpFile);
    ctx = await browser.newContext({
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

    // Sida A FÖRST, på ostörd sida: PRODUKTIONENS serialiseringspolicy
    // (freeze-page.ts:897) — RÅ outerHTML med dolda delträd kvar, exakt det
    // nightly/auto-generate matar extractContentModel med. (Granskningsfix
    // 2026-08-05: serializeVisibleHtml här mätte en renare modell än
    // produktionens.)
    const rawHtml = (await page.evaluate(
      () => "<!doctype html>\n" + document.documentElement.outerHTML,
    )) as string;
    const model = extractContentModel(rawHtml);
    const candidateTargetIds = new Set(
      generateCandidates(model)
        .filter((c) => c.kind === "move_up")
        .map((c) => c.targetId),
    );

    // Sida B: den riktiga skörde-censusen (SECTIONS_SCRIPT via runPageAudit).
    // OFFLINE-VAKT (granskningsfix 2026-08-05): pageAudits headCheck HEAD:ar
    // sidans canonical-URL via Nodes fetch — routing-aborten når inte dit och
    // 19/20 captures bär riktiga https-canonicals. Stubba fetch under audit-
    // anropet så eval:en aldrig rör nätet; headCheck sväljer felet själv.
    type Audit = { sections?: Array<{ type: string; heading?: string; displayHeading?: string }> };
    let audit: Audit | null = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.reject(new Error("section-join-eval: network disabled"))) as typeof fetch;
    try {
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
    } finally {
      globalThis.fetch = realFetch;
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
    if (ctx) await ctx.close().catch(() => {});
    if (tmp) rmSync(tmp, { recursive: true, force: true });
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
  totalCreditedB: number;
  creditRate: number;
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
          creditedB: 0,
          bContentWithHeading: 0,
          creditRate: 0,
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
  const totalCreditedB = sum((r) => r.creditedB);
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
    totalCreditedB,
    creditRate: totalBContentWithHeading ? totalCreditedB / totalBContentWithHeading : 0,
  };
}

// CLI — exit 0 bara när ALLA närvarande sajter mättes utan fel; havererade
// sajter (eller ett harness-haveri) ger exit 1 så skript/CI aldrig läser ett
// tomt svep som ett lyckat (granskningsfix 2026-08-05).
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
        `  ${s.site.padEnd(18)} ${String(s.aSections).padStart(6)} ${String(s.bContent).padStart(7)} ${String(s.unik).padStart(5)} ${String(s.flertydig).padStart(5)} ${String(s.oupplöst).padStart(5)} ${pct(s.coverage).padStart(7)} ${`${s.candUnik}/${s.candTotal}`.padStart(9)} ${pct(s.creditRate).padStart(7)}`,
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
      `  krediterbara B-rubriker     : ${pct(r.creditRate)}  (${r.totalCreditedB}/${r.totalBContentWithHeading}; resten är förlorad signal — aldrig felkreditering)`,
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
    const failed = r.scored.filter((s) => s.error);
    if (failed.length) console.error(`\n${failed.length} sajt(er) havererade — exit 1`);
    process.exit(failed.length || r.scored.length === 0 ? 1 : 0);
  }).catch((e) => {
    console.error("join-eval havererade:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
