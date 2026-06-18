// F3 — classifyFailure: skilj äkta font-embed-fel från miljö-blockerad font-egress.
//
// När A2-gaten kastar (externalFontSrcCount > 0 efter rewrite) kan orsaken vara
// (a) sajten/fonten — äkta font-embed-failed, eller (b) en proxy som blockar
// font-CDN-egress i capture-miljön. Kontrollproberna (positiv gstatic-woff2)
// diskriminerar: positiv != "ok" ⇒ miljön blockar. Detta test pinnar grenen.
//
// Rent enhetstest — ingen Browserbase, ingen fetch. classifyFailure är en ren
// funktion exporterad just för detta.

import { describe, it, expect } from "vitest";
import { classifyFailure } from "../freeze.server";
import type { ControlProbeResult } from "../mhtml-fonts.server";

function probe(outcome: ControlProbeResult["outcome"]): ControlProbeResult {
  return { url: "https://probe", kind: "positive", outcome, bytes: 0, durationMs: 0 };
}

// Minimal report med bara de fält classifyFailure läser (capture.controlProbes,
// captureValidity). Cast — vi testar klassificeraren, inte hela rapporten.
function reportWith(
  positiveOutcome?: ControlProbeResult["outcome"],
): Parameters<typeof classifyFailure>[1] {
  return {
    capture: {
      controlProbes: positiveOutcome
        ? { positive: probe(positiveOutcome), negative: probe("ok") }
        : null,
    },
    captureValidity: null,
  } as unknown as Parameters<typeof classifyFailure>[1];
}

const a2Err = new Error(
  "[freeze] A2 gate: externalFontSrcCount=3 after rewrite (embedded=10, failures=3).",
);

describe("classifyFailure — A2 gate env-confound", () => {
  it("A2 gate + positiv probe ok → font-embed-failed (äkta site/font-fel)", () => {
    expect(classifyFailure(a2Err, reportWith("ok"))).toBe("font-embed-failed");
  });

  it("A2 gate + positiv probe env_blocked → font-embed-env-blocked (miljö)", () => {
    expect(classifyFailure(a2Err, reportWith("env_blocked"))).toBe(
      "font-embed-env-blocked",
    );
  });

  it("A2 gate + positiv probe timeout → font-embed-env-blocked", () => {
    expect(classifyFailure(a2Err, reportWith("timeout"))).toBe(
      "font-embed-env-blocked",
    );
  });

  it("A2 gate utan controlProbes → font-embed-failed (säker default)", () => {
    expect(classifyFailure(a2Err, reportWith(undefined))).toBe("font-embed-failed");
  });

  it("orelaterat fel påverkas inte av probe-utfallet", () => {
    const timeoutErr = new Error("Navigation timeout of 60000 ms exceeded");
    expect(classifyFailure(timeoutErr, reportWith("env_blocked"))).toBe("timeout");
  });
});
