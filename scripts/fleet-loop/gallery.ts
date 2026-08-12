#!/usr/bin/env bun
// Galleriet för fullskaletestet (ägarens leverans: "Screenat så det blir
// snygga inflyttningar"): läser fleet-preview/results.json + per-sajt-
// skärmdumparna och bygger EN självbärande HTML med före/efter-par för de
// verifierade sidorna, plus ärlig statistik högst upp (fördelning, facit-
// träff, skip-orsaker). Miniatyrer renderas om via Chromium (inga externa
// bildverktyg i sandboxen) så filen håller sig långt under artefakt-taket.
//
//   bun run scripts/fleet-loop/gallery.ts [--out=fleet-preview/gallery.html]
//     [--max-pairs=24] [--thumb-width=420]

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const OUT = arg("out") ?? join("fleet-preview", "gallery.html");
const MAX_PAIRS = Number(arg("max-pairs") ?? 24);
const THUMB_W = Number(arg("thumb-width") ?? 420);
const ROOT = "fleet-preview";

interface SiteResult {
  name: string;
  url: string;
  status: string;
  verdict: string | null;
  fallback: string | null;
  planSource: string | null;
  menuSize: number | null;
  planOps: string[];
  gateReasons: string[];
  reason: string | null;
  ms: number;
  fakeTraffic: {
    goldSectionId: string;
    goldHeading: string;
    behaviorFed: boolean;
    skip: string | null;
    behaviorFollowed: boolean | null;
    planTarget: string | null;
  } | null;
}

const results = JSON.parse(readFileSync(join(ROOT, "results.json"), "utf8")) as SiteResult[];

// Miniatyrer via Chromium: ladda jpg:n i en sida, rendera <img> med fast
// bredd, skärmdumpa ELEMENTET (toppklipp — inflyttningen sker i sidtoppen,
// och en hel fullPage-remsa på 20 000px säger inget i ett galleri).
const THUMB_MAX_H = 720;
async function thumb(
  page: import("playwright-core").Page,
  jpgPath: string,
): Promise<string | null> {
  if (!existsSync(jpgPath)) return null;
  const b64 = readFileSync(jpgPath).toString("base64");
  await page.setContent(
    `<body style="margin:0"><div id="clip" style="width:${THUMB_W}px;max-height:${THUMB_MAX_H}px;overflow:hidden"><img src="data:image/jpeg;base64,${b64}" style="width:${THUMB_W}px;display:block"></div></body>`,
    { waitUntil: "load", timeout: 30_000 },
  );
  const el = page.locator("#clip");
  const shot = await el.screenshot({ type: "jpeg", quality: 55 });
  return shot.toString("base64");
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : "–");
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── statistiken (ärlig: hela fördelningen, inte bara vinsterna) ──────────────
const verified = results.filter((r) => r.status === "ok" && r.verdict === "verified");
const fed = results.filter((r) => r.fakeTraffic?.behaviorFed);
const followed = fed.filter((r) => r.fakeTraffic?.behaviorFollowed === true);
const buckets = new Map<string, number>();
for (const r of results) {
  const base = r.status === "ok" ? (r.verdict ?? "?") : r.status;
  const k = base === "verified" && r.fallback ? "verified (reserv)" : base;
  buckets.set(k, (buckets.get(k) ?? 0) + 1);
}
const skipCounts = new Map<string, number>();
for (const r of results) {
  const s = r.fakeTraffic?.skip;
  if (s) skipCounts.set(s, (skipCounts.get(s) ?? 0) + 1);
}

// Reserv-verifierade är INTE flyttens bevis (granskningsfynd 2026-08-12):
// fallback satt betyder att verify FÖRKASTADE huvudvalet och adopterade en
// reserv — skärmdumpen visar då reserven, och att bildtexta den som "flytt =
// besökarnas favorit" vore att visa fel ingrepp som facit-träff.
const isRealFollow = (r: SiteResult) =>
  r.fakeTraffic?.behaviorFollowed === true && !r.fallback;

// Urval till galleriet: äkta facit-träffar först (det ägaren vill SE),
// därefter övriga verifierade — capat, och cappen redovisas.
const gallery = [
  ...verified.filter(isRealFollow),
  ...verified.filter((r) => !isRealFollow(r)),
].slice(0, MAX_PAIRS);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: THUMB_W + 40, height: THUMB_MAX_H + 40 } });

// Skärmdumpsparet upptäcks på DISK (granskningsfynd 2026-08-12): en
// hårdkodad slug duplicerade auto-generates slug-härledning — driftade den
// blev galleriet tyst tomt. Första kompletta *-before/-after-paret gäller.
function pairFor(name: string): { before: string; after: string } | null {
  let files: string[] = [];
  try {
    files = readdirSync(join(ROOT, name));
  } catch {
    return null;
  }
  for (const bf of files.filter((f) => f.endsWith("-before.jpg")).sort()) {
    const af = bf.replace(/-before\.jpg$/, "-after.jpg");
    if (files.includes(af))
      return { before: join(ROOT, name, bf), after: join(ROOT, name, af) };
  }
  return null;
}

const cards: string[] = [];
let missingPairs = 0;
for (const r of gallery) {
  const pair = pairFor(r.name);
  const before = pair ? await thumb(page, pair.before) : null;
  const after = pair ? await thumb(page, pair.after) : null;
  if (!before || !after) {
    missingPairs++;
    continue;
  }
  const ft = r.fakeTraffic;
  const badge = isRealFollow(r)
    ? '<span class="badge ok">flytt = besökarnas favorit</span>'
    : r.fallback
      ? '<span class="badge">verifierad (reserv — flytten grindades)</span>'
      : '<span class="badge">verifierad</span>';
  cards.push(`<div class="card">
  <div class="card-head">
    <strong>${esc(r.name)}</strong> <span class="muted">${esc(r.url)}</span>
    ${badge}
  </div>
  <div class="meta">${
    ft?.behaviorFed
      ? `Fejktrafikens dolda favorit: <em>${esc(ft.goldHeading || ft.goldSectionId)}</em> · motorns val: <code>${esc(ft.planTarget ?? "–")}</code>`
      : "Utan beteendedata (prior/katalog ensam)"
  } · ${esc(r.planSource ?? "?")} · meny ${r.menuSize ?? "–"}</div>
  <div class="pair">
    <figure><figcaption>Före</figcaption><img src="data:image/jpeg;base64,${before}" width="${THUMB_W}"></figure>
    <figure><figcaption>Efter</figcaption><img src="data:image/jpeg;base64,${after}" width="${THUMB_W}"></figure>
  </div>
</div>`);
}
await browser.close();

const bucketRows = [...buckets.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${n}</td></tr>`)
  .join("");
const skipRows = [...skipCounts.entries()]
  .map(([k, n]) => `<tr><td>skip: ${esc(k)}</td><td class="num">${n}</td></tr>`)
  .join("");

const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<title>Fullskaletestet — ${results.length} sidor</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#faf9f7;color:#1c1917;padding:24px}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#78716c;font-size:13px;margin-bottom:18px}
  .stats{display:flex;gap:28px;flex-wrap:wrap;margin-bottom:8px}
  .stat{background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:14px 18px}
  .stat .n{font-size:26px;font-weight:700} .stat .l{font-size:12px;color:#78716c}
  table{border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e7e5e4;border-radius:8px;margin:10px 0}
  td{padding:4px 12px;border-top:1px solid #f0eee9} .num{text-align:right;font-variant-numeric:tabular-nums}
  .honest{font-size:12.5px;color:#78716c;max-width:860px;line-height:1.55;margin:14px 0 22px}
  .card{background:#fff;border:1px solid #e7e5e4;border-radius:14px;padding:16px;margin:0 0 22px;max-width:${2 * THUMB_W + 60}px}
  .card-head{font-size:14px;margin-bottom:2px} .muted{color:#a8a29e;font-size:12px}
  .meta{font-size:12px;color:#57534e;margin:4px 0 10px}
  .pair{display:flex;gap:16px;flex-wrap:wrap}
  figure{margin:0} figcaption{font-size:11px;color:#78716c;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
  img{border:1px solid #e7e5e4;border-radius:8px;display:block}
  .badge{background:#f5f5f4;border-radius:999px;padding:2px 9px;font-size:11px;margin-left:6px}
  .badge.ok{background:#dcfce7;color:#166534}
  code{background:#f5f5f4;padding:1px 5px;border-radius:4px;font-size:11.5px}
</style></head><body>
<h1>Fullskaletestet — hela kedjan på ${results.length} riktiga sidor</h1>
<div class="sub">Fejkad snippet-installation → syntetisk besökartrafik (dold sanning) → census → rollup → beteendesäte → katalog → DOM-probe → deterministiskt golv-val → verify i riktig Chromium → skärmdumpar.</div>
<div class="stats">
  <div class="stat"><div class="n">${results.length}</div><div class="l">sidor genom kedjan</div></div>
  <div class="stat"><div class="n">${verified.length}</div><div class="l">verifierade varianter</div></div>
  <div class="stat"><div class="n">${pct(followed.length, fed.length)}</div><div class="l">flytt = besökarnas favorit (${followed.length}/${fed.length} med säte)</div></div>
</div>
<table>${bucketRows}${skipRows}</table>
<div class="honest">ÄRLIGT LÄSSÄTT: trafiken är syntetisk (binomialbrus kring en dold per-sida-sanning), väljaren är det deterministiska golvet (ingen LLM i den här körningen — körningen är reproducerbar per frö), och "flytt = besökarnas favorit" mäter att motorn valde exakt den sektion fejktrafiken pekade ut. Verify-grindarna (LCP, överlapp, CTA-hit-test, reversibilitet) är den riktiga produktionskedjan. Galleriet visar ${cards.length} av ${verified.length} verifierade (capat${missingPairs > 0 ? `; ${missingPairs} utan komplett skärmdumpspar hoppades` : ""}), toppklippta miniatyrer — fullstora skärmdumpar ligger i fleet-preview/&lt;namn&gt;/.</div>
${cards.join("\n")}
</body></html>`;

writeFileSync(OUT, html);
console.log(
  `[gallery] ${OUT}: ${cards.length} par, ${Math.round(Buffer.byteLength(html) / 1024)} kB`,
);
