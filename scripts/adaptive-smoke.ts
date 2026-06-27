// Angel Adaptive — bundle smoke test + live-crawl attempt.
//
//   bun run scripts/adaptive-smoke.ts                       # demo, via real <script src>
//   bun run scripts/adaptive-smoke.ts https://glutenforum.se  # live site, through the proxy
//
// Demo mode proves the BUNDLED public/adaptive.js self-runs when loaded as a
// one-line <script src> (the true install path). URL mode loads a live page and
// injects the bundle, reading back window.__angelAdaptive — the same thing that
// happens when the snippet is installed on the real site.
import { chromium, type Browser, type Page } from "playwright";
import { copyFileSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const REPO = join(dirname(new URL(import.meta.url).pathname), "..");
const BUNDLE = join(REPO, "public/adaptive.js");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = process.argv[2];

type AngelGlobal = {
  version: string;
  siteId: string | null;
  inventory: {
    url: string;
    page: { title: string; hero: { headline: string } };
    trust: { total: number; byType: Record<string, number> };
    ctas: unknown[];
    sections: unknown[];
    available: Record<string, boolean>;
  } | null;
};

async function readAngel(page: Page): Promise<AngelGlobal | null> {
  return page.evaluate(
    () => (window as unknown as { __angelAdaptive?: AngelGlobal }).__angelAdaptive ?? null,
  );
}

function report(where: string, angel: AngelGlobal | null) {
  console.log(`\n================ ${where} ================`);
  if (!angel) {
    console.log("  window.__angelAdaptive NOT found — snippet did not run.");
    return;
  }
  console.log(`  snippet version : ${angel.version}   siteId: ${angel.siteId ?? "(none)"}`);
  const inv = angel.inventory;
  if (!inv) {
    console.log("  inventory: null (extraction failed)");
    return;
  }
  const present = Object.keys(inv.available).filter((k) => inv.available[k]);
  console.log(`  url    : ${inv.url}`);
  console.log(`  title  : ${inv.page.title}`);
  console.log(`  hero   : "${inv.page.hero.headline}"`);
  console.log(`  trust  : ${inv.trust.total} signals ${JSON.stringify(inv.trust.byType)}`);
  console.log(`  ctas   : ${inv.ctas.length} · sections ${inv.sections.length}`);
  console.log(`  AVAILABLE: ${present.join(", ") || "none"}`);
}

async function demoMode(browser: Browser) {
  const tmp = mkdtempSync(join(tmpdir(), "adaptive-smoke-"));
  // Real install path: index.html references ./adaptive.js as a <script src>.
  const html = readFileSync(join(REPO, "public/demo/index.html"), "utf8").replace(
    '<script src="/adaptive.js" data-site-id="demo"></script>',
    '<script src="adaptive.js" data-site-id="demo"></script>',
  );
  writeFileSync(join(tmp, "index.html"), html);
  copyFileSync(BUNDLE, join(tmp, "adaptive.js"));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route("**/*", (r) =>
    r.request().url().startsWith("file://") ? r.continue() : r.abort(),
  );
  const page = await ctx.newPage();
  await page.goto(`file://${join(tmp, "index.html")}`, { waitUntil: "load", timeout: 30_000 });
  await sleep(2000); // snippet waits for content to settle, then crawls
  report("demo (loaded via real <script src>)", await readAngel(page));
  await ctx.close();
  rmSync(tmp, { recursive: true, force: true });
}

async function spaMode(browser: Browser) {
  // Empty shell that mounts content 1.5s after load — mimics a React/Vue SPA like
  // glutenforum.se. A snippet that crawled at DOMContentLoaded would see nothing;
  // the SPA-aware snippet must wait, then read the injected content.
  const tmp = mkdtempSync(join(tmpdir(), "adaptive-spa-"));
  const content =
    `<section><h1>Spa Co — adapt every visit</h1>` +
    `<p>Join 8,000+ teams shipping faster with Spa Co.</p>` +
    `<a href="/signup">Start free trial</a></section>` +
    `<blockquote><p>"The best decision we made all year."</p>` +
    `<cite>Ada Byron, CTO at Difference Engine</cite></blockquote>` +
    `<section><p>30-day money-back guarantee · GDPR compliant · Rated 4.9 out of 5</p></section>`;
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SPA Co</title></head>` +
    `<body><div id="root"></div>` +
    `<script>setTimeout(function(){document.getElementById('root').innerHTML = ${JSON.stringify(content)};}, 1500);</script>` +
    `<script src="adaptive.js" data-site-id="spa-demo"></script></body></html>`;
  writeFileSync(join(tmp, "index.html"), html);
  copyFileSync(BUNDLE, join(tmp, "adaptive.js"));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route("**/*", (r) =>
    r.request().url().startsWith("file://") ? r.continue() : r.abort(),
  );
  const page = await ctx.newPage();
  await page.goto(`file://${join(tmp, "index.html")}`, { waitUntil: "load", timeout: 30_000 });
  await sleep(4000); // content at 1.5s + settle ~0.6s → crawl ~2.1s
  report("SPA simulation (content injected 1.5s after load)", await readAngel(page));
  await ctx.close();
  rmSync(tmp, { recursive: true, force: true });
}

async function urlMode(browser: Browser, url: string) {
  const bundle = readFileSync(BUNDLE, "utf8");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await sleep(1500);
    try {
      await page.evaluate(() => {
        const h = document.documentElement.scrollHeight;
        for (let i = 0; i <= 8; i++) window.scrollTo(0, (h / 8) * i);
        window.scrollTo(0, 0);
      });
    } catch {
      /* best-effort */
    }
    await sleep(600);
    // Inject the bundle exactly as the installed <script> would. It self-runs.
    await page.addScriptTag({ content: bundle });
    await sleep(500);
    report(`live: ${url}`, await readAngel(page));
  } catch (e) {
    console.log(`\n================ live: ${url} ================`);
    console.log(
      `  could not load through the sandbox proxy: ${e instanceof Error ? e.message.split("\n")[0] : e}`,
    );
    console.log(
      "  (a live render from this environment isn't required — the bundle is ready to install.)",
    );
  } finally {
    await ctx.close();
  }
}

(async () => {
  const launch: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  };
  // Route a live crawl through the session's egress proxy (the browser NSS store
  // is pre-configured to trust its CA, per /root/.ccr/README.md).
  if (arg && process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY };
  const browser = await chromium.launch(launch);
  if (arg === "spa") await spaMode(browser);
  else if (arg) await urlMode(browser, arg);
  else await demoMode(browser);
  await browser.close();
})();
