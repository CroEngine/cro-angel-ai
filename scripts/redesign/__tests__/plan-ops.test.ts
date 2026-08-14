// Fail-closed-reglerna i plan→ops-mapparna. De här kontrakten fanns redan —
// de gick bara inte att nå utan att starta Chromium (auto-generate.ts läser
// plans.json och startar webbläsaren i modulkroppen), så det enda testet som
// rörde dem skippade helt på en maskin utan browser. Efter extraktionen
// (städsvepet 2026-08-14) testas de för vad de är: rena funktioner.
import { describe, expect, it } from "vitest";

import {
  heroLocatorFor,
  locatorFor,
  proofInsertFallback,
  toMeasureOps,
  toServeOps,
} from "../plan-ops";

import type { RedesignContentModel } from "../../../src/adaptive/redesign/context";
import type { RedesignOp } from "../../../src/adaptive/redesign/generate";

const model = (over: Partial<RedesignContentModel> = {}): RedesignContentModel => ({
  sections: [
    {
      id: "sec-1-hero",
      type: "hero",
      position: 1,
      heading: "Kom igång på en minut",
      aboveFold: true,
      visualWeight: 5,
    },
    {
      id: "sec-3-testimonials",
      type: "testimonials",
      position: 3,
      heading: "4,9/5 i betyg från 12 000 kunder",
      aboveFold: false,
      visualWeight: 3,
    },
  ],
  trustSignals: [],
  ctas: [],
  hero: { headline: "Kom igång på en minut" },
  ...over,
});

const op = (o: Partial<RedesignOp> & { op: RedesignOp["op"] }): RedesignOp => ({
  targetId: "sec-3-testimonials",
  detail: "",
  why: "w",
  ...o,
});

describe("locatorFor / heroLocatorFor", () => {
  it("hjälten bor i h1, allt annat i h2 — samma struktur extract.ts läste", () => {
    expect(locatorFor(model(), "sec-1-hero")).toEqual({ tag: "h1", text: "Kom igång på en minut" });
    expect(locatorFor(model(), "sec-3-testimonials")).toEqual({
      tag: "h2",
      text: "4,9/5 i betyg från 12 000 kunder",
    });
  });

  it("okänd sektion eller sektion utan rubrik ⇒ null (ingen gissad lokator)", () => {
    expect(locatorFor(model(), "sec-9-finns-inte")).toBeNull();
    const headless = model({
      sections: [
        // heading är obligatorisk i modellen — tom sträng ÄR "saknar rubrik"
        // för locatorFor (som testar falsighet), inte ett utelämnat fält.
        {
          id: "sec-2-logos",
          type: "logos",
          position: 2,
          heading: "",
          aboveFold: false,
          visualWeight: 1,
        },
      ],
    });
    expect(locatorFor(headless, "sec-2-logos")).toBeNull();
  });

  it("hjälte-lokatorn faller tillbaka på hero.headline när hjältesektionen saknas", () => {
    expect(heroLocatorFor(model())).toEqual({ tag: "h1", text: "Kom igång på en minut" });
    const noHeroSection = model({ sections: model().sections.slice(1) });
    expect(heroLocatorFor(noHeroSection)).toEqual({ tag: "h1", text: "Kom igång på en minut" });
    expect(heroLocatorFor(model({ sections: [], hero: undefined }))).toBeNull();
  });
});

describe("toMeasureOps — omätbart ⇒ null, aldrig omtolkat", () => {
  it("flytt och omtextning får sin lokator", () => {
    expect(toMeasureOps(model(), [op({ op: "move_up" })], null)).toEqual([
      { op: "move_up", tag: "h2", find: "4,9/5 i betyg från 12 000 kunder" },
    ]);
    expect(toMeasureOps(model(), [op({ op: "set_text", detail: "Ny rubrik" })], null)).toEqual([
      { op: "set_text", tag: "h2", find: "4,9/5 i betyg från 12 000 kunder", set: "Ny rubrik" },
    ]);
  });

  it("insert ankras till hjälten och bär källa/stil/placering när de finns", () => {
    const ops = [
      op({
        op: "insert_snippet",
        targetId: "hero",
        detail: "Från 299 kr",
        sourcePath: "/priser",
        placement: "after_h1",
      }),
    ];
    expect(toMeasureOps(model(), ops, "link-primary")).toEqual([
      {
        op: "insert_snippet",
        tag: "h1",
        find: "Kom igång på en minut",
        set: "Från 299 kr",
        href: "/priser",
        styleClass: "link-primary",
        placement: "after_h1",
      },
    ]);
  });

  it("condense/reveal mäts ALDRIG som något annat (granskningsfynd 2026-07-28)", () => {
    // De föll förr igenom till set_text, klarade grindarna, och dog först som
    // no_serve_ops utan orsak. En semantik: omätbart ⇒ null.
    expect(toMeasureOps(model(), [op({ op: "condense" })], null)).toBeNull();
    expect(toMeasureOps(model(), [op({ op: "reveal" })], null)).toBeNull();
  });

  it("EN olöslig lokator fäller HELA planen — aldrig en halv applicering", () => {
    const ops = [op({ op: "move_up" }), op({ op: "move_up", targetId: "sec-9-finns-inte" })];
    expect(toMeasureOps(model(), ops, null)).toBeNull();
  });
});

describe("proofInsertFallback — substanskravet", () => {
  it("lyfter målsektionens rubrik när den SJÄLV bär bevis (en siffra)", () => {
    const out = proofInsertFallback(model(), [op({ op: "move_up" })])!;
    expect(out[0]).toMatchObject({
      op: "insert_snippet",
      targetId: "hero",
      detail: "4,9/5 i betyg från 12 000 kunder",
    });
    expect(out[0].why).toContain("verbatim");
  });

  it("en rubrik utan siffra är en LOVNAD, inte bevis — ingen fallback (ägarfynd fikajobs)", () => {
    const promise = model({
      sections: [
        model().sections[0],
        {
          id: "sec-3-testimonials",
          type: "testimonials",
          position: 3,
          heading: "People love Fika. Here's what they say.",
          aboveFold: false,
          visualWeight: 3,
        },
      ],
    });
    expect(proofInsertFallback(promise, [op({ op: "move_up" })])).toBeNull();
  });

  it("faller tillbaka på en trust-signal — städad, aldrig med UI-brus", () => {
    const withSignal = model({
      sections: [
        model().sections[0],
        {
          id: "sec-3-testimonials",
          type: "testimonials",
          position: 3,
          heading: "Vad kunderna säger",
          aboveFold: false,
          visualWeight: 3,
        },
      ],
      trustSignals: [
        {
          type: "trusted_by",
          text: "Trusted by the world's best 0:30 Product overview Play video",
          aboveFold: false,
          section: "body",
        },
      ],
    });
    const out = proofInsertFallback(withSignal, [op({ op: "move_up" })])!;
    expect(out[0].detail).toBe("Trusted by the world's best");
  });

  it("ingen flytt att ersätta, eller redan en insert i planen ⇒ null", () => {
    expect(proofInsertFallback(model(), [op({ op: "set_text", detail: "x" })])).toBeNull();
    expect(
      proofInsertFallback(model(), [
        op({ op: "move_up" }),
        op({ op: "insert_snippet", targetId: "hero", detail: "redan här" }),
      ]),
    ).toBeNull();
  });

  it("behåller planens icke-flytt-ops efter den insatta raden", () => {
    const out = proofInsertFallback(model(), [
      op({ op: "move_up" }),
      op({ op: "set_text", detail: "Ny rubrik" }),
    ])!;
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ op: "set_text", detail: "Ny rubrik" });
  });
});

describe("toServeOps — fail closed", () => {
  it("servar flytt, omtextning och insert med verifierad placering", () => {
    const ops = [
      op({ op: "move_up" }),
      op({
        op: "insert_snippet",
        targetId: "hero",
        detail: "Från 299 kr",
        sourcePath: "/priser",
        placement: "after_h1",
      }),
    ];
    expect(toServeOps(model(), ops, "link-primary")).toEqual([
      { op: "move_up", locator: { tag: "h2", text: "4,9/5 i betyg från 12 000 kunder" }, why: "w" },
      {
        op: "insert_snippet",
        locator: { tag: "h1", text: "Kom igång på en minut" },
        value: "Från 299 kr",
        href: "/priser",
        styleClass: "link-primary",
        placement: "after_h1",
        why: "w",
      },
    ]);
  });

  it("condense/reveal har ingen serve-form i v1 ⇒ null för hela planen", () => {
    expect(toServeOps(model(), [op({ op: "condense" })])).toBeNull();
    expect(toServeOps(model(), [op({ op: "move_up" }), op({ op: "reveal" })])).toBeNull();
  });

  it("olöslig lokator ⇒ null — hellre ingen servning än en halv", () => {
    expect(toServeOps(model(), [op({ op: "move_up", targetId: "sec-9-finns-inte" })])).toBeNull();
    expect(
      toServeOps(model({ sections: [], hero: undefined }), [
        op({ op: "insert_snippet", targetId: "hero", detail: "x" }),
      ]),
    ).toBeNull();
  });

  it("utan stil-donator bär den servade raden ingen styleClass", () => {
    const [served] = toServeOps(model(), [
      op({ op: "insert_snippet", targetId: "hero", detail: "Från 299 kr" }),
    ])!;
    expect("styleClass" in served).toBe(false);
    expect("href" in served).toBe(false);
  });
});
