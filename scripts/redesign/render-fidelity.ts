#!/usr/bin/env bun
// Render-FIDELITETSTEST (ägaren 2026-07-26: "hur vet vi att vi renderade rätt?").
// Skala-testets recovery-mått bevisade bara "inte ett skal" (>=3 sektioner) — INTE
// att rendern är en TROGEN bild av den riktiga sidan. En cookie-vägg, bot-utmaning,
// fel-sida eller FEL sajt (oura.com → fransk kollektivtrafik) kan också ha >=3
// rubriker. Det här verifierar de 38 recovered-sajterna (scale-test #3): renderar,
// tar en SKÄRMBILD (artefakt för människo-/vision-koll) OCH kör deterministiska
// signatur/brand-checkar, och fäller en dom per sajt. Rent capture-lager (ingen
// LLM). Kräver BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID.

import { mkdirSync } from "node:fs";

import type { Page } from "playwright-core";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { serializeVisibleHtml } from "./visible-dom";

// De 38 sajter render RÄDDADE i scale-test #3 (REC|-raderna): statiskt skal/fall
// → >=3 renderade sektioner. Det är EXAKT de vars trohet vi inte vet något om.
const SITES = [
  "affirm.com", "airbnb.com", "brooklinen.com", "chime.com", "confluent.io", "doordash.com",
  "duolingo.com", "etsy.com", "glossier.com", "gymshark.com", "hashicorp.com", "hims.com",
  "jetbrains.com", "klarna.com", "kyliecosmetics.com", "masterclass.com", "opentable.com",
  "patagonia.com", "patreon.com", "redfin.com", "rei.com", "render.com", "revolut.com",
  "ruggable.com", "sephora.com", "sofi.com", "tripadvisor.com", "uber.com", "udemy.com",
  "zoom.us", "canva.com", "dropbox.com", "ramp.com", "gusto.com", "quickbooks.intuit.com",
  "launchdarkly.com", "openai.com", "ritual.com",
];
const CONC = 3; // = Browserbase-samtidighetstaket (scale-test #3 höll på 3)
const OUT = "render-fidelity"; // skärmbilder hamnar här → laddas upp som artefakt

const apiKey = process.env.BROWSERBASE_API_KEY;
const projectId = process.env.BROWSERBASE_PROJECT_ID;

// ── fidelitets-signaturer (körs på den SYNLIGA texten, gemener) ──────────────
const CHALLENGE =
  /verifying you are human|checking your browser|enable javascript|please turn on javascript|are you a robot|access denied|attention required|cf-browser-verification|request could not be satisfied|unusual traffic/i;
const CONSENT =
  /accept all cookies|we use cookies|cookie preferences|manage (your )?consent|privacy preferences|this (site|website) uses cookies/i;
const ERRORPG =
  /\b(404|403)\b|page (not found|can.?t be found|isn.?t available|does(n.?t| not) exist)|something went wrong|internal server error|service unavailable/i;

/** Brand-token = domänens första label (quickbooks.intuit.com → quickbooks).
 *  <4 tecken (ro.co, hey, go) är för generiska att lita på → null (hoppa checken). */
function brandToken(host: string): string | null {
  const label = host.replace(/^www\./, "").split(".")[0]?.toLowerCase() ?? "";
  return label.length >= 4 ? label : null;
}

interface Fid {
  site: string; ok: boolean; err?: string; secs: number; len: number;
  title: string; head: string; verdict: string;
}

/** Deterministisk dom. FAITHFUL? behåller frågetecknet — automatiken kan utesluta
 *  vägg/utmaning/fel-sajt/tunn, men "ser ut som riktig sida" bekräftas av skärmbild. */
function judge(host: string, secs: number, text: string, title: string): string {
  const t = text.toLowerCase();
  const lit = text.replace(/\s+/g, " ").trim();
  const len = lit.length;
  if (CHALLENGE.test(t)) return "CHALLENGE";
  if (ERRORPG.test(t) && len < 1500) return "ERROR";
  if (CONSENT.test(t) && len < 600) return "CONSENT-WALL"; // bara BANNER, ingen sida bakom
  const bt = brandToken(host);
  if (bt && !`${title} ${lit}`.toLowerCase().includes(bt)) return "WRONG-PAGE?";
  if (secs < 3 || len < 800) return "PARTIAL/THIN";
  return "FAITHFUL?";
}

async function renderCheck(site: string): Promise<Fid> {
  const full = site.startsWith("http") ? site : `https://${site}`;
  const base: Fid = { site, ok: false, secs: 0, len: 0, title: "", head: "", verdict: "RENDER-FAIL" };
  let cleanup = async () => {};
  try {
    const { createSession, closeSession } = await import("../../src/lib/tests/browserbase.server");
    const { Stagehand } = await import("@browserbasehq/stagehand");
    const { errors } = await import("playwright-core");
    const session = await createSession();
    const stagehand = new Stagehand({
      env: "BROWSERBASE", apiKey, projectId,
      browserbaseSessionID: session.id, keepAlive: true, disablePino: true,
    });
    cleanup = async () => {
      await stagehand.close().catch(() => {});
      await closeSession(session.id).catch(() => {});
    };
    await stagehand.init();
    const page = (stagehand.context.pages()[0] ?? (await stagehand.context.newPage())) as unknown as Page;
    await page.setViewportSize({ width: 390, height: 844 }).catch(() => {});
    await page.goto(full, { waitUntil: "load", timeout: 45_000 }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!(err instanceof errors.TimeoutError) && !/tim(?:e|ed)\s*[- ]?out/i.test(msg)) throw err;
      return null;
    });
    await page
      .evaluate(async () => {
        await new Promise((resolve) => {
          let y = 0;
          const t = setInterval(() => {
            window.scrollBy(0, 900);
            y += 900;
            if (y >= document.body.scrollHeight - 1200 || y > 40000) { clearInterval(t); window.scrollTo(0, 0); resolve(null); }
          }, 80);
        });
      })
      .catch(() => {});
    await page.waitForTimeout(800).catch(() => {});
    const slug = site.replace(/[^\w.-]/g, "_");
    await page.screenshot({ path: `${OUT}/${slug}.png` }).catch(() => {}); // above-fold: real-vs-vägg
    const title = ((await page.title().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    const text = ((await page.evaluate(() => document.body?.innerText || "").catch(() => "")) as string) || "";
    const html = await serializeVisibleHtml(page);
    const lit = text.replace(/\s+/g, " ").trim();
    base.ok = true;
    base.secs = extractContentModel(html).sections.length;
    base.len = lit.length;
    base.title = title.replace(/\|/g, "/").slice(0, 70);
    base.head = lit.slice(0, 110).replace(/\|/g, "/");
    base.verdict = judge(site, base.secs, text, title);
    return base;
  } catch (e) {
    base.err = (e as Error).message.replace(/\s+/g, " ").slice(0, 70);
    return base;
  } finally {
    await cleanup();
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function w() { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => w()));
  return out;
}

if (!apiKey || !projectId) {
  console.log("::warning::BROWSERBASE_API_KEY/PROJECT_ID saknas — kan ej rendera, testet är meningslöst.");
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });

const rows = await pool(SITES, CONC, async (site) => {
  const f = await renderCheck(site);
  console.log(
    `FID|${f.site}|${f.verdict}|secs=${f.secs}|len=${f.len}|title=${f.title}|head=${f.head}${f.err ? "|err=" + f.err : ""}`,
  );
  return f;
});

const by: Record<string, Fid[]> = {};
for (const r of rows) (by[r.verdict] ??= []).push(r);
const n = (v: string) => (by[v]?.length ?? 0);
console.log("\n===FID-AGG===");
console.log(`sites ${rows.length}`);
console.log(
  `FAITHFUL? ${n("FAITHFUL?")} | WRONG-PAGE? ${n("WRONG-PAGE?")} | CONSENT-WALL ${n("CONSENT-WALL")} | CHALLENGE ${n("CHALLENGE")} | ERROR ${n("ERROR")} | PARTIAL/THIN ${n("PARTIAL/THIN")} | RENDER-FAIL ${n("RENDER-FAIL")}`,
);
for (const v of ["WRONG-PAGE?", "CONSENT-WALL", "CHALLENGE", "ERROR", "PARTIAL/THIN", "RENDER-FAIL"]) {
  if (n(v)) console.log(`${v}: ${by[v].map((r) => r.site).join(", ")}`);
}
const faithfulPct = ((n("FAITHFUL?") / rows.length) * 100).toFixed(0);
console.log(`\nautomated-faithful: ${n("FAITHFUL?")}/${rows.length} (${faithfulPct}%) — confirm the FAITHFUL? set against the screenshot artifact`);

// Tvinga exit: Browserbase keepAlive-handtag håller annars processen vid liv.
process.exit(0);
