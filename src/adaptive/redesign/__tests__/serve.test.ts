import { describe, it, expect } from "vitest";

import type { RedesignOp } from "../generate";
import {
  visitorSegmentKey,
  isSegmentPrefix,
  matchVariant,
  rampBucket,
  serveDecision,
  type ServableVariant,
  type ServeOp,
  type VariantStatus,
} from "../serve";

const ops: RedesignOp[] = [{ op: "move_up", targetId: "sec-testi", detail: "", why: "" }];

const variant = (
  segmentKey: string,
  status: VariantStatus = "serving",
  over: Partial<ServableVariant> = {},
): ServableVariant => ({
  id: `v-${segmentKey}-${status}`,
  site: "acme",
  path: "/",
  segmentKey,
  status,
  ops,
  ...over,
});

const visitor = (
  channel: string | null,
  device: string | null,
  country: string | null,
  isReturning = false,
  over: { site?: string; path?: string } = {},
) => ({
  site: over.site ?? "acme",
  path: over.path ?? "/",
  segment: { channel, device, country, isReturning },
});

describe("visitorSegmentKey — matches the dashboard rollup format", () => {
  it("builds channel·device·country·returning, coarse→fine", () => {
    expect(
      visitorSegmentKey({ channel: "google", device: "mobile", country: "se", isReturning: false }),
    ).toBe("google·mobile·se·ny");
    expect(
      visitorSegmentKey({
        channel: "instagram",
        device: "mobile",
        country: "SE",
        isReturning: true,
      }),
    ).toBe("instagram·mobile·SE·återkommande");
  });

  it("uses the honest 'okänd' bucket for missing dimensions (never fabricates)", () => {
    expect(
      visitorSegmentKey({ channel: null, device: "", country: "us", isReturning: false }),
    ).toBe("okänd·okänd·us·ny");
  });
});

describe("isSegmentPrefix — dimension-wise, not string-wise", () => {
  it("matches whole-token prefixes only", () => {
    expect(isSegmentPrefix("google", "google·mobile·se·ny")).toBe(true);
    expect(isSegmentPrefix("google·mobile", "google·mobile·se·ny")).toBe(true);
    expect(isSegmentPrefix("google·mobile·se·ny", "google·mobile·se·ny")).toBe(true);
  });
  it("does not treat a partial token as a prefix", () => {
    expect(isSegmentPrefix("goo", "google·mobile·se·ny")).toBe(false);
    expect(isSegmentPrefix("google·mob", "google·mobile·se·ny")).toBe(false);
  });
  it("rejects a longer or divergent key", () => {
    expect(isSegmentPrefix("google·mobile·se·ny·extra", "google·mobile·se·ny")).toBe(false);
    expect(isSegmentPrefix("facebook", "google·mobile·se·ny")).toBe(false);
  });
});

describe("matchVariant — finest verified variant wins", () => {
  it("serves the finest (longest-prefix) matching variant", () => {
    const vs = [variant("google"), variant("google·mobile"), variant("google·mobile·se")];
    const m = matchVariant(vs, visitor("google", "mobile", "se"));
    expect(m?.segmentKey).toBe("google·mobile·se");
  });

  it("borrows strength: a coarse variant serves when no fine one exists", () => {
    const vs = [variant("google")];
    expect(matchVariant(vs, visitor("google", "mobile", "se"))?.segmentKey).toBe("google");
  });

  it("returns null when no variant's segment matches the visitor", () => {
    const vs = [variant("google·mobile")];
    expect(matchVariant(vs, visitor("facebook", "mobile", "se"))).toBeNull();
    expect(matchVariant(vs, visitor("google", "desktop", "se"))).toBeNull();
  });

  it("winner serveras till 100 % — ägarens knapp ÄR beslutet att sluta mäta", () => {
    const v = variant("google", "winner", { serveOps });
    // Alla besökare, oavsett ramp-bucket, hamnar i variant-armen.
    for (const vh of ["a", "b", "c", "visitor-42", "xyz"]) {
      const verdict = serveDecision(
        { servingEnabled: true, rampPct: 5 },
        [v],
        visitor("google", "mobile", "se"),
        vh,
      );
      expect(verdict?.arm).toBe("variant");
    }
    // …medan en 'serving'-variant med samma besökare fortfarande ramp-delas.
    const s = variant("google", "serving", { serveOps });
    const arms = new Set(
      ["a", "b", "c", "visitor-42", "xyz"].map(
        (vh) =>
          serveDecision(
            { servingEnabled: true, rampPct: 5 },
            [s],
            visitor("google", "mobile", "se"),
            vh,
          )?.arm,
      ),
    );
    expect(arms.has("control")).toBe(true);
  });

  it("only serves 'serving' / 'winner' — never candidate/verified/retired", () => {
    for (const status of ["candidate", "verified", "retired"] as VariantStatus[]) {
      expect(
        matchVariant([variant("google", status)], visitor("google", "mobile", "se")),
      ).toBeNull();
    }
    expect(
      matchVariant([variant("google", "winner")], visitor("google", "mobile", "se"))?.status,
    ).toBe("winner");
  });

  it("scopes to the visitor's site and path", () => {
    const vs = [variant("google", "serving", { path: "/pricing" })];
    expect(matchVariant(vs, visitor("google", "mobile", "se"))).toBeNull(); // path "/" ≠ "/pricing"
    expect(
      matchVariant(vs, visitor("google", "mobile", "se", false, { path: "/pricing" }))?.segmentKey,
    ).toBe("google");
    const other = [variant("google", "serving", { site: "other" })];
    expect(matchVariant(other, visitor("google", "mobile", "se"))).toBeNull();
  });

  it("is deterministic when two variants tie on depth (id tiebreak)", () => {
    const a = variant("google·mobile", "serving", { id: "aaa" });
    const b = variant("google·mobile", "serving", { id: "bbb" });
    expect(matchVariant([b, a], visitor("google", "mobile", "se"))?.id).toBe("aaa");
    expect(matchVariant([a, b], visitor("google", "mobile", "se"))?.id).toBe("aaa");
  });

  it("matches a returning-visitor's finest key incl. the returning dimension", () => {
    const vs = [variant("google·mobile·se"), variant("google·mobile·se·återkommande")];
    expect(matchVariant(vs, visitor("google", "mobile", "se", true))?.segmentKey).toBe(
      "google·mobile·se·återkommande",
    );
    // a NEW visitor doesn't match the returning-only fine variant → falls back to coarser
    expect(matchVariant(vs, visitor("google", "mobile", "se", false))?.segmentKey).toBe(
      "google·mobile·se",
    );
  });
});

// ── steg 3: ramp + armval ────────────────────────────────────────────────────

const serveOps: ServeOp[] = [
  { op: "move_up", locator: { text: "People ❤️ Plausible" }, why: "proof before ask" },
  { op: "set_text", locator: { tag: "h1", text: "Easy to use" }, value: "New verified headline" },
];

const servable = (over: Partial<ServableVariant> = {}) =>
  variant("google", "serving", { serveOps, ...over });

const CFG = { servingEnabled: true, rampPct: 5 };

describe("rampBucket — deterministic, variant-salted", () => {
  it("is stable for the same visitor+variant and spans 0..99", () => {
    for (const vh of ["a", "visitor-123", "xyz"]) {
      const b = rampBucket(vh, "var-1");
      expect(b).toBe(rampBucket(vh, "var-1"));
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it("decorrelates buckets between variants (salt = variant id)", () => {
    const hashes = Array.from({ length: 200 }, (_, i) => `visitor-${i}`);
    const same = hashes.filter((vh) => rampBucket(vh, "var-a") === rampBucket(vh, "var-b")).length;
    expect(same).toBeLessThan(hashes.length / 4); // oberoende ⇒ ~1 % kollision
  });

  it("splits roughly rampPct/rest over many visitors", () => {
    const hashes = Array.from({ length: 2000 }, (_, i) => `v${i}`);
    const inArm = hashes.filter((vh) => rampBucket(vh, "var-1") < 5).length;
    expect(inArm).toBeGreaterThan(2000 * 0.02);
    expect(inArm).toBeLessThan(2000 * 0.1);
  });
});

describe("serveDecision — the owner's cautious-v1 rules, fail closed", () => {
  it("serves nothing when the master switch is off", () => {
    expect(
      serveDecision(
        { ...CFG, servingEnabled: false },
        [servable()],
        visitor("google", "mobile", "se"),
        "vh",
      ),
    ).toBeNull();
  });

  it("serves nothing without a visitorHash (no stable arm ⇒ no measurement)", () => {
    expect(serveDecision(CFG, [servable()], visitor("google", "mobile", "se"), "")).toBeNull();
    expect(serveDecision(CFG, [servable()], visitor("google", "mobile", "se"), null)).toBeNull();
  });

  it("serves nothing when no variant matches the segment", () => {
    expect(serveDecision(CFG, [servable()], visitor("facebook", "mobile", "se"), "vh")).toBeNull();
  });

  it("fail closed: a match without valid serveOps never serves", () => {
    expect(
      serveDecision(CFG, [servable({ serveOps: [] })], visitor("google", "mobile", "se"), "vh"),
    ).toBeNull();
    expect(
      serveDecision(
        CFG,
        [servable({ serveOps: undefined })],
        visitor("google", "mobile", "se"),
        "vh",
      ),
    ).toBeNull();
    // set_text utan value, okänt verb, tom lokator — allt diskvalificerar HELA varianten
    const bad: ServeOp[][] = [
      [{ op: "set_text", locator: { text: "x" } }],
      [{ op: "reveal" as ServeOp["op"], locator: { text: "x" } }],
      [{ op: "move_up", locator: { text: "  " } }],
      [serveOps[0], { op: "set_text", locator: { text: "x" } }],
    ];
    for (const ops of bad) {
      expect(
        serveDecision(CFG, [servable({ serveOps: ops })], visitor("google", "mobile", "se"), "vh"),
      ).toBeNull();
    }
  });

  it("assigns ~rampPct% to the variant arm, deterministically per visitor", () => {
    const vs = [servable()];
    const hashes = Array.from({ length: 1000 }, (_, i) => `visitor-${i}`);
    const arms = hashes.map(
      (vh) => serveDecision(CFG, vs, visitor("google", "mobile", "se"), vh)!.arm,
    );
    const inVariant = arms.filter((a) => a === "variant").length;
    expect(inVariant).toBeGreaterThan(10); // ~50 av 1000 vid 5 %
    expect(inVariant).toBeLessThan(120);
    // deterministiskt: samma besökare får samma arm igen
    hashes.forEach((vh, i) => {
      expect(serveDecision(CFG, vs, visitor("google", "mobile", "se"), vh)!.arm).toBe(arms[i]);
    });
  });

  it("a higher ramp widens the variant arm (5 → 50)", () => {
    const vs = [servable()];
    const hashes = Array.from({ length: 1000 }, (_, i) => `visitor-${i}`);
    const at = (rampPct: number) =>
      hashes.filter(
        (vh) =>
          serveDecision({ ...CFG, rampPct }, vs, visitor("google", "mobile", "se"), vh)!.arm ===
          "variant",
      ).length;
    expect(at(50)).toBeGreaterThan(at(5));
    expect(at(50)).toBeGreaterThan(400);
    expect(at(50)).toBeLessThan(600);
  });

  it("clamps a mis-set ramp into 1..50 (never a 100 % rollout)", () => {
    const vs = [servable()];
    const hashes = Array.from({ length: 400 }, (_, i) => `v${i}`);
    const armsAt100 = hashes.filter(
      (vh) =>
        serveDecision({ ...CFG, rampPct: 100 }, vs, visitor("google", "mobile", "se"), vh)!.arm ===
        "variant",
    ).length;
    expect(armsAt100).toBeLessThan(300); // klampat till 50 % — aldrig alla
  });

  it("still picks the FINEST matching variant (matchVariant semantics ride along)", () => {
    const coarse = servable({ id: "coarse" });
    const fine = variant("google·mobile·se", "serving", { id: "fine", serveOps });
    const verdict = serveDecision(CFG, [coarse, fine], visitor("google", "mobile", "se"), "vh");
    expect(verdict?.variant.id).toBe("fine");
  });
});

describe("serveDecision — insert_snippet (korssid-lyftet, task #117)", () => {
  const insertOps: ServeOp[] = [
    {
      op: "insert_snippet",
      locator: { tag: "h1", text: "Easy to use" },
      value: "Från 99 kr/mån — alla funktioner ingår.",
      why: "segmentet söker pris",
    },
  ];

  it("serves a variant whose insert op carries a locator + verbatim text", () => {
    const v = serveDecision(
      { servingEnabled: true, rampPct: 50 },
      [servable({ serveOps: insertOps })],
      visitor("google", "mobile", "se"),
      "vh-in-arm-1",
    );
    expect(v).not.toBeNull();
  });

  it("fail closed: an insert op without text never serves", () => {
    const bad: ServeOp[] = [
      { op: "insert_snippet", locator: { tag: "h1", text: "Easy to use" }, value: "  " },
    ];
    expect(
      serveDecision(CFG, [servable({ serveOps: bad })], visitor("google", "mobile", "se"), "vh"),
    ).toBeNull();
  });
});

describe("serveDecision — insert_snippet med klickväg + stil-donator (slice 4)", () => {
  const linked = (href: string, styleClass?: string): ServeOp[] => [
    {
      op: "insert_snippet",
      locator: { tag: "h1", text: "Easy to use" },
      value: "Låt oss ge dig en offert",
      href,
      ...(styleClass !== undefined ? { styleClass } : {}),
    },
  ];
  const decide = (ops: ServeOp[]) =>
    serveDecision(
      { servingEnabled: true, rampPct: 50 },
      [servable({ serveOps: ops })],
      visitor("google", "mobile", "se"),
      "vh-in-arm-1",
    );

  it("serves a valid same-site path with a sane donor class", () => {
    expect(decide(linked("/sv/pricing", "t-text-s"))).not.toBeNull();
    expect(decide(linked("/priser"))).not.toBeNull();
  });

  it("fail closed: external, protocol or malformed hrefs never serve", () => {
    expect(decide(linked("https://ond.example/phish"))).toBeNull();
    expect(decide(linked("//ond.example"))).toBeNull();
    expect(decide(linked("javascript:alert(1)"))).toBeNull();
    expect(decide(linked("/har mellanslag"))).toBeNull();
  });

  it("fail closed: a suspicious styleClass disqualifies the variant", () => {
    expect(decide(linked("/priser", 'x" onmouseover="alert(1)'))).toBeNull();
  });
});

describe("kohortscopade varianter (E4b-kopplingen)", () => {
  const cfg = { servingEnabled: true, rampPct: 5 };
  const li = { ...visitor("linkedin", "mobile", "se"), cohorts: ["ch:social", "src:linkedin", "ret:new"] };
  const direct = { ...visitor("linkedin", "mobile", "se"), cohorts: ["ch:direct", "ret:new"] };

  it("serverar när besökarens nycklar täcker kravet (OCH-semantik)", () => {
    const v = variant("linkedin", "winner", { serveOps, requiredCohorts: ["src:linkedin"] });
    expect(serveDecision(cfg, [v], li, "vh-1")?.arm).toBe("variant");
  });

  it("hoppar över kohortscopad variant när kravet inte täcks — ingen servering", () => {
    const v = variant("linkedin", "winner", { serveOps, requiredCohorts: ["src:linkedin", "seen:pricing"] });
    expect(serveDecision(cfg, [v], li, "vh-1")).toBeNull();
  });

  it("faller till grövre oscopad variant när den scopade inte matchar", () => {
    const scoped = variant("linkedin·mobile", "winner", { serveOps, requiredCohorts: ["src:linkedin"] });
    const coarse = variant("linkedin", "winner", { serveOps });
    expect(serveDecision(cfg, [scoped, coarse], direct, "vh-1")?.variant.segmentKey).toBe("linkedin");
    // …och den scopade vinner (finaste matchning) när kravet täcks.
    expect(serveDecision(cfg, [scoped, coarse], li, "vh-1")?.variant.segmentKey).toBe("linkedin·mobile");
  });

  it("tomt/frånvarande krav grindar ingenting", () => {
    const v = variant("linkedin", "winner", { serveOps, requiredCohorts: [] });
    expect(serveDecision(cfg, [v], direct, "vh-1")?.arm).toBe("variant");
  });
});
