// Kandidat-proben (kandidatkatalogen, 2026-07-27): förprova varje lagligt
// drag mot den FRUSNA sidans riktiga DOM innan LLM-väljaren ser menyn.
// Samma speglade regler som measure/applier (findByLocator, sectionOf,
// prev-syskon, hjälte-klampen, insert-ankare + täcknings-hit-test) — det
// som inte kan appliceras ska aldrig kunna väljas. Fail closed per kandidat:
// oprovbar ⇒ bortfiltrerad, aldrig "kanske".
//
//   bun run scripts/redesign/probe-candidates.ts \
//     --frozen=<path> --in=<candidates.json> --out=<probed.json>
//
// In-formatet är katalogens Candidate[] + per-kandidat lokator (byggd av
// anroparen ur innehållsmodellen): {id, kind, tag, find, placement?}.

import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const FROZEN = arg("frozen");
const IN = arg("in");
const OUT = arg("out");
if (!FROZEN || !IN || !OUT) {
  console.error("usage: --frozen=<html> --in=<candidates.json> --out=<probed.json>");
  process.exit(2);
}
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

interface ProbeIn {
  id: string;
  kind: "move_up" | "insert_snippet";
  tag: string;
  find: string;
  detail?: string;
}
interface ProbeOut {
  id: string;
  applicable: boolean;
  /** insert: vilka placeringar som är synliga+oskymda ("default"/"after_h1"). */
  placements?: string[];
  reason?: string;
}

const cands = JSON.parse(readFileSync(IN, "utf8")) as ProbeIn[];
const html = readFileSync(FROZEN, "utf8");

const browser = await chromium.launch({ headless: true, executablePath: EXEC });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route("**/*", (r) => r.abort());
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 20_000 });
await page.waitForTimeout(400);

const results = await page.evaluate((cands) => {
  const mainEl = document.querySelector("main") || document.body;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  // ── Spegel av measure/applier-reglerna (håll i synk) ──────────────────
  const census = Array.from(mainEl.querySelectorAll("h2")).filter(
    (h) => !h.closest("header,nav,footer,aside"),
  );
  const censusCount = new Map<Element, number>();
  for (const h of census) {
    let w: Element | null = h;
    while (w && w !== document.documentElement) {
      censusCount.set(w, (censusCount.get(w) ?? 0) + 1);
      w = w.parentElement;
    }
  }
  const sectionOf = (el: Element): Element | null => {
    let n: Element | null = el.parentElement;
    while (n && n !== document.body && n !== mainEl.parentElement) {
      if ((censusCount.get(n) ?? 0) === 1) {
        const p = n.parentElement;
        if (p)
          for (const sib of Array.from(p.children)) if (sib !== n && censusCount.has(sib)) return n;
      }
      n = n.parentElement;
    }
    return null;
  };
  const findByLocator = (tag: string, find: string): Element | null => {
    const full = norm(find).toLowerCase();
    if (!full) return null;
    const els = Array.from(mainEl.querySelectorAll(tag || "h1,h2,h3"));
    for (const el of els) if (norm(el.textContent || "").toLowerCase() === full) return el;
    const needle = full.slice(0, 24);
    for (const el of els) if (norm(el.textContent || "").toLowerCase().includes(needle)) return el;
    return null;
  };
  let clampHead: Element | null = mainEl.querySelector("h1");
  if (clampHead && clampHead.closest("header,nav,footer,aside")) clampHead = null;
  let heroClamp: Element | null = null;
  if (clampHead) {
    heroClamp = clampHead;
    while (
      heroClamp.parentElement &&
      heroClamp.parentElement !== mainEl &&
      heroClamp.parentElement !== document.body &&
      !censusCount.has(heroClamp.parentElement)
    ) {
      heroClamp = heroClamp.parentElement;
    }
  }
  const hitTestable = (node: Element): boolean => {
    node.scrollIntoView({ block: "center" });
    const r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    return !!top && (node.contains(top) || top.contains(node));
  };

  const out: {
    id: string;
    applicable: boolean;
    placements?: string[];
    reason?: string;
  }[] = [];
  for (const c of cands) {
    if (c.kind === "move_up") {
      const el = findByLocator(c.tag, c.find);
      if (!el) {
        out.push({ id: c.id, applicable: false, reason: "lokatorn upplöses inte" });
        continue;
      }
      const sec = sectionOf(el);
      if (!sec) {
        out.push({ id: c.id, applicable: false, reason: "ingen ren sektionsnivå" });
        continue;
      }
      let prev = sec.previousElementSibling;
      while (prev && !censusCount.has(prev) && prev.getBoundingClientRect().height < 8) {
        prev = prev.previousElementSibling;
      }
      if (!prev || prev.parentElement !== sec.parentElement) {
        out.push({ id: c.id, applicable: false, reason: "ingen landningsplats ovanför" });
        continue;
      }
      // Hjälte-klampen: samma vägran som applicering skulle göra.
      if (heroClamp && sec !== heroClamp) {
        try {
          const secBelow = !!(
            heroClamp.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING
          );
          const landsAbove =
            prev === heroClamp ||
            !!(prev.compareDocumentPosition(heroClamp) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (secBelow && landsAbove) {
            out.push({ id: c.id, applicable: false, reason: "skulle landa ovanför hjälten" });
            continue;
          }
        } catch {
          /* klampen vilar utan svar — proben släpper igenom, grinden dömer */
        }
      }
      out.push({ id: c.id, applicable: true });
    } else {
      // insert: hjälte-ankaret + täcknings-hit-test per placering, med
      // temporär nod som städas direkt (proben får aldrig lämna spår).
      const el = findByLocator(c.tag, c.find);
      if (!el) {
        out.push({ id: c.id, applicable: false, reason: "hjälte-lokatorn upplöses inte" });
        continue;
      }
      const placements: string[] = [];
      // default: efter hjältens toppblock (h1:ans högsta census-fria förfader)
      let anchor: Element = el;
      while (
        anchor.parentElement &&
        anchor.parentElement !== mainEl &&
        anchor.parentElement !== document.body &&
        !censusCount.has(anchor.parentElement)
      ) {
        anchor = anchor.parentElement;
      }
      for (const [name, a] of [
        ["default", anchor],
        ["after_h1", el],
      ] as const) {
        if (!a.parentElement) continue;
        const probeNode = document.createElement("p");
        probeNode.textContent = c.detail || "probe";
        a.parentElement.insertBefore(probeNode, a.nextSibling);
        const ok = hitTestable(probeNode);
        probeNode.remove();
        if (ok) placements.push(name);
      }
      window.scrollTo(0, 0);
      if (placements.length === 0) {
        out.push({ id: c.id, applicable: false, reason: "alla placeringar täckta/osynliga" });
      } else {
        out.push({ id: c.id, applicable: true, placements });
      }
    }
  }
  return out;
}, cands as unknown as ProbeIn[]);

await browser.close();
writeFileSync(OUT, JSON.stringify(results satisfies ProbeOut[], null, 2));
const ok = results.filter((r) => r.applicable).length;
console.log(`[probe] ${ok}/${results.length} kandidater applicerbara`);
