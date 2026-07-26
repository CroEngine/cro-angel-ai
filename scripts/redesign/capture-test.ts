#!/usr/bin/env bun
// Kapacitets-test (ägaren 2026-07-25: "gör det du rekommenderar" → scoped
// Browserbase-render FÖRE de fulla 200). Jämför STATISK hämtning mot Browserbase-
// RENDER på de sajter som föll / blev tunna / hade bild-loggor i skala-testet, och
// mäter om render återhämtar innehåll golvet kan jobba på (sektioner + bevis).
// Rent GOLV (ingen LLM) — isolerar CAPTURE-frågan. Kräver BROWSERBASE_API_KEY +
// BROWSERBASE_PROJECT_ID (annars är render == statisk och testet är meningslöst).

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { renderVisibleCapture } from "./render-page";

const EVIDENCE = new Set(["testimonials", "pricing", "logos", "stats", "comparison", "faq"]);
const CONC = 1; // DIAGNOSTIK: 1 session i taget — isolerar om samtidighet är problemet
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// Diagnostisk delmängd (~8): bekräfta att Browserbase-CDP ansluter alls (förra
// körningen timeoutade på connectOverCDP) innan vi kör de fulla ~25.
const SITES = [
  "gymshark.com", "figma.com", "notion.so", "nike.com", "airbnb.com", // SPA/thin/image
  "whoop.com", "docker.com", "stripe.com", // controls
];

interface Cap { ok: boolean; err?: string; secs: number; ev: number }

async function staticCap(url: string): Promise<Cap> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (!res.ok) return { ok: false, err: `HTTP ${res.status}`, secs: 0, ev: 0 };
    const m = extractContentModel(await res.text());
    return { ok: true, secs: m.sections.length, ev: m.sections.filter((s) => EVIDENCE.has(s.type)).length };
  } catch (e) {
    return { ok: false, err: (e as Error).message.slice(0, 40), secs: 0, ev: 0 };
  }
}

// Render via den delade vägen (render-page.ts) — samma bevisade Stagehand-anslutning
// + modal-avfärdning som freeze-page/scale-test. Ostylad render räknas som miss.
async function renderedCap(url: string): Promise<Cap> {
  const cap = await renderVisibleCapture(url);
  if (!cap) return { ok: false, err: "render failed", secs: 0, ev: 0 };
  if (!cap.styled) return { ok: false, err: "unstyled render", secs: 0, ev: 0 };
  const m = extractContentModel(cap.html);
  return { ok: true, secs: m.sections.length, ev: m.sections.filter((s) => EVIDENCE.has(s.type)).length };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function w() {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => w()));
  return out;
}

if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
  console.log("::warning::BROWSERBASE_API_KEY/PROJECT_ID saknas — render == statisk, testet är meningslöst.");
}

const rows = await pool(SITES, CONC, async (site) => {
  const url = site.startsWith("http") ? site : `https://${site}`;
  const s = await staticCap(url);
  const r = await renderedCap(url);
  console.log(
    `CAP|${site}|static ${s.ok ? s.secs + "sec/" + s.ev + "ev" : "✗ " + s.err}|rendered ${r.ok ? r.secs + "sec/" + r.ev + "ev" : "✗ " + r.err}`,
  );
  return { site, s, r };
});

const thinStatic = rows.filter((x) => !x.s.ok || x.s.secs < 3);
const recovered = thinStatic.filter((x) => x.r.ok && x.r.secs >= 3);
const improved = rows.filter((x) => x.r.ok && x.r.secs > x.s.secs + 1);
const regressed = rows.filter((x) => x.s.ok && x.s.secs >= 3 && (!x.r.ok || x.r.secs < x.s.secs - 1));
console.log("\n===CAP-AGG===");
console.log(`sites ${rows.length} | thin/failed static ${thinStatic.length} | rendered ok ${rows.filter((x) => x.r.ok).length}`);
console.log(`RECOVERED (thin/failed static → >=3 sec rendered): ${recovered.length} [${recovered.map((x) => x.site).join(", ")}]`);
console.log(`materially improved (rendered > static+1): ${improved.length} [${improved.map((x) => x.site).join(", ")}]`);
console.log(`regressed (control lost sections): ${regressed.length} [${regressed.map((x) => x.site).join(", ")}]`);
console.log(
  `avg sections: static ${(rows.reduce((a, x) => a + (x.s.ok ? x.s.secs : 0), 0) / rows.length).toFixed(1)} → rendered ${(rows.reduce((a, x) => a + (x.r.ok ? x.r.secs : 0), 0) / rows.length).toFixed(1)}`,
);
console.log(
  `avg evidence: static ${(rows.reduce((a, x) => a + x.s.ev, 0) / rows.length).toFixed(1)} → rendered ${(rows.reduce((a, x) => a + x.r.ev, 0) / rows.length).toFixed(1)}`,
);

// Tvinga exit: Stagehand/Browserbase lämnar bakgrunds-timers/sockets (keepAlive)
// som annars håller bun-processen vid liv till 15-min-jobbtimeouten — capture-
// test #3 hängde 14 min EFTER AGG-utskriften och brände credits. Alla per-sajt-
// cleanups är redan await:ade (pool() har resolvat), så detta är säkert.
process.exit(0);
