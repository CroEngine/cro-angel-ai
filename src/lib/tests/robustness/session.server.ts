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

/** Click a known consent-banner "accept" control by CMP selector (never by
 *  text — language-agnostic) so consent-gated content renders and any scroll
 *  lock lifts. Best-effort; no-op when nothing matches. */
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
  ];
  try {
    await page.evaluate((sels: string[]) => {
      for (const s of sels) {
        const el = document.querySelector(s) as HTMLElement | null;
        if (el && el.offsetParent !== null) {
          el.click();
          return;
        }
      }
    }, SELECTORS);
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
