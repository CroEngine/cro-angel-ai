// Angel Adaptive — content-inventory crawl harness (validation tool).
//
// Loads a page in the local pinned Chromium, runs the SAME INVENTORY_SCRIPT the
// snippet runs in a visitor's browser, and prints the Content Inventory. Proves
// the crawl reads "all the correct stats" before we build anything that changes
// the page. READ-ONLY.
//
// Usage:
//   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1223/chrome-linux64/chrome \
//     bun run scripts/inventory-crawl.ts demo            # public/demo/index.html
//     bun run scripts/inventory-crawl.ts hubspot         # corpus/hubspot/page.mhtml
//     bun run scripts/inventory-crawl.ts path/to/page.mhtml
//   add --json to also dump the full inventory object.
import { chromium, type Page } from "playwright";
import { copyFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname, isAbsolute } from "node:path";
import { INVENTORY_SCRIPT } from "../src/adaptive/inventory-script";
import { type ContentInventory } from "../src/adaptive/inventory";

const REPO = join(dirname(new URL(import.meta.url).pathname), "..");
const wantJson = process.argv.includes("--json");
const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function resolveTarget(t: string): { path: string; label: string } | null {
  if (t === "demo") return { path: join(REPO, "public/demo/index.html"), label: "demo" };
  if (t.endsWith(".mhtml") || t.endsWith(".html")) {
    const p = isAbsolute(t) ? t : join(REPO, t);
    return existsSync(p) ? { path: p, label: basename(dirname(p)) || basename(p) } : null;
  }
  const corpus = join(REPO, "corpus", t, "page.mhtml");
  if (existsSync(corpus)) return { path: corpus, label: t };
  return null;
}

async function stable(page: Page, tries = 45) {
  let streak = 0,
    last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const u = await page.evaluate(() => location.href);
      streak = u === last ? streak + 1 : 1;
      last = u;
      if (streak >= 2) return;
    } catch {
      streak = 0;
    }
    await sleep(200);
  }
}

async function warmupScroll(page: Page) {
  try {
    await page.evaluate(() => {
      const h = document.documentElement.scrollHeight;
      for (let i = 0; i <= 8; i++) window.scrollTo(0, (h / 8) * i);
      window.scrollTo(0, 0);
    });
  } catch {
    /* context may tear down on SPA commit; best-effort */
  }
}

function printInventory(label: string, inv: ContentInventory) {
  const present = Object.keys(inv.available).filter((k) => inv.available[k]);
  const t = inv.trust;
  console.log(`\n================ ${label} ================`);
  console.log(`URL        : ${inv.url}`);
  console.log(`Title      : ${inv.page.title}`);
  console.log(`Hero       : "${inv.page.hero.headline}"`);
  if (inv.page.hero.subheadline) console.log(`             "${inv.page.hero.subheadline}"`);
  console.log(
    `Words      : ${inv.page.wordCount} · images ${inv.page.images.total} · h1/h2/h3 ${inv.page.headingCounts.h1}/${inv.page.headingCounts.h2}/${inv.page.headingCounts.h3}`,
  );
  console.log(`\nAVAILABLE CONTENT (what the pattern library could use):`);
  console.log(`  ${present.length ? present.join(", ") : "none detected"}`);
  console.log(`\nTRUST (${t.total} signals): ${JSON.stringify(t.byType)}`);
  const show = (name: string, arr: ContentInventory["trust"]["testimonials"]) => {
    if (!arr.length) return;
    console.log(`  ${name} (${arr.length}):`);
    for (const s of arr.slice(0, 4)) {
      const extra = [
        s.personName ? `${s.personName}${s.company ? " · " + s.company : ""}` : "",
        s.rating !== undefined ? `★${s.rating}` : "",
        s.reviewCount !== undefined ? `${s.reviewCount} reviews` : "",
        s.logoCount !== undefined ? `${s.logoCount} logos` : "",
        s.recognizedBrands?.length ? `[${s.recognizedBrands.slice(0, 5).join(", ")}]` : "",
      ]
        .filter(Boolean)
        .join(" ");
      console.log(`     · "${s.text.slice(0, 64)}"${extra ? "  " + extra : ""}`);
    }
  };
  show("testimonials", t.testimonials);
  show("customerLogos", t.customerLogos);
  show("ratings", t.ratings);
  show("guarantees", t.guarantees);
  show("certifications", t.certifications);
  show("securePayment", t.securePayment);
  show("socialProof", t.socialProof);
  show("pressMentions", t.pressMentions);
  show("trustedBy", t.trustedBy);
  show("reviewBadges", t.reviewBadges);

  console.log(`\nCTAs (${inv.ctas.length}):`);
  for (const c of inv.ctas.slice(0, 8)) {
    console.log(
      `  · "${c.text}"  [${c.intent}/${c.category}${c.aboveFold ? " · above-fold" : ""}]`,
    );
  }
  console.log(
    `\nSECTIONS (${inv.sections.length}, in order): ${inv.sections.map((s) => s.type).join(" → ")}`,
  );
  console.log(`  types: ${JSON.stringify(inv.sectionTypes)}`);
  console.log(`\nForms ${inv.forms.count} · signup CTA present: ${inv.forms.hasSignup}`);
  if (wantJson) console.log("\nFULL JSON:\n" + JSON.stringify(inv, null, 2));
}

(async () => {
  if (!targets.length) {
    console.error(
      "Usage: bun run scripts/inventory-crawl.ts <demo|corpusName|path.(mhtml|html)> [--json]",
    );
    process.exit(1);
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  for (const t of targets) {
    const resolved = resolveTarget(t);
    if (!resolved) {
      console.error(`\n[skip] could not resolve target "${t}"`);
      continue;
    }
    const tmp = mkdtempSync(join(tmpdir(), "inv-"));
    const ext = resolved.path.endsWith(".html") ? "index.html" : "page.mhtml";
    const tf = join(tmp, ext);
    copyFileSync(resolved.path, tf);
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
    });
    // Only allow the local file; never reach out to the network during a crawl test.
    await ctx.route("**/*", (r) =>
      r.request().url().startsWith("file://") ? r.continue() : r.abort(),
    );
    const page = await ctx.newPage();
    try {
      await page.goto(`file://${tf}`, { waitUntil: "load", timeout: 30_000 });
      await sleep(600);
      await stable(page);
      await warmupScroll(page);
      await sleep(400);
      await stable(page);
      const inv = (await page.evaluate(INVENTORY_SCRIPT)) as ContentInventory;
      printInventory(resolved.label, inv);
    } catch (e) {
      console.error(
        `\n[${resolved.label}] crawl failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`,
      );
    } finally {
      await ctx.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  await browser.close();
})();
