import { describe, it, expect } from "vitest";
import { isVisible } from "../collect";

// JSDOM gör ingen layout → getBoundingClientRect ger nollor och
// getComputedStyle löser inte left:-9999px till en rekt. Vi driver
// därför predikatet med explicita DOMRect/CS-värden. Testar exakt
// samma produktionsfunktion (importerad, inte eval:ad sträng) och är
// fullt deterministiskt — ingen layout-engine i loopen.

type CS = Partial<CSSStyleDeclaration>;
type R = Partial<DOMRect>;

const cs = (o: CS = {}): CSSStyleDeclaration =>
  ({
    display: "block",
    visibility: "visible",
    opacity: "1",
    position: "static",
    clip: "auto",
    clipPath: "none",
    ...o,
  }) as CSSStyleDeclaration;

const rect = (o: R = {}): DOMRect => {
  const r = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 140,
    bottom: 32,
    width: 140,
    height: 32,
    ...o,
  };
  return { ...r, toJSON: () => r } as DOMRect;
};

const el = (attrs: Record<string, string> = {}): Element =>
  ({ getAttribute: (n: string) => attrs[n] ?? null }) as unknown as Element;

// JSDOM-window finns inte i denna testmiljö per default — stubba minimalt.
// isVisible läser bara window.innerWidth/Height + document.documentElement.clientWidth/Height
// och endast inom position:absolute/fixed-grenen.
(globalThis as unknown as { window: { innerWidth: number; innerHeight: number } }).window = {
  innerWidth: 1280,
  innerHeight: 800,
};
(globalThis as unknown as { document: { documentElement: { clientWidth: number; clientHeight: number } } }).document = {
  documentElement: { clientWidth: 1280, clientHeight: 800 },
};

describe("isVisible — skip-link / sr-only", () => {
  it("döljer position:absolute; left:-9999px", () => {
    expect(
      isVisible(
        el(),
        cs({ position: "absolute" }),
        rect({ left: -9999, right: -9859 }),
      ),
    ).toBe(false);
  });

  it("döljer sr-only (clip: rect(0,0,0,0); position:absolute)", () => {
    expect(
      isVisible(
        el(),
        cs({ position: "absolute", clip: "rect(0px, 0px, 0px, 0px)" }),
        rect({ left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 }),
      ),
    ).toBe(false);
  });

  it("behåller normal länk i flow (regression-vakt)", () => {
    expect(isVisible(el(), cs({ position: "static" }), rect())).toBe(true);
  });

  it("behåller :focus-state med left:0 (skip-link aktiverad)", () => {
    expect(
      isVisible(
        el(),
        cs({ position: "absolute" }),
        rect({ left: 0, right: 140 }),
      ),
    ).toBe(true);
  });
});
