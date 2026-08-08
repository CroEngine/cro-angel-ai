// Steg 8-rollupen: ärligheten är returvärdet — null hellre än gissning, och
// när den svarar är vikterna krediterade genom SAMMA join som eval:en mäter.
import { describe, expect, it } from "vitest";

import {
  MAX_JOIN_MISS_MASS,
  MIN_VISITS,
  rollupEngagement,
} from "../engagement-rollup";

const SECTIONS = [
  { id: "sec-1-hero", type: "hero", heading: "Build faster with Acme" },
  { id: "sec-2-testimonials", type: "testimonials", heading: "Loved by teams everywhere" },
  { id: "sec-3-pricing", type: "pricing", heading: "Simple honest pricing" },
];

const obs = (heading: string, visits: number, engagement: number) => ({
  heading,
  visits,
  engagement,
});

describe("rollupEngagement — null-grindarna", () => {
  it("tunn data ⇒ null (ingen fantomvikt under besöksgolvet)", () => {
    const thin = [obs("Loved by teams everywhere", MIN_VISITS - 1, 0.8)];
    expect(rollupEngagement(SECTIONS, thin)).toBeNull();
    // Exakt på golvet räcker.
    expect(rollupEngagement(SECTIONS, [obs("Loved by teams everywhere", MIN_VISITS, 0.8)])).not.toBeNull();
  });

  it("laddningsgolvet mäter LADDNINGAR, inte sektions-summan (24 sektioner ≠ 24× data)", () => {
    // Granskningsfynd 2026-08-08: summan växte med sektionsantalet — 42
    // laddningar på en 24-sektionssida "nådde" 1000. Max per nyckel är
    // laddnings-proxyn: 42 laddningar ⇒ null oavsett sektionsantal.
    const wide = Array.from({ length: 24 }, (_, i) =>
      obs(`Wide section number ${i + 1}`, 42, 0.5),
    );
    expect(rollupEngagement(SECTIONS, wide)).toBeNull();
    // Två sektioner burna av 1000 laddningar var ⇒ svar (proxyn = 1000).
    const deep = [
      obs("Loved by teams everywhere", 1000, 0.7),
      obs("Simple honest pricing", 1000, 0.3),
    ];
    expect(rollupEngagement(SECTIONS, deep)).not.toBeNull();
  });

  it("hög okrediterbar massa ⇒ null (skev delbild serveras aldrig)", () => {
    // 60 % av besöksmassan bor i rubriker som inte joinar någon sektion.
    const skewed = [
      obs("Loved by teams everywhere", 400, 0.9),
      obs("Random list item one", 300, 0.2),
      obs("Random list item two", 300, 0.2),
    ];
    // minVisits sänkt: här prövas MISS-grinden, inte laddningsgolvet.
    expect(rollupEngagement(SECTIONS, skewed, { minVisits: 300 })).toBeNull();
    // Samma observationer men majoriteten krediterbar ⇒ svar.
    const ok = [
      obs("Loved by teams everywhere", 700, 0.9),
      obs("Random list item one", 300, 0.2),
    ];
    const r = rollupEngagement(SECTIONS, ok, { minVisits: 300 });
    expect(r).not.toBeNull();
    expect(r!.joinMissMass).toBeCloseTo(0.3, 10);
    expect(r!.unattributed).toEqual(["Random list item one"]);
  });

  it("trasiga observationer (0/negativa besök, NaN) räknas inte in", () => {
    const junk = [
      obs("Loved by teams everywhere", 0, 0.9),
      obs("Simple honest pricing", -50, 0.9),
      { heading: "Build faster with Acme", visits: Number.NaN, engagement: 0.5 },
    ];
    expect(rollupEngagement(SECTIONS, junk)).toBeNull(); // allt bortfiltrerat ⇒ tunt
  });
});

describe("rollupEngagement — kreditering genom delade joinen", () => {
  it("vikter landar på RÄTT sektions-id, besöksviktat medel per sektion", () => {
    // Mobil/desktop-aggregat: två observationer normaliserar till samma nyckel.
    const r = rollupEngagement(SECTIONS, [
      obs("Loved by teams everywhere", 600, 0.9),
      obs("  loved   BY teams everywhere ", 200, 0.5), // samma nyckel efter norm
      obs("Simple honest pricing", 400, 0.25),
    ], { minVisits: 500 })!;
    expect(r).not.toBeNull();
    // (600·0,9 + 200·0,5) / 800 = 0,8
    expect(r.sectionWeight["sec-2-testimonials"]).toBeCloseTo(0.8, 10);
    expect(r.sectionWeight["sec-3-pricing"]).toBeCloseTo(0.25, 10);
    // Hero utan observation ⇒ INGEN post (neutral i sätet), aldrig 0-vikt.
    expect("sec-1-hero" in r.sectionWeight).toBe(false);
    expect(r.attributedMass).toBe(1);
  });

  it("prefix-räddad rubrik krediteras (rotator-klassen), exakt som eval:en dömer", () => {
    const sections = [
      {
        id: "sec-1-hero",
        type: "hero",
        heading: "Where go-to-market teams go to grow scale close retain grow",
      },
    ];
    const r = rollupEngagement(sections, [
      obs("Where go-to-market teams go to grow", 2000, 0.6),
    ])!;
    expect(r.sectionWeight["sec-1-hero"]).toBeCloseTo(0.6, 10);
  });

  it("FLERTYDIG kreditar ALDRIG: prefix-nål i två distinkta nycklar ⇒ okrediterbar massa", () => {
    // Sektionens rubrik saknar exakt träff; 24-teckensnålen ligger i TVÅ olika
    // census-nycklar ⇒ FLERTYDIG ⇒ ingen kreditering av någon av dem (att
    // välja vore en gissning — serving får gissa först-träff, kreditering
    // aldrig). OBS: samma-nyckel-observationer är INTE detta fall — de
    // aggregeras som en logisk sektion före joinen.
    const sections = [
      { id: "sec-1-hero", type: "hero", heading: "Build faster with Acme" },
      { id: "sec-2-pricing", type: "pricing", heading: "Simple honest pricing plans" },
    ];
    const r = rollupEngagement(
      sections,
      [
        obs("Build faster with Acme", 600, 0.9),
        obs("Simple honest pricing plans for startups", 300, 0.3),
        obs("Simple honest pricing plans for enterprise", 300, 0.5),
      ],
      { maxJoinMissMass: 0.6, minVisits: 500 },
    )!;
    expect(r).not.toBeNull();
    expect("sec-2-pricing" in r.sectionWeight).toBe(false);
    expect(r.sectionWeight["sec-1-hero"]).toBeCloseTo(0.9, 10);
    // Bägge pris-nycklarna räknas som miss-massa: 600/1200.
    expect(r.joinMissMass).toBeCloseTo(0.5, 10);
  });

  it("samma-nyckel-observationer aggregeras FÖRE joinen (dagsbuckets ≠ dubblettsektioner)", () => {
    // Tre buckets av samma logiska sektion får inte dömas FLERTYDIG.
    const r = rollupEngagement(SECTIONS, [
      obs("Simple honest pricing", 500, 0.2),
      obs("simple honest pricing", 300, 0.4),
      obs("  SIMPLE  honest pricing ", 200, 0.6),
    ])!;
    expect(r).not.toBeNull();
    // (500·0,2 + 300·0,4 + 200·0,6) / 1000 = 0,34
    expect(r.sectionWeight["sec-3-pricing"]).toBeCloseTo(0.34, 10);
    expect(r.attributedMass).toBe(1);
  });

  it("engagemang klampas till [0,1] — en trasig uppströmsandel kan inte skena", () => {
    const r = rollupEngagement(SECTIONS, [obs("Simple honest pricing", 1500, 7)])!;
    expect(r.sectionWeight["sec-3-pricing"]).toBe(1);
  });

  it("icke-innehålls-observationer (footer-klassen) släpps FÖRE joinen — kan aldrig sno kredit", () => {
    // Granskningsfynd 2026-08-05: en footer-rubrik vars nyckel exakt-matchar
    // kunde annars vinna över en driftad innehållsrubrik. Eval:en filtrerar
    // innehåll före joinen — rollupen måste döma likadant.
    const sections = [{ id: "sec-2-pricing", type: "pricing", heading: "Simple honest pricing" }];
    const r = rollupEngagement(sections, [
      { heading: "Simple honest pricing", visits: 900, engagement: 0.05, type: "footer" },
      { heading: "Simple honest pricing plans and more", visits: 1100, engagement: 0.9 },
    ])!;
    expect(r).not.toBeNull();
    // Footern är utanför alla nämnare men synlig i diagnostiken; innehålls-
    // observationen vinner via prefix-passet med SIN engagemang.
    expect(r.droppedNonContentVisits).toBe(900);
    expect(r.totalVisits).toBe(1100);
    expect(r.sectionWeight["sec-2-pricing"]).toBeCloseTo(0.9, 10);
  });

  it("äkta dubblettinstanser (instances > 1) krediteras ALDRIG — eval:ens FLERTYDIG-dom", () => {
    // Avsändaren ser censusen: två sektioner bär samma rubrik. Poolningen får
    // inte dölja instansstrukturen och kreditera det eval:en mätte som miss.
    const r = rollupEngagement(
      SECTIONS,
      [
        obs("Loved by teams everywhere", 700, 0.9),
        { heading: "Simple honest pricing", visits: 500, engagement: 0.4, instances: 2 },
      ],
      { maxJoinMissMass: 0.6, minVisits: 500 },
    )!;
    expect(r).not.toBeNull();
    expect("sec-3-pricing" in r.sectionWeight).toBe(false);
    expect(r.sectionWeight["sec-2-testimonials"]).toBeCloseTo(0.9, 10);
    expect(r.joinMissMass).toBeCloseTo(500 / 1200, 10);
    expect(r.unattributed).toContain("Simple honest pricing");
  });

  it("rubriklösa observationer räknas i miss-massan OCH syns i diagnostiken", () => {
    const r = rollupEngagement(
      SECTIONS,
      [obs("Loved by teams everywhere", 900, 0.8), obs("   ", 300, 0.5)],
      { maxJoinMissMass: 0.5, minVisits: 500 },
    )!;
    expect(r).not.toBeNull();
    expect(r.headinglessVisits).toBe(300);
    expect(r.joinMissMass).toBeCloseTo(0.25, 10);
  });

  it("default-konstanterna är de dokumenterade (planbeslut: konservativt)", () => {
    expect(MIN_VISITS).toBe(1000);
    expect(MAX_JOIN_MISS_MASS).toBe(0.5);
  });
});
