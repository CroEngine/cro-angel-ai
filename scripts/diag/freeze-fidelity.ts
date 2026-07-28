#!/usr/bin/env bun
// Frysningens kvalitetsmått (ägarfråga 2026-07-28: "hur vet du att den
// fryser komplett?" — svar: det MÄTS, aldrig tycks). TVÅ mått, för två
// olika frågor:
//
//   1. MEDIA-KOMPLETTHET (huvudmåttet, svaret på "fryser komplett?"):
//      den frysta kopian renderas HELT OFFLINE (alla requests blockerade,
//      exakt som grindmätningen) och varje bild-element räknas: målar den
//      pixlar (data-URI/inspelning på plats) eller är den tom/placeholder?
//      DOM-räkning = alignment-fri; texten är komplett per konstruktion
//      (den ÄR den renderade DOM:en), så bilderna är det enda som kan
//      saknas. 100 % här = självbärande kopia. Ett andra pass med nätverk
//      PÅ ger online-siffran (inbakat + länkat som svarar) — skillnaden
//      mellan dem är exakt det som fortfarande hänger på tredje part.
//
//   2. PIXEL-LIKHET mot live-referensen (valfri, diagnostik-golv): blockvis
//      jämförelse mot det browsern själv såg. LÄRDOM 2026-07-28: detta kan
//      INTE mäta kompletthet — live och fryst flödar om någon pixel i höjd
//      och allt nedanför fasförskjuts (såg ut som "saknat" fast innehållet
//      satt 150 px längre ner). Dras även ned av video-bildruta-vs-poster
//      och animation. Rapporteras som golv + gul diff-karta, inget mer.
//      Körs BARA när --ref ges — kompletthetsmåttet behöver ingen referens.
//
//   bun run scripts/diag/freeze-fidelity.ts --frozen=<html> [--ref=<png>] [--out=dir]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const REF = arg("ref");
const FROZEN = arg("frozen");
const OUT = arg("out") ?? "fidelity-out";
if (!FROZEN) {
  console.error("usage: --frozen=<frozen.html> [--ref=<live-referens.png>] [--out=dir]");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
const frozenHtml = readFileSync(FROZEN, "utf8");

interface MediaCount {
  total: number;
  painted: number;
  blanks: Array<{ painted: boolean; src: string; w: number; h: number }>;
  players: number;
  playersPainted: number;
  title: string;
  h1: string;
}

/** Rendera den frysta kopian och räkna layoutbärande media: målar eller tom.
 *  offline=true blockerar ALLA requests (självbärande-måttet); false låter
 *  länkade https-bilder svara (inbakat+länkat-måttet). */
async function countMedia(offline: boolean): Promise<MediaCount> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (offline) await ctx.route("**/*", (r) => r.abort());
  const page = await ctx.newPage();
  await page.setContent(frozenHtml, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (!offline) await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(offline ? 1_200 : 1_500);
  const res = await page.evaluate(() => {
    const rows: Array<{ painted: boolean; src: string; w: number; h: number }> = [];
    for (const img of Array.from(document.images)) {
      const r = img.getBoundingClientRect();
      // Bara bilder som TAR PLATS i layouten räknas — 0-ytor är dekor/dolda.
      if (r.width < 4 || r.height < 4) continue;
      rows.push({
        painted: img.complete && img.naturalWidth > 3,
        // 220 tecken, inte 90 (20-sajtssvepet 2026-07-28): en kapad URL kan
        // aldrig efter-probas — diagnosen probade trunkerade URL:er och fick
        // 400/404 på ALLT, vilket såg ut som "trasigt även live" fast det
        // bara var kapningen. data-URI:er förblir korta nog att kännas igen.
        src: (img.getAttribute("src") || "").slice(0, 220),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
    // Video/spelar-element: poster-bakgrund eller inbakad poster räknas som
    // målad yta; annars tom.
    let players = 0;
    let playersPainted = 0;
    for (const el of Array.from(document.querySelectorAll("video, mux-player"))) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      players++;
      const styleBg = ((el as HTMLElement).getAttribute("style") || "").includes("url(data:");
      const poster = (el.getAttribute("poster") || "").startsWith("data:");
      if (styleBg || poster) playersPainted++;
    }
    return {
      rows,
      players,
      playersPainted,
      title: (document.title || "").slice(0, 120),
      h1: (document.querySelector("h1")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
    };
  });
  await ctx.close();
  return {
    total: res.rows.length + res.players,
    painted: res.rows.filter((r) => r.painted).length + res.playersPainted,
    blanks: res.rows.filter((r) => !r.painted).slice(0, 8),
    players: res.players,
    playersPainted: res.playersPainted,
    title: res.title,
    h1: res.h1,
  };
}

// ── 1) MEDIA-KOMPLETTHET: offline (självbärande) + online (inkl. länkat) ─────
const media = await countMedia(true);
const online = await countMedia(false);

// Felside-vakt (från parallellspårets kompletthetsmått): en fryst 404/bot-
// vägg kan få HÖG täckning för att den knappt har media — flagga i stället
// för att låta en tom sida se perfekt ut. (anyfin-klassen: samma tunna
// HTML-skal för varje URL.)
const ERRORISH = /\b404\b|not found|page not found|finns inte|hittades inte|kunde inte hittas|access denied|forbidden/i;
const errorPage = ERRORISH.test(media.title) || ERRORISH.test(media.h1);

const pct = (painted: number, total: number) =>
  total > 0 ? Math.round((painted / total) * 1000) / 10 : 100;
const completeness = pct(media.painted, media.total);
const completenessOnline = pct(online.painted, online.total);

console.log(
  `[fidelity] MEDIA-KOMPLETTHET (offline, självbärande): ${completeness}% — ${media.painted}/${media.total} media-element målar (${media.playersPainted}/${media.players} spelare med poster)`,
);
console.log(
  `[fidelity] media-kompletthet (nätverk på, inkl. länkat): ${completenessOnline}% — ${online.painted}/${online.total}`,
);
for (const b of media.blanks) {
  console.log(`[fidelity]   tom bild ${b.w}×${b.h}: ${b.src}`);
}
if (errorPage) {
  console.log(
    `[fidelity] VARNING: den frysta sidan ser ut som en FELSIDA (titel "${media.title}" / h1 "${media.h1}") — kompletthetssiffran ovan mäter i så fall fel innehåll`,
  );
}
if (media.total < 3) {
  console.log(
    `[fidelity] VARNING: bara ${media.total} media-element i layouten — misstänkt tunn sida (bot-vägg/skal?), granska frozen.html`,
  );
}

// ── 2) PIXEL-LIKHET (valfri): fryst med nätverk PÅ vs live-referensen ────────
let cmp: { width: number; height: number; fidelity: number; bands: Array<{ from: number; to: number }> } | null =
  null;
if (REF) {
  const fctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const fpage = await fctx.newPage();
  await fpage.setContent(frozenHtml, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await fpage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await fpage.waitForTimeout(1_500);
  const fh = await fpage.evaluate(() => document.documentElement.scrollHeight);
  const frozenShot = join(OUT, "frozen.png");
  await fpage.screenshot({
    path: frozenShot,
    type: "png",
    fullPage: true,
    clip: { x: 0, y: 0, width: 390, height: Math.min(8000, fh) },
  });
  await fctx.close();

  const cctx = await browser.newContext();
  const cpage = await cctx.newPage();
  const toDataUri = (p: string) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
  const result = await cpage.evaluate(
    async ({ refUri, frozenUri }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = rej;
          im.src = src;
        });
      const [ref, froz] = await Promise.all([load(refUri), load(frozenUri)]);
      const W = Math.min(ref.width, froz.width);
      const H = Math.min(ref.height, froz.height);
      const draw = (im: HTMLImageElement) => {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d")!;
        g.drawImage(im, 0, 0);
        return g;
      };
      const da = draw(ref).getImageData(0, 0, W, H).data;
      const db = draw(froz).getImageData(0, 0, W, H).data;
      const D = document.createElement("canvas");
      D.width = W;
      D.height = H;
      const dg = D.getContext("2d")!;
      dg.drawImage(froz, 0, 0);
      const BLOCK = 10;
      const TOL = 24;
      let blocks = 0;
      let bad = 0;
      const rowBad: number[] = new Array(Math.ceil(H / BLOCK)).fill(0);
      for (let by = 0; by < H; by += BLOCK) {
        for (let bx = 0; bx < W; bx += BLOCK) {
          let sum = 0;
          let n = 0;
          for (let y = by; y < Math.min(by + BLOCK, H); y += 2) {
            for (let x = bx; x < Math.min(bx + BLOCK, W); x += 2) {
              const i = (y * W + x) * 4;
              sum +=
                Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
              n++;
            }
          }
          blocks++;
          if (sum / (n * 3) > TOL) {
            bad++;
            rowBad[Math.floor(by / BLOCK)]++;
            dg.fillStyle = "rgba(234,179,8,.45)"; // gult = AVVIKER (inte "saknat")
            dg.fillRect(bx, by, BLOCK, BLOCK);
          }
        }
      }
      const perRow = Math.ceil(W / BLOCK);
      const bands: Array<{ from: number; to: number }> = [];
      let start = -1;
      for (let r = 0; r <= rowBad.length; r++) {
        const hot = r < rowBad.length && rowBad[r] / perRow > 0.3;
        if (hot && start < 0) start = r;
        if (!hot && start >= 0) {
          bands.push({ from: start * BLOCK, to: r * BLOCK });
          start = -1;
        }
      }
      bands.sort((a, b) => b.to - b.from - (a.to - a.from));
      return {
        width: W,
        height: H,
        fidelity: Math.round((1 - bad / Math.max(1, blocks)) * 1000) / 10,
        bands: bands.slice(0, 5),
        diffPng: D.toDataURL("image/png"),
      };
    },
    { refUri: toDataUri(REF), frozenUri: toDataUri(frozenShot) },
  );
  await cctx.close();
  writeFileSync(join(OUT, "diff.png"), Buffer.from(result.diffPng.split(",")[1], "base64"));
  cmp = { width: result.width, height: result.height, fidelity: result.fidelity, bands: result.bands };
  console.log(
    `[fidelity] pixel-likhet mot live: ${cmp.fidelity}% (diagnostik-golv — video/animation/omflöde drar ned)`,
  );
  console.log(
    `[fidelity] avvikelseband: ${cmp.bands.map((b) => `y ${b.from}–${b.to}px`).join(" · ") || "inga"}`,
  );
  console.log(`[fidelity] diff-bild (gult=avviker): ${join(OUT, "diff.png")}`);
}
await browser.close();

writeFileSync(
  join(OUT, "fidelity.json"),
  JSON.stringify(
    {
      mediaCompleteness: completeness,
      mediaCompletenessOnline: completenessOnline,
      mediaPainted: media.painted,
      mediaTotal: media.total,
      playersPainted: media.playersPainted,
      players: media.players,
      blanks: media.blanks,
      errorPage,
      title: media.title,
      ...(cmp
        ? { pixelFidelity: cmp.fidelity, bands: cmp.bands, width: cmp.width, height: cmp.height }
        : {}),
    },
    null,
    2,
  ),
);
