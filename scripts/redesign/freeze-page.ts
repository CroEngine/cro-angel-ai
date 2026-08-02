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

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Response as PWResponse } from "playwright-core";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import {
  acquireRenderPage,
  applyRenderViewport,
  autoScroll,
  dismissOverlays,
  gotoTolerant,
  pageLooksStyled,
  RENDER_VIEWPORT,
  UA as RENDER_UA,
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
      "curl",
      "-sSL",
      "--max-time",
      "60",
      "-A",
      UA,
      "-o",
      tmp,
      "-w",
      "%{content_type} %{http_code}",
      u,
    ]);
    if (proc.exitCode !== 0) return null;
    const [type, code] = proc.stdout
      .toString()
      .trim()
      .split(/\s+(?=\d+$)/);
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
    // Cloudinary-klassen (eightsleep-fyndet 2026-07-28): transform-parametrarna
    // bor i SÖKVÄGEN (…/upload/c_fill,g_auto,w_2620,h_1470/…), inte i query-
    // strängen. Samma princip: w_ skalas till 828 och h_ proportionellt, övriga
    // parametrar orörda (c_fill-beskärningen behåller sitt förhållande).
    let pathVariant: string | null = null;
    const wm = url.pathname.match(/(^|[/,])w_(\d{3,5})(?=[,/])/);
    if (wm) {
      const w = Number(wm[2]);
      if (w > 900) {
        const target = 828;
        let path = url.pathname.replace(/([/,])w_\d{3,5}(?=[,/])/, `$1w_${target}`);
        const hm = url.pathname.match(/([/,])h_(\d{3,5})(?=[,/])/);
        if (hm) {
          const h = Number(hm[2]);
          path = path.replace(/([/,])h_\d{3,5}(?=[,/])/, `$1h_${Math.round((h * target) / w)}`);
        }
        const v = new URL(u);
        v.pathname = path;
        pathVariant = v.toString();
      }
    }
    // Hygraph/graphassets-klassen (voi-fyndet 2026-08-02, grindens första
    // namngivna reparationsmål): asset-URL:er är ändelselösa handles
    // (…graphassets.com/<env>/<handle>) och original-jpeg:arna (434–679 kB)
    // överskrider IMG_CAP — utan variant länkades de absolut och frysta
    // kopian stannade på 82,4 % offline. CDN:ens transform-segment skjuts in
    // FÖRE handlen: …/<env>/resize=width:828/<handle> (verifierat: 434 kB →
    // 108 kB image/jpeg). Bara URL:er utan befintligt transform-segment
    // (= exakt två sökvägssegment) kandiderar — annars dubblas transformer.
    let graphassetsVariant: string | null = null;
    if (/\.graphassets\.com$/i.test(url.hostname)) {
      const segs = url.pathname.split("/").filter(Boolean);
      if (segs.length === 2) {
        const v = new URL(u);
        v.pathname = `/${segs[0]}/resize=width:828/${segs[1]}`;
        graphassetsVariant = v.toString();
      }
    }
    return [mk("w", "h"), mk("width", "height"), pathVariant, graphassetsVariant].filter(
      (x): x is string => !!x,
    );
  } catch {
    return [];
  }
}

/** Nedladdnings-inspelningen från browser-vägen (fylls efter rendering):
 *  bytes browsern själv hämtade, nyckel = slutlig URL. Konsulteras FÖRE all
 *  curl-omhämtning — bot-väggar och varianter är redan lösta i den. */
const recordedAssets = new Map<string, { bytes: Uint8Array; type: string }>();
const assetKey = (u: string) => u.split("#")[0];

/** Raster-magic vinner över Content-Type-headern (voi-fyndet 2026-08-02:
 *  Hygraphs resize-transform RASTRERAR svg-registrerade assets till jpeg men
 *  behåller `image/svg+xml` i headern — jpeg-bytes deklarerade som svg målar
 *  aldrig i browsern). Äkta svg:er saknar rastermagic och behåller sin typ. */
function sniffRasterMime(b: Uint8Array): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.length > 7 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (
    b.length > 11 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "image/webp";
  if (b.length > 5 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
    return "image/gif";
  return null;
}

/** Hämta en bild inline-bar: inspelningen först, sedan nedskalade CDN-
 *  varianter, originalet sist. null = ingen kandidat under IMG_CAP/av bildtyp. */
async function fetchInlineableImage(
  fullUrl: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  const rec = recordedAssets.get(assetKey(fullUrl));
  if (
    rec &&
    rec.bytes.length <= IMG_CAP &&
    (rec.type.startsWith("image/") || rec.type === "application/octet-stream")
  ) {
    const headerType = rec.type.startsWith("image/") ? rec.type : "image/png";
    return { bytes: rec.bytes, type: sniffRasterMime(rec.bytes) ?? headerType };
  }
  for (const cand of [...downscaleVariants(fullUrl), fullUrl]) {
    const got = await fetchBytes(cand);
    if (got && got.bytes.length <= IMG_CAP && got.type.startsWith("image/")) {
      return { bytes: got.bytes, type: sniffRasterMime(got.bytes) ?? got.type };
    }
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
async function browserRenderedHtml(u: string): Promise<{
  html: string;
  imgPriority: Record<string, { top: number; area: number }>;
  /** Nedladdnings-INSPELNINGEN (ägarbeslut 2026-07-28 "bygg båda"): bytesen
   *  browsern SJÄLV hämtade under renderingen, nyckel = slutlig URL. Inline-
   *  steget läser härifrån FÖRST — då spelar bot-väggar ingen roll (anyfin-
   *  klassen: browsern hade cookies/clearance) och varianten är exakt den
   *  som renderades. */
  assets: Map<string, { bytes: Uint8Array; type: string }>;
}> {
  // Render-primitiverna (anslut/goto/svep/avfärda modaler/stylad-koll) delas med
  // scale-test + render-fidelity via ./render-page — EN bevisad väg (Stagehand,
  // engine.server.ts), inte fyra kopior. Frysningen nedan är freeze-specifik
  // (bild-geometri + CSSOM) och stannar här.
  const { page, cleanup } = await acquireRenderPage();
  const assets = new Map<string, { bytes: Uint8Array; type: string }>();
  let assetBytes = 0;
  const ASSET_TOTAL_CAP = 25_000_000; // ägaren: kvalitet före utrymme
  const ASSET_FILE_CAP = 2_000_000;
  try {
    // Passiv nätverksavlyssning — läs svarskroppar direkt i handlern (CDP
    // bufferten töms snabbt). Får ALDRIG fälla renderingen: handler-kroppen
    // är try/catch-ad, och SJÄLVA REGISTRERINGEN kastar synkront på Stagehands
    // sid-proxy ("Unsupported event: response" — den stödjer bara ett urval
    // händelser; anyfin/tibber-varvet 2026-07-28 föll HELA browser-vägen på
    // det och degraderade tyst till statisk). Prova sida → kontext → mjuk
    // avstängning; utan inspelning tar in-page-reserven + curl över nedströms.
    const recordResponse = (res: PWResponse) => {
      void (async () => {
        try {
          if (assetBytes >= ASSET_TOTAL_CAP) return;
          const ct = (res.headers()["content-type"] ?? "").split(";")[0].trim();
          const url = res.url();
          const looksAsset =
            /^(image|font)\//.test(ct) ||
            /\.(woff2?|ttf|otf|png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(url);
          if (!looksAsset || res.status() !== 200) return;
          const buf = await res.body();
          if (buf.length === 0 || buf.length > ASSET_FILE_CAP) return;
          if (!assets.has(url)) {
            assets.set(url, { bytes: new Uint8Array(buf), type: ct || "application/octet-stream" });
            assetBytes += buf.length;
          }
        } catch {
          /* redirect-/stängd-kropp — hoppa */
        }
      })();
    };
    try {
      page.on("response", recordResponse);
    } catch {
      try {
        page.context().on("response", recordResponse);
        console.warn(
          "[freeze-page] inspelning via kontexten (sid-proxyn stödjer inte response-händelsen)",
        );
      } catch (err) {
        console.warn(
          `[freeze-page] nätverksinspelning otillgänglig (${err instanceof Error ? err.message : err}) — in-page-reserven + curl tar över`,
        );
      }
    }
    // Lazy-TVINGAREN (ägarbeslut 2026-07-28): Next/Nuxt-klassen sätter riktig
    // bildkälla först när IntersectionObserver säger "syns" — tibbers 20
    // 1×1-placeholders. Init-skriptet får varje observer att rapportera
    // allt som synligt DIREKT, innan sidans egna skript hunnit köra.
    try {
      await page.addInitScript(() => {
        const RealIO = window.IntersectionObserver;
        // @ts-expect-error — medveten override i sid-kontexten
        window.IntersectionObserver = class {
          private cb: IntersectionObserverCallback;
          constructor(cb: IntersectionObserverCallback) {
            this.cb = cb;
          }
          observe(el: Element) {
            const entry = {
              isIntersecting: true,
              intersectionRatio: 1,
              target: el,
              time: 0,
              boundingClientRect: el.getBoundingClientRect(),
              intersectionRect: el.getBoundingClientRect(),
              rootBounds: null,
            } as IntersectionObserverEntry;
            queueMicrotask(() => this.cb([entry], this as unknown as IntersectionObserver));
          }
          unobserve() {}
          disconnect() {}
          takeRecords() {
            return [];
          }
        };
        void RealIO;
      });
    } catch (err) {
      console.warn(`[freeze-page] lazy-tvingarens init-skript föll (${err}) — fortsätter utan`);
    }
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
    // Viewporten EFTER goto (morgonfyndet 2026-07-29): navigationen nollar
    // Stagehand-överriden till 1288×711 desktop — utan omtag här fångades
    // hela frysningen (geometri-pinnar, currentSrc-stämpling, ref-bild,
    // live-statistik) i desktop medan verifieringen renderar i 390×844.
    await applyRenderViewport(page);
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
    // Lazy-tvingarens efterpass: eager på allt, generiska data-src-bibliotek
    // befordras, och vi VÄNTAR in att varje bild faktiskt laddat (cap 8 s) —
    // serialisera aldrig medan källorna fortfarande är 1×1-placeholders.
    await page
      .evaluate(async () => {
        for (const img of Array.from(document.images)) {
          img.loading = "eager";
          (img as HTMLElement).setAttribute("decoding", "sync");
          const ds =
            img.getAttribute("data-src") ||
            img.getAttribute("data-lazy-src") ||
            img.getAttribute("data-original");
          const placeholderish =
            !img.src || img.src.startsWith("data:image/gif") || img.naturalWidth <= 2;
          if (ds && placeholderish) img.src = ds;
        }
        const pending = Array.from(document.images).filter((i) => !i.complete);
        await Promise.race([
          Promise.all(
            pending.map(
              (i) =>
                new Promise<void>((r) => {
                  i.addEventListener("load", () => r(), { once: true });
                  i.addEventListener("error", () => r(), { once: true });
                }),
            ),
          ),
          new Promise<void>((r) => setTimeout(r, 8_000)),
        ]);
      })
      .catch(() => {});
    await page.waitForTimeout(600);
    // Poster-BILDRUTAN (klarna/framer-klassen, 20-sajtssvepet 2026-07-28):
    // spelare utan poster-attribut har inget att baka in — den frysta kopian
    // visar en svart låda där videon var. Fånga en bildruta ur videon MEDAN
    // den är laddad i browsern: ljus-DOM-<video> får den som poster; skugg-
    // hostade videor (mux-kedjan är nästlad skugg-DOM) stämplar sin LJUSA
    // värd — skugginnehåll överlever aldrig serialiseringen, så bilden måste
    // bo på värdens bakgrund. CORS-tajntad canvas kastar SecurityError → den
    // videon hoppas ärligt (räknas och loggas). Aldrig ett fel som fäller.
    try {
      // Pass 1: väck oladdade kandidater (muted play startar preload=none).
      const unreadyCount = await page.evaluate(() => {
        const vids: HTMLVideoElement[] = [];
        const collect = (root: Document | ShadowRoot) => {
          for (const v of Array.from(root.querySelectorAll("video")))
            vids.push(v as HTMLVideoElement);
          for (const el of Array.from(root.querySelectorAll("*"))) {
            const sr = (el as Element).shadowRoot;
            if (sr) collect(sr);
          }
        };
        collect(document);
        let started = 0;
        for (const v of vids) {
          const r = v.getBoundingClientRect();
          if (r.width < 40 || r.height < 40) continue;
          if (v.readyState < 2) {
            v.muted = true;
            v.play().catch(() => {});
            started++;
          }
        }
        return started;
      });
      if (unreadyCount > 0) await page.waitForTimeout(1_200);
      // Pass 2: rita rutan (≤828 px bred, jpeg) och stämpla poster/bakgrund.
      const frames = await page.evaluate(() => {
        const out = { captured: 0, tainted: 0, unready: 0, marked: 0 };
        const vids: HTMLVideoElement[] = [];
        const collect = (root: Document | ShadowRoot) => {
          for (const v of Array.from(root.querySelectorAll("video")))
            vids.push(v as HTMLVideoElement);
          for (const el of Array.from(root.querySelectorAll("*"))) {
            const sr = (el as Element).shadowRoot;
            if (sr) collect(sr);
          }
        };
        collect(document);
        let budget = 12; // rutor à ~60–120 kB — räcker för alla rimliga sidor
        for (const v of vids) {
          if (budget <= 0) break;
          // Ljusa värden: vandra upp genom skugg-rötterna till dokumentet.
          let node: Element = v;
          let root = node.getRootNode();
          while (root instanceof ShadowRoot) {
            node = root.host;
            root = node.getRootNode();
          }
          const host = node === v ? null : node;
          const target = host ?? v;
          const r = target.getBoundingClientRect();
          if (r.width < 40 || r.height < 40) continue;
          // Riktig poster finns → poster-steget inlinear den; skriv aldrig över.
          if (!host && v.getAttribute("poster")) continue;
          if (
            host &&
            (host.getAttribute("poster") || (host.getAttribute("style") || "").includes("url("))
          ) {
            continue;
          }
          if (v.readyState < 2 || !v.videoWidth) {
            // Lazy-källa (framer-klassen: src sätts först i vy → readyState 0
            // vid fångsten). Märk för skott-vägen: scrollningen dit väcker
            // laddaren, play() startar den, och kompositorn skjuts när rutan
            // målats — samma räddning som taint-fallet.
            target.setAttribute("data-angel-frame", String(out.marked));
            out.marked++;
            out.unready++;
            continue;
          }
          try {
            const scale = Math.min(1, 828 / v.videoWidth);
            const c = document.createElement("canvas");
            c.width = Math.max(2, Math.round(v.videoWidth * scale));
            c.height = Math.max(2, Math.round(v.videoHeight * scale));
            const g = c.getContext("2d");
            if (!g) continue;
            g.drawImage(v, 0, 0, c.width, c.height);
            const uri = c.toDataURL("image/jpeg", 0.8); // kastar på CORS-tajnt
            if (uri.length < 200) continue; // tom ruta — inget värt att frysa
            if (host) {
              (host as HTMLElement).style.background = `center / cover no-repeat url(${uri})`;
              host.setAttribute("poster", uri); // spelare med JS visar den direkt online
            } else {
              v.setAttribute("poster", uri);
            }
            out.captured++;
            budget--;
          } catch {
            // CORS-tajnt: canvasen vägrar lämna ut pixlarna. Märk målet så
            // element-skottet (kompositorn, utanför taint-reglerna) tar det.
            target.setAttribute("data-angel-frame", String(out.marked));
            out.marked++;
            out.tainted++;
          }
        }
        return out;
      });
      // Element-SKOTTET (klarna-klassen: alla 7 spelare CORS-tajntade):
      // kompositorns pixlar lyder inte under canvas-taint. Första valet är
      // locator.screenshot() — men Stagehand-proxyn saknar locator (samma
      // klass som page.context: runda 1 föll 7/7 TYST — därav ska första
      // felet numera alltid loggas). Reserven bygger enbart på BEVISADE
      // primitiver: scrolla målet till mitten, ta helskärms-page.screenshot
      // (ref-skotten har bevisat den på Stagehand), beskär rutan I SIDAN via
      // canvas — en data-URI-bild är samma origin och tajntar aldrig.
      let shot = 0;
      if (frames.marked > 0) {
        let firstErr: string | null = null;
        const viewportCropShot = async (n: number): Promise<boolean> => {
          const r2 = await page.evaluate((idx: number) => {
            const el = document.querySelector(`[data-angel-frame="${idx}"]`);
            if (!el) return null;
            (el as HTMLElement).scrollIntoView({ block: "center" });
            // Lazy-källa-klassen: vyn väcker laddaren, play() startar rutan.
            const v =
              el.tagName === "VIDEO"
                ? (el as HTMLVideoElement)
                : (el.querySelector("video") as HTMLVideoElement | null);
            if (v) {
              v.muted = true;
              v.play().catch(() => {});
            }
            return null;
          }, n);
          void r2;
          await page.waitForTimeout(800);
          const rect = (await page.evaluate((idx: number) => {
            const el = document.querySelector(`[data-angel-frame="${idx}"]`);
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return {
              x: b.x,
              y: b.y,
              w: b.width,
              h: b.height,
              vw: window.innerWidth,
              vh: window.innerHeight,
            };
          }, n)) as { x: number; y: number; w: number; h: number; vw: number; vh: number } | null;
          if (!rect || rect.w < 40 || rect.h < 40) return false;
          const png = (await page.screenshot({ type: "png" })) as Buffer;
          const shotUri = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
          return (await page.evaluate(
            async ({
              idx,
              uri: u3,
              r,
            }: {
              idx: number;
              uri: string;
              r: { x: number; y: number; w: number; h: number; vw: number; vh: number };
            }) => {
              const el = document.querySelector(`[data-angel-frame="${idx}"]`);
              if (!el) return false;
              const im = await new Promise<HTMLImageElement>((res, rej) => {
                const i = new Image();
                i.onload = () => res(i);
                i.onerror = rej;
                i.src = u3;
              });
              const sx = im.width / r.vw; // DPR-kompensation
              const sy = im.height / r.vh;
              const c = document.createElement("canvas");
              c.width = Math.max(2, Math.round(r.w * sx));
              c.height = Math.max(2, Math.round(r.h * sy));
              const g = c.getContext("2d");
              if (!g) return false;
              g.drawImage(im, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, c.width, c.height);
              const u4 = c.toDataURL("image/jpeg", 0.8);
              if (u4.length < 200) return false;
              el.removeAttribute("data-angel-frame");
              if (el.tagName === "VIDEO") {
                el.setAttribute("poster", u4);
              } else {
                (el as HTMLElement).style.background = `center / cover no-repeat url(${u4})`;
                el.setAttribute("poster", u4);
              }
              return true;
            },
            { idx: n, uri: shotUri, r: rect },
          )) as boolean;
        };
        for (let n = 0; n < frames.marked && n < 14; n++) {
          let ok = false;
          try {
            const bytes = await page
              .locator(`[data-angel-frame="${n}"]`)
              .screenshot({ type: "jpeg", quality: 80, timeout: 6_000 });
            const uri = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
            ok = (await page.evaluate(
              ({ n: idx, uri: u2 }: { n: number; uri: string }) => {
                const el = document.querySelector(`[data-angel-frame="${idx}"]`);
                if (!el) return false;
                el.removeAttribute("data-angel-frame");
                if (el.tagName === "VIDEO") {
                  el.setAttribute("poster", u2);
                } else {
                  (el as HTMLElement).style.background = `center / cover no-repeat url(${u2})`;
                  el.setAttribute("poster", u2);
                }
                return true;
              },
              { n, uri },
            )) as boolean;
          } catch (err) {
            if (!firstErr)
              firstErr =
                err instanceof Error ? err.message.slice(0, 100) : String(err).slice(0, 100);
            ok = await viewportCropShot(n).catch((e2) => {
              if (!firstErr)
                firstErr =
                  e2 instanceof Error ? e2.message.slice(0, 100) : String(e2).slice(0, 100);
              return false;
            });
          }
          if (ok) shot++;
        }
        if (firstErr) console.warn(`[freeze-page] element-skottets första fel: ${firstErr}`);
        // Städa märken som blev kvar (misslyckade skott) — de ska aldrig
        // frysas — och återställ scrollen: bildprioriteringen läser rect.top
        // (above-fold-ordningen) och får inte ärva sista skottets position.
        await page
          .evaluate(() => {
            for (const el of Array.from(document.querySelectorAll("[data-angel-frame]"))) {
              el.removeAttribute("data-angel-frame");
            }
            window.scrollTo(0, 0);
          })
          .catch(() => {});
      }
      if (frames.captured + frames.marked > 0) {
        console.log(
          `[freeze-page] poster-bildrutor: ${frames.captured} fångade` +
            (shot ? `, ${shot} via element-skott` : "") +
            (frames.marked - shot > 0 ? `, ${frames.marked - shot} omålade` : "") +
            ` (${frames.tainted} tajntade, ${frames.unready} lazy-källor)`,
        );
      }
    } catch {
      /* bildrute-fångsten är best-effort */
    }
    // Ostylad render = trasig (sofi.com: CSS applicerades aldrig, bara nav-länkar).
    // Frys den ALDRIG — i --render=browser fäller det körningen, i auto behålls
    // hellre den statiska kopian (samma ärliga degradering som ett tomt skal).
    if (!(await pageLooksStyled(page))) {
      throw new Error(
        "renderad sida är ostylad (CSS applicerades aldrig) — ingen trogen kopia att frysa",
      );
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
        document.querySelectorAll(
          "mux-player, video, iframe[src*='vimeo'], iframe[src*='youtube']",
        ),
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
      // src ← currentSrc (inspelnings-nyckeln): browsern laddade srcset-valet,
      // inte nödvändigtvis src-attributet — stämpla SANNINGEN som src så
      // inline-steget slår upp exakt den URL inspelningen bär.
      for (const img of Array.from(document.images)) {
        if (img.currentSrc && !img.currentSrc.startsWith("data:")) {
          img.setAttribute("src", img.currentSrc);
        }
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
      let refOk = false;
      try {
        // fullPage UTAN clip (körningsfynd 2026-07-28: Stagehands playwright
        // vägrar kombinationen — "clip and fullPage cannot be used together";
        // lokala 1.60 tillät den och sanity-testet missade skillnaden).
        // Höjd-cappningen sker i stället i jämförelsen: fidelity-skriptet
        // jämför över bildernas MINSTA gemensamma höjd (fryst-sidan cappas
        // 8000px), så en lång referens beskärs implicit där.
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        // Stagehand skapar INTE föräldrakatalogen vid filskrivning (lokala
        // Playwright gör det — ENOENT-fyndet 13:17): skapa den själv.
        mkdirSync(dirname(refShot), { recursive: true });
        // Om-hävda viewporten omedelbart före facit-bilden — frys-stegen mellan
        // goto och hit kan tappa överriden (20-sajtsvepet 29/7: ref i desktop).
        await applyRenderViewport(page);
        await page.screenshot({ path: refShot, type: "png", fullPage: true });
        // PNG-vittnet: IHDR bär bildens FAKTISKA bredd — skärmdumpsvägen kan
        // avvika från innerWidth (captureBeyondViewport ignorerar ibland
        // emuleringen), så måtten läses ur filen, aldrig antas.
        const ihdr = readFileSync(refShot);
        const refW = ihdr.readUInt32BE(16);
        const refH = ihdr.readUInt32BE(20);
        console.log(
          `[freeze-page] referensbild → ${refShot} (${refW}×${refH}px, ${h}px scrollhöjd)`,
        );
        refOk = refW === RENDER_VIEWPORT.width;
      } catch (err) {
        console.warn(`[freeze-page] referensbild föll: ${err}`);
      }
      // Facit-reserven: kan sessionen inte leverera målbredden (Browserbase-
      // gatewayen neutraliserar Emulation-överriden efter navigation — svepet
      // 29/7) tas referensen om i LOKAL chromium vid samma bredd som frysta
      // kopians rendering, så pixel-banden jämför lika mot lika. Priset
      // redovisas i loggen: bilden delar inte frys-sessionen (annan IP/AB-
      // hink kan ge innehållsvarians) — hellre det än ett desktop-facit.
      if (!refOk) {
        console.warn(
          `[freeze-page] sessionen gav inte ${RENDER_VIEWPORT.width}px — tar om facit i lokal chromium (nät på, delar inte frys-sessionen)`,
        );
        try {
          const { chromium } = await import("playwright-core");
          const lb = await chromium.launch({
            headless: true,
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
            args: ["--no-sandbox"],
          });
          try {
            const lp = await lb.newPage({ viewport: { ...RENDER_VIEWPORT }, userAgent: RENDER_UA });
            await gotoTolerant(lp, u);
            await lp.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
            await lp.waitForTimeout(1_200);
            await dismissOverlays(lp);
            await autoScroll(lp);
            await lp.waitForTimeout(800);
            await lp.screenshot({ path: refShot, type: "png", fullPage: true });
            const d = readFileSync(refShot);
            console.log(
              `[freeze-page] referensbild (lokal reserv) → ${refShot} (${d.readUInt32BE(16)}×${d.readUInt32BE(20)}px)`,
            );
          } finally {
            await lb.close().catch(() => {});
          }
        } catch (err) {
          console.warn(
            `[freeze-page] lokala facit-reserven föll (${err}) — sessionens bild behålls`,
          );
        }
      }
    }
    // Live-STATISTIK för paritetskollen (ägarens "dubbelkolla på fler än 1
    // sätt", 2026-07-28): rubriker/text/länk- och bildantal ur den LEVANDE
    // renderade sidan — facit som den frysta kopians offline-rendering sedan
    // jämförs mot (scripts/diag/freeze-parity.ts). Oberoende av mediemåttet:
    // räknar INNEHÅLL, inte pixlar eller medieelement.
    const statsOut = arg("stats-out");
    if (statsOut) {
      try {
        const stats = await page.evaluate(() => ({
          title: (document.title || "").slice(0, 200),
          headings: Array.from(document.querySelectorAll("h1, h2, h3"))
            .map((h) => (h.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .slice(0, 60),
          textChars: (document.body?.innerText || "").replace(/\s+/g, " ").trim().length,
          links: document.querySelectorAll("a[href]").length,
          images: document.images.length,
        }));
        mkdirSync(dirname(statsOut), { recursive: true });
        writeFileSync(statsOut, JSON.stringify(stats, null, 2));
        console.log(
          `[freeze-page] live-statistik → ${statsOut} (${stats.headings.length} rubriker, ${stats.textChars} tecken, ${stats.links} länkar)`,
        );
      } catch (err) {
        console.warn(`[freeze-page] live-statistik föll: ${err}`);
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
    // In-page-fetch-RESERVEN (anyfin-klassen, försäkring om response.body()
    // inte bär genom Stagehand-proxyn): bilder som inspelningen saknar hämtas
    // om INNE i sidans kontext — med sidans cookies/clearance — och läggs i
    // samma karta. URL-listan tas ur den SERIALISERADE HTML:en, inte ur en ny
    // DOM-läsning (lovable-fyndet 2026-07-28: karusellen bytte src mellan
    // serialisering och reserv, så reserven hämtade fel uppsättning och tre
    // synliga kort förblev länkade). Samma decode+abs som inbaknings-loopen ⇒
    // nycklarna matchar garanterat. Batchar med partiellt resultat (en lång-
    // sam batch kostar bara sig själv, inte allt). Aldrig ett fel som fäller.
    try {
      const missing = [
        ...new Set(
          [...outHtml.matchAll(/<img\b[^>]+src=["']([^"']+)["']/gi)]
            .map((m) => m[1])
            .filter((s) => !s.startsWith("data:"))
            .map((s) => {
              try {
                return abs(decodeEntities(s));
              } catch {
                return "";
              }
            })
            .filter(Boolean),
        ),
      ];
      const want = missing.filter((u2) => !assets.has(u2)).slice(0, 60);
      let got = 0;
      for (let i = 0; i < want.length; i += 12) {
        const batch = want.slice(i, i + 12);
        const fetched = (await Promise.race([
          page.evaluate(async (urls: string[]) => {
            const grab = async (url: string) => {
              try {
                const r = await fetch(url, { credentials: "include" });
                if (!r.ok) return null;
                const blob = await r.blob();
                if (blob.size === 0 || blob.size > 2_000_000) return null;
                const b64 = await new Promise<string>((res, rej) => {
                  const fr = new FileReader();
                  fr.onload = () => res(String(fr.result));
                  fr.onerror = rej;
                  fr.readAsDataURL(blob);
                });
                return { url, b64: b64.split(",")[1] ?? "", type: blob.type || "image/png" };
              } catch {
                return null; /* CORS/nät — nästa */
              }
            };
            return (await Promise.all(urls.map(grab))).filter(
              (x): x is { url: string; b64: string; type: string } => !!x,
            );
          }, batch),
          new Promise<Array<{ url: string; b64: string; type: string }>>((r) =>
            setTimeout(() => r([]), 8_000),
          ),
        ])) as Array<{ url: string; b64: string; type: string }>;
        for (const f of fetched) {
          if (f.b64 && !assets.has(f.url)) {
            assets.set(f.url, {
              bytes: new Uint8Array(Buffer.from(f.b64, "base64")),
              type: f.type,
            });
            got++;
          }
        }
      }
      if (want.length > 0) {
        console.log(`[freeze-page] in-page-reserven hämtade ${got}/${want.length} bilder`);
      }
    } catch {
      /* reserven är best-effort */
    }
    return { html: outHtml, imgPriority: priority, assets };
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
    // Retry med FÄRSK session (körningsfynd 2026-07-28, voi 13:09: "renderad
    // sida är ostylad" — samma sajt var perfekt 25 min tidigare; ostylat är
    // ofta en CSS-race i just den sessionen, inte sajtens natur). Ett nytt
    // försök innan ärlig degradering till statisk kopia.
    let rendered: Awaited<ReturnType<typeof browserRenderedHtml>> | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 2 && !rendered; attempt++) {
      try {
        rendered = await browserRenderedHtml(url);
      } catch (err) {
        lastErr = err;
        if (attempt < 2) {
          console.warn(
            `[freeze-page] browser-försök ${attempt} föll (${err}) — nytt försök med färsk session`,
          );
        }
      }
    }
    if (!rendered) throw lastErr;
    html = rendered.html;
    imgPriority = rendered.imgPriority;
    for (const [k, v] of rendered.assets) recordedAssets.set(assetKey(k), v);
    if (rendered.assets.size > 0) {
      const kb = Math.round(
        [...rendered.assets.values()].reduce((a, x) => a + x.bytes.length, 0) / 1000,
      );
      console.log(
        `[freeze-page] inspelningen: ${rendered.assets.size} assets à ${kb} kB från browsern`,
      );
    }
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

// 2c) Placeholder med målad tvilling (tibber-fyndet 2026-07-28): looping-
//     karuseller klonar slides INNAN hydrering — klonens <img> behåller
//     1×1-gif-placeholdern för evigt (ingen React-fiber → src byts aldrig),
//     medan originalet med SAMMA alt-text målar (tibber: 13/13 tomma hade
//     en målad alt-tvilling). Kopiera tvillingens src (data: före https)
//     till placeholdern: samma alt = samma avsedda bild. Körs FÖRE bild-
//     inbakningen så https-promoterade tvillingar flödar in i loopen nedan
//     och blir data-URI:er (tvillingar delar src-värde → replaceSrc målar
//     båda). Per-tagg, ALDRIG via replaceSrc — alla placeholders delar
//     exakt samma gif-värde. Tomt alt ("") deltar aldrig (dekor).
const TINY_GIF = "R0lGODlhAQABAIAAAAAAAP"; // den universella 1×1-transparenta gifen
const isPlaceholderSrc = (s: string) =>
  s.includes(TINY_GIF) || (s.startsWith("data:image/gif;base64,") && s.length < 120);
const altBest = new Map<string, string>();
for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
  const altT = /\balt=["']([^"']+)["']/i.exec(m[0])?.[1]?.trim();
  const srcT = /\bsrc=["']([^"']+)["']/i.exec(m[0])?.[1];
  if (!altT || !srcT || isPlaceholderSrc(srcT)) continue;
  const real = (srcT.startsWith("data:image/") && srcT.length > 200) || /^https?:/.test(srcT);
  if (!real) continue;
  const prev = altBest.get(altT);
  if (!prev || (prev.startsWith("http") && srcT.startsWith("data:"))) altBest.set(altT, srcT);
}
let twinsPromoted = 0;
html = html.replace(/<img\b[^>]*>/gi, (tag) => {
  const altT = /\balt=["']([^"']+)["']/i.exec(tag)?.[1]?.trim();
  const srcT = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
  if (!altT || !srcT || !isPlaceholderSrc(srcT)) return tag;
  const twin = altBest.get(altT);
  if (!twin || twin === srcT) return tag;
  twinsPromoted++;
  return tag.replace(srcT, () => twin); // funktion: twin får innehålla $-sekvenser
});

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
const CSS_ASSET_BUDGET = 8_000_000; // sats-fyndet: 26 hero-ytor i style-attribut — 4 MB svalt
let cssAssetBytes = 0;
let cssAssetsInlined = 0;
const cssRefs = new Set(
  [...html.matchAll(/url\(\s*(['"]?)((?:https?:)?\/\/[^'")]+|\/[^'")]+)\1\s*\)/gi)]
    .map((m) => m[2])
    .filter((s) => !s.startsWith("data:")),
);
// Sats-fyndet (20-sajtssvepet, natten mot 2026-07-29): style-ATTRIBUTENS
// url() är dubbelt entitetskodade i serialiserad HTML — citatet är &quot;
// och query-strängens & är &amp; (url(&quot;…?f=center&amp;w=1273…&quot;)).
// Regexen ovan kräver riktiga citattecken → 26/27 bakgrunder förblev
// länkade och sajten frös till 3,7 %. Fånga båda entitetsformerna; hämtning
// sker som alltid AVKODAT, ersättning på RÅFORMEN.
for (const re of [/url\(&quot;(.+?)&quot;\)/gi, /url\(&#0?39;(.+?)&#0?39;\)/gi]) {
  for (const m of html.matchAll(re)) {
    const raw = m[1];
    const dec = decodeEntities(raw).trim();
    if (/^(https?:)?\/\//.test(dec) || dec.startsWith("/")) cssRefs.add(raw);
  }
}
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
      ? full.match(/\.woff2/i)
        ? "font/woff2"
        : full.match(/\.woff/i)
          ? "font/woff"
          : "font/ttf"
      : got.type.split(";")[0];
    const dataUri = `data:${mime};base64,${b64(got.bytes)}`;
    // url() kan vara ociterad, citerad eller ENTITETSCITERAD (style-attribut:
    // &quot;/&#39; — sats-fyndet) — täck alla råformer; no-op där formen saknas.
    html = html
      .split(`url(${ref})`)
      .join(`url(${dataUri})`)
      .split(`url("${ref}")`)
      .join(`url("${dataUri}")`)
      .split(`url('${ref}')`)
      .join(`url('${dataUri}')`)
      .split(`url(&quot;${ref}&quot;)`)
      .join(`url(&quot;${dataUri}&quot;)`)
      .split(`url(&#39;${ref}&#39;)`)
      .join(`url(&#39;${dataUri}&#39;)`);
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
  `[freeze-page] ${url} → ${out} (${renderedVia}, ${html.length} bytes, ${links.length} stilmallar inlinade, ${inlined}/${imgSrcs.size} bilder à ${Math.round(spentBytes / 1e3)} kB, ${twinsPromoted} tvilling-promoveringar, ${postersInlined} video-poster, ${cssAssetsInlined} css-assets à ${Math.round(cssAssetBytes / 1e3)} kB)`,
);
