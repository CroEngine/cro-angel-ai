#!/usr/bin/env bun
// Sandlådan (ägarens fråga 2026-08-12: "Visa det i en sandbox typ så vi
// faktiskt ser vad som skett med head menyn osv"): full före/efter sida-vid-
// sida per verifierad sajt — HELA remsorna, inte galleriets toppklipp — med
// automatiskt beräknade FÖRÄNDRINGSBAND (pixel-diff per rad via Chromium-
// canvas) och en explicit topp-bandsdetektor: skiljer sig sidhuvudsområdet
// (0–140 px) är headern sannolikt flyttad/ändrad — exakt felklassen ägaren
// hittade på calm, som grindkedjan (LCP/överlapp/CTA/rubrikordning) inte ser.
//
//   bun run scripts/fleet-loop/sandbox.ts [--sites=calm,intercom,...]
//     [--out=fleet-preview/sandbox.html] [--max-bytes=11000000]

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const OUT = arg("out") ?? join("fleet-preview", "sandbox.html");
const MAX_BYTES = Number(arg("max-bytes") ?? 11_000_000);
const ROOT = "fleet-preview";
const HEADER_BAND_PX = 140;

interface SiteResult {
  name: string;
  url: string;
  status: string;
  verdict: string | null;
  fallback: string | null;
  planOps: string[];
  fakeTraffic: {
    goldSectionId: string;
    goldHeading: string;
    behaviorFed: boolean;
    behaviorFollowed: boolean | null;
    planTarget: string | null;
  } | null;
}

const results = JSON.parse(readFileSync(join(ROOT, "results.json"), "utf8")) as SiteResult[];
const verified = results.filter((r) => r.status === "ok" && r.verdict === "verified");

// Urval: uttryckligt via --sites, annars facit-träffarna (utan reserv) —
// budgeten (artefakt-taket) klipper svansen och klippet redovisas.
const wanted = arg("sites")?.split(",").filter(Boolean);
const pool = wanted
  ? verified.filter((r) => wanted.includes(r.name))
  : verified.filter((r) => r.fakeTraffic?.behaviorFollowed === true && !r.fallback);

function pairFor(name: string): { before: string; after: string } | null {
  let files: string[] = [];
  try {
    files = readdirSync(join(ROOT, name));
  } catch {
    return null;
  }
  for (const bf of files.filter((f) => f.endsWith("-before.jpg")).sort()) {
    const af = bf.replace(/-before\.jpg$/, "-after.jpg");
    if (files.includes(af)) return { before: join(ROOT, name, bf), after: join(ROOT, name, af) };
  }
  return null;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── raddiff i Chromium (inga bildbibliotek i sandlådan) ──────────────────────
interface DiffBand {
  top: number;
  bottom: number;
}
interface SiteDiff {
  bands: DiffBand[];
  headerChanged: boolean;
  heightBefore: number;
  heightAfter: number;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const page = await browser.newPage();

async function rowDiff(beforeB64: string, afterB64: string): Promise<SiteDiff> {
  return await page.evaluate(
    async ({ b, a, headerPx }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });
      const [ib, ia] = await Promise.all([
        load(`data:image/jpeg;base64,${b}`),
        load(`data:image/jpeg;base64,${a}`),
      ]);
      const w = Math.min(ib.naturalWidth, ia.naturalWidth);
      const h = Math.min(ib.naturalHeight, ia.naturalHeight);
      const draw = (img: HTMLImageElement) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const db = draw(ib);
      const da = draw(ia);
      // Radmedeldiff (RGB), samplad var 2:a rad/4:e kolumn — jpeg-brus under
      // tröskeln, äkta layoutskillnader långt över den.
      const ROW_STEP = 2;
      const COL_STEP = 4;
      const THRESHOLD = 9;
      const hot: number[] = [];
      for (let y = 0; y < h; y += ROW_STEP) {
        let sum = 0;
        let n = 0;
        for (let x = 0; x < w; x += COL_STEP) {
          const i = (y * w + x) * 4;
          sum +=
            Math.abs(db[i] - da[i]) +
            Math.abs(db[i + 1] - da[i + 1]) +
            Math.abs(db[i + 2] - da[i + 2]);
          n += 3;
        }
        if (sum / n > THRESHOLD) hot.push(y);
      }
      // Band: slå ihop närliggande heta rader (<90 px gap), släng mikroband.
      const bands: { top: number; bottom: number }[] = [];
      for (const y of hot) {
        const last = bands[bands.length - 1];
        if (last && y - last.bottom < 90) last.bottom = y;
        else bands.push({ top: y, bottom: y });
      }
      const real = bands.filter((bd) => bd.bottom - bd.top >= 14);
      return {
        bands: real,
        headerChanged: real.some((bd) => bd.top < headerPx),
        heightBefore: ib.naturalHeight,
        heightAfter: ia.naturalHeight,
      };
    },
    { b: beforeB64, a: afterB64, headerPx: HEADER_BAND_PX },
  );
}

// ── bygg sajtblocken inom bytesbudgeten ──────────────────────────────────────
interface Card {
  html: string;
  headerChanged: boolean;
  name: string;
  bands: number;
}
const cards: Card[] = [];
let spent = 0;
let dropped = 0;
const headerFlags: { name: string; bands: number; headerChanged: boolean }[] = [];

for (const r of pool) {
  const pair = pairFor(r.name);
  if (!pair) continue;
  const b64b = readFileSync(pair.before).toString("base64");
  const b64a = readFileSync(pair.after).toString("base64");
  const diff = await rowDiff(b64b, b64a);
  headerFlags.push({ name: r.name, bands: diff.bands.length, headerChanged: diff.headerChanged });
  const cost = b64b.length + b64a.length;
  if (spent + cost > MAX_BYTES) {
    dropped++;
    continue;
  }
  spent += cost;
  const ft = r.fakeTraffic;
  const bandButtons = diff.bands
    .slice(0, 6)
    .map(
      (bd, i) =>
        `<button class="jump" data-site="${esc(r.name)}" data-y="${bd.top}">förändring ${i + 1} · ${bd.top}px</button>`,
    )
    .join(" ");
  const overlays = diff.bands
    .slice(0, 12)
    .map(
      (bd) =>
        `<div class="band" style="top:${bd.top}px;height:${Math.max(18, bd.bottom - bd.top)}px"></div>`,
    )
    .join("");
  cards.push({
    name: r.name,
    headerChanged: diff.headerChanged,
    bands: diff.bands.length,
    html: `<section class="site" id="site-${esc(r.name)}">
  <div class="bar">
    <strong>${esc(r.name)}</strong> <span class="muted">${esc(r.url)}</span>
    ${diff.headerChanged ? '<span class="flag">⚠ sidhuvudsområdet ändrat</span>' : ""}
    <span class="meta">guld: <em>${esc(ft?.goldHeading || ft?.goldSectionId || "–")}</em> · val: <code>${esc(ft?.planTarget ?? "–")}</code> · ${diff.bands.length} förändringsband</span>
    <span class="jumps">${bandButtons}</span>
  </div>
  <div class="pair">
    <div class="col"><div class="collabel">Före</div><div class="strip"><img loading="lazy" src="data:image/jpeg;base64,${b64b}" width="390">${overlays}</div></div>
    <div class="col"><div class="collabel">Efter</div><div class="strip"><img loading="lazy" src="data:image/jpeg;base64,${b64a}" width="390">${overlays}</div></div>
  </div>
</section>`,
  });
}
await browser.close();

// Sajter med header-flagga FÖRST — det är felklassen ägaren ska granska.
cards.sort((x, y) => Number(y.headerChanged) - Number(x.headerChanged));

const flagged = headerFlags.filter((f) => f.headerChanged);
const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<title>Sandlådan — före/efter i full längd</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#f6f5f2;color:#1c1917;padding:20px}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#78716c;font-size:13px;max-width:860px;line-height:1.5;margin-bottom:14px}
  .warn{background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:10px 14px;font-size:13px;max-width:860px;margin-bottom:18px;line-height:1.5}
  .site{background:#fff;border:1px solid #e7e5e4;border-radius:14px;margin:0 0 26px;overflow:hidden}
  .bar{position:sticky;top:0;background:#fff;border-bottom:1px solid #e7e5e4;padding:10px 14px;font-size:13px;z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .muted{color:#a8a29e;font-size:12px} .meta{color:#57534e;font-size:12px}
  .flag{background:#fee2e2;color:#991b1b;border-radius:999px;padding:2px 10px;font-size:11.5px;font-weight:600}
  .jump{border:1px solid #d6d3d1;background:#fafaf9;border-radius:999px;padding:2px 10px;font-size:11.5px;cursor:pointer}
  .jump:hover{background:#f5f5f4}
  .pair{display:flex;gap:14px;padding:14px;overflow-x:auto}
  .col{flex:0 0 auto} .collabel{font-size:11px;color:#78716c;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
  .strip{position:relative;border:1px solid #e7e5e4;border-radius:8px;overflow:hidden;width:390px}
  .strip img{display:block}
  .band{position:absolute;left:0;right:0;background:rgba(244,63,94,.14);border-top:2px solid rgba(244,63,94,.75);border-bottom:2px solid rgba(244,63,94,.4);pointer-events:none}
  code{background:#f5f5f4;padding:1px 5px;border-radius:4px;font-size:11px}
</style></head><body>
<h1>Sandlådan — hela sidan, före och efter, sida vid sida</h1>
<div class="sub">Fulla skärmremsor (inte galleriets toppklipp). Röda band = rader där bilderna faktiskt skiljer sig (pixel-diff, jpeg-brus bortfiltrerat). Knapparna hoppar till respektive förändring. Sajter där <strong>sidhuvudsområdet</strong> (översta ${HEADER_BAND_PX} px) ändrats ligger först och flaggas rött — den felklassen ska aldrig passera tyst.</div>
${
  flagged.length > 0
    ? `<div class="warn"><strong>⚠ ${flagged.length} av ${headerFlags.length} granskade sajter har ett ändrat sidhuvudsområde:</strong> ${flagged.map((f) => f.name).join(", ")}. På dessa har appliceringen sannolikt påverkat headern (calm-klassen: headern hamnade sist på sidan). Grindkedjan mäter LCP/överlapp/CTA/rubrikordning — ingen grind kräver i dag att headern förblir först. Åtgärdsförslag ligger i rapporten i chatten.</div>`
    : ""
}
${cards.map((c) => c.html).join("\n")}
${dropped > 0 ? `<div class="sub">${dropped} sajter rymdes inte i artefaktbudgeten — regenerera med --sites=namn för att granska en specifik sajt.</div>` : ""}
<script>
document.addEventListener("click", (e) => {
  const t = e.target.closest(".jump");
  if (!t) return;
  const site = document.getElementById("site-" + t.dataset.site);
  const strip = site.querySelector(".strip");
  const y = strip.getBoundingClientRect().top + window.scrollY + Number(t.dataset.y) - 160;
  window.scrollTo({ top: y, behavior: "smooth" });
});
</script>
</body></html>`;

writeFileSync(OUT, html);
console.log(`[sandbox] ${OUT}: ${cards.length} sajter, ${Math.round(Buffer.byteLength(html) / 1e6)} MB${dropped ? `, ${dropped} klipptes (budget)` : ""}`);
console.log(`[sandbox] header-flaggade: ${flagged.length}/${headerFlags.length} — ${flagged.map((f) => f.name).join(", ") || "inga"}`);
