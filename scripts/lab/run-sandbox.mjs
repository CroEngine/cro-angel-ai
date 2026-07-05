#!/usr/bin/env node
// Angel Adaptive — Sandbox: preview Angel on ANY site, without installing.
//
// Mirrors a real page locally (private to us — nothing public is modified),
// injects the snippet into the MIRROR, lets the real pipeline harvest and
// decide, then drives persona bots and captures before/after screenshots:
// "this is what Angel would do on your site."
//
//   node scripts/lab/run-sandbox.mjs --url https://example.com \
//     [--shots-all out/] [--personas 4]
//
// How it stays honest and isolated:
//  - The mirror is served on localhost only; the target site is fetched once
//    like any browser/crawler would. No public copy, no real visitors.
//  - Data lands under an auto slug `sandbox--<host>` — ordinary per-site
//    isolation; never mixes with customers. Anonymous consent mode: Angel
//    adapts (that's what we preview) but stores no visitor ids or events.
//  - Any Angel tag already ON the target is stripped from the mirror so a
//    real install never double-runs.
//
// Known limits (v1): same-origin assets are proxied; third-party CDNs are
// unreachable from the lab browser, so some images/fonts may be missing.
// Heavy SPAs whose APIs live on other origins may render partially.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const TARGET = arg("url");
const SHOTS_ALL = arg("shots-all", "");
const PERSONAS = parseInt(arg("personas", "4"), 10);
const ORIGIN = arg("origin", "https://croengine.netlify.app");
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
if (!TARGET) {
  console.error("Usage: run-sandbox.mjs --url https://example.com [--shots-all out/]");
  process.exit(1);
}
const target = new URL(TARGET);
const SITE = `sandbox--${target.hostname}`;
const snippetJs = fs.readFileSync(path.join(__dirname, "..", "..", "public", "adaptive.js"));
const harvestJs = fs.readFileSync(path.join(__dirname, "..", "..", "public", "adaptive-harvest.js"));

// ---- target fetch (fetch → curl fallback) --------------------------------------
// In proxied environments node's fetch can fail TLS to some origins while curl
// (honouring HTTPS_PROXY + CA bundle) gets through — fall back per request.
const UA = "Mozilla/5.0 (AngelSandbox preview)";
const execFileP = promisify(execFile);
let tmpSeq = 0;
async function fetchTarget(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
    const body = Buffer.from(await r.arrayBuffer());
    // An intermediary transport failure (Envoy-style 5xx) is not the target's
    // answer — fall through to curl for those instead of mirroring the error.
    const relayFail = r.status >= 502 && body.subarray(0, 80).toString().includes("upstream connect error");
    if (!relayFail) return { status: r.status, type: r.headers.get("content-type") || "", body };
  } catch {
    /* fall through to curl */
  }
  const tmp = path.join(os.tmpdir(), `angel-sandbox-${process.pid}-${tmpSeq++}`);
  try {
    const { stdout } = await execFileP("curl", [
      "-sS", "-L", "--max-time", "25", "-A", UA,
      "-o", tmp, "-w", "%{http_code}\t%{content_type}", url,
    ]);
    const [code, type] = stdout.split("\t");
    return { status: parseInt(code, 10) || 502, type: type || "", body: fs.readFileSync(tmp) };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---- mirror server -----------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/__angel/adaptive.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      return res.end(snippetJs);
    }
    if (u.pathname === "/__angel/prox/adaptive-harvest.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      return res.end(harvestJs);
    }
    // Angel API traffic → production. Two ways in: the snippet honours its
    // data-endpoint (/__angel/prox/...), but the harvester always POSTs to its
    // own script ORIGIN + /api/adaptive/..., which on the mirror is us — so
    // both prefixes must forward or the harvest silently lands on the target.
    const proxPath = u.pathname.startsWith("/__angel/prox/")
      ? u.pathname.slice("/__angel/prox".length)
      : u.pathname.startsWith("/api/adaptive/")
        ? u.pathname
        : null;
    if (proxPath) {
      const body =
        req.method === "POST"
          ? await new Promise((r) => {
              const c = [];
              req.on("data", (d) => c.push(d));
              req.on("end", () => r(Buffer.concat(c)));
            })
          : undefined;
      const up = await fetch(ORIGIN + proxPath + u.search, {
        method: req.method,
        headers: { "content-type": req.headers["content-type"] || "text/plain" },
        body,
      });
      res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/json" });
      return res.end(Buffer.from(await up.arrayBuffer()));
    }

    // Everything else mirrors the target origin.
    const upstream = await fetchTarget(target.origin + u.pathname + u.search);
    if (!upstream.type.includes("text/html")) {
      res.writeHead(upstream.status, { "content-type": upstream.type });
      return res.end(upstream.body);
    }

    let html = upstream.body.toString("utf8");
    // Absolute same-origin URLs → relative, so assets flow through the mirror.
    html = html.replaceAll(target.origin, "");
    // Strip CSP metas (we serve locally and add our own script) and any REAL
    // Angel tag so an existing install never double-runs in the mirror.
    html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");
    html = html.replace(/<script[^>]*adaptive\.js[^>]*>\s*<\/script>/gi, "");
    // Inject the sandbox snippet (skippable with ?angel_off=1 for BEFORE shots).
    const api = `http://127.0.0.1:${server.address().port}/__angel/prox`;
    const tag =
      u.searchParams.get("angel_off") === "1"
        ? ""
        : `<script async src="/__angel/adaptive.js" data-site="${SITE}" data-endpoint="${api}"></script>`;
    html = html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : tag + html;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    res.writeHead(502);
    res.end(String(err));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PAGE = `http://127.0.0.1:${server.address().port}${target.pathname}`;
console.log(`[sandbox] mirroring ${TARGET} → ${PAGE} as site "${SITE}"`);

// ---- 1) harvest visit: teach Angel the page -----------------------------------
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
{
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  // Force the harvester regardless of sampling, so inventory + auto-goal +
  // labelling happen NOW rather than on a lucky visit.
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.src = "/__angel/prox/adaptive-harvest.js";
    s.setAttribute("data-site", document.querySelector("script[data-site]").getAttribute("data-site"));
    s.setAttribute("data-endpoint", document.querySelector("script[data-site]").getAttribute("data-endpoint"));
    s.setAttribute("data-force", "1");
    document.head.appendChild(s);
  });
  await page.waitForTimeout(9000); // harvest POST + ingest (incl. LLM labelling + auto-goal)
  await page.context().close();
  console.log("[sandbox] harvest visit done — inventory + auto-goal ingested");
}

// Best-effort: click away a cookie banner so the shots show the page, not the
// banner. Prefers the minimal-consent choice; anonymous-mode adaptation does
// not depend on consent, so this only affects the screenshot.
async function dismissCookieBanner(page) {
  try {
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const PREFER = /endast nödvändiga|only (necessary|essential)|neka alla|avvisa|reject all|decline/i;
      const ACCEPT = /acceptera alla|accept all|godkänn alla|tillåt alla/i;
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const pick =
        btns.find((b) => PREFER.test(b.textContent || "")) ||
        btns.find((b) => ACCEPT.test(b.textContent || ""));
      if (pick) pick.click();
    });
    await page.waitForTimeout(300);
  } catch {
    /* best-effort */
  }
}

// ---- 2) persona visits: see what Angel would do --------------------------------
const PERSONA_DEFS = [
  { name: "google-mobile", viewport: { width: 375, height: 812 }, q: "?angel_source=google" },
  { name: "direct-desktop", viewport: { width: 1366, height: 900 }, q: "" },
  { name: "linkedin-desktop", viewport: { width: 1366, height: 900 }, q: "?angel_source=linkedin" },
  { name: "newsletter-mobile", viewport: { width: 375, height: 812 }, q: "?angel_source=newsletter" },
];
const results = [];
for (let i = 0; i < Math.min(PERSONAS, PERSONA_DEFS.length); i++) {
  const p = PERSONA_DEFS[i];
  const context = await browser.newContext({ viewport: p.viewport });
  const page = await context.newPage();
  const out = { persona: p.name, applied: [] };
  try {
    if (SHOTS_ALL) fs.mkdirSync(SHOTS_ALL, { recursive: true });
    // BEFORE: the untouched page.
    await page.goto(PAGE + (p.q ? p.q + "&" : "?") + "angel_off=1", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await dismissCookieBanner(page);
    if (SHOTS_ALL) await page.screenshot({ path: path.join(SHOTS_ALL, `${p.name}-before.jpg`), type: "jpeg", quality: 60 });
    // AFTER: with Angel.
    await page.goto(PAGE + p.q, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.AngelAdaptive && window.AngelAdaptive.decision, null, { timeout: 15000 });
    out.applied = await page.evaluate(() => window.AngelAdaptive.applied || []);
    await dismissCookieBanner(page);
    // Sweep down (triggers lazy content + the sticky pill's IntersectionObserver)
    // and shoot from the top — the natural "how the landing page looks" view.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5));
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    if (SHOTS_ALL) await page.screenshot({ path: path.join(SHOTS_ALL, `${p.name}-after.jpg`), type: "jpeg", quality: 60 });
  } catch (err) {
    out.error = String(err).slice(0, 140);
  } finally {
    await context.close();
  }
  results.push(out);
  console.log(`[sandbox] ${p.name}: applied=[${out.applied.join(", ")}]${out.error ? " ERROR " + out.error : ""}`);
}
await browser.close();
server.close();

// ---- before/after gallery -------------------------------------------------------
if (SHOTS_ALL) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const cards = results
    .map((r) => {
      const chips = (r.applied.length ? r.applied : ["inga ändringar"])
        .map((a) => `<span class="chip">${esc(a)}</span>`)
        .join(" ");
      return `<section class="card">
  <header><strong>${esc(r.persona)}</strong> ${chips}${r.error ? `<span class="err">${esc(r.error)}</span>` : ""}</header>
  <div class="pair">
    <figure><figcaption>FÖRE</figcaption><img src="${esc(r.persona)}-before.jpg" alt="${esc(r.persona)} före" loading="lazy"></figure>
    <figure><figcaption>EFTER — med Angel</figcaption><img src="${esc(r.persona)}-after.jpg" alt="${esc(r.persona)} efter" loading="lazy"></figure>
  </div>
</section>`;
    })
    .join("\n");
  fs.writeFileSync(
    path.join(SHOTS_ALL, "gallery.html"),
    `<!doctype html><meta charset="utf-8"><title>Angel Sandbox — ${esc(target.hostname)}</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f5f5f4;color:#1c1917;padding:24px}
  h1{font-size:20px;margin:0 0 4px}.sub{color:#78716c;margin:0 0 20px}
  .card{background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:16px;margin:0 0 20px}
  .card header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  .chip{background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;border-radius:999px;padding:2px 10px;font-size:12px}
  .err{color:#b91c1c;font-size:12px}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  figure{margin:0}figcaption{font-size:12px;color:#78716c;margin-bottom:6px;letter-spacing:.04em}
  img{width:100%;border:1px solid #e7e5e4;border-radius:8px;display:block}
  @media(max-width:800px){.pair{grid-template-columns:1fr}}
</style>
<h1>Angel Sandbox — ${esc(target.hostname)}</h1>
<p class="sub">Speglad privat: inget installerat på riktiga sajten. Sajt-slug: ${esc(SITE)}</p>
${cards}`,
  );
  console.log(`[sandbox] gallery: ${path.join(SHOTS_ALL, "gallery.html")}`);
}

console.log(JSON.stringify({ site: SITE, target: TARGET, results }, null, 2));
