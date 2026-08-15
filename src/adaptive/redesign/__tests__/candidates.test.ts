// Kandidatkatalogens kontrakt: lagliga drag ur modellen, deterministisk
// ordning, ordagranna texter, aldrig hjälten som flyttmål, dedup.
import { describe, it, expect } from "vitest";

import {
  BEHAVIOR_GAIN,
  BEHAVIOR_SHRINK_N0,
  DEFAULT_CANDIDATE_OPS,
  MAX_POSITION_BONUS,
  MOVE_TYPE_WEIGHT,
  NON_PROOF_TYPES,
  PROOF_TYPES_FLOOR,
  REUSE_PROVEN_SCORE,
  generateCandidates,
  candidateToOp,
  floorWhy,
  tidySignalText,
} from "../candidates";
import { DEFAULT_REDESIGN_GUARDRAILS, withInsertSnippet } from "../context";
import type { RedesignContentModel } from "../context";

// Vokabulären är MOVE-ONLY sedan ägarbeslutet 2026-08-15 ("endast flytta
// sektioner, inte ändra text"). Insert-maskineriet är inte borttaget — det
// begärs EXPLICIT, precis som en anropare som medvetet vill ha tillbaka
// textdraget måste göra. Testerna nedanför som handlar om insert-kandidater
// går därför genom gcIns; allt annat kör standardvokabulären.
const WITH_INSERT: readonly string[] = ["move_up", "insert_snippet"];
const gcIns = (
  content: RedesignContentModel,
  behavior?: Parameters<typeof generateCandidates>[1],
  reuse?: Parameters<typeof generateCandidates>[2],
  moveReuse?: Parameters<typeof generateCandidates>[3],
) => generateCandidates(content, behavior, reuse, moveReuse, WITH_INSERT);

const model = (over: Partial<RedesignContentModel> = {}): RedesignContentModel => ({
  sections: [
    {
      id: "sec-1-hero",
      type: "hero",
      position: 1,
      heading: "Describe who you want to hire",
      aboveFold: true,
      visualWeight: 5,
    },
    {
      id: "sec-2-features",
      type: "features",
      position: 2,
      heading: "Everything you need",
      aboveFold: false,
      visualWeight: 3,
    },
    {
      id: "sec-3-testimonials",
      type: "testimonials",
      position: 3,
      heading: "Don't just take our word for it",
      aboveFold: false,
      visualWeight: 3,
      containsTrustSignals: true,
    },
    {
      id: "sec-4-logos",
      type: "logos",
      position: 4,
      heading: "Trusted by teams",
      aboveFold: false,
      visualWeight: 2,
    },
  ],
  trustSignals: [
    { type: "trusted_by", text: "Trusted by the world's best", aboveFold: false, section: "body" },
    { type: "compliance", text: "GDPR compliant", aboveFold: false, section: "body" },
    // Dubblett-text — ska dedupas bort.
    { type: "trusted_by", text: "Trusted by the world's best", aboveFold: false, section: "body" },
    // För kort — ska filtreras.
    { type: "guarantee", text: "Garanti", aboveFold: false, section: "body" },
  ],
  ctas: [],
  hero: { headline: "Describe who you want to hire" },
  ...over,
});

describe("generateCandidates", () => {
  it("genererar flytt för bevissektioner OCH övriga typer — men aldrig hjälten", () => {
    // Breddningen 2026-08-15: features/faq/comparison är flyttbara sedan
    // vokabulären smalnade till enbart flyttar. Hjälten är fortfarande aldrig
    // ett flyttmål (appliceraren vägrar dessutom en flytt som landar ovanför
    // den) och sektioner ovanför folden har inget att vinna.
    const c = generateCandidates(model());
    const moves = c.filter((x) => x.kind === "move_up").map((x) => x.targetId);
    expect(moves).toContain("sec-3-testimonials");
    expect(moves).toContain("sec-4-logos");
    expect(moves).toContain("sec-2-features");
    expect(moves).not.toContain("sec-1-hero");
  });

  // GAP-KRAVET, uttömmande. Första utkastet testade bara testimonials (4,15)
  // och logos (2,70) mot features (1,45) — de två paren som ALDRIG kan falla —
  // och missade att comparison 1,4 på position 5 gick om pricing 1,5 på
  // position 2. Nu prövas VARJE par i sitt värsta läge: den svagaste bevis-
  // typen högst upp mot den starkaste övriga längst ned.
  it("GAP-KRAVET: varje bevis-typ slår varje övrig typ i värsta positionsläget", () => {
    const PROOF = ["testimonials", "logos", "stats", "proof", "pricing"];
    for (const proof of PROOF) {
      for (const other of NON_PROOF_TYPES) {
        const c = generateCandidates({
          ...model({ trustSignals: [] }),
          sections: [
            {
              id: "sec-1-hero",
              type: "hero",
              position: 1,
              heading: "H",
              aboveFold: true,
              visualWeight: 5,
            },
            // Bevis-typen SÄMST placerad (position 2 ⇒ minimal bonus)...
            {
              id: `sec-2-${proof}`,
              type: proof,
              position: 2,
              heading: `${proof} block`,
              aboveFold: false,
              visualWeight: 3,
            },
            // ...den övriga typen BÄST placerad (position 8+ ⇒ maximal bonus).
            {
              id: `sec-9-${other}`,
              type: other,
              position: 9,
              heading: `${other} block`,
              aboveFold: false,
              visualWeight: 3,
            },
          ],
        });
        const s = (id: string) => c.find((x) => x.id === id)!.score;
        expect([`${proof} vs ${other}`, s(`mv-sec-2-${proof}`) > s(`mv-sec-9-${other}`)]).toEqual([
          `${proof} vs ${other}`,
          true,
        ]);
        expect(c[0].id).toBe(`mv-sec-2-${proof}`);
      }
    }
  });

  it("gap-kravet är ARITMETISKT sant, inte bara sant för fixturerna", () => {
    // Vakten mot en framtida viktändring: håller olikheten i tabellen självt
    // kan inget urval av sektioner vända ordningen.
    for (const t of NON_PROOF_TYPES) {
      expect(MOVE_TYPE_WEIGHT[t] + MAX_POSITION_BONUS).toBeLessThan(PROOF_TYPES_FLOOR);
    }
    // ...och golvet ÄR den svagaste bevis-typen (annars vaktar kravet fel tal).
    const proofWeights = Object.entries(MOVE_TYPE_WEIGHT)
      .filter(([k]) => !NON_PROOF_TYPES.includes(k))
      .map(([, v]) => v);
    expect(Math.min(...proofWeights)).toBe(PROOF_TYPES_FLOOR);
  });

  it("trust-bonusen får MEDVETET gå om typ-priorn", () => {
    // En features-sektion som faktiskt BÄR en trust-signal är bevisbärande —
    // då är det inte priorn som gissar, och den ska få stå över.
    const c = generateCandidates({
      ...model({ trustSignals: [] }),
      sections: [
        {
          id: "sec-1-hero",
          type: "hero",
          position: 1,
          heading: "H",
          aboveFold: true,
          visualWeight: 5,
        },
        {
          id: "sec-2-pricing",
          type: "pricing",
          position: 2,
          heading: "Priser",
          aboveFold: false,
          visualWeight: 3,
        },
        {
          id: "sec-3-features",
          type: "features",
          position: 3,
          heading: "Så funkar det",
          aboveFold: false,
          visualWeight: 3,
          containsTrustSignals: true,
        },
      ],
    });
    expect(c[0].id).toBe("mv-sec-3-features");
  });

  it("testimonials med proof rankas över logos; trusted_by över compliance", () => {
    const c = gcIns(model());
    const idx = (id: string) => c.findIndex((x) => x.id === id);
    expect(idx("mv-sec-3-testimonials")).toBeLessThan(idx("mv-sec-4-logos"));
    const tb = c.find((x) => x.id.startsWith("ins-trusted_by"))!;
    const comp = c.find((x) => x.id.startsWith("ins-compliance"))!;
    expect(tb.score).toBeGreaterThan(comp.score);
  });

  it("dedupar identiska texter och filtrerar för korta signaler", () => {
    const c = gcIns(model());
    const trustedBy = c.filter((x) => x.detail === "Trusted by the world's best");
    expect(trustedBy).toHaveLength(1);
    expect(c.some((x) => x.detail === "Garanti")).toBe(false);
  });

  it("ordningen är deterministisk (score, sedan id) — golvets val är stabilt", () => {
    const a = generateCandidates(model()).map((x) => x.id);
    const b = generateCandidates(model()).map((x) => x.id);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("tom sida ⇒ tom katalog (ärligt thin-page-nej, aldrig ett hittat drag)", () => {
    const c = generateCandidates(model({ sections: [], trustSignals: [] }));
    expect(c).toEqual([]);
  });

  it("candidateToOp översätter till verify-språket med väljarens why", () => {
    const c = gcIns(model());
    const move = c.find((x) => x.kind === "move_up")!;
    const ins = c.find((x) => x.kind === "insert_snippet")!;
    expect(candidateToOp(move, "därför")).toEqual({
      op: "move_up",
      targetId: move.targetId,
      detail: "Move this section higher on the page",
      why: "därför",
    });
    const insOp = candidateToOp(ins, floorWhy(ins));
    expect(insOp.op).toBe("insert_snippet");
    expect(insOp.targetId).toBe("hero");
    expect(insOp.detail).toBe(ins.detail);
    expect(insOp.why).toContain("Rule-selected top candidate");
  });

  // Framer-klassen (ägarfynd fikajobs 2026-07-28): SSR renderar samma element
  // per brytpunkt — den platta signaltexten dubblerar sig själv i skarven.
  it("tidySignalText klipper SSR-dubbletten och behåller ordagrant prefix", () => {
    expect(
      tidySignalText(
        "Trusted by leading startups and companies in Sweden Trusted by leading startups",
      ),
    ).toBe("Trusted by leading startups and companies in Sweden");
    // Utan upprepning: orörd.
    expect(tidySignalText("Trusted by 4,000+ teams worldwide")).toBe(
      "Trusted by 4,000+ teams worldwide",
    );
    // UI-brus-klippet fungerar fortfarande ihop med upprepnings-klippet.
    expect(tidySignalText("Trusted by the world's best 0:30 Play video")).toBe(
      "Trusted by the world's best",
    );
  });

  // ── Beteende-sätet (steg 7, D3) ────────────────────────────────────────────
  it("utan beteende-input är katalogen BYTE-IDENTISK (neutralt säte)", () => {
    const plain = generateCandidates(model());
    expect(generateCandidates(model(), undefined)).toEqual(plain);
    expect(generateCandidates(model(), { sectionWeight: {} })).toEqual(plain);
    // Vikter för sektioner som inte finns i modellen är också neutrala.
    expect(generateCandidates(model(), { sectionWeight: { "sec-99-ghost": 0.9 } })).toEqual(plain);
    // gain 0 ⇒ termen är 0 oavsett vikt — också identiskt.
    expect(generateCandidates(model(), { sectionWeight: { "sec-4-logos": 0.9 }, gain: 0 })).toEqual(
      plain,
    );
  });

  it("beteendet omrankar flyttarna: het logos-sektion slår kall testimonials", () => {
    // Priorn säger testimonials (3+1) > logos (2,5) — men besökarna säger tvärtom.
    const c = generateCandidates(model(), {
      sectionWeight: { "sec-4-logos": 0.9, "sec-3-testimonials": 0.05 },
    });
    const idx = (id: string) => c.findIndex((x) => x.id === id);
    expect(idx("mv-sec-4-logos")).toBeLessThan(idx("mv-sec-3-testimonials"));
    // ...och samma input får ALDRIG ändra kandidat-mängden, bara ordningen.
    const ids = (cs: ReturnType<typeof generateCandidates>) => cs.map((x) => x.id).sort();
    expect(ids(c)).toEqual(ids(generateCandidates(model())));
  });

  it("insert-reserven förankras till SIN sektions engagemang (kritikerns fix)", () => {
    // Het logos-sektion ⇒ även dess rubrik-insert (insh-sec-4-logos) ska bära
    // beteende-termen och slå den kalla testimonials-rubrikens insert.
    const c = gcIns(model(), { sectionWeight: { "sec-4-logos": 0.8 } });
    const hot = c.find((x) => x.id === "insh-sec-4-logos")!;
    const cold = c.find((x) => x.id === "insh-sec-3-testimonials")!;
    expect(hot.score).toBeGreaterThan(cold.score);
    expect(hot.score).toBeCloseTo(2.5 * 0.6 + BEHAVIOR_GAIN * 0.8, 10);
  });

  it("trust-signal-inserts: körsektionens vikt räknas bara när sektionen finns", () => {
    // section:"body" är ingen riktig sektion ⇒ neutral term (som idag)...
    const plainTb = gcIns(model()).find((x) => x.id.startsWith("ins-trusted_by"))!;
    const stillTb = gcIns(model(), {
      sectionWeight: { "sec-4-logos": 0.8 },
    }).find((x) => x.id.startsWith("ins-trusted_by"))!;
    expect(stillTb.score).toBe(plainTb.score);
    // ...men en signal extraktionen KAN sektionsbinda får sin sektions term.
    const bound = gcIns(
      model({
        trustSignals: [
          {
            type: "trusted_by",
            text: "Trusted by the world's best",
            aboveFold: false,
            section: "sec-4-logos",
          },
        ],
      }),
      { sectionWeight: { "sec-4-logos": 0.5 } },
    ).find((x) => x.id.startsWith("ins-trusted_by"))!;
    expect(bound.score).toBeCloseTo(3 + BEHAVIOR_GAIN * 0.5, 10);
  });

  it("beteende-vikter klampas till [0,1] — en trasig rollup kan inte skena", () => {
    const c = generateCandidates(model(), { sectionWeight: { "sec-4-logos": 999 } });
    const mv = c.find((x) => x.id === "mv-sec-4-logos")!;
    expect(mv.score).toBeCloseTo(2.5 + 4 * 0.05 + BEHAVIOR_GAIN * 1, 10);
    // NaN/Infinity är neutralt, aldrig NaN-poäng.
    const bad = generateCandidates(model(), { sectionWeight: { "sec-4-logos": Number.NaN } });
    expect(bad).toEqual(generateCandidates(model()));
  });

  it("dynamiska golvet: termen krymper med n/(n+N0) — halva vikten vid n=N0", () => {
    // Floor-svepet 2026-08-09: inflytande proportionellt mot evidensen.
    const at = (n: number) =>
      generateCandidates(model(), {
        sectionWeight: { "sec-4-logos": 0.8 },
        sectionVisits: { "sec-4-logos": n },
      }).find((x) => x.id === "mv-sec-4-logos")!.score;
    const base = 2.5 + 4 * 0.05;
    expect(at(BEHAVIOR_SHRINK_N0)).toBeCloseTo(base + BEHAVIOR_GAIN * 0.5 * 0.8, 10);
    expect(at(30)).toBeCloseTo(base + BEHAVIOR_GAIN * (30 / 80) * 0.8, 10);
    expect(at(1000)).toBeCloseTo(base + BEHAVIOR_GAIN * (1000 / 1050) * 0.8, 10);
    // n=0 ⇒ termen är exakt 0 — katalogen byte-identisk med den beteende-blinda.
    expect(
      generateCandidates(model(), {
        sectionWeight: { "sec-4-logos": 0.8 },
        sectionVisits: { "sec-4-logos": 0 },
      }),
    ).toEqual(generateCandidates(model()));
  });

  it("dynamiska golvet: utan sectionVisits INGEN krympning — rör-testets kontrakt orört", () => {
    // Bakåtkompatibelt: äldre anropare (och facit:ets perfekta signal) ger
    // bara vikter — termen är då exakt gain·w som före förändringen.
    const withMap = generateCandidates(model(), { sectionWeight: { "sec-4-logos": 0.8 } });
    expect(withMap.find((x) => x.id === "mv-sec-4-logos")!.score).toBeCloseTo(
      2.5 + 4 * 0.05 + BEHAVIOR_GAIN * 0.8,
      10,
    );
    // NÄRVARANDE men trasigt n (NaN/negativt ur en buggig rollup) döms som
    // vikternas egna trasiga värden: NEUTRALT — aldrig fullt inflytande av
    // misstag, aldrig NaN-poäng.
    const nan = generateCandidates(model(), {
      sectionWeight: { "sec-4-logos": 0.8 },
      sectionVisits: { "sec-4-logos": Number.NaN },
    });
    expect(nan).toEqual(generateCandidates(model()));
    const neg = generateCandidates(model(), {
      sectionWeight: { "sec-4-logos": 0.8 },
      sectionVisits: { "sec-4-logos": -100 },
    });
    expect(neg).toEqual(generateCandidates(model()));
  });

  it("dynamiska golvet: kart-kontraktet — vikt vars n SAKNAS i en närvarande karta är neutral", () => {
    // Granskningsfynd 2026-08-10: per-nyckel-fallback hade gett sektionen
    // UTAN evidensräkning fullt gain medan de mätta krymptes — motsatsen
    // till golvets mening. Finns kartan gäller den varje viktad sektion.
    const droppedKey = generateCandidates(model(), {
      sectionWeight: { "sec-4-logos": 0.8, "sec-3-testimonials": 0.6 },
      sectionVisits: { "sec-3-testimonials": 35 }, // logos-nyckeln tappad
    });
    const idx = (cs: ReturnType<typeof generateCandidates>, id: string) =>
      cs.findIndex((x) => x.id === id);
    // Logos-termen är 0 (neutral) — den mätta testimonials-sektionen leder.
    const mvLogos = droppedKey.find((x) => x.id === "mv-sec-4-logos")!;
    expect(mvLogos.score).toBeCloseTo(2.5 + 4 * 0.05, 10); // bara priorn
    expect(idx(droppedKey, "mv-sec-3-testimonials")).toBeLessThan(
      idx(droppedKey, "mv-sec-4-logos"),
    );
  });

  it("återbruksfrön blir kandidater: full text, källsida, proveniens — och rätt rang", () => {
    // Blockbiblioteket steg 2: fröet står ÖVER alla obevisade priors (max
    // 3+1+0,4=4,4) men UNDER en beteende-ledd kandidat — målsidans egna
    // besökare slår importerat bevis.
    const seed = {
      variantId: "11111111-aaaa-bbbb-cccc-000000000001",
      provedOnPath: "/priser",
      sourcePath: "/priser",
      text: "Från 299 kr per månad, avsluta utan bindningstid när du vill",
    };
    const c = gcIns(model(), undefined, [seed]);
    const r = c.find((x) => x.id.startsWith("rins-"))!;
    expect(r.kind).toBe("insert_snippet");
    expect(r.targetId).toBe("hero");
    expect(r.detail).toBe(seed.text); // ALDRIG trunkerad — exakt-likheten kräver det
    expect(r.sourcePath).toBe("/priser");
    expect(r.proven).toEqual({ provedOnPath: "/priser", variantId: seed.variantId });
    expect(r.score).toBe(REUSE_PROVEN_SCORE);
    // Rang: över varje obevisad kandidat i fixturen...
    const others = c.filter((x) => !x.id.startsWith("rins-"));
    for (const o of others) expect(r.score).toBeGreaterThan(o.score);
    // ...INKLUSIVE prior-TAKET självt (granskningsfynd 2026-08-11: utan
    // gränspinnarna överlevde både 4,2 och 6,5 som poäng): en testimonials-
    // sektion med trust på position 8 når exakt 3+1+0,4 = 4,4 — och fröet
    // står strax över.
    const maxPrior = gcIns(
      model({
        sections: [
          ...model().sections,
          {
            id: "sec-8-proofmax",
            type: "testimonials",
            position: 8,
            heading: "Loved by thousands of happy customers",
            aboveFold: false,
            visualWeight: 3,
            containsTrustSignals: true,
          },
        ],
      }),
      undefined,
      [seed],
    );
    const cap = maxPrior.find((x) => x.id === "mv-sec-8-proofmax")!;
    expect(cap.score).toBeCloseTo(4.4, 10);
    expect(maxPrior.find((x) => x.id.startsWith("rins-"))!.score).toBeGreaterThan(cap.score);
    // ...men under en beteende-ledd flytt STRAX över gränsen: w=0,16 vid
    // golv-n (30) ger 2,5+0,2+40·(30/80)·0,16 = 5,1 > 5 — målsidans egna
    // besökare vinner med minsta marginal, inte bara med bred.
    const behaved = gcIns(
      model(),
      { sectionWeight: { "sec-4-logos": 0.16 }, sectionVisits: { "sec-4-logos": 30 } },
      [seed],
    );
    const hot = behaved.find((x) => x.id === "mv-sec-4-logos")!;
    expect(hot.score).toBeCloseTo(5.1, 10);
    const idx = (id: string) => behaved.findIndex((x) => x.id === id);
    expect(idx("mv-sec-4-logos")).toBeLessThan(
      idx(behaved.find((x) => x.id.startsWith("rins-"))!.id),
    );
  });

  it("återbruk: utan frön byte-identisk katalog; dubblett-text mot sidans egna dedupas", () => {
    expect(gcIns(model(), undefined, [])).toEqual(gcIns(model()));
    // Ett frö vars text redan är en signal på sidan får ALDRIG stå två
    // gånger i menyn (uppströms-vakterna ska ha sållat det — bältet hängslen).
    const plain = gcIns(model());
    const existingInsert = plain.find((x) => x.kind === "insert_snippet")!;
    const dup = gcIns(model(), undefined, [
      {
        variantId: "22222222-bbbb-cccc-dddd-000000000002",
        provedOnPath: "/x",
        sourcePath: "/x",
        text: existingInsert.detail,
      },
    ]);
    expect(dup.filter((x) => x.id.startsWith("rins-"))).toEqual([]);
  });

  it("candidateToOp bär sourcePath för återbruk — validateOps exakta gren kräver den", () => {
    const c = gcIns(model(), undefined, [
      {
        variantId: "33333333-cccc-dddd-eeee-000000000003",
        provedOnPath: "/priser",
        sourcePath: "/priser",
        text: "En bevisad rad som inte finns i fixturens modell",
      },
    ]).find((x) => x.id.startsWith("rins-"))!;
    const op = candidateToOp(c, "why");
    expect(op).toEqual({
      op: "insert_snippet",
      targetId: "hero",
      detail: "En bevisad rad som inte finns i fixturens modell",
      sourcePath: "/priser",
      why: "why",
    });
    // Samma-sida-inserts bär ALDRIG sourcePath (substräng-grenen gäller dem).
    const plainIns = gcIns(model()).find((x) => x.kind === "insert_snippet")!;
    expect("sourcePath" in candidateToOp(plainIns, "w")).toBe(false);
  });

  // ── Flytt-vinnarnas transferform (steg 4) ──────────────────────────────────
  // Kontraktet som skiljer den från textblockens: fröet lägger ALDRIG till en
  // kandidat — det annoterar en som redan fanns i målsidans egen katalog.
  const moveSeed = (over: Partial<{ sectionType: string; alsoWonOn: string[] }> = {}) => ({
    variantId: "55555555-eeee-ffff-0000-000000000005",
    provedOnPath: "/priser",
    sectionType: "testimonials",
    ...over,
  });

  it("flytt-frö: utan frön byte-identisk katalog", () => {
    expect(generateCandidates(model(), undefined, undefined, [])).toEqual(
      generateCandidates(model()),
    );
  });

  it("flytt-frö annoterar målsidans EGEN kandidat — ingen ny rad, ingen importerad text", () => {
    const plain = generateCandidates(model());
    const withSeed = generateCandidates(model(), undefined, undefined, [moveSeed()]);
    expect(withSeed).toHaveLength(plain.length);
    const annotated = withSeed.find((c) => c.id === "mv-sec-3-testimonials")!;
    expect(annotated.targetId).toBe("sec-3-testimonials");
    expect(annotated.detail).toBe("");
    expect(annotated.proven).toEqual({
      provedOnPath: "/priser",
      variantId: "55555555-eeee-ffff-0000-000000000005",
    });
    // Priorn var 4,15 — bevisgolvet lyfter den över alla obevisade priors.
    expect(annotated.score).toBe(REUSE_PROVEN_SCORE);
    // Basis är oförändrad ordagrann sidtext: bevisraden är select.ts jobb.
    expect(annotated.basis).toBe(plain.find((c) => c.id === "mv-sec-3-testimonials")!.basis);
  });

  it("flytt-frö utan matchande kandidat på sidan är en no-op (aldrig fabricering)", () => {
    const plain = generateCandidates(model());
    expect(
      generateCandidates(model(), undefined, undefined, [moveSeed({ sectionType: "faq" })]),
    ).toEqual(plain);
    // Även en typ som FINNS men står över folden (ingen move-kandidat).
    const aboveFold = model({
      sections: model().sections.map((s) =>
        s.id === "sec-3-testimonials" ? { ...s, aboveFold: true } : s,
      ),
    });
    expect(generateCandidates(aboveFold, undefined, undefined, [moveSeed()])).toEqual(
      generateCandidates(aboveFold),
    );
  });

  it("bevisgolvet höjer men SÄNKER aldrig — målsidans heta sektion behåller sin poäng", () => {
    const behavior = {
      sectionWeight: { "sec-3-testimonials": 0.5 },
      sectionVisits: { "sec-3-testimonials": 1000 },
    };
    const hot = generateCandidates(model(), behavior).find(
      (c) => c.id === "mv-sec-3-testimonials",
    )!;
    expect(hot.score).toBeGreaterThan(REUSE_PROVEN_SCORE);
    const seeded = generateCandidates(model(), behavior, undefined, [moveSeed()]).find(
      (c) => c.id === "mv-sec-3-testimonials",
    )!;
    expect(seeded.score).toBe(hot.score);
    expect(seeded.proven).toBeDefined();
  });

  it("flera sektioner av samma typ: bara den STARKASTE annoteras", () => {
    const twoTestimonials = model({
      sections: [
        ...model().sections,
        {
          id: "sec-9-testimonials",
          type: "testimonials",
          position: 9,
          heading: "Fler kundröster",
          aboveFold: false,
          visualWeight: 2,
          containsTrustSignals: true,
        },
      ],
    });
    const out = generateCandidates(twoTestimonials, undefined, undefined, [moveSeed()]);
    const proven = out.filter((c) => c.proven);
    expect(proven).toHaveLength(1);
    // Lika typ + trust ⇒ positionstermen avgör: 0,4 (kapad vid 8) mot 0,15.
    expect(proven[0].id).toBe("mv-sec-9-testimonials");
  });

  it("två frön av samma typklass annoterar bara en gång (första äger)", () => {
    const out = generateCandidates(model(), undefined, undefined, [
      moveSeed(),
      moveSeed({ sectionType: "testimonials" }),
    ]);
    expect(out.filter((c) => c.proven)).toHaveLength(1);
    expect(out.find((c) => c.proven)!.proven!.provedOnPath).toBe("/priser");
  });

  it("meritlistan följer med som alsoProvedOn", () => {
    const out = generateCandidates(model(), undefined, undefined, [
      moveSeed({ alsoWonOn: ["/a", "/b"] }),
    ]);
    expect(out.find((c) => c.proven)!.proven!.alsoProvedOn).toEqual(["/a", "/b"]);
  });

  it("candidateToOp på en bevisad flytt ger en VANLIG move_up-op (ingen sourcePath)", () => {
    const c = generateCandidates(model(), undefined, undefined, [moveSeed()]).find(
      (x) => x.proven,
    )!;
    expect(candidateToOp(c, "why")).toEqual({
      op: "move_up",
      targetId: "sec-3-testimonials",
      detail: "Move this section higher on the page",
      why: "why",
    });
  });

  it("menyns insert-detail bär den städade texten (inte SSR-skarven)", () => {
    const cands = gcIns(
      model({
        trustSignals: [
          {
            type: "trusted_by",
            text: "Trusted by leading startups and companies in Sweden Trusted by leading startups and",
            aboveFold: false,
            section: "body",
          },
        ],
      }),
    );
    const ins = cands.find((c) => c.kind === "insert_snippet")!;
    expect(ins.detail).toBe("Trusted by leading startups and companies in Sweden");
  });
});

// ── Vokabulären (ägarbeslut 2026-08-15: "endast flytta sektioner") ──────────
// Katalogen ignorerade tidigare guardrails.ops helt: den fria designern
// grindades på listan, men KATALOGEN — huvudvägen sedan steg 11 — genererade
// alltid bägge dragformerna. Testerna här låser att listan nu styr bägge, och
// att en breddning är ett medvetet ägarbeslut och inte en refaktorering.
describe("vokabulären styr katalogen", () => {
  it("standardvokabulären är move-only ⇒ menyn innehåller BARA flyttar", () => {
    expect(DEFAULT_CANDIDATE_OPS).toEqual(["move_up"]);
    const c = generateCandidates(model());
    expect(c.length).toBeGreaterThan(0); // fixturen HAR insert-material
    expect(c.every((x) => x.kind === "move_up")).toBe(true);
  });

  it("katalogen och den fria designern läser SAMMA lista", () => {
    // Glider de isär genererar katalogen drag som validateOps sedan slänger
    // (eller tvärtom: designern erbjuds ett drag katalogen aldrig rankar).
    expect([...DEFAULT_CANDIDATE_OPS]).toEqual(DEFAULT_REDESIGN_GUARDRAILS.ops);
  });

  it("insert-maskineriet är AVSTÄNGT, inte borttaget — vokabulären släpper på det", () => {
    const wide = withInsertSnippet(DEFAULT_REDESIGN_GUARDRAILS);
    const c = generateCandidates(model(), undefined, undefined, undefined, wide.ops);
    expect(c.some((x) => x.kind === "insert_snippet")).toBe(true);
    // ...och flyttarna är BYTE-IDENTISKA med move-only-menyn: att slå på
    // texten LÄGGER TILL kandidater, den rör aldrig de befintliga.
    expect(c.filter((x) => x.kind === "move_up")).toEqual(generateCandidates(model()));
  });

  it("TEXT-återbruket tystnar med move-only; FLYTT-återbruket lever kvar", () => {
    // Priset ägaren betalar, utskrivet: ett bevisat textblock erbjuds inte
    // längre (blockbibliotekets steg 2–3), medan flytt-transferformen från
    // steg 4 annoterar precis som förut.
    const textSeed = {
      variantId: "66666666-ffff-0000-1111-000000000006",
      provedOnPath: "/priser",
      sourcePath: "/priser",
      text: "En bevisad rad som inte finns i fixturens modell",
    };
    expect(generateCandidates(model(), undefined, [textSeed])).toEqual(generateCandidates(model()));
    const moved = generateCandidates(model(), undefined, undefined, [
      {
        variantId: "77777777-0000-1111-2222-000000000007",
        provedOnPath: "/x",
        sectionType: "logos",
      },
    ]);
    expect(moved.find((x) => x.id === "mv-sec-4-logos")!.proven).toEqual({
      provedOnPath: "/x",
      variantId: "77777777-0000-1111-2222-000000000007",
    });
  });
});
