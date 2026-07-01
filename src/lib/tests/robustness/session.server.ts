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
