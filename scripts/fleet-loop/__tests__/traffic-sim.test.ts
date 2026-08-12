// Fejktrafikens kontrakt: dold sanning → census-payloads (snippetens urval
// över den FRYSTA DOM:en) → produktionens aggregering/rollup → BehaviorInput.
// Sanningen får aldrig läcka på någon annan väg än dwell-mönstret, samma frö
// ska ge samma värld, och payloads får bara innehålla det snippeten kan se.
import { describe, expect, it } from "vitest";

import {
  CENSUS_SECTION_CAP,
  buildCensusPayloads,
  censusEntriesFromHtml,
  fakeTrafficForPage,
  seedForSite,
} from "../traffic-sim";
import { mulberry32 } from "../../sim-rng";

import type { RedesignContentModel } from "../../../src/adaptive/redesign/context";

const CONTENT: RedesignContentModel = {
  sections: [
    {
      id: "sec-1-hero",
      type: "hero",
      position: 1,
      heading: "Build faster",
      aboveFold: true,
      visualWeight: 85,
    },
    {
      id: "sec-2-testimonials",
      type: "testimonials",
      position: 2,
      heading: "Loved by teams everywhere",
      aboveFold: false,
      visualWeight: 56,
    },
    {
      id: "sec-3-pricing",
      type: "pricing",
      position: 3,
      heading: "Simple honest pricing",
      aboveFold: false,
      visualWeight: 52,
    },
  ],
  trustSignals: [],
  ctas: [{ text: "Start free", aboveFold: true }],
  hero: { headline: "Build faster" },
};

// Den frysta sidan som modellen ovan extraherades ur: heron är en h1 (censusen
// ser den ALDRIG), bevis-sektionerna är h2:or i <main>, och header/nav bär
// h2-brus som censusen ska exkludera.
const HTML = `<body><header><h2>Menu heading</h2></header><main>
  <h1>Build faster</h1>
  <h2>Loved by teams everywhere</h2>
  <h2>Simple honest pricing</h2>
</main><footer><h2>Footer links</h2></footer></body>`;

describe("censusEntriesFromHtml — snippetens urval, statiskt", () => {
  it("h2 i main; h1/hero och header/nav/footer/aside-regioner exkluderas; taggar/entiteter städas", () => {
    const entries = censusEntriesFromHtml(
      `<body><nav><h2>Nav</h2></nav><main><h1>Hero line</h1>
       <h2><span>Pricing</span> &amp; <em>plans</em></h2>
       <aside><h2>Sidebar</h2></aside></main></body>`,
    );
    expect(entries).toEqual([{ h: "Pricing & plans", n: 1 }]);
  });

  it("dolda DOM-dubbletter räknas i n (FLERTYDIG-underlaget), och taket är snippetens 24", () => {
    const dupe = `<main><h2>Repeated</h2>${Array.from({ length: 30 }, (_, i) => `<h2>Section ${i}</h2>`).join("")}<h2 style="display:none">Repeated</h2></main>`;
    const entries = censusEntriesFromHtml(dupe);
    expect(entries.length).toBe(CENSUS_SECTION_CAP);
    // n räknas över HELA urvalet före taket — den dolda kopian bortom cap
    // syns i första postens n, precis som querySelectorAll-räkningen.
    expect(entries[0]).toEqual({ h: "Repeated", n: 2 });
  });
});

describe("buildCensusPayloads — payload-formen snippeten skickar", () => {
  it("varje payload är en ORÖRD laddning: adapted === 0 (fältet finns), sections i {h,n,d}-form", () => {
    const census = censusEntriesFromHtml(HTML);
    const payloads = buildCensusPayloads(census, () => 0.5, 40, mulberry32(9));
    expect(payloads.length).toBe(40);
    for (const p of payloads) {
      // Strikt: fältet ska FINNAS och vara 0 — DB-läsvägens arm-stängsel
      // (som simuleringen förbigår) filtrerar på exakt detta. Tappas fältet
      // modellerar harnessen laddningar produktionen hade stängslat bort.
      expect(p.adapted).toBe(0);
      expect(p.sections!.map((s) => ({ h: s.h, n: s.n }))).toEqual(
        census.map((e) => ({ h: e.h, n: e.n })),
      );
      for (const s of p.sections!) expect([200, 1500]).toContain(s.d as number);
    }
  });
});

describe("fakeTrafficForPage — fejktrafik med dold sanning", () => {
  it("guldet är ett av KATALOGENS flyttmål, sanningen het på guldet och sval annars", () => {
    const { plan, skip } = fakeTrafficForPage(CONTENT, HTML, 42);
    expect(skip).toBeNull();
    expect(plan).not.toBeNull();
    expect(["sec-2-testimonials", "sec-3-pricing"]).toContain(plan!.goldSectionId);
    expect(plan!.truth[plan!.goldSectionId]).toBeGreaterThanOrEqual(0.75);
    for (const [id, t] of Object.entries(plan!.truth)) {
      if (id !== plan!.goldSectionId) expect(t).toBeLessThanOrEqual(0.38);
    }
  });

  it("sätet matas genom produktionens rollup: vikter nära sanningen, n = laddningarna", () => {
    const { plan } = fakeTrafficForPage(CONTENT, HTML, 42, 1200);
    const w = plan!.behavior.sectionWeight;
    const n = plan!.behavior.sectionVisits!;
    // Binomialbrus vid n=1200: SE ≈ 1,3 pp — 5 pp-toleransen är rymlig.
    expect(Math.abs(w[plan!.goldSectionId] - plan!.truth[plan!.goldSectionId])).toBeLessThan(0.05);
    for (const id of Object.keys(w)) expect(n[id]).toBe(1200);
  });

  it("deterministiskt: samma frö ⇒ samma guld, sanning och vikter", () => {
    const a = fakeTrafficForPage(CONTENT, HTML, 7).plan!;
    const b = fakeTrafficForPage(CONTENT, HTML, 7).plan!;
    expect(a).toEqual(b);
    // ...och olika frön kan ge olika guld (variation över flottan).
    const golds = new Set(
      Array.from(
        { length: 12 },
        (_, i) => fakeTrafficForPage(CONTENT, HTML, i + 1).plan!.goldSectionId,
      ),
    );
    expect(golds.size).toBeGreaterThan(1);
  });

  it("sida utan flyttbara bevis-sektioner ⇒ ärligt skip, aldrig en gissning", () => {
    const heroOnly: RedesignContentModel = {
      ...CONTENT,
      sections: [CONTENT.sections[0]],
      trustSignals: [],
    };
    const { plan, skip } = fakeTrafficForPage(heroOnly, HTML, 1);
    expect(plan).toBeNull();
    expect(skip).toBe("no-movable-target");
  });

  it("flyttmål vars rubrik är DOM-dubblerad (FLERTYDIG) kan aldrig bli facit ⇒ skip", () => {
    // Bägge bevis-rubrikerna bär en dold responsiv kopia: rollupen vägrar
    // kreditera dem (n=2), så inget mål är mätbart — hellre ärligt skip än
    // att räkna strukturell blindhet som motor-miss.
    const dupedHtml = `<main><h1>Build faster</h1>
      <h2>Loved by teams everywhere</h2><h2 style="display:none">Loved by teams everywhere</h2>
      <h2>Simple honest pricing</h2><h2 style="display:none">Simple honest pricing</h2></main>`;
    const { plan, skip } = fakeTrafficForPage(CONTENT, dupedHtml, 5);
    expect(plan).toBeNull();
    expect(skip).toBe("gold-unobservable");
  });

  it("för mycket ojoinad census-massa ⇒ rollupens ärliga nej blir skip: rollup-null", () => {
    // 5 främmande h2:or mot 2 modellsektioner: >50 % av besöksmassan kan
    // inte attribueras — produktionens MAX_JOIN_MISS_MASS säger nej, och
    // simuleringen rapporterar det i stället för att hitta på ett säte.
    const alienHtml = `<main><h1>Build faster</h1>
      <h2>Loved by teams everywhere</h2><h2>Simple honest pricing</h2>
      <h2>Alien one</h2><h2>Alien two</h2><h2>Alien three</h2><h2>Alien four</h2><h2>Alien five</h2></main>`;
    const { plan, skip } = fakeTrafficForPage(CONTENT, alienHtml, 11, 60);
    expect(plan).toBeNull();
    expect(skip).toBe("rollup-null");
  });

  it("seedForSite är stabilt och skiljer namn åt", () => {
    expect(seedForSite("allbirds")).toBe(seedForSite("allbirds"));
    expect(seedForSite("allbirds")).not.toBe(seedForSite("aritzia"));
    expect(seedForSite("allbirds", 1)).not.toBe(seedForSite("allbirds", 2));
  });
});
