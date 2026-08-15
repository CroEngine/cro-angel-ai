#!/usr/bin/env bun
// Rotator-avvägningen mätt mot korpusen (ägarbeslut 2026-08-15 "Kör").
//
// FRÅGAN: cleanHeadingText kollapsar animerade ordrotatorer innan den läser
// rubriken. Två av dess signaler är för breda (granskningsfynd 2026-08-15):
//   A. klasstokens animated-text / animated-headline / animated-word matchar
//      SPLIT-TEXT-omslag (per-ord-avslöjande), där alla barn tillhör SAMMA
//      rubrik — att dölja alla utom det första trunkerar rubriken.
//   B. varje ul/ol med >=2 barn i en rubrik behandlas som rotator utan någon
//      rotator-specifik signal. Hubspot-fallet som motiverade regeln bär
//      redan klasstoken `animated-list`.
//
// METODEN: tre varianter av SAMMA funktion körs mot SAMMA DOM-ögonblick per
// sida — inte tre sidladdningar. Kör man om sidan mellan varianterna mäter man
// layout-drift, inte logiken (samma fälla som dedup-A/B:t 2026-08-14 fick
// hantera). Varje h1/h2 i <main> läses tre gånger:
//   none     — ingen rotator-kollaps alls (vad läsaren ser före all logik)
//   current  — dagens regler
//   narrowed — utan de tre split-text-tokenen, och ul/ol kräver rotator-signal
//
// Utfallet är RÅDATA + en klassificering som bara delar upp fallen; vilken
// variant som är RÄTT avgörs av att läsa dem, inte av skriptet.
//
//   bun run scripts/redesign/rotator-eval.ts [--limit=N] [--out=fil.json]

import { readdirSync, existsSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { chromium } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const LIMIT = Number(arg("limit") ?? 0);
const OUT = arg("out") ?? "rotator-eval.json";
const ROOT = join(import.meta.dirname, "..", "..");

/** Klasstokens som är OTVETYDIGA rotatorer — kvar i den smala varianten. */
const NARROW_TOKENS = [
  "rotating",
  "rotator",
  "typewriter",
  "animated-list",
  "text-rotat",
  "word-rotat",
  "txt-rotat",
  "text-cycl",
  "word-cycl",
  "rotate-word",
  "rotate-text",
  "cd-words",
];
/** De tre som också matchar split-text-omslag. */
const WIDE_ONLY_TOKENS = ["animated-word", "animated-text", "animated-headline"];

interface HeadingRow {
  site: string;
  tag: string;
  none: string;
  current: string;
  narrowed: string;
  /** Vad som utlöste kollapsen i den BREDA varianten. */
  trigger: { kind: "list" | "class"; cls: string; kids: number }[];
}

// Två källor: de frysta förstasidorna OCH de incheckade MHTML-captures som
// snapshot-guldunderlagen byggs av. Hubspot ligger bara i den senare — och det
// är EXAKT den sajt rotator-regeln skrevs för, så en mätning utan den kan inte
// säga något om regressionsrisken.
const sources: { site: string; url: string }[] = [
  ...readdirSync(join(ROOT, "capture-corpus"))
    .filter((d) => existsSync(join(ROOT, "capture-corpus", d, "frozen.html")))
    .sort()
    .map((d) => ({ site: d, url: `file://${join(ROOT, "capture-corpus", d, "frozen.html")}` })),
  ...readdirSync(join(ROOT, "corpus"))
    .filter((d) => existsSync(join(ROOT, "corpus", d, "page.mhtml")))
    .sort()
    .map((d) => ({ site: `corpus:${d}`, url: `file://${join(ROOT, "corpus", d, "page.mhtml")}` })),
];
const targets = LIMIT > 0 ? sources.slice(0, LIMIT) : sources;
console.log(
  `[rotator-eval] ${targets.length} sidor (${targets.filter((t) => t.site.startsWith("corpus:")).length} MHTML)`,
);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
// SJÄLVTEST: en syntetisk sida med bägge defekterna + en äkta rotator. Utan
// den är "0 skillnader" på korpusen tvetydigt — det kan lika gärna betyda att
// mätningen inte kan se någonting alls. Faller självtestet avbryts körningen.
{
  const p = await browser.newPage();
  await p.setContent(`<main>
    <h1 id="split">Grow with <span class="animated-text"><span>speed</span> <span>and</span> <span>care</span></span></h1>
    <h2 id="list">Pick one <ul><li>A plan</li><li>B plan</li></ul></h2>
    <h2 id="rot">We help you <ul class="hero-animated-list"><li>grow</li><li>scale</li></ul></h2>
  </main>`);
  const probe = await p.evaluate(
    ({ narrowTokens, wideTokens }) => {
      const g = (id: string) => document.getElementById(id)!;
      const read = (el: Element, tokens: string[], listRule: boolean) => {
        const hidden: [HTMLElement, string][] = [];
        try {
          const rot: Element[] = [];
          if (listRule)
            el.querySelectorAll("ul, ol").forEach((l) => {
              if (l.children.length >= 2) rot.push(l);
            });
          el.querySelectorAll("[class]").forEach((t) => {
            if (t.children.length < 2 || rot.indexOf(t) !== -1) return;
            const c = (t.getAttribute("class") || "").toLowerCase();
            if (tokens.some((k) => c.indexOf(k) !== -1)) rot.push(t);
          });
          for (const r of rot)
            for (let k = 1; k < r.children.length; k++) {
              const kid = r.children[k] as HTMLElement;
              hidden.push([kid, kid.style.display]);
              kid.style.display = "none";
            }
          return (((el as HTMLElement).innerText || "") + "").trim().replace(/\s+/g, " ");
        } finally {
          for (const [n2, d] of hidden) n2.style.display = d;
        }
      };
      const all = [...narrowTokens, ...wideTokens];
      return {
        splitCur: read(g("split"), all, true),
        splitNar: read(g("split"), narrowTokens, false),
        listCur: read(g("list"), all, true),
        listNar: read(g("list"), narrowTokens, false),
        rotCur: read(g("rot"), all, true),
        rotNar: read(g("rot"), narrowTokens, false),
      };
    },
    { narrowTokens: NARROW_TOKENS, wideTokens: WIDE_ONLY_TOKENS },
  );
  await p.close();
  console.log("[rotator-eval] SJÄLVTEST");
  for (const [k, v] of Object.entries(probe)) console.log(`   ${k.padEnd(9)} ${JSON.stringify(v)}`);
  const ok =
    probe.splitCur !== probe.splitNar &&
    probe.listCur !== probe.listNar &&
    probe.rotCur === probe.rotNar;
  if (!ok) {
    console.error(
      "[rotator-eval] SJÄLVTESTET FÖLL — mätningen ser inte defekterna, eller den smala varianten tappade en ÄKTA rotator. Avbryter.",
    );
    await browser.close();
    process.exit(1);
  }
  console.log("[rotator-eval] självtest OK: bägge defekterna syns, äkta rotator oförändrad\n");
}

const rows: HeadingRow[] = [];
let failed = 0;

for (const { site, url } of targets) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    // MHTML-uppspelningar behöver ett ögonblick innan layouten är stabil —
    // rubrikerna finns i DOM:en direkt, men innerText är synlighetsberoende.
    if (site.startsWith("corpus:")) await page.waitForTimeout(1500);
    const out = await page.evaluate(
      ({ narrowTokens, wideTokens }) => {
        // EN implementation, parametriserad — så varianterna omöjligt kan
        // drifta isär i själva mätningen.
        function collapse(el: Element, tokens: string[], listRule: boolean): string {
          const hidden: [HTMLElement, string][] = [];
          const trig: { kind: "list" | "class"; cls: string; kids: number }[] = [];
          try {
            const rotators: Element[] = [];
            if (listRule) {
              const lists = el.querySelectorAll("ul, ol");
              for (let a = 0; a < lists.length; a++) {
                if (lists[a].children.length >= 2) {
                  rotators.push(lists[a]);
                  trig.push({
                    kind: "list",
                    cls: lists[a].getAttribute("class") || "",
                    kids: lists[a].children.length,
                  });
                }
              }
            }
            const tagged = el.querySelectorAll("[class]");
            for (let b = 0; b < tagged.length; b++) {
              if (tagged[b].children.length < 2 || rotators.indexOf(tagged[b]) !== -1) continue;
              const cls = (tagged[b].getAttribute("class") || "").toLowerCase();
              for (const t of tokens) {
                if (cls.indexOf(t) !== -1) {
                  rotators.push(tagged[b]);
                  trig.push({ kind: "class", cls, kids: tagged[b].children.length });
                  break;
                }
              }
            }
            for (const r of rotators) {
              const kids = r.children;
              for (let k = 1; k < kids.length; k++) {
                const kid = kids[k] as HTMLElement;
                hidden.push([kid, kid.style.display]);
                kid.style.display = "none";
              }
            }
            const t = (((el as HTMLElement).innerText || el.textContent || "") + "")
              .trim()
              .replace(/\s+/g, " ");
            let w = t.split(" ");
            for (let p = 3; p <= w.length / 2; p++) {
              if (w.length % p !== 0) continue;
              let ok = true;
              for (let i = p; i < w.length; i++)
                if (w[i] !== w[i % p]) {
                  ok = false;
                  break;
                }
              if (ok) {
                w = w.slice(0, p);
                break;
              }
            }
            (collapse as unknown as { last: typeof trig }).last = trig;
            return w.join(" ");
          } finally {
            for (const [node, disp] of hidden) node.style.display = disp;
          }
        }

        const main = document.querySelector("main") || document.body;
        const heads = Array.from(main.querySelectorAll("h1, h2")).slice(0, 40);
        return heads.map((h) => {
          // Ordningen spelar roll: läs ALLTID varianterna mot orört DOM
          // (finally-blocket återställer, men vi vill inte lita på det blint).
          const none = collapse(h, [], false);
          const current = collapse(h, [...narrowTokens, ...wideTokens], true);
          const trigger = (collapse as unknown as { last: unknown }).last as HeadingRow["trigger"];
          const narrowed = collapse(h, narrowTokens, false);
          return { tag: h.tagName.toLowerCase(), none, current, narrowed, trigger };
        });
      },
      { narrowTokens: NARROW_TOKENS, wideTokens: WIDE_ONLY_TOKENS },
    );
    for (const r of out) rows.push({ site, ...r });
  } catch (e) {
    failed++;
    console.warn(`[rotator-eval] ${site} föll: ${String(e).slice(0, 90)}`);
  } finally {
    await page.close();
  }
}
await browser.close();

const differing = rows.filter((r) => r.current !== r.narrowed);
const collapsedAtAll = rows.filter((r) => r.none !== r.current);

console.log(`\n[rotator-eval] ${rows.length} rubriker, ${failed} sidor föll`);
console.log(`[rotator-eval] rotator-logiken RÖR ${collapsedAtAll.length} rubriker (bred variant)`);
console.log(`[rotator-eval] current vs narrowed SKILJER på ${differing.length} rubriker\n`);

for (const d of differing) {
  console.log(`── ${d.site} <${d.tag}>`);
  console.log(`   utan kollaps : ${JSON.stringify(d.none.slice(0, 150))}`);
  console.log(`   nuvarande    : ${JSON.stringify(d.current.slice(0, 150))}`);
  console.log(`   åtstramad    : ${JSON.stringify(d.narrowed.slice(0, 150))}`);
  console.log(
    `   utlöst av    : ${d.trigger.map((t) => `${t.kind}(${t.kids} barn)${t.cls ? ` "${t.cls.slice(0, 60)}"` : ""}`).join(", ") || "—"}`,
  );
}

writeFileSync(
  isAbsolute(OUT) ? OUT : join(ROOT, OUT),
  JSON.stringify({ rows, differing, collapsedAtAll }, null, 1),
);
console.log(`\n[rotator-eval] rådata → ${OUT}`);
