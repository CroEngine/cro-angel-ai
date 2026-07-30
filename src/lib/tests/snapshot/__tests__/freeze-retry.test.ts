// Transient-klassningen bakom freezeSite:s omförsök-med-färsk-session.
//
// Kontraktet: bara infra-brus (WS-tunnel/CDP-drop, -32000-serialisering,
// timeout) får retry:as — site-verkliga fel (consent, anti-bot, fel sida)
// är INFORMATION och ska nå rapporten oförvanskade på första försöket.
// Fallen nedan är de observerade: "[object ErrorEvent]" är hibob 2026-07-30
// (föll före goto, grönt på omförsöket).

import { describe, test, expect } from "vitest";

import { isTransientCaptureFailure } from "../freeze.server";

describe("isTransientCaptureFailure", () => {
  test("mhtml-capture-failed (-32000) är transient oavsett meddelande", () => {
    expect(isTransientCaptureFailure("mhtml-capture-failed", new Error("whatever"))).toBe(true);
  });

  test("timeout är transient", () => {
    expect(isTransientCaptureFailure("timeout", new Error("waitForMainLoadState timed out"))).toBe(
      true,
    );
  });

  test("unknown + WS/CDP-signatur är transient", () => {
    expect(
      isTransientCaptureFailure("unknown", new Error("WebSocket error: wss://connect… 404")),
    ).toBe(true);
    expect(isTransientCaptureFailure("unknown", new Error("read ECONNRESET"))).toBe(true);
    expect(isTransientCaptureFailure("unknown", new Error("Target closed while navigating"))).toBe(
      true,
    );
    // Stagehands stringifierade händelseobjekt (hibob-fallet).
    expect(isTransientCaptureFailure("unknown", "[object ErrorEvent]")).toBe(true);
  });

  test("unknown utan infra-signatur är INTE transient", () => {
    expect(isTransientCaptureFailure("unknown", new Error("golden mismatch on trustSignals"))).toBe(
      false,
    );
  });

  test("site-verkliga klasser retry:as aldrig — även med infra-ord i meddelandet", () => {
    expect(isTransientCaptureFailure("consent-missed", new Error("ECONNRESET"))).toBe(false);
    expect(isTransientCaptureFailure("anti-bot-blocked", new Error("tunnel"))).toBe(false);
    expect(isTransientCaptureFailure("captured-wrong-page", new Error("websocket"))).toBe(false);
    expect(isTransientCaptureFailure("font-embed-failed", new Error("socket hang up"))).toBe(false);
  });

  test("null (lyckad körning) är inte transient", () => {
    expect(isTransientCaptureFailure(null, new Error("x"))).toBe(false);
  });
});
