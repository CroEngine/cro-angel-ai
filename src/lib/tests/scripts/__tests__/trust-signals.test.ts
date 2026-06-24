// Trust-signal detection — accuracy regression suite (extractor v1.8.0).
//
// Locks in six fixes found by replaying real frozen captures (supabase, rei,
// airbnb, patagonia, vercel, gymshark, notion) against ground truth:
//   1. Short-block sentence-anchor exemption — the old start+end anchor required
//      a keyword to occupy a whole sentence, so ~2/3 of real trust copy
//      ("GDPR Compliant", "30-day money-back guarantee", "As seen in TechCrunch",
//      "Trusted by 4,000+ companies", "Rated 4.8 out of 5 by 2,341 customers")
//      was silently dropped. Recovered supabase 0→8, airbnb 0→11, hubspot +1.
//   2. The anchor still guards LONG prose, so an incidental keyword buried in a
//      paragraph is NOT a signal.
//   3. Payment-method strip requires >=2 distinct brands — a lone Stripe/Klarna/
//      PayPal image is a customer logo, not a checkout badge.
//   4. trusted_by vs press_mention no longer double-type the same "As seen in" line.
//   5. Star clusters ignore CSS-utility false friends ("items-start",
//      "col-start-2", "row-start-1" all contain "star") that produced phantom
//      ratings (vercel "avg 1.33", patagonia "avg 0") — while real star widgets
//      (rei "avg 4.52") survive.
//   6. Guarantee catches bare "guarantee"/"warranty" (patagonia Ironclad Guarantee).
//   7. "N reviews · X/5" in one block counts once (review_rating), not twice.
//
// Real engine required: jsdom does no layout, so getBoundingClientRect /
// visibility gating can't reproduce detection. Skipped where chromium can't
// launch (same as the render-canary / walker / ctas-logo behavior layers);
// runs in CI's Playwright job.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { TRUST_SIGNALS_SCRIPT } from "../trustSignals";

type Signal = { type: string; text?: string; rating?: number; reviewCount?: number };

let browser: Browser | null = null;
let context: BrowserContext;
let page: Page;
let chromiumAvailable = false;

beforeAll(async () => {
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    browser = await chromium.launch({ headless: true, executablePath });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    page = await context.newPage();
    chromiumAvailable = true;
  } catch (e) {
    console.warn(
      `[trust-signals.test] Chromium kunde inte starta — skip:ar suiten. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
});

afterAll(async () => {
  await browser?.close();
});

async function detect(html: string): Promise<{ types: Set<string>; signals: Signal[] }> {
  await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
  const res = (await page.evaluate(TRUST_SIGNALS_SCRIPT)) as { signals: Signal[] };
  return { types: new Set(res.signals.map((s) => s.type)), signals: res.signals };
}

// a 1x1 gif that decodes, so CSS width/height is honoured; distinct #frag keeps
// the global src-dedup from collapsing the strip to one logo.
const PX = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const logo = (alt: string, w = 120, h = 40) =>
  `<img src="${PX}#${encodeURIComponent(alt)}" alt="${alt}" style="width:${w}px;height:${h}px;display:inline-block">`;

describe("trust signals — short-block sentence-anchor exemption (recall)", () => {
  const cases: Array<[string, string, string]> = [
    ["certification", "GDPR/SOC2/ISO badges", `<footer><div><span>GDPR Compliant</span><span>SOC 2 Type II Certified</span><span>ISO 27001 Certified</span></div></footer>`],
    ["certification", "inline cert sentence", `<p>We are SOC 2 Type II certified and fully GDPR compliant.</p>`],
    ["guarantee", "30-day money-back badge", `<div><strong>30-day money-back guarantee</strong></div>`],
    ["press_mention", "as seen in strip", `<p>As seen in TechCrunch, Forbes and Wired</p>`],
    ["trusted_by", "trusted by N companies", `<h2>Trusted by 4,000+ companies worldwide</h2>`],
    ["review_rating", "rated 4.8/5 inline", `<p>Rated 4.8 out of 5 by 2,341 customers on Trustpilot</p>`],
    ["social_proof_count", "join N customers", `<p>Join 50,000+ customers growing with us</p>`],
    ["secure_payment", "SSL checkout text", `<span>Secure checkout with 256-bit SSL encryption</span>`],
  ];
  for (const [type, name, html] of cases) {
    test(`detects ${type} — ${name}`, async (ctx) => {
      if (!chromiumAvailable) return ctx.skip();
      const { types } = await detect(html);
      expect(types.has(type)).toBe(true);
    });
  }
});

describe("trust signals — long-prose precision (no incidental keyword false positives)", () => {
  test("'used by' buried in a paragraph is not trusted_by", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(
      `<p>The layout engine is used by the renderer to compute geometry before the first paint, a step that on older mobile devices can take several hundred milliseconds and dominates perceived load time.</p>`,
    );
    expect(types.has("trusted_by")).toBe(false);
  });
  test("'certified' deep in prose is not certification", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(
      `<p>Our onboarding specialists walk you through every step of the migration, and because each of them is individually certified on the platform you can be confident nothing falls through the cracks.</p>`,
    );
    expect(types.has("certification")).toBe(false);
  });
  test("'guarantee' in a long disclaimer is not a guarantee signal", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(
      `<p>While we strive for high availability, we cannot guarantee uninterrupted service during scheduled maintenance windows, and downtime outside our control is excluded from any service commitments described here.</p>`,
    );
    expect(types.has("guarantee")).toBe(false);
  });
});

describe("trust signals — payment strip requires >=2 distinct brands", () => {
  test("a real multi-brand payment strip is secure_payment", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(
      `<footer><ul>${["Visa", "Mastercard", "American Express", "PayPal"].map((b) => logo(b, 50, 32)).join("")}</ul></footer>`,
    );
    expect(types.has("secure_payment")).toBe(true);
  });
  test("a lone Stripe customer logo is NOT secure_payment", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(`<section>${logo("Stripe")}<h2>Build payments</h2></section>`);
    expect(types.has("secure_payment")).toBe(false);
  });
});

describe("trust signals — trusted_by vs press_mention are not double-typed", () => {
  test("'As seen in …' is press_mention only", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(`<p>As seen in TechCrunch, Forbes and Wired</p>`);
    expect(types.has("press_mention")).toBe(true);
    expect(types.has("trusted_by")).toBe(false);
  });
  test("'Trusted by …' is trusted_by only", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(`<h2>Trusted by 4,000+ companies worldwide</h2>`);
    expect(types.has("trusted_by")).toBe(true);
    expect(types.has("press_mention")).toBe(false);
  });
});

describe("trust signals — star clusters ignore CSS-utility false friends", () => {
  test("a grid of items-start / col-start / row-start cells is not a star rating", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Every class below contains the substring "star". Pre-fix these collected
    // as a 3-node "star cluster" and produced a phantom stars_aggregate.
    const { types } = await detect(
      `<div style="display:grid">` +
        `<div class="items-start" style="width:40px;height:20px">A</div>` +
        `<div class="col-start-2" style="width:40px;height:20px">B</div>` +
        `<div class="row-start-1 self-start" style="width:40px;height:20px">C</div>` +
        `</div>`,
    );
    expect(types.has("stars")).toBe(false);
    expect(types.has("stars_aggregate")).toBe(false);
  });
  test("a real star widget (class*='star-rating') still registers", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const star = `<span class="star-rating__star is-filled" style="display:inline-block;width:16px;height:16px">★</span>`;
    const { types } = await detect(
      `<div class="review-card"><div class="star-rating" aria-label="Rated 5 out of 5 stars">${star}${star}${star}${star}${star}</div><p>Great product</p></div>`,
    );
    expect(types.has("stars_aggregate")).toBe(true);
  });
});

describe("trust signals — guarantee catches bare guarantee / warranty", () => {
  test("'Ironclad Guarantee' badge", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(`<div><strong>Ironclad Guarantee</strong></div>`);
    expect(types.has("guarantee")).toBe(true);
  });
  test("'Lifetime Warranty' badge", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(`<span>Lifetime Warranty on all frames</span>`);
    expect(types.has("guarantee")).toBe(true);
  });
});

describe("trust signals — a rating block is not also counted as social proof", () => {
  test("'1,306 reviews · 4.6 out of 5' is review_rating, not social_proof_count", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(
      `<div>Trailmade Pants — 1,306 reviews with an average rating of 4.6 out of 5 stars</div>`,
    );
    expect(types.has("review_rating")).toBe(true);
    expect(types.has("social_proof_count")).toBe(false);
  });
});

describe("trust signals — customer-logo walls, img + svg (recall + precision)", () => {
  // varying-width, short inline-svg wordmarks (vercel/intercom/linear render
  // their "trusted by" logos this way; the <img> pass can't see them).
  const wordmark = (w: number, h = 22) => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect/></svg>`;
  const square = (s = 50) => `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect/></svg>`;

  test("a wordmark wall (>=6, varying widths, wider-than-tall) is detected with no context", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { signals } = await detect(
      `<section><div style="display:flex;gap:24px">${[120, 60, 95, 140, 72, 108].map((w) => wordmark(w)).join("")}</div></section>`,
    );
    const cl = signals.find((s) => s.type === "customer_logos");
    expect(cl).toBeTruthy();
  });

  test("a small (5) unlabeled wordmark strip is NOT a wall (booking sister-brand FP)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // No logo/customer context, no "logo" in markup, only 5 thin wordmarks —
    // the shape that made booking.com's sister-brand strip read as customer logos.
    const { types } = await detect(
      `<footer><div style="display:flex;gap:16px">${[120, 60, 95, 140, 72].map((w) => wordmark(w, 16)).join("")}</div></footer>`,
    );
    expect(types.has("customer_logos")).toBe(false);
  });

  test("a uniform-square svg cluster IS detected when the container has logo context", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(
      `<section class="customer-logos"><div>${[0, 0, 0, 0, 0].map(() => square(56)).join("")}</div></section>`,
    );
    expect(types.has("customer_logos")).toBe(true);
  });

  test("a uniform-square ICON grid with no logo context is NOT a logo wall", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // 6 identical 48x48 squares in a "feature-grid" — the false-positive shape.
    const { types } = await detect(
      `<section class="feature-grid"><div>${[0, 0, 0, 0, 0, 0].map(() => square(48)).join("")}</div></section>`,
    );
    expect(types.has("customer_logos")).toBe(false);
  });

  test("fewer than 4 logo svgs is not a wall", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(
      `<section class="logos"><div>${[120, 80, 100].map((w) => wordmark(w)).join("")}</div></section>`,
    );
    expect(types.has("customer_logos")).toBe(false);
  });

  test("multiple logo strips count once (single customer_logos signal)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const strip = `<div class="logos" style="display:flex;gap:20px">${[120, 60, 95, 140, 72].map((w) => wordmark(w)).join("")}</div>`;
    const { signals } = await detect(`<section>${strip}<hr>${strip}</section>`);
    expect(signals.filter((s) => s.type === "customer_logos").length).toBe(1);
  });

  // --- <img> walls (unified with svg) + the media false-positive guard ---

  test("an <img> wordmark wall (varying widths) is detected", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(
      `<section><div style="display:flex;gap:20px">${[
        logo("a", 120, 24),
        logo("b", 64, 22),
        logo("c", 96, 20),
        logo("d", 140, 26),
        logo("e", 72, 22),
        logo("f", 108, 24),
      ].join("")}</div></section>`,
    );
    expect(types.has("customer_logos")).toBe(true);
  });

  test("a uniform <img> grid with 'logo' in alt/src is detected", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const { types } = await detect(
      `<section><div>${[0, 0, 0, 0, 0].map((_, i) => logo(`brand${i} logo`, 80, 40)).join("")}</div></section>`,
    );
    expect(types.has("customer_logos")).toBe(true);
  });

  test("a uniform-square <img> thumbnail grid with no logo signal is NOT a wall (the media FP)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // 6 square photos, generic alt, container has no logo/customer context —
    // the shape that made The Verge's article thumbnails read as 33 logos.
    const { types } = await detect(
      `<section class="article-grid"><div>${[
        "Top stories today",
        "Breaking news roundup",
        "Editor's picks",
        "Latest reviews",
        "Trending now",
        "More coverage",
      ].map((alt) => logo(alt, 80, 80)).join("")}</div></section>`,
    );
    expect(types.has("customer_logos")).toBe(false);
  });
});

describe("trust signals — coverage fixes surfaced by the ground-truth benchmark", () => {
  // guarantee: plural "Returns", "free/easy returns", "X-day returns",
  // "returns & exchanges" — gymshark/warby-parker/everlane were missed because
  // only singular "return policy" matched.
  for (const [name, html] of [
    ["Returns Policy (plural)", `<footer><ul><li><a href="/r">Returns Policy</a></li></ul></footer>`],
    ["Free 30-day returns", `<span>Free 30-day returns</span>`],
    ["Easy Returns", `<div><strong>30-Day Easy Returns</strong></div>`],
    ["Returns & Exchanges", `<footer><ul><li><a href="/r">Returns &amp; Exchanges</a></li></ul></footer>`],
  ] as const) {
    test(`guarantee detects: ${name}`, async (ctx) => {
      if (!chromiumAvailable) return ctx.skip();
      expect((await detect(html)).types.has("guarantee")).toBe(true);
    });
  }

  // social_proof_count: non-customer units (companies/people/teams) + abbreviated
  // numbers (150K, 119m, 2B) — loom/stripe/klarna were missed.
  for (const [name, html] of [
    ["400,000 companies", `<p>Powering 400,000 companies worldwide</p>`],
    ["150K+ users", `<p>150K+ users have their best day on us</p>`],
    ["119m users (lowercase m)", `<span>119m users worldwide</span>`],
    ["1,230,201 people", `<p>Join 5,000+ companies and 1,230,201 people</p>`],
  ] as const) {
    test(`social_proof_count detects: ${name}`, async (ctx) => {
      if (!chromiumAvailable) return ctx.skip();
      expect((await detect(html)).types.has("social_proof_count")).toBe(true);
    });
  }

  test("social_proof_count does NOT fire on a small headcount ('team of 5 people')", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    expect((await detect(`<p>We are a small team of 5 people based in Berlin.</p>`)).types.has("social_proof_count")).toBe(false);
  });

  // certification: bare "certified" must not match a PARTNER certification
  // ("Stripe-certified experts") while real compliance certs still match.
  test("certification ignores 'X-certified experts' (partner cert)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    expect((await detect(`<p>Work with our Stripe-certified experts.</p>`)).types.has("certification")).toBe(false);
  });
  test("certification still detects 'SOC 2 Type II certified'", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    expect((await detect(`<span>SOC 2 Type II certified</span>`)).types.has("certification")).toBe(true);
  });

  // review_badges: a real G2 badge fires; app-store download badges do not.
  test("review_badges detects a real G2 badge image", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const img = `<img src="${PX}#g2" alt="G2 High Performer Spring 2026" style="width:120px;height:150px;display:inline-block">`;
    expect((await detect(`<section>${img}</section>`)).types.has("review_badges")).toBe(true);
  });
  test("review_badges ignores an app-store download badge", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // alt names a review-ish title AND the store -> the app-store guard wins.
    const img = `<img src="${PX}#s" alt="Top Rated — Get it on Google Play" style="width:135px;height:140px;display:inline-block">`;
    expect((await detect(`<section>${img}</section>`)).types.has("review_badges")).toBe(false);
  });
});
