import { describe, it, expect } from "vitest";

import {
  extractContentModel,
  extractLinkStyleDonor,
  extractPriceSnippets,
  extractQuotables,
} from "../extract";

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
    expect(model.sections.map((s) => s.position)).toEqual(model.sections.map((_, i) => i + 1));
  });

  it("extracts conversion CTAs from real anchor text", () => {
    const texts = model.ctas.map((c) => c.text);
    expect(texts).toContain("Start free trial");
    expect(texts).toContain("View live demo");
    expect(model.ctas.find((c) => c.text === "Start free trial")?.intent).toBe("conversion");
    // The shared classifier's semantics: a demo request IS a conversion (the
    // old private regex here downgraded it to a home-made "explore" intent).
    expect(model.ctas.find((c) => c.text === "View live demo")?.intent).toBe("conversion");
  });

  it("decodes numeric HTML entities — real sites encode åäö as &#xE5;/&#229;", () => {
    const page = `<main><h1>Tr&#xE4;na med oss</h1><section><h2>H&#229;ll ig&#xE5;ng</h2></section><a href="/k">K&#xF6;p nu</a></main>`;
    const m = extractContentModel(page);
    expect(m.sections[0].heading).toBe("Träna med oss");
    expect(m.sections[1].heading).toBe("Håll igång");
    // avkodningen gör att vokabulären träffar: "Köp nu" är en konvertering
    expect(m.ctas.find((c) => c.text === "Köp nu")?.intent).toBe("conversion");
  });

  it("extracts CTAs across the deterministic floor's languages (de/ja), login stays out", () => {
    const page = `
      <main>
        <h1>Preise</h1>
        <a href="/kauf">Jetzt kaufen</a>
        <a href="/cart">カートに追加</a>
        <a href="/login">Anmelden</a>
        <a href="/login-jp">ログイン</a>
      </main>`;
    const texts = extractContentModel(page).ctas.map((c) => c.text);
    expect(texts).toContain("Jetzt kaufen");
    expect(texts).toContain("カートに追加");
    expect(texts).not.toContain("Anmelden"); // login-tvetydig → navigation
    expect(texts).not.toContain("ログイン");
  });

  // Breadth finding 2: the old English-only regex found 0 CTAs on 6/13 real
  // Swedish sites. Candidacy now comes from the shared corpus-mined classifier.
  it("extracts Swedish CTAs (shared classifier, no private word list)", () => {
    const page = `
      <header><a href="/konto">Skapa konto</a></header>
      <main>
        <h1>Jämför elpriser</h1>
        <a href="/start">Kom igång</a>
        <button>Lägg i varukorgen</button>
        <a href="/boka">Boka tid</a>
        <a href="/login">Logga in</a>
        <a href="/kontakt">Kontakta oss</a>
        <a href="https://facebook.com/acme">Följ oss på Facebook</a>
      </main>`;
    const m = extractContentModel(page);
    const byText = (t: string) => m.ctas.find((c) => c.text === t);
    expect(byText("Skapa konto")?.intent).toBe("conversion");
    expect(byText("Kom igång")?.intent).toBe("conversion");
    expect(byText("Lägg i varukorgen")?.intent).toBe("conversion");
    expect(byText("Boka tid")?.intent).toBe("conversion");
    // contact is a real intent of its own (lead-gen goal — A1), never dropped
    expect(byText("Kontakta oss")?.intent).toBe("contact");
    // navigation/social links stay OUT of the model's CTA list
    expect(byText("Logga in")).toBeUndefined();
    expect(byText("Följ oss på Facebook")).toBeUndefined();
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
    expect(texts).toContain("Try it"); // \btry\b — the corpus list's English twin of "prova"
    expect(texts).toContain("Book a demo");
    expect(texts).not.toContain("Books we wrote");
    expect(texts).not.toContain("Employee handbook");
  });

  it("flags containsTrustSignals on the section whose BODY carries the proof", () => {
    // The "People love Acme" section's heading types it testimonials; its body
    // also carries "12,500 paying customers" + "trusted by thousands" — so it is
    // the section that holds the proof (the signal reorder needs).
    const proofSecs = model.sections.filter((s) => s.containsTrustSignals);
    expect(proofSecs.map((s) => s.heading)).toContain("People love Acme");
    // the pricing / features sections carry no proof in their own body
    expect(model.sections.find((s) => s.type === "pricing")?.containsTrustSignals).toBeFalsy();
  });
});

// ADR-001 step 3: structural + proof section typing on the redesign (live-serve)
// path. The heading classifier leaves most sections generic; these cues type a
// section from its OWN BODY (ported from the lab's assembleInventory, adapted
// from live-DOM querySelector to regex over the frozen section slice). Structure
// and proof only ever FILL a generic section — a heading-assigned type is kept.
describe("extractContentModel — structural + proof section typing", () => {
  const wrap = (section: string) =>
    `<main><h1>Hero headline here</h1><p>Intro.</p>${section}</main>`;
  const typeOf = (section: string, heading: string) =>
    extractContentModel(wrap(section)).sections.find((s) => s.heading === heading)?.type;

  it("types a generic section built around a <video> as video", () => {
    expect(
      typeOf(
        `<section><h2>See it live</h2><video src="/demo.mp4"></video></section>`,
        "See it live",
      ),
    ).toBe("video");
  });

  it("types a YouTube/Vimeo embed section as video", () => {
    expect(
      typeOf(
        `<section><h2>Watch the tour</h2><iframe src="https://www.youtube.com/embed/x"></iframe></section>`,
        "Watch the tour",
      ),
    ).toBe("video");
  });

  it("types a section built around a comparison <table> (>=3 rows) as comparison", () => {
    const t = `<section><h2>Side by side</h2><table><tr><th>Us</th><th>Them</th></tr><tr><td>Yes</td><td>No</td></tr><tr><td>Fast</td><td>Slow</td></tr></table></section>`;
    expect(typeOf(t, "Side by side")).toBe("comparison");
  });

  it("types a section with two or more <details> as faq", () => {
    const t = `<section><h2>Good to know</h2><details><summary>Q1</summary>A1</details><details><summary>Q2</summary>A2</details></section>`;
    expect(typeOf(t, "Good to know")).toBe("faq");
  });

  it("types an integrations section (>=6 imgs + integration heading) as integrations", () => {
    const imgs = Array.from({ length: 7 }, (_, i) => `<img src="/logo${i}.svg">`).join("");
    expect(
      typeOf(`<section><h2>Works with your tools</h2>${imgs}</section>`, "Works with your tools"),
    ).toBe("integrations");
  });

  it("promotes a generic section whose BODY carries a social-proof count to stats", () => {
    const t = `<section><h2>By the numbers</h2><p>Over 500,000 customers and 80 billion events tracked.</p></section>`;
    const s = extractContentModel(wrap(t)).sections.find((x) => x.heading === "By the numbers");
    expect(s?.type).toBe("stats");
    expect(s?.containsTrustSignals).toBe(true);
  });

  it("promotes a generic section whose BODY says 'trusted by' to logos", () => {
    const t = `<section><h2>In good company</h2><p>Trusted by Google, Meta and Spotify.</p></section>`;
    const s = extractContentModel(wrap(t)).sections.find((x) => x.heading === "In good company");
    expect(s?.type).toBe("logos");
    expect(s?.containsTrustSignals).toBe(true);
  });

  it("never re-types a heading-classified section — pricing with a table stays pricing", () => {
    const t = `<section><h2>Simple pricing</h2><table><tr><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></table></section>`;
    expect(typeOf(t, "Simple pricing")).toBe("pricing");
  });

  it("leaves a genuinely generic prose section untyped (no false structural type)", () => {
    const t = `<section><h2>Our story</h2><p>We started in a garage and grew from there.</p></section>`;
    expect(["section", "content"]).toContain(typeOf(t, "Our story"));
  });

  // Precision hardening (granskningsfynd 2026-07-22) — promotion must not fire
  // on prose that merely brushes the trust vocabulary.
  it("does NOT promote on a bare year ('Since 2019 customers…' is not a stat)", () => {
    const t = `<section><h2>Our journey</h2><p>Since 2019 customers have trusted our roadmap reviews.</p></section>`;
    const s = extractContentModel(wrap(t)).sections.find((x) => x.heading === "Our journey");
    expect(s?.type).not.toBe("stats");
    expect(s?.containsTrustSignals).toBeFalsy();
  });

  it("does NOT promote on ', customers' where the number is sentence-separated", () => {
    const t = `<section><h2>Timeline</h2><p>Back in 2019, customers asked us for exports.</p></section>`;
    expect(typeOf(t, "Timeline")).not.toBe("stats");
  });

  it("does NOT promote everyday prose 'used by developers' to logos", () => {
    const t = `<section><h2>Under the hood</h2><p>A build tool used by developers who care about speed.</p></section>`;
    const s = extractContentModel(wrap(t)).sections.find((x) => x.heading === "Under the hood");
    expect(s?.type).not.toBe("logos");
    expect(s?.containsTrustSignals).toBeFalsy();
  });

  it("still promotes a real thousands-separated count ('12 000 kunder')", () => {
    const t = `<section><h2>Siffror</h2><p>Fler än 12 000 kunder använder oss varje dag.</p></section>`;
    expect(typeOf(t, "Siffror")).toBe("stats");
  });

  it("does NOT type a prose section faq off a 'faq-teaser-link' class", () => {
    const t = `<section><h2>More reading</h2><p><a class="faq-teaser-link" href="/faq">See our FAQ</a> for details.</p></section>`;
    expect(typeOf(t, "More reading")).not.toBe("faq");
  });

  it("still types a real accordion component (class='accordion-item' ×2) as faq", () => {
    const t = `<section><h2>Good to know</h2><div class="accordion"><div class="accordion-item">Q1</div><div class="accordion-item">Q2</div></div></section>`;
    expect(typeOf(t, "Good to know")).toBe("faq");
  });

  it("does NOT type a Bloomberg iframe as video ('loom' is host-anchored)", () => {
    const t = `<section><h2>In the news</h2><iframe src="https://www.bloomberg.com/embed/xyz"></iframe></section>`;
    expect(typeOf(t, "In the news")).not.toBe("video");
  });

  it("still types a real Loom embed as video", () => {
    const t = `<section><h2>See it in action</h2><iframe src="https://www.loom.com/embed/abc123"></iframe></section>`;
    expect(typeOf(t, "See it in action")).toBe("video");
  });

  it("caps the LAST section's body at <footer> — footer proof cannot type it", () => {
    const page = `<div><h1>Hero here</h1><p>Intro.</p><h2>Our approach</h2><p>Plain prose about process.</p></div>
      <footer><p>Join 50,000 subscribers. Trusted by Google.</p></footer>`;
    const m = extractContentModel(page); // no <main> — whole doc is the region
    const s = m.sections.find((x) => x.heading === "Our approach");
    expect(s?.type).not.toBe("stats");
    expect(s?.type).not.toBe("logos");
    expect(s?.containsTrustSignals).toBeFalsy();
  });

  it("flags hero-level proof (containsTrustSignals) without re-typing the hero", () => {
    const page = `<main><h1>Ship faster</h1><p>Trusted by 10,000 teams worldwide.</p><section><h2>Features</h2><p>x</p></section></main>`;
    const hero = extractContentModel(page).sections[0];
    expect(hero.type).toBe("hero");
    expect(hero.containsTrustSignals).toBe(true);
  });

  it("flags SECTION-heading proof without re-typing it (fleet-E2E recall gap)", () => {
    // 10/43 "None" sites carried proof in a section HEADING the body scanner
    // missed. The heading now FLAGS proof — but a feature headline that cites a
    // count is not structurally a stats strip, so the TYPE stays untouched.
    const page = `<main><h1>Ship it</h1><section><h2>Features</h2><p>fast</p></section><section><h2>Join 150,000+ businesses driving revenue</h2><p>details</p></section></main>`;
    const s = extractContentModel(page).sections.find((x) => /150,000/.test(x.heading));
    expect(s?.containsTrustSignals).toBe(true);
    expect(s?.type).not.toBe("stats");
    expect(s?.type).not.toBe("logos");
  });

  it("counts the SaaS noun 'teams' as social proof ('50,000+ teams')", () => {
    const t = `<section><h2>Adoption</h2><p>Used across 50,000+ teams worldwide.</p></section>`;
    expect(typeOf(t, "Adoption")).toBe("stats");
    const m = extractContentModel(`<main><h1>x</h1>${t}</main>`);
    expect(m.trustSignals.find((x) => x.type === "social_proof_count")?.text).toContain("teams");
  });

  it("dedups exact-duplicate section headings (responsive mobile+desktop copies)", () => {
    // Capture faithfulness (steg 1): a responsive theme renders the same heading
    // twice (mobile + desktop) and the visitor sees ONE. Keep the first, drop the
    // repeat; re-index positions contiguously. (monday: 16 → real sections.)
    const page = `<main>
      <h1>Hero headline</h1>
      <section><h2>Consider yourself limitless</h2><p>a</p></section>
      <section><h2>Real distinct feature</h2><p>b</p></section>
      <section><h2>Consider yourself limitless</h2><p>c</p></section>
    </main>`;
    const secs = extractContentModel(page).sections;
    expect(secs.filter((s) => /limitless/i.test(s.heading)).length).toBe(1);
    expect(secs.map((s) => s.position)).toEqual(secs.map((_, i) => i + 1));
  });

  it("detects a money-back guarantee as a trust signal, but not a bare 'no guarantee'", () => {
    const withG = extractContentModel(
      `<main><h1>Try it</h1><section><h2>Risk free</h2><p>See results in 30 days or get your money back.</p></section></main>`,
    );
    expect(withG.trustSignals.find((t) => t.type === "guarantee")?.text).toBeTruthy();
    const bare = extractContentModel(
      `<main><h1>x</h1><section><h2>Terms</h2><p>There is no guarantee that results will vary.</p></section></main>`,
    );
    expect(bare.trustSignals.find((t) => t.type === "guarantee")).toBeUndefined();
  });
});

// Task #90: den delade EN+SV-vokabulären — en svensk sida ska klassificeras
// och ge trust-signaler precis som en engelsk. Innan delningen fick svenska
// rubriker "section" på allt och trust-skanningen hittade ingenting.
describe("extractContentModel — svensk sida genom samma vokabulär", () => {
  const SIDA = `
<!doctype html><html><head><title>Acme</title></head><body>
  <main>
    <h1>Bokföring som sköter sig själv</h1>
    <p>Över 12 000 kunder litar på Acme varje dag.</p>
    <a href="/skapa-konto">Skapa konto</a>
    <section><h2>Därför väljer företag Acme</h2><p>Det går fort.</p></section>
    <section><h2>Vad våra kunder säger</h2><p>"Bäst i klassen" — Anna, Byrån AB</p>
      <p>Används av 300 företag i Norden</p></section>
    <section><h2>Priser</h2><p>En plan, avsluta när du vill.</p></section>
    <section><h2>Vanliga frågor</h2><p>Hur funkar det?</p></section>
  </main>
</body></html>`;
  const model = extractContentModel(SIDA);

  it("klassificerar svenska rubriker till samma typvokabulär", () => {
    const byHeading = new Map(model.sections.map((s) => [s.heading, s.type]));
    expect(byHeading.get("Därför väljer företag Acme")).toBe("features");
    expect(byHeading.get("Vad våra kunder säger")).toBe("testimonials");
    expect(byHeading.get("Priser")).toBe("pricing");
    expect(byHeading.get("Vanliga frågor")).toBe("faq");
  });

  it("hittar svenskt socialt bevis — mellanslag som tusentalsavgränsare", () => {
    const counts = model.trustSignals.filter((t) => t.type === "social_proof_count");
    expect(counts.length).toBeGreaterThan(0);
    expect(counts[0].text).toMatch(/12 000 kunder/);
  });

  it("hittar 'används av …' som trusted_by", () => {
    const tb = model.trustSignals.find((t) => t.type === "trusted_by");
    expect(tb?.text).toMatch(/Används av 300 företag/i);
  });
});

describe("extractPriceSnippets — ordagrann pris-whitelist (task #117)", () => {
  const html = `<!doctype html><html><body><main>
    <div class="hero"><h1>Verktyget</h1><p>Allt du behöver.</p></div>
    <section><h2>Priser</h2>
      <p>Från 99 kr/mån — alla funktioner ingår.</p>
      <li>$399/month for teams</li>
      <p>Från 99 kr/mån — alla funktioner ingår.</p>
      <p>Vi älskar transparens.</p>
    </section>
    <footer><p>© 2026 — 12 000 kunder</p></footer>
  </main></body></html>`;

  it("finds verbatim price statements in leaf elements, deduped", () => {
    const snippets = extractPriceSnippets(html);
    expect(snippets.map((s) => s.text)).toEqual([
      "Från 99 kr/mån — alla funktioner ingår.",
      "$399/month for teams",
    ]);
    expect(snippets[0].tag).toBe("p");
    expect(snippets[1].tag).toBe("li");
  });

  it("requires a digit — bare marketing text is never a price statement", () => {
    expect(
      extractPriceSnippets("<main><p>Gratis och grymt bra!</p><p>Prisvärt för alla.</p></main>"),
    ).toEqual([]);
  });

  it("returns [] for a page without price info (dubbelvisningsvaktens signal)", () => {
    expect(extractPriceSnippets("<main><h1>Om oss</h1><p>Vi grundades 2019.</p></main>")).toEqual(
      [],
    );
  });
});

describe("extractPriceSnippets — sammansatta inline-utsagor (plausible-fyndet)", () => {
  it("captures a statement split across inline spans and drops its bare substrings", () => {
    const html = `<main><h1>Hero</h1><section><h2>Pricing</h2>
      <div class="price"><span>$14</span> <span>/month</span></div>
    </section></main>`;
    expect(extractPriceSnippets(html).map((s) => s.text)).toEqual(["$14 /month"]);
  });

  it("never composes across block-level boundaries (would not be ONE statement)", () => {
    const html = `<main><div><p>Priser från</p><p>99 kr/mån</p></div></main>`;
    expect(extractPriceSnippets(html).map((s) => s.text)).toEqual(["99 kr/mån"]);
  });
});

describe("extractQuotables — offert-fallbacken (ägarbeslut 2026-07-18)", () => {
  it("prefers price statements when they exist", () => {
    const q = extractQuotables("<main><h1>Om priser</h1><p>Från 99 kr/mån</p></main>");
    expect(q.kind).toBe("price");
    expect(q.snippets.map((s) => s.text)).toEqual(["Från 99 kr/mån"]);
  });

  it("falls back to the page's own main statement when no amounts are published", () => {
    const q = extractQuotables(
      "<main><h1>Låt oss ge dig en offert</h1><p>Vi återkommer inom en dag.</p></main>",
    );
    expect(q.kind).toBe("answer");
    expect(q.snippets).toEqual([{ text: "Låt oss ge dig en offert", tag: "h1" }]);
  });

  it("returns an EMPTY answer when the page has no usable heading (never invents)", () => {
    const q = extractQuotables("<main><p>Bara brödtext.</p></main>");
    expect(q.kind).toBe("answer");
    expect(q.snippets).toEqual([]);
  });
});

describe("extractLinkStyleDonor — stil-donatorn (alternativ D)", () => {
  it("picks the page's most used text-link class, requiring at least two uses", () => {
    const html = `<main>
      <a class="button w-button">Boka demo</a>
      <a class="t-text-s">Läs mer</a>
      <a class="t-text-s">Se kunder</a>
      <a class="t-text-s">Om oss</a>
    </main>`;
    expect(extractLinkStyleDonor(html)).toBe("t-text-s");
  });

  it("returns null for singleton classes, icon links and classless pages", () => {
    expect(extractLinkStyleDonor('<main><a class="unik">En gång</a></main>')).toBeNull();
    expect(
      extractLinkStyleDonor('<main><a class="ikon"></a><a class="ikon"></a></main>'),
    ).toBeNull();
    expect(extractLinkStyleDonor("<main><a>utan klass</a></main>")).toBeNull();
  });
});

describe("extractCtaCandidates — cover-länkar med aria-label (Teamtailor-fyndet)", () => {
  it("uses the accessible name when the anchor itself is empty", () => {
    const page = `
      <main>
        <h1>Få ditt team att växa</h1>
        <div class="button_main_wrap">
          <div class="clickable_wrap u-cover-absolute">
            <a aria-label="Boka en demo" href="/sv/demo/" class="clickable_link"></a>
          </div>
          <div aria-hidden="true" class="button_main_text">Boka demo</div>
        </div>
      </main>`;
    const m = extractContentModel(page);
    const cta = m.ctas.find((c) => c.text === "Boka en demo");
    expect(cta).toBeDefined();
    expect(cta?.intent).toBe("conversion");
  });

  it("still skips anchors with neither text nor accessible name", () => {
    const m = extractContentModel('<main><h1>X</h1><a href="/x" class="ikon"></a></main>');
    expect(m.ctas).toEqual([]);
  });
});
