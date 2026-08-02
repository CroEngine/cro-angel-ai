#!/usr/bin/env bun
// Bot-wall probe: mäter om vår Browserbase-session tar sig FÖRBI hårda
// bot-skydd (Cloudflare Bot Management, DataDome, Akamai, PerimeterX/HUMAN,
// Kasada) och landar på riktigt innehåll — eller fastnar på en challenge-/
// blocksida. En naiv "capture lyckades" kan vara en fångad spärrsida, så vi
// scannar svaret efter vendor-signaturer i stället för att lita på HTTP 200.
//
//   bun run scripts/bot-probe.ts --url=https://www.g2.com/ [--geo=SE] [--fingerprint] [--advanced]
//
// Stealth-nivåer att jämföra:
//   (utan flagga)  bas-stealth (blockAds + solveCaptchas + residential proxy)
//   --fingerprint  + realistisk desktop-fingerprint (icke-Enterprise-lever mot
//                  fingerprint-baserad bot-detektering, t.ex. DataDome)
//   --advanced     + advancedStealth + mac-fingerprint (Enterprise-gatat;
//                  faller tyst tillbaka till bas om planen nekar — loggas)
//
// Skriver screenshot till scratchpad och en JSON-verdict till stdout.

import { writeFileSync } from "node:fs";

import { Stagehand } from "@browserbasehq/stagehand";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";
import { detectWallVendors } from "../src/lib/tests/snapshot/bot-wall";

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  const f = process.argv.find((a) => a.startsWith(p));
  return f ? f.slice(p.length) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const url = arg("url");
  if (!url) {
    console.error(
      "Usage: bun run scripts/bot-probe.ts --url=... [--geo=SE] [--fingerprint] [--advanced]",
    );
    process.exit(1);
  }
  const geo = arg("geo");
  const advanced = flag("advanced");
  const host = new URL(url).hostname.replace(/^www\./, "");
  const tier = advanced ? "advanced" : "base";

  console.log(`[bot-probe] ${url} · tier=${tier}${geo ? ` · geo=${geo}` : ""}`);

  const session = await createSession({
    proxyCountry: geo,
    advancedStealth: advanced,
    fingerprint: flag("fingerprint"),
    meta: { pipeline: "bot-probe", site: host },
  });

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    browserbaseSessionID: session.id,
    browserbaseSessionCreateParams: {
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      region: session.region,
    },
    keepAlive: false,
  });

  const verdict: Record<string, unknown> = {
    url,
    tier,
    geo: geo ?? null,
    sessionId: session.id,
    inspector: `https://www.browserbase.com/sessions/${session.id}`,
  };

  try {
    await stagehand.init();
    const page = stagehand.context.pages()[0] ?? (await stagehand.context.newPage());
    await page.setViewportSize(1280, 800);

    let status: number | null = null;
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 45_000 });
      status = resp?.status() ?? null;
    } catch (e) {
      verdict.gotoError = e instanceof Error ? e.message.split("\n")[0] : String(e);
    }
    // Låt en ev. challenge-runtime (Cloudflare/DataDome JS) hinna lösa/omdirigera.
    await page.waitForTimeout(6000);

    const finalUrl = page.url();
    const title = await page.title().catch(() => "");
    const bodyText: string = await page
      .evaluate(() => (document.body ? document.body.innerText : ""))
      .catch(() => "");
    const html: string = await page
      .evaluate(() => document.documentElement.outerHTML)
      .catch(() => "");

    const hay = `${title}\n${finalUrl}\n${bodyText.slice(0, 4000)}\n${html.slice(0, 8000)}`;
    const walls = detectWallVendors(hay);

    const shotPath = `/tmp/claude-0/-home-user-cro-angel-ai/d3c2b465-ae1e-5695-87f1-3a697acf152b/scratchpad/botprobe-${host}-${tier}.jpg`;
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
      writeFileSync(shotPath, buf);
      verdict.screenshot = shotPath;
    } catch (e) {
      verdict.screenshotError = e instanceof Error ? e.message.split("\n")[0] : String(e);
    }

    verdict.status = status;
    verdict.finalUrl = finalUrl;
    verdict.title = title;
    verdict.bodyTextLen = bodyText.length;
    verdict.bodyHead = bodyText.slice(0, 240).replace(/\s+/g, " ").trim();
    verdict.wallsDetected = walls;
    // Heuristik: en riktig marknadssida har normalt tusentals tecken text.
    // Kort text + wall-signatur = blockad. Kort text utan signatur = suspekt.
    verdict.likelyBlocked = walls.length > 0 || bodyText.length < 500;
  } finally {
    try {
      await stagehand.close();
    } catch {
      /* ignore */
    }
    await closeSession(session.id);
  }

  console.log(JSON.stringify(verdict, null, 2));
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
