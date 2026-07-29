#!/usr/bin/env bun
// One-off diagnostic: connect via Browserbase (same env as freeze), goto a URL,
// wait for a consent banner to settle, and dump every cookie/consent-related
// element's id/class/tag/text/onclick so we can pick a REAL selector instead of
// guessing vendor-template ids. Read-only — captures nothing.
//
//   bun run scripts/probe-consent-dom.ts --url=https://www.sectoralarm.se/
//
// (Kept in scripts/ because it earns its keep every time a CMP ships a custom
// template — same diagnostic loop as --dry-run --screenshot-before-dismiss,
// one level deeper.)

import { Stagehand } from "@browserbasehq/stagehand";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const url = arg("url");
if (!url) {
  console.error("Usage: bun run scripts/probe-consent-dom.ts --url=<url>");
  process.exit(1);
}

const apiKey = process.env.BROWSERBASE_API_KEY;
const projectId = process.env.BROWSERBASE_PROJECT_ID;
if (!apiKey || !projectId) {
  console.error("BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID required");
  process.exit(1);
}

const session = await createSession();
const stagehand = new Stagehand({
  env: "BROWSERBASE",
  apiKey,
  projectId,
  browserbaseSessionID: session.id,
  browserbaseSessionCreateParams: { projectId, region: session.region },
  keepAlive: false,
});

try {
  await stagehand.init();
  const page = stagehand.context.pages()[0] ?? (await stagehand.context.newPage());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  // Consent injiceras ofta async — ge taghanteraren tid.
  await new Promise((r) => setTimeout(r, 6000));

  const dump = await page.evaluate(`(() => {
    const out = [];
    const seen = new Set();
    const RX = /cookie|consent|coi|cybot|didomi|onetrust|usercentric/i;
    // Pass 1: element vars id/class nämner en CMP-vendor.
    for (const el of document.querySelectorAll('*')) {
      const idc = (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '');
      if (!RX.test(idc)) continue;
      // Bara containrar + interaktiva element; hoppa över style/script.
      if (/^(STYLE|SCRIPT|LINK|META)$/.test(el.tagName)) continue;
      const isBtn = /^(BUTTON|A)$/.test(el.tagName);
      const key = el.tagName + '#' + el.id + '.' + idc;
      if (seen.has(key) && !isBtn) continue;
      seen.add(key);
      const r = el.getBoundingClientRect();
      out.push({
        tag: el.tagName,
        id: el.id || null,
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120) || null,
        text: isBtn ? (el.textContent || '').trim().slice(0, 60) : null,
        onclick: el.getAttribute && (el.getAttribute('onclick') || '').slice(0, 120) || null,
        visible: r.width > 0 && r.height > 0,
      });
      if (out.length >= 60) break;
    }
    // Pass 3: textbaserat — knappar vars text ÄR en consent-fras, oavsett hur
    // containern heter (helt egenbyggda dialoger à la bokadirekt: inga
    // cookie/consent-namn någonstans i id/class). Dumpar självets attribut +
    // närmaste förfäder med id/class/data-attribut så en selektor kan byggas.
    const TXT = /till[åa]t alla|godk[äa]nn alla|acceptera( alla)?|accept all|jag f[öo]rst[åa]r|cookie/i;
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      const t = (el.textContent || '').trim();
      if (t.length > 60 || !TXT.test(t)) continue;
      const r = el.getBoundingClientRect();
      const chain = [];
      let cur = el;
      for (let d = 0; cur && d < 6; d++) {
        const attrs = {};
        for (const a of (cur.attributes || [])) {
          if (/^(id|class|data-[a-z-]+|aria-label|role)$/.test(a.name)) attrs[a.name] = a.value.slice(0, 80);
        }
        chain.push(cur.tagName + ' ' + JSON.stringify(attrs));
        cur = cur.parentElement;
      }
      out.push({
        pass: 3,
        text: t.slice(0, 60),
        visible: r.width > 0 && r.height > 0,
        chain,
      });
      if (out.length >= 100) break;
    }
    // Pass 2: ALLA knappar/länkar INUTI en vendor-container — custom-mallar
    // ger ofta knapparna klasslösa/omärkta namn (pass 1 missar dem).
    const roots = document.querySelectorAll('#coiOverlay, #cookie-information-template-wrapper, [id*="cookie" i], [id*="consent" i]');
    for (const root of roots) {
      for (const el of root.querySelectorAll('button, a')) {
        const r = el.getBoundingClientRect();
        const entry = {
          pass: 2,
          tag: el.tagName,
          id: el.id || null,
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120) || null,
          text: (el.textContent || '').trim().slice(0, 60),
          onclick: el.getAttribute && (el.getAttribute('onclick') || '').slice(0, 160) || null,
          visible: r.width > 0 && r.height > 0,
        };
        const key = JSON.stringify(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
        if (out.length >= 100) break;
      }
    }
    return JSON.stringify(out, null, 1);
  })()`);
  console.log(dump);
} finally {
  try {
    await stagehand.close();
  } catch {
    /* best effort */
  }
  await closeSession(session.id).catch(() => {});
}
