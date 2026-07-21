#!/usr/bin/env bun
// Claude Designer — BRIEF collector (E3-lite step 1).
// For each refused site: load the real page, run the automatic reorder ladder
// to capture its refusal trail, then extract a compact STRUCTURE DIGEST — the
// candidate containers from the common ancestor down to the proof section,
// each with its direct children (tag/id/selector/rects/which sections they
// carry). The digest + trail + section map is everything the designer needs
// to propose a plan in the safe-primitive vocabulary.
//
//   bun build scripts/designer-brief.ts --target=node --format=esm \
//     --outfile=dbrief.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
//     node dbrief.node.mjs --names=clickup,rippling,...

import { chromium, type Page } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { createSession, closeSession } from "../src/lib/tests/browserbase.server";
import { SITES } from "./day0-sites";

const OUT_DIR =
  "/tmp/claude-0/-home-user-cro-angel-ai/c11460d4-452b-5901-aaf1-829bf613facc/scratchpad/designer/briefs";
const BUNDLE = readFileSync("public/adaptive.js", "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length);
}

async function dismissConsent(page: Page) {
  await page
    .evaluate(() => {
      const RX =
        /^(accept( all)?( cookies)?|allow all( cookies)?|godk[äa]nn( alla)?( cookies)?|acceptera( alla)?( cookies)?|jag f[öo]rst[åa]r|ok(ay)?|got it)$/i;
      for (const el of Array.from(document.querySelectorAll("button, [role=button], a"))) {
        const t = ((el as HTMLElement).innerText || "").trim();
        if (t && t.length <= 30 && RX.test(t)) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 10 && r.height > 10) {
            (el as HTMLElement).click();
            return;
          }
        }
      }
    })
    .catch(() => {});
  await sleep(700);
}

async function collectBrief(page: Page, site: { name: string; url: string }) {
  await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(1800);
  await dismissConsent(page);
  await page.evaluate(BUNDLE);
  await page.waitForFunction(() => (window as any).__angelAdaptive?.inventory != null, undefined, {
    timeout: 30_000,
  });
  // Run the automatic ladder once to capture the refusal trail, then revert.
  await page.evaluate(() => {
    const a = (window as any).__angelAdaptive;
    a.adapt("engaged_no_click");
    a.revert();
  });

  return page.evaluate(() => {
    const a = (window as any).__angelAdaptive;
    const inv = a.inventory;
    const secs: Array<{ type: string; heading?: string; selector?: string }> = inv.sections;

    const cssPath = (el: Element): string => {
      if (el instanceof HTMLElement && el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = [];
      let cur: Element | null = el;
      let depth = 0;
      while (cur && cur !== document.body && depth < 5) {
        if (cur instanceof HTMLElement && cur.id) {
          parts.unshift(`#${CSS.escape(cur.id)}`);
          return parts.join(" > ");
        }
        const parent: Element | null = cur.parentElement;
        if (!parent) break;
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
        const idx = sameTag.indexOf(cur) + 1;
        parts.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${idx})`);
        cur = parent;
        depth++;
      }
      parts.unshift("body");
      return parts.join(" > ");
    };

    const q = (sel?: string): HTMLElement | null => {
      if (!sel) return null;
      try {
        return document.querySelector(sel) as HTMLElement | null;
      } catch {
        return null;
      }
    };

    const ti = secs.findIndex((s) => s.type === "testimonials" && s.selector);
    const heroI = secs.findIndex((s) => s.type === "hero" && s.selector);
    const CHROME_RX = /^(header|nav|footer)$/;
    const floorI = heroI >= 0 ? heroI : secs.findIndex((s) => s.selector && !CHROME_RX.test(s.type));
    const testiEl = ti >= 0 ? q(secs[ti].selector) : null;
    const floorEl = floorI >= 0 ? q(secs[floorI].selector) : null;

    const sectionRows = secs.map((s, i) => {
      const el = q(s.selector);
      const r = el?.getBoundingClientRect();
      return {
        i,
        type: s.type,
        heading: (s.heading || "").slice(0, 60),
        selector: s.selector || null,
        top: r ? Math.round(r.top + window.scrollY) : null,
        h: r ? Math.round(r.height) : null,
      };
    });

    let ladder: unknown[] = [];
    if (testiEl && floorEl) {
      const chain = (el: HTMLElement): HTMLElement[] => {
        const out: HTMLElement[] = [];
        let p: HTMLElement | null = el;
        while (p && p !== document.body) {
          out.push(p);
          p = p.parentElement;
        }
        return out;
      };
      const tChain = chain(testiEl);
      const aChain = new Set(chain(floorEl));
      let common: HTMLElement | null = null;
      for (const el of tChain) {
        if (el.parentElement && aChain.has(el.parentElement)) {
          common = el.parentElement;
          break;
        }
      }
      const containers: HTMLElement[] = [];
      if (common) {
        const path: HTMLElement[] = [];
        let c: HTMLElement | null = testiEl.parentElement;
        while (c && c !== common) {
          path.push(c);
          c = c.parentElement;
        }
        path.push(common);
        containers.push(...path.reverse());
      } else if (testiEl.parentElement) {
        containers.push(testiEl.parentElement);
      }

      const sectionEls = secs
        .map((s, i) => ({ i, el: q(s.selector) }))
        .filter((x): x is { i: number; el: HTMLElement } => !!x.el);

      ladder = containers.slice(0, 6).map((c, depth) => {
        const cs = window.getComputedStyle(c);
        const r = c.getBoundingClientRect();
        const kids = Array.from(c.children).filter((k): k is HTMLElement => k instanceof HTMLElement);
        return {
          depth,
          selector: cssPath(c),
          tag: c.tagName.toLowerCase(),
          id: c.id || null,
          className: (c.className && typeof c.className === "string" ? c.className : "").slice(0, 80),
          display: cs.display,
          flexDirection: cs.flexDirection,
          childCount: kids.length,
          rect: { top: Math.round(r.top + window.scrollY), h: Math.round(r.height) },
          children: kids.slice(0, 40).map((k, idx) => {
            const kr = k.getBoundingClientRect();
            return {
              idx,
              tag: k.tagName.toLowerCase(),
              id: k.id || null,
              className: (k.className && typeof k.className === "string" ? k.className : "").slice(0, 60),
              selector: cssPath(k),
              top: Math.round(kr.top + window.scrollY),
              h: Math.round(kr.height),
              sections: sectionEls.filter((s) => k.contains(s.el)).map((s) => s.i),
              hasProof: k === testiEl || k.contains(testiEl),
              hasFloor: k === floorEl || k.contains(floorEl),
            };
          }),
        };
      });
    }

    return {
      site: location.hostname,
      url: location.href,
      page: {
        title: document.title.slice(0, 80),
        docHeight: document.documentElement.scrollHeight,
        viewport: { w: window.innerWidth, h: window.innerHeight },
      },
      sections: sectionRows,
      proofIndex: ti,
      heroIndex: heroI,
      floorIndex: floorI,
      autoTrail: (window as any).__angelReorderWhy ?? "",
      ladder,
    };
  });
}

async function main() {
  const names = (arg("names") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const targets = SITES.filter((s) => names.includes(s.name));
  if (!targets.length) {
    console.error("no targets — pass --names=a,b,c");
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const session = await createSession();
  console.log(`brief session ${session.id} — ${targets.map((t) => t.name).join(", ")}`);
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
    for (const site of targets) {
      process.stdout.write(`  ${site.name.padEnd(12)} `);
      try {
        const brief = await collectBrief(page, site);
        const out = `${OUT_DIR}/${site.name}.json`;
        writeFileSync(out, JSON.stringify({ name: site.name, ...brief }, null, 1));
        const ladder = (brief as { ladder: unknown[] }).ladder;
        console.log(
          `ok · trail="${(brief as { autoTrail: string }).autoTrail}" · ladder=${ladder.length} levels`,
        );
      } catch (err) {
        console.log(`FAIL ${err instanceof Error ? err.message.split("\n")[0].slice(0, 100) : err}`);
      }
    }
  } finally {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    await closeSession(session.id).catch(() => {});
  }
  console.log(`\nbriefs → ${OUT_DIR}/<site>.json`);
}

main().catch((e) => {
  console.error("brief collection failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
