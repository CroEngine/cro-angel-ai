import { describe, it, expect } from "vitest";

import type { RedesignOp } from "../generate";
import {
  visitorSegmentKey,
  isSegmentPrefix,
  matchVariant,
  type ServableVariant,
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
    expect(visitorSegmentKey({ channel: "google", device: "mobile", country: "se", isReturning: false })).toBe(
      "google·mobile·se·ny",
    );
    expect(visitorSegmentKey({ channel: "instagram", device: "mobile", country: "SE", isReturning: true })).toBe(
      "instagram·mobile·SE·återkommande",
    );
  });

  it("uses the honest 'okänd' bucket for missing dimensions (never fabricates)", () => {
    expect(visitorSegmentKey({ channel: null, device: "", country: "us", isReturning: false })).toBe(
      "okänd·okänd·us·ny",
    );
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

  it("only serves 'serving' / 'winner' — never candidate/verified/retired", () => {
    for (const status of ["candidate", "verified", "retired"] as VariantStatus[]) {
      expect(matchVariant([variant("google", status)], visitor("google", "mobile", "se"))).toBeNull();
    }
    expect(matchVariant([variant("google", "winner")], visitor("google", "mobile", "se"))?.status).toBe("winner");
  });

  it("scopes to the visitor's site and path", () => {
    const vs = [variant("google", "serving", { path: "/pricing" })];
    expect(matchVariant(vs, visitor("google", "mobile", "se"))).toBeNull(); // path "/" ≠ "/pricing"
    expect(matchVariant(vs, visitor("google", "mobile", "se", false, { path: "/pricing" }))?.segmentKey).toBe(
      "google",
    );
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
    expect(matchVariant(vs, visitor("google", "mobile", "se", false))?.segmentKey).toBe("google·mobile·se");
  });
});
