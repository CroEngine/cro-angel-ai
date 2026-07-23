// Page-structure ground-truth benchmark runner.
//
// Replays each capture in labels.json, runs the REAL section + CTA detectors
// (via runPageAudit → sections[].type and the derived hero.primaryCtaText), and
// scores two things against the hand-labeled ground truth:
//
//   1. SECTION-TYPE PRESENCE — precision / recall / F1 over (site × semantic
//      type) for {hero, features, benefits, pricing, faq, testimonials, form},
//      exactly like trust-eval but for page structure.
//   2. PRIMARY-CTA pick — accuracy on sites with a labeled primary CTA (does the
//      derived hero CTA match the real one?), plus a "no false primary" rate on
//      sites that genuinely have none (does the detector avoid inventing one?).
//
// Captures not on disk (gitignored fixtures) are skipped, so the same harness
// scores the full 32-site set locally and the committed-corpus subset in CI.
//
// CLI:  bun run src/lib/tests/structure-eval/run.ts          (score all available)
//       bun run src/lib/tests/structure-eval/run.ts hubspot stripe   (subset)
// Lib:  import { evalStructure } from "./run";  (used by the CI regression test)

import { chromium, type Browser, type Page } from "playwright";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runPageAudit } from "../runners/pageAudit.server";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const LABELS = JSON.parse(readFileSync(join(HERE, "labels.json"), "utf8")) as {
  sectionTypes: string[];
  captures: Record<string, string>;
  labels: Record<
    string,
    { sections: Record<string, number>; primaryCta: string | null; _note?: string }
  >;
};

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
  await safe(() => page.evaluate(() => window.scrollTo(0, 0)));
  await sleep(200);
}

type Detected = { sectionTypes: Set<string>; heroCtaText: string; heroCtaIntent: string };

async function detectSite(browser: Browser, capturePath: string): Promise<Detected> {
  const tmp = mkdtempSync(join(tmpdir(), "structure-eval-"));
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
    type Audit = {
      sections: Array<{ type: string }>;
      hero?: { primaryCtaText?: string; primaryCtaIntent?: string };
    };
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
    const sectionTypes = new Set<string>();
    for (const s of audit!.sections || []) {
      if (LABELS.sectionTypes.includes(s.type)) sectionTypes.add(s.type);
    }
    return {
      sectionTypes,
      heroCtaText: audit!.hero?.primaryCtaText || "",
      heroCtaIntent: audit!.hero?.primaryCtaIntent || "",
    };
  } finally {
    await ctx.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Lenient CTA text match: normalized equality, substring either way, or >=60%
// token overlap — so "Get a demo" matches "Get a demo of HubSpot's software".
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function ctaMatch(label: string, got: string): boolean {
  const a = norm(label);
  const b = norm(got);
  if (!a || !b) return false;
  if (a === b || b.includes(a) || a.includes(b)) return true;
  const at = new Set(a.split(" "));
  const bt = b.split(" ");
  const inter = bt.filter((t) => at.has(t)).length;
  return inter / Math.max(at.size, bt.length) >= 0.6;
}

export type StructureEvalResult = {
  scored: string[];
  skipped: string[];
  // section presence
  TP: number;
  FP: number;
  FN: number;
  TN: number;
  precision: number;
  recall: number;
  f1: number;
  perType: Record<string, { tp: number; fp: number; fn: number; tn: number }>;
  fps: string[];
  fns: string[];
  // primary CTA
  ctaScored: number;
  ctaCorrect: number;
  ctaAccuracy: number;
  ctaMisses: Array<{ site: string; want: string; got: string }>;
  nullScored: number;
  nullClean: number;
  noFalsePrimaryRate: number;
  nullFalse: Array<{ site: string; got: string }>;
  perSite: Record<string, { got: string[]; heroCta: string; heroIntent: string }>;
};

export async function evalStructure(
  opts: { only?: string[]; executablePath?: string } = {},
): Promise<StructureEvalResult> {
  const all = (opts.only && opts.only.length ? opts.only : Object.keys(LABELS.labels)).filter(
    (n) => LABELS.labels[n],
  );
  const scored = all.filter((n) => existsSync(join(REPO_ROOT, LABELS.captures[n] || "")));
  const skipped = all.filter((n) => !scored.includes(n));
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      opts.executablePath || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });

  const perType: Record<string, { tp: number; fp: number; fn: number; tn: number }> = {};
  for (const t of LABELS.sectionTypes) perType[t] = { tp: 0, fp: 0, fn: 0, tn: 0 };
  let TP = 0,
    FP = 0,
    FN = 0,
    TN = 0;
  const fps: string[] = [];
  const fns: string[] = [];
  let ctaScored = 0,
    ctaCorrect = 0;
  const ctaMisses: Array<{ site: string; want: string; got: string }> = [];
  let nullScored = 0,
    nullClean = 0;
  const nullFalse: Array<{ site: string; got: string }> = [];
  const perSite: Record<string, { got: string[]; heroCta: string; heroIntent: string }> = {};

  try {
    for (const name of scored) {
      let det: Detected;
      try {
        det = await detectSite(browser, join(REPO_ROOT, LABELS.captures[name]));
      } catch {
        det = { sectionTypes: new Set(), heroCtaText: "", heroCtaIntent: "" };
      }
      perSite[name] = {
        got: Array.from(det.sectionTypes).sort(),
        heroCta: det.heroCtaText,
        heroIntent: det.heroCtaIntent,
      };
      const lab = LABELS.labels[name];

      // section presence
      for (const t of LABELS.sectionTypes) {
        const L = lab.sections[t] === 1;
        const G = det.sectionTypes.has(t);
        if (L && G) {
          TP++;
          perType[t].tp++;
        } else if (!L && G) {
          FP++;
          perType[t].fp++;
          fps.push(`${name}/${t}`);
        } else if (L && !G) {
          FN++;
          perType[t].fn++;
          fns.push(`${name}/${t}`);
        } else {
          TN++;
          perType[t].tn++;
        }
      }

      // primary CTA
      if (lab.primaryCta) {
        ctaScored++;
        if (ctaMatch(lab.primaryCta, det.heroCtaText)) ctaCorrect++;
        else ctaMisses.push({ site: name, want: lab.primaryCta, got: det.heroCtaText || "(none)" });
      } else {
        nullScored++;
        // "clean" = did NOT confidently assert a conversion-intent hero CTA.
        const asserted = det.heroCtaText && det.heroCtaIntent === "conversion";
        if (!asserted) nullClean++;
        else nullFalse.push({ site: name, got: det.heroCtaText });
      }
    }
  } finally {
    await browser.close();
  }

  const precision = TP / (TP + FP || 1);
  const recall = TP / (TP + FN || 1);
  const f1 = (2 * precision * recall) / (precision + recall || 1);
  return {
    scored,
    skipped,
    TP,
    FP,
    FN,
    TN,
    precision,
    recall,
    f1,
    perType,
    fps,
    fns,
    ctaScored,
    ctaCorrect,
    ctaAccuracy: ctaCorrect / (ctaScored || 1),
    ctaMisses,
    nullScored,
    nullClean,
    noFalsePrimaryRate: nullClean / (nullScored || 1),
    nullFalse,
    perSite,
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  evalStructure({ only }).then((r) => {
    const pct = (x: number) => (x * 100).toFixed(1) + "%";
    console.log(`\n===== PAGE-STRUCTURE GROUND-TRUTH BENCHMARK =====`);
    console.log(`scored ${r.scored.length} site(s): ${r.scored.join(", ")}`);
    if (r.skipped.length)
      console.log(`skipped ${r.skipped.length} (no capture on disk): ${r.skipped.join(", ")}`);

    console.log(`\n--- SECTION-TYPE PRESENCE ---`);
    console.log(
      `PRECISION=${pct(r.precision)}  RECALL=${pct(r.recall)}  F1=${pct(r.f1)}  (TP=${r.TP} FP=${r.FP} FN=${r.FN} TN=${r.TN})`,
    );
    console.log(`per-type (tp/fp/fn):`);
    for (const t of LABELS.sectionTypes) {
      const c = r.perType[t];
      const p = c.tp + c.fp ? (c.tp / (c.tp + c.fp)) * 100 : 100;
      const rc = c.tp + c.fn ? (c.tp / (c.tp + c.fn)) * 100 : 100;
      console.log(
        `  ${t.padEnd(13)} tp=${c.tp} fp=${c.fp} fn=${c.fn}   P=${p.toFixed(0)}% R=${rc.toFixed(0)}%`,
      );
    }
    if (r.fps.length) console.log(`\nSECTION FALSE POSITIVES:\n  + ${r.fps.join("\n  + ")}`);
    if (r.fns.length) console.log(`SECTION FALSE NEGATIVES:\n  - ${r.fns.join("\n  - ")}`);

    console.log(`\n--- PRIMARY CTA ---`);
    console.log(
      `pick accuracy (sites with a real primary CTA): ${pct(r.ctaAccuracy)}  (${r.ctaCorrect}/${r.ctaScored})`,
    );
    console.log(
      `no-false-primary (sites with none): ${pct(r.noFalsePrimaryRate)}  (${r.nullClean}/${r.nullScored})`,
    );
    if (r.ctaMisses.length)
      console.log(
        `\nCTA MISSES:\n  ${r.ctaMisses.map((m) => `${m.site}: want "${m.want}" got "${m.got}"`).join("\n  ")}`,
      );
    if (r.nullFalse.length)
      console.log(
        `\nFALSE PRIMARY (page has no single CTA):\n  ${r.nullFalse.map((m) => `${m.site}: "${m.got}"`).join("\n  ")}`,
      );
    process.exit(0);
  });
}
