// Runtime spike: verify if playwright-core and Stagehand load+run inside the
// Cloudflare Worker (workerd) runtime when used only as CDP clients against
// a pre-started Browserbase session.

import { createServerFn } from "@tanstack/react-start";
import { createSession, closeSession } from "./browserbase.server";

type SpikeResult = {
  ok: boolean;
  durationMs: number;
  title?: string;
  error?: string;
  stack?: string;
};

export const spikePlaywright = createServerFn({ method: "POST" }).handler(
  async (): Promise<SpikeResult> => {
    const t0 = Date.now();
    let sessionId: string | undefined;
    try {
      const { chromium } = await import("playwright-core");
      const session = await createSession();
      sessionId = session.id;
      const browser = await chromium.connectOverCDP(session.connectUrl);
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto("https://glutenforum.se", { waitUntil: "load", timeout: 30_000 });
      const title = await page.title();
      await browser.close().catch(() => {});
      return { ok: true, durationMs: Date.now() - t0, title };
    } catch (err) {
      const e = err as Error;
      return { ok: false, durationMs: Date.now() - t0, error: e?.message ?? String(err), stack: e?.stack };
    } finally {
      if (sessionId) await closeSession(sessionId).catch(() => {});
    }
  },
);

export const spikeStagehand = createServerFn({ method: "POST" }).handler(
  async (): Promise<SpikeResult> => {
    const t0 = Date.now();
    let sessionId: string | undefined;
    try {
      const { Stagehand } = await import("@browserbasehq/stagehand");
      const session = await createSession();
      sessionId = session.id;
      const stagehand = new Stagehand({
        env: "BROWSERBASE",
        apiKey: process.env.BROWSERBASE_API_KEY,
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        browserbaseSessionID: session.id,
      });
      await stagehand.init();
      const page = await stagehand.context.newPage("https://glutenforum.se");
      const title = await page.title();
      await stagehand.close().catch(() => {});
      return { ok: true, durationMs: Date.now() - t0, title };
    } catch (err) {
      const e = err as Error;
      return { ok: false, durationMs: Date.now() - t0, error: e?.message ?? String(err), stack: e?.stack };
    } finally {
      if (sessionId) await closeSession(sessionId).catch(() => {});
    }
  },
);
