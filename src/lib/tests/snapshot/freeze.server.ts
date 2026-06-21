// Freeze a live site into corpus/<name>/ for snapshot regression testing.
//
// Capture flow (Browserbase so viewport + UA match prod):
//   goto -> settle -> wait for consent selector visible -> [optional before-screenshot]
//   -> click consent -> assert banner detached/hidden -> measure postDismissDomHits
//   -> lazy-scroll -> CDP Page.captureSnapshot (MHTML) -> screenshot -> meta.json
//   -> ALWAYS write freeze-report.json (in finally — receipt survives hard fails)
//
// MHTML inlines stylesheets/images/fonts so replay sees the same CSSOM the
// collector saw at capture time. page.content() would NOT do this — its
// external <link> references would re-fetch live (or fall back to UA defaults),
// breaking salience / contrast / visibility checks.

import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Stagehand } from "@browserbasehq/stagehand";

import { createSession, closeSession } from "../browserbase.server";
import { embedMhtmlFonts } from "./mhtml-fonts.server";
import {
  MHTML_INLINE_THRESHOLD_BYTES,
  uploadAsset,
  type AssetPointer,
} from "./externalize.server";

// Must match the viewport Browserbase uses for live test runs so aboveFold /
// section bucketing in golden.json matches what the live engine produces.
export const FREEZE_VIEWPORT = { width: 1280, height: 720 } as const;

// Substrings vi observerar i post-dismiss-DOM. Lowercase — haystack lowercases:as
// före match. OBSERVATION-only: ingen hård gate här. När vi har baseline från
// 3–4 siter kan vi promovera "accept all"/"decline all"/"reject all" till gate.
// "cookie" behålls för observation men ska ALDRIG bli gate — matchar footer-
// policy-länkar som är legitima.
const POST_DISMISS_NEEDLES = ["accept all", "decline all", "reject all", "cookie"] as const;

export interface FreezeOptions {
  url: string;
  name: string;
  consentSelector?: string;
  consentDismissCheck?: "detached" | "hidden";
  consentInstruction?: string;
  /** iframe-based CMP (e.g. Sourcepoint `sp_message_iframe`): the accept button
   *  lives inside this iframe, so it's clicked via frameLocator and dismissal is
   *  verified by the iframe detaching. consentSelector is the button locator
   *  INSIDE the frame and MUST be an XPath (Stagehand's frame locator resolves
   *  xpath, not CSS) — e.g. `//button[contains(normalize-space(.),"Godkänn alla")]`.
   *  Verified 2026-06-20 on aftonbladet (Sourcepoint). */
  consentFrame?: string;
  outDir?: string;
  notes?: string;
  /** Skip writes to corpus/. Receipt still written to /tmp. */
  dryRun?: boolean;
  /** Extra screenshot before consent click — visual sanity for matchCountBeforeClick. */
  screenshotBeforeDismiss?: boolean;
  /** CSS selectors removed from the DOM right before captureSnapshot — see
   *  SiteSpec.removeSelectors. Determinism: strips inconsistently-injected
   *  third-party overlays so structure is identical across captures. */
  removeSelectors?: string[];
}

export interface FreezeResult {
  dir: string;
  mhtmlBytes: number;
  screenshotBytes: number;
  reportPath: string;
  ok: boolean;
}

interface FreezeReport {
  ok: boolean;
  error: string | null;
  dryRun: boolean;
  consent: {
    selector: string | null;
    dismissCheck: "detached" | "hidden" | null;
    matchCountBeforeClick: number | null;
    visibleBeforeClick: boolean | null;
    dismissedAfterMs: number | null;
    postDismissDomHits: Record<string, number> | null;
  };
  capture: {
    mhtmlKb: number;
    screenshotKb: number;
    beforeDismissScreenshotPath: string | null;
    /** Heavy-SPA escape hatch: the `load` event never fired within the goto
     *  budget so capture proceeded on domcontentloaded. assertCaptureValid is
     *  the backstop. null = load fired normally. */
    loadStateDegraded: boolean | null;
    // A2 — font-embedding (post-capture rewrite, see mhtml-fonts.server.ts).
    // externalFontSrcCount is the form-agnostic success gate per plan
    // beslutspunkt 3: must be 0 after rewrite. embeddedFontCount and
    // fetchFailures are diagnostics; mhtmlKbBeforeFontEmbed lets us see
    // the size delta the embedding added.
    externalFontSrcCount: number | null;
    /** The http(s) font URLs still present after the A2 rewrite (≤20, deduped) —
     *  self-diagnosing companion to externalFontSrcCount. */
    unembeddedFontUrls: string[] | null;
    embeddedFontCount: number | null;
    mhtmlKbBeforeFontEmbed: number | null;
    fontFetchFailures: { url: string; error: string }[] | null;
    /** Unika @font-face-familjenamn i den slutliga MHTML:en. Render-canary
     *  i replay läser denna lista för att avgöra vilka familjer som måste
     *  faktiskt resolva. */
    embeddedFamilies: string[] | null;
    /** Commit 4 — Per-hink token-occurrence-räknare (INTE distinkta-på-resolved).
     *  Speglar embedded.fontUrlSummary. För korpus-grep: "har sajten relativa
     *  font-URLer alls" / "hur många oresolverbara". Skriven även när sajter
     *  har hink 4 — embedMhtmlFonts kastar inte på hink-4-grenen. */
    fontUrls: {
      embedded: number;
      absolute: number;
      relativeResolved: number;
      unresolvable: Array<{
        original: string;
        reason: "no-base" | "invalid-base";
        partIndex: number;
      }>;
    } | null;
    // Stora MHTML (> MHTML_INLINE_THRESHOLD_BYTES) skickas till CDN via
    // lovable-assets i stället för att skrivas till repo (10 MB-tak). Pekaren
    // hamnar i page.mhtml.asset.json bredvid där page.mhtml hade legat.
    // `externalized` är source of truth för replayCorpus (harness läser
    // freeze-report.json, inte fil-närvaro).
    externalized: boolean;
    externalAssetUrl: string | null;
    externalAssetSha256: string | null;
    // True om vi tog bort en stale lokal page.mhtml som en del av write-steget
    // (site flyttades över tröskeln) eller stale .asset.json (site flyttades
    // under tröskeln). Loggas så att övergångar är spårbara.
    removedStaleLocalMhtml: boolean;
    removedStalePointer: boolean;
  };
  /**
   * A+C proveniens: capture-env stämplas in. Detta är OBSERVATION, ingen
   * enforcement — Chromium-versionen från Browserbase kan drifta över tid,
   * och det är ok eftersom score = f(frusen DOM, extractor_vN) inte beror
   * på vilken Chromium som råkade producera DOM:en. Stämpeln finns för att
   * vi i efterhand ska kunna se VILKEN Chromium en gammal snapshot frystes
   * under, inte för att tvinga konsistens.
   */
  env: {
    source: "browserbase";
    chromiumVersion: string | null;
    viewport: { width: number; height: number };
    frozenAt: string; // ISO
  } | null;
  /**
   * Grind 2 — Failure-taxonomy. `null` om freezen lyckades OCH assertCaptureValid
   * passerade. Annars en av de klassificerade strängarna nedan. `"unknown"` är
   * förbjudet i en grön breadth-rapport — om vi ser den måste klassificeraren
   * utökas, inte rapporten dölja symptomet.
   *
   * "captured-wrong-page" fångas av positiv content-assertion (assertCaptureValid)
   * INNAN ok=true sätts — det är hela poängen: en freeze som "inte kastade" är
   * inte samma sak som en freeze som fångade rätt sida. Consent-missed, anti-bot-
   * frozen-as-200, tomt SPA-skal landar här.
   */
  failureClass:
    | null
    | "timeout"
    | "consent-missed"
    | "anti-bot-blocked"
    | "captured-wrong-page"
    | "dynamic-only"
    | "auth-gate"
    | "geo-gate"
    | "mhtml-too-large"
    | "externalize-unavailable"
    | "mhtml-capture-failed"
    | "font-embed-failed"
    | "unknown";

  /** Detaljer om varför assertCaptureValid failed. null när den inte körts eller passerade. */
  captureValidity: {
    ok: boolean;
    textLen: number;
    interactiveCount: number;
    heroHasMeaningfulHeading: boolean;
    challengeMarkersFound: string[];
    reason: string | null;
  } | null;
  timing: {
    gotoMs: number;
    consentMs: number;
    scrollMs: number;
    captureMs: number;
  };
}

// Markörer som indikerar att sidan vi fångade är en challenge/cookie-vägg/auth-gate
// snarare än faktiskt innehåll. Lowercase — matchas mot lowercased body text.
// Inte gating för consent-flöden där vi avsiktligt dismissar (sker före), utan
// säkerhetsnät: om consent-klicket inte tog, eller om sajten serverade
// Cloudflare/PerimeterX/hCaptcha, syns det här.
const CHALLENGE_MARKERS = [
  "checking your browser",
  "please enable javascript",
  "verify you are human",
  "cf-challenge",
  "cf-browser-verification",
  "hcaptcha",
  "perimeterx",
  "px-captcha",
  "access denied",
  "are you a robot",
] as const;

// Consent-vokabulär — om hero-rubriken är en av dessa har vi fångat consent-väggen.
const CONSENT_HEADING_PATTERNS = [
  "cookie",
  "we value your privacy",
  "your privacy",
  "privacy preference",
  "consent",
] as const;

// Positiv content-assertion. Körs i browser-kontexten EFTER consent + scroll,
// INNAN captureSnapshot. Failar denna → failureClass="captured-wrong-page".
//
// Detta är skillnaden mellan "freezen kastade inte" (known-false-green) och
// "freezen fångade faktiskt sidan". Tröskelvärdena är medvetet lågt satta —
// hellre falska positiver (sidor som passerar men har tunn nytta) än falska
// negativer (kasta bort legitima minimalistiska landing-sidor).
export const ASSERT_CAPTURE_VALID_FN = `(challengeMarkers, consentPatterns, viewportHeight) => {
  const body = document.body;
  if (!body) return { ok: false, textLen: 0, interactiveCount: 0, heroHasMeaningfulHeading: false, challengeMarkersFound: [], reason: "no-body" };
  const text = (body.innerText || "").trim();
  const textLen = text.length;
  const lower = text.toLowerCase();
  const hits = challengeMarkers.filter((m) => lower.includes(m));
  const interactive = body.querySelectorAll('a[href]:not([href=""]), button:not([disabled])').length;
  // Hero = första viewport-höjden. Plocka headings vars top är i [0, viewportHeight].
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
  let heroHasMeaningfulHeading = false;
  for (const h of headings) {
    const r = h.getBoundingClientRect();
    if (r.top < 0 || r.top > viewportHeight) continue;
    const t = (h.textContent || "").trim().toLowerCase();
    if (!t || t.length < 3) continue;
    if (consentPatterns.some((p) => t.includes(p))) continue;
    heroHasMeaningfulHeading = true;
    break;
  }
  let reason = null;
  if (textLen < 500) reason = "text-too-short";
  else if (hits.length > 0) reason = "challenge-markers:" + hits.join(",");
  else if (interactive < 10) reason = "too-few-interactive-elements";
  else if (!heroHasMeaningfulHeading) reason = "no-meaningful-hero-heading";
  return { ok: reason === null, textLen, interactiveCount: interactive, heroHasMeaningfulHeading, challengeMarkersFound: hits, reason };
}`;

async function assertCaptureValid(
  page: import("@browserbasehq/stagehand").Page,
): Promise<NonNullable<FreezeReport["captureValidity"]>> {
  const script = `(${ASSERT_CAPTURE_VALID_FN})(${JSON.stringify(CHALLENGE_MARKERS)}, ${JSON.stringify(CONSENT_HEADING_PATTERNS)}, ${FREEZE_VIEWPORT.height})`;
  return (await page.evaluate(script)) as NonNullable<FreezeReport["captureValidity"]>;
}

// Klassificera en thrown error mot failure-taxonomin. Heuristik baserad på
// error-meddelande + redan inmätta receipt-fält. "unknown" är fallback men
// förbjuden i grön breadth-rapport — om vi ser den måste vi utöka klassificeraren.
function classifyFailure(
  err: unknown,
  report: FreezeReport,
): FreezeReport["failureClass"] {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // CDP MHTML serializer failure (observed: "-32000 Failed to generate MHTML").
  // Root cause not isolated — may be intermittent; see corpus/README.md
  // "Promotion criteria" for the capture-determinism invariant that applies
  // to ALL sites, not just this failure class.
  if (msg.includes("failed to generate mhtml") || msg.includes("-32000")) {
    return "mhtml-capture-failed";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    if (msg.includes("consent-selektor")) return "consent-missed";
    return "timeout";
  }
  if (msg.includes("consent kvar efter klick") || msg.includes("consent-selektor")) {
    return "consent-missed";
  }
  if (msg.includes("a2 gate")) return "font-embed-failed";
  if (msg.includes("mhtml") && (msg.includes("too large") || msg.includes("10 mb"))) {
    return "mhtml-too-large";
  }
  // Oversized capture routed to externalize, but the lovable-assets CLI isn't on
  // PATH in this environment (sandbox/CI without the tool). The capture itself
  // succeeded — this is an infra/storage gap, not a site or capture failure, so
  // it gets its own class rather than landing in `unknown` (which trips RED).
  if (msg.includes("externalize") && msg.includes("lovable-assets")) {
    return "externalize-unavailable";
  }
  if (msg.includes("net::err_") || msg.includes("403") || msg.includes("blocked")) {
    return "anti-bot-blocked";
  }
  if (msg.includes("401") || msg.includes("login") || msg.includes("auth required")) {
    return "auth-gate";
  }
  // Capture-validity-fel kommer hit som thrown Error från assertCaptureValid-gate
  if (msg.includes("captured-wrong-page")) return "captured-wrong-page";
  if (report.captureValidity && !report.captureValidity.ok) return "captured-wrong-page";
  return "unknown";
}



async function lazyScroll(page: import("@browserbasehq/stagehand").Page) {
  for (const pct of [0, 25, 50, 75, 100]) {
    await page.evaluate(
      `window.scrollTo({ top: document.documentElement.scrollHeight * ${pct / 100}, behavior: 'instant' })`,
    );
    await new Promise((r) => setTimeout(r, 500));
  }
  await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
  await new Promise((r) => setTimeout(r, 400));
}

// In-page synlig-text-extraktion. Speglar collectorns synlighetsregler
// (bbox > 0, computed display/visibility/opacity, traversar shadow roots) men
// är medvetet lokal — receiptet ska vara stabilt även om COLLECT_SCRIPT refactoras.
// Returnerar { hit-keys: count } för varje nyckel som hittades i synlig text.
// SYNK-KONTRAKT: synlighetsreglerna nedan MÅSTE matcha
// src/lib/tests/scripts/collect.ts::isVisible. Receiptets prediktiva kraft
// mot golden bygger på den överenskommelsen — om reglerna divergerar kan
// receiptet säga 0 medan collectorn plockar upp elementet (falskt självförtroende).
// Tester i __tests__/freeze-visibility.test.ts låser kontraktet och blir röda
// vid drift. Ändra båda samtidigt eller ändra ingen.
//
// Needle-kontrakt: needles MÅSTE vara lowercase. Haystacken lowercases:as före
// substring-match; needles görs INTE. Skickar du "Accept All" matchar inget.
export const POST_DISMISS_HITS_FN = `(needles) => {
  const hits = Object.fromEntries(needles.map(n => [n, 0]));
  const seen = new Set();
  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }
  function walk(root) {
    const nodes = root.querySelectorAll('*');
    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.shadowRoot) walk(el.shadowRoot);
      if (!isVisible(el)) continue;
      // Leaf-text only — undvik dubbelräkning från parent.
      let text = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += ' ' + (child.nodeValue || '');
      }
      if (!text.trim()) continue;
      const hay = text.toLowerCase();
      for (const n of needles) if (hay.includes(n)) hits[n] += 1;
    }
  }
  walk(document);
  return hits;
}`;

async function measurePostDismissDomHits(
  page: import("@browserbasehq/stagehand").Page,
  needles: readonly string[],
): Promise<Record<string, number>> {
  // Stagehand's page.evaluate tar bara en string (ingen arg-overload som Playwright),
  // så vi inlinear argumentet via JSON.stringify och kallar den exporterade funktionen.
  // Samma POST_DISMISS_HITS_FN-källa körs i testen — det är hela poängen med
  // konstanten: bara en kod-sanning.
  const script = `(${POST_DISMISS_HITS_FN})(${JSON.stringify(needles)})`;
  return (await page.evaluate(script)) as Record<string, number>;
}


export async function freezeSite(opts: FreezeOptions): Promise<FreezeResult> {
  const dir = opts.outDir ?? join("corpus", opts.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID required for freeze");
  }

  // Receipt lives outside corpus/ in dry-run so we never touch the committed baseline.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = opts.dryRun
    ? join(tmpdir(), `freeze-${opts.name}-${ts}.json`)
    : join(dir, "freeze-report.json");

  const report: FreezeReport = {
    ok: false,
    error: null,
    dryRun: !!opts.dryRun,
    consent: {
      selector: opts.consentSelector ?? null,
      dismissCheck: opts.consentSelector ? opts.consentDismissCheck ?? "detached" : null,
      matchCountBeforeClick: null,
      visibleBeforeClick: null,
      dismissedAfterMs: null,
      postDismissDomHits: null,
    },
    capture: {
      mhtmlKb: 0,
      screenshotKb: 0,
      beforeDismissScreenshotPath: null,
      loadStateDegraded: null,
      externalFontSrcCount: null,
      unembeddedFontUrls: null,
      embeddedFontCount: null,
      mhtmlKbBeforeFontEmbed: null,
      fontFetchFailures: null,
      embeddedFamilies: null,
      fontUrls: null,
      externalized: false,
      externalAssetUrl: null,
      externalAssetSha256: null,
      removedStaleLocalMhtml: false,
      removedStalePointer: false,
    },
    env: null,
    failureClass: null,
    captureValidity: null,
    timing: { gotoMs: 0, consentMs: 0, scrollMs: 0, captureMs: 0 },
  };


  let mhtmlBytes = 0;
  let screenshotBytes = 0;

  const session = await createSession();
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    browserbaseSessionID: session.id,
    keepAlive: false,
  });

  try {
    await stagehand.init();
    const page = stagehand.context.pages()[0] ?? (await stagehand.context.newPage());

    await page.setViewportSize(FREEZE_VIEWPORT.width, FREEZE_VIEWPORT.height);

    // Determinism: emulate prefers-reduced-motion BEFORE goto so animation
    // frames don't vary across captures. HubSpot's hero rotating list
    // (.wf-page-header_heading-animated-list) cycles product names via a
    // JS-driven `transform: translateY(...)`; without this each capture freezes
    // a different frame, which the extractor scores as different hero text — the
    // dominant score-affecting drift in fixtures/determinism/hubspot (round5).
    // Verified 2026-06-20 via Browserbase probe: under reduced-motion the list's
    // transform resolves to `none` and stays put across reads. Non-destructive
    // and general — well-built sites honor it, so it also reduces animation-frame
    // drift across the breadth corpus. Best-effort: if the CDP call fails the
    // freeze proceeds with animations live (pre-fix behavior) rather than aborting.
    try {
      await page.sendCDP("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      // Belt to setEmulatedMedia's suspenders. setEmulatedMedia governs CSS
      // @media; this governs JS `matchMedia`. Both are needed because the hero-
      // init JS reads matchMedia('prefers-reduced-motion') at load — we observed
      // an init race where 2/3 captures rendered the static hero but 1/3 caught
      // the animated rotating list mid-frame (translateY(-240px)). Forcing the
      // JS answer before any page script runs makes the hero render the SAME
      // (static) state every capture. Non-reduced-motion queries delegate to the
      // original so responsive width breakpoints are unaffected.
      await page.sendCDP("Page.addScriptToEvaluateOnNewDocument", {
        source:
          "(() => { const o = window.matchMedia ? window.matchMedia.bind(window) : null; if (!o) return; " +
          "window.matchMedia = (q) => /prefers-reduced-motion/i.test(String(q)) " +
          "? { matches: true, media: String(q), onchange: null, addListener(){}, removeListener(){}, " +
          "addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return false; } } : o(q); })();",
      });
    } catch {
      /* best-effort — capture proceeds with live animations */
    }

    // A+C proveniens: stämpla capture-env. Best-effort — om browser.version()
    // inte är tillgänglig hamnar null där, vilket också är information ("vi
    // visste inte vid frystidpunkten").
    let chromiumVersion: string | null = null;
    try {
      // Stagehand v3 doesn't expose .browser() on its Context shim; reach via
      // any-cast since this is best-effort proveniens, not gating.
      const ctxAny = stagehand.context as unknown as {
        browser?: () => { version: () => string } | null;
      };
      const browser = typeof ctxAny.browser === "function" ? ctxAny.browser() : null;
      if (browser && typeof browser.version === "function") {
        chromiumVersion = browser.version();
      }
    } catch {
      /* best-effort proveniens */
    }

    report.env = {
      source: "browserbase",
      chromiumVersion,
      viewport: { width: FREEZE_VIEWPORT.width, height: FREEZE_VIEWPORT.height },
      frozenAt: new Date().toISOString(),
    };


    const tGoto = Date.now();
    try {
      await page.goto(opts.url, { waitUntil: "load", timeoutMs: 60_000 });
    } catch (e) {
      // Heavy SPAs (e.g. linear) hold connections open so the `load` event never
      // fires within budget — but navigation completed and the DOM is present
      // (domcontentloaded fired long before). Proceed instead of failing the
      // freeze: the settle + lazyScroll pull in lazy resources, the font-embed
      // step fetches fonts directly, and assertCaptureValid is the backstop if
      // the page is genuinely empty. Re-throw anything that is NOT a load-timeout.
      if (!/timed?\s*out|timeout/i.test(String((e as Error)?.message ?? e))) throw e;
      report.capture.loadStateDegraded = true;
      // eslint-disable-next-line no-console
      console.log(
        `[freeze] '${opts.name}': load event did not fire within 60s — proceeding ` +
          `on domcontentloaded (heavy SPA); assertCaptureValid is the backstop`,
      );
    }
    await new Promise((r) => setTimeout(r, 1500));
    report.timing.gotoMs = Date.now() - tGoto;

    // Content-ready wait: give late-hydrating SPAs (e.g. spotify) and auto-
    // clearing bot-challenges (Cloudflare "Just a moment…" / "Performing security
    // verification" — which solve themselves in ~5–8s, no proxy needed) time to
    // render real content before capture. Poll until the body has substantial
    // text AND isn't a challenge interstitial, up to a budget. Normal pages are
    // ready on the first check and break immediately. This is NOT an anti-bot
    // bypass — it only waits out challenges that clear on their own; a persistent
    // challenge or sparse page just times out and assertCaptureValid catches it.
    {
      const CONTENT_WAIT_MS = 12_000;
      const CONTENT_MIN_CHARS = 400;
      const tReady = Date.now();
      let ready = false;
      while (Date.now() - tReady < CONTENT_WAIT_MS) {
        const st = (await page
          .evaluate(
            `(() => { const txt = (document.body?.innerText || "").trim(); return { len: txt.length, ` +
              `challenge: /just a moment|verify you are human|performing security verification|` +
              `attention required|enable javascript to continue|checking your browser/i` +
              `.test(txt + " " + document.title) }; })()`,
          )
          .catch(() => ({ len: 0, challenge: false }))) as { len: number; challenge: boolean };
        if (!st.challenge && st.len >= CONTENT_MIN_CHARS) {
          ready = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!ready) {
        // eslint-disable-next-line no-console
        console.log(
          `[freeze] '${opts.name}': content not ready within ${CONTENT_WAIT_MS}ms ` +
            `(sparse page or persistent challenge) — proceeding; assertCaptureValid is the backstop`,
        );
      }
    }

    // Consent: hård assertion + mätning. Allt mäts in i `report` löpande så
    // receipten är användbar även när vi throwar.
    const tConsent = Date.now();
    const dismissState = opts.consentDismissCheck ?? "detached";
    if (opts.consentFrame) {
      // iframe-based CMP (Sourcepoint sp_message_iframe et al). The accept button
      // lives inside the iframe, so page.locator can't reach it — click via
      // frameLocator and verify the iframe detaches/hides. consentSelector is the
      // button locator INSIDE the frame (e.g. button[title="Godkänn alla"]).
      if (!opts.consentSelector) {
        throw new Error(
          `[freeze] consentFrame satt utan consentSelector (knapp-i-iframe): ${opts.name}.`,
        );
      }
      try {
        await page.waitForSelector(opts.consentFrame, { state: "attached", timeout: 8000 });
      } catch {
        throw new Error(
          `[freeze] consent-iframe blev aldrig attached inom 8s: ${opts.consentFrame} (${opts.name}). ` +
            `Stale selektor, A/B-variant, eller CMP laddade aldrig.`,
        );
      }
      report.consent.visibleBeforeClick = true;
      if (opts.screenshotBeforeDismiss) {
        const beforeShot = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
        const beforePath = opts.dryRun
          ? join(tmpdir(), `freeze-${opts.name}-${ts}.before-dismiss.jpg`)
          : join(dir, "screenshot.before-dismiss.jpg");
        writeFileSync(beforePath, Buffer.from(beforeShot));
        report.capture.beforeDismissScreenshotPath = beforePath;
      }
      const tClick = Date.now();
      await page.frameLocator(opts.consentFrame).locator(opts.consentSelector).first().click();
      try {
        await page.waitForSelector(opts.consentFrame, { state: dismissState, timeout: 8000 });
      } catch {
        throw new Error(
          `[freeze] consent-iframe kvar efter klick (state=${dismissState}, ${opts.consentFrame}): ${opts.name}. ` +
            `Knapp-selektor i iframe fel, eller CMP döljer istället för att detacha (testa consentDismissCheck=hidden).`,
        );
      }
      report.consent.dismissedAfterMs = Date.now() - tClick;
      await new Promise((r) => setTimeout(r, 800));
      report.consent.postDismissDomHits = await measurePostDismissDomHits(page, POST_DISMISS_NEEDLES);
    } else if (opts.consentSelector) {
      // Vänta in bannern (consent injiceras ofta async via taghanterare).
      // Om DENNA waiten timear ut är det stale selektor / banner laddade aldrig
      // — det är ett legitimt freeze-fel och vi loggar det explicit i error.
      try {
        await page.waitForSelector(opts.consentSelector, {
          state: "visible",
          timeout: 5000,
        });
      } catch {
        // Spara debug-screenshot om begärt — annars är felet en ren gissning.
        if (opts.screenshotBeforeDismiss) {
          try {
            const failShot = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
            const failPath = opts.dryRun
              ? join(tmpdir(), `freeze-${opts.name}-${ts}.timeout.jpg`)
              : join(dir, "screenshot.timeout.jpg");
            writeFileSync(failPath, Buffer.from(failShot));
            report.capture.beforeDismissScreenshotPath = failPath;
          } catch {
            /* screenshot best-effort */
          }
        }
        throw new Error(
          `[freeze] consent-selektor blev aldrig synlig inom 5s: ${opts.consentSelector} (${opts.name}). ` +
            `Stale selektor, A/B-variant, eller banner laddade aldrig. Verifiera i --dry-run med --screenshot-before-dismiss.`,
        );
      }

      // Mät EFTER settle, inte vid rå load — undviker spöke-nollor.
      report.consent.matchCountBeforeClick = (await page.evaluate(
        `document.querySelectorAll(${JSON.stringify(opts.consentSelector)}).length`,
      )) as number;
      report.consent.visibleBeforeClick = true; // waitForSelector(visible) lyckades

      if (opts.screenshotBeforeDismiss) {
        const beforeShot = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
        const beforePath = opts.dryRun
          ? join(tmpdir(), `freeze-${opts.name}-${ts}.before-dismiss.jpg`)
          : join(dir, "screenshot.before-dismiss.jpg");
        writeFileSync(beforePath, Buffer.from(beforeShot));
        report.capture.beforeDismissScreenshotPath = beforePath;
      }

      const tClick = Date.now();
      await page.locator(opts.consentSelector).click(); // INGEN try/catch
      try {
        await page.waitForSelector(opts.consentSelector, {
          state: dismissState,
          timeout: 5000,
        });
      } catch {
        throw new Error(
          `[freeze] consent kvar efter klick (state=${dismissState}): ${opts.name} — capture avbruten. ` +
            `Byt consentDismissCheck i corpus/sites.ts (detached↔hidden) eller uppdatera selektorn.`,
        );
      }
      report.consent.dismissedAfterMs = Date.now() - tClick;
      await new Promise((r) => setTimeout(r, 800));

      // Mät synlig text i post-dismiss-DOM. Detta är den pålitliga check som
      // ersätter rg-mot-MHTML — speglar collectorns synlighetslogik så
      // postDismissDomHits["accept all"]=0 faktiskt förutsäger en ren golden.
      report.consent.postDismissDomHits = await measurePostDismissDomHits(
        page,
        POST_DISMISS_NEEDLES,
      );
    } else if (opts.consentInstruction) {
      throw new Error(
        `[freeze] consentInstruction utan consentSelector för verifiering: ${opts.name}. ` +
          `Lägg till consentSelector i corpus/sites.ts så vi kan assertera att klicket tog.`,
      );
    }
    report.timing.consentMs = Date.now() - tConsent;

    const tScroll = Date.now();
    await lazyScroll(page);
    report.timing.scrollMs = Date.now() - tScroll;

    // Positiv content-assertion (Grind 2). Detta är success-kriteriet, inte
    // "kastade inte". Failar denna är en "captured-wrong-page"-freeze: vi
    // fångade en consent-vägg, Cloudflare-challenge, tomt SPA-skal, etc.
    // Receiptet sparas oavsett utfall.
    const validity = await assertCaptureValid(page);
    report.captureValidity = validity;
    if (!validity.ok) {
      throw new Error(
        `[freeze] captured-wrong-page (${opts.name}): ${validity.reason}. ` +
          `text=${validity.textLen}ch interactive=${validity.interactiveCount} ` +
          `heroHeading=${validity.heroHasMeaningfulHeading} ` +
          `challengeMarkers=[${validity.challengeMarkersFound.join(",")}]`,
      );
    }

    // Determinism: remove inconsistently-injected third-party overlays (chat,
    // feedback, web-interactives, bot-tarpit) right before serialization so
    // every capture has identical structure — the structural cascade driver
    // behind the residual #3 drift after token masking. Runs AFTER
    // assertCaptureValid so validity reflects the real page; the overlays are
    // score-neutral (round6 #4 = identical goldens) and not main content.
    // Best-effort per selector — a bad selector logs nothing rather than aborts.
    if (opts.removeSelectors && opts.removeSelectors.length > 0) {
      const removed = (await page.evaluate(
        `(() => { const sels = ${JSON.stringify(opts.removeSelectors)}; let n = 0;` +
          ` for (const s of sels) { try { document.querySelectorAll(s).forEach((el) => { el.remove(); n++; }); } catch (e) {} }` +
          ` return n; })()`,
      )) as number;
      // eslint-disable-next-line no-console
      console.log(
        `[freeze] removeSelectors: stripped ${removed} overlay element(s) ` +
          `(${opts.removeSelectors.length} selectors) before capture`,
      );
    }

    const tCapture = Date.now();
    // Page.captureSnapshot intermittently fails with CDP -32000 "Failed to
    // generate MHTML" (observed: guardian, verge, dn, spiegel). Root cause not
    // isolated; empirically a settle + retry clears the transient cases. Retry
    // up to 3x on -32000 only; re-throw any other error immediately.
    let snap: { data: string } | undefined;
    let captureErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        snap = await page.sendCDP<{ data: string }>("Page.captureSnapshot", { format: "mhtml" });
        break;
      } catch (e) {
        captureErr = e;
        if (!/-32000|failed to generate mhtml/i.test(String((e as Error)?.message ?? e))) throw e;
        await new Promise((r) => setTimeout(r, 1200 * attempt));
      }
    }
    if (!snap) throw captureErr;
    const rawMhtmlBytes = Buffer.byteLength(snap.data, "utf8");
    report.capture.mhtmlKbBeforeFontEmbed = Math.round(rawMhtmlBytes / 1024);

    // Skriv page.pre-embed.mhtml FÖRE embedMhtmlFonts och FÖRE A2-gaten
    // (samma receipt-före-throw-princip som report.capture.fontUrls). Korpusen
    // blir då self-contained: input (pre-embed, externa font-URLer kvar) +
    // output (post-embed, cid:-rewrittna) båda frusna. Re-embed är en
    // deterministisk diff istället för ett live-re-capture, och Test 3 i
    // harvest-font-urls.test.ts kan köra P==M consumption-equality på
    // riktig korpus utan Playwright/Browserbase.
    if (!opts.dryRun) {
      writeFileSync(join(dir, "page.pre-embed.mhtml"), snap.data, "utf8");
    }

    // A2 — embed external font binaries as cid: parts so replay doesn't fall
    // back to OS fonts. The hard-assert below (externalFontSrcCount === 0) is
    // the form-agnostic success gate per plan beslutspunkt 3.
    // Browser-context font fetch — fonts the server-side proxy can't reach
    // (CDN hotlink/IP-block, e.g. Schibsted cdn.aftonbladet.se / static.svd.se)
    // but the live page already loaded via @font-face. page.evaluate runs the
    // fetch in the page's own origin; bytes come back base64 (chunked to dodge
    // the call-stack limit on String.fromCharCode for large fonts). The page is
    // still on-site here (post-capture, pre-close), so the origin is correct.
    const browserFetch = async (fontUrl: string): Promise<Buffer | null> => {
      try {
        const b64 = (await page.evaluate(
          `(async () => { try { const r = await fetch(${JSON.stringify(fontUrl)}); if (!r.ok) return null; ` +
            `const b = new Uint8Array(await r.arrayBuffer()); let s = ""; const C = 0x8000; ` +
            `for (let i = 0; i < b.length; i += C) s += String.fromCharCode.apply(null, b.subarray(i, i + C)); ` +
            `return btoa(s); } catch { return null; } })()`,
        )) as string | null;
        return b64 ? Buffer.from(b64, "base64") : null;
      } catch {
        return null;
      }
    };
    // Which font URLs did the browser actually fetch (resource-timing)? Lets the
    // A2 gate fire only on render-relevant survivors (loaded but unembeddable),
    // not referenced-but-unused fonts (e.g. sibling-brand fonts in shared CSS).
    const loadedFontUrls = (await page
      .evaluate(
        `(() => { try { return performance.getEntriesByType("resource").map((e) => e.name)` +
          `.filter((n) => /\\.(woff2?|ttf|otf|eot)(\\?|$)/i.test(n)); } catch { return []; } })()`,
      )
      .catch(() => [])) as string[];
    const embedded = await embedMhtmlFonts(snap.data, { browserFetch, loadedFontUrls });
    const finalMhtml = embedded.mhtml;
    mhtmlBytes = Buffer.byteLength(finalMhtml, "utf8");
    report.capture.mhtmlKb = Math.round(mhtmlBytes / 1024);
    report.capture.externalFontSrcCount = embedded.externalFontSrcCount;
    report.capture.unembeddedFontUrls = embedded.unembeddedFontUrls;
    report.capture.embeddedFontCount = embedded.embeddedFontCount;
    report.capture.fontFetchFailures = embedded.fetchFailures;
    report.capture.embeddedFamilies = embedded.embeddedFamilies;
    // Commit 4 — receipt populeras INNAN A2-gaten kan throwa, så hink-4-
    // observability överlever även när externalFontSrcCount > 0.
    report.capture.fontUrls = embedded.fontUrlSummary;


    // Gate on fonts the browser LOADED but we couldn't embed (real render-drift).
    // Referenced-but-unused survivors are score-neutral. If the loaded-signal is
    // unavailable (empty), fall back to the strict total so a missing signal never
    // silently passes. Existing corpus sites have 0 survivors → unaffected.
    const gateFonts =
      loadedFontUrls.length > 0 ? embedded.unembeddedLoadedFontUrls : embedded.unembeddedFontUrls;
    const gateFails = loadedFontUrls.length > 0 ? gateFonts.length > 0 : embedded.externalFontSrcCount > 0;
    if (gateFails) {
      throw new Error(
        `[freeze] A2 gate: ${gateFonts.length} render-relevant font(s) unembeddable after rewrite ` +
          `(total external=${embedded.externalFontSrcCount}, embedded=${embedded.embeddedFontCount}, ` +
          `failures=${embedded.fetchFailures.length}). Replay falls back to OS fonts → area/yBand drift. ` +
          `Loaded-but-unembedded: ${gateFonts.join(", ") || "(none — strict fallback on total)"}. ` +
          `Inspect freeze-report.json unembeddedFontUrls / fontFetchFailures.`,
      );
    }

    const shot = await page.screenshot({ type: "jpeg", quality: 70, fullPage: true });
    screenshotBytes = shot.byteLength;
    report.capture.screenshotKb = Math.round(screenshotBytes / 1024);
    report.timing.captureMs = Date.now() - tCapture;

    if (!opts.dryRun) {
      const localMhtmlPath = join(dir, "page.mhtml");
      const pointerPath = join(dir, "page.mhtml.asset.json");

      // Stora MHTML → CDN, pekare i repo. Liten MHTML → direkt i repo som förr.
      // Tröskel ligger marginal under repo-gränsen 10 MB (se externalize.server.ts).
      if (mhtmlBytes > MHTML_INLINE_THRESHOLD_BYTES) {
        const pointer: AssetPointer = uploadAsset(
          Buffer.from(finalMhtml, "utf8"),
          "page.mhtml",
        );
        writeFileSync(pointerPath, JSON.stringify(pointer, null, 2));
        report.capture.externalized = true;
        report.capture.externalAssetUrl = pointer.resolvedUrl;
        report.capture.externalAssetSha256 = pointer.sha256;
        // Stale-städning: om en gammal lokal page.mhtml låg kvar (site flyttades
        // över tröskeln) skulle replay-readerns "externalized-flagga är source
        // of truth"-check throw:a på inkonsistens. Vi tar bort den här så att
        // commit landar redan i konsistent state.
        if (existsSync(localMhtmlPath)) {
          unlinkSync(localMhtmlPath);
          report.capture.removedStaleLocalMhtml = true;
          // eslint-disable-next-line no-console
          console.log(`[freeze] tog bort stale lokal ${localMhtmlPath} (flyttad över tröskeln)`);
        }
        // eslint-disable-next-line no-console
        console.log(
          `[freeze] mhtml ${Math.round(mhtmlBytes / 1024)}kb > ${Math.round(MHTML_INLINE_THRESHOLD_BYTES / 1024)}kb tröskel ` +
            `— externaliserat sha256=${pointer.sha256.slice(0, 12)}… url=${pointer.resolvedUrl}`,
        );
      } else {
        writeFileSync(localMhtmlPath, finalMhtml, "utf8");
        // Stale-städning åt andra hållet: site som tidigare var externaliserad
        // är nu under tröskeln (t.ex. efter font-subsetting). Ta bort .asset.json
        // så att inte två "sanningar" lever sida vid sida.
        if (existsSync(pointerPath)) {
          unlinkSync(pointerPath);
          report.capture.removedStalePointer = true;
          // eslint-disable-next-line no-console
          console.log(`[freeze] tog bort stale pekare ${pointerPath} (under tröskeln igen)`);
        }
      }
      writeFileSync(join(dir, "screenshot.jpg"), Buffer.from(shot));
      // Grind 3 — TTL-fält. ttlDays är per-snapshot (default 90) så per-kategori-
      // TTL senare blir en data-ändring, inte en kodändring. expiresAt = frozenAt + ttlDays.
      // refreezeReason är fri text — "manual", "scheduled", "url-changed", etc.
      const ttlDays = 90;
      const frozenAtMs = Date.now();
      const expiresAtMs = frozenAtMs + ttlDays * 24 * 60 * 60 * 1000;
      const meta = {
        url: opts.url,
        name: opts.name,
        captured_at: new Date(frozenAtMs).toISOString(),
        viewport: FREEZE_VIEWPORT,
        consentSelector: opts.consentSelector ?? null,
        consentInstruction: opts.consentInstruction ?? null,
        notes: opts.notes ?? null,
        // Grind 3 — TTL-policy. TTL är auktoritativt för staleness; HEAD-diff
        // är rådgivande (se scripts/freeze-staleness-check.ts).
        ttlDays,
        frozenAt: new Date(frozenAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        refreezeReason: "manual" as const,
      };
      writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
    }



    report.ok = true;
    return {
      dir,
      mhtmlBytes,
      screenshotBytes,
      reportPath,
      ok: true,
    };
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    report.failureClass = classifyFailure(e, report);
    throw e;
  } finally {
    // Receipt flushas ALLTID. Detta är hela poängen — utan finally blir
    // hard-fail (stale selektor → assertion throw) en blind körning där du
    // inte kan se matchCountBeforeClick=0 i efterhand.
    try {
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      // eslint-disable-next-line no-console
      console.log(`[freeze] report -> ${reportPath}`);
    } catch (writeErr) {
      // eslint-disable-next-line no-console
      console.error(`[freeze] kunde inte skriva report: ${writeErr}`);
    }
    try {
      await stagehand.close();
    } catch {
      /* ignore */
    }
    await closeSession(session.id);
  }
}
