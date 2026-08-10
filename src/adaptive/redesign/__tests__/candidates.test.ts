// Kandidatkatalogens kontrakt: lagliga drag ur modellen, deterministisk
// ordning, ordagranna texter, aldrig hjälten som flyttmål, dedup.
import { describe, it, expect } from "vitest";

import {
  BEHAVIOR_GAIN,
  BEHAVIOR_SHRINK_N0,
  generateCandidates,
  candidateToOp,
  floorWhy,
  tidySignalText,
} from "../candidates";
import type { RedesignContentModel } from "../context";

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
  it("genererar flytt för bevissektioner men aldrig hjälten eller features utan proof", () => {
    const c = generateCandidates(model());
    const moves = c.filter((x) => x.kind === "move_up").map((x) => x.targetId);
    expect(moves).toContain("sec-3-testimonials");
    expect(moves).toContain("sec-4-logos");
    expect(moves).not.toContain("sec-1-hero");
    expect(moves).not.toContain("sec-2-features");
  });

  it("testimonials med proof rankas över logos; trusted_by över compliance", () => {
    const c = generateCandidates(model());
    const idx = (id: string) => c.findIndex((x) => x.id === id);
    expect(idx("mv-sec-3-testimonials")).toBeLessThan(idx("mv-sec-4-logos"));
    const tb = c.find((x) => x.id.startsWith("ins-trusted_by"))!;
    const comp = c.find((x) => x.id.startsWith("ins-compliance"))!;
    expect(tb.score).toBeGreaterThan(comp.score);
  });

  it("dedupar identiska texter och filtrerar för korta signaler", () => {
    const c = generateCandidates(model());
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
    const c = generateCandidates(model());
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
    expect(
      generateCandidates(model(), { sectionWeight: { "sec-4-logos": 0.9 }, gain: 0 }),
    ).toEqual(plain);
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
    const c = generateCandidates(model(), { sectionWeight: { "sec-4-logos": 0.8 } });
    const hot = c.find((x) => x.id === "insh-sec-4-logos")!;
    const cold = c.find((x) => x.id === "insh-sec-3-testimonials")!;
    expect(hot.score).toBeGreaterThan(cold.score);
    expect(hot.score).toBeCloseTo(2.5 * 0.6 + BEHAVIOR_GAIN * 0.8, 10);
  });

  it("trust-signal-inserts: körsektionens vikt räknas bara när sektionen finns", () => {
    // section:"body" är ingen riktig sektion ⇒ neutral term (som idag)...
    const plainTb = generateCandidates(model()).find((x) => x.id.startsWith("ins-trusted_by"))!;
    const stillTb = generateCandidates(model(), {
      sectionWeight: { "sec-4-logos": 0.8 },
    }).find((x) => x.id.startsWith("ins-trusted_by"))!;
    expect(stillTb.score).toBe(plainTb.score);
    // ...men en signal extraktionen KAN sektionsbinda får sin sektions term.
    const bound = generateCandidates(
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

  it("menyns insert-detail bär den städade texten (inte SSR-skarven)", () => {
    const cands = generateCandidates(
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
