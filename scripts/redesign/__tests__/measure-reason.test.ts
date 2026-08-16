// UPPLÖSNINGENS ORSAKSRAD (granskningsfynd 2026-08-15). Nattloopen loggade
// förut bara ATT upplösningen vägrade — inte vilken av grenarna. En cell som
// föll varje natt gick därför inte att åtgärda ur körningen: det krävde att
// någon laddade ned nattens artefakter och återskapade läget för hand.
//
// Skillnaden orsaken gör är operativ, inte kosmetisk:
//   "hittar inte lokatorn …"       ⇒ den frysta kopian saknar innehållet
//                                     (frysningsproblem — SPA, WAF, timeout)
//   "ingen ren sektionsnivå …"     ⇒ sidans STRUKTUR bär ingen flyttbar
//                                     sektion (kandidaten var aldrig laglig)
// Två helt olika åtgärder. Testet låser att raden faktiskt pekar ut rätt gren,
// mot riktig Chromium — en orsak som tyst blir "okänd gren" är värdelös.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";

import { runGatedAttempts } from "../measure";

let browser: Browser | null = null;
beforeAll(async () => {
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    });
  } catch {
    browser = null;
  }
});

/** Två parallella sektioner under <main> — den kanoniska formen sectionOf
 *  letar efter: en förfader med EXAKT en rubrik som har rubrikbärande syskon. */
const REN = `<!doctype html><html><head><meta charset="utf-8"><style>
section{padding:24px;min-height:200px}</style></head><body><main>
<section><h1>Kom igång i dag</h1><p>${"Hjältetext. ".repeat(20)}</p></section>
<section><h2>Vad kunderna säger</h2><p>${"Omdöme. ".repeat(30)}</p></section>
<section><h2>Enkla priser</h2><p>${"Pris. ".repeat(30)}</p></section>
</main></body></html>`;

/** ALLA rubriker i EN och samma container, utan rubrikbärande syskon — ingen
 *  nivå uppfyller sectionOf:s krav, så en flytt är inte laglig här. */
const PLATT = `<!doctype html><html><head><meta charset="utf-8"></head><body><main>
<div><h1>Kom igång i dag</h1><h2>Vad kunderna säger</h2><h2>Enkla priser</h2>
<p>${"Text. ".repeat(40)}</p></div>
</main></body></html>`;

async function resolve(html: string, find: string) {
  const dir = mkdtempSync(join(tmpdir(), "measure-reason-"));
  const file = join(dir, "page.html");
  writeFileSync(file, html);
  const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`file://${file}`, { waitUntil: "load" });
  const r = await runGatedAttempts(page, [{ op: "move_up", tag: "h2", find }], []);
  await ctx.close();
  return r;
}

describe("upplösningens orsaksrad — vilken gren vägrade?", () => {
  it("lokatorn saknas i kopian ⇒ orsaken pekar ut LOKATORN, inte strukturen", async (ctx) => {
    if (!browser) return ctx.skip();
    const r = await resolve(REN, "En rubrik som inte finns på sidan");
    expect(r.unresolvable).toBe(true);
    expect(r.unresolvedReason).toMatch(/hittar inte lokatorn/);
    // Rubriktexten står i raden — utan den vet operatören inte VILKEN op föll
    // när planen bär flera.
    expect(r.unresolvedReason).toContain("En rubrik som inte finns");
  }, 120_000);

  it("ingen ren sektionsnivå ⇒ orsaken pekar ut STRUKTUREN, inte lokatorn", async (ctx) => {
    if (!browser) return ctx.skip();
    const r = await resolve(PLATT, "Vad kunderna säger");
    expect(r.unresolvable).toBe(true);
    expect(r.unresolvedReason).toMatch(/ingen ren sektionsnivå/);
    // ...och INTE lokator-grenen: rubriken finns, det är sidan som saknar en
    // flyttbar sektion. Förväxlas de skickas felsökningen åt fel håll.
    expect(r.unresolvedReason).not.toMatch(/hittar inte lokatorn/);
  }, 120_000);

  it("upplösbar plan ⇒ ingen orsak alls (raden är tyst när inget brast)", async (ctx) => {
    if (!browser) return ctx.skip();
    const r = await resolve(REN, "Vad kunderna säger");
    expect(r.unresolvable).toBe(false);
    expect(r.unresolvedReason).toBeNull();
    expect(r.attempts.length).toBeGreaterThan(0);
  }, 120_000);
});
