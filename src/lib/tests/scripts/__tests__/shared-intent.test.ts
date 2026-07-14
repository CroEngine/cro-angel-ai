// The shared intent classifier (B1): both CTAS_SCRIPT and COLLECT_SCRIPT
// inline this exact function via toString(), so testing the import IS testing
// both scripts' intent behavior — drift is impossible by construction. The
// inline-parity tests at the bottom assert that construction holds.

import { describe, expect, it } from "vitest";

import { classifyIntentShared, samePageAnchorShared } from "../shared/intent";
import { CTAS_SCRIPT } from "../ctas";
import { COLLECT_SCRIPT } from "../collect";

const classify = (
  text: string,
  opts: {
    href?: string;
    attrText?: string;
    category?: string;
    isFormSubmit?: boolean;
    aboveFold?: boolean;
  } = {},
) =>
  classifyIntentShared(
    text,
    opts.href ?? "",
    opts.attrText ?? "",
    opts.category ?? "cta_secondary",
    opts.isFormSubmit ?? false,
    opts.aboveFold ?? false,
  );

describe("classifyIntentShared — A1: contact is real, conversion beats tel:", () => {
  it("a tel: button with a conversion verb is a conversion, not utility", () => {
    // The audit's flagship scenario: a clinic's hero "Ring och boka" used to
    // short-circuit on tel: → 'utility' before the keyword list ever ran.
    expect(classify("Ring och boka", { href: "tel:+468123456" })).toBe("conversion");
  });

  it("verb-less contact actions get the contact intent, not utility", () => {
    expect(classify("Kontakta oss", { href: "/kontakt" })).toBe("contact");
    expect(classify("Contact Sales", { href: "https://offers.hubspot.com/x" })).toBe("contact");
    expect(classify("Ring oss", { href: "tel:+468123456" })).toBe("contact");
    expect(classify("Maila oss", { href: "mailto:hej@x.se" })).toBe("contact");
  });

  it("information links never fall back to conversion just for being above the fold", () => {
    expect(
      classify("Learn more about Revenue Hub", { category: "cta_primary", aboveFold: true }),
    ).toBe("information");
  });

  it("keeps the position fallback for keyword-less above-fold primaries", () => {
    expect(classify("Fortsätt", { category: "cta_primary", aboveFold: true })).toBe("conversion");
    expect(classify("Fortsätt", { category: "cta_primary", aboveFold: false })).toBe("unknown");
  });

  it("form submits are conversions; social hosts stay social regardless of label", () => {
    expect(classify("Skicka", { isFormSubmit: true })).toBe("conversion");
    expect(classify("Subscribe", { href: "https://youtube.com/@x" })).toBe("social");
  });

  it("covers the harvest vocabulary in both scripts via the shared list", () => {
    expect(classify("Lägg i varukorgen")).toBe("conversion"); // ex-drift-typo
    expect(classify("Teckna elavtal")).toBe("conversion");
    expect(classify("Bli månadsgivare")).toBe("conversion");
    expect(classify("Prenumerera")).toBe("engagement"); // unchanged collect semantics
  });
});

describe("classifyIntentShared — same-page anchors (tabs/TOC) are navigation", () => {
  const anchor = (text: string, opts: { category?: string; aboveFold?: boolean } = {}) =>
    classifyIntentShared(
      text,
      "https://www.bokadirekt.se/places/citymassage-457#reviews",
      "",
      opts.category ?? "cta_primary",
      false,
      opts.aboveFold ?? true,
      "",
      /* samePageAnchor */ true,
    );

  it("an above-fold primary tab strip is NOT position-fallbacked to conversion", () => {
    // bokadirekt-service: "Bilder"/"Personal"/"Betyg"/"Om"/"Visa tjänster"
    // — absolute self-URL + fragment, no verbs, primary surface, above fold.
    // Pre-fix these became conversion via the placement fallback and then
    // top signup goal candidates.
    for (const t of ["Bilder", "Personal", "Betyg", "Om", "Visa tjänster"]) {
      expect(anchor(t), t).toBe("navigation");
    }
  });

  it("a VERB on a same-page anchor still wins — #bokning-CTA:n är äkta", () => {
    expect(anchor("Boka nu")).toBe("conversion");
    expect(anchor("Kontakta oss")).toBe("contact");
  });

  it("without the flag the placement fallback is unchanged", () => {
    expect(classify("Fortsätt", { category: "cta_primary", aboveFold: true })).toBe("conversion");
  });
});

describe("\\btry\\b — the English twin of 'prova' (added for string-context callers)", () => {
  it("'Try Basecamp free' is a conversion even without category/position", () => {
    expect(classifyIntentShared("Try Basecamp free", "/signup", "", "", false, true)).toBe(
      "conversion",
    );
  });
  it("'Industry insights' does not smuggle 'try' through the word boundary", () => {
    expect(classifyIntentShared("Industry insights", "/blog", "", "", false, true)).not.toBe(
      "conversion",
    );
  });
});

describe("B1 — inline parity: one classifier, two scripts", () => {
  const src = classifyIntentShared.toString();

  it("CTAS_SCRIPT inlines the exact shared function source", () => {
    expect(CTAS_SCRIPT).toContain(src);
    expect(CTAS_SCRIPT).toContain(samePageAnchorShared.toString());
  });

  it("COLLECT_SCRIPT inlines the exact shared function source", () => {
    expect(COLLECT_SCRIPT).toContain(src);
    expect(COLLECT_SCRIPT).toContain(samePageAnchorShared.toString());
  });

  it("neither script defines its own intent wordlists anymore", () => {
    // The historical drift vector: local INTENT_RX tables.
    expect(CTAS_SCRIPT).not.toContain("INTENT_RX");
    expect(COLLECT_SCRIPT).not.toContain("INTENT_RX");
  });
});

describe("classifyIntentShared — A2: form kind decides what a submit converts", () => {
  it("search submits are utility, newsletter submits are engagement", () => {
    expect(
      classifyIntentShared("Sök", "", "", "form_submit", true, true, "search"),
    ).toBe("utility");
    expect(
      classifyIntentShared("Skicka", "", "", "form_submit", true, true, "newsletter"),
    ).toBe("engagement");
    // Everything else: a submit is still the form's whole point.
    expect(classifyIntentShared("Skicka", "", "", "form_submit", true, true, "")).toBe(
      "conversion",
    );
  });
});

import {
  classifyCategoryShared,
  hasMeaningfulSurfaceShared,
  HERO_MAX_VIEWPORTS,
} from "../shared/category";

describe("classifyCategoryShared — B2: one 5-signal category rule", () => {
  const cat = (opts: {
    tag?: string;
    type?: string;
    role?: string;
    href?: boolean;
    w?: number;
    h?: number;
    top?: number;
    textLen?: number;
    surface?: boolean;
    chrome?: boolean;
  }) =>
    classifyCategoryShared(
      opts.tag ?? "BUTTON",
      opts.type ?? "",
      opts.role ?? "",
      opts.href ?? false,
      opts.w ?? 200,
      opts.h ?? 48,
      opts.top ?? 100,
      opts.textLen ?? 10,
      opts.surface ?? true,
      opts.chrome ?? false,
      720,
    );

  it("a prominent BELOW-fold button can be primary (4 of 5 without the fold signal)", () => {
    // The old ctas.ts 4-of-4 rule made this structurally impossible there.
    expect(cat({ top: 2000 })).toBe("cta_primary");
  });

  it("chrome membership costs the fifth signal", () => {
    expect(cat({ top: 100, chrome: true })).toBe("cta_primary"); // 4/5 still
    expect(cat({ top: 2000, chrome: true })).toBe("cta_secondary"); // 3/5 + surface
  });

  it("chrome anchor links are nav_item, content links are link", () => {
    expect(cat({ tag: "A", href: true, surface: false, textLen: 40, chrome: true })).toBe(
      "nav_item",
    );
    expect(cat({ tag: "A", href: true, surface: false, textLen: 40, chrome: false })).toBe("link");
  });

  it("submit inputs are form_submit regardless of everything else", () => {
    expect(cat({ tag: "INPUT", type: "submit", chrome: true, surface: false })).toBe("form_submit");
  });

  it("borders count as surface (collect's definition, now canonical)", () => {
    expect(hasMeaningfulSurfaceShared("rgba(0, 0, 0, 0)", "1px solid rgb(0,0,0)")).toBe(true);
    expect(hasMeaningfulSurfaceShared("rgba(0, 0, 0, 0)", "0px none")).toBe(false);
  });

  it("inline parity: both scripts carry the shared category source + hero constant", () => {
    const src = classifyCategoryShared.toString();
    expect(CTAS_SCRIPT).toContain(src);
    expect(COLLECT_SCRIPT).toContain(src);
    expect(CTAS_SCRIPT).toContain(`viewportH * ${HERO_MAX_VIEWPORTS}`);
    expect(COLLECT_SCRIPT).toContain(`viewportH * ${HERO_MAX_VIEWPORTS}`);
  });
});
