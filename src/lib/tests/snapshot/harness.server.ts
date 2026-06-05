// Replay a frozen corpus page through COLLECT_SCRIPT + pageAudit, producing
// the same shape the live engine produces — so normalize.ts can diff it
// against corpus/<name>/golden.json.
//
// Replay uses Browserbase so the runtime exactly matches live test runs.
// Loading strategy: CDP Fetch domain intercepts a fake URL and returns the
// MHTML bytes with `Content-Type: multipart/related; boundary=...`. That is
// the response shape Chromium needs to actually parse MHTML — a
// data:multipart/related URL does NOT trigger MHTML parsing (Chromium loads
// it as opaque text, document.body ends up empty), and `page.goto` with a
// base64 data URL also hits Stagehand's HTTP-API 1 MB cap (413).
//
// Because the MHTML embeds all CSS/images/fonts, no live network is hit
// during replay.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { Stagehand } from "@browserbasehq/stagehand";

import { createSession, closeSession } from "../browserbase.server";
import { COLLECT_SCRIPT } from "../scripts/collect";
import { runPageAudit } from "../runners/pageAudit.server";
import { FREEZE_VIEWPORT } from "./freeze.server";

import type { CollectedElement } from "../schema";

const FAKE_HOST = "https://snapshot.local";
const FAKE_URL = `${FAKE_HOST}/page.mhtml`;

export interface ReplayResult {
  collect: unknown;
  pageAudit: unknown;
}

// Extract the multipart boundary string from MHTML headers. The boundary is
// declared in the top-level Content-Type header and may span continuation lines.
function parseBoundary(mhtml: string): string {
  const headerEnd = mhtml.indexOf("\r\n\r\n");
  const head = headerEnd > 0 ? mhtml.slice(0, headerEnd) : mhtml.slice(0, 4000);
  // Collapse header continuations: CRLF + whitespace -> single space.
  const flat = head.replace(/\r\n[\t ]+/g, " ");
  const m = flat.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  if (!m) throw new Error("MHTML: could not parse multipart boundary from headers");
  return m[1];
}

async function loadMhtml(
  page: import("@browserbasehq/stagehand").Page,
  mhtml: string,
) {
  const boundary = parseBoundary(mhtml);
  // Fetch.fulfillRequest expects base64 body. Fine for 1–5 MB MHTML since
  // CDP rides the persistent WebSocket (no HTTP body cap).
  const bodyB64 = Buffer.from(mhtml, "utf8").toString("base64");
  const contentType = `multipart/related; boundary="${boundary}"`;

  // Main-frame CDP session — page.sendCDP is send-only and cannot subscribe.
  const cdp = page.getSessionForFrame(page.mainFrameId());

  let pausedCount = 0;
  let fulfilledMain = false;
  const seenUrls: string[] = [];

  const onPaused = async (params: { requestId: string; request: { url: string } }) => {
    pausedCount++;
    if (seenUrls.length < 10) seenUrls.push(params.request.url);
    try {
      if (params.request.url.startsWith(FAKE_HOST)) {
        fulfilledMain = true;
        await cdp.send("Fetch.fulfillRequest", {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: contentType },
            { name: "Cache-Control", value: "no-store" },
          ],
          body: bodyB64,
        });
      } else {
        await cdp.send("Fetch.continueRequest", { requestId: params.requestId });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[loadMhtml] fulfill error:", e instanceof Error ? e.message : e);
    }
  };

  cdp.on("Fetch.requestPaused", onPaused);

  try {
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await page.sendCDP("Page.enable", {});
    await page.sendCDP("Page.navigate", { url: FAKE_URL });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const ready = await page.evaluate("document.readyState");
        if (ready === "complete") break;
      } catch {
        /* navigation in flight */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 600));

    // Diagnostics so we can see what actually happened.
    try {
      const probe = await page.evaluate(
        "JSON.stringify({ url: location.href, title: document.title, bodyLen: (document.body && document.body.innerHTML.length) || 0, h1s: document.querySelectorAll('h1').length })",
      );
      // eslint-disable-next-line no-console
      console.log(
        `[loadMhtml] pausedCount=${pausedCount} fulfilledMain=${fulfilledMain} probe=${probe} seen=${JSON.stringify(seenUrls)}`,
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[loadMhtml] probe failed:", e instanceof Error ? e.message : e);
    }
  } finally {
    try {
      await cdp.send("Fetch.disable");
    } catch {
      /* ignore */
    }
    cdp.off("Fetch.requestPaused", onPaused);
  }
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
