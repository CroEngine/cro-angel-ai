import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

// Extract the script body string
const src = readFileSync("src/lib/tests/scripts/trustSignals.ts", "utf8");
const m = src.match(/export const TRUST_SIGNALS_SCRIPT = `([\s\S]+?)`;\s*$/m);
if (!m) throw new Error("script not found");
// Unescape: the source uses backslash-escaped \\b, \\d in template-literal regex.
// In a real page.evaluate the string is sent verbatim and the JS engine parses
// the escapes. We do the same by `new Function`-ing the body directly.
const scriptBody = m[1].replace(/\\`/g, "`");

const TT_FIXTURE = `<!doctype html><html><body>
<main>
  <section class="testimonials-section">
    <div class="carousel">
      <div class="carousel__track">
        <div class="carousel__viewport">
          <article class="testimonial-card">
            <div class="rating-row" aria-label="5 out of 5">
              <svg aria-label="star"><path/></svg>
              <svg aria-label="star"><path/></svg>
              <svg aria-label="star"><path/></svg>
              <svg aria-label="star"><path/></svg>
              <svg aria-label="star"><path/></svg>
            </div>
            <blockquote>Great product</blockquote>
            <div>Jasmine A.</div>
          </article>
        </div>
      </div>
    </div>
  </section>

  <!-- Hero with decorative 5 stars but NO testimonial context -->
  <section class="hero">
    <div class="rating">
      <svg aria-label="star"><path/></svg>
      <svg aria-label="star"><path/></svg>
      <svg aria-label="star"><path/></svg>
      <svg aria-label="star"><path/></svg>
      <svg aria-label="star"><path/></svg>
    </div>
  </section>
</main>
</body></html>`;

function run(html, label) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const { window } = dom;
  // jsdom getBoundingClientRect returns 0×0 by default — patch to non-zero so
  // visibility check passes for our fixture (matches "rendered" behaviour).
  window.Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 100, width: 16, height: 16, top: 100, left: 0, right: 16, bottom: 116 };
  };
  // Execute the IIFE in the jsdom window context
  const fn = new window.Function(`return ${scriptBody}`);
  const result = fn();
  const stars = result.filter((s) => s.type === "stars");
  console.log(`\n=== ${label} ===`);
  console.log(`stars signals: ${stars.length}`);
  for (const s of stars) {
    console.log(`  rating=${s.rating} text=${JSON.stringify(s.text)} selector=${s.selector}`);
  }
  // Invariants
  let bad = 0;
  for (const s of result) {
    if (typeof s.rating === "number") {
      if (Number.isNaN(s.rating) || s.rating < 0 || s.rating > 5) {
        console.log(`  !! invalid rating: ${s.rating}`);
        bad++;
      }
    }
  }
  return { stars, bad };
}

const r1 = run(TT_FIXTURE, "Teamtailor-like fixture");

// Assertions
let fail = 0;
const inTestimonial = r1.stars.find((s) => s.rating === 5 && /testimonial/i.test(s.selector));
if (!inTestimonial) {
  console.log("FAIL: expected stars rating=5 in testimonial-card context");
  fail++;
} else {
  console.log("\nOK: testimonial stars → rating=5");
}
const inHero = r1.stars.find((s) => /hero/i.test(s.selector) || (s.selector.includes("rating") && !s.selector.includes("testimonial")));
if (inHero && typeof inHero.rating === "number") {
  console.log(`FAIL: hero-decorative stars got rating=${inHero.rating} (should be undefined)`);
  fail++;
} else {
  console.log("OK: hero-decorative stars → no rating (no testimonial context)");
}
if (r1.bad > 0) { console.log(`FAIL: ${r1.bad} invalid ratings`); fail++; }

process.exit(fail);
