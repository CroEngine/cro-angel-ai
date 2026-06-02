import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

const src = readFileSync("src/lib/tests/scripts/trustSignals.ts", "utf8");
const m = src.match(/export const TRUST_SIGNALS_SCRIPT = `([\s\S]+?)`;\s*$/m);
if (!m) throw new Error("not found");
const body = m[1];

const TT_FIXTURE = `<!doctype html><html><body>
<main>
  <section class="testimonials-section">
    <div class="carousel"><div class="carousel__track"><div class="carousel__viewport">
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
    </div></div></div>
  </section>
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

const dom = new JSDOM(TT_FIXTURE, { runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
window.Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 100, width: 16, height: 16, top: 100, left: 0, right: 16, bottom: 116 };
};

// Evaluate as a real script inside the window — same as page.evaluate
const result = window.eval(`(${body})`);

console.log("total signals:", result.length);
const stars = result.filter((s) => s.type === "stars");
console.log("stars signals:", stars.length);
for (const s of stars) {
  console.log(`  rating=${s.rating} sel=${s.selector} text=${JSON.stringify(s.text)}`);
}

let fail = 0;
const inTest = stars.find((s) => s.rating === 5 && /testimonial/i.test(s.selector));
if (!inTest) { console.log("FAIL: testimonial stars rating=5 missing"); fail++; } else console.log("OK: testimonial → 5");
const inHero = stars.find((s) => /hero/i.test(s.selector));
if (inHero && typeof inHero.rating === "number") { console.log(`FAIL: hero got rating=${inHero.rating}`); fail++; } else console.log("OK: hero → no rating");

for (const s of result) if (typeof s.rating === "number" && (Number.isNaN(s.rating) || s.rating < 0 || s.rating > 5)) {
  console.log("FAIL invalid rating", s.rating); fail++;
}
process.exit(fail);
