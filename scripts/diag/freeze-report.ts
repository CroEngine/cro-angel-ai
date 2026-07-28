#!/usr/bin/env bun
// Sida-vid-sida-RAPPORTEN (ägarens beställning 2026-07-28 kväll): för varje
// sajt ställs LIVE-referensen (det browsern själv såg i frys-sessionen) mot
// den FRYSTA kopians rendering, med avvikelseband inringade och trippel-
// verifieringens siffror under — mediemåttet, pixel-banden, innehålls-
// pariteten. By-design-skillnader (video→poster, iframes, CMP borttagen,
// frusna animationer) särredovisas från verkliga brister.
//
// Läser LOKALA filer (hämtade med curl från evidens-bucketen):
//   <dir>/<site>-ref.png        live-referens (fullhöjd)
//   <dir>/<site>-fullpage.jpg   fryst kopia (cappad 4000px)
//   <dir>/<site>-fidelity.json  utökade kompletthetsmåttet (+ ev. bands)
//   <dir>/<site>-parity.json    innehållspariteten
// Saknade filer ⇒ sajten rapporteras som misslyckad körning, aldrig döljs.
//
// Bilderna beskärs till första CROP_H css-px och skalas till W_OUT px bredd
// i LOKAL Chromium via data-URI:er (nätfritt) — rapporten är självbärande.
//
//   bun run scripts/diag/freeze-report.ts --dir=<nedladdat> --sites=a,b,c \
//     --out=report.html [--title="..."]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const DIR = arg("dir");
const SITES = (arg("sites") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = arg("out") ?? "freeze-report.html";
const TITLE = arg("title") ?? "Frysningen mot verkligheten — sida vid sida";
if (!DIR || SITES.length === 0) {
  console.error("usage: --dir=<nedladdade filer> --sites=a,b,c --out=report.html");
  process.exit(2);
}

const CROP_H = 2400; // css-px av sidtoppen som visas sida-vid-sida
const W_OUT = 320; // utbredd per kolumn — 2 kolumner + marginal ryms i rapporten

interface Fidelity {
  mediaCompleteness: number;
  mediaCompletenessOnline: number;
  mediaPainted: number;
  mediaTotal: number;
  playersPainted: number;
  players: number;
  blanks: Array<{ src: string; w: number; h: number }>;
  bgCompleteness?: number;
  bgPainted?: number;
  bgTotal?: number;
  fontsLoaded?: number;
  fontsFailed?: number;
  failedFonts?: string[];
  iframes?: number;
  overallCompleteness?: number;
  overallCompletenessOnline?: number;
  errorPage?: boolean;
  title?: string;
  pixelFidelity?: number;
  bands?: Array<{ from: number; to: number }>;
  height?: number;
}
interface Parity {
  skipped?: boolean;
  headingsFound?: number;
  headingsTotal?: number;
  headingsRecall?: number;
  missingHeadings?: string[];
  textRatio?: number;
  textCharsLive?: number;
  textCharsFrozen?: number;
  linksLive?: number;
  linksFrozen?: number;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const page = await (await browser.newContext({ viewport: { width: 500, height: 600 } })).newPage();

/** Beskär till första CROP_H css-px, skala till W_OUT — jpeg-data-URI + mått. */
async function shrink(path: string): Promise<{ uri: string; w: number; h: number; fullH: number } | null> {
  if (!existsSync(path)) return null;
  const b64 = readFileSync(path).toString("base64");
  const type = path.endsWith(".png") ? "image/png" : "image/jpeg";
  try {
    return (await page.evaluate(
      async ({ src, cropH, wOut }: { src: string; cropH: number; wOut: number }) => {
        const im = await new Promise<HTMLImageElement>((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = src;
        });
        const cropPx = Math.min(im.height, Math.round((cropH / 390) * im.width)); // css→bildpixlar via bredden
        const scale = wOut / im.width;
        const c = document.createElement("canvas");
        c.width = wOut;
        c.height = Math.max(2, Math.round(cropPx * scale));
        const g = c.getContext("2d")!;
        g.drawImage(im, 0, 0, im.width, cropPx, 0, 0, c.width, c.height);
        return { uri: c.toDataURL("image/jpeg", 0.55), w: c.width, h: c.height, fullH: im.height };
      },
      { src: `data:${type};base64,${b64}`, cropH: CROP_H, wOut: W_OUT },
    )) as { uri: string; w: number; h: number; fullH: number };
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const BUCKET = "https://upvthvbhqzqqimsyjpxw.supabase.co/storage/v1/object/public/angel-evidence/preview/_diag/freeze-test";

let body = "";
const summary: Array<{ site: string; overall: number | null; online: number | null; recall: number | null; ratio: number | null; verdict: string }> = [];

for (const site of SITES) {
  const fid = existsSync(join(DIR, `${site}-fidelity.json`))
    ? (JSON.parse(readFileSync(join(DIR, `${site}-fidelity.json`), "utf8")) as Fidelity)
    : null;
  const par = existsSync(join(DIR, `${site}-parity.json`))
    ? (JSON.parse(readFileSync(join(DIR, `${site}-parity.json`), "utf8")) as Parity)
    : null;
  const ref = await shrink(join(DIR, `${site}-ref.png`));
  const froz = await shrink(join(DIR, `${site}-fullpage.jpg`));

  if (!fid || !froz) {
    summary.push({ site, overall: null, online: null, recall: null, ratio: null, verdict: "körning misslyckades" });
    body += `<section class="site fail" id="${site}"><h2>${esc(site)}</h2><p class="verdict bad">Körningen gav inga mätbara artefakter — redovisas som misslyckad, inte gömd.</p></section>`;
    continue;
  }

  const overall = fid.overallCompleteness ?? fid.mediaCompleteness;
  const online = fid.overallCompletenessOnline ?? fid.mediaCompletenessOnline;
  const recall = par && !par.skipped ? (par.headingsRecall ?? null) : null;
  const ratio = par && !par.skipped ? (par.textRatio ?? null) : null;

  // Ringar: pixel-band inom beskärningen ritas som röda ramar; djupare band
  // räknas och redovisas i text. Bandens y ligger i jämförelserymden (topp-
  // linjerad mot båda bilderna, samma pixelskala som originalen) — mappas
  // till procent av det beskurna utsnittet, vars höjd i originalpixlar är
  // (CROP_H/390) × originalbredden (390 = css-viewportens bredd).
  const ringBoxes = (img: { w: number; h: number; fullH: number }, bands?: Array<{ from: number; to: number }>) => {
    if (!bands?.length) return { html: "", deeper: 0 };
    const origW = (img.fullH / img.h) * img.w; // ≈ originalbredd i px
    const cropOrig = (CROP_H / 390) * origW; // beskärningens höjd i originalpixlar
    let html = "";
    let deeper = 0;
    for (const b of bands) {
      if (b.from >= cropOrig) {
        deeper++;
        continue;
      }
      const top = (b.from / cropOrig) * 100;
      const hPct = Math.max(1.2, ((Math.min(b.to, cropOrig) - b.from) / cropOrig) * 100);
      html += `<div class="ring" style="top:${top.toFixed(2)}%;height:${hPct.toFixed(2)}%"></div>`;
    }
    return { html, deeper };
  };
  const fr = ringBoxes(froz, fid.bands);
  const rr = ref ? ringBoxes(ref, fid.bands) : { html: "", deeper: 0 };

  const byDesign: string[] = [];
  if ((fid.players ?? 0) > 0) byDesign.push(`${fid.players} video${fid.players === 1 ? "" : "r"} visas som stillbild (poster) — fryst kopia spelar aldrig`);
  if ((fid.iframes ?? 0) > 0) byDesign.push(`${fid.iframes} inbäddad${fid.iframes === 1 ? "" : "e"} yta/ytor (iframe) är tomma offline — geometrin bevarad`);
  byDesign.push("cookie-/samtyckesdialog avfärdad eller bortrensad medvetet");
  byDesign.push("animationer och karuseller frusna vid fångstögonblicket — live-bilden kan visa annat läge av samma innehåll");

  const issues: string[] = [];
  if ((fid.mediaTotal ?? 0) - (fid.mediaPainted ?? 0) > 0)
    issues.push(`${fid.mediaTotal - fid.mediaPainted} av ${fid.mediaTotal} media-element målar inte offline${(fid.mediaCompletenessOnline ?? 0) > (fid.mediaCompleteness ?? 0) ? " (målar med nätverk — inbakningen släpar, inte fångsten)" : ""}`);
  if (fid.fontsFailed) issues.push(`${fid.fontsFailed} typsnitt föll (${(fid.failedFonts ?? []).join(", ")}) — reservtypsnitt visar texten`);
  if (par && !par.skipped && (par.missingHeadings?.length ?? 0) > 0)
    issues.push(`rubriker som inte återfanns: ${par.missingHeadings!.map((m) => `"${m}"`).join(" · ")}`);
  if (fid.errorPage) issues.push("FELSIDE-VAKT: kopian ser ut som en felsida — övriga siffror mäter fel innehåll");

  const good =
    (overall ?? 0) >= 97 && (ratio == null || ratio >= 0.95) && !fid.errorPage
      ? "good"
      : (overall ?? 0) >= 85 && !fid.errorPage
        ? "mid"
        : "bad";
  summary.push({ site, overall: overall ?? null, online: online ?? null, recall, ratio, verdict: good });

  body += `
<section class="site" id="${site}">
  <h2>${esc(site)} <span class="chip ${good}">${overall}% offline · ${online}% online</span></h2>
  <p class="meta">${esc(fid.title ?? "")}</p>
  <div class="pair">
    <figure>
      <figcaption>LIVE — det browsern såg i frys-sessionen</figcaption>
      <div class="imgwrap">${ref ? `<img src="${ref.uri}" alt="live ${esc(site)}">${rr.html}` : `<p class="missing">referensbild saknas (statisk hämtväg)</p>`}</div>
    </figure>
    <figure>
      <figcaption>FRYST KOPIA — offline-rendering</figcaption>
      <div class="imgwrap"><img src="${froz.uri}" alt="fryst ${esc(site)}">${fr.html}</div>
    </figure>
  </div>
  ${fr.deeper > 0 ? `<p class="note">+ ${fr.deeper} avvikelseband nedanför utsnittet (${CROP_H} px) — se fullbilder via länkarna.</p>` : ""}
  <div class="cols">
    <div><h3>Stämmer</h3><ul>
      <li>Media: ${fid.mediaPainted}/${fid.mediaTotal} målar offline (${fid.mediaCompleteness}%)${fid.bgTotal ? ` · bakgrunder ${fid.bgPainted}/${fid.bgTotal}` : ""}</li>
      ${fid.fontsLoaded ? `<li>Typsnitt: ${fid.fontsLoaded} laddade offline</li>` : ""}
      ${par && !par.skipped ? `<li>Rubriker: ${par.headingsFound}/${par.headingsTotal} återfinns (${par.headingsRecall}%) · text-kvot ${par.textRatio}</li>` : "<li>Paritet: hoppad (statisk väg)</li>"}
      ${(fid.playersPainted ?? 0) > 0 ? `<li>${fid.playersPainted}/${fid.players} videospelare bär fångad poster-ruta</li>` : ""}
    </ul></div>
    <div><h3>Skiljer — verkliga brister</h3>${issues.length ? `<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "<p>Inga utöver by-design nedan.</p>"}</div>
    <div><h3>Skiljer — by design</h3><ul>${byDesign.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>
  </div>
  <p class="links">Fullbilder: <a href="${BUCKET}/${site}/ref.png">live</a> · <a href="${BUCKET}/${site}/fullpage.jpg">fryst</a> · <a href="${BUCKET}/${site}/diff.png">diff-karta</a> · <a href="${BUCKET}/${site}/fidelity.json">mätdata</a></p>
</section>`;
}

const rows = summary
  .map((s) => {
    const cls = s.overall == null ? "bad" : s.verdict === "körning misslyckades" ? "bad" : s.verdict;
    return `<tr class="${cls}"><td><a href="#${s.site}">${esc(s.site)}</a></td><td>${s.overall ?? "—"}</td><td>${s.online ?? "—"}</td><td>${s.recall ?? "—"}</td><td>${s.ratio ?? "—"}</td></tr>`;
  })
  .join("");
const okAll = summary.filter((s) => s.overall != null).map((s) => s.overall as number);
const median = okAll.length ? okAll.sort((a, b) => a - b)[Math.floor(okAll.length / 2)] : 0;

const html = `<title>${esc(TITLE)}</title>
<style>
  :root { --ok:#15803d; --mid:#b45309; --bad:#b91c1c; --line:#8884; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 880px; padding: 20px; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; margin: 2.2em 0 .2em; }
  h3 { font-size: .95rem; margin: .4em 0 .2em; }
  .chip { font-size: .75rem; padding: .15em .6em; border-radius: 999px; color: #fff; vertical-align: middle; }
  .chip.good { background: var(--ok); } .chip.mid { background: var(--mid); } .chip.bad { background: var(--bad); }
  .meta { color: #888; margin: .1em 0 .6em; font-size: .85rem; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  figure { margin: 0; } figcaption { font-size: .75rem; color: #888; margin-bottom: 4px; }
  .imgwrap { position: relative; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .imgwrap img { display: block; width: 100%; height: auto; }
  .ring { position: absolute; left: 2%; width: 96%; border: 2.5px solid #e11d48; border-radius: 10px; box-shadow: 0 0 0 2px #e11d4833; pointer-events: none; }
  .cols { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-top: .7em; }
  .cols ul { margin: .2em 0; padding-left: 1.1em; } .cols li { margin: .18em 0; font-size: .85rem; }
  .note, .links { font-size: .8rem; color: #888; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .88rem; }
  th, td { text-align: left; padding: .35em .6em; border-bottom: 1px solid var(--line); }
  tr.good td:nth-child(2) { color: var(--ok); font-weight: 600; }
  tr.mid td:nth-child(2) { color: var(--mid); font-weight: 600; }
  tr.bad td:nth-child(2), tr.bad td:first-child { color: var(--bad); }
  .verdict.bad { color: var(--bad); }
  .missing { padding: 2em 1em; color: #888; font-size: .85rem; }
  @media (max-width: 640px) { .pair, .cols { grid-template-columns: 1fr; } }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #ddd; } }
</style>
<h1>${esc(TITLE)}</h1>
<p>Varje sajt: <strong>live-referensen</strong> (det browsern själv såg i frys-sessionen) bredvid <strong>den frysta kopians offline-rendering</strong>. Röda ringar = pixel-avvikelseband — de inkluderar även ofarliga skillnader (omflöde, frusna animationer, video-stillbilder), därför särredovisas <em>verkliga brister</em> och <em>by design</em> under varje par. Trippel-verifiering per sajt: mediemåttet (målar elementen?), pixel-banden (mot live) och innehållspariteten (rubriker/text).</p>
<table><thead><tr><th>sajt</th><th>total offline %</th><th>online %</th><th>rubrik-täckning %</th><th>text-kvot</th></tr></thead><tbody>${rows}</tbody></table>
<p>Median total offline: <strong>${median}%</strong> · ${okAll.length}/${SITES.length} körningar mätbara.</p>
${body}
<p class="note">Genererad ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC ur angel-evidence/preview/_diag/freeze-test/. Fryst-kopior bär färskhetsstämpel; fullbilder och rådata länkade per sajt.</p>`;

writeFileSync(OUT, html);
await browser.close();
console.log(`[report] ${OUT} (${Math.round(html.length / 1000)} kB, ${summary.length} sajter, median ${median}%)`);
