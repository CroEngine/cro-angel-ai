// @vitest-environment happy-dom
//
// Proves the two structural guarantees of the adaptation interpreter:
//   1. revert() restores the DOM byte-for-byte (the original site is never changed).
//   2. content-bearing ops apply ONLY server-resolved content — never invented.

import { beforeEach, describe, expect, it } from "vitest";

import { applyPlan, type ContentMap } from "../adapt";
import type { AdaptationPlan } from "../contract";

const SITE = "00000000-0000-0000-0000-000000000000";
const SEG = "00000000-0000-0000-0000-000000000001";

function plan(ops: AdaptationPlan["ops"]): AdaptationPlan {
  return {
    planId: "p",
    siteId: SITE,
    segmentId: SEG,
    extractorVersion: "1.6.0",
    ops,
    fallback: "noop",
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.getElementById("angel-adapt-style")?.remove();
});

describe("applyPlan", () => {
  it("reorders sibling sections, then reverts exactly", () => {
    document.body.innerHTML = `<main><section id="a">A</section><section id="b">B</section><section id="c">C</section></main>`;
    const main = document.querySelector("main")!;
    const before = main.innerHTML;

    const revert = applyPlan(plan([{ op: "reorderSections", order: ["#c", "#a", "#b"] }]));
    expect([...main.children].map((e) => e.id)).toEqual(["c", "a", "b"]);

    revert();
    expect([...main.children].map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(main.innerHTML).toBe(before);
  });

  it("hides an element, then restores it and removes the injected stylesheet", () => {
    document.body.innerHTML = `<div id="x">hi</div>`;
    const before = document.body.innerHTML;

    const revert = applyPlan(plan([{ op: "hideElement", selector: "#x" }]));
    expect(document.querySelector("#x")!.hasAttribute("data-angel-hide")).toBe(true);
    expect(document.getElementById("angel-adapt-style")).not.toBeNull();

    revert();
    expect(document.querySelector("#x")!.hasAttribute("data-angel-hide")).toBe(false);
    expect(document.getElementById("angel-adapt-style")).toBeNull();
    expect(document.body.innerHTML).toBe(before);
  });

  it("never invents content: switchCta is a noop without resolved content", () => {
    document.body.innerHTML = `<a id="cta" href="/old">Old</a>`;
    const before = document.body.innerHTML;

    // No content provided for the referenced inventory id ⇒ the op is skipped.
    const revert = applyPlan(
      plan([
        {
          op: "switchCta",
          fromSelector: "#cta",
          toInventoryId: "11111111-1111-1111-1111-111111111111",
        },
      ]),
    );
    expect(document.querySelector("#cta")!.textContent).toBe("Old");
    expect(document.body.innerHTML).toBe(before);
    revert();
    expect(document.body.innerHTML).toBe(before);
  });

  it("applies resolved content to switchCta, then reverts exactly", () => {
    document.body.innerHTML = `<a id="cta" href="/old">Old</a>`;
    const before = document.body.innerHTML;
    const content: ContentMap = { id1: { text: "Start free trial", href: "/signup" } };

    const revert = applyPlan(
      plan([{ op: "switchCta", fromSelector: "#cta", toInventoryId: "id1" }]),
      content,
    );
    const a = document.querySelector("#cta")!;
    expect(a.textContent).toBe("Start free trial");
    expect(a.getAttribute("href")).toBe("/signup");

    revert();
    expect(document.body.innerHTML).toBe(before);
  });

  it("applies a six-op plan and reverts the DOM byte-for-byte", () => {
    document.body.innerHTML =
      `<header><nav><a id="n1">1</a><a id="n2">2</a></nav></header>` +
      `<main>` +
      `<section id="s1">one</section><section id="s2">two</section>` +
      `<button id="buy">Buy</button>` +
      `<img id="hero" src="/a.jpg" srcset="/a-2x.jpg 2x">` +
      `<div id="slot"></div>` +
      `</main>`;
    const before = document.body.innerHTML;
    const content: ContentMap = { img: { src: "/b.jpg" }, mc: { text: "30-day guarantee" } };

    const revert = applyPlan(
      plan([
        { op: "reorderSections", order: ["#s2", "#s1"] },
        { op: "reorderNav", order: ["#n2", "#n1"] },
        { op: "emphasizeCta", selector: "#buy", style: "emphasize" },
        { op: "swapImage", selector: "#hero", toInventoryId: "img" },
        { op: "showMicrocopy", slotSelector: "#slot", fromInventoryId: "mc" },
        { op: "hideElement", selector: "#s1" },
      ]),
      content,
    );

    // Something actually changed…
    expect(document.body.innerHTML).not.toBe(before);
    expect([...document.querySelectorAll("main > section")].map((e) => e.id)).toEqual(["s2", "s1"]);
    expect([...document.querySelectorAll("nav > a")].map((e) => e.id)).toEqual(["n2", "n1"]);
    expect((document.querySelector("#hero") as HTMLImageElement).getAttribute("src")).toBe(
      "/b.jpg",
    );
    expect(document.querySelector("#slot")!.textContent).toContain("30-day guarantee");

    // …and revert restores the original page exactly.
    revert();
    expect(document.body.innerHTML).toBe(before);
  });

  it("skips missing selectors without throwing or mutating", () => {
    document.body.innerHTML = `<div id="only">x</div>`;
    const before = document.body.innerHTML;

    const revert = applyPlan(
      plan([
        { op: "hideElement", selector: "#does-not-exist" },
        { op: "moveElement", selector: "#nope", position: "before", anchorSelector: "#gone" },
        { op: "reorderSections", order: ["#a", "#b"] },
      ]),
    );
    expect(document.body.innerHTML).toBe(before);
    revert();
    expect(document.body.innerHTML).toBe(before);
  });
});
