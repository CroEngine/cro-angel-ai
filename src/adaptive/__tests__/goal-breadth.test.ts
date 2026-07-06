// Bredd-regression för målklassificeringen: 20 riktiga sajter, 120 riktiga
// CTA-etiketter, alla måltyper. Fixturerna kommer från server-renderad HTML
// (107-sajters-harvesten), extraherade + adversariellt verifierade per sajt
// och därefter triagerade mot det deterministiska golvet — expects uttrycker
// TAXONOMINS beslut, inte agenternas gissningar (t.ex. tel: → lead, teckna →
// purchase). Sex sajter refuserades ärligt (bot-block/SPA-skal) och ligger
// dokumenterade i fixturfilen: statisk HTML räcker inte där — det är
// freeze-pipelinens jobb.
//
// Två nivåer per sajt:
//   1. Per-CTA: label+href med entydig avsikt måste klassas till exakt kind.
//   2. Sajtgolv: rankGoalCandidates över sajtens alla CTA:er måste innehålla
//      minst en kandidat av sajtens förväntade konverteringsmotion(er).
//
// När en ny marknad/vertikal ger fel här: utöka KIND_TEXT/KIND_HREF med
// ≥2-sajters bevis (samma ribba som corpus/vocab-harvest-2026-07-06.json),
// eller rätta fixturen om taxonomin har rätt — aldrig tvärtom utan bevis.

import { describe, it, expect } from "vitest";

import fixtures from "../__fixtures__/breadth-goal-fixtures.json";
import { classifyGoalKind, rankGoalCandidates } from "../crawler-inventory";
import type { ContentInventory } from "../types";

interface FixtureCta {
  text: string;
  href?: string;
  expect?: string;
}
interface SiteFixture {
  domain: string;
  ok: boolean;
  businessType: string;
  expectedSiteKinds: string[];
  ctas: FixtureCta[];
  notes?: string;
}

const sites = (fixtures as { sites: SiteFixture[] }).sites.filter((s) => s.ok);

describe("goal breadth — 20 real sites, every conversion kind", () => {
  it("fixture sanity: 20 sites, all ok, every site has CTAs", () => {
    expect(sites.length).toBe(20);
    for (const s of sites) expect(s.ctas.length).toBeGreaterThan(0);
  });

  for (const site of sites) {
    describe(site.domain, () => {
      const withExpect = site.ctas.filter((c) => c.expect);
      for (const cta of withExpect) {
        it(`"${cta.text}" → ${cta.expect}`, () => {
          expect(classifyGoalKind(cta.text, cta.href, site.domain)).toBe(cta.expect);
        });
      }

      it(`site floor proposes one of [${site.expectedSiteKinds.join(", ")}]`, () => {
        const inv = {
          site: site.domain,
          slots: {
            cta: site.ctas.map((c, i) => ({
              id: `c${i}`,
              slot: "cta" as const,
              text: c.text,
              selector: `#c${i}`,
              meta: {
                aboveFold: i < 3 ? "true" : "false",
                category: "cta_primary",
                elementIntent: "conversion",
                ...(c.href ? { href: c.href } : {}),
              },
            })),
          },
        } as unknown as ContentInventory;
        const kinds = rankGoalCandidates(inv, site.domain).map((g) => g.kind as string);
        const hit = site.expectedSiteKinds.some((k) => kinds.includes(k));
        expect(
          hit,
          `${site.domain} (${site.businessType}): expected one of [${site.expectedSiteKinds.join(", ")}], got [${kinds.join(", ")}]`,
        ).toBe(true);
      });
    });
  }
});
