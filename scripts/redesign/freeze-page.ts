#!/usr/bin/env bun
// Frys EN sida till en självbärande HTML-fil — det format
// auto-genereringspipelinen konsumerar (--pages-kartan).
//
// "Fryst" = designen och pixelgrindarna arbetar mot exakt den här kopian,
// deterministiskt och offline. Hjälparen hämtar sidan + inlinear det som styr
// layouten: länkade stilmallar blir <style>-block, bilder blir data-URI:er
// (upp till en storleksgräns — layouten behöver bildens yta, inte dess pixlar
// i full kvalitet). Skript strippas: kopian ska vara statisk.
//
// Två hämtvägar (--render=auto|static|browser, default auto):
//   static  — vad SERVERN skickar (curl). Räcker för server-renderade sidor.
//   browser — sidan renderas färdigt i headless Chromium (JS får bygga DOM:en)
//             och den RENDERADE DOM:en fryses. Krävs för SPA-sajter.
//   auto    — static först; ger den ett SPA-skal (extractContentModel hittar
//             < 2 sektioner — samma etablerade tröskel som nattloopen och
//             breadth-testet) renderas sidan i browser i stället. Piloten
//             glutenforum.se var exakt det fallet (generalrepet 2026-07-17):
//             alla sidor gav samma 97 990-bytes JS-skal och kedjan stod still.
//
//   bun run scripts/redesign/freeze-page.ts --url=https://example.com/pricing \
//     --out=fixtures/real-sites/example-pricing.html [--render=auto]

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { extractContentModel } from "../../src/adaptive/redesign/extract";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const url = arg("url");
const out = arg("out");
const RENDER = (arg("render") ?? "auto") as "auto" | "static" | "browser";
if (!url || !out || !["auto", "static", "browser"].includes(RENDER)) {
  console.error(
    "usage: freeze-page.ts --url=<page url> --out=<self-contained.html> [--render=auto|static|browser]",
  );
  process.exit(1);
}

const IMG_CAP = 400_000; // bytes — större bilder länkas absolut i stället
const UA = `Mozilla/5.0 (compatible; CROENGINE-freeze/1.0; +${process.env.APP_ORIGIN ?? "https://croengine.netlify.app"})`;

// Hämtning via curl-subprocess, inte fetch(): curl följer miljöns proxy- och
// CA-konfiguration überallt (inkl. sandlådor med egen TLS-terminering) och
// finns på varje runner vi kör på.
import { mkdtempSync, readFileSync as readF, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

function curl(u: string): { bytes: Uint8Array; type: string } | null {
  const dir = mkdtempSync(joinPath(tmpdir(), "freeze-"));
  const tmp = joinPath(dir, "body");
  try {
    const proc = Bun.spawnSync([
      "curl", "-sSL", "--max-time", "60", "-A", UA, "-o", tmp, "-w", "%{content_type} %{http_code}", u,
    ]);
    if (proc.exitCode !== 0) return null;
    const [type, code] = proc.stdout.toString().trim().split(/\s+(?=\d+$)/);
    if (!code || Number(code) >= 400) return null;
    return { bytes: new Uint8Array(readF(tmp)), type: type || "application/octet-stream" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function fetchText(u: string): Promise<string> {
  const got = curl(u);
  if (!got) throw new Error(`fetch failed: ${u}`);
  return Buffer.from(got.bytes).toString("utf8");
}
async function fetchBytes(u: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  return curl(u);
}
const abs = (href: string) => new URL(href, url).toString();
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

/** Rendera sidan färdigt i headless Chromium och returnera den RENDERADE
 *  DOM:ens HTML. Chromium: env-var eller playwrights egen installation
 *  (Actions-runnern) — samma mönster som serving-smoke. Viewport 390×844 =
 *  pipelinens verifierings-viewport. Sidans egna skript (inkl. en ev.
 *  installerad Angel-snippet) får köra under renderingen — snippeten
 *  självdeaktiveras på navigator.webdriver (bot-gaten) och serversidan
 *  UA-filtrerar auktoritativt, så frysningen kan aldrig förorena mätdatat.
 *  Lazy-svepet scrollar genom sidan så under-folden-innehåll renderas, och
 *  scrollar tillbaka så frysta dokumentet börjar vid toppen. */
async function browserRenderedHtml(u: string): Promise<string> {
  const { chromium } = await import("playwright-core");
  const exec = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({ headless: true, executablePath: exec });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: UA });
    // Tunga SPA:er fyrar ibland aldrig load (öppna connections) — samma
    // degradera-och-fortsätt som korpus-frysaren (freeze.server.ts): fånga
    // timeouten och jobba vidare på det som renderats.
    await page.goto(u, { waitUntil: "load", timeout: 45_000 }).catch((err) => {
      console.warn(`[freeze-page] load-event uteblev (${err}) — fortsätter på renderat läge`);
    });
    // networkidle kan aldrig nås på sidor med long-polling — försök, ge upp tyst.
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    // Innehålls-poll (korpus-frysarens mönster): hydreringen kan släpa efter
    // load-eventet — vänta tills body bär riktig text, max 10 s, fortsätt
    // sedan ändå (konsumenternas sections<2-grind är ärlig backstop).
    for (let waited = 0; waited < 10_000; waited += 500) {
      const chars = await page.evaluate(() => (document.body.innerText || "").length);
      if (chars >= 400) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1_200);
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);
    return await page.evaluate(() => "<!doctype html>\n" + document.documentElement.outerHTML);
  } finally {
    await browser.close();
  }
}

// ── hämta: static först, browser-rendering när skalet är tomt ────────────────
let html = RENDER === "browser" ? "" : await fetchText(url);
let renderedVia: "static" | "browser" = "static";
const isShell = (h: string) => extractContentModel(h).sections.length < 2;
if (RENDER === "browser" || (RENDER === "auto" && isShell(html))) {
  try {
    if (RENDER === "auto") {
      console.log("[freeze-page] statisk kopia är ett SPA-skal (<2 sektioner) → browser-rendering");
    }
    html = await browserRenderedHtml(url);
    // Frysta filen skrivs som UTF-8 och läses utan HTTP-huvuden — dokumentet
    // måste själv deklarera charset, och en gammal deklaration (t.ex.
    // iso-8859-1) skulle mojibakea åäö vid omrendering. Normalisera.
    html = html.replace(/<meta[^>]+charset[^>]*>/gi, "");
    html = /<head[^>]*>/i.test(html)
      ? html.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">`)
      : `<meta charset="utf-8">${html}`;
    renderedVia = "browser";
  } catch (err) {
    if (RENDER === "browser" || !html) {
      console.error(`[freeze-page] browser-rendering föll: ${err}`);
      process.exit(1);
    }
    // auto med fungerande statisk kopia: behåll den hellre än att fälla
    // körningen — konsumenternas sections<2-grind säger ärligt ifrån ändå.
    console.warn(`[freeze-page] browser-rendering föll (${err}) — behåller statiska kopian`);
  }
}

// 1) Skript bort — kopian är statisk (design + grindar behöver DOM:en, inte
//    JS; en renderad SPA-kopia får ALDRIG hydrera om sig i verifierings-
//    renderingen, och en ev. Angel-tag följer med bort här).
html = html.replace(/<script[\s\S]*?<\/script>/gi, "");

// 2) Länkade stilmallar → <style>-block (layoutens sanning).
const links = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)].map((m) => m[0]);
let css = "";
for (const tag of links) {
  const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
  if (!href) continue;
  try {
    // Relativa url(...) i css:en pekas om mot stilmallens egen bas.
    const cssUrl = abs(href);
    let sheet = await fetchText(cssUrl);
    sheet = sheet.replace(/url\(\s*(['"]?)(?!data:|https?:|#)([^'")]+)\1\s*\)/gi, (_, q, ref) => {
      try {
        return `url(${new URL(ref, cssUrl).toString()})`;
      } catch {
        return `url(${ref})`;
      }
    });
    css += `\n/* inlined: ${href} */\n${sheet}`;
    html = html.replace(tag, "");
  } catch (err) {
    console.warn(`[freeze-page] stilmall kunde inte hämtas (${href}): ${err}`);
  }
}
if (css) html = html.replace(/<\/head>/i, `<style>${css}</style></head>`);

// 3) Bilder → data-URI (layout-ytan), stora/ohämtbara → absolut URL.
const imgSrcs = new Set(
  [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith("data:")),
);
let inlined = 0;
for (const src of imgSrcs) {
  const full = abs(src);
  const got = await fetchBytes(full);
  const replacement =
    got && got.bytes.length <= IMG_CAP && got.type.startsWith("image/")
      ? `data:${got.type.split(";")[0]};base64,${b64(got.bytes)}`
      : full;
  if (replacement.startsWith("data:")) inlined++;
  html = html.split(`"${src}"`).join(`"${replacement}"`).split(`'${src}'`).join(`'${replacement}'`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(
  `[freeze-page] ${url} → ${out} (${renderedVia}, ${html.length} bytes, ${links.length} stilmallar inlinade, ${inlined}/${imgSrcs.size} bilder inlinade)`,
);
