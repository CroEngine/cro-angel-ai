// Synlig-DOM-serialisering (kapacitet "fånga vad besökaren SER", steg 1,
// 2026-07-24). extractContentModel läser en HTML-sträng och kan inte veta vad
// CSS döljer — responsiva teman renderar mobil- OCH desktop-kopior av samma
// sektion i DOM:en och gömmer den ena med display:none. På rå outerHTML blir
// modellen då full av FANTOM-sektioner (monday: 16 rubriker, 5 fantom). Den
// webbläsar-baserade skördaren löste det för länge sedan via innerText
// (synligt-bara); redesign-vägen läste strängen och ärvde aldrig det.
//
// Denna helper ger extraktionen en synlig-bara serialisering: markera dolda
// element på LEVANDE DOM:en (behövs computed style), klona, ta bort de markerade
// ur klonen, avmarkera den levande sidan. Sidan som lyft-testet sedan mäter på
// rörs ALDRIG — bara strängen extraktionen läser blir städad.

import type { Page } from "playwright-core";

/** outerHTML för sidan med dolda delträd bortstädade (display:none /
 *  visibility:hidden / utan client-rects). Den levande `page` lämnas orörd. */
export async function serializeVisibleHtml(page: Page): Promise<string> {
  return page.evaluate(() => {
    const marked: Element[] = [];
    // Bara display:none — och det är MEDVETET (capture-eval 2026-07-24, 100-sajts-
    // svep): display:none kan ALDRIG överskuggas av ett barn, så tar vi bort ett
    // display:none-delträd kan vi omöjligt råka ta med en synlig rubrik. Det
    // fångar den responsiva mobil/desktop-dubblettvägen (som ÄR display:none).
    // visibility:hidden och clientRects===0 UTESLÖTS: en förälder med
    // visibility:hidden vars barn sätter visibility:visible är synlig, och att
    // klippa föräldern tappade riktiga sektioner (bamboohr → 0, coda −11 synliga).
    // Ett dolt FÖRÄLDER-element räcker: tas det bort ur klonen försvinner delträdet.
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (getComputedStyle(el).display === "none") {
        el.setAttribute("data-angel-hidden", "1");
        marked.push(el);
      }
    }
    const clone = document.documentElement.cloneNode(true) as Element;
    for (const n of Array.from(clone.querySelectorAll("[data-angel-hidden]"))) n.remove();
    for (const el of marked) el.removeAttribute("data-angel-hidden");
    return `<!doctype html>${clone.outerHTML}`;
  });
}
