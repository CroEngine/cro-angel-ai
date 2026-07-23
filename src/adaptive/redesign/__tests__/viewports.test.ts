import { describe, it, expect } from "vitest";

import { viewportsForSegmentKey, MOBILE_VIEWPORT, DESKTOP_VIEWPORT } from "../viewports";

describe("viewportsForSegmentKey — which viewports must gate a variant", () => {
  it("mobile-pinned segment gates mobile only", () => {
    expect(viewportsForSegmentKey("google·mobile·se·ny")).toEqual([MOBILE_VIEWPORT]);
    expect(viewportsForSegmentKey("google·mobile")).toEqual([MOBILE_VIEWPORT]);
  });

  it("desktop-pinned segment gates desktop only", () => {
    expect(viewportsForSegmentKey("google·desktop·se·ny")).toEqual([DESKTOP_VIEWPORT]);
  });

  it("a COARSE segment (no device dimension) gates BOTH — it serves every device", () => {
    expect(viewportsForSegmentKey("google")).toEqual([MOBILE_VIEWPORT, DESKTOP_VIEWPORT]);
  });

  it("tablet and unknown devices gate both extremes (no tablet standard exists)", () => {
    expect(viewportsForSegmentKey("google·tablet·se·ny")).toEqual([
      MOBILE_VIEWPORT,
      DESKTOP_VIEWPORT,
    ]);
    expect(viewportsForSegmentKey("google·okänd·se·ny")).toEqual([
      MOBILE_VIEWPORT,
      DESKTOP_VIEWPORT,
    ]);
  });

  it("the canonical viewport (index 0) is mobile whenever mobile is gated", () => {
    expect(viewportsForSegmentKey("direct")[0]).toBe(MOBILE_VIEWPORT);
  });
});
