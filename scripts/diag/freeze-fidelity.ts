#!/usr/bin/env bun
// Fidelitetsmåttet (ägarfråga 2026-07-28: "hur vet du att den fryser
// komplett?" — svar: det ska MÄTAS, inte tyckas): rendera den FRYSTA kopian
// och jämför pixelvis mot REFERENSBILDEN som frysningen tog av live-sidan i
// samma browsersession. Blockvis jämförelse (10×10px, medelfärgsdelta) i
// Chromium-canvas — inga nya beroenden. Ut:
//   • fidelitets-% (andel block inom tolerans)
//   • topp-avvikelseregioner (y-band) så en människa ser VAR det skiljer
//   • diff-bild (röd överlagring där kopian avviker)
//
// Ärliga gränser: live-sidan animerar (karuseller, video) — en avvikelse kan
// vara legitim rörelse, så poängen är ett GOLV. Regionslistan finns för att
// skilja rörelse från förlust.
//
//   bun run scripts/diag/freeze-fidelity.ts --ref=<png> --frozen=<html> --out=<dir>

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const REF = arg("ref");
const FROZEN = arg("frozen");
const OUT = arg("out") ?? "fidelity-out";
if (!REF || !FROZEN) {
  console.error("usage: --ref=<live-referens.png> --frozen=<frozen.html> [--out=dir]");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });

// 1) Rendera frysta kopian (nätverk tillåtet — visningsläget) och skjut
//    samma yta som referensen.
const fctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const fpage = await fctx.newPage();
await fpage.setContent(readFileSync(FROZEN, "utf8"), { waitUntil: "domcontentloaded", timeout: 30_000 });
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

// 2) Blockvis jämförelse i canvas — Chromium är vår bilddekoder.
const cmp = await (async () => {
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
        return { g, c };
      };
      const A = draw(ref);
      const B = draw(froz);
      const da = A.g.getImageData(0, 0, W, H).data;
      const db = B.g.getImageData(0, 0, W, H).data;
      // Diff-bilden: frysta kopian med röda block där den avviker.
      const D = document.createElement("canvas");
      D.width = W;
      D.height = H;
      const dg = D.getContext("2d")!;
      dg.drawImage(froz, 0, 0);
      const BLOCK = 10;
      const TOL = 24; // medelkanaldelta per block — tål jpeg/antialias-brus
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
            dg.fillStyle = "rgba(220,38,38,.55)";
            dg.fillRect(bx, by, BLOCK, BLOCK);
          }
        }
      }
      // Avvikelseband: sammanhängande y-områden där >30 % av radens block avviker.
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
        badBlocks: bad,
        blocks,
        bands: bands.slice(0, 5),
        diffPng: D.toDataURL("image/png"),
      };
    },
    { refUri: toDataUri(REF), frozenUri: toDataUri(frozenShot) },
  );
  await cctx.close();
  return result;
})();
await browser.close();

writeFileSync(join(OUT, "diff.png"), Buffer.from(cmp.diffPng.split(",")[1], "base64"));
const bandsStr = cmp.bands.map((b) => `y ${b.from}–${b.to}px`).join(" · ") || "inga";
console.log(
  `[fidelity] ${cmp.fidelity}% (${cmp.blocks - cmp.badBlocks}/${cmp.blocks} block inom tolerans, yta ${cmp.width}×${cmp.height}px)`,
);
console.log(`[fidelity] största avvikelseband: ${bandsStr}`);
console.log(`[fidelity] diff-bild: ${join(OUT, "diff.png")}`);
writeFileSync(
  join(OUT, "fidelity.json"),
  JSON.stringify({ fidelity: cmp.fidelity, bands: cmp.bands, width: cmp.width, height: cmp.height }, null, 2),
);
