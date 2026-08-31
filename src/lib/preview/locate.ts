// Uppslukande sandboxen: hitta den FLYTTADE sektionen i den serverade
// after-kopian, så "vad flyttades?"-spotlighten kan skrolla dit och lysa upp
// den. Två vägar, i ordning:
//
//   1. Markören [data-angel-moved] — stämplas av harness-applikatorn
//      (measure.ts, spegelvänd mot runtime-applikatorn) i kopior byggda
//      efter 2026-08-30.
//   2. Lokator-fallback för äldre kopior: samma rubrikmatchning som
//      appliceringen låstes mot — normaliserad exakt träff, sedan
//      24-teckens substrängsreserv — följt av samma census-sectionOf-regel.
//      SPEGELVÄND mot measure.ts findByLocator/sectionOf och applier.ts —
//      håll i synk; en lösare kopia här pekar spotlighten på fel sektion.
//
// DOM-åtkomsten går genom smala strukturella typer så logiken kan testas i
// node med handbyggda fejk-element (husets mönster) — ingen jsdom krävs.

export interface ElementLike {
  textContent: string | null;
  parentElement: ElementLike | null;
  children: ArrayLike<ElementLike>;
  closest(sel: string): ElementLike | null;
  contains(el: ElementLike): boolean;
  querySelectorAll(sel: string): ArrayLike<ElementLike>;
}

export interface DocumentLike {
  querySelector(sel: string): ElementLike | null;
  querySelectorAll(sel: string): ArrayLike<ElementLike>;
}

/** Rubriknormaliseringen — exakt som applikatorns (gemener, vitrymd
 *  hopslagen, trimmad). */
export function normalizeHeading(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function mainOf(doc: DocumentLike): ElementLike | DocumentLike {
  return doc.querySelector("main") ?? doc;
}

function findHeading(
  doc: DocumentLike,
  moved: { tag: string | null; text: string },
): ElementLike | null {
  const scope = mainOf(doc);
  const sel = moved.tag && /^h[1-3]$/.test(moved.tag) ? moved.tag : "h1,h2,h3";
  const heads = Array.from(scope.querySelectorAll(sel) as ArrayLike<ElementLike>);
  const want = normalizeHeading(moved.text);
  if (!want) return null;
  const exact = heads.find((h) => normalizeHeading(h.textContent) === want);
  if (exact) return exact;
  // 24-teckensreserven — samma som appliceringens fallback.
  const stub = want.slice(0, 24);
  return heads.find((h) => normalizeHeading(h.textContent).includes(stub)) ?? null;
}

/** Census-sectionOf (spegelvänd measure.ts/applier.ts): sektionen är närmsta
 *  förfader som innehåller EXAKT en census-rubrik (h2 i main, utanför
 *  header/nav/footer/aside) och vars förälder har minst ett annat
 *  census-bärande barn. Hittas ingen ren nivå ⇒ null (ingen spotlight —
 *  hellre ingen än fel). */
function sectionOf(doc: DocumentLike, headEl: ElementLike): ElementLike | null {
  const scope = mainOf(doc);
  const census = Array.from(scope.querySelectorAll("h2") as ArrayLike<ElementLike>).filter(
    (h) => !h.closest("header,nav,footer,aside"),
  );
  const countIn = (el: ElementLike) => census.filter((h) => el === h || el.contains(h)).length;
  // Vandringen börjar på FÖRÄLDERN — rubriken själv är aldrig en sektion
  // (measure.ts sectionOf startar på headEl.parentElement; en platt
  // container med flera census-rubriker vägras därmed hela vägen upp).
  let node: ElementLike | null = headEl.parentElement;
  while (node && node.parentElement) {
    const parent: ElementLike = node.parentElement;
    if (countIn(node) === 1) {
      const siblings: ElementLike[] = Array.from(parent.children);
      const current = node;
      const bearing = siblings.filter((s) => s !== current && countIn(s) > 0);
      if (bearing.length > 0) return current;
    }
    node = parent;
  }
  return null;
}

/** Den flyttade sektionen i after-kopian, eller null (⇒ ingen spotlight). */
export function findMovedSection(
  doc: DocumentLike,
  moved: { tag: string | null; text: string } | null,
): ElementLike | null {
  const marked = doc.querySelector("[data-angel-moved]");
  if (marked) return marked;
  if (!moved) return null;
  const head = findHeading(doc, moved);
  if (!head) return null;
  return sectionOf(doc, head);
}
