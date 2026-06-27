// Angel Adaptive — collector contract check.
//
//   bun run scripts/collector-check.ts
//
// Verifies the snippet → collector wire: serves the demo (with a data-endpoint)
// + the bundle + a mock /collect from one origin, drives a real visit, and
// asserts the POSTs match what the Edge Function (supabase/functions/collect)
// reads — inventory once, behavior events on page-hide, both carrying a stable
// pseudonymous visitorKey + sessionId. Exits non-zero on any failure.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const REPO = join(dirname(new URL(import.meta.url).pathname), "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Body = {
  siteId?: string;
  v?: string;
  url?: string;
  visitorKey?: string;
  sessionId?: string;
  inventory?: { ctas?: unknown[]; trust?: unknown; sections?: unknown[] };
  events?: Array<{ type: string }>;
};

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const received: Body[] = [];
const bundle = readFileSync(join(REPO, "public/adaptive.js"));
const demoHtml = readFileSync(join(REPO, "public/demo/index.html"), "utf8").replace(
  '<script src="/adaptive.js" data-site-id="demo"></script>',
  '<script src="/adaptive.js" data-site-id="demo" data-endpoint="/collect"></script>',
);

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/")
      return new Response(demoHtml, { headers: { "content-type": "text/html" } });
    if (u.pathname === "/adaptive.js")
      return new Response(bundle, { headers: { "content-type": "text/javascript" } });
    if (u.pathname === "/collect") {
      if (req.method === "POST") {
        try {
          received.push((await req.json()) as Body);
        } catch {
          /* ignore */
        }
      }
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  },
});
const base = `http://localhost:${server.port}`;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(`${base}/`, { waitUntil: "load", timeout: 30_000 });
  await sleep(2500); // settle + crawl + inventory POST

  // Exercise the tracker, then flush on page-hide.
  await page.evaluate(() => {
    const h = document.documentElement.scrollHeight;
    for (let i = 0; i <= 8; i++) window.scrollTo(0, (h / 8) * i);
  });
  await sleep(200);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await sleep(400);

  const inv = received.find((r) => r.inventory);
  const evt = received.find((r) => Array.isArray(r.events) && r.events.length);

  console.log(`\nreceived ${received.length} POST(s) at /collect`);
  console.log("================ collector contract ================");
  check("inventory POST received", !!inv);
  check("  carries siteId", inv?.siteId === "demo", inv?.siteId);
  check("  carries visitorKey + sessionId", !!inv?.visitorKey && !!inv?.sessionId);
  check(
    "  inventory has CTAs",
    (inv?.inventory?.ctas?.length ?? 0) > 0,
    `${inv?.inventory?.ctas?.length} ctas`,
  );
  check("  inventory has sections", (inv?.inventory?.sections?.length ?? 0) > 0);
  check("events POST received", !!evt);
  check("  events include pageview", !!evt?.events?.some((e) => e.type === "pageview"));
  check(
    "  events include scroll_depth / time_on_page",
    !!evt?.events?.some((e) => e.type === "scroll_depth" || e.type === "time_on_page"),
  );
  check(
    "visitorKey stable across inventory + events POST",
    !!inv?.visitorKey && inv?.visitorKey === evt?.visitorKey,
  );
  check(
    "sessionId stable across inventory + events POST",
    !!inv?.sessionId && inv?.sessionId === evt?.sessionId,
  );
} finally {
  await browser.close();
  server.stop(true);
}

console.log(
  `\n${failures === 0 ? "✓ collector contract OK" : `✗ ${failures} assertion(s) failed`}`,
);
process.exit(failures === 0 ? 0 : 1);
