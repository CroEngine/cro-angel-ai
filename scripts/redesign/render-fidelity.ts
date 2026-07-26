#!/usr/bin/env bun
// Render-FIDELITETSTEST (ägaren 2026-07-26: "hur vet vi att vi renderade rätt?").
// Skala-testets recovery-mått bevisade bara "inte ett skal" (>=3 sektioner) — INTE
// att rendern är en TROGEN bild av den riktiga sidan. En cookie-vägg, bot-utmaning,
// fel-sida, OSTYLAD render (sofi.com) eller FEL sajt (oura.com → fransk kollektiv-
// trafik) kan också ha >=3 rubriker. Det här verifierar de 38 recovered-sajterna
// (scale-test #3): renderar via den delade vägen (med modal-avfärdning +
// stylad-koll), tar en SKÄRMBILD (artefakt för människo-/vision-koll) OCH kör
// deterministiska signatur/brand-checkar, och fäller en dom per sajt. Rent
// capture-lager (ingen LLM). Kräver BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID.

import { mkdirSync } from "node:fs";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { mapPool } from "./pool";
import { renderVisibleCapture } from "./render-page";

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

// ── fidelitets-signaturer (körs på den SYNLIGA texten, gemener) ──────────────
const CHALLENGE =
  /verifying (?:you are human|your browser)|checking your browser|security checkpoint|just a moment|enable javascript|please turn on javascript|are you a robot|access denied|attention required|cf-browser-verification|request could not be satisfied|unusual traffic/i;
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
  site: string; ok: boolean; secs: number; len: number;
  title: string; head: string; verdict: string;
}

/** Deterministisk dom. FAITHFUL? behåller frågetecknet — automatiken kan utesluta
 *  ostylad/vägg/utmaning/fel-sajt/tunn, men "ser ut som riktig sida" bekräftas av
 *  skärmbild. (Fidelitetskörning 2026-07-26: automatiken flaggade FEL sajt (kylie,
 *  falsk brand-träff) och MISSADE den enda trasiga (sofi) — skärmbild är facit.) */
function judge(host: string, secs: number, text: string, title: string, styled: boolean): string {
  if (!styled) return "UNSTYLED"; // CSS applicerades aldrig — trasig render (sofi)
  const t = text.toLowerCase();
  const len = text.length;
  if (CHALLENGE.test(t)) return "CHALLENGE";
  if (ERRORPG.test(t) && len < 1500) return "ERROR";
  if (CONSENT.test(t) && len < 600) return "CONSENT-WALL"; // bara BANNER, ingen sida bakom
  // Separator-okänslig brand-match: "Kylie Cosmetics" ska räknas som brand-token
  // "kyliecosmetics" (fidelitet #3: kyliecosmetics feltflaggades WRONG-PAGE? trots
  // äkta sida). Strippa allt utom a-z0-9 på båda sidor.
  const bt = brandToken(host);
  const hay = `${title} ${t}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (bt && !hay.includes(bt)) return "WRONG-PAGE?";
  if (secs < 3 || len < 800) return "PARTIAL/THIN";
  return "FAITHFUL?";
}

async function renderCheck(site: string): Promise<Fid> {
  const full = site.startsWith("http") ? site : `https://${site}`;
  const slug = site.replace(/[^\w.-]/g, "_");
  const cap = await renderVisibleCapture(full, { screenshotPath: `${OUT}/${slug}.png` });
  if (!cap) return { site, ok: false, secs: 0, len: 0, title: "", head: "", verdict: "RENDER-FAIL" };
  const secs = extractContentModel(cap.html).sections.length;
  return {
    site,
    ok: true,
    secs,
    len: cap.text.length,
    title: cap.title.replace(/\|/g, "/").slice(0, 70),
    head: cap.text.slice(0, 110).replace(/\|/g, "/"),
    verdict: judge(site, secs, cap.text, cap.title, cap.styled),
  };
}

if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
  console.log("::warning::BROWSERBASE_API_KEY/PROJECT_ID saknas — kan ej rendera, testet är meningslöst.");
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });

const rows = await mapPool(SITES, CONC, async (site) => {
  const f = await renderCheck(site);
  console.log(`FID|${f.site}|${f.verdict}|secs=${f.secs}|len=${f.len}|title=${f.title}|head=${f.head}`);
  return f;
});

const by: Record<string, Fid[]> = {};
for (const r of rows) (by[r.verdict] ??= []).push(r);
const n = (v: string) => by[v]?.length ?? 0;
console.log("\n===FID-AGG===");
console.log(`sites ${rows.length}`);
console.log(
  `FAITHFUL? ${n("FAITHFUL?")} | WRONG-PAGE? ${n("WRONG-PAGE?")} | CONSENT-WALL ${n("CONSENT-WALL")} | CHALLENGE ${n("CHALLENGE")} | ERROR ${n("ERROR")} | UNSTYLED ${n("UNSTYLED")} | PARTIAL/THIN ${n("PARTIAL/THIN")} | RENDER-FAIL ${n("RENDER-FAIL")}`,
);
for (const v of ["WRONG-PAGE?", "CONSENT-WALL", "CHALLENGE", "ERROR", "UNSTYLED", "PARTIAL/THIN", "RENDER-FAIL"]) {
  if (n(v)) console.log(`${v}: ${by[v].map((r) => r.site).join(", ")}`);
}
console.log(
  `\nautomated-faithful: ${n("FAITHFUL?")}/${rows.length} — CONFIRM against the screenshot artifact (automation flags direction, screenshots are truth)`,
);

process.exit(0); // Browserbase keepAlive-handtag håller annars processen vid liv
