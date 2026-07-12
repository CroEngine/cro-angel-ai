import { describe, it, expect } from "vitest";

import { extractContentModel } from "../extract";

// A small page in the SHAPE of a real SSR homepage: nav + footer headings that
// must NOT become sections, an h1 that appears after some h2s (hero must still be
// first), social proof BELOW features (the move_up case), a stat block whose
// number is split from its label by markup, and a trailing partial phrase.
const PAGE = `
<!doctype html><html><head><title>Acme</title></head><body>
  <nav><h2>Who it's for</h2><h2>Compare</h2></nav>
  <main>
    <section><h2>Why use Acme?</h2><p>Because it is fast.</p></section>
    <h1>The privacy-first analytics tool</h1>
    <p>Acme is lightweight analytics with no cookies, made in the EU.</p>
    <a href="/register">Start free trial</a>
    <a href="/demo">View live demo</a>
    <section><h2>People love Acme</h2>
      <dl><dt>Paying subscribers</dt><dd>12,500</dd></dl>
      <p>why over 12,500 paying customers trust us with their business</p>
      <p>Acme is trusted by thousands of companies that switched from Google Analytics today</p>
      <p>We are a completely independent, self-funded, bootstrapped and profitable team of 10, running since 2019</p>
    </section>
    <section><h2>Traffic based plans that match your growth</h2></section>
  </main>
  <footer><h2>Follow Acme: Twitter</h2></footer>
</body></html>`;

describe("extractContentModel — HTML → content model loader", () => {
  const model = extractContentModel(PAGE);

  it("takes sections from <main> only — nav/footer headings are not sections", () => {
    const headings = model.sections.map((s) => s.heading);
    expect(headings).not.toContain("Who it's for");
    expect(headings).not.toContain("Compare");
    expect(headings.some((h) => h.startsWith("Follow Acme"))).toBe(false);
  });

  it("puts the hero first even when the h1 follows h2s in source order", () => {
    expect(model.sections[0].type).toBe("hero");
    expect(model.sections[0].heading).toBe("The privacy-first analytics tool");
    expect(model.sections[0].aboveFold).toBe(true);
  });

  it("classifies the following sections by heading keywords, in document order", () => {
    const types = model.sections.map((s) => s.type);
    // hero, then features / testimonials / pricing in the page's own order
    expect(types[0]).toBe("hero");
    expect(types).toContain("features");
    expect(types).toContain("testimonials");
    expect(types).toContain("pricing");
    // social proof sits BELOW features on the source page (the move_up case)
    expect(types.indexOf("features")).toBeLessThan(types.indexOf("testimonials"));
  });

  it("gives every section a stable, unique id and monotonic positions", () => {
    const ids = model.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(model.sections.map((s) => s.position)).toEqual(
      model.sections.map((_, i) => i + 1),
    );
  });

  it("extracts conversion CTAs from real anchor text", () => {
    const texts = model.ctas.map((c) => c.text);
    expect(texts).toContain("Start free trial");
    expect(texts).toContain("View live demo");
    expect(model.ctas.find((c) => c.text === "Start free trial")?.intent).toBe("conversion");
    expect(model.ctas.find((c) => c.text === "View live demo")?.intent).toBe("explore");
  });

  it("surfaces the count from prose (real digits), not the split stat block", () => {
    const count = model.trustSignals.find((t) => t.type === "social_proof_count");
    expect(count?.text).toBe("12,500 paying customers");
    // never a bare "." masquerading as a number
    expect(count?.text).not.toMatch(/^[.\s]/);
  });

  it("keeps trust phrases faithful and never cut mid-word", () => {
    const trusted = model.trustSignals.find((t) => t.type === "trusted_by")?.text ?? "";
    expect(trusted).toContain("trusted by thousands of companies");
    // no half-words: every token is whole (the source substring is real)
    expect(trusted.endsWith("Analyt")).toBe(false);
    const indep = model.trustSignals.find((t) => t.type === "independence")?.text ?? "";
    expect(indep.startsWith("independent")).toBe(true);
  });

  it("builds a hero with the real headline and first paragraph as subheadline", () => {
    expect(model.hero?.headline).toBe("The privacy-first analytics tool");
    expect(model.hero?.subheadline).toContain("lightweight analytics");
  });

  it("returns no hero when the page has no h1", () => {
    const noHero = extractContentModel("<main><h2>Only a section</h2></main>");
    expect(noHero.hero).toBeUndefined();
    expect(noHero.sections[0].type).not.toBe("hero");
  });

  // Regression: the hero h1 + primary CTA very often live in a <header> ABOVE
  // <main> (e.g. Basecamp). Scoping everything to <main> dropped them.
  it("finds the hero + CTA even when they live in a header OUTSIDE <main>", () => {
    const page = `
      <header>
        <a href="/signup">Try Acme free</a>
        <h1>The refreshingly simple tool</h1>
        <p>Hey there — here is the pitch.</p>
      </header>
      <main>
        <section><h2>Big numbers</h2></section>
        <section><h2>What you get</h2></section>
      </main>`;
    const m = extractContentModel(page);
    expect(m.hero?.headline).toBe("The refreshingly simple tool");
    expect(m.hero?.subheadline).toContain("here is the pitch");
    expect(m.sections[0].type).toBe("hero");
    expect(m.sections[0].heading).toBe("The refreshingly simple tool");
    // the h2 sections still follow, scoped to <main>
    expect(m.sections.map((s) => s.heading)).toEqual([
      "The refreshingly simple tool",
      "Big numbers",
      "What you get",
    ]);
    expect(m.ctas.map((c) => c.text)).toContain("Try Acme free");
  });

  it("does not let 'handbook' / 'Books' masquerade as CTAs (\\bbook\\b)", () => {
    const page = `<header><a>Try it</a></header><main><a>Books we wrote</a><a>Employee handbook</a><a>Book a demo</a></main>`;
    const texts = extractContentModel(page).ctas.map((c) => c.text);
    expect(texts).toContain("Try it");
    expect(texts).toContain("Book a demo");
    expect(texts).not.toContain("Books we wrote");
    expect(texts).not.toContain("Employee handbook");
  });
});
