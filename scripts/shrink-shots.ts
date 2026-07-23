#!/usr/bin/env bun
// Photo-rig helper: downscale very tall full-page JPEGs (canvas in headless
// chromium) so they can be delivered/read. Temp tool, not product code.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const MAXH = 7000;

async function main() {
  const files = process.argv.slice(2);
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  const page = await browser.newPage();
  for (const f of files) {
    const b64 = readFileSync(f).toString("base64");
    const out = (await page.evaluate(
      async ({ data, maxH }) => {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${data}`;
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
        });
        const scale = Math.min(1, maxH / img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.5).split(",")[1];
      },
      { data: b64, maxH: MAXH },
    )) as string;
    const dest = f.replace(/\.jpg$/, "-sm.jpg");
    writeFileSync(dest, Buffer.from(out, "base64"));
    console.log(`${f} -> ${dest}`);
  }
  await browser.close();
}
main();
