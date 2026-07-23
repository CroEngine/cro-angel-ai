#!/usr/bin/env node
// Serving-vägens CI-smoke — riktiga snippeten i riktig headless Chromium.
//
// Skyddar det enda som rör kundens sida: appliceringen. Tre invarianter, körda
// mot BÅDE den läsbara källan och den minifierade byggartefakten (in-memory,
// samma esbuild-inställningar som scripts/build/minify-snippet.ts):
//
//   1. BOT-GRINDEN: headless Chromium har navigator.webdriver=true → snippeten
//      vägrar boota; harness-flaggan (och bara den) öppnar test-sömmen.
//   2. FULL APPLICERING (utan LCP-observer = tidig boot): variantens ops landar
//      exakt — sektionen lyfts ett steg, rubriken byts till det verifierade
//      värdet, markörer sätts, omkörning är idempotent och reset() återställer
//      sidan BYTE-exakt.
//   2b. REORDER-SJÄLVKOLL (ADR-001 steg 2): en flytt som INTE lyfter sektionen
//      visuellt (DOM-ordning ≠ visuell ordning kring hjälten på den frysta
//      sidan) fälls av självkollen ⇒ HELA varianten rullas tillbaka fail-closed,
//      DOM byte-identisk med baslinjen — aldrig en halv variant.
//   3. ALLT-ELLER-INGET: en op vars lokator inte finns på sidan ⇒ HELA
//      varianten rullas tillbaka — DOM:en är byte-identisk med baslinjen.
//
// Fixtur: den frysta plausible.io-sidan (offline, nätverk avstängt).
//
//   node scripts/ci/serving-smoke.mjs
//   (Chromium: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH-övertramp eller playwrights
//    egen installation — samma mönster som snapshot-testerna.)

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";

const source = readFileSync("public/adaptive.js", "utf8");
const minified = (
  await transform(source, { minify: true, target: "es2017", legalComments: "none" })
).code;

let html = readFileSync("fixtures/real-sites/plausible-io.html", "utf8");
html = html.replace(/<script[\s\S]*?<\/script>/gi, "");

// Happy path: EN flytt som genuint lyfter (People-sektionen 4738→983 px) + en
// retext. Båda ops landar. (Den frysta plausible-sidan har DOM-ordning ≠ visuell
// ordning kring hjälten — ett andra steg skulle SÄNKA sektionen, se SELFCHECK.)
const VARIANT = {
  id: "smoke",
  segmentKey: "facebook·mobile·US",
  ops: [
    { op: "move_up", locator: { tag: "h2", text: "People ❤️ Plausible" } },
    {
      op: "set_text",
      locator: { tag: "h1", text: "Easy to use and privacy-friendly" },
      value: "Privacy-friendly Google Analytics alternative — trusted by thousands of companies.",
    },
  ],
};
// Självkollen (ADR-001 steg 2): ETT andra move_up på samma sektion landar den
// FÖRE ett syskon som renderas visuellt LÄGRE ("relative container mx-auto"), så
// sektionen SJUNKER 983→1227 px i stället för att lyftas. Självkollen ("steg den
// uppåt?") fäller flytten ⇒ HELA varianten rullas tillbaka fail-closed; även den
// verifierade retexten offras — kund-motorn visar aldrig en halv variant.
const SELFCHECK_VARIANT = {
  id: "smoke-selfcheck",
  segmentKey: "facebook·mobile·US",
  ops: [
    { op: "move_up", locator: { tag: "h2", text: "People ❤️ Plausible" } },
    { op: "move_up", locator: { tag: "h2", text: "People ❤️ Plausible" } },
    {
      op: "set_text",
      locator: { tag: "h1", text: "Easy to use and privacy-friendly" },
      value: "Privacy-friendly Google Analytics alternative — trusted by thousands of companies.",
    },
  ],
};
const BROKEN_VARIANT = {
  id: "smoke-broken",
  segmentKey: "x",
  ops: [
    { op: "move_up", locator: { tag: "h2", text: "People ❤️ Plausible" } },
    { op: "set_text", locator: { tag: "h1", text: "THIS HEADING DOES NOT EXIST" }, value: "x" },
  ],
};

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch({ headless: true, executablePath });

async function boot(page, snippet, { harness }) {
  await page.route("**/*", (r) =>
    r.request().url().startsWith("data:") ? r.continue() : r.abort(),
  );
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ src, harness }) => {
      window.PerformanceObserver = undefined; // deterministisk "tidig boot"
      if (harness) window.__ANGEL_HARNESS__ = true;
      const m = document.createElement("script");
      m.type = "text/plain";
      m.setAttribute("data-site", "smoke");
      m.setAttribute("data-endpoint", "https://dead.invalid");
      m.setAttribute("src", "data:text/plain,adaptive.js");
      document.head.appendChild(m);
      (0, eval)(src);
    },
    { src: snippet, harness },
  );
}

const state = (page) =>
  page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const h = [...document.querySelectorAll("h2")].find((x) =>
      (x.textContent || "").includes("People ❤️ Plausible"),
    );
    let sec = h;
    while (
      sec &&
      sec.parentElement &&
      sec.parentElement !== main &&
      sec.parentElement !== document.body
    )
      sec = sec.parentElement;
    return {
      h1: (document.querySelector("main h1") || document.querySelector("h1")).textContent
        .replace(/\s+/g, " ")
        .trim(),
      peopleIdx: [...main.children].indexOf(sec),
      moved: document.querySelectorAll("[data-angel-moved]").length,
      retext: document.querySelectorAll("[data-angel-retext]").length,
      mainHtml: main.innerHTML,
    };
  });

async function runSuite(label, snippet) {
  const failures = [];
  const check = (name, ok) => {
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
    if (!ok) failures.push(name);
  };

  // 1) Bot-grinden. OBS: rätt bevis är window.AngelAdaptive — den sätts
  // OVILLKORLIGT när snippeten bootar (kund-API:t). __angel finns bara under
  // harness-flaggan och är därför odefinierad här oavsett grind — en assert på
  // den vore vakuös (granskningsfynd 2026-07-14: den ursprungliga checken
  // passerade även med borttagen grind).
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await boot(page, snippet, { harness: false });
    const blocked = await page.evaluate(
      () => navigator.webdriver === true && typeof window.AngelAdaptive === "undefined",
    );
    check("bot-grind: webdriver blockerar boot (AngelAdaptive odefinierad)", blocked);
    await page.close();
  }

  // 2) Full applicering + idempotens + byte-exakt reset.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await boot(page, snippet, { harness: true });
    const booted = await page.evaluate(() => typeof window.__angel === "object");
    check("harness-flaggan öppnar test-sömmen", booted);
    // Positiv kontroll för bot-checken ovan: när booten FÅR gå igenom sätts
    // AngelAdaptive — så frånvaron i harness-false-fallet bevisar grinden.
    check(
      "positiv kontroll: AngelAdaptive definierad när boot tillåts",
      await page.evaluate(() => typeof window.AngelAdaptive === "object"),
    );
    const before = await state(page);
    const applied = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      VARIANT,
    );
    const after = await state(page);
    check("variant rapporterad applicerad", applied.includes("variant:smoke"));
    check("sektionen lyft ett steg", before.peopleIdx - after.peopleIdx === 1);
    check(
      "rubriken bytt till verifierat värde",
      after.h1.startsWith("Privacy-friendly Google Analytics"),
    );
    check("markörer satta (moved+retext)", after.moved === 1 && after.retext === 1);
    const applied2 = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      VARIANT,
    );
    const afterRe = await state(page);
    check(
      "omkörning idempotent (hydrerings-skydd)",
      applied2.includes("variant:smoke") &&
        afterRe.peopleIdx === after.peopleIdx &&
        afterRe.moved === 1,
    );
    await page.evaluate(() => window.__angel.reset());
    const restored = await state(page);
    check("reset återställer BYTE-exakt", restored.mainHtml === before.mainHtml);
    check("noll residue efter reset", (await page.evaluate(() => window.__angel.residue())) === 0);
    await page.close();
  }

  // 2b) Reorder-självkollen (ADR-001 steg 2). SELFCHECK_VARIANT gör ETT extra
  //     move_up som skulle SÄNKA sektionen (DOM-ordning ≠ visuell ordning kring
  //     hjälten). Självkollen ("steg den uppåt?") fäller flytten ⇒ HELA varianten
  //     fail-closed: ingen op landar (inte ens den giltiga retexten), DOM byte-
  //     identisk med baslinjen, noll markörer/residue. Detta är regressionsgrinden
  //     för porteringen — utan självkollen skulle sektionen dubbel-flyttas nedåt.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await boot(page, snippet, { harness: true });
    const before = await state(page);
    const applied = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      SELFCHECK_VARIANT,
    );
    const after = await state(page);
    check(
      "självkoll: no-lift-flytt ⇒ varianten rapporteras EJ applicerad",
      !applied.includes("variant:smoke-selfcheck"),
    );
    check(
      "självkoll: fail-closed ⇒ DOM byte-identisk med baslinjen",
      after.mainHtml === before.mainHtml,
    );
    check("självkoll: noll markörer (den giltiga första flytten offrad)", after.moved === 0 && after.retext === 0);
    check(
      "självkoll: noll residue (inget kvar att återställa)",
      (await page.evaluate(() => window.__angel.residue())) === 0,
    );
    await page.close();
  }

  // 3) Allt-eller-inget.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await boot(page, snippet, { harness: true });
    const before = await state(page);
    const applied = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      BROKEN_VARIANT,
    );
    const after = await state(page);
    check(
      "trasig lokator ⇒ varianten rapporteras EJ applicerad",
      !applied.includes("variant:smoke-broken"),
    );
    check("trasig lokator ⇒ DOM byte-identisk med baslinjen", after.mainHtml === before.mainHtml);
    await page.close();
  }

  // 4) Wrapper-nästlade sektioner (v2-upplösningen): flytten ska lyfta EXAKT
  //    sektionen inne i wrappern — inte wrappern, inte sidan — ett steg,
  //    reversibelt. Detta var mönstret 8/13 riktiga sajter hade där v1 vägrade.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const nestedHtml = readFileSync("fixtures/synthetic/nested-sections.html", "utf8");
    await page.route("**/*", (r) =>
      r.request().url().startsWith("data:") ? r.continue() : r.abort(),
    );
    await page.setContent(nestedHtml, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ({ src }) => {
        window.PerformanceObserver = undefined;
        window.__ANGEL_HARNESS__ = true;
        const m = document.createElement("script");
        m.type = "text/plain";
        m.setAttribute("data-site", "smoke");
        m.setAttribute("data-endpoint", "https://dead.invalid");
        m.setAttribute("src", "data:text/plain,adaptive.js");
        document.head.appendChild(m);
        (0, eval)(src);
      },
      { src: snippet },
    );
    const nestedState = () =>
      page.evaluate(() => ({
        wrapperOrder: [...document.querySelector(".wrapper").children].map((c) => c.id),
        heroFirst: document.querySelector(".page").children[0].className === "hero",
        wrapperIntact: document.querySelector(".wrapper").children.length === 3,
        movedId: document.querySelector("[data-angel-moved]")?.id ?? null,
        pageHtml: document.querySelector("main").innerHTML,
      }));
    const before = await nestedState();
    const applied = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      {
        id: "smoke-nested",
        segmentKey: "x",
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Gamma Pricing" } }],
      },
    );
    const after = await nestedState();
    check("nästlad: variant applicerad", applied.includes("variant:smoke-nested"));
    check(
      "nästlad: SEKTIONEN lyft ett steg inne i wrappern (inte wrappern)",
      JSON.stringify(after.wrapperOrder) === JSON.stringify(["sec-alpha", "sec-gamma", "sec-beta"]),
    );
    check("nästlad: hjälten kvar först, wrappern intakt", after.heroFirst && after.wrapperIntact);
    check("nästlad: markören sitter på sektionen", after.movedId === "sec-gamma");
    await page.evaluate(() => window.__angel.reset());
    const restored = await nestedState();
    check("nästlad: reset återställer BYTE-exakt", restored.pageHtml === before.pageHtml);
    await page.close();
  }

  // 4b) Divider-hoppet (breddfynd 1, linear-obduktionen 2026-07-18): syskonet
  //     närmast ovanför sektionen är en 2px dekor-divider — flytten ska landa
  //     OVANFÖR närmsta riktiga sektion, inte byta plats med en osynlig linje.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route("**/*", (r) =>
      r.request().url().startsWith("data:") ? r.continue() : r.abort(),
    );
    await page.setContent(
      `<main><div class="page"><div class="hero"><h1>Hero</h1><p>intro</p></div>` +
        `<div class="wrapper"><section id="sec-a"><h2>Alpha Sec</h2><p>a</p></section>` +
        `<div id="divider" style="height:2px"></div>` +
        `<section id="sec-b"><h2>Beta Sec</h2><p>b</p></section></div></div></main>`,
      { waitUntil: "domcontentloaded" },
    );
    await page.evaluate(
      ({ src }) => {
        window.PerformanceObserver = undefined;
        window.__ANGEL_HARNESS__ = true;
        const m = document.createElement("script");
        m.type = "text/plain";
        m.setAttribute("data-site", "smoke");
        m.setAttribute("data-endpoint", "https://dead.invalid");
        m.setAttribute("src", "data:text/plain,adaptive.js");
        document.head.appendChild(m);
        (0, eval)(src);
      },
      { src: snippet },
    );
    const dividerState = () =>
      page.evaluate(() => ({
        order: [...document.querySelector(".wrapper").children].map((c) => c.id),
        pageHtml: document.querySelector("main").innerHTML,
      }));
    const before = await dividerState();
    const applied = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      {
        id: "smoke-divider",
        segmentKey: "x",
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Beta Sec" } }],
      },
    );
    const after = await dividerState();
    check("divider: variant applicerad", applied.includes("variant:smoke-divider"));
    check(
      "divider: sektionen landar OVANFÖR riktiga grannen (inte platsbyte med dividern)",
      JSON.stringify(after.order) === JSON.stringify(["sec-b", "sec-a", "divider"]),
    );
    await page.evaluate(() => window.__angel.reset());
    const restored = await dividerState();
    check("divider: reset återställer BYTE-exakt", restored.pageHtml === before.pageHtml);
    await page.close();
  }

  // 5) Platt artikelsida (granskningens probe: h2:or som direkta syskon) —
  //    en flytt MÅSTE vägras helt: att flytta en naken rubrik utan sin
  //    brödtext förstör innehållet, och utan sektionsnivå får INGET flyttas.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route("**/*", (r) =>
      r.request().url().startsWith("data:") ? r.continue() : r.abort(),
    );
    await page.setContent(
      `<main><article><h1>Article Hero</h1><p>intro</p><h2>Alpha Part</h2><p>alpha body</p><h2>Beta Part</h2><p>beta body</p></article></main>`,
      { waitUntil: "domcontentloaded" },
    );
    await page.evaluate(
      ({ src }) => {
        window.PerformanceObserver = undefined;
        window.__ANGEL_HARNESS__ = true;
        const m = document.createElement("script");
        m.type = "text/plain";
        m.setAttribute("data-site", "smoke");
        m.setAttribute("data-endpoint", "https://dead.invalid");
        m.setAttribute("src", "data:text/plain,adaptive.js");
        document.head.appendChild(m);
        (0, eval)(src);
      },
      { src: snippet },
    );
    const before = await page.evaluate(() => document.querySelector("main").innerHTML);
    const applied = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      {
        id: "smoke-flat",
        segmentKey: "x",
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Beta Part" } }],
      },
    );
    const after = await page.evaluate(() => document.querySelector("main").innerHTML);
    check(
      "platt artikel: flytt VÄGRAS (ingen sektionsnivå)",
      !applied.includes("variant:smoke-flat"),
    );
    check("platt artikel: DOM byte-identisk", after === before);
    await page.close();
  }

  // 6) Retext + flytt på SAMMA mål i planordning (granskningens probe:
  //    tvåfas-upplösningen gör att omtextningen aldrig saboterar flyttens
  //    lokator — allt upplöses mot orörd DOM innan något ändras).
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const nestedHtml = readFileSync("fixtures/synthetic/nested-sections.html", "utf8");
    await page.route("**/*", (r) =>
      r.request().url().startsWith("data:") ? r.continue() : r.abort(),
    );
    await page.setContent(nestedHtml, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ({ src }) => {
        window.PerformanceObserver = undefined;
        window.__ANGEL_HARNESS__ = true;
        const m = document.createElement("script");
        m.type = "text/plain";
        m.setAttribute("data-site", "smoke");
        m.setAttribute("data-endpoint", "https://dead.invalid");
        m.setAttribute("src", "data:text/plain,adaptive.js");
        document.head.appendChild(m);
        (0, eval)(src);
      },
      { src: snippet },
    );
    const applied = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      {
        id: "smoke-2phase",
        segmentKey: "x",
        ops: [
          {
            op: "set_text",
            locator: { tag: "h2", text: "Gamma Pricing" },
            value: "Pricing that scales",
          },
          { op: "move_up", locator: { tag: "h2", text: "Gamma Pricing" } },
        ],
      },
    );
    const state6 = await page.evaluate(() => ({
      order: [...document.querySelector(".wrapper").children].map((c) => c.id),
      gammaText: document.querySelector("#sec-gamma h2").textContent,
    }));
    check(
      "tvåfas: BÅDA ops applicerade trots samma mål (retext före flytt)",
      applied.includes("variant:smoke-2phase"),
    );
    check(
      "tvåfas: sektionen flyttad OCH omtextad",
      JSON.stringify(state6.order) === JSON.stringify(["sec-alpha", "sec-gamma", "sec-beta"]) &&
        state6.gammaText === "Pricing that scales",
    );
    await page.close();
  }

  // 7) insert_snippet (korssid-lyftet, task #117): det ordagranna citatet
  //    sätts in som <p> DIREKT EFTER hjälte-blocket (.hero — ankarregeln är
  //    "h1:ans högsta census-h2-fria förfader", ALDRIG sid-wrappern),
  //    idempotent vid omkörning, spårlöst borta efter reset.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const nestedHtml = readFileSync("fixtures/synthetic/nested-sections.html", "utf8");
    await page.route("**/*", (r) =>
      r.request().url().startsWith("data:") ? r.continue() : r.abort(),
    );
    await page.setContent(nestedHtml, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ({ src }) => {
        window.PerformanceObserver = undefined;
        window.__ANGEL_HARNESS__ = true;
        const m = document.createElement("script");
        m.type = "text/plain";
        m.setAttribute("data-site", "smoke");
        m.setAttribute("data-endpoint", "https://dead.invalid");
        m.setAttribute("src", "data:text/plain,adaptive.js");
        document.head.appendChild(m);
        (0, eval)(src);
      },
      { src: snippet },
    );
    const QUOTE = "Från 99 kr/mån — alla funktioner ingår.";
    const insertState = () =>
      page.evaluate(() => {
        const hero = document.querySelector(".hero");
        const ins = document.querySelectorAll("[data-angel-inserted]");
        return {
          count: ins.length,
          afterHero: ins.length === 1 && hero.nextElementSibling === ins[0],
          text: ins.length === 1 ? ins[0].textContent : null,
          tag: ins.length === 1 ? ins[0].tagName.toLowerCase() : null,
          mainHtml: document.querySelector("main").innerHTML,
        };
      });
    const before = await insertState();
    const applied = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      {
        id: "smoke-insert",
        segmentKey: "x",
        ops: [
          {
            op: "insert_snippet",
            locator: { tag: "h1", text: "Nested Fixture Hero" },
            value: QUOTE,
          },
        ],
      },
    );
    const after = await insertState();
    check("insert: variant applicerad", applied.includes("variant:smoke-insert"));
    check(
      "insert: <p> DIREKT efter hjälte-blocket (inte wrappern, inte sidbotten)",
      after.afterHero && after.tag === "p",
    );
    check("insert: texten ordagrann via textContent", after.text === QUOTE);
    const applied2 = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      {
        id: "smoke-insert",
        segmentKey: "x",
        ops: [
          {
            op: "insert_snippet",
            locator: { tag: "h1", text: "Nested Fixture Hero" },
            value: QUOTE,
          },
        ],
      },
    );
    const afterRe = await insertState();
    check(
      "insert: omkörning idempotent (exakt EN nod)",
      applied2.includes("variant:smoke-insert") && afterRe.count === 1,
    );
    await page.evaluate(() => window.__angel.reset());
    const restored = await insertState();
    check(
      "insert: reset tar bort noden BYTE-exakt",
      restored.count === 0 && restored.mainHtml === before.mainHtml,
    );
    check(
      "insert: noll residue efter reset",
      (await page.evaluate(() => window.__angel.residue())) === 0,
    );

    // 7b) Klickväg + stil-donator (slice 4, ägarbeslut alt. D): giltig href ⇒
    //     citatet renderas som LÄNK i donatorklassen; ogiltig href (extern/
    //     protokoll) ⇒ ren text utan länk — klientens försvarsdjup.
    const linkedApplied = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      {
        id: "smoke-insert-link",
        segmentKey: "x",
        ops: [
          {
            op: "insert_snippet",
            locator: { tag: "h1", text: "Nested Fixture Hero" },
            value: QUOTE,
            href: "/priser",
            styleClass: "t-text-s",
          },
        ],
      },
    );
    const linked = await page.evaluate(() => {
      const ins = document.querySelector("[data-angel-inserted]");
      const a = ins ? ins.querySelector("a") : null;
      return {
        hasLink: !!a,
        href: a ? a.getAttribute("href") : null,
        cls: a ? a.getAttribute("class") : null,
        text: a ? a.textContent : null,
      };
    });
    check(
      "insert-länk: giltig href ⇒ <a> till källsidan i donatorklassen",
      linkedApplied.includes("variant:smoke-insert-link") &&
        linked.hasLink &&
        linked.href === "/priser" &&
        linked.cls === "t-text-s" &&
        linked.text === QUOTE,
    );
    await page.evaluate(() => window.__angel.reset());
    const badApplied = await page.evaluate(
      (v) => window.__angel.apply({ adaptations: [], variant: v }),
      {
        id: "smoke-insert-badhref",
        segmentKey: "x",
        ops: [
          {
            op: "insert_snippet",
            locator: { tag: "h1", text: "Nested Fixture Hero" },
            value: QUOTE,
            href: "javascript:alert(1)",
          },
        ],
      },
    );
    const bad = await page.evaluate(() => {
      const ins = document.querySelector("[data-angel-inserted]");
      return { hasLink: !!(ins && ins.querySelector("a")), text: ins ? ins.textContent : null };
    });
    check(
      "insert-länk: ogiltig href ⇒ ren text, ALDRIG länk (försvarsdjup)",
      badApplied.includes("variant:smoke-insert-badhref") && !bad.hasLink && bad.text === QUOTE,
    );
    await page.evaluate(() => window.__angel.reset());
    check(
      "insert-länk: noll residue efter reset",
      (await page.evaluate(() => window.__angel.residue())) === 0,
    );
    await page.close();
  }

  return failures;
}

console.log("── serving-smoke: KÄLLAN (public/adaptive.js) ──");
const f1 = await runSuite("source", source);
console.log("── serving-smoke: MINIFIERAD (byggartefakten) ──");
const f2 = await runSuite("minified", minified);
await browser.close();

const failures = [...f1.map((f) => `källa: ${f}`), ...f2.map((f) => `minifierad: ${f}`)];
if (failures.length) {
  console.error(`\nSERVING SMOKE FAIL (${failures.length}):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nSERVING SMOKE OK (källa + minifierad)");
