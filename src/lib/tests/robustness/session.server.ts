// Minimal Stagehand page opener for one-off runners (robustness sweep).
//
// engine.server.ts owns the full step-runner; this is a thin helper that just
// attaches Stagehand to an existing Browserbase session and hands back a live
// page, with the same Netlify-safe options (keepAlive + disablePino). Imported
// lazily so Stagehand never lands in the worker's init bundle.

import { Stagehand, type Page } from "@browserbasehq/stagehand";

export interface OpenPage {
  page: Page;
  close: () => Promise<void>;
}

/** Click a consent-banner "accept" control: known CMP selectors first, then a
 *  STRICT text fallback (exakta accepterafraser, sv/en) för egenbyggda banners.
 *  Selector-only lämnade 3 av 7 sajter bakom cookie-väggar genom hela
 *  fotograferingen (nattkörningen 2026-07-07) — varje FÖRE/EFTER-bild blev en
 *  cookie-vägg. Fallbacken är ankrad (^…$), kort (≤40 tecken) och kräver
 *  synlighet, så den kan inte träffa sidans egna CTA:er.
 *  Best-effort; no-op when nothing matches. */
export async function dismissConsent(page: Page): Promise<void> {
  const SELECTORS = [
    "#onetrust-accept-btn-handler",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    "#didomi-notice-agree-button",
    ".osano-cm-accept-all",
    ".cc-allow",
    "#axeptio_btn_acceptAll",
    ".fc-cta-consent .fc-button",
    "[data-testid='uc-accept-all-button']",
    "[aria-label='Accept all']",
    '[data-cy="allowCookiesButton"]', // egenbyggd CMP (elgiganten m.fl.)
  ];
  const ACCEPT_TEXT =
    "^(acceptera( alla( kakor| cookies)?)?|godkänn( alla( kakor| cookies)?)?|tillåt alla( kakor| cookies)?|jag förstår|accept all( cookies)?|allow all( cookies)?)$";
  try {
    await page.evaluate(
      ({ sels, rx }: { sels: string[]; rx: string }) => {
        for (const s of sels) {
          const el = document.querySelector(s) as HTMLElement | null;
          if (el && el.offsetParent !== null) {
            el.click();
            return;
          }
        }
        const re = new RegExp(rx, "i");
        // Text-fallbacken får BARA klicka inuti något som ser ut som en
        // consent-container — ett blott "Godkänn" kan annars vara sidans egen
        // formulärknapp och ett klick där förändrar sidan vi ska mäta
        // (granskningsfynd: de valfria grupperna gör bara verbet matchande).
        const CONSENT_CONTAINER =
          '[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[id*="consent" i],[class*="cmp" i],[id*="cmp" i],[class*="gdpr" i],[id*="gdpr" i],[aria-label*="cookie" i]';
        const cands = document.querySelectorAll("button,[role='button'],a");
        for (let i = 0; i < cands.length; i++) {
          const el = cands[i] as HTMLElement;
          const t = (el.textContent || "").trim();
          if (
            t &&
            t.length <= 40 &&
            re.test(t) &&
            el.offsetParent !== null &&
            el.closest(CONSENT_CONTAINER)
          ) {
            el.click();
            return;
          }
        }
      },
      { sels: SELECTORS, rx: ACCEPT_TEXT },
    );
  } catch {
    /* non-fatal */
  }
}

/** Wait until the page has rendered interactive content (SPA hydrated) or the
 *  budget elapses — so we don't audit a still-empty shell at domcontentloaded. */
export async function waitForContent(page: Page, budgetMs = 8000): Promise<void> {
  const step = 500;
  for (let waited = 0; waited < budgetMs; waited += step) {
    try {
      const n = (await page.evaluate(
        () => document.querySelectorAll("a,button,[role='button']").length,
      )) as number;
      if (n >= 5) return;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, step));
  }
}

export async function openPage(sessionId: string): Promise<OpenPage> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY missing");
  if (!projectId) throw new Error("BROWSERBASE_PROJECT_ID missing");

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    browserbaseSessionID: sessionId,
    keepAlive: true,
    disablePino: true,
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0] ?? (await stagehand.context.newPage());
  return {
    page,
    close: async () => {
      try {
        await stagehand.close();
      } catch {
        /* disconnect only — the Browserbase session is released separately */
      }
    },
  };
}
