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
  {
    // The webflow class, caught by the showcase screenshots: hero undetected
    // (real hero classifies as "content") and sections[0] is the HEADER. The
    // old anchor fallback anchored on the header and hoisted proof above the
    // real hero. The anchor must skip chrome sections → first content block
    // is the anchor → proof already sits right after it → honest refusal.
    name: "header-anchor-webflow",
    html:
      `<header id="hd" style="height:70px">nav</header>` +
      `<main id="m">${box("c1", 900, "real hero (content)")}${box("f2", 700, "f2")}${box("testi", 400, "testi")}${box("cta", 300, "cta")}</main>`,
    sections: [
      { type: "header", selector: "#hd" },
      { type: "content", selector: "#c1" },
      { type: "features", selector: "#f2" },
      { type: "testimonials", selector: "#testi", heading: "Brands" },
    ],
    expectTrail: "already-early",
    expectApplied: false,
  },
  {
    // Page-top floor: anchor is a thin top banner (mis-detection stand-in) —
    // an after-anchor move would land the proof at the very top of the page.
    // check-above-anchor alone passes (anchor bottom is tiny); the 300px
    // page-top floor must refuse.
    name: "page-top-floor",
    html: `<main id="m">${box("banner", 80, "banner")}${box("f1", 500, "f1")}${box("f2", 500, "f2")}${box("testi", 400, "testi")}${box("cta", 300, "cta")}</main>`,
    sections: [
      { type: "content", selector: "#banner" },
      { type: "features", selector: "#f1" },
      { type: "features", selector: "#f2" },
      { type: "testimonials", selector: "#testi", heading: "Proof" },
    ],
    expectTrail: "check-page-top",
    expectApplied: false,
  },
];

// v0.8 pattern cases: runtime visual acceptance for bars + emphasis. Each
// drives applyAdaptations with a hand-built inventory; overlays/collapsed
// targets must make the pattern refuse and self-undo (byte-clean page).
type PatternCase = {
  name: string;
  html: string;
  inv: Record<string, unknown>;
  expectApplied: string[]; // patternIds that MUST be in applied
  expectRefused: string[]; // patternIds that must NOT be in applied
};

const TRUST_INV = {
  ratings: [{ type: "review_rating", text: "Rated 4.8/5 by 2,000+ teams" }],
  socialProof: [],
  trustedBy: [],
  testimonials: [],
  customerLogos: [],
  reviewBadges: [],
  pressMentions: [],
  guarantees: [],
  certifications: [],
};
const HERO_CTA = [
  {
    text: "Start free trial",
    selector: "#cta",
    section: "hero",
    intent: "conversion",
    category: "cta_primary",
    aboveFold: true,
  },
];
const OVERLAY = (topPx: number, h: number) =>
  `<div id="ovl" style="position:fixed;top:${topPx}px;left:0;width:100vw;height:${h}px;background:rgba(255,255,255,.95);z-index:99999">overlay</div>`;

const PATTERN_CASES: PatternCase[] = [
  {
    // Clean page: bar + emphasis both apply and revert byte-clean.
    name: "clean-bar+emphasis",
    html: `<main>${box("hero", 500, "hero", `<a id="cta" href="#" style="display:inline-block;padding:12px 24px;background:#25e;color:#fff">Start free trial</a>`)}${box("f1", 500, "f1")}</main>`,
    inv: { trust: TRUST_INV, ctas: HERO_CTA },
    expectApplied: ["trust_bar", "emphasize_primary_cta"],
    expectRefused: [],
  },
  {
    // v0.13: the proof is ALREADY above the fold (e.g. "Trusted by 60% of the
    // Fortune 500" in the hero) — a bar would just duplicate it, so trust_bar
    // declines. Caught in the fleet gallery: monday got a second trust bar.
    name: "trust-already-above-fold",
    html: `<main>${box("hero", 500, "hero", `<a id="cta" href="#" style="display:inline-block;padding:12px 24px;background:#25e;color:#fff">Start free trial</a>`)}${box("f1", 500, "f1")}</main>`,
    inv: {
      trust: {
        ratings: [{ type: "review_rating", text: "Rated 4.8/5 by 2,000+ teams", aboveFold: true }],
        socialProof: [],
        trustedBy: [],
        testimonials: [],
        customerLogos: [],
        reviewBadges: [],
        pressMentions: [],
        guarantees: [],
        certifications: [],
      },
      ctas: HERO_CTA,
    },
    expectApplied: ["emphasize_primary_cta"],
    expectRefused: ["trust_bar"],
  },
  {
    // v0.14: the REAL clickup class (from the live inventory dump). Proof is
    // ALREADY visible above the fold (a "TRUSTED BY THE BEST" wall), AND there
    // is a DIFFERENT below-fold rating that on its own WOULD qualify as a bar
    // candidate ("Rated 4.7/5 … on G2"). trust_bar must stand down anyway —
    // surfacing the below-fold rating on top of the visible wall is precisely
    // the double-bar the user reported. (v0.13's same-signal filter missed
    // this because the surfaced proof is a DIFFERENT signal from the visible
    // one.)
    name: "proof-visible-standsdown",
    html: `<main>${box("hero", 500, "hero", `<a id="cta" href="#" style="display:inline-block;padding:12px 24px;background:#25e;color:#fff">Start free trial</a>`)}${box("f1", 500, "f1")}</main>`,
    inv: {
      trust: {
        ratings: [{ type: "review_rating", text: "Rated 4.7/5 by 10,000+ users on G2" }],
        socialProof: [],
        trustedBy: [{ type: "trusted_by", text: "TRUSTED BY THE BEST", aboveFold: true }],
        testimonials: [],
        customerLogos: [],
        reviewBadges: [],
        pressMentions: [],
        guarantees: [],
        certifications: [],
      },
      ctas: HERO_CTA,
    },
    expectApplied: ["emphasize_primary_cta"],
    expectRefused: ["trust_bar"],
  },
  {
    // The toggl/framer class: an overlay paints over the top of the page —
    // the bar would render underneath it. Runtime hit-test must refuse.
    name: "bar-covered-by-overlay",
    html: `${OVERLAY(0, 140)}<main>${box("hero", 500, "hero", `<a id="cta" href="#" style="display:inline-block;padding:12px 24px;background:#25e;color:#fff">Start free trial</a>`)}${box("f1", 500, "f1")}</main>`,
    inv: { trust: TRUST_INV, ctas: HERO_CTA },
    expectApplied: [],
    expectRefused: ["trust_bar"],
  },
  {
    // The moz class: the CTA classifier picked a collapsed (zero-size)
    // element. Emphasis must refuse instead of decorating nothing.
    name: "emphasis-collapsed",
    html: `<main>${box("hero", 500, "hero", `<a id="cta" href="#" style="display:block;width:0;height:0;overflow:hidden">Start free trial</a>`)}${box("f1", 500, "f1")}</main>`,
    inv: { trust: { ...TRUST_INV, ratings: [] }, ctas: HERO_CTA },
    expectApplied: [],
    expectRefused: ["emphasize_primary_cta"],
  },
  {
    // The front class: CTA exists but an overlay covers it at its center.
    name: "emphasis-covered",
    html: `${OVERLAY(200, 400)}<main>${box("hero", 500, "hero", `<a id="cta" href="#" style="display:inline-block;margin-top:250px;padding:12px 24px;background:#25e;color:#fff">Start free trial</a>`)}${box("f1", 500, "f1")}</main>`,
    inv: { trust: { ...TRUST_INV, ratings: [] }, ctas: HERO_CTA },
    expectApplied: [],
    expectRefused: ["emphasize_primary_cta"],
  },
  {
    // v0.14: the clickup / airtable class. The page's proof is a LOGO WALL /
    // "trusted by" strip — a section that containsTrustSignals, NOT a
    // testimonials section — sitting below the fold. Reorder must now LIFT it
    // (broadened target beyond testimonials), and trust_bar must STAND DOWN so
    // the page doesn't end up with two proof strips (the reported double-bar).
    // TRUST_INV still carries a below-fold rating, so trust_bar HAS a candidate
    // — proving it's the proofPromoted guard that stops it, not an empty pool.
    name: "logo-wall-reorder-standsdown",
    html: `<main id="m">${box("hero", 600, "hero", `<a id="cta" href="#" style="display:inline-block;padding:12px 24px;background:#25e;color:#fff">Start free trial</a>`)}${box("f1", 500, "f1")}${box("f2", 500, "f2")}${box("logos", 400, "TRUSTED BY THE BEST")}${box("cta2", 300, "cta2")}</main>`,
    inv: {
      sections: [
        { type: "hero", selector: "#hero" },
        { type: "features", selector: "#f1" },
        { type: "features", selector: "#f2" },
        { type: "content", selector: "#logos", heading: "Trusted by the best", containsTrustSignals: true },
      ],
      trust: TRUST_INV,
      ctas: HERO_CTA,
    },
    expectApplied: ["reorder_proof_first", "emphasize_primary_cta"],
    expectRefused: ["trust_bar"],
  },
];

// E3 plan cases: applyPlannedReorder must obey the same self-checks while
// widening targeting (2-kid swaps, explicit containers) — and must refuse to
// move anything that is not the proof section, no matter what the plan says.
type PlanCase = {
  name: string;
  html: string;
  sections: Array<{ type: string; selector: string; heading?: string }>;
  plan: { action: "reorder"; container: string; move: string; after: string | null; mode: "flex" | "grid" };
  expectOk: boolean;
  expectReason?: string;
};

const PLAN_CASES: PlanCase[] = [
  {
    // The auto ladder refuses 2-kid containers (kid-count); a plan may swap
    // within one — proof wrapper above a feature wrapper, both below hero.
    name: "plan-2kid-swap",
    html:
      `<main id="m">${box("hero", 700, "hero")}` +
      `<div id="grp">${box("f1", 600, "f1")}<div id="tw">${box("testi", 400, "testi")}</div></div>` +
      `${box("cta", 300, "cta")}</main>`,
    sections: [
      { type: "hero", selector: "#hero" },
      { type: "features", selector: "#f1" },
      { type: "testimonials", selector: "#testi", heading: "Proof" },
    ],
    plan: { action: "reorder", container: "#grp", move: "#tw", after: null, mode: "flex" },
    expectOk: true,
  },
  {
    // A plan may NOT move arbitrary content — only the proof section.
    name: "plan-not-proof-refused",
    html: `<main id="m">${box("hero", 700, "hero")}${box("f1", 600, "f1")}${box("f2", 500, "f2")}${box("testi", 400, "testi")}</main>`,
    sections: [
      { type: "hero", selector: "#hero" },
      { type: "features", selector: "#f1" },
      { type: "features", selector: "#f2" },
      { type: "testimonials", selector: "#testi", heading: "Proof" },
    ],
    plan: { action: "reorder", container: "#m", move: "#f2", after: "#hero", mode: "flex" },
    expectOk: false,
    expectReason: "move-not-proof-section",
  },
  {
    // Planned grid promotion on a block container (the alternative when flex
    // promotion drifts) — same checks, different mechanism.
    name: "plan-grid-mode",
    html: `<main id="m">${box("hero", 700, "hero")}${box("f1", 600, "f1")}${box("f2", 500, "f2")}${box("testi", 400, "testi")}${box("cta", 300, "cta")}</main>`,
    sections: [
      { type: "hero", selector: "#hero" },
      { type: "features", selector: "#f1" },
      { type: "features", selector: "#f2" },
      { type: "testimonials", selector: "#testi", heading: "Proof" },
    ],
    plan: { action: "reorder", container: "#m", move: "#testi", after: "#hero", mode: "grid" },
    expectOk: true,
  },
  {
    // The floor survives plans: an anchor placement that would land the proof
    // at the very top of the page must be refused even when the plan asks.
    name: "plan-page-top-refused",
    html: `<main id="m">${box("banner", 80, "banner")}${box("f1", 500, "f1")}${box("f2", 500, "f2")}${box("testi", 400, "testi")}</main>`,
    sections: [
      { type: "content", selector: "#banner" },
      { type: "features", selector: "#f1" },
      { type: "features", selector: "#f2" },
      { type: "testimonials", selector: "#testi", heading: "Proof" },
    ],
    plan: { action: "reorder", container: "#m", move: "#testi", after: "#banner", mode: "flex" },
    expectOk: false,
    expectReason: "check-page-top",
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

  for (const c of PATTERN_CASES) {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><title>${c.name}</title></head><body style="margin:0">${c.html}</body></html>`,
      { waitUntil: "domcontentloaded" },
    );
    await page.addScriptTag({ content: bundle });
    const res = await page.evaluate((inv) => {
      const lab = (window as unknown as {
        __angelLab: { apply: (inv: unknown, seg: string) => { applied: Array<{ patternId: string }>; revert: () => void } };
      }).__angelLab;
      const beforeHtml = document.body.outerHTML;
      const out = lab.apply(
        {
          sections: [],
          page: { hero: { headline: "", subheadline: "" } },
          ...(inv as Record<string, unknown>),
        },
        "engaged_no_click",
      );
      const ids = out.applied.map((a) => a.patternId);
      out.revert();
      return { ids, byteClean: beforeHtml === document.body.outerHTML };
    }, c.inv);

    const missing = c.expectApplied.filter((id) => !res.ids.includes(id));
    const leaked = c.expectRefused.filter((id) => res.ids.includes(id));
    const ok = !missing.length && !leaked.length && res.byteClean;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(22)} applied=[${res.ids.join(",")}] byteClean=${res.byteClean}${missing.length ? ` MISSING=${missing}` : ""}${leaked.length ? ` LEAKED=${leaked}` : ""}`,
    );
  }

  for (const c of PLAN_CASES) {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><title>${c.name}</title></head><body style="margin:0">${c.html}</body></html>`,
      { waitUntil: "domcontentloaded" },
    );
    await page.addScriptTag({ content: bundle });
    const res = await page.evaluate(
      ({ sections, plan }) => {
        const lab = (window as unknown as {
          __angelLab: {
            plan: (inv: unknown, p: unknown) => { ok: boolean; reason?: string; detail?: string; revert?: () => void };
          };
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
        const out = lab.plan(inv, plan);
        const topAfter = testi ? testi.getBoundingClientRect().top + window.scrollY : -1;
        if (out.ok && out.revert) out.revert();
        const afterHtml = document.body.outerHTML;
        return {
          ok: out.ok,
          reason: out.reason ?? "",
          detail: out.detail ?? "",
          lift: Math.round(topBefore - topAfter),
          byteClean: beforeHtml === afterHtml,
        };
      },
      { sections: c.sections, plan: c.plan },
    );

    const okStatus = res.ok === c.expectOk;
    const okReason = !c.expectReason || res.reason === c.expectReason;
    const okLift = !c.expectOk || res.lift >= 200;
    const ok = okStatus && okReason && okLift && res.byteClean;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(22)} ok=${res.ok} reason="${res.reason}" lift=${res.lift}px byteClean=${res.byteClean}${res.detail ? ` detail=${res.detail}` : ""}`,
    );
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
