// Spotlight-resolvern: markören vinner, lokator-fallbacken speglar
// appliceringens rubrikmatchning (normaliserad exakt träff → 24-teckens
// substrängsreserv) och census-sectionOf-regeln — en lösare kopia hade pekat
// spotlighten på FEL sektion, vilket är värre än ingen. Fejk-DOM med smala
// strukturella typer (husets mönster) — ingen jsdom.
import { describe, expect, it } from "vitest";

import {
  findMovedSection,
  normalizeHeading,
  type DocumentLike,
  type ElementLike,
} from "../locate";

class FakeEl implements ElementLike {
  tag: string;
  text: string;
  marked: boolean;
  chrome: boolean;
  parentElement: FakeEl | null = null;
  childList: FakeEl[] = [];
  constructor(tag: string, text = "", opts: { marked?: boolean; chrome?: boolean } = {}) {
    this.tag = tag;
    this.text = text;
    this.marked = opts.marked ?? false;
    this.chrome = opts.chrome ?? ["header", "nav", "footer", "aside"].includes(tag);
  }
  add(...kids: FakeEl[]): this {
    for (const k of kids) {
      k.parentElement = this;
      this.childList.push(k);
    }
    return this;
  }
  get children(): FakeEl[] {
    return this.childList;
  }
  get textContent(): string {
    return [this.text, ...this.childList.map((c) => c.textContent)].join(" ");
  }
  closest(sel: string): FakeEl | null {
    const tags = sel.split(",").map((s) => s.trim());
    let node: FakeEl | null = this;
    while (node) {
      if (tags.includes(node.tag) || (sel.includes("header") && node.chrome)) return node;
      node = node.parentElement;
    }
    return null;
  }
  contains(el: ElementLike): boolean {
    if (el === this) return true;
    return this.childList.some((c) => c.contains(el));
  }
  querySelectorAll(sel: string): FakeEl[] {
    const tags = sel.split(",").map((s) => s.trim());
    const out: FakeEl[] = [];
    this.walk((el) => {
      if (el !== this && tags.includes(el.tag)) out.push(el);
    });
    return out;
  }
  walk(fn: (el: FakeEl) => void): void {
    fn(this);
    for (const c of this.childList) c.walk(fn);
  }
}

class FakeDoc implements DocumentLike {
  constructor(private root: FakeEl) {}
  private collect(pred: (el: FakeEl) => boolean): FakeEl[] {
    const out: FakeEl[] = [];
    this.root.walk((el) => {
      if (pred(el)) out.push(el);
    });
    return out;
  }
  querySelector(sel: string): FakeEl | null {
    if (sel === "[data-angel-moved]") return this.collect((e) => e.marked)[0] ?? null;
    return this.collect((e) => e.tag === sel)[0] ?? null;
  }
  querySelectorAll(sel: string): FakeEl[] {
    const tags = sel.split(",").map((s) => s.trim());
    return this.collect((e) => tags.includes(e.tag));
  }
}

/** En ren sida: main > [sektion(h2 Rubrik A), sektion(h2 Rubrik B)]. */
function cleanPage(opts: { markB?: boolean } = {}) {
  const secA = new FakeEl("section").add(new FakeEl("h2", "Rubrik A"), new FakeEl("p", "text"));
  const secB = new FakeEl("section", "", { marked: opts.markB }).add(
    new FakeEl("h2", "Vanliga frågor om gluten"),
    new FakeEl("p", "svar"),
  );
  const main = new FakeEl("main").add(secA, secB);
  const body = new FakeEl("body").add(new FakeEl("header").add(new FakeEl("h2", "Meny")), main);
  return { doc: new FakeDoc(body), secA, secB };
}

describe("findMovedSection — markör först, lokator-fallback spegelvänd", () => {
  it("normaliseringen: gemener, hopslagen vitrymd, trimmad", () => {
    expect(normalizeHeading("  Vanliga\n  FRÅGOR ")).toBe("vanliga frågor");
    expect(normalizeHeading(null)).toBe("");
  });

  it("markören [data-angel-moved] vinner utan lokator", () => {
    const { doc, secB } = cleanPage({ markB: true });
    expect(findMovedSection(doc, null)).toBe(secB);
  });

  it("utan markör: exakt normaliserad rubrikträff ⇒ census-sektionen", () => {
    const { doc, secB } = cleanPage();
    expect(findMovedSection(doc, { tag: "h2", text: "vanliga  FRÅGOR om gluten" })).toBe(secB);
  });

  it("24-teckensreserven träffar en trunkerad lokator", () => {
    const { doc, secB } = cleanPage();
    // 120-teckenskapningen i lokatorn kan ge en prefix — reserven matchar
    // på de första 24 normaliserade tecknen.
    expect(findMovedSection(doc, { tag: "h2", text: "Vanliga frågor om glutenfri kost" })).toBe(
      secB,
    );
  });

  it("rubriker i header/nav räknas aldrig som census — krom-träff ger null", () => {
    const { doc } = cleanPage();
    expect(findMovedSection(doc, { tag: "h2", text: "Meny" })).toBeNull();
  });

  it("platt struktur (ingen ren sektionsnivå) ⇒ null — hellre ingen spotlight än fel", () => {
    // Alla rubriker i EN container utan rubrikbärande syskon.
    const flat = new FakeEl("div").add(
      new FakeEl("h2", "Rubrik A"),
      new FakeEl("h2", "Rubrik B"),
      new FakeEl("p", "text"),
    );
    const doc = new FakeDoc(new FakeEl("body").add(new FakeEl("main").add(flat)));
    expect(findMovedSection(doc, { tag: "h2", text: "Rubrik B" })).toBeNull();
  });

  it("varken markör eller lokator ⇒ null", () => {
    const { doc } = cleanPage();
    expect(findMovedSection(doc, null)).toBeNull();
  });
});
