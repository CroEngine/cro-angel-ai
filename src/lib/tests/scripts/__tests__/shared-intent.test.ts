// The shared intent classifier (B1): both CTAS_SCRIPT and COLLECT_SCRIPT
// inline this exact function via toString(), so testing the import IS testing
// both scripts' intent behavior — drift is impossible by construction. The
// inline-parity tests at the bottom assert that construction holds.

import { describe, expect, it } from "vitest";

import { classifyIntentShared } from "../shared/intent";
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

describe("B1 — inline parity: one classifier, two scripts", () => {
  const src = classifyIntentShared.toString();

  it("CTAS_SCRIPT inlines the exact shared function source", () => {
    expect(CTAS_SCRIPT).toContain(src);
  });

  it("COLLECT_SCRIPT inlines the exact shared function source", () => {
    expect(COLLECT_SCRIPT).toContain(src);
  });

  it("neither script defines its own intent wordlists anymore", () => {
    // The historical drift vector: local INTENT_RX tables.
    expect(CTAS_SCRIPT).not.toContain("INTENT_RX");
    expect(COLLECT_SCRIPT).not.toContain("INTENT_RX");
  });
});
