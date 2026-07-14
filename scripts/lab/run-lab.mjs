#!/usr/bin/env node
// Angel Adaptive — Synthetic Lab runner.
//
// Drives a fleet of persona bots against the lab site (scripts/lab/lab-site.html,
// served locally with the PRODUCTION snippet + an isolated lab slug) so the
// ENTIRE pipeline runs for real: consent-config → decide → apply → events →
// persistence → attribution. The bots react to what they SEE: when adaptations
// are visible they convert with a higher planted probability — a true causal
// effect with a known ground truth the measurement pipeline must recover.
//
//   node scripts/lab/run-lab.mjs --site angel-lab.lift --key ak_… \
//     --n 150 --p-adapted 0.35 --p-control 0.15 [--seed 42] [--shots out/]
//
// A null run (--p-adapted == --p-control) is the false-positive guard: the
// pipeline must NOT call a significant lift on it.
//
// Isolation: lab slugs are ordinary sites, so their data can never mix with
// customer sites. Determinism: per-visitor seeded PRNG — same seed, same run.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- args ---------------------------------------------------------------
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const SITE = arg("site");
const KEY = arg("key");
const N = parseInt(arg("n", "100"), 10);
const P_ADAPTED = parseFloat(arg("p-adapted", "0.35"));
const P_CONTROL = parseFloat(arg("p-control", "0.15"));
const SEED = parseInt(arg("seed", "42"), 10);
const SHOTS = arg("shots", "");
const SHOTS_ALL = arg("shots-all", ""); // screenshot EVERY visitor + build a replay gallery
const ORIGIN = arg("origin", "https://croengine.netlify.app");
const CONCURRENCY = parseInt(arg("concurrency", "5"), 10);
const CHROME =
  process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
if (!SITE || !KEY) {
  console.error("Usage: run-lab.mjs --site <slug> --key <ak_…> [--n 100] …");
  process.exit(1);
}

// ---- deterministic PRNG (delad, scripts/lab/rng.mjs) -----------------------
import { mulberry32 as rng } from "./rng.mjs";

// ---- lab page server + production proxy -------------------------------------
// The lab browser has no direct egress, so the snippet is served locally
// (byte-identical repo copy of the deployed file) and every API call goes via
// /prox/* which this server forwards to the REAL production endpoints with
// node fetch (which does have egress). The pipeline under test is production's.
const snippetJs = fs.readFileSync(path.join(__dirname, "..", "..", "public", "adaptive.js"));
const harvestJs = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "adaptive-harvest.js"),
);
const htmlTemplate = fs.readFileSync(path.join(__dirname, "lab-site.html"), "utf8");

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/adaptive.js" || u.pathname === "/prox/adaptive.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      return res.end(snippetJs);
    }
    if (u.pathname === "/prox/adaptive-harvest.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      return res.end(harvestJs);
    }
    if (u.pathname.startsWith("/prox/")) {
      const target = ORIGIN + u.pathname.slice("/prox".length) + u.search;
      const body =
        req.method === "POST"
          ? await new Promise((resolve) => {
              const chunks = [];
              req.on("data", (c) => chunks.push(c));
              req.on("end", () => resolve(Buffer.concat(chunks)));
            })
          : undefined;
      const upstream = await fetch(target, {
        method: req.method,
        headers: { "content-type": req.headers["content-type"] || "text/plain" },
        body,
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") || "application/json",
      });
      return res.end(text);
    }
    // Any path serves the lab page (pathname is irrelevant to the test).
    const api = `http://127.0.0.1:${server.address().port}/prox`;
    const html = htmlTemplate
      .replaceAll("{{SITE}}", SITE)
      .replaceAll("{{KEY}}", KEY)
      .replaceAll("{{API}}", api);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    res.writeHead(502);
    res.end(String(err));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const PAGE = `http://127.0.0.1:${PORT}/`;
console.log(`[lab] serving lab site on ${PAGE} → site=${SITE} api→${ORIGIN}`);

// ---- personas ---------------------------------------------------------------
const SOURCES = ["google", "direct", "linkedin", "newsletter"];
function persona(i) {
  return {
    device: i % 2 === 0 ? "mobile" : "desktop",
    viewport: i % 2 === 0 ? { width: 375, height: 812 } : { width: 1366, height: 900 },
    source: SOURCES[i % SOURCES.length],
    secondPageview: i % 5 === 0, // some visitors browse on (multi-page micro)
  };
}

// ---- one visitor --------------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
let shotsTaken = { adaptedMobile: false, control: false, adaptedDesktop: false };

async function visit(i) {
  const rand = rng(SEED * 100003 + i);
  const p = persona(i);
  const context = await browser.newContext({ viewport: p.viewport });
  const page = await context.newPage();
  const url = p.source === "direct" ? PAGE : `${PAGE}?angel_source=${p.source}`;
  const out = { i, device: p.device, source: p.source, holdout: null, applied: [], converted: false };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.AngelAdaptive && window.AngelAdaptive.decision, null, {
      timeout: 15000,
    });
    const state = await page.evaluate(() => ({
      holdout: !!window.AngelAdaptive.decision.holdout,
      applied: window.AngelAdaptive.applied || [],
    }));
    out.holdout = state.holdout;
    out.applied = state.applied;

    // Screenshots of what the visitor actually sees (discretion check).
    if (SHOTS) {
      const kind =
        !state.holdout && p.device === "mobile" && !shotsTaken.adaptedMobile
          ? "adaptedMobile"
          : state.holdout && !shotsTaken.control
            ? "control"
            : !state.holdout && p.device === "desktop" && !shotsTaken.adaptedDesktop
              ? "adaptedDesktop"
              : null;
      if (kind) {
        shotsTaken[kind] = true;
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${kind}.png`) });
      }
    }

    // Behave like a reader: scroll in steps (fires the scroll_depth buckets).
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5));
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.85));
    await page.waitForTimeout(250);
    if (rand() < 0.5) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
    }

    // Some visitors browse one more page (multi-page micro-conversion).
    if (p.secondPageview) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);
    }

    // The planted causal effect: seeing the adaptations raises the visitor's
    // propensity to act. Bots react to what they SEE (applied), like humans.
    const adapted = !state.holdout && state.applied.length > 0;
    const pConvert = adapted ? P_ADAPTED : P_CONTROL;
    if (rand() < pConvert) {
      await page.click("#lab-goal", { timeout: 5000 });
      out.converted = true;
      await page.waitForTimeout(700); // let the conversion beacon leave
    } else {
      await page.waitForTimeout(300);
    }

    // Replay gallery: capture how the page actually LOOKED for this bot, in
    // its final scrolled state (shows the sticky pill exactly when a human
    // would see it).
    if (SHOTS_ALL) {
      fs.mkdirSync(SHOTS_ALL, { recursive: true });
      const shot = `bot-${String(i).padStart(3, "0")}.jpg`;
      await page.screenshot({ path: path.join(SHOTS_ALL, shot), type: "jpeg", quality: 55 });
      out.shot = shot;
    }
  } catch (err) {
    out.error = String(err).slice(0, 120);
  } finally {
    await context.close();
  }
  return out;
}

// ---- fleet -----------------------------------------------------------------
const results = [];
let next = 0;
async function worker() {
  while (next < N) {
    const i = next++;
    const r = await visit(i);
    results.push(r);
    if ((results.length % 25 === 0 || r.error) && results.length !== N) {
      console.log(`[lab] ${results.length}/${N}${r.error ? ` (error on #${i}: ${r.error})` : ""}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await browser.close();
server.close();

// ---- summary -----------------------------------------------------------------
const ok = results.filter((r) => !r.error);
const adapted = ok.filter((r) => r.holdout === false);
const control = ok.filter((r) => r.holdout === true);
const conv = (arr) => arr.filter((r) => r.converted).length;
const patterns = {};
for (const r of adapted) for (const pat of r.applied) patterns[pat] = (patterns[pat] || 0) + 1;

const summary = {
  site: SITE,
  n: N,
  errors: results.length - ok.length,
  planted: { pAdapted: P_ADAPTED, pControl: P_CONTROL },
  arms: {
    adapted: { visitors: adapted.length, conversions: conv(adapted) },
    control: { visitors: control.length, conversions: conv(control) },
  },
  appliedPatterns: patterns,
};
console.log(JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(__dirname, `run-${SITE.replace(/[^a-z0-9.-]/gi, "_")}.json`),
  JSON.stringify({ summary, results }, null, 2),
);

// ---- replay gallery ----------------------------------------------------------
// One card per bot: persona, arm, what Angel applied, outcome, and the real
// screenshot — the lab's answer to the dashboard's "see it as this visitor".
if (SHOTS_ALL) {
  const esc = (v) => String(v).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);
  const cards = results
    .slice()
    .sort((a, b) => a.i - b.i)
    .map((r) => {
      const arm = r.holdout === true ? "control" : r.holdout === false ? "adapted" : "error";
      return `<div class="card ${arm}">
  <div class="head">
    <span class="mono">#${String(r.i).padStart(3, "0")}</span>
    <span class="badge ${arm}">${arm}</span>
    ${r.converted ? '<span class="badge conv">converted</span>' : ""}
  </div>
  <div class="meta">${esc(r.source)} · ${esc(r.device)}</div>
  <div class="patterns">${(r.applied || []).map((p) => `<span class="pat">${esc(p)}</span>`).join("") || '<span class="none">page untouched (control)</span>'}</div>
  ${r.shot ? `<img loading="lazy" src="${r.shot}" alt="bot ${r.i}">` : `<div class="err">${esc(r.error || "no shot")}</div>`}
</div>`;
    })
    .join("\n");
  const galleryHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Angel Lab — replay ${esc(SITE)}</title><style>
  body{margin:0;background:#fafaf9;color:#1c1917;font:14px/1.5 -apple-system,system-ui,sans-serif;padding:28px}
  h1{font-size:18px} .sub{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.05em;color:#a8a29e;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
  .card{background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:12px}
  .card.control{background:#fffdf5}
  .head{display:flex;gap:8px;align-items:center}
  .mono{font-family:ui-monospace,monospace;font-size:11px;color:#a8a29e}
  .badge{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.05em;padding:2px 8px;border-radius:6px}
  .badge.adapted{background:#ecfdf5;color:#065f46}.badge.control{background:#fef3c7;color:#92400e}.badge.conv{background:#047857;color:#fff}
  .meta{margin-top:4px;color:#78716c;font-size:12px}
  .patterns{margin:6px 0}.pat{display:inline-block;margin:2px 4px 2px 0;padding:2px 7px;border-radius:6px;background:#f5f5f4;font-family:ui-monospace,monospace;font-size:10px;color:#44403c}
  .none{font-size:11px;color:#a8a29e;font-style:italic}
  img{width:100%;border:1px solid #e7e5e4;border-radius:6px;margin-top:6px}
  .err{color:#b91c1c;font-size:11px;font-family:ui-monospace,monospace}
  </style></head><body>
  <h1>✳ Angel Lab — replay</h1>
  <div class="sub">[ ${esc(SITE)} · n=${results.length} · adapted ${summary.arms.adapted.visitors} (${summary.arms.adapted.conversions} conv) · control ${summary.arms.control.visitors} (${summary.arms.control.conversions} conv) · planted p=${P_ADAPTED}/${P_CONTROL} ]</div>
  <div class="grid">${cards}</div></body></html>`;
  fs.writeFileSync(path.join(SHOTS_ALL, "gallery.html"), galleryHtml);
  console.log(`[lab] replay gallery → ${path.join(SHOTS_ALL, "gallery.html")}`);
}
