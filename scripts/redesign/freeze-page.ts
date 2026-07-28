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
//     --out=fixtures/real-sites/example-pricing.html [--render=auto] \
//     [--img-budget=8000000]   ← total bytes bilddata som inlinas (default 8 MB)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import {
  acquireRenderPage,
  autoScroll,
  dismissOverlays,
  gotoTolerant,
  pageLooksStyled,
} from "./render-page";

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
// Total budget för inlinade bildbytes (skarpa provet 2026-07-17: en produkt-
// listning med 480 bilder gav en 36 MB fryst fil). Budgeten är ingen
// kvalitetsklippa: i browser-vägen pinnas varje bilds RENDERADE geometri som
// width/height-attribut före frysningen, så en bild utanför budgeten kan
// aldrig ändra layouten — grindarna behöver bildens yta, inte dess pixlar.
// Budgeten spenderas above-fold-först, sedan störst renderad yta.
const IMG_BUDGET = arg("img-budget") ? Number(arg("img-budget")) : 8_000_000;
if (!Number.isFinite(IMG_BUDGET) || IMG_BUDGET < 0) {
  console.error("usage: --img-budget måste vara ett icke-negativt antal bytes");
  process.exit(1);
}
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
/** Attributvärden i HTML är entitetskodade — hämtningen MÅSTE ske på den
 *  AVKODADE URL:en (fikajobs-fyndet 2026-07-28: Framer skriver
 *  src="...?width=200&amp;height=200" och Framers CDN svarar 400 på det
 *  okodade &amp;-formatet ⇒ 0/20 bilder inlinade, tomma bilder i växlaren).
 *  Strängbytet i dokumentet sker fortsatt på RÅFORMEN som den står i filen.
 *  &amp; sist så &amp;lt; inte dubbelavkodas. */
const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, "&");
/** Absolut URL för attribut-kontext: & entitetskodas tillbaka så attributet
 *  är korrekt HTML (webbläsaren avkodar till ren URL vid hämtning). */
const escAttr = (u: string) => u.replace(/&/g, "&amp;");

/** Kvalitetsbeslut 2026-07-28 (ägaren: högkvalitativ produkt, utrymme
 *  sekundärt): stora CDN-bilder begärs om i MOBILBREDD före inline-taket i
 *  stället för att absolutlänkas (mediegranskningen: tibbers 641 kB-bild
 *  begärde w=1920 för vår 390px-viewport). Mönstren täcker imgix/Contentful/
 *  Nexts bildproxy (?w=) och Framer-klassen (?width=&height=). 828px ≈ 390px
 *  @2x med marginal (Nexts standard-deviceSize). Höjden skalas proportionellt
 *  när den finns så fit/crop-CDN:er inte förvränger. Originalet är alltid
 *  sista kandidaten — en otillåten variantbredd (Next 400:ar) kostar bara ett
 *  extra försök. */
function downscaleVariants(u: string): string[] {
  try {
    const url = new URL(u);
    const p = url.searchParams;
    const mk = (wKey: string, hKey: string): string | null => {
      const w = Number(p.get(wKey));
      if (!Number.isFinite(w) || w <= 900) return null; // redan rimlig storlek
      const target = 828;
      const v = new URL(u);
      v.searchParams.set(wKey, String(target));
      const h = Number(p.get(hKey));
      if (p.has(hKey) && Number.isFinite(h) && h > 0) {
        v.searchParams.set(hKey, String(Math.round((h * target) / w)));
      }
      return v.toString();
    };
    return [mk("w", "h"), mk("width", "height")].filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

/** Hämta en bild inline-bar: nedskalade CDN-varianter först, originalet sist.
 *  null = ingen kandidat under IMG_CAP/av bildtyp. */
async function fetchInlineableImage(
  fullUrl: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  for (const cand of [...downscaleVariants(fullUrl), fullUrl]) {
    const got = await fetchBytes(cand);
    if (got && got.bytes.length <= IMG_CAP && got.type.startsWith("image/")) return got;
  }
  return null;
}

/** Rendera sidan färdigt i headless Chromium och returnera den RENDERADE
 *  DOM:ens HTML. Chromium: env-var eller playwrights egen installation
 *  (Actions-runnern) — samma mönster som serving-smoke. Viewport 390×844 =
 *  pipelinens verifierings-viewport. Sidans egna skript (inkl. en ev.
 *  installerad Angel-snippet) får köra under renderingen — snippeten
 *  självdeaktiveras på navigator.webdriver (bot-gaten) och serversidan
 *  UA-filtrerar auktoritativt, så frysningen kan aldrig förorena mätdatat.
 *  Lazy-svepet scrollar genom sidan så under-folden-innehåll renderas, och
 *  scrollar tillbaka så frysta dokumentet börjar vid toppen. */
async function browserRenderedHtml(
  u: string,
): Promise<{ html: string; imgPriority: Record<string, { top: number; area: number }> }> {
  // Render-primitiverna (anslut/goto/svep/avfärda modaler/stylad-koll) delas med
  // scale-test + render-fidelity via ./render-page — EN bevisad väg (Stagehand,
  // engine.server.ts), inte fyra kopior. Frysningen nedan är freeze-specifik
  // (bild-geometri + CSSOM) och stannar här.
  const { page, cleanup } = await acquireRenderPage();
  try {
    // Tunga SPA:er fyrar ibland aldrig load (öppna connections) — gotoTolerant
    // fångar timeouten (även Stagehands egen felform) och jobbar vidare på det
    // som renderats. Ett hårt navigationsfel (net::ERR_...) kastar fortfarande.
    const resp = await gotoTolerant(page, u);
    // Samma ärlighetsgräns som statiska vägen (curl-hjälparen): ≥400 är
    // ingen sida att frysa — en WAF-utmaning eller felsida får aldrig
    // bli "den frysta kopian".
    if (resp && resp.status() >= 400) {
      throw new Error(`HTTP ${resp.status()} från servern — ingen sida att frysa`);
    }
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
    // Avfärda cookie-/auth-/e-post-/onboarding-modaler FÖRE frysningen så den
    // frysta kopian (och pixelgrindarna) ser den riktiga sidan, inte en overlay
    // (fidelitetstestet 2026-07-26: ~5 renders doldes av centrerade modaler).
    await dismissOverlays(page);
    await autoScroll(page);
    // Ostylad render = trasig (sofi.com: CSS applicerades aldrig, bara nav-länkar).
    // Frys den ALDRIG — i --render=browser fäller det körningen, i auto behålls
    // hellre den statiska kopian (samma ärliga degradering som ett tomt skal).
    if (!(await pageLooksStyled(page))) {
      throw new Error("renderad sida är ostylad (CSS applicerades aldrig) — ingen trogen kopia att frysa");
    }
    // Pinna bildgeometrin FÖRE frysningen: varje <img> stämplas med sin
    // faktiskt renderade width/height (CSS vinner alltid över attribut, så
    // stämpeln ändrar inget som redan är stylat — den pinnar bara det som
    // annars styrs av bildens intrinsic-storlek). srcset/sizes strippas så
    // frysta src styr i omrenderingen. Samtidigt samlas per-bild-prioritet
    // (above-fold, renderad yta) till inline-budgeten.
    const imgs = await page.evaluate(() => {
      // CMP-strip i den RENDERADE kopian (freeze-testfynd 2026-07-28, tibber:
      // dialog täckte hela fångsten trots avfärdaren — okänd svensk CMP).
      // SPEGELVÄND selektorlista mot measure.ts CMP_ROOTS — håll i synk.
      // Plus generisk sista utväg: fixerade fullskärms-overlays vars text
      // andas cookies/samtycke tas bort ur kopian; sidan mäts/visas, inte
      // tredjeparts-CMP:n.
      const CMP_ROOTS =
        "#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay," +
        "#onetrust-consent-sdk,#onetrust-banner-sdk," +
        "#usercentrics-root,#uc-center-container," +
        ".osano-cm-window,.osano-cm-dialog," +
        "#didomi-host,#didomi-notice," +
        ".cc-window,.cc-banner," +
        "#cookiescript_injected," +
        "[data-lovable-cookie-root]," +
        "[id*='cookie-consent' i],[class*='cookie-banner' i],[id*='consent-banner' i]";
      try {
        for (const el of Array.from(document.querySelectorAll(CMP_ROOTS))) el.remove();
        for (const el of Array.from(document.querySelectorAll("div,section,aside,dialog"))) {
          const cs = getComputedStyle(el);
          if (cs.position !== "fixed" && cs.position !== "sticky") continue;
          const r = el.getBoundingClientRect();
          if (r.width < innerWidth * 0.8 || r.height < innerHeight * 0.35) continue;
          const t = (el.textContent || "").toLowerCase();
          if (/cookie|samtycke|integritet|consent|gdpr/.test(t) && t.length < 3000) el.remove();
        }
      } catch {
        /* strippning är best-effort — fångsten fortsätter */
      }
      // Spelar-klassens geometri pinnas (freeze-testfynd 2026-07-28, tibber:
      // postern var inlinad med bakgrund men mux-player är 0 px hög utan sitt
      // JS — custom element utan definition renderas inline). Samma princip
      // som bild-pinnen nedan: den RENDERADE ytan stämplas som inline-mått så
      // elementet behåller sin plats offline och poster-bakgrunden får yta.
      for (const el of Array.from(
        document.querySelectorAll("mux-player, video, iframe[src*='vimeo'], iframe[src*='youtube']"),
      )) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const he = el as HTMLElement;
          he.style.width = `${Math.round(r.width)}px`;
          he.style.height = `${Math.round(r.height)}px`;
          he.style.display = he.style.display || "block";
        }
      }
      const out: { src: string; top: number; area: number }[] = [];
      for (const source of Array.from(document.querySelectorAll("picture source"))) {
        source.removeAttribute("srcset");
      }
      for (const img of Array.from(document.images)) {
        const r = img.getBoundingClientRect();
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        if (w > 0 && h > 0) {
          img.setAttribute("width", String(w));
          img.setAttribute("height", String(h));
        }
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        const src = img.getAttribute("src");
        if (src) out.push({ src, top: Math.round(r.top + window.scrollY), area: w * h });
      }
      return out;
    });
    const priority: Record<string, { top: number; area: number }> = {};
    for (const m of imgs) {
      const prev = priority[m.src];
      priority[m.src] = prev
        ? { top: Math.min(prev.top, m.top), area: Math.max(prev.area, m.area) }
        : { top: m.top, area: m.area };
    }
    // Referensbild för fidelitetsmåttet (ägarfråga 2026-07-28 "hur vet du
    // att den fryser komplett?"): det browsern SJÄLV såg efter stegen, i
    // samma session — facit som den frysta kopians rendering sedan mäts mot
    // (scripts/diag/freeze-fidelity.ts). Cappad 8000px så måttet täcker det
    // som granskas; täckningen rapporteras, aldrig antas.
    const refShot = arg("ref-shot");
    if (refShot) {
      try {
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.screenshot({
          path: refShot,
          type: "png",
          fullPage: true,
          clip: { x: 0, y: 0, width: 390, height: Math.min(8000, h) },
        });
        console.log(`[freeze-page] referensbild → ${refShot} (${Math.min(8000, h)}px av ${h}px)`);
      } catch (err) {
        console.warn(`[freeze-page] referensbild föll: ${err}`);
      }
    }
    const outHtml = await page.evaluate(() => {
      // CSSOM-serialisering (Trello-obduktionen 2026-07-18, varv 2):
      // styled-components m.fl. injicerar i produktionsläge sina regler via
      // insertRule — <style data-styled>-taggarna är TOMMA i outerHTML och
      // kopian blir ostylad trots browser-rendering. Skriv därför varje
      // stylesheets faktiska CSSOM-regler tillbaka in i sin <style>-tagg
      // (cross-origin-länkade ark kastar vid läsning och lämnas orörda —
      // de inlinas redan av stilmalls-steget efteråt).
      for (const sheet of Array.from(document.styleSheets)) {
        const owner = sheet.ownerNode;
        if (!owner || (owner as Element).tagName !== "STYLE") continue;
        try {
          const rules = Array.from(sheet.cssRules)
            .map((r) => r.cssText)
            .join("\n");
          if (rules && rules.length > ((owner as Element).textContent || "").length) {
            (owner as Element).textContent = rules;
          }
        } catch {
          /* oläsbart ark — lämna som det är */
        }
      }
      return "<!doctype html>\n" + document.documentElement.outerHTML;
    });
    return { html: outHtml, imgPriority: priority };
  } finally {
    await cleanup();
  }
}

// ── hämta: static först, browser-rendering när skalet är tomt ────────────────
let html = "";
if (RENDER !== "browser") {
  try {
    html = await fetchText(url);
  } catch (err) {
    // I auto-läge är en fallen curl-hämtning (WAF, nätverkshicka) ingen
    // dödsdom — browservägen kan fortfarande lyckas. Bara static-läget fäller.
    if (RENDER === "static") throw err;
    console.warn(`[freeze-page] statisk hämtning föll (${err}) — provar browser-rendering`);
  }
}
let renderedVia: "static" | "browser" = "static";
// Renderad bildgeometri (browser-vägen) — styr inline-budgetens prioritering.
let imgPriority: Record<string, { top: number; area: number }> | null = null;
const isShell = (h: string) => extractContentModel(h).sections.length < 2;
// CSS-in-JS-detektorn (Trello-obduktionen 2026-07-18): styled-components m.fl.
// injicerar sina stilar med JavaScript i drift — en statisk kopia får aldrig
// med dem, layouten kollapsar och element hamnar på varandra (signup-knappen
// täcktes av en banner-länk ⇒ CTA-grinden föll trots hel siddesign). Signalen:
// klass-tokens i markupen som de inlinade stilmallarna aldrig nämner. Låg
// täckning ⇒ kopian saknar sina stilar ⇒ webbläsarvägen (som får med runtime-
// injicerade <style>-taggar). Trösklarna: minst 12 samplade tokens (småsidor
// bedöms inte) och < 35 % täckning (riktiga statiska sajter ligger nära 100 %).
const isUnstyled = (h: string): boolean => {
  const bodyIdx = h.search(/<body\b/i);
  const body = bodyIdx >= 0 ? h.slice(bodyIdx) : h;
  const css = [...h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  if (!css) return false; // inga stilmallar alls är SPA-skalets signal, inte denna
  const tokens = new Set<string>();
  for (const m of body.matchAll(/\bclass\s*=\s*"([^"]{1,200})"/gi)) {
    for (const t of m[1].split(/\s+/)) {
      if (/^[A-Za-z][\w-]{5,}$/.test(t)) tokens.add(t);
      if (tokens.size >= 40) break;
    }
    if (tokens.size >= 40) break;
  }
  if (tokens.size < 12) return false;
  let covered = 0;
  for (const t of tokens) if (css.includes(`.${t}`)) covered++;
  return covered / tokens.size < 0.35;
};
// Browser-FÖRST när nycklar finns (kvalitetsbeslut 2026-07-28): media-
// granskningen över 8 sajter visade att JS-stackarna (Next/Framer-klassen)
// tappar hjältevideor och lazy-bilder i statisk frysning — den renderade
// DOM:en efter hydrering är enda kopian som bär sidans visuella sanning.
// Utan nycklar (lokal utveckling) gäller gamla eskaleringen: statisk först,
// browser bara för skal/ostylat.
const BROWSER_KEYS = !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
if (
  RENDER === "browser" ||
  (RENDER === "auto" && (BROWSER_KEYS || isShell(html) || isUnstyled(html)))
) {
  try {
    if (RENDER === "auto" && html) {
      console.log(
        isShell(html)
          ? "[freeze-page] statisk kopia är ett SPA-skal (<2 sektioner) → browser-rendering"
          : isUnstyled(html)
            ? "[freeze-page] statisk kopia saknar sina stilar (CSS-in-JS) → browser-rendering"
            : "[freeze-page] browser-först (nycklar finns) — renderad DOM bär videor/lazy-bilder",
      );
    }
    const rendered = await browserRenderedHtml(url);
    html = rendered.html;
    imgPriority = rendered.imgPriority;
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
    const cssUrl = abs(decodeEntities(href));
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

// 2b) srcset/sizes bort på ALLA hämtvägar (bild-fidelitetsfynd 2026-07-23). En
//     <img>/<source> med srcset låter browsern välja en ICKE-inlinead kandidat
//     (absolut URL) framför den inlinade src:en — under demo-renderingens data:-
//     grind blockeras den och bilden blir tom TROTS lyckad inlining (calendly
//     frös 95 % vitt). Utan srcset faller browsern tillbaka på src, som bild-
//     steget nedan inlinear. Browser-vägen strippar redan i DOM:en
//     (browserRenderedHtml) — här är det idempotent, och på serverings-vägen
//     (auto-generate blockerar ALLA requests) påverkas inga grindutslag.
html = html.replace(/<(img|source)\b[^>]*>/gi, (tag) =>
  tag
    .replace(/\s+srcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+sizes\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ""),
);

// 3) Bilder → data-URI (layout-ytan), stora/ohämtbara/utanför budget →
//    absolut URL. Budgeten spenderas där den syns: above-fold först, sedan
//    störst renderad yta (browser-vägens geometri); statiska vägen saknar
//    geometri och tar dokumentordning (≈ fold-ordning).
const imgSrcs = new Set(
  [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith("data:")),
);
const FOLD = 844; // = renderingsviewportens höjd
const srcList = [...imgSrcs];
if (imgPriority) {
  const pri = imgPriority;
  srcList.sort((a, b) => {
    const pa = pri[a];
    const pb = pri[b];
    if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
    const fa = pa.top < FOLD ? 0 : 1;
    const fb = pb.top < FOLD ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return pb.area - pa.area;
  });
}
const replaceSrc = (h: string, src: string, rep: string) =>
  h.split(`"${src}"`).join(`"${rep}"`).split(`'${src}'`).join(`'${rep}'`);
let inlined = 0;
let spentBytes = 0;
let overBudget = 0;
for (const src of srcList) {
  // Hämta AVKODAT, skriv tillbaka entitetskodat — se decodeEntities/escAttr.
  const full = abs(decodeEntities(src));
  if (spentBytes >= IMG_BUDGET) {
    // Budgeten slut — hämta inte ens; absolutlänken behåller online-visning
    // och (i browser-vägen) är layouten redan pinnad via width/height.
    overBudget++;
    html = replaceSrc(html, src, escAttr(full));
    continue;
  }
  // Nedskalade CDN-varianter före originalet — se fetchInlineableImage.
  const got = await fetchInlineableImage(full);
  const fits = got && spentBytes + got.bytes.length <= IMG_BUDGET;
  if (got && !fits) overBudget++;
  if (got && fits) {
    inlined++;
    spentBytes += got.bytes.length;
    html = replaceSrc(html, src, `data:${got.type.split(";")[0]};base64,${b64(got.bytes)}`);
  } else {
    html = replaceSrc(html, src, escAttr(full));
  }
}

// 3b) Video-postrar → data-URI (kvalitetsbeslut 2026-07-28): hjältevideor är
//     JS-strömmar (Mux/Vimeo/ctfassets — 5 av 8 sajter i mediegranskningen)
//     som aldrig kan spela i en fryst kopia; postern är videons visuella
//     sanning och ska synas även offline. Gäller poster-attribut på <video>
//     och spelar-element (mux-player-klassen). Ogiltiga postrar
//     ("[object Object]" — Framer-buggen på fikajobs) filtreras bort.
let postersInlined = 0;
const posterSrcs = new Set(
  [...html.matchAll(/<(?:video|mux-player)\b[^>]*\bposter=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith("data:") && /^(https?:|\/\/|\/)/.test(decodeEntities(s).trim())),
);
for (const src of posterSrcs) {
  const got = await fetchInlineableImage(abs(decodeEntities(src)));
  if (got && spentBytes + got.bytes.length <= IMG_BUDGET) {
    spentBytes += got.bytes.length;
    postersInlined++;
    const dataUri = `data:${got.type.split(";")[0]};base64,${b64(got.bytes)}`;
    html = replaceSrc(html, src, dataUri);
    // Spelar-element (mux-player-klassen) är okända element utan sitt JS —
    // poster-attributet renderar INGET offline. Bakgrunden på SAMMA element
    // gör postern synlig utan att ändra DOM-struktur eller layoutmått
    // (background påverkar aldrig elementets storlek). <video> visar poster
    // nativt och lämnas orörd.
    html = html.replace(/<(mux-player)\b([^>]*)>/gi, (tag, name, attrs) => {
      if (!attrs.includes(dataUri)) return tag;
      const styled = /style="/.test(attrs)
        ? attrs.replace(/style="/, `style="background:center/cover no-repeat url(${dataUri});`)
        : `${attrs} style="background:center/cover no-repeat url(${dataUri})"`;
      return `<${name}${styled}>`;
    });
  }
}

// 3c) CSS-assets → data-URI (kvalitetsbeslut 2026-07-28): bakgrundsbilder och
//     typsnitt i url(...) inlinades aldrig — Hedvigs appsektion blev vit och
//     typografin föll till systemtypsnitt offline. Sveper ALLA url(...)-refar
//     i dokumentet (style-block + style-attribut; url() förekommer bara i
//     CSS-kontext) under egen budget. Attributens entitetskodning hanteras
//     som för bilder: hämta avkodat, ersätt råformen.
const CSS_ASSET_BUDGET = 4_000_000;
let cssAssetBytes = 0;
let cssAssetsInlined = 0;
const cssRefs = new Set(
  [...html.matchAll(/url\(\s*(['"]?)((?:https?:)?\/\/[^'")]+|\/[^'")]+)\1\s*\)/gi)]
    .map((m) => m[2])
    .filter((s) => !s.startsWith("data:")),
);
for (const ref of cssRefs) {
  if (cssAssetBytes >= CSS_ASSET_BUDGET) break;
  const full = abs(decodeEntities(ref));
  const isFontRef = /\.(woff2?|ttf|otf)(\?|$)/i.test(full);
  let got: { bytes: Uint8Array; type: string } | null = null;
  if (isFontRef) {
    const raw = await fetchBytes(full);
    // Typsnitt serveras ofta som octet-stream — filändelsen är prediket.
    if (raw && raw.bytes.length <= IMG_CAP) got = raw;
  } else {
    got = await fetchInlineableImage(full);
  }
  if (got && cssAssetBytes + got.bytes.length <= CSS_ASSET_BUDGET) {
    cssAssetBytes += got.bytes.length;
    cssAssetsInlined++;
    const mime = isFontRef
      ? full.match(/\.woff2/i) ? "font/woff2" : full.match(/\.woff/i) ? "font/woff" : "font/ttf"
      : got.type.split(";")[0];
    const dataUri = `data:${mime};base64,${b64(got.bytes)}`;
    // url() kan vara ociterad — replaceSrc täcker bara "…"/'…'-formerna.
    html = html
      .split(`url(${ref})`).join(`url(${dataUri})`)
      .split(`url("${ref}")`).join(`url("${dataUri}")`)
      .split(`url('${ref}')`).join(`url('${dataUri}')`);
  }
}
if (overBudget > 0) {
  const budgetStr =
    IMG_BUDGET >= 1e6 ? `${Math.round(IMG_BUDGET / 1e6)} MB` : `${IMG_BUDGET} bytes`;
  console.warn(
    `[freeze-page] ${overBudget} bild(er) utanför totalbudgeten (${budgetStr}) — absolutlänkade${
      imgPriority ? "; layouten pinnad via renderade width/height-attribut" : ""
    }`,
  );
}

// Färskhetsstämpeln (kvalitetsbeslut 2026-07-28): frysar åldras — Krys
// partnerloggor och Matsmarts kampanjkort hann bytas live under media-
// granskningen. Stämpeln gör åldern maskinläsbar för rapport/växlare
// ("fryst för N dagar sedan") i stället för låtsad realtid.
html += `\n<!-- angel-frozen-at:${new Date().toISOString()} -->`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(
  `[freeze-page] ${url} → ${out} (${renderedVia}, ${html.length} bytes, ${links.length} stilmallar inlinade, ${inlined}/${imgSrcs.size} bilder à ${Math.round(spentBytes / 1e3)} kB, ${postersInlined} video-poster, ${cssAssetsInlined} css-assets à ${Math.round(cssAssetBytes / 1e3)} kB)`,
);
