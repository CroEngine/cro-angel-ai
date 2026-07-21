#!/usr/bin/env bun
// Reorder LAB — offline unit rig for the v0.7 attempt loop ("chansa-loopen").
// Each case is a synthetic page reproducing one refusal class from the
// 101-site sweep; the lab asserts WHICH ladder level the loop lands on, that
// the testimonial actually lifted, and that revert() restores the page
// byte-identically (outerHTML equality — stricter than the sweep's attribute
// check, and it would catch the v0.6 style="" residue).
//
//   bun run scripts/reorder-lab.ts
import { chromium } from "playwright";

type Case = {
  name: string;
  html: string;
  sections: Array<{ type: string; selector: string; heading?: string }>;
  // expected: substring the reorder trail must contain, or null for "must not apply"
  expectTrail: string;
  expectApplied: boolean;
};

const box = (id: string, h: number, label: string, inner = "") =>
  `<div id="${id}" style="height:${h}px;background:#eee;margin:0">${label}${inner}</div>`;

const CASES: Case[] = [
  {
    // v0.6.1 baseline class: flat block parent, hero + fillers + testi as
    // direct siblings → the L0 after-hero move must still pass (regression).
    name: "flat-block-L0",
    html: `<main id="m">${box("hero", 600, "hero")}${box("f1", 500, "f1")}${box("f2", 500, "f2")}${box("testi", 400, "testi")}${box("cta", 300, "cta")}</main>`,
    sections: [
      { type: "hero", selector: "#hero" },
      { type: "features", selector: "#f1" },
      { type: "features", selector: "#f2" },
      { type: "testimonials", selector: "#testi", heading: "Loved by teams" },
    ],
    expectTrail: "L0:PASS",
    expectApplied: true,
  },
  {
    // The 10-site refusal class: at the LCA the testimonial's wrapper carries
    // other sections → L0 refuses, the loop descends INTO the wrapper and
    // moves the testimonial to the top of its own group (front move).
    name: "wrapper-carries-L1",
    html:
      `<main id="m">` +
      `<div id="wrapA">${box("hero", 600, "hero")}${box("f1", 500, "f1")}</div>` +
      `<div id="wrapB">${box("f2", 700, "f2")}${box("testi", 400, "testi")}${box("f3", 500, "f3")}</div>` +
      `<div id="wrapC">${box("cta", 300, "cta")}</div>` +
      `</main>`,
    sections: [
      { type: "hero", selector: "#hero" },
      { type: "features", selector: "#f1" },
      { type: "features", selector: "#f2" },
      { type: "testimonials", selector: "#testi", heading: "Customers" },
      { type: "features", selector: "#f3" },
    ],
    expectTrail: "wrapper-carries-other-sections;L1:PASS",
    expectApplied: true,
  },
  {
    // The 9-site refusal class (no common ancestor below <body>): hero and
    // testimonial live in different top-level trees → only the local front
    // move inside the testimonial's own container remains.
    name: "split-trees-front",
    html:
      `<div id="top">${box("hero", 600, "hero")}${box("f1", 400, "f1")}</div>` +
      `<div id="mainwrap">${box("f2", 700, "f2")}${box("f3", 600, "f3")}${box("testi", 400, "testi")}${box("cta", 300, "cta")}</div>`,
    sections: [
      { type: "hero", selector: "#hero" },
      { type: "features", selector: "#f1" },
      { type: "features", selector: "#f2" },
      { type: "features", selector: "#f3" },
      { type: "testimonials", selector: "#testi", heading: "Reviews" },
    ],
    expectTrail: "L0:PASS",
    expectApplied: true,
  },
  {
    // Check-failure at L0 (flex promotion un-collapses sibling margins →
    // doc height blows past tolerance) but an inner container passes → the
    // loop must land at L1 instead of refusing outright.
    name: "l0-fails-l1-passes",
    html:
      `<main id="m">` +
      `<div id="heroWrap" style="margin:120px 0">${box("hero", 600, "hero")}</div>` +
      `<div id="w1" style="margin:120px 0">${box("f1", 500, "f1")}${box("f2", 500, "f2")}</div>` +
      `<div id="testiWrap" style="margin:120px 0">${box("banner", 400, "banner")}${box("promo", 400, "promo")}${box("testi", 400, "testi")}</div>` +
      `</main>`,
    sections: [
      { type: "hero", selector: "#hero" },
      { type: "features", selector: "#f1" },
      { type: "features", selector: "#f2" },
      { type: "testimonials", selector: "#testi", heading: "Proof" },
    ],
    expectTrail: "L1:PASS",
    expectApplied: true,
  },
  {
    // Explicit grid where `order` has no visual effect (grid-template-rows +
    // explicit row placement): v0.6 shipped this as a silent no-op "applied";
    // v0.7's no-improvement check must refuse it.
    name: "explicit-grid-noop",
    html:
      `<main id="m" style="display:grid;grid-template-rows:auto auto auto auto auto">` +
      `<div id="hero" style="grid-row:1;height:600px">hero</div>` +
      `<div id="f1" style="grid-row:2;height:500px">f1</div>` +
      `<div id="f2" style="grid-row:3;height:500px">f2</div>` +
      `<div id="testi" style="grid-row:4;height:400px">testi</div>` +
      `<div id="cta" style="grid-row:5;height:300px">cta</div>` +
      `</main>`,
    sections: [
      { type: "hero", selector: "#hero" },
      { type: "features", selector: "#f1" },
      { type: "features", selector: "#f2" },
      { type: "testimonials", selector: "#testi", heading: "Quotes" },
    ],
    expectTrail: "no-improvement",
    expectApplied: false,
  },
  {
    // Proof already sits early → nothing to gain, loop never starts.
    name: "already-early",
    html: `<main id="m">${box("hero", 600, "hero")}${box("testi", 400, "testi")}${box("f1", 500, "f1")}</main>`,
    sections: [
      { type: "hero", selector: "#hero" },
      { type: "testimonials", selector: "#testi" },
      { type: "features", selector: "#f1" },
    ],
    expectTrail: "already-early",
    expectApplied: false,
  },
];

async function main() {
  const entry = await Bun.build({
    entrypoints: ["scripts/reorder-lab-entry.ts"],
    target: "browser",
    format: "iife",
  });
  if (!entry.success) {
    console.error("lab entry build failed", entry.logs);
    process.exit(1);
  }
  const bundle = await entry.outputs[0].text();

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let failures = 0;

  for (const c of CASES) {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><title>${c.name}</title></head><body style="margin:0">${c.html}</body></html>`,
      { waitUntil: "domcontentloaded" },
    );
    await page.addScriptTag({ content: bundle });
    const res = await page.evaluate((sections) => {
      const lab = (window as unknown as {
        __angelLab: { apply: (inv: unknown, seg: string) => { applied: Array<{ patternId: string; detail: string }>; revert: () => void } };
      }).__angelLab;
      const beforeHtml = document.body.outerHTML;
      const testi = document.querySelector("#testi") as HTMLElement | null;
      const topBefore = testi ? testi.getBoundingClientRect().top + window.scrollY : -1;
      const inv = {
        sections,
        trust: { ratings: [], socialProof: [], trustedBy: [], testimonials: [], guarantees: [], certifications: [] },
        ctas: [],
        page: { hero: { headline: "", subheadline: "" } },
      };
      const out = lab.apply(inv, "engaged_no_click");
      const reordered = out.applied.find((a) => a.patternId === "reorder_proof_first") ?? null;
      const topAfter = testi ? testi.getBoundingClientRect().top + window.scrollY : -1;
      const trail = (window as unknown as { __angelReorderWhy?: string }).__angelReorderWhy ?? "";
      out.revert();
      const afterHtml = document.body.outerHTML;
      return {
        trail,
        applied: !!reordered,
        detail: reordered?.detail ?? "",
        lift: Math.round(topBefore - topAfter),
        byteClean: beforeHtml === afterHtml,
      };
    }, c.sections);

    const okTrail = res.trail.includes(c.expectTrail);
    const okApplied = res.applied === c.expectApplied;
    const okLift = !c.expectApplied || res.lift >= 200;
    const ok = okTrail && okApplied && okLift && res.byteClean;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(22)} trail="${res.trail}" applied=${res.applied} lift=${res.lift}px byteClean=${res.byteClean}${res.detail ? ` detail=${res.detail}` : ""}`,
    );
    if (!okTrail) console.log(`      expected trail to contain "${c.expectTrail}"`);
  }

  await browser.close();
  if (failures) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
  }
  console.log("\nall reorder-lab cases pass");
}

main().catch((e) => {
  console.error("lab failed:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
