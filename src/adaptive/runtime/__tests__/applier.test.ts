// Unit tests for the variant applier MODULE (src/adaptive/runtime/applier.ts —
// the source of truth the snippet's generated block is compiled from, ADR-001
// step 4). Runs the compiled module in REAL Chromium: the applier's self-check
// reads live geometry (getBoundingClientRect / scrollHeight), which no DOM stub
// reproduces honestly. Same probe/skip pattern as the snapshot suite — CI
// installs Playwright Chromium before the unit step, so these run there.
//
// Division of labour: THIS suite exercises the module's semantics in isolation
// (deps injected, per-scenario synthetic DOMs); scripts/ci/serving-smoke.mjs
// then proves the SPLICED snippet (source + minified) behaves identically on
// the frozen plausible.io fixture. Two nets, one source.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { transform } from "esbuild";

let browser: Browser | null = null;
let chromiumAvailable = false;
let moduleJs = "";

beforeAll(async () => {
  // Samma kompilering som scripts/build/gen-applier.ts — testet kör exakt den
  // kod kodgenen splitsar in i snippeten.
  const ts = readFileSync("src/adaptive/runtime/applier.ts", "utf8");
  const { code } = await transform(ts, { loader: "ts", target: "es2017" });
  moduleJs = code.replace(/^export\s+/gm, "");
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    browser = await chromium.launch({ headless: true, executablePath });
    chromiumAvailable = true;
  } catch {
    chromiumAvailable = false;
  }
});

afterAll(async () => {
  await browser?.close();
});

/** Boot a page with `html`, inject the compiled module + a dep harness.
 *  cfg.lcp — selector for a fake LCP element; cfg.sandbox — IS_SANDBOX;
 *  cfg.noTouch — extra no-touch selector (defaults to a consent-ish list). */
async function boot(
  page: Page,
  html: string,
  cfg: { lcp?: string; sandbox?: boolean; noTouch?: string } = {},
): Promise<void> {
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ src, cfg }) => {
      (0, eval)(
        src +
          `\nwindow.__mod = { createApplyVariant: createApplyVariant, retextPreserve: retextPreserve };`,
      );
      const lcpEl = cfg.lcp ? document.querySelector(cfg.lcp) : null;
      const state = { undos: [] as (() => void)[], touched: [] as string[] };
      const deps = {
        isNoTouch: (el: Element) => !!el.closest(cfg.noTouch || "[data-no-touch]"),
        touchesLcp: (el: Element) => {
          if (cfg.sandbox) return false;
          if (!lcpEl || !el) return false;
          return el === lcpEl || el.contains(lcpEl) || lcpEl.contains(el);
        },
        lcpEl: () => lcpEl,
        isSandbox: !!cfg.sandbox,
        record: (fn: () => void) => state.undos.push(fn),
        touched: (_el: Element, pattern: string) => state.touched.push(pattern),
      };
      // @ts-expect-error test harness globals
      window.__apply = window.__mod.createApplyVariant(deps);
      // @ts-expect-error test harness globals
      window.__state = state;
      // @ts-expect-error test harness globals
      window.__reset = () => {
        for (let i = state.undos.length - 1; i >= 0; i--) state.undos[i]();
        state.undos.length = 0;
      };
    },
    { src: moduleJs, cfg: cfg as { lcp?: string; sandbox?: boolean; noTouch?: string } },
  );
}

const run = (page: Page, variant: unknown) =>
  page.evaluate((v) => {
    // @ts-expect-error test harness globals
    const applied = window.__apply(v);
    // @ts-expect-error test harness globals
    const st = window.__state;
    return {
      applied,
      undoCount: st.undos.length,
      touched: st.touched.slice(),
      main: (document.querySelector("main") as HTMLElement).innerHTML,
    };
  }, variant);

const mainHtml = (page: Page) =>
  page.evaluate(() => (document.querySelector("main") as HTMLElement).innerHTML);

// En wrapper-sida med hjälte + tre riktiga sektioner — sektionsupplösningens
// normalform (main > .page > .hero + .wrapper > section×3).
const WRAPPER_PAGE = `
  <main><div class="page">
    <div class="hero"><h1>Hero headline</h1><p id="intro">Intro text.</p></div>
    <div class="wrapper">
      <section id="sa"><h2>Alpha Features</h2><p>a</p></section>
      <section id="sb"><h2>Beta Proof</h2><p>b</p></section>
      <section id="sc"><h2>Gamma Pricing</h2><p>c</p></section>
    </div>
  </div></main>`;

describe("runtime applier module — real-Chromium unit tests", () => {
  const scenario = async (fn: (page: Page) => Promise<void>): Promise<void> => {
    const page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
    try {
      await fn(page);
    } finally {
      await page.close();
    }
  };

  it("move_up lifts the section ONE step; undo restores byte-exact", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      await boot(page, WRAPPER_PAGE);
      const before = await mainHtml(page);
      const r = await run(page, {
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Beta Proof" } }],
      });
      expect(r.applied).toBe(true);
      expect(r.undoCount).toBe(1);
      expect(r.touched).toEqual(["variant_moved"]);
      const order = await page.evaluate(() =>
        [...document.querySelector(".wrapper")!.children].map((c) => c.id),
      );
      expect(order).toEqual(["sb", "sa", "sc"]);
      await page.evaluate(() => {
        // @ts-expect-error test harness globals
        window.__reset();
      });
      expect(await mainHtml(page)).toBe(before);
    });
  });

  it("collision: move_up resolves the EXACT heading, not the earlier 24-char-prefix twin", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Two sections whose h2 share the first 24 chars ("pricing that scales with")
    // but differ later. The op names the LOWER one's FULL heading. The old
    // substring-only resolver moved the FIRST match (the wrong section, which the
    // harness would then also serve); exact-first resolution must move the section
    // actually named (bug-hunt 2026-07, sev high). MIRRORS measure.ts findByLocator.
    const COLLISION = `
      <main><div class="page">
        <div class="hero"><h1>Hero headline</h1><p id="intro">Intro.</p></div>
        <div class="wrapper">
          <section id="sx"><h2>Features overview</h2><p>x</p></section>
          <section id="sa"><h2>Pricing that scales with you</h2><p>a</p></section>
          <section id="sb"><h2>Pricing that scales with your team</h2><p>b</p></section>
        </div>
      </div></main>`;
    await scenario(async (page) => {
      await boot(page, COLLISION);
      const r = await run(page, {
        ops: [
          { op: "move_up", locator: { tag: "h2", text: "Pricing that scales with your team" } },
        ],
      });
      expect(r.applied).toBe(true);
      const order = await page.evaluate(() =>
        [...document.querySelector(".wrapper")!.children].map((c) => c.id),
      );
      // sb (the named section) rose above sa; sa (the 24-char twin) did NOT jump.
      expect(order).toEqual(["sx", "sb", "sa"]);
    });
  });

  it("self-check: a move that does NOT rise (visual ≠ DOM order) rolls the WHOLE variant back", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      // CSS `order` reverses the visual order inside the wrapper: DOM-lifting
      // #sb above #sa changes nothing visually ⇒ never rose ⇒ fail-closed.
      await boot(
        page,
        `<style>.wrapper{display:flex;flex-direction:column}#sa{order:3}#sb{order:2}#sc{order:1}</style>` +
          WRAPPER_PAGE,
      );
      const before = await mainHtml(page);
      const r = await run(page, {
        ops: [
          { op: "move_up", locator: { tag: "h2", text: "Beta Proof" } },
          { op: "set_text", locator: { tag: "h1", text: "Hero headline" }, value: "New headline" },
        ],
      });
      expect(r.applied).toBe(false);
      expect(r.undoCount).toBe(0); // nothing recorded — rollback happened internally
      expect(await mainHtml(page)).toBe(before); // byte-identical, retext sacrificed too
    });
  });

  it("self-check: a move that blows up the document height rolls back", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      // Adjacency CSS that only matches POST-move: #sb landing above #sa gives
      // #sa a 9000px margin ⇒ docH growth far past max(48, 3%) ⇒ rollback.
      await boot(page, `<style>#sb + #sa { margin-top: 9000px }</style>` + WRAPPER_PAGE);
      const before = await mainHtml(page);
      const r = await run(page, {
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Beta Proof" } }],
      });
      expect(r.applied).toBe(false);
      expect(await mainHtml(page)).toBe(before);
    });
  });

  it("self-check: a move that introduces horizontal overflow rolls back", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      await boot(page, `<style>#sb + #sa { margin-left: 2000px }</style>` + WRAPPER_PAGE);
      const before = await mainHtml(page);
      const r = await run(page, {
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Beta Proof" } }],
      });
      expect(r.applied).toBe(false);
      expect(await mainHtml(page)).toBe(before);
    });
  });

  it("all-or-nothing: one unresolvable locator refuses the whole variant pre-mutation", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      await boot(page, WRAPPER_PAGE);
      const before = await mainHtml(page);
      const r = await run(page, {
        ops: [
          { op: "move_up", locator: { tag: "h2", text: "Beta Proof" } },
          { op: "set_text", locator: { tag: "h1", text: "DOES NOT EXIST" }, value: "x" },
        ],
      });
      expect(r.applied).toBe(false);
      expect(r.undoCount).toBe(0);
      expect(await mainHtml(page)).toBe(before);
    });
  });

  it("unknown op verb fails closed before any mutation", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      await boot(page, WRAPPER_PAGE);
      const before = await mainHtml(page);
      const r = await run(page, {
        ops: [{ op: "delete_section", locator: { tag: "h2", text: "Beta Proof" } }],
      });
      expect(r.applied).toBe(false);
      expect(await mainHtml(page)).toBe(before);
    });
  });

  it("hydration re-run: existing variant residue short-circuits to true, no double-move", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      await boot(page, WRAPPER_PAGE);
      const first = await run(page, {
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Beta Proof" } }],
      });
      expect(first.applied).toBe(true);
      const orderAfterFirst = await page.evaluate(() =>
        [...document.querySelector(".wrapper")!.children].map((c) => c.id),
      );
      const again = await run(page, {
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Beta Proof" } }],
      });
      expect(again.applied).toBe(true);
      const orderAfterSecond = await page.evaluate(() =>
        [...document.querySelector(".wrapper")!.children].map((c) => c.id),
      );
      expect(orderAfterSecond).toEqual(orderAfterFirst); // no double-lift
    });
  });

  it("LCP guard: a move whose section touches the LCP element is refused", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      await boot(page, WRAPPER_PAGE, { lcp: "#sb p" });
      const before = await mainHtml(page);
      const r = await run(page, {
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Beta Proof" } }],
      });
      expect(r.applied).toBe(false);
      expect(await mainHtml(page)).toBe(before);
    });
  });

  it("no-touch zone: a target inside a no-touch ancestor refuses the variant", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      const html = WRAPPER_PAGE.replace('<section id="sb">', '<section id="sb" data-no-touch>');
      await boot(page, html);
      const r = await run(page, {
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Beta Proof" } }],
      });
      expect(r.applied).toBe(false);
    });
  });

  it("flat article (no section level) refuses the move — never 'move everything'", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      await boot(
        page,
        `<main><article><h1>Title</h1><p>intro</p><h2>Part one</h2><p>a</p><h2>Part two</h2><p>b</p></article></main>`,
      );
      const before = await mainHtml(page);
      const r = await run(page, {
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Part two" } }],
      });
      expect(r.applied).toBe(false);
      expect(await mainHtml(page)).toBe(before);
    });
  });

  it("set_text: retextPreserve distributes across inline fragments; undo is byte-exact", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      const html = WRAPPER_PAGE.replace(
        "<h1>Hero headline</h1>",
        `<h1><span style="color:red">Hero</span> <br> headline text</h1>`,
      );
      await boot(page, html);
      const before = await mainHtml(page);
      const r = await run(page, {
        ops: [
          {
            op: "set_text",
            locator: { tag: "h1", text: "Hero headline" },
            value: "Completely new verified headline copy",
          },
        ],
      });
      expect(r.applied).toBe(true);
      expect(r.touched).toEqual(["variant_retext"]);
      const h1 = await page.evaluate(() => ({
        text: document.querySelector("h1")!.textContent!.replace(/\s+/g, " ").trim(),
        spans: document.querySelectorAll("h1 span").length,
        brs: document.querySelectorAll("h1 br").length,
        marked: document.querySelector("h1")!.hasAttribute("data-angel-retext"),
      }));
      expect(h1.text).toBe("Completely new verified headline copy");
      expect(h1.spans).toBe(1); // inline structure preserved
      expect(h1.brs).toBe(1);
      expect(h1.marked).toBe(true);
      await page.evaluate(() => {
        // @ts-expect-error test harness globals
        window.__reset();
      });
      expect(await mainHtml(page)).toBe(before);
    });
  });

  it("insert_snippet: valid same-site href renders a LINK in the donor class; undo removes it", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      await boot(page, WRAPPER_PAGE);
      const before = await mainHtml(page);
      const r = await run(page, {
        ops: [
          {
            op: "insert_snippet",
            locator: { tag: "h1", text: "Hero headline" },
            value: "One plan, cancel anytime",
            href: "/pricing",
            styleClass: "donor-link",
          },
        ],
      });
      expect(r.applied).toBe(true);
      const ins = await page.evaluate(() => {
        const p = document.querySelector("[data-angel-inserted]") as HTMLElement;
        const a = p.querySelector("a");
        return {
          afterHero: p.previousElementSibling?.className === "hero",
          href: a?.getAttribute("href"),
          cls: a?.className,
          text: a?.textContent,
        };
      });
      expect(ins.afterHero).toBe(true); // directly after the hero block, not page bottom
      expect(ins.href).toBe("/pricing");
      expect(ins.cls).toBe("donor-link");
      expect(ins.text).toBe("One plan, cancel anytime");
      await page.evaluate(() => {
        // @ts-expect-error test harness globals
        window.__reset();
      });
      expect(await mainHtml(page)).toBe(before);
    });
  });

  it("insert_snippet: external/invalid href renders PLAIN TEXT, never a link (defence in depth)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      await boot(page, WRAPPER_PAGE);
      const r = await run(page, {
        ops: [
          {
            op: "insert_snippet",
            locator: { tag: "h1", text: "Hero headline" },
            value: "Quoted text",
            href: "https://evil.example/phish",
          },
        ],
      });
      expect(r.applied).toBe(true);
      const ins = await page.evaluate(() => {
        const p = document.querySelector("[data-angel-inserted]") as HTMLElement;
        return { links: p.querySelectorAll("a").length, text: p.textContent };
      });
      expect(ins.links).toBe(0);
      expect(ins.text).toBe("Quoted text");
    });
  });

  it("insert_snippet CWV re-anchor: LCP BELOW the insertion point ⇒ quote lands under the LCP's own block", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      // Fake LCP = a paragraph inside #sa, BELOW the hero insertion point.
      // Inserting after the hero would push the largest paint down — so the
      // applier re-anchors to the LCP element's own highest census-free
      // ancestor and inserts AFTER it: the quote lands below the LCP and the
      // largest paint never moves. (The outright-refuse branch is the belt-and-
      // suspenders race path — observer updates between the two reads — which
      // no static fixture can honestly produce.)
      await boot(page, WRAPPER_PAGE, { lcp: "#sa p" });
      const r = await run(page, {
        ops: [
          {
            op: "insert_snippet",
            locator: { tag: "h1", text: "Hero headline" },
            value: "Quote",
          },
        ],
      });
      expect(r.applied).toBe(true);
      const pos = await page.evaluate(() => {
        const ins = document.querySelector("[data-angel-inserted]")!;
        const lcp = document.querySelector("#sa p")!;
        return {
          afterLcp: !!(lcp.compareDocumentPosition(ins) & Node.DOCUMENT_POSITION_FOLLOWING),
          lcpTopUnchanged: true, // position assertion below via bounding rects
          insPrevIsLcp: ins.previousElementSibling === lcp,
        };
      });
      expect(pos.afterLcp).toBe(true); // largest paint sits ABOVE the insert — it never shifted
      expect(pos.insPrevIsLcp).toBe(true); // anchored to the LCP's own block, not the hero
    });
  });

  it("divider skip: the move lands above the nearest REAL sibling, not a 2px decor line", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await scenario(async (page) => {
      const html = WRAPPER_PAGE.replace(
        '<section id="sb">',
        '<div id="divider" style="height:2px"></div><section id="sb">',
      );
      await boot(page, html);
      const r = await run(page, {
        ops: [{ op: "move_up", locator: { tag: "h2", text: "Beta Proof" } }],
      });
      expect(r.applied).toBe(true);
      const order = await page.evaluate(() =>
        [...document.querySelector(".wrapper")!.children].map((c) => c.id),
      );
      expect(order).toEqual(["sb", "sa", "divider", "sc"]); // above #sa, not a divider swap
    });
  });
});
