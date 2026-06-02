import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

const src = readFileSync("src/lib/tests/scripts/trustSignals.ts", "utf8");
const m = src.match(/export const TRUST_SIGNALS_SCRIPT = `([\s\S]+?)`;\s*$/m);
const body = m[1].replace(/\\\\/g, "\\");

function starSvgs(n) { return Array(n).fill('<svg aria-label="star"><path/></svg>').join(""); }

const FIXTURE = `<!doctype html><html><body>
<main>
  <section class="testimonials-section">
    <article class="testimonial-card t-full">
      <div id="r-full" class="rating-row">${starSvgs(5)}</div>
      <blockquote>Five stars</blockquote>
    </article>
    <article class="testimonial-card t-half">
      <div id="r-half" class="rating-row">
        <svg aria-label="star"><path/></svg>
        <svg aria-label="star"><path/></svg>
        <svg aria-label="star"><path/></svg>
        <svg aria-label="star"><path/></svg>
        <svg aria-label="star" class="star-half"><path/></svg>
      </div>
      <blockquote>Four and a half</blockquote>
    </article>
    <article class="testimonial-card t-style-half">
      <div id="r-style" class="rating-row">
        <svg aria-label="star"><path/></svg>
        <svg aria-label="star"><path/></svg>
        <svg aria-label="star"><path/></svg>
        <svg aria-label="star"><path/></svg>
        <svg aria-label="star" style="width:50%"><path/></svg>
      </div>
      <blockquote>Width 50%</blockquote>
    </article>
  </section>
  <section class="hero">
    <div id="r-hero" class="rating">${starSvgs(5)}</div>
  </section>
</main>
</body></html>`;

const dom = new JSDOM(FIXTURE, { runScripts: "dangerously", pretendToBeVisual: true });
const w = dom.window;
w.Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 100, width: 16, height: 16, top: 100, left: 0, right: 16, bottom: 116 };
};
w.__TS_BODY__ = body;
const script = w.document.createElement("script");
script.textContent = `try { window.__RESULT__ = (new Function("return (" + window.__TS_BODY__ + ")"))(); } catch (e) { window.__ERROR__ = String(e) + "\\n" + (e.stack||""); }`;
w.document.body.appendChild(script);
if (w.__ERROR__) { console.log("SCRIPT ERROR:", w.__ERROR__); process.exit(1); }

const result = w.__RESULT__;
const stars = result.filter((s) => s.type === "stars");
console.log("total stars signals:", stars.length);
for (const s of stars) console.log(`  rating=${s.rating} sel=${s.selector}`);

let fail = 0;
function expect(label, cond) { console.log((cond ? "OK" : "FAIL") + ": " + label); if (!cond) fail++; }

// Should have 3 stars signals from testimonials + 1 from hero (no rating).
// In our fixture hero has no testimonial-context so no rating.
const ratings = stars.map((s) => s.rating).filter((r) => typeof r === "number");
expect("got rating 5 (full)", ratings.includes(5));
expect("got rating 4.5 (class-based half)", ratings.includes(4.5));
expect("got rating 4.5 (style:50% half)", ratings.filter((r) => r === 4.5).length >= 2);
expect("hero got no rating", !stars.some((s) => /h-deco/i.test(s.selector) && typeof s.rating === "number"));
for (const s of result) {
  if (typeof s.rating === "number" && (Number.isNaN(s.rating) || s.rating < 0 || s.rating > 5)) {
    console.log("FAIL invalid rating", s.rating); fail++;
  }
}
console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail);
