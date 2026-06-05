// Replay a frozen corpus page through COLLECT_SCRIPT + pageAudit, producing
// the same shape the live engine produces — so normalize.ts can diff it
// against corpus/<name>/golden.json.
//
// Replay uses Browserbase so the runtime exactly matches live test runs
// (same Chromium build, same headless config). MHTML is uploaded to the
// session by navigating to a data: URL that triggers a load of the inlined
// document. Because the MHTML embeds all CSS/images, no live network is hit.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { Stagehand } from "@browserbasehq/stagehand";

import { createSession, closeSession } from "../browserbase.server";
import { COLLECT_SCRIPT } from "../scripts/collect";
import { runPageAudit } from "../runners/pageAudit.server";
import { FREEZE_VIEWPORT } from "./freeze.server";

import type { CollectedElement } from "../schema";

export interface ReplayResult {
  collect: unknown;
  pageAudit: unknown;
}

async function loadMhtml(page: import("@browserbasehq/stagehand").Page, mhtml: string) {
  // Chromium accepts MHTML via a data:multipart/related URL. We must go via
  // raw CDP Page.navigate (WebSocket) — page.goto() routes through Stagehand's
  // HTTP API which 413s anything over ~1 MB body, and MHTML for real sites is
  // routinely 1–5 MB.
  const b64 = Buffer.from(mhtml, "utf8").toString("base64");
  const dataUrl = `data:multipart/related;base64,${b64}`;
  await page.sendCDP("Page.enable", {});
  await page.sendCDP("Page.navigate", { url: dataUrl });
  // Wait for the document to settle. CDP load events are noisy for data: URLs,
  // so we poll document.readyState.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate("document.readyState");
    if (ready === "complete") break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // Give layout + CSSOM a beat after ready.
  await new Promise((r) => setTimeout(r, 600));
}

export async function replayCorpus(name: string, corpusRoot = "corpus"): Promise<ReplayResult> {
  const dir = join(corpusRoot, name);
  const mhtmlPath = join(dir, "page.mhtml");
  if (!existsSync(mhtmlPath)) {
    throw new Error(`corpus/${name}/page.mhtml not found — run freeze-site first`);
  }
  const mhtml = readFileSync(mhtmlPath, "utf8");

  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID required for replay");
  }

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

    await loadMhtml(page, mhtml);

    const elements = (await page.evaluate(COLLECT_SCRIPT)) as CollectedElement[];
    const pageAudit = await runPageAudit(page);

    return {
      collect: { target: "clickables", elements, count: elements.length },
      pageAudit,
    };
  } finally {
    try {
      await stagehand.close();
    } catch {
      /* ignore */
    }
    await closeSession(session.id);
  }
}
