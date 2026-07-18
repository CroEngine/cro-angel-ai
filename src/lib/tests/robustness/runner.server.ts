// Snippet robustness runner (server).
//
// Given a Stagehand page already navigated to a real, third-party page, this:
//   1. audits the page and builds a real ContentInventory (same pipeline the
//      live crawler uses) — so targeting uses the page's actual selectors;
//   2. loads the REAL production snippet on the page through a guarded test
//      seam (no network, CSP-exempt via CDP eval);
//   3. for each persona: computes a real Decision, applies it, measures
//      targeting / console errors / DOM impact, then reset()s and checks that
//      every change reversed.
//
// The audit + snippet load happen ONCE; personas are measured in sequence on
// the same page (each reset()s back to baseline). Every phase is wrapped in a
// timeout so a hung page yields a `fail` report instead of a dead stream — the
// batch use-case (sweep thousands, surface only failures) depends on that.

import type { Page } from "@browserbasehq/stagehand";

import { decide, type SiteGoal } from "@/adaptive/decide";
import { mapAuditToInventory, rankGoalCandidates } from "@/adaptive/crawler-inventory";
import type { ContentInventory } from "@/adaptive/types";
import { runPageAudit } from "../runners/pageAudit.server";
import { personaContext, personaDevice, type PersonaId } from "./personas";
import { dismissConsent } from "./session.server";
import {
  analyze,
  failReport,
  type AdaptationProbe,
  type DomSignature,
  type InteractionProbe,
  type LayoutDiff,
  type RerenderProbe,
  type RobustnessObservation,
  type RobustnessReport,
  type VisualSanity,
} from "./analyze";

/** Screenshot emitted for human review when captureShots is on. */
export interface Shot {
  persona: string;
  phase: "before" | "after";
  jpegBase64: string;
}

// Syntactically valid, non-resolving endpoint for the snippet's auto-run fetch —
// it fails (fail-open, console.warn only) so it never applies anything; our
// controlled decision is applied explicitly via the seam instead.
const DEAD_ENDPOINT = "https://angel-harness.invalid";

const DEFAULT_PREPARE_TIMEOUT_MS = 40_000;
const DEFAULT_PERSONA_TIMEOUT_MS = 15_000;

export interface RobustnessRunOptions {
  url: string;
  /** Slug used for the synthetic decision (not persisted). */
  site: string;
  personas: PersonaId[];
  /** The production snippet source (public/adaptive.js), fetched by the caller. */
  snippetSource: string;
  /**
   * The conversion goal to decide() with — the stored owner-confirmed goal
   * when the caller has one. Without a goal every goal-decoration pattern
   * (emphasize_goal / sticky_goal_cta / show_secondary_cta) resolves to null,
   * so the launch gate never exercised the patterns most likely to trip it
   * (the fixed mobile pill covering a cookie bar, the injected secondary
   * link). When absent, the runner derives the same deterministic floor the
   * goal judge falls back to: rankGoalCandidates()'s top candidate.
   */
  goal?: SiteGoal | null;
  prepareTimeoutMs?: number;
  personaTimeoutMs?: number;
  /** Capture before/after screenshots for human review (heavier). */
  captureShots?: boolean;
  onShot?: (shot: Shot) => void;
  /** Släpp igenom nivå 3 (layout) i den syntetiska decide:n — pre-flighten är
   *  ju precis det FÖRE/EFTER-underlag som ska föregå en layout-opt-in
   *  (docs/v1-testdefinition.md); utan flaggan kan grinden aldrig visas. */
  allowLayoutPatterns?: boolean;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${label} exceeded ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function signature(page: Page): Promise<DomSignature> {
  // Function form (not a string) so Playwright CALLS it and returns the object.
  return (await page.evaluate(() => ({
    textLen: document.body ? document.body.textContent.length : 0,
    elementCount: document.getElementsByTagName("*").length,
    bodyChildCount: document.body ? document.body.children.length : 0,
  }))) as DomSignature;
}

const EMPTY_SIG: DomSignature = { textLen: 0, elementCount: 0, bodyChildCount: 0 };

/** Selector for elements a visitor is meant to be able to click / use. */
const INTERACTIVE_SELECTOR =
  'a[href],button,[role="button"],input:not([type="hidden"]),select,textarea';

/** Stamp visible in-viewport interactive elements and record whether each is
 *  hit-testable at its centre (i.e. actually clickable) BEFORE apply. */
async function captureInteractiveBefore(
  page: Page,
): Promise<{ k: number; hittable: boolean }[]> {
  return (await page.evaluate((sel: string) => {
    const els = document.querySelectorAll(sel);
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const rec: { k: number; hittable: boolean }[] = [];
    let k = 0;
    for (let i = 0; i < els.length && k < 400; i++) {
      const el = els[i];
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cx > vw || cy < 0 || cy > vh) continue; // centre in viewport
      const hit = document.elementFromPoint(cx, cy);
      const hittable = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      el.setAttribute("data-angel-ik", String(k));
      rec.push({ k, hittable });
      k++;
    }
    return rec;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, INTERACTIVE_SELECTOR)) as any;
}

/** Re-check the previously-clickable elements after apply: how many became
 *  unclickable BECAUSE OF ANGEL. Grinden ska bara fälla det VI täcker: på en
 *  levande flödessida byter sajtens egen hydrering ut kortnoder (stämpeln
 *  försvinner → "detached") och strömmar in innehåll som täcker annat — 11
 *  falska fel på glutenforums mobilflöde (2026-07-08). Angels ops kopplar
 *  aldrig loss interaktiva element, så en försvunnen stämpel är sajtens egen
 *  re-render (kan inte bedömas); en täckning räknas bara när täckaren är ett
 *  Angel-element. */
async function measureInteractiveAfter(
  page: Page,
  before: { k: number; hittable: boolean }[],
): Promise<InteractionProbe> {
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b: any) => {
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const ANGEL =
        ".angel-sticky-cta,.angel-badge,.angel-secondary-cta,[data-angel-injected],.angel-debug-tag";
      let checked = 0;
      let broken = 0;
      for (const rec of b as { k: number; hittable: boolean }[]) {
        if (!rec.hittable) continue; // only care about things that WERE clickable
        checked++;
        const el = document.querySelector('[data-angel-ik="' + rec.k + '"]');
        if (!el) {
          checked--; // node replaced by the site's own re-render — can't judge
          continue;
        }
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        // Moved out of the viewport → can't judge; don't count either way.
        if (cx < 0 || cx > vw || cy < 0 || cy > vh) {
          checked--;
          continue;
        }
        const hit = document.elementFromPoint(cx, cy);
        const ok = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
        if (ok) continue;
        // Täckt — men av vem? Bara Angels egna element fäller grinden; sajtens
        // egna overlays/inströmmade kort är ambient rörelse, inte vår skada.
        const byAngel = !!(hit && hit.closest && hit.closest(ANGEL));
        if (byAngel) broken++;
        else checked--;
      }
      return { checked, broken };
    },
    before,
  )) as InteractionProbe;
}

/** How long to watch the page's own motion before applying, to net it out. */
const CONTROL_MS = 500;

type Rect = { k: number; x: number; y: number; w: number; h: number };
type RectSet = { vw: number; vh: number; rects: Rect[] };
type Movement = { matched: number; shiftedCount: number; shiftedFraction: number; maxMove: number };

/** Read current rects for the elements stamped by the `before` pass. */
async function readRects(page: Page): Promise<RectSet> {
  return (await page.evaluate(() => {
    const els = document.querySelectorAll("[data-angel-vk]");
    const rects: { k: number; x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const k = Number(el.getAttribute("data-angel-vk"));
      const r = el.getBoundingClientRect();
      rects.push({ k, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return { vw: window.innerWidth || 1, vh: window.innerHeight || 1, rects };
  })) as RectSet;
}

/** Measure how far the stamped elements moved relative to a recorded rect set. */
async function measureAgainst(page: Page, baseRects: RectSet): Promise<Movement> {
  return (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b: any) => {
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const vpArea = Math.max(1, vw * vh);
      let shiftedCount = 0;
      let shiftedArea = 0;
      let maxMove = 0;
      let matched = 0;
      for (const rec of b.rects as { k: number; x: number; y: number; w: number; h: number }[]) {
        const el = document.querySelector('[data-angel-vk="' + rec.k + '"]');
        if (!el) continue;
        matched++;
        const r = el.getBoundingClientRect();
        const move = Math.max(Math.abs(r.left - rec.x), Math.abs(r.top - rec.y));
        if (move > maxMove) maxMove = move;
        if (move > 4) {
          shiftedCount++;
          shiftedArea += Math.min(vpArea, rec.w * rec.h);
        }
      }
      return {
        matched,
        shiftedCount,
        shiftedFraction: Math.min(1, shiftedArea / vpArea),
        maxMove: Math.round(maxMove),
      };
    },
    baseRects,
  )) as Movement;
}

/** Provoke the kinds of things that make a framework re-render, without
 *  navigating away: scroll the page, fire resize/scroll/visibility, settle. */
async function provokeRerender(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      window.scrollTo(0, (document.body && document.body.scrollHeight) || 3000);
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("scroll"));
      document.dispatchEvent(new Event("visibilitychange"));
    } catch {
      /* non-fatal */
    }
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    try {
      window.scrollTo(0, 0);
      window.dispatchEvent(new Event("resize"));
    } catch {
      /* non-fatal */
    }
  });
  await new Promise((r) => setTimeout(r, 400));
}

export async function runSnippetRobustness(
  page: Page,
  opts: RobustnessRunOptions,
): Promise<RobustnessReport[]> {
  const { url, site, personas, snippetSource } = opts;
  const prepareTimeout = opts.prepareTimeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS;
  const personaTimeout = opts.personaTimeoutMs ?? DEFAULT_PERSONA_TIMEOUT_MS;

  // Capture console errors during the apply window only. Stagehand's page proxy
  // supports a subset of events; attach defensively so an unsupported one
  // doesn't abort the run.
  const consoleErrors: string[] = [];
  let collecting = false;
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (collecting && msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  };
  const safeOn = (event: string, fn: (arg: never) => void) => {
    try {
      (page as unknown as { on: (e: string, f: (a: never) => void) => void }).on(event, fn);
    } catch {
      /* unsupported event — skip */
    }
  };
  safeOn("console", onConsole as (a: never) => void);

  let inventory: ContentInventory | null = null;
  let goal: SiteGoal | null = opts.goal ?? null;
  let snippetRan = false;
  let baseline: DomSignature = EMPTY_SIG;

  // --- prepare: audit + inject snippet (once) ---
  try {
    // Neutralisera en LIVE Angel-installation FÖRE audit och baseline:
    // pilotsajter (glutenforum) kör den skarpa snippeten, som hinner applicera
    // sina adaptationer innan harnessen mäter. Utan städningen (a) skördas den
    // adapterade DOM:en in i harnessens inventory (samma klass av fel som
    // harvest-feedback-loopen) och (b) bakas ringen in i FÖRE-bilderna så
    // paren blir bevislösa. Nätverksblock går inte (Stagehand-proxyn saknar
    // page.route) — så vi kör den skarpa instansens egen reset() och sopar
    // därefter residuet fysiskt.
    await stripLiveAngel(page);
    const audit = await withTimeout(runPageAudit(page), prepareTimeout, "audit");
    await stripLiveAngel(page); // bälte: den skarpa snippetens sena re-applies
    inventory = mapAuditToInventory(audit, site);

    // No stored goal from the caller → the deterministic no-LLM floor, exactly
    // what judgeSiteGoals() falls back to. This makes the harness measure the
    // goal-decoration patterns instead of silently skipping them.
    if (!goal) {
      let domain: string | null = null;
      try {
        domain = new URL(url).hostname;
      } catch {
        /* keep null */
      }
      const top = rankGoalCandidates(inventory, domain)[0];
      if (top) goal = { selector: top.selector, text: top.text };
    }

    collecting = true;
    await withTimeout(
      page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ src, endpoint }: any) => {
          (window as unknown as { __ANGEL_HARNESS__?: boolean }).__ANGEL_HARNESS__ = true;
          const m = document.createElement("script");
          m.type = "text/plain"; // present for findScript(), never executed
          m.setAttribute("data-site", "harness");
          m.setAttribute("data-endpoint", endpoint);
          m.setAttribute("src", "data:text/plain,adaptive.js");
          document.head.appendChild(m);
          // CDP eval is CSP-exempt; runs the real IIFE which defines __angel.
          // eslint-disable-next-line no-eval
          (0, eval)(src);
        },
        { src: snippetSource, endpoint: DEAD_ENDPOINT },
      ),
      personaTimeout,
      "inject",
    );

    snippetRan = Boolean(
      await page.evaluate(
        `(typeof window.__angel === 'object' && !!window.__angel && typeof window.__angel.apply === 'function')`,
      ),
    );
    baseline = await signature(page);
  } catch (err) {
    collecting = false;
    detach(page, onConsole);
    const reason = err instanceof Error ? err.message : String(err);
    // Whole page failed to prepare → one fail report per persona.
    return personas.map((p) => failReport(url, site, p, reason, { reachable: inventory !== null }));
  }

  if (!snippetRan) {
    collecting = false;
    detach(page, onConsole);
    return personas.map((p) =>
      failReport(url, site, p, "snippet did not initialize", { reachable: true }),
    );
  }

  // --- measure each persona in sequence (reset() between them) ---
  // Mobil-personor SIST: viewport-flippen 1288→390 får responsiva sajter att
  // re-rendera sin header/nav, och en desktop-persona som mäts EFTER flippen
  // ser då "detached" element som inte är Angels fel (falska interaction-
  // failar, glutenforum 2026-07-08). Stabil ordning inom varje enhetsgrupp.
  const ordered = [
    ...personas.filter((p) => personaDevice(p) !== "mobile"),
    ...personas.filter((p) => personaDevice(p) === "mobile"),
  ];
  const reports: RobustnessReport[] = [];
  for (const persona of ordered) {
    const started = Date.now();
    const errBefore = consoleErrors.length;
    try {
      // Viewporten ska matcha personans enhet — annars bedöms mobilmönstren
      // (sticky-pillret framför allt) aldrig i miljön de kör i (varje
      // "mobil"-bild i nattkörningen var desktop-bredd). OBS anropsformen:
      // Stagehands page.setViewportSize tar POSITIONELLA argument
      // (width, height) och sväljer tyst en Playwright-stil {width,height}-
      // objektfelanvändning (CDP-felet .catch:as bort). Navigationer nollar
      // dessutom överriden till Stagehands default (1288×711) — därför sätts
      // den här, EFTER goto, per persona. Signaturerna är strukturella
      // (textLen/elementCount) så reversibilitetskollen överlever bytet.
      try {
        const vp =
          personaDevice(persona) === "mobile"
            ? { width: 390, height: 844 }
            : { width: 1288, height: 711 };
        await (
          page as unknown as { setViewportSize: (w: number, h: number) => Promise<void> }
        ).setViewportSize(vp.width, vp.height);
        await new Promise((r) => setTimeout(r, 400)); // reflow settle
      } catch {
        /* viewport control unsupported — measure in the current viewport */
      }
      // Consent-banners kan dyka upp/återuppstå EFTER prepare-steget (sena
      // CMP:er, per-viewport-varianter) — utan omtag fotograferas FÖRE/EFTER
      // genom en cookie-vägg och adaptationen syns aldrig (nattkörningen).
      await dismissConsent(page);
      // Consent-klicket kan trigga den skarpa snippetens upgrade-väg → ny
      // apply → kontaminerad FÖRE-bild. Sopa innan varje persona mäter.
      await stripLiveAngel(page);
      const report = await withTimeout(
        measurePersona(page, {
          url,
          site,
          persona,
          inventory,
          goal,
          baseline,
          started,
          errBefore,
          consoleErrors,
          captureShots: opts.captureShots ?? false,
          onShot: opts.onShot,
          allowLayoutPatterns: opts.allowLayoutPatterns ?? false,
        }),
        personaTimeout,
        `persona ${persona}`,
      );
      reports.push(report);
    } catch (err) {
      // Try to leave the page clean for the next persona.
      try {
        await page.evaluate(`window.__angel && window.__angel.reset()`);
      } catch {
        /* ignore */
      }
      const reason = err instanceof Error ? err.message : String(err);
      reports.push(failReport(url, site, persona, reason, { reachable: true, snippetRan: true }));
    }
  }

  collecting = false;
  detach(page, onConsole);
  return reports;
}

function detach(page: Page, onConsole: (arg: never) => void) {
  try {
    (page as unknown as { off?: (e: string, f: (a: never) => void) => void }).off?.(
      "console",
      onConsole as (a: never) => void,
    );
  } catch {
    /* ignore */
  }
}

async function shoot(page: Page): Promise<string> {
  const buf = (await page.screenshot({ type: "jpeg", quality: 55 })) as Buffer;
  return buf.toString("base64");
}

/** Neutralisera en LIVE Angel-installation (pilotsajternas skarpa snippet):
 *  kör dess reset() och sopa residuet fysiskt. Körs i prepare-steget OCH inför
 *  varje persona — den skarpa snippeten kan återapplicera långt efter load
 *  (hydrerings-överlevnad, consent-upgrade när harnessen klickar bort
 *  cookie-bannern), och varje sådan omgång kontaminerar nästa FÖRE-bild
 *  (glutenforum 2026-07-08: persona 2:s FÖRE hade ringen inbakad). Idempotent
 *  och billig; harnessens egen apply sker först efteråt. */
async function stripLiveAngel(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      try {
        const A = (window as unknown as { AngelAdaptive?: { reset?: () => void } }).AngelAdaptive;
        if (A && typeof A.reset === "function") A.reset();
      } catch {
        /* ingen live-instans */
      }
      try {
        const style = document.getElementById("angel-style");
        if (style && style.parentElement) style.parentElement.removeChild(style);
        document
          .querySelectorAll(
            "[data-angel-injected],.angel-sticky-cta,.angel-secondary-cta,.angel-badge,.angel-debug-tag",
          )
          .forEach((el) => el.remove());
        document
          .querySelectorAll(".angel-emphasized,.angel-revealed,.angel-condensed")
          .forEach((el) =>
            el.classList.remove("angel-emphasized", "angel-revealed", "angel-condensed"),
          );
        document
          .querySelectorAll("[data-angel-moved]")
          .forEach((el) => el.removeAttribute("data-angel-moved"));
      } catch {
        /* städningen är best-effort */
      }
    });
  } catch {
    /* aldrig fatal */
  }
}

async function measurePersona(
  page: Page,
  args: {
    url: string;
    site: string;
    persona: PersonaId;
    inventory: ContentInventory;
    goal: SiteGoal | null;
    baseline: DomSignature;
    started: number;
    errBefore: number;
    consoleErrors: string[];
    captureShots: boolean;
    onShot?: (shot: Shot) => void;
    allowLayoutPatterns?: boolean;
  },
): Promise<RobustnessReport> {
  const { url, site, persona, inventory, goal, started, errBefore, consoleErrors } = args;
  const context = personaContext(persona, url);
  const decision = decide(site, context, inventory, {}, goal ?? undefined, {
    allowLayoutPatterns: args.allowLayoutPatterns ?? false,
  });
  // Baseline PER persona, i personans viewport: prepare-baslinjen togs i
  // desktop-viewporten, men responsiva sajter monterar/avmonterar DOM vid
  // 390 px (hamburgermeny m.m.) — en global baslinje ger falska
  // "irreversibelt"-utslag för mobil-personan (granskningsfynd).
  const baseline = await signature(page);
  const adaptations = decision.adaptations;

  const probes = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ads: any) =>
      (ads as any[]).map((a) => {
        const r = (window as any).__angel.probe(a);
        return { pattern: a.pattern, op: a.op, via: r.via, count: r.count };
      }),
    adaptations,
  )) as AdaptationProbe[];

  // Stamp visible in-viewport elements and record their rects (R0). We then
  // watch the page's OWN motion over a control window (carousels, autoplay,
  // gradient animations) and net it out, so the reported shift reflects Angel's
  // change — not the page animating itself.
  const r0 = (await page.evaluate(() => {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const all = document.body ? document.body.getElementsByTagName("*") : [];
    const rects: { k: number; x: number; y: number; w: number; h: number }[] = [];
    let k = 0;
    for (let i = 0; i < all.length && k < 1500; i++) {
      const el = all[i] as HTMLElement;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      el.setAttribute("data-angel-vk", String(k));
      rects.push({ k, x: r.left, y: r.top, w: r.width, h: r.height });
      k++;
    }
    return { vw, vh, rects };
  })) as RectSet;

  // Ambient motion over the control window (no apply).
  await new Promise((r) => setTimeout(r, CONTROL_MS));
  const control = await measureAgainst(page, r0);

  // Re-baseline to the positions right before apply, so apply-motion excludes
  // the drift that already happened during the control window.
  const r1 = await readRects(page);

  if (args.captureShots && args.onShot) {
    args.onShot({ persona, phase: "before", jpegBase64: await shoot(page) });
  }

  // Record which interactive elements are clickable right before apply (scroll
  // is still at the top here — the re-render provoke that scrolls comes later).
  const interactiveBefore = await captureInteractiveBefore(page);

  // Horisontell overflow FÖRE apply — befintlig overflow är sajtens egen och
  // ska inte falla på Angel; skönhetsgrinden mäter bara det apply INFÖR.
  const hOverflowBefore = (await page.evaluate(
    () =>
      Math.max(
        0,
        (document.documentElement ? document.documentElement.scrollWidth : 0) -
          (document.documentElement ? document.documentElement.clientWidth : 0),
      ),
  )) as number;

  const applied = (await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d: any) => (window as any).__angel.apply(d),
    decision,
  )) as string[];
  const afterApply = await signature(page);

  const applyMove = await measureAgainst(page, r1);
  // Did any clickable element become unclickable? (covered / hidden / detached)
  const interaction = await measureInteractiveAfter(page, interactiveBefore);

  // Skönhetsgrindarna (VisualSanity, analyze.ts): flyttat innehåll ovanför
  // sidans huvudinnehåll (blogg-fallets signatur — FAQ ovanför artikel-
  // rubriken) och introducerad horisontell overflow. [data-angel-moved]
  // stämplas av snippetens move_up.
  const visual = (await page.evaluate((beforePx: number) => {
    const moved = document.querySelectorAll("[data-angel-moved]");
    // Huvudinnehålls-ankare: första synliga h1, annars main/article-toppen.
    let anchorTop: number | null = null;
    const h1s = document.querySelectorAll("h1");
    for (let i = 0; i < h1s.length; i++) {
      const r = h1s[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        anchorTop = r.top + window.scrollY;
        break;
      }
    }
    if (anchorTop === null) {
      const main = document.querySelector("main, article, [role='main']");
      if (main) anchorTop = main.getBoundingClientRect().top + window.scrollY;
    }
    let above = 0;
    for (let i = 0; i < moved.length; i++) {
      const r = moved[i].getBoundingClientRect();
      const top = r.top + window.scrollY;
      // 24px-marginal: "strax ovanför rubriken" (direkt under hero) är inte
      // trasigt; en flytt som parkerar KLART ovanför huvudinnehållet är det.
      if (anchorTop !== null && top < anchorTop - 24) above++;
    }
    const overflowNow = Math.max(
      0,
      (document.documentElement ? document.documentElement.scrollWidth : 0) -
        (document.documentElement ? document.documentElement.clientWidth : 0),
    );
    return {
      movedCount: moved.length,
      movedAboveMain: above,
      mainAnchorFound: anchorTop !== null,
      hOverflowIntroducedPx: Math.max(0, overflowNow - beforePx),
    };
  }, hOverflowBefore)) as VisualSanity;

  // Net out the ambient rate: the honest Angel-attributable shift.
  const netFraction = Math.max(0, applyMove.shiftedFraction - control.shiftedFraction);
  const layout: LayoutDiff = {
    matched: applyMove.matched,
    shiftedCount: applyMove.shiftedCount,
    shiftedFraction: netFraction,
    controlShiftedFraction: control.shiftedFraction,
    maxMove: applyMove.maxMove,
  };

  if (args.captureShots && args.onShot) {
    args.onShot({ persona, phase: "after", jpegBase64: await shoot(page) });
  }

  // Post-re-render stability: does our change survive a framework re-render?
  const residueAfterApply = Number(await page.evaluate(`window.__angel.residue()`));
  await provokeRerender(page);
  const residueAfterRerender = Number(await page.evaluate(`window.__angel.residue()`));
  const rerender: RerenderProbe = { residueAfterApply, residueAfterRerender };

  await page.evaluate(`window.__angel.reset()`);
  const afterReset = await signature(page);
  const residueAfterReset = Number(await page.evaluate(`window.__angel.residue()`));

  const observation: RobustnessObservation = {
    url,
    site,
    persona,
    reachable: true,
    snippetRan: true,
    consoleErrors: consoleErrors.slice(errBefore),
    decidedCount: adaptations.length,
    declined: decision.declined,
    appliedCount: Array.isArray(applied) ? applied.length : 0,
    probes,
    baseline,
    afterApply,
    afterReset,
    layout,
    rerender,
    interaction,
    visual,
    residueAfterReset,
    durationMs: Date.now() - started,
  };
  return analyze(observation);
}
