#!/usr/bin/env bun
// Skala-test (ägaren 2026-07-25: "testa detta på 200 hemsidor" → sedan "kör de
// 200 MED render som skal-fallback"). Kör HELA kedjan — golv (extractContentModel)
// → tak (classifySectionsLlm) → gruppera → ranka (rankProofItems) — över ~200
// riktiga sajter SAMTIDIGT (pool). Hämtning: STATISK först; föll den eller gav ett
// skal/tunt (<3 sektioner) RENDERAS sajten i Browserbase (Stagehand, den bevisade
// vägen — capture-test #4) och återfångas. Mäter hur många av de statiska fallen
// render räddar. Skriver aggregat + rad-orienterat SAMPLE + JSON-artefakt. Kräver
// ANTHROPIC_API_KEY (taket) + BROWSERBASE_API_KEY/PROJECT_ID (render-fallbacken).

import { writeFileSync } from "node:fs";

import type { Page } from "playwright-core";

import { extractContentModel, sectionBodyExcerpts } from "../../src/adaptive/redesign/extract";
import { classifySectionsLlm, passesEvidenceGate, PROMOTABLE, EVIDENCE } from "../../src/adaptive/redesign/section-llm.server";
import { rankProofItems } from "../../src/adaptive/redesign/proof-rank.server";
import { serializeVisibleHtml } from "./visible-dom";

const DEFAULT_URLS = ["affirm.com", "airbnb.com", "airtable.com", "allbirds.com", "aritzia.com", "arstechnica.com", "asana.com", "asos.com", "atlassian.com", "audible.com", "away.com", "bbc.com", "bloomberg.com", "blueapron.com", "bombas.com", "booking.com", "brex.com", "brilliant.org", "brooklinen.com", "calm.com", "carvana.com", "casper.com", "chewy.com", "chime.com", "chipotle.com", "clickup.com", "cloudflare.com", "coinbase.com", "confluent.io", "coursera.org", "cron.com", "databricks.com", "datadoghq.com", "digitalocean.com", "docker.com", "doordash.com", "drsquatch.com", "duolingo.com", "economist.com", "engadget.com", "etsy.com", "eventbrite.com", "everlane.com", "expedia.com", "fentybeauty.com", "figma.com", "fly.io", "ghost.org", "github.com", "gitlab.com", "gitpod.io", "glossier.com", "go.dev", "gradle.org", "gumroad.com", "gymshark.com", "hashicorp.com", "headspace.com", "height.app", "hellofresh.com", "heroku.com", "hey.com", "hims.com", "hm.com", "huggingface.co", "hulu.com", "ikea.com", "imdb.com", "instacart.com", "intercom.com", "jetbrains.com", "khanacademy.org", "kickstarter.com", "klarna.com", "kotlinlang.org", "kraken.com", "kyliecosmetics.com", "linear.app", "liquiddeath.com", "loom.com", "lululemon.com", "lyft.com", "masterclass.com", "medium.com", "mejuri.com", "monday.com", "mongodb.com", "netflix.com", "newyorker.com", "nike.com", "nodejs.org", "noom.com", "notion.so", "npr.org", "okta.com", "opentable.com", "oura.com", "patagonia.com", "patreon.com", "paypal.com", "peloton.com", "plaid.com", "postman.com", "python.org", "railway.app", "reactjs.org", "redfin.com", "rei.com", "render.com", "replit.com", "revolut.com", "ro.co", "robinhood.com", "ruggable.com", "rust-lang.org", "salesforce.com", "sephora.com", "servicenow.com", "shopify.com", "snowflake.com", "sofi.com", "spotify.com", "squarespace.com", "squareup.com", "stripe.com", "substack.com", "supabase.com", "superhuman.com", "svelte.dev", "sweetgreen.com", "tailwindcss.com", "target.com", "techcrunch.com", "theatlantic.com", "theverge.com", "tripadvisor.com", "turo.com", "twilio.com", "typeform.com", "uber.com", "udemy.com", "ulta.com", "uniqlo.com", "vercel.com", "vimeo.com", "vox.com", "vuejs.org", "warbyparker.com", "wayfair.com", "whoop.com", "wired.com", "wise.com", "wix.com", "wordpress.com", "workday.com", "zara.com", "zendesk.com", "zillow.com", "zoom.us", "canva.com", "miro.com", "dropbox.com", "box.com", "zapier.com", "webflow.com", "framer.com", "bigcommerce.com", "skillshare.com", "codecademy.com", "pluralsight.com", "ramp.com", "mercury.com", "gusto.com", "carta.com", "bill.com", "expensify.com", "quickbooks.intuit.com", "segment.com", "amplitude.com", "mixpanel.com", "sentry.io", "launchdarkly.com", "auth0.com", "openai.com", "anthropic.com", "replicate.com", "perplexity.ai", "cohere.com", "eightsleep.com", "ritual.com", "seed.com", "harrys.com", "grammarly.com", "hotjar.com", "pipedrive.com", "mailchimp.com", "calendly.com", "hubspot.com", "slack.com"];
const CONC = 8;
const GENERIC = new Set(["section", "content"]);
const FLOOR = 0.7;
const SHELL = 3; // <3 sektioner efter statisk hämtning = skal/tunt/fall → försök render
const MAX_RENDERS = 3; // samtidiga Browserbase-sessioner (plan-gräns), oberoende av CONC

const urlsArg = process.argv.find((a) => a.startsWith("--urls="))?.split("=")[1];
const URLS = urlsArg ? urlsArg.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_URLS;

interface Promo { host: string; from: string; to: string; conf: number; heading: string; excerpt: string }
interface RankBlock { host: string; type: string; items: { heading: string; strength: number; excerpt: string }[] }
interface SiteOut {
  host: string; ok: boolean; error?: string; sections: number; staticSections: number; generic: number;
  promotions: Promo[]; evidencePromos: number; groups: number; multiGroups: number; ranked: number; rankBlocks: RankBlock[];
  via: "static" | "render"; rendered: boolean; recovered: boolean; renderErr?: string;
}

// Semafor: begränsa SAMTIDIGA Browserbase-sessioner (plan-gräns) oberoende av
// poolens CONC — de statiska hämtningarna får vara CONC breda, renderna max MAX_RENDERS.
function makeSemaphore(max: number) {
  let active = 0;
  const waiters: (() => void)[] = [];
  return {
    async acquire(): Promise<void> {
      if (active < max) { active++; return; }
      await new Promise<void>((res) => waiters.push(res));
      active++;
    },
    release(): void { active--; waiters.shift()?.(); },
  };
}
const renderGate = makeSemaphore(MAX_RENDERS);

// Rendera en LEVANDE sida via Browserbase (Stagehand — den bevisade vägen,
// capture-test #4: gymshark 0→11 sektioner). Läck-säker: cleanup körs även vid
// init-fel; semaforen släpps alltid. Returnerar serialiserad synlig DOM, annars null.
async function renderHtml(full: string): Promise<string | null> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;
  await renderGate.acquire();
  let cleanup = async () => {};
  try {
    const { createSession, closeSession } = await import("../../src/lib/tests/browserbase.server");
    const { Stagehand } = await import("@browserbasehq/stagehand");
    const { errors } = await import("playwright-core");
    const session = await createSession();
    const stagehand = new Stagehand({ env: "BROWSERBASE", apiKey, projectId, browserbaseSessionID: session.id, keepAlive: true, disablePino: true });
    cleanup = async () => { await stagehand.close().catch(() => {}); await closeSession(session.id).catch(() => {}); };
    await stagehand.init();
    const page = (stagehand.context.pages()[0] ?? (await stagehand.context.newPage())) as unknown as Page;
    await page.setViewportSize({ width: 390, height: 844 }).catch(() => {});
    await page.goto(full, { waitUntil: "load", timeout: 45_000 }).catch((err) => {
      // Stagehands timeout är ingen playwright errors.TimeoutError-instans — matcha
      // även på meddelandet så tunga SPA:er serialiseras på renderat läge.
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
    return await serializeVisibleHtml(page);
  } finally {
    await cleanup();
    renderGate.release();
  }
}

async function doSite(url: string): Promise<SiteOut> {
  const full = url.startsWith("http") ? url : `https://${url}`;
  const host = full.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const base: SiteOut = { host, ok: false, sections: 0, staticSections: 0, generic: 0, promotions: [], evidencePromos: 0, groups: 0, multiGroups: 0, ranked: 0, rankBlocks: [], via: "static", rendered: false, recovered: false };
  try {
    // ── hämtning: statisk först, Browserbase-render vid skal/tunt/fall ──
    let html = "";
    let staticErr = "";
    try {
      const res = await fetch(full, { headers: { "user-agent": "Mozilla/5.0 (AngelAdaptive scale)" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (res.ok) html = await res.text();
      else staticErr = `HTTP ${res.status}`;
    } catch (e) { staticErr = (e as Error).message.slice(0, 50); }
    base.staticSections = html ? extractContentModel(html).sections.length : 0;

    if (base.staticSections < SHELL && process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID) {
      base.rendered = true;
      try {
        const rHtml = await renderHtml(full);
        const rSecs = rHtml ? extractContentModel(rHtml).sections.length : 0;
        if (rHtml && rSecs > base.staticSections) {
          html = rHtml;
          base.via = "render";
          if (rSecs >= SHELL) base.recovered = true; // skal/fall → riktig sida
        }
      } catch (e) { base.renderErr = (e as Error).message.slice(0, 50); }
    }

    if (!html) { base.error = staticErr || "empty"; return base; }
    const model = extractContentModel(html);
    const exc = new Map(sectionBodyExcerpts(html).map((e) => [e.heading.trim().toLowerCase(), e.excerpt]));
    const bodyOf = (h: string) => exc.get(h.trim().toLowerCase()) ?? "";
    base.sections = model.sections.length;
    const gens = model.sections.filter((s) => GENERIC.has(s.type) || s.type === "features");
    base.generic = model.sections.filter((s) => GENERIC.has(s.type)).length;
    const labels = await classifySectionsLlm(gens.map((s) => ({ heading: s.heading, body: bodyOf(s.heading) })));
    const lbl = new Map<string, { to: string; conf: number }>();
    gens.forEach((s, i) => { const l = labels?.[i]; if (l && l.confidence >= FLOOR && PROMOTABLE.has(l.type) && l.type !== s.type && passesEvidenceGate(l.type, `${s.heading} ${bodyOf(s.heading)}`)) lbl.set(s.heading, { to: l.type, conf: l.confidence }); });
    for (const s of model.sections) { const p = lbl.get(s.heading); if (p) { base.promotions.push({ host, from: s.type, to: p.to, conf: p.conf, heading: s.heading.slice(0, 80), excerpt: bodyOf(s.heading).slice(0, 150) }); if (EVIDENCE.has(p.to)) base.evidencePromos++; } }
    const eff = (s: { heading: string; type: string }) => lbl.get(s.heading)?.to ?? s.type;
    const groups: { type: string; items: { heading: string; body: string }[] }[] = [];
    for (const s of model.sections) { const t = eff(s); const it = { heading: s.heading, body: bodyOf(s.heading) }; const last = groups[groups.length - 1]; if (last && last.type === t && !GENERIC.has(t)) last.items.push(it); else groups.push({ type: t, items: [it] }); }
    base.groups = groups.length;
    const multi = groups.filter((g) => g.items.length >= 2);
    base.multiGroups = multi.length;
    for (const g of multi.slice(0, 6)) {
      const scores = await rankProofItems(g.type, g.items.map((i) => ({ heading: i.heading, body: i.body })));
      if (!scores) continue;
      base.ranked++;
      const items = g.items.map((it, i) => ({ heading: it.heading.slice(0, 70), strength: scores[i]?.strength ?? 0, excerpt: it.body.slice(0, 120) })).sort((a, b) => b.strength - a.strength);
      base.rankBlocks.push({ host, type: g.type, items });
    }
    base.ok = true; return base;
  } catch (e) { base.error = (e as Error).message.slice(0, 50); return base; }
}

async function mapPool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); if (i % 20 === 0) console.error(`[scale] ${i}/${items.length}`); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return out;
}

const results = await mapPool(URLS, CONC, doSite);

const ok = results.filter((r) => r.ok);
const promos = ok.flatMap((r) => r.promotions);
const byType: Record<string, number> = {};
for (const p of promos) byType[p.to] = (byType[p.to] || 0) + 1;
const evTotal = promos.filter((p) => EVIDENCE.has(p.to)).length;
const avgConf = promos.length ? promos.reduce((a, p) => a + p.conf, 0) / promos.length : 0;
console.log("\n===AGG===");
console.log(`sites: ${results.length} attempted, ${ok.length} ok, ${results.length - ok.length} failed`);
console.log(`sections: ${ok.reduce((a, r) => a + r.sections, 0)} | generic-after-floor: ${ok.reduce((a, r) => a + r.generic, 0)}`);
console.log(`ceiling promotions: ${promos.length} (evidence ${evTotal}) | avg conf ${avgConf.toFixed(2)}`);
console.log(`by type: ${JSON.stringify(byType)}`);
console.log(`grouping: ${ok.reduce((a, r) => a + r.groups, 0)} groups | ${ok.reduce((a, r) => a + r.multiGroups, 0)} multi-item | ${ok.reduce((a, r) => a + r.ranked, 0)} ranked`);
const fails: Record<string, number> = {};
for (const r of results.filter((x) => !x.ok)) { const k = (r.error || "?").split(" ")[0]; fails[k] = (fails[k] || 0) + 1; }
console.log(`failures: ${JSON.stringify(fails)}`);
console.log(`thin (<3 sec): ${ok.filter((r) => r.sections < 3).length}`);

const renderAttempted = results.filter((r) => r.rendered);
const viaRender = results.filter((r) => r.via === "render");
const recovered = results.filter((r) => r.recovered);
const renderErrored = results.filter((r) => r.rendered && r.renderErr);
console.log("\n===CAPTURE===");
console.log(`render attempted (static shell/fail <${SHELL} sec): ${renderAttempted.length}`);
console.log(`captured via render (render beat static): ${viaRender.length}`);
console.log(`RECOVERED (static <${SHELL} → render >=${SHELL}): ${recovered.length}`);
console.log(`render errored (no usable DOM): ${renderErrored.length}`);
for (const r of recovered) console.log(`REC|${r.host}|${r.staticSections}->${r.sections}sec|${r.evidencePromos}ev`);

const promoSample: Promo[] = [];
const perSite: Record<string, number> = {};
for (const p of promos) { if (!EVIDENCE.has(p.to)) continue; if ((perSite[p.host] || 0) >= 2) continue; perSite[p.host] = (perSite[p.host] || 0) + 1; promoSample.push(p); if (promoSample.length >= 60) break; }
console.log("\n===SAMPLE_PROMOS===");
for (const p of promoSample) console.log(`SP|${p.host}|${p.from}|${p.to}|${p.conf.toFixed(2)}|${p.heading.replace(/\|/g, "/")}|${p.excerpt.replace(/\|/g, "/").replace(/\s+/g, " ")}`);

const rankSample: RankBlock[] = [];
const seenHost = new Set<string>();
for (const r of ok) { for (const b of r.rankBlocks) { if (seenHost.has(b.host) || !EVIDENCE.has(b.type) || b.items.length < 2) continue; seenHost.add(b.host); rankSample.push(b); break; } if (rankSample.length >= 25) break; }
console.log("\n===SAMPLE_RANKS===");
for (const b of rankSample) { console.log(`RB|${b.host}|${b.type}|${b.items.length}`); b.items.forEach((it, i) => console.log(`RR|${b.host}|${i + 1}|${it.strength.toFixed(2)}|${it.heading.replace(/\|/g, "/")}|${it.excerpt.replace(/\|/g, "/").replace(/\s+/g, " ")}`)); }

writeFileSync("scale-test.json", JSON.stringify(results));
console.log("\n[scale] wrote scale-test.json");

// Tvinga exit: Browserbase/Stagehand lämnar keepAlive-handtag som annars håller
// processen vid liv till jobbtimeouten (capture-test #3). Alla per-sajt-cleanups
// är redan await:ade (mapPool har resolvat).
process.exit(0);
