// Delad RENDER-väg för alla capture-verktyg (freeze-page, scale-test, capture-
// test, render-fidelity). Tidigare bar var och en sin egen kopia av "anslut →
// goto → svep → serialisera" — capture-test #1–4 lärde ut den rätta vägen fyra
// gånger om. Här bor den EN gång:
//   • acquireRenderPage  — rå Playwright över Browserbase-sessionens connectUrl
//     (Stagehand-facaden pensionerad från render-vägen 29/7: dess viewport-
//     kanal var död efter goto), läck-säker; lokal Chromium som fallback i dev.
//   • gotoTolerant       — goto som tål timeout-felformer bortom Playwrights
//     egen klass (behållet: ofarligt, och skyddar äldre anropare).
//   • autoScroll         — lazy-svep så under-folden renderas, sedan till toppen.
//   • dismissOverlays    — SÄKER modal-avfärdare (Escape + kurerade stäng-klick,
//     ALDRIG signup/login/checkout) så cookie-/auth-/e-postmodaler inte förorenar
//     fångsten (fidelitetstestet 2026-07-26: ~5 renders doldes av centrerade modaler).
//   • pageLooksStyled    — fångar trasiga renders (sofi.com renderade en OSTYLAD
//     nav-DOM utan CSS — golv-count-måttet missade det helt).

import type { Browser, Page, Response } from "playwright-core";

import { serializeVisibleHtml } from "./visible-dom";

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

/** Sätt render-viewporten (390×844 = pipelinens verifierings-viewport) så den
 *  BITER på båda sid-typerna. Stagehands sid-proxy tar POSITIONELLA (w, h) och
 *  sväljer tyst Playwright-objektformen {width,height} (CDP-felet .catch:as
 *  bort internt); lokala Playwright tar objektformen och kastar på positionell.
 *  Prova därför positionellt FÖRST — provades objektformen först skulle
 *  Stagehand-vägen "lyckas" tyst och aldrig nå fallbacken. Navigationer nollar
 *  dessutom Stagehand-överriden till defaulten 1288×711, så anropet måste ske
 *  EFTER goto (morgonfyndet 2026-07-29: varje live-referens i 20-sajtsvepet
 *  var desktop-bred medan frysta kopian sköts i 390 — "ena i dator, andra i
 *  telefon"). Samma läxa som runner.server.ts, nu på delade render-vägen. */
export const RENDER_VIEWPORT = { width: 390, height: 844 } as const;

export async function applyRenderViewport(
  page: Page,
  width: number = RENDER_VIEWPORT.width,
  height: number = RENDER_VIEWPORT.height,
): Promise<number> {
  const mät = async () =>
    (await page.evaluate(() => window.innerWidth).catch(() => 0)) as number;
  try {
    await (
      page as unknown as { setViewportSize: (w: number, h: number) => Promise<void> }
    ).setViewportSize(width, height);
  } catch {
    await page.setViewportSize({ width, height }).catch(() => {});
  }
  await page.waitForTimeout(400).catch(() => {}); // reflow settle
  let w = await mät();
  if (w !== width) {
    // CDP-hammaren, UTAN tyst catch så det verkliga felet når loggen. Två
    // kanaler: Stagehand-facadens mainSession (om sidan är en facad) eller en
    // äkta newCDPSession (ren Playwright). Kanariefyndet 29/7: facadens kanal
    // "lyckas" utan effekt efter goto — därför mäts utfallet, aldrig antas.
    const override = {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
      positionX: 0,
      positionY: 0,
      scale: 1,
    };
    try {
      const facade = (
        page as unknown as { mainSession?: { send: (m: string, p?: object) => Promise<unknown> } }
      ).mainSession;
      if (facade) await facade.send("Emulation.setDeviceMetricsOverride", override);
      else {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setDeviceMetricsOverride", override);
      }
    } catch (err) {
      console.warn(
        `[render] CDP-överriden nekades: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`,
      );
    }
    await page.waitForTimeout(400).catch(() => {});
    w = await mät();
  }
  if (w === width) console.log(`[render] viewport ${width}×${height} verifierad (innerWidth=${w})`);
  else
    console.warn(
      `[render] VARNING: viewporten bet inte — innerWidth=${w}, mål ${width}. Bilder fångas i fel enhet.`,
    );
  return w;
}

/** Skaffa en render-sida: Browserbase (Stagehand, bevisad väg) när creds finns,
 *  annars lokal Chromium. Returnerar sidan + en cleanup som ALLTID släpper
 *  sessionen (kastar init:en läcker den aldrig). OBS: viewporten här gäller
 *  bara FRAM TILL första navigationen — anropa applyRenderViewport efter goto. */
export async function acquireRenderPage(): Promise<{ page: Page; cleanup: () => Promise<void> }> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (apiKey && projectId) {
    // Stagehand för ANSLUTNINGEN (kanarie 2–3 29/7: chromium.connectOverCDP
    // når aldrig gatewayens ws-handshake — Stagehands egen ws-klient med
    // headers gör det). Sidan lever på stagehand.context, INTE stagehand.page
    // (undefined i Stagehand 3.x; capture-test #3 föll 8/8).
    const { createSession, closeSession } = await import("../../src/lib/tests/browserbase.server");
    const { Stagehand } = await import("@browserbasehq/stagehand");
    const session = await createSession({ viewport: RENDER_VIEWPORT });
    const stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey,
      projectId,
      browserbaseSessionID: session.id,
      // Stagehands configuredViewport läses HÄRIFRÅN (v3.js), aldrig ur den
      // faktiska sessionens inställningar — utan detta bokför facaden sin
      // default 1288×711.
      browserbaseSessionCreateParams: {
        projectId,
        browserSettings: { viewport: { width: RENDER_VIEWPORT.width, height: RENDER_VIEWPORT.height } },
      },
      keepAlive: true,
      disablePino: true,
    });
    const cleanup = async () => {
      await stagehand.close().catch(() => {});
      await closeSession(session.id).catch(() => {});
    };
    try {
      await stagehand.init();
      const page = (stagehand.context.pages()[0] ?? (await stagehand.context.newPage())) as unknown as Page;
      // Sond FÖRE all emulering: sessionens FYSISKA mått avgör om server-
      // sidans browserSettings.viewport togs emot (390) eller ignorerades
      // (1288) — det skiljer emuleringsfel från sessionskonfigurationsfel.
      const dims = await page
        .evaluate(() =>
          [window.innerWidth, window.innerHeight, window.outerWidth, screen.width, screen.height].join("/"),
        )
        .catch(() => "?");
      console.log(`[render] sessionens råmått innerW/innerH/outerW/screenW/screenH: ${dims}`);
      await applyRenderViewport(page); // för mätningar före goto
      return { page, cleanup };
    } catch (err) {
      await cleanup();
      throw err;
    }
  }
  const { chromium } = await import("playwright-core");
  const exec = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser: Browser = await chromium.launch({ headless: true, executablePath: exec });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: UA });
  return { page, cleanup: async () => void (await browser.close().catch(() => {})) };
}

/** goto som tål Stagehands timeout (INTE en playwright errors.TimeoutError-
 *  instans) genom att även matcha på meddelandet — tunga SPA:er serialiseras på
 *  renderat läge. Ett hårt navigationsfel (net::ERR_...) har ingen DOM och kastar.
 *  Returnerar responsen (eller null vid timeout) så anroparen kan grinda på status. */
export async function gotoTolerant(page: Page, url: string, timeoutMs = 45_000): Promise<Response | null> {
  const { errors } = await import("playwright-core");
  return page.goto(url, { waitUntil: "load", timeout: timeoutMs }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (!(err instanceof errors.TimeoutError) && !/tim(?:e|ed)\s*[- ]?out/i.test(msg)) throw err;
    return null;
  });
}

/** Svep genom sidan så lazy-innehåll renderas, scrolla sedan tillbaka till toppen. */
export async function autoScroll(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      await new Promise((resolve) => {
        let y = 0;
        const t = setInterval(() => {
          window.scrollBy(0, 900);
          y += 900;
          if (y >= document.body.scrollHeight - 1200 || y > 40000) {
            clearInterval(t);
            window.scrollTo(0, 0);
            resolve(null);
          }
        }, 80);
      });
    })
    .catch(() => {});
  await page.waitForTimeout(800).catch(() => {});
}

/** Avfärda cookie-/auth-/e-post-/onboarding-modaler så fångsten (och en ev.
 *  skärmbild) blir ren. Escape stänger många dialoger; sedan klickas en KURERAD
 *  vitlista av stäng-kontroller (cookie accept/reject, close, "no thanks").
 *  ALDRIG signup/login/checkout/continue — de navigerar eller binder. Exakta,
 *  korta etiketter (≤28 tecken). Säker att köra även när ingen modal finns. */
export async function dismissOverlays(page: Page): Promise<void> {
  // HELA kroppen är best-effort och FÅR ALDRIG kasta — en avfärdning som fäller
  // fångsten är värre än en kvarvarande modal. page.keyboard finns inte på
  // Stagehands context-sida (render-fidelity #2 föll 38/38 på ett SYNKRONT kast
  // från page.keyboard.press innan .catch hann fästa), så vägen till klick-
  // avfärdaren (page.evaluate, som garanterat finns) måste överleva det.
  try {
    for (let k = 0; k < 2; k++) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(120).catch(() => {});
    }
  } catch {
    /* ingen keyboard på denna sida — hoppa Escape, klick-avfärdaren räcker */
  }
  await page
    .evaluate(() => {
      // REJECT-först (freeze-testfynd 2026-07-28, tibber: svensk CMP täckte
      // hela fångsten): avvisa-knappar klickas FÖRE acceptera-knappar — det
      // är integritetskorrekt och stänger dialogen lika bra. Svenska/nordiska
      // etiketter med i båda listorna; gamla platta listan såg bara engelska.
      const REJECT = new Set([
        "reject all", "reject non-essential cookies", "decline optional", "decline all",
        "avvisa alla", "avvisa", "neka alla", "neka", "endast nödvändiga",
        "bara nödvändiga", "only necessary", "necessary only", "avslå alla",
        "no thanks", "no, thanks", "not now", "maybe later", "dismiss", "close",
        "stäng", "×", "✕", "✖",
      ]);
      const ACCEPT = new Set([
        "accept all", "accept all cookies", "accept cookies", "accept", "allow all",
        "agree", "i agree", "got it", "i understand", "ok", "okay",
        "tillåt alla", "acceptera", "acceptera alla", "godkänn", "godkänn alla",
        "jag förstår", "jag godkänner",
      ]);
      const DENY =
        /sign|log\s?in|subscribe|check\s?out|\bbuy\b|add to|get started|continue with|create account|start free|\btry\b/i;
      const clickPass = (labels: Set<string>): boolean => {
        let clicked = false;
        const seen = new Set<string>();
        for (const el of Array.from(document.querySelectorAll('button,[role="button"],[aria-label]'))) {
          const raw = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
          const label = raw.toLowerCase();
          if (!label || label.length > 28 || seen.has(label)) continue;
          if (DENY.test(label) || !labels.has(label)) continue;
          seen.add(label);
          try {
            (el as HTMLElement).click();
            clicked = true;
          } catch {
            /* ignore */
          }
        }
        return clicked;
      };
      // Accept-passet körs bara när inget avvisades — aldrig båda i samma dialog.
      if (!clickPass(REJECT)) clickPass(ACCEPT);
    })
    .catch(() => {});
  await page.waitForTimeout(400).catch(() => {});
}

/** Ser den renderade sidan stylad ut? En trasig render (sofi.com i fidelitets-
 *  testet: CSS applicerades aldrig, bara ostylade nav-länkar) har ~inga
 *  CSSOM-regler. Cross-origin-ark kastar vid läsning → räkna dem som stylade
 *  (undvik falsk-avvisning). Fail-open: kan vi inte mäta antar vi stylad. */
export async function pageLooksStyled(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      let rules = 0;
      for (const s of Array.from(document.styleSheets)) {
        try {
          rules += s.cssRules.length;
        } catch {
          rules += 50; // cross-origin, oläsbart → anta stylat
        }
      }
      return rules >= 20; // en riktig sida har hundratals; en ostylad DOM ~0
    })
    .catch(() => true);
}

export interface RenderCapture {
  html: string;
  title: string;
  text: string;
  styled: boolean;
}

/** Full lättviktig render→fångst: anslut, goto (tålig), avfärda modaler, svep,
 *  avfärda igen, ev. skärmbild, serialisera synlig DOM + plocka title/innerText/
 *  stylad-flagga. Läck-säker. null vid anslutnings-/renderfel. (Freeze-page
 *  använder primitiverna ovan direkt — den behöver bild-geometri + CSSOM.) */
export async function renderVisibleCapture(
  url: string,
  opts: { screenshotPath?: string } = {},
): Promise<RenderCapture | null> {
  let cleanup = async () => {};
  try {
    const rp = await acquireRenderPage();
    cleanup = rp.cleanup;
    const page = rp.page;
    // Bara anslutning (ovan) och serialisering (nedan) får nulla fångsten. Allt
    // däremellan är tolerans-/förbättringssteg — ett kast där ska ALDRIG kosta
    // hela rendern (render-fidelity #2: en modal-avfärdning nullade 38/38).
    await gotoTolerant(page, url).catch(() => {}); // partiell render dugar att serialisera
    await applyRenderViewport(page); // navigationen nollade Stagehand-överriden
    await dismissOverlays(page); // rensa load-tids-modaler före svepet (throw-proof)
    await autoScroll(page);
    await dismissOverlays(page); // och de som dök upp under svepet
    if (opts.screenshotPath) await page.screenshot({ path: opts.screenshotPath }).catch(() => {});
    const title = ((await page.title().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    const rawText = (await page.evaluate(() => document.body?.innerText || "").catch(() => "")) as string;
    const styled = await pageLooksStyled(page);
    const html = await serializeVisibleHtml(page);
    return { html, title, text: (rawText || "").replace(/\s+/g, " ").trim(), styled };
  } catch (e) {
    // Surfaca felet (render-fidelity #2 svalde det → 38/38 "RENDER-FAIL" utan orsak).
    console.warn(`[render] ${url} capture failed: ${(e as Error)?.message?.replace(/\s+/g, " ").slice(0, 140)}`);
    return null;
  } finally {
    await cleanup();
  }
}
