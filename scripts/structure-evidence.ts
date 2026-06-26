// Structure-eval EVIDENCE extractor — for honest, classifier-independent labeling.
//
//   bun run scripts/structure-evidence.ts                 # all captures in structure-eval/labels.json
//   bun run scripts/structure-evidence.ts hubspot stripe  # subset
//   bun run scripts/structure-evidence.ts --json hubspot  # raw JSON
//
// Replays each frozen capture and dumps the RAW rendered evidence a human needs
// to hand-label section presence + the primary CTA: the heading outline (h1–h3
// in document order, with y-position + above/below fold), and structural facts
// (nav/footer/form counts, the visible button/link labels above the fold). This
// reads the DOM directly — it deliberately does NOT run the sections/CTA
// classifiers, so labels derived from it are independent of the detector we grade.
import { chromium, type Browser, type Page } from "playwright";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const LABELS = JSON.parse(
  readFileSync(join(HERE, "..", "src/lib/tests/structure-eval/labels.json"), "utf8"),
) as { captures: Record<string, string> };

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

async function nodeScroll(page: Page, steps = 8, gap = 120): Promise<void> {
  for (let i = 1; i <= steps; i++) {
    await page
      .evaluate(
        ({ idx, total }) => {
          const h = document.documentElement.scrollHeight;
          window.scrollTo(0, (h / total) * idx);
        },
        { idx: i, total: steps },
      )
      .catch(() => {});
    await sleep(gap);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(200);
}

export type Evidence = {
  url: string;
  title: string;
  viewportH: number;
  headings: Array<{ level: number; text: string; y: number; fold: "above" | "below" }>;
  structure: { nav: number; footer: number; form: number };
  aboveFoldButtons: string[];
  keywordHits: Record<string, string[]>;
};

async function extract(browser: Browser, capturePath: string): Promise<Evidence> {
  const tmp = mkdtempSync(join(tmpdir(), "struct-ev-"));
  const tmpFile = join(tmp, "page.mhtml");
  copyFileSync(capturePath, tmpFile);
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  await ctx.route("**/*", (r) =>
    r.request().url().startsWith("file://") ? r.continue() : r.abort(),
  );
  const page = await ctx.newPage();
  try {
    await page.goto(`file://${tmpFile}`, { waitUntil: "load", timeout: 30_000 });
    await sleep(600);
    await waitStable(page);
    await nodeScroll(page);
    await waitStable(page);
    return await page.evaluate(() => {
      const vh = window.innerHeight;
      const clean = (s: string) => (s || "").replace(/\s+/g, " ").trim();
      const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
        .map((el) => {
          const r = el.getBoundingClientRect();
          const y = Math.round(r.top + window.scrollY);
          return {
            level: Number(el.tagName[1]),
            text: clean((el as HTMLElement).innerText).slice(0, 90),
            y,
            fold: (r.top + window.scrollY < vh ? "above" : "below") as "above" | "below",
            visible: r.width > 0 && r.height > 0,
          };
        })
        .filter((h) => h.text && h.visible)
        .map(({ visible: _v, ...rest }) => rest);

      const buttons = Array.from(
        document.querySelectorAll('button, a[href], [role="button"], input[type=submit]'),
      )
        .map((el) => {
          const r = el.getBoundingClientRect();
          const text = clean(
            (el as HTMLElement).innerText ||
              (el as HTMLInputElement).value ||
              el.getAttribute("aria-label") ||
              "",
          );
          return { text, y: r.top + window.scrollY, w: r.width, h: r.height };
        })
        .filter((b) => b.text && b.text.length <= 40 && b.y < vh && b.w >= 40 && b.h >= 20)
        .map((b) => b.text);

      const allHeadingText = headings.map((h) => h.text.toLowerCase()).join(" • ");
      const kw: Record<string, RegExp> = {
        pricing: /pric|plan|kostnad|prenum|abonnemang|\/mo|per month/,
        faq: /faq|frequently asked|frågor|questions|hjälp/,
        testimonials:
          /testimonial|kund|customer|review|omdöme|recension|what .* say|loved by|wall of/,
        features: /feature|funktion|så funkar|how it works|capabilit|what you can|everything you/,
        benefits: /benefit|fördel|varför|why /,
      };
      const keywordHits: Record<string, string[]> = {};
      for (const k of Object.keys(kw)) {
        const hits = headings.filter((h) => kw[k].test(h.text.toLowerCase())).map((h) => h.text);
        if (hits.length) keywordHits[k] = hits;
      }

      return {
        url: location.href,
        title: clean(document.title).slice(0, 100),
        viewportH: vh,
        headings,
        structure: {
          nav: document.querySelectorAll('nav, [role="navigation"]').length,
          footer: document.querySelectorAll('footer, [role="contentinfo"]').length,
          form: document.querySelectorAll("form").length,
        },
        aboveFoldButtons: Array.from(new Set(buttons)).slice(0, 24),
        keywordHits: { _allHeadings: [allHeadingText] as string[], ...keywordHits },
      };
    });
  } finally {
    await ctx.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

function printEvidence(name: string, ev: Evidence): void {
  console.log(`\n================ ${name} ================`);
  console.log(`title : ${ev.title}`);
  console.log(
    `struct: nav=${ev.structure.nav} footer=${ev.structure.footer} form=${ev.structure.form}`,
  );
  console.log(`above-fold buttons: ${ev.aboveFoldButtons.join(" | ") || "(none)"}`);
  const kw = Object.entries(ev.keywordHits).filter(([k]) => k !== "_allHeadings");
  console.log(
    `heading keyword hits: ${kw.length ? kw.map(([k, v]) => `${k}[${v.length}]`).join(" ") : "(none)"}`,
  );
  console.log("heading outline:");
  for (const h of ev.headings.slice(0, 40)) {
    console.log(
      `  ${h.fold === "above" ? "▲" : " "} h${h.level} @${String(h.y).padStart(5)}  ${h.text}`,
    );
  }
  if (ev.headings.length > 40) console.log(`  … (+${ev.headings.length - 40} more headings)`);
}

(async () => {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const only = args.filter((a) => !a.startsWith("--"));
  const names = (only.length ? only : Object.keys(LABELS.captures)).filter((n) =>
    existsSync(join(REPO_ROOT, LABELS.captures[n] || "")),
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  const out: Record<string, Evidence> = {};
  try {
    for (const name of names) {
      try {
        const ev = await extract(browser, join(REPO_ROOT, LABELS.captures[name]));
        out[name] = ev;
        if (!asJson) printEvidence(name, ev);
      } catch (e) {
        console.log(`[${name}] failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
  } finally {
    await browser.close();
  }
  if (asJson) console.log(JSON.stringify(out, null, 2));
})();
