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

async function loadMhtml(page: any, mhtml: string) {
  // Chromium accepts MHTML via Page.navigate to a file:// or via a CDP
  // Page.setDocumentContent-like trick. The simplest cross-env approach:
  // base64-encode and navigate to a data: URL with message/rfc822.
  const b64 = Buffer.from(mhtml, "utf8").toString("base64");
  const dataUrl = `data:multipart/related;base64,${b64}`;
  await page.goto(dataUrl, { waitUntil: "load", timeout: 30_000 });
  // Give layout a beat after CSSOM settles.
  await new Promise((r) => setTimeout(r, 400));
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
    await page.setViewportSize(FREEZE_VIEWPORT);

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
