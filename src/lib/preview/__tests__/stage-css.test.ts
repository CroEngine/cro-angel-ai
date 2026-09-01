// Scenens vh-neutralisering: v-höjder skrivs om till px vid frysviewporten
// (1vh ≡ 8.44px @ 390×844) — men BARA i CSS (<style>-block och
// style-attribut), aldrig i brödtext, och aldrig inuti data-URI:ers base64
// (delimiter-vakten). Utan omskrivningen äter en 100vh-hjälte hela
// naturhöjdsramen och höjdmätningen jagar sin egen svans (MAJOR-fyndet
// 2026-08-31).
import { describe, expect, it } from "vitest";

import { neutralizeViewportUnits, unlockRootScroll } from "../stage-css";

describe("neutralizeViewportUnits — v-höjder till frysviewport-px", () => {
  it("skriver om vh/svh/dvh/lvh i <style>-block, inklusive calc och decimaler", () => {
    const out = neutralizeViewportUnits(
      `<style>.hero{min-height:100vh;height:calc(100dvh - 50px)}.half{height: 50.5svh}.l{max-height:10lvh}</style>`,
    );
    expect(out).toContain("min-height:844.00px");
    expect(out).toContain("calc(844.00px - 50px)");
    expect(out).toContain("height: 426.22px");
    expect(out).toContain("max-height:84.40px");
    expect(out).not.toMatch(/\d(vh|svh|dvh|lvh)\b/);
  });

  it("skriver om style-attribut men lämnar brödtext orörd", () => {
    const out = neutralizeViewportUnits(
      `<section style="height:100vh"><p>Rabatten är 10vh högre i år.</p></section>`,
    );
    expect(out).toContain(`style="height:844.00px"`);
    expect(out).toContain("Rabatten är 10vh högre i år.");
  });

  it("rör aldrig base64-data (delimiter-vakten: base64-tecken föregår talet)", () => {
    const b64 = "AAAB12vhCCd99svhEE";
    const out = neutralizeViewportUnits(
      `<style>.x{background:url(data:image/png;base64,${b64});height:20vh}</style>`,
    );
    expect(out).toContain(b64);
    expect(out).toContain("height:168.80px");
  });

  it("vw lämnas orörd — bredden är fixerad 390 och har kvar sitt ankare", () => {
    const out = neutralizeViewportUnits(`<style>.w{width:50vw;height:50vh}</style>`);
    expect(out).toContain("width:50vw");
    expect(out).toContain("height:422.00px");
  });
});

// Scroll-lås-upplåsningen (stardream 2026-09-01): sidor frysta mitt i en
// cookie-modal bär body{overflow:hidden;height:844px} i kopian — scenen blev
// oskrollbar. Overriden injiceras EN gång, hakar i </head> när den finns,
// och häver bara overflow/position — aldrig höjder.
describe("unlockRootScroll — skroll-låset ur frysta modaltillstånd hävs", () => {
  it("injiceras precis före </head> när head finns", () => {
    const out = unlockRootScroll(
      `<html><head><style>body{overflow:hidden}</style></head><body>x</body></html>`,
    );
    expect(out).toMatch(/data-agritm-stage-unlock[\s\S]*<\/head>/);
    expect(out.match(/data-agritm-stage-unlock/g)).toHaveLength(1);
    expect(out).toContain("overflow:visible !important");
    expect(out).toContain("position:static !important");
  });

  it("utan </head> ⇒ direkt efter <body>-taggen; utan båda ⇒ främst", () => {
    const withBody = unlockRootScroll(`<body class="x"><p>hej</p></body>`);
    expect(withBody).toMatch(/<body class="x"><style data-agritm-stage-unlock/);
    const bare = unlockRootScroll(`<p>hej</p>`);
    expect(bare.startsWith("<style data-agritm-stage-unlock")).toBe(true);
  });

  it("höjder röres aldrig — bara overflow och position ingår i overriden", () => {
    const out = unlockRootScroll(`<head></head>`);
    expect(out).not.toMatch(/height/);
  });
});
