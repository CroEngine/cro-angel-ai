#!/usr/bin/env bun
// Sektionsatlasen (ägarfråga 2026-07-28): "kan vi identifiera en section,
// namnge den, ha en visuell bild, och koppla exakt den kod den tillhör, så
// vi enkelt kan flytta runt den?" — mätt på NYA sajter utanför 254-flottan.
//
// Per sajt, hela kedjan utan LLM (det som testas är det DETERMINISTISKA
// fundamentet — kan KOD binda och flytta sektioner?):
//
//   freeze (curl/browser-auto) → extractContentModel (identifiera + namnge)
//   → bindningsmätning i Chromium (lokator-unikhet + sektionsavgränsning,
//     diagnostisk spegling av servningens findByLocator/sectionOf — det
//     AUKTORITATIVA domslutet är grind-i-proben nedan)
//   → sektions-crops (den visuella bilden) + kodkoppling (öppningstagg,
//     DOM-path, bytestorlek)
//   → grind-i-proben (probe-candidates.ts, verifys egen grindmaskin) på
//     katalogens flytt-kandidater
//   → bästa grind-rena flytten appliceras (measurePlan keepApplied) →
//     FÖRE/EFTER-skärmdumpar
//
// Ut: <out>/atlas.json + <out>/atlas.html (självbärande rapport, data-URI-
// bilder) + per-sajt-artefakter. Ärlighet: sajter som inte går att frysa
// eller är SPA-skal utan browser-nycklar rapporteras som exakt det.
//
//   bun run scripts/section-atlas/atlas.ts [--only=namn1,namn2] [--out=dir]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium, type Page } from "playwright-core";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { generateCandidates } from "../../src/adaptive/redesign/candidates";
import { captureLcpElement, measurePlan } from "../redesign/measure";
import type { RedesignContentModel } from "../../src/adaptive/redesign/context";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const ONLY = arg("only")?.split(",").filter(Boolean);
const OUT = arg("out") ?? "section-atlas-out";
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

// 10 sajter utanför 254-flottan (verifierat mot FLEET_SITES 2026-07-28) —
// blandade stackar (Framer/Next/WP/custom) och vertikaler (energi, försäkring,
// fintech, b2b-tech, mobilitet, hälsa, konsumentvarumärke, bil, djur, e-com).
export const ATLAS_SITES: Array<{ name: string; url: string }> = [
  { name: "tibber", url: "https://tibber.com/se" },
  { name: "hedvig", url: "https://www.hedvig.com/se" },
  { name: "anyfin", url: "https://anyfin.se/" },
  { name: "einride", url: "https://www.einride.tech/" },
  { name: "voi", url: "https://www.voi.com/sv" },
  { name: "kry", url: "https://www.kry.se/" },
  { name: "oatly", url: "https://www.oatly.com/sv-se" },
  { name: "polestar", url: "https://www.polestar.com/se/" },
  { name: "lassie", url: "https://www.lassie.co/" },
  { name: "matsmart", url: "https://www.matsmart.se/" },
];

interface SectionRow {
  id: string;
  type: string;
  heading: string;
  aboveFold: boolean;
  containsTrustSignals: boolean;
  /** Lokator-unikhet mot spegelreglerna: exakta rubrikträffar i main. */
  exactMatches: number;
  /** UNIK | FLERTYDIG | OUPPLÖST — bindningsdomen. */
  binding: "UNIK" | "FLERTYDIG" | "OUPPLÖST";
  /** Kodkopplingen: sektions-elementets öppningstagg (trunkerad). */
  openingTag: string | null;
  /** DOM-vägen main → sektion (tagg:nth), spårbar i devtools. */
  domPath: string | null;
  htmlBytes: number;
  /** Visuella bilden, data-URI-JPEG (beskuren till max 600px höjd). */
  cropDataUri: string | null;
}

interface MoveRow {
  candidateId: string;
  targetHeading: string;
  gateClean: boolean;
  applicable: boolean;
  /** true = flytten är också KATALOGENS förslag (bevis-viktad) — inte bara
   *  tekniskt möjlig. Skiljer "flyttbar" från "värd att föreslå". */
  inCatalogue: boolean;
  reason: string | null;
  gate: { lcpShiftPx: number | null; overlapPx: number | null; ctaChecked: number | null; ctaBroken: number | null } | null;
}

interface SiteAtlas {
  name: string;
  url: string;
  status: "ok" | "freeze_failed" | "thin_page";
  note: string | null;
  frozenBytes: number;
  sections: SectionRow[];
  moves: MoveRow[];
  /** Bästa grind-rena flytten applicerad: FÖRE/EFTER (data-URI, topp 3000px). */
  beforeUri: string | null;
  afterUri: string | null;
  movedHeading: string | null;
  ms: number;
}

const b64 = (b: Buffer) => `data:image/jpeg;base64,${b.toString("base64")}`;

function freeze(url: string, out: string): boolean {
  const r = spawnSync(
    "bun",
    ["run", "scripts/redesign/freeze-page.ts", `--url=${url}`, `--out=${out}`],
    { stdio: ["ignore", "inherit", "inherit"], timeout: 150_000 },
  );
  return r.status === 0 && existsSync(out);
}

/** Bindningsmätningen + kodkopplingen, i sidans DOM. Diagnostisk SPEGLING av
 *  servningens regler (measure.ts findByLocator pass 1 + census/sectionOf) —
 *  atlasen MÄTER bindbarhet och pekar ut koden; grind-i-proben nedan är det
 *  auktoritativa domslutet om flyttbarhet. Avviker spegeln från proben på
 *  någon sajt är det i sig ett fynd rapporten ska visa. */
async function bindSections(page: Page, sections: RedesignContentModel["sections"]) {
  return page.evaluate((secs) => {
    const mainEl = document.querySelector("main") || document.body;
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const census = Array.from(mainEl.querySelectorAll("h2")).filter(
      (h) => !h.closest("header,nav,footer,aside"),
    );
    const censusCount = new Map<Element, number>();
    for (const h of census) {
      let walk: Element | null = h;
      while (walk && walk !== document.documentElement) {
        censusCount.set(walk, (censusCount.get(walk) ?? 0) + 1);
        walk = walk.parentElement;
      }
    }
    const sectionOf = (headEl: Element): Element | null => {
      let n: Element | null = headEl.parentElement;
      while (n && n !== document.body && n !== mainEl.parentElement) {
        if ((censusCount.get(n) ?? 0) === 1) {
          const p: Element | null = n.parentElement;
          if (p) {
            for (const sib of Array.from(p.children)) {
              if (sib !== n && censusCount.has(sib)) return n;
            }
          }
        }
        n = n.parentElement;
      }
      return null;
    };
    const pathOf = (el: Element): string => {
      const parts: string[] = [];
      let n: Element | null = el;
      while (n && n !== document.body && parts.length < 8) {
        const p: Element | null = n.parentElement;
        const idx = p ? Array.from(p.children).filter((c) => c.tagName === n!.tagName).indexOf(n) + 1 : 1;
        parts.unshift(`${n.tagName.toLowerCase()}${idx > 1 ? `:nth-of-type(${idx})` : ""}`);
        n = p;
      }
      return parts.join(" > ");
    };
    return secs.map((s) => {
      const tag = s.type === "hero" ? "h1" : "h2";
      const full = norm(s.heading).toLowerCase();
      const els = Array.from(mainEl.querySelectorAll(tag));
      const exact = els.filter((el) => norm(el.textContent || "").toLowerCase() === full);
      const head = exact[0] ?? null;
      const sec = head ? (s.type === "hero" ? head.parentElement : sectionOf(head)) : null;
      const r = sec ? sec.getBoundingClientRect() : null;
      const open = sec ? (sec.outerHTML.match(/^<[^>]{0,180}>/)?.[0] ?? null) : null;
      return {
        id: s.id,
        exactMatches: exact.length,
        openingTag: open,
        domPath: sec ? pathOf(sec) : null,
        htmlBytes: sec ? sec.outerHTML.length : 0,
        bbox: r && r.width > 0 && r.height > 0
          ? { x: 0, y: Math.max(0, r.top + window.scrollY), w: Math.round(window.innerWidth), h: Math.min(600, Math.round(r.height)) }
          : null,
      };
    });
  }, sections);
}

async function newFrozenPage(browser: Awaited<ReturnType<typeof chromium.launch>>, html: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route("**/*", (r) => r.abort());
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForTimeout(400);
  await captureLcpElement(page);
  return { ctx, page };
}

async function runSite(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  site: { name: string; url: string },
): Promise<SiteAtlas> {
  const t0 = Date.now();
  const dir = join(OUT, site.name);
  mkdirSync(dir, { recursive: true });
  const frozenPath = join(dir, "frozen.html");
  const base: SiteAtlas = {
    name: site.name, url: site.url, status: "ok", note: null, frozenBytes: 0,
    sections: [], moves: [], beforeUri: null, afterUri: null, movedHeading: null, ms: 0,
  };
  try {
    if (!existsSync(frozenPath) && !freeze(site.url, frozenPath)) {
      return { ...base, status: "freeze_failed", note: "frysningen föll (WAF/bot-block/nätfel)", ms: Date.now() - t0 };
    }
    const html = readFileSync(frozenPath, "utf8");
    base.frozenBytes = html.length;
    const content = extractContentModel(html);
    if (content.sections.length < 2) {
      return { ...base, status: "thin_page", note: "SPA-skal/tunn sida (<2 sektioner) — behöver browser-rendering (Browserbase-nycklar saknas lokalt)", ms: Date.now() - t0 };
    }

    // 1) Bindning + visuell bild + kodkoppling.
    const { ctx, page } = await newFrozenPage(browser, html);
    const bound = await bindSections(page, content.sections);
    for (let i = 0; i < content.sections.length; i++) {
      const s = content.sections[i];
      const b = bound[i];
      let crop: string | null = null;
      if (b.bbox) {
        try {
          const buf = await page.screenshot({
            type: "jpeg", quality: 55,
            clip: { x: b.bbox.x, y: b.bbox.y, width: b.bbox.w, height: b.bbox.h },
          });
          crop = b64(Buffer.from(buf));
        } catch { /* crop utanför renderbar yta — raden bär ändå bindningen */ }
      }
      base.sections.push({
        id: s.id, type: s.type, heading: s.heading, aboveFold: s.aboveFold,
        containsTrustSignals: !!s.containsTrustSignals,
        exactMatches: b.exactMatches,
        binding: b.exactMatches === 1 ? "UNIK" : b.exactMatches > 1 ? "FLERTYDIG" : "OUPPLÖST",
        openingTag: b.openingTag, domPath: b.domPath, htmlBytes: b.htmlBytes,
        cropDataUri: crop,
      });
    }
    const beforeBuf = await page.screenshot({
      type: "jpeg", quality: 45,
      clip: { x: 0, y: 0, width: 390, height: Math.min(3000, await page.evaluate(() => document.documentElement.scrollHeight)) },
    });
    base.beforeUri = b64(Buffer.from(beforeBuf));
    await ctx.close();

    // 2) Grind-i-proben (verifys egen maskin) på VARJE flyttbar sektion —
    //    ägarens fråga är "kan vi flytta runt DEN här sektionen snyggt?",
    //    per sektion, inte bara katalogens bevis-viktade urval. Katalogen
    //    väljer VILKEN flytt som föreslås; atlasen mäter om VARJE är möjlig.
    //    (Hjälten är aldrig flyttmål; ovanför folden finns inget att vinna
    //    men de probas ändå — grindmaskinen fäller meningslösa flyttar själv.)
    const movable = content.sections.filter((s) => s.type !== "hero" && s.heading);
    const catalogueIds = new Set(
      generateCandidates(content).filter((c) => c.kind === "move_up").map((c) => c.targetId),
    );
    const moveCands = movable.map((s) => ({ id: `mv-${s.id}`, kind: "move_up" as const, targetId: s.id }));
    if (moveCands.length > 0) {
      const ctaTexts = [
        ...new Set(content.ctas.filter((c) => c.intent === "conversion").map((c) => c.text)),
      ];
      // Samma probe-in-mappning som candidate-plan.ts (håll i synk): flytt-
      // lokatorn är sektionens rubrik (h2; hjälten är aldrig flyttmål).
      const probeIn = moveCands.map((c) => {
        const sec = content.sections.find((x) => x.id === c.targetId);
        return { id: c.id, kind: c.kind, tag: "h2", find: sec?.heading ?? "" };
      });
      writeFileSync(join(dir, "probe-in.json"), JSON.stringify([{ id: "__meta__", ctaTexts }, ...probeIn]));
      const pr = spawnSync(
        "bun",
        ["run", "scripts/redesign/probe-candidates.ts", `--frozen=${frozenPath}`,
         `--in=${join(dir, "probe-in.json")}`, `--out=${join(dir, "probe-out.json")}`],
        { stdio: ["ignore", "inherit", "inherit"], timeout: 120_000,
          env: { ...process.env } },
      );
      if (pr.status === 0 && existsSync(join(dir, "probe-out.json"))) {
        const probed = JSON.parse(readFileSync(join(dir, "probe-out.json"), "utf8")) as Array<{
          id: string; applicable: boolean; gateClean: boolean; reason?: string;
          gate?: { lcpShiftPx: number | null; overlapPx: number | null; ctaChecked: number | null; ctaBroken: number | null };
        }>;
        for (const c of moveCands) {
          const p = probed.find((x) => x.id === c.id);
          const sec = content.sections.find((x) => x.id === c.targetId);
          base.moves.push({
            candidateId: c.id, targetHeading: sec?.heading ?? c.targetId,
            gateClean: !!p?.gateClean, applicable: !!p?.applicable,
            inCatalogue: catalogueIds.has(c.targetId),
            reason: p?.reason ?? null, gate: p?.gate ?? null,
          });
        }
      } else {
        base.note = "proben föll — flyttdomsluten saknas för sajten";
      }
    }

    // 3) Bästa grind-rena flytten (katalogens bevis-viktade först): applicera
    //    + EFTER-bild.
    const best =
      base.moves.find((m) => m.gateClean && m.inCatalogue) ??
      base.moves.find((m) => m.gateClean);
    if (best) {
      const cand = moveCands.find((c) => c.id === best.candidateId)!;
      const sec = content.sections.find((x) => x.id === cand.targetId)!;
      const { ctx: c2, page: p2 } = await newFrozenPage(browser, html);
      await measurePlan(p2, [{ op: "move_up", tag: "h2", find: sec.heading }], [], true);
      const afterBuf = await p2.screenshot({
        type: "jpeg", quality: 45,
        clip: { x: 0, y: 0, width: 390, height: Math.min(3000, await p2.evaluate(() => document.documentElement.scrollHeight)) },
      });
      base.afterUri = b64(Buffer.from(afterBuf));
      base.movedHeading = sec.heading;
      await c2.close();
    }
    base.ms = Date.now() - t0;
    return base;
  } catch (e) {
    base.status = base.status === "ok" ? "thin_page" : base.status;
    base.note = `krasch: ${String(e).slice(0, 200)}`;
    base.ms = Date.now() - t0;
    return base;
  }
}

// ── körning ──────────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
let sites = ATLAS_SITES;
if (ONLY) sites = sites.filter((s) => ONLY.includes(s.name));
const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
try {
  for (const site of sites) {
    // Resumbar (chunk-körningar i bakgrund): färdig sajt = site.json på disk.
    if (existsSync(join(OUT, site.name, "site.json"))) {
      console.log(`[atlas] ${site.name}: redan klar — hoppar`);
      continue;
    }
    console.log(`\n[atlas] ── ${site.name} (${site.url}) ──`);
    const r = await runSite(browser, site);
    const uniq = r.sections.filter((s) => s.binding === "UNIK").length;
    const clean = r.moves.filter((m) => m.gateClean).length;
    console.log(
      `[atlas] ${r.name}: ${r.status} · ${r.sections.length} sektioner (${uniq} unika bindningar) · ${clean}/${r.moves.length} grind-rena flyttar${r.note ? ` · ${r.note}` : ""}`,
    );
    // Full artefakt (inkl. bild-URI:er) per sajt — rapporten byggs ur ALLA
    // färdiga site.json så chunkade körningar komponerar.
    writeFileSync(join(OUT, site.name, "site.json"), JSON.stringify(r));
  }
} finally {
  await browser.close();
}

// Rapportunderlaget: alla färdiga sajter i ATLAS_SITES-ordning.
const results: SiteAtlas[] = ATLAS_SITES
  .filter((s) => existsSync(join(OUT, s.name, "site.json")))
  .map((s) => JSON.parse(readFileSync(join(OUT, s.name, "site.json"), "utf8")) as SiteAtlas);
writeFileSync(join(OUT, "atlas.json"), JSON.stringify(results.map(({ beforeUri, afterUri, ...rest }) => ({
  ...rest,
  sections: rest.sections.map(({ cropDataUri, ...sr }) => sr),
})), null, 1));

// ── rapporten (självbärande HTML, svenska) ───────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const bindBadge = (b: SectionRow["binding"], n: number) =>
  b === "UNIK"
    ? `<span class="b ok">UNIK</span>`
    : b === "FLERTYDIG"
      ? `<span class="b warn">FLERTYDIG ×${n}</span>`
      : `<span class="b bad">OUPPLÖST</span>`;

const siteHtml = results.map((r) => {
  const uniq = r.sections.filter((s) => s.binding === "UNIK").length;
  const clean = r.moves.filter((m) => m.gateClean).length;
  const head = `<h2>${esc(r.name)} <small>${esc(r.url)}</small></h2>
  <p class="meta">${r.status === "ok"
    ? `${r.sections.length} sektioner · ${uniq}/${r.sections.length} unika bindningar · ${clean}/${r.moves.length} grind-rena flyttar · fryst ${Math.round(r.frozenBytes / 1000)} kB`
    : `<strong>${esc(r.status)}</strong> — ${esc(r.note ?? "")}`}${r.note && r.status === "ok" ? ` · ${esc(r.note)}` : ""}</p>`;
  if (r.status !== "ok") return `<section>${head}</section>`;
  const rows = r.sections.map((s) => `
    <tr>
      <td>${s.cropDataUri ? `<img src="${s.cropDataUri}" alt="">` : "<em>ingen bild</em>"}</td>
      <td>
        <div class="nm">${esc(s.id)} <span class="tp">${esc(s.type)}</span>${s.containsTrustSignals ? ' <span class="tp proof">bevis</span>' : ""}</div>
        <div class="hd">"${esc(s.heading.slice(0, 70))}"</div>
        ${bindBadge(s.binding, s.exactMatches)}
      </td>
      <td class="code">
        ${s.openingTag ? `<code>${esc(s.openingTag.slice(0, 110))}…</code>` : "<em>—</em>"}
        <div class="path">${esc(s.domPath ?? "")}</div>
        <div class="path">${s.htmlBytes ? `${Math.round(s.htmlBytes / 1000)} kB DOM` : ""}</div>
      </td>
    </tr>`).join("");
  const moves = r.moves.map((m) => `
    <li>${m.gateClean ? "✅" : m.applicable ? "🟡" : "⛔"} <strong>${esc(m.targetHeading.slice(0, 55))}</strong>${m.inCatalogue ? ' <span class="tp proof">katalogens förslag</span>' : ""}
      ${m.gateClean && m.gate ? ` — LCP ${m.gate.lcpShiftPx ?? "?"}px · överlapp ${m.gate.overlapPx ?? "?"}px · CTA ${m.gate.ctaBroken ?? "?"}/${m.gate.ctaChecked ?? "?"} trasiga` : ""}
      ${!m.gateClean && m.reason ? ` — ${esc(m.reason)}` : ""}</li>`).join("");
  const ba = r.beforeUri && r.afterUri
    ? `<div class="ba"><figure><figcaption>FÖRE</figcaption><img src="${r.beforeUri}"></figure>
       <figure><figcaption>EFTER — "${esc((r.movedHeading ?? "").slice(0, 45))}" flyttad</figcaption><img src="${r.afterUri}"></figure></div>`
    : `<p class="meta">Ingen grind-ren flytt att visa${r.moves.length ? " (alla kandidater föll i grinden/bindningen)" : " (inga flytt-kandidater under folden)"}.</p>`;
  return `<section>${head}
    <table><thead><tr><th>Visuell bild</th><th>Identitet + bindning</th><th>Kodkoppling</th></tr></thead><tbody>${rows}</tbody></table>
    <h3>Flyttbarhet per sektion (grind-i-proben — verifys egen maskin)</h3><ul>${moves || "<li><em>inga flyttbara sektioner (bara hjälte/rubriklösa)</em></li>"}</ul>
    ${ba}
  </section>`;
}).join("\n");

const totalSec = results.reduce((a, r) => a + r.sections.length, 0);
const totalUniq = results.reduce((a, r) => a + r.sections.filter((s) => s.binding === "UNIK").length, 0);
const totalMoves = results.reduce((a, r) => a + r.moves.length, 0);
const totalClean = results.reduce((a, r) => a + r.moves.filter((m) => m.gateClean).length, 0);
const okSites = results.filter((r) => r.status === "ok").length;

writeFileSync(join(OUT, "atlas.html"), `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<title>Sektionsatlas — ${results.length} nya sajter</title>
<style>
  body{font:14px/1.45 -apple-system,system-ui,sans-serif;color:#1c1917;background:#faf9f7;margin:0;padding:24px;max-width:960px;margin-inline:auto}
  h1{font-size:22px} h2{font-size:18px;margin:28px 0 4px} h2 small{color:#78716c;font-weight:400;font-size:12px}
  h3{font-size:14px;margin:14px 0 4px} section{border-top:2px solid #e7e5e4;padding-top:10px;margin-top:18px}
  .meta{color:#57534e;font-size:13px;margin:2px 0 10px}
  table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid #e7e5e4;padding:6px;vertical-align:top;text-align:left;font-size:12.5px}
  td img{width:150px;border:1px solid #d6d3d1;border-radius:6px;display:block}
  .nm{font-weight:600} .tp{background:#f5f5f4;border-radius:4px;padding:0 5px;font-size:11px;color:#57534e}
  .proof{background:#dcfce7;color:#166534} .hd{color:#57534e;margin:2px 0}
  .b{font-size:11px;font-weight:700;border-radius:4px;padding:1px 6px}
  .ok{background:#dcfce7;color:#166534}.warn{background:#fef9c3;color:#854d0e}.bad{background:#fee2e2;color:#991b1b}
  .code code{font:11px ui-monospace,monospace;background:#f5f5f4;display:block;padding:4px;border-radius:4px;word-break:break-all}
  .path{font:10.5px ui-monospace,monospace;color:#78716c;margin-top:2px;word-break:break-all}
  ul{margin:4px 0;padding-left:18px} li{margin:3px 0;font-size:13px}
  .ba{display:flex;gap:10px;margin-top:10px} .ba figure{margin:0;flex:1} .ba img{width:100%;border:1px solid #d6d3d1;border-radius:8px}
  .ba figcaption{font-size:11px;font-weight:700;color:#57534e;margin-bottom:3px;text-transform:uppercase;letter-spacing:.06em}
</style></head><body>
<h1>Sektionsatlas — ${results.length} nya sajter (utanför 254-flottan)</h1>
<p class="meta">Frågan som mäts: kan kedjan <strong>identifiera</strong> en sektion, <strong>namnge</strong> den, visa en <strong>visuell bild</strong>, koppla <strong>exakt kod</strong> (lokator → DOM-element, samma spegelregler som servningen) och <strong>flytta</strong> den genom grindarna? Deterministiskt — ingen LLM i denna mätning.</p>
<p class="meta"><strong>Totalt:</strong> ${okSites}/${results.length} sajter analyserade · ${totalSec} sektioner · ${totalUniq} unika bindningar (${totalSec ? Math.round((100 * totalUniq) / totalSec) : 0} %) · ${totalClean}/${totalMoves} flytt-kandidater grind-rena. Genererad ${new Date().toISOString().slice(0, 16)}Z.</p>
${siteHtml}
</body></html>`);
console.log(`\n[atlas] rapport: ${join(OUT, "atlas.html")} · data: ${join(OUT, "atlas.json")}`);
