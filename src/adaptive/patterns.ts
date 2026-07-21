// Angel Adaptive — the Pattern Library + applier (v2: layout-safe).
//
// The step past "investigate": the snippet changes the page — but ONLY in ways
// that can't break an arbitrary third-party layout. v1 moved/cloned structural
// nodes and mangled real grids (HubSpot); v2 drops that. The safe primitives:
//   * STYLE an existing element in place (no reflow of siblings) — emphasis.
//   * PREPEND one isolated, self-contained banner at the very top of <body>
//     (shifts the page down uniformly; never injected into an internal grid).
// Both reuse content already on the page, record how to undo themselves, are
// skipped if their target is missing, and are try/caught so a failure can never
// reach the host page. The decision engine (which visitor sees which pattern)
// is a later layer; for now every applicable pattern runs once.

import type { ContentInventory } from "./inventory";

export type AppliedChange = {
  patternId: string;
  label: string;
  detail: string;
};

export type AdaptationResult = {
  applied: AppliedChange[];
  revert: () => void;
};

type ApplyCtx = { reverts: Array<() => void> };

function q(sel?: string): HTMLElement | null {
  if (!sel) return null;
  try {
    return document.querySelector(sel) as HTMLElement | null;
  } catch {
    return null;
  }
}

type Pattern = (inv: ContentInventory, ctx: ApplyCtx) => AppliedChange | null;

// Restore an element's style attribute EXACTLY as captured (string | null).
// A bare removeAttribute("style") while inline-style serialization is still
// pending lets Chromium re-materialize an empty style="" — the exact residue
// the byte-clean promise forbids. Clearing the CSSOM and READING the
// attribute first flushes that state; only then is removal permanent
// (verified by op-sequence bisect in the reorder lab).
function restoreStyleAttr(el: HTMLElement, v: string | null): void {
  if (v === null) {
    el.style.cssText = "";
    void el.getAttribute("style");
    el.removeAttribute("style");
  } else {
    el.setAttribute("style", v);
  }
}

// Words that are navigation, not a conversion action — never emphasise these,
// even if the CTA classifier tagged one as primary (Stripe's "Products").
const NAV_WORDS =
  /^(products?|solutions?|developers?|resources?|pricing|company|about|docs?|support|contact|sign ?in|log ?in|login|menu|features?|customers?|blog|partners?|enterprise|home|search|cart)$/i;

// ── v0.5: site-aware bar theming ────────────────────────────────────────────
// One hardcoded light-blue bar looked foreign on dark sites (sentry, railway).
// Detect the page's own light/dark theme from the effective background and
// pick a bar palette that sits naturally on it. Neutral by design — matching
// the site's accent color is a later step (contrast guarantees first).
function effectiveBg(): [number, number, number] {
  let el: HTMLElement | null = document.body;
  while (el) {
    const c = window.getComputedStyle(el).backgroundColor || "";
    const m = c.match(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?\)/);
    if (m && (m[4] === undefined || parseFloat(m[4]) > 0.4)) {
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    }
    el = el.parentElement;
  }
  return [255, 255, 255];
}
function pageIsDark(): boolean {
  const [r, g, b] = effectiveBg();
  // Relative-luminance approximation is plenty for a binary theme choice.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}
// A position:FIXED top header does not participate in flow: a prepended bar
// pushes the page down but not the header, which then paints OVER the bar —
// the exact "something looks off" failure the product must never ship. Sticky
// and static headers are pushed down correctly (monday, deel — verified in
// screenshots). Detect a viewport-wide fixed bar hugging the top; when one
// exists the bar patterns REFUSE (refusal beats weirdness).
export function hasFixedTopHeader(): boolean {
  const cands = new Set<Element>([
    ...Array.from(document.querySelectorAll("header, nav, [role='banner']")),
    ...Array.from(document.body?.children ?? []),
  ]);
  for (const el of cands) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = window.getComputedStyle(el);
    if (cs.position !== "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.top <= 2 && r.height >= 24 && r.height <= 200 && r.width >= window.innerWidth * 0.8) {
      return true;
    }
  }
  return false;
}

// ── v0.8: runtime visual acceptance ─────────────────────────────────────────
// The harness hit-tested bars and emphasis from the outside; the sweep showed
// real pages where a bar renders under an overlay or an emphasized CTA is
// collapsed/covered. Those checks belong in the SNIPPET: verify right after
// applying, refuse + self-undo when the element isn't actually presentable.
// (Same stance as the reorder self-check: everything runs synchronously, so a
// refused application is invisible to the visitor.)
export function barIsPresentable(bar: HTMLElement): boolean {
  const r = bar.getBoundingClientRect();
  if (r.width < window.innerWidth * 0.9) return false; // body max-width sites
  if (r.height < 18 || r.height > 90) return false;
  if (r.bottom > 0 && r.top < window.innerHeight) {
    const hit = document.elementFromPoint(
      Math.floor(window.innerWidth / 2),
      Math.floor(r.top + r.height / 2),
    );
    if (!hit || (hit !== bar && !bar.contains(hit))) return false; // covered
  }
  return true;
}
export function emphasisIsPresentable(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return false; // collapsed target
  if (r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth) {
    const cx = Math.floor(Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2)));
    const cy = Math.floor(Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2)));
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || (hit !== el && !el.contains(hit))) return false; // covered
  }
  return true;
}

type BarKind = "trust" | "risk";
function barPalette(kind: BarKind): { bg: string; fg: string; border: string } {
  if (pageIsDark()) {
    return kind === "trust"
      ? { bg: "rgba(23,32,52,.97)", fg: "#dbe7ff", border: "rgba(120,150,220,.35)" }
      : { bg: "rgba(16,38,28,.97)", fg: "#c9f2d9", border: "rgba(80,190,130,.35)" };
  }
  return kind === "trust"
    ? { bg: "#eaf1ff", fg: "#0b1f3a", border: "#cfe0ff" }
    : { bg: "#e8f8ee", fg: "#0a3d1f", border: "#bfe8cd" };
}
function makeBar(id: string, text: string, kind: BarKind): HTMLElement {
  const p = barPalette(kind);
  const bar = document.createElement("div");
  bar.setAttribute("data-angel-adaptation", id);
  bar.textContent = text;
  bar.style.cssText = [
    "all:initial",
    "display:block",
    "box-sizing:border-box",
    "width:100%",
    "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
    "font-size:14px",
    "font-weight:600",
    `color:${p.fg}`,
    `background:${p.bg}`,
    `border-bottom:1px solid ${p.border}`,
    "text-align:center",
    "padding:9px 16px",
    "line-height:1.35",
  ].join(";");
  return bar;
}

// ── v0.5: bar-text quality gate ─────────────────────────────────────────────
// The 101-site sweep showed weak picks: label-only strings ("Case Study",
// "Widget rating") and mid-word truncation. Score candidates — numeric claims
// first, one-line lengths preferred, bare labels rejected — and cut on a word
// boundary.
const BAR_LABEL_JUNK =
  /^[""''"]*\s*(case stud(y|ies)|widget rating|reviews?|testimonials?|customers?|ratings?|trusted|betyg|recensioner|kundcase)\s*[""''"]*$/i;
export function scoreBarText(raw: string): number {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (s.length < 12 || s.length > 200) return -1;
  if (BAR_LABEL_JUNK.test(s)) return -1;
  let score = 0;
  if (/\d/.test(s)) score += 3;
  if (/%|\/5|\+|★/.test(s)) score += 1;
  if (s.length >= 20 && s.length <= 90) score += 2;
  return score;
}
export function truncateBarText(raw: string, max = 96): string {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const atWord = cut.slice(0, Math.max(20, cut.lastIndexOf(" ")));
  return atWord + "…";
}

// Surface the strongest EXISTING trust signal as a slim bar at the very top.
// Layout-safe: one isolated, self-contained element prepended to <body> — it
// shifts the page down uniformly and is never injected into an internal grid.
const trustBar: Pattern = (inv, ctx) => {
  // v0.5: score ALL candidates through the quality gate instead of taking the
  // first — numeric claims ("Rated 4.7/5 by 10,000+ users") beat bare labels.
  const cands = [
    ...inv.trust.ratings,
    ...inv.trust.socialProof,
    ...inv.trust.trustedBy,
    ...inv.trust.testimonials,
  ]
    .map((sig) => {
      let text = (sig.text || "").replace(/\s+/g, " ").trim();
      if (sig.type === "testimonial") text = `“${truncateBarText(text, 90)}”`;
      return { text, score: scoreBarText(text) };
    })
    .filter((c) => c.score >= 1)
    .sort((a, b) => b.score - a.score);
  const best = cands[0];
  if (!best) return null;
  if (hasFixedTopHeader()) return null; // bar would paint under the fixed header
  const text = truncateBarText(best.text);

  const bar = makeBar("trust_bar", text, "trust");
  document.body.insertBefore(bar, document.body.firstChild);
  if (!barIsPresentable(bar)) {
    bar.remove(); // narrow/covered on THIS page — refuse before anyone sees it
    return null;
  }
  ctx.reverts.push(() => bar.remove());
  return { patternId: "trust_bar", label: "Surface trust bar", detail: text.slice(0, 60) };
};

// Emphasise the real primary conversion CTA — STYLE ONLY (no reflow), with
// careful targeting so it lands on a hero action, not a nav item.
const emphasizePrimaryCta: Pattern = (inv, ctx) => {
  const candidates = inv.ctas.filter((c) => {
    const t = (c.text || "").trim();
    return (
      t.length >= 2 &&
      c.section !== "nav" &&
      c.section !== "header" &&
      c.section !== "footer" &&
      !NAV_WORDS.test(t)
    );
  });
  const cta =
    candidates.find((c) => c.section === "hero" && c.intent === "conversion") ??
    candidates.find((c) => c.section === "hero" && c.category === "cta_primary") ??
    candidates.find((c) => c.intent === "conversion" && c.aboveFold) ??
    candidates.find((c) => c.category === "cta_primary");
  const el = q(cta?.selector);
  if (!el || !cta) return null;
  const prev = el.getAttribute("style");
  el.style.boxShadow = "0 0 0 3px rgba(37,99,235,.55), 0 12px 30px rgba(37,99,235,.35)";
  el.style.transform = "scale(1.04)";
  el.style.transition = "transform .15s ease";
  // Tagged so visual-acceptance checks can find the emphasized element.
  el.setAttribute("data-angel-emphasis", "1");
  const undoEmphasis = () => {
    restoreStyleAttr(el, prev);
    el.removeAttribute("data-angel-emphasis");
  };
  if (!emphasisIsPresentable(el)) {
    // Collapsed or covered target: emphasising it would decorate something
    // the visitor can't even hit — undo before paint and refuse.
    undoEmphasis();
    return null;
  }
  ctx.reverts.push(undoEmphasis);
  return {
    patternId: "emphasize_primary_cta",
    label: "Emphasise primary CTA",
    detail: `"${cta.text}"`,
  };
};

// Risk-reducer bar (v3): surface the page's OWN risk-killing copy — a
// money-back / free-trial / no-card guarantee or a compliance cert — as the
// top bar. The price-hesitant visitor's objection is risk; the copy that
// answers it usually sits below the fold. Same isolated-prepend primitive as
// trustBar (one bar max per page — the applier ensures the slot is free).
// v0.5: free-trial/no-card CLAIMS are the strongest risk killers on pricing
// pages, but they live in hero microcopy / headings, not the guarantee
// detector. Scan the inventory's own text fields for them as an extra source.
const FREE_TRIAL_RX =
  /\b(\d{1,2}[- ]day free trial|free \d{1,2}[- ]day trial|no credit card( required| needed)?|cancel anytime|gratis provperiod|utan kreditkort|prova gratis( i \d+ dagar)?|avsluta n[äa]r du vill|ingen bindningstid)\b/i;
function freeTrialClaim(inv: ContentInventory): string | null {
  const fields: string[] = [
    inv.page?.hero?.subheadline ?? "",
    inv.page?.hero?.headline ?? "",
    ...inv.sections.map((s) => s.heading || ""),
  ];
  for (const f of fields) {
    const m = f.match(FREE_TRIAL_RX);
    if (m) {
      const s = f.replace(/\s+/g, " ").trim();
      return s.length <= 120 ? s : m[0];
    }
  }
  return null;
}

const riskReducerBar: Pattern = (inv, ctx) => {
  if (document.querySelector('[data-angel-adaptation]')) return null; // one bar max
  const sources = [
    ...inv.trust.guarantees.map((s) => s.text || ""),
    freeTrialClaim(inv) ?? "",
    ...inv.trust.certifications.map((s) => s.text || ""),
  ];
  const best = sources
    .map((t) => ({ text: (t || "").replace(/\s+/g, " ").trim(), score: scoreBarText(t) }))
    .filter((c) => c.text.length >= 8 && c.score >= 0)
    .sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  if (hasFixedTopHeader()) return null; // bar would paint under the fixed header
  const text = truncateBarText(best.text, 120);
  const bar = makeBar("risk_reducer_bar", text, "risk");
  document.body.insertBefore(bar, document.body.firstChild);
  if (!barIsPresentable(bar)) {
    bar.remove();
    return null;
  }
  ctx.reverts.push(() => bar.remove());
  return { patternId: "risk_reducer_bar", label: "Surface risk-reducer", detail: text.slice(0, 60) };
};

// Pricing spotlight (v3): STYLE-only emphasis on the page's existing pricing
// section — soft tinted ring, no reflow — so the price-curious visitor finds
// it instantly. First version deliberately coarse (whole section, not a plan
// card); plan-card targeting needs card-level inventory (v4).
const pricingSpotlight: Pattern = (inv, ctx) => {
  const sec = inv.sections.find((s) => s.type === "pricing" && s.selector);
  const el = q(sec?.selector);
  if (!el || !sec) return null;
  const prev = el.getAttribute("style");
  el.style.boxShadow = "0 0 0 3px rgba(16,122,66,.45), 0 10px 34px rgba(16,122,66,.18)";
  el.style.borderRadius = "12px";
  ctx.reverts.push(() => restoreStyleAttr(el, prev));
  return {
    patternId: "pricing_spotlight",
    label: "Spotlight pricing section",
    detail: sec.heading || sec.selector || "",
  };
};

// ── v0.6→v0.7: visual REORDERING without touching the DOM ───────────────────
// "Flytta runt" done safely: CSS `order` changes what the visitor SEES while
// the DOM (and the site's framework) never changes. On flex/grid parents the
// property just works; block-stacked parents are promoted to flex-column,
// which CAN shift spacing (margin collapsing differs) — so every attempt
// SELF-CHECKS: snapshot every sibling's rect, apply, re-measure, and ROLL
// BACK unless everything landed within tight tolerances. A reorder that can't
// be proven invisible-but-for-the-order does not ship.
//
// v0.7 — the attempt LOOP. One strategy → refuse was leaving structurally
// possible moves on the table. Now the pattern generates a LADDER of
// candidate containers, from the nearest common ancestor of testimonial and
// hero (the big "right after the hero" jump) down level by level toward the
// testimonial's own wrapper (the minimal "top of its own group" move), and
// tries each in turn. Because apply → measure → rollback runs synchronously
// inside one task, the browser never paints a failed attempt — the visitor
// only ever sees the first PROVEN-clean result, or the original page. Every
// attempt's outcome is recorded in __angelReorderWhy ("L0:check-height;
// L1:PASS") so refusals stay diagnosable.
//
// v0.7 also closes two v0.6 gaps: an explicit-grid parent where `order` has
// no visual effect used to pass the checks as a silent no-op "applied" — the
// new no-improvement check (testimonial must land ≥200px higher) refuses it
// and moves on; and restores are now attribute-exact (a missing style
// attribute is removed again, not left behind as style="").
const REORDER_MIN_LIFT_PX = 200;
const REORDER_TIME_BUDGET_MS = 150;
const REORDER_MAX_ATTEMPTS = 5;

// ── The shared order-move core ──────────────────────────────────────────────
// One attempt: guards → apply → self-check → keep or roll back. Runs
// synchronously, so a failed attempt is rolled back BEFORE the browser can
// paint it. This is the single implementation both the automatic ladder
// (reorder_proof_first) and Claude-designed plans (applyPlannedReorder) go
// through — a plan gets no more power than the auto mode, only different
// targeting.
export type OrderMoveSpec = {
  container: HTMLElement;
  // The section being surfaced — lift, floor, and collapse checks measure it.
  focusEl: HTMLElement;
  // Land after this element's wrapper-kid when it lives in the container;
  // null (or outside the container in auto mode) → front of the group.
  landAfterEl: HTMLElement | null;
  // Semantic floor (the hero): the focus must never land above it, and a
  // front move is only allowed when the container already sits below it.
  floorEl: HTMLElement | null;
  // Sections that must not ride along with the moved wrapper.
  otherSectionEls: HTMLElement[];
  // Promotion for block containers: flex-column (default) or grid — grid
  // stretches children like block flow does, which can avoid the width/BFC
  // drift flex promotion sometimes causes.
  mode: "flex" | "grid";
  minKids: number;
};
export type OrderMoveResult =
  | { ok: false; err: string }
  | { ok: true; undo: () => void; anchored: boolean };

export function tryOrderMove(spec: OrderMoveSpec): OrderMoveResult {
  const { container, focusEl, landAfterEl, floorEl, otherSectionEls, mode, minKids } = spec;
  const kids = Array.from(container.children).filter(
    (k): k is HTMLElement => k instanceof HTMLElement,
  );
  if (kids.length < minKids || kids.length > 40) return { ok: false, err: `kid-count-${kids.length}` };
  const moveKid = kids.find((k) => k === focusEl || k.contains(focusEl));
  if (!moveKid) return { ok: false, err: "no-move-kid" };
  // The moved wrapper must not drag unrelated sections along with it.
  if (otherSectionEls.some((el) => moveKid.contains(el)))
    return { ok: false, err: "wrapper-carries-other-sections" };
  // Anchor: land right after the target's wrapper when it lives in this
  // container; otherwise the move goes to the FRONT of the group — but only
  // when the group itself already sits below the floor, so a front move can
  // never hoist proof above the hero.
  let anchorKid: HTMLElement | null = null;
  if (landAfterEl && container.contains(landAfterEl)) {
    anchorKid = kids.find((k) => k === landAfterEl || k.contains(landAfterEl)) ?? null;
    if (!anchorKid || anchorKid === moveKid) return { ok: false, err: "no-distinct-wrapper-kids" };
  } else if (
    floorEl &&
    container.getBoundingClientRect().top < floorEl.getBoundingClientRect().bottom - 40
  ) {
    return { ok: false, err: "container-above-anchor" };
  }
  const fromIdx = kids.indexOf(moveKid);
  const targetIdx = anchorKid ? kids.indexOf(anchorKid) : -1;
  if (fromIdx === targetIdx + 1) return { ok: false, err: "already-there" };

  // Content envelope: the union of a kid's element children. Border boxes
  // lie after promotion — a blockified kid ADOPTS child margins that used to
  // collapse out (height grows, screen pixels identical) — so height and
  // overlap are judged on what the visitor actually sees.
  const envelope = (k: HTMLElement): { top: number; bottom: number; height: number } => {
    let top = Infinity;
    let bottom = -Infinity;
    for (const c of Array.from(k.children)) {
      if (!(c instanceof HTMLElement)) continue;
      const r = c.getBoundingClientRect();
      if (r.height <= 0 && r.width <= 0) continue;
      if (r.top < top) top = r.top;
      if (r.bottom > bottom) bottom = r.bottom;
    }
    if (top === Infinity) {
      const r = k.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    }
    return { top, bottom, height: bottom - top };
  };

  const before = new Map(kids.map((k) => [k, k.getBoundingClientRect()]));
  const beforeEnv = new Map(kids.map((k) => [k, envelope(k)]));
  const focusTop0 = focusEl.getBoundingClientRect().top;
  const docH = document.documentElement.scrollHeight;
  const parentPrev = container.getAttribute("style");
  const kidPrev = new Map(kids.map((k) => [k, k.getAttribute("style")]));
  const undo = () => {
    restoreStyleAttr(container, parentPrev);
    container.removeAttribute("data-angel-reorder");
    for (const k of kids) restoreStyleAttr(k, kidPrev.get(k) ?? null);
  };

  try {
    const cs = window.getComputedStyle(container);
    const isFlexCol =
      cs.display.indexOf("flex") !== -1 &&
      (cs.flexDirection === "column" || cs.flexDirection === "column-reverse");
    const isGrid = cs.display.indexOf("grid") !== -1;
    const promoted = !isFlexCol && !isGrid;
    if (promoted) {
      // Block-stacked: promote so `order` takes effect. Any spacing drift
      // (margin-collapse, BFC formation) is caught by the self-check below.
      if (mode === "grid") {
        container.style.display = "grid";
        // One EXPLICIT full-width column. With only the implicit auto track,
        // the column sizes to the widest child's max-content contribution
        // (auth0: +175px from one overflowing section) and every stretched
        // item inherits that width — measured live, 100% pins the track to
        // the container and keeps block-flow widths exactly.
        container.style.gridTemplateColumns = "100%";
        container.style.gridAutoFlow = "row";
      } else {
        container.style.display = "flex";
        container.style.flexDirection = "column";
      }
    }
    kids.forEach((k, i) => {
      k.style.order = String(i * 2);
      if (promoted) {
        // Block-flow width semantics for the new items. Site CSS can carry
        // DORMANT item properties that our promotion would activate
        // (justify-items: center → kids drop stretch and center at natural
        // width: dw=-86,dl=+43 on clickup), and item min-width:auto lets
        // wide content blow past the track where block flow just overflowed
        // (dw=+175 on auth0). Stretch + min-width:0 restores exactly what
        // block flow rendered. Never touched on native flex/grid containers.
        if (mode === "grid") k.style.justifySelf = "stretch";
        else k.style.alignSelf = "stretch";
        k.style.minWidth = "0";
      }
    });
    moveKid.style.order = anchorKid ? String(kids.indexOf(anchorKid) * 2 + 1) : "-1";
    container.setAttribute("data-angel-reorder", "1");

    // SELF-CHECK — every sibling must land where flow says it should,
    // changed only in vertical order. Visible kids: width/left ±2px (border
    // box) and CONTENT height ±12px (envelope — border boxes adopt collapsed
    // margins on promotion while the screen stays identical). Previously
    // invisible kids must stay invisible. No content overlap beyond 8px, doc
    // height within max(48px, 3%).
    let bad = "";
    const after = kids.map((k) => ({ k, r: k.getBoundingClientRect(), env: envelope(k) }));
    for (let i = 0; i < after.length; i++) {
      const { r, env } = after[i];
      const b = before.get(after[i].k)!;
      const bEnv = beforeEnv.get(after[i].k)!;
      if (b.height <= 1) {
        if (env.height > 12) {
          bad = `check-hidden-appeared@${i}:h${Math.round(env.height)}`;
          break;
        }
        continue;
      }
      if (Math.abs(r.width - b.width) > 2 || Math.abs(r.left - b.left) > 2) {
        bad = `check-width-left@${i}:dw${Math.round(r.width - b.width)},dl${Math.round(r.left - b.left)}`;
        break;
      }
      if (Math.abs(env.height - bEnv.height) > 12) {
        bad = `check-height@${i}:dh${Math.round(env.height - bEnv.height)}`;
        break;
      }
    }
    if (!bad) {
      const dh = Math.abs(document.documentElement.scrollHeight - docH);
      if (dh > Math.max(48, docH * 0.03)) bad = "check-docheight";
    }
    if (!bad) {
      const vis = after.filter((x) => x.env.height > 1).sort((a, b) => a.env.top - b.env.top);
      for (let i = 1; i < vis.length; i++) {
        if (vis[i].env.top < vis[i - 1].env.bottom - 8) {
          bad = "check-overlap";
          break;
        }
      }
    }
    if (!bad) {
      // The move must EARN its keep: the focus section visibly earlier (this
      // also refuses explicit-grid no-ops where `order` changed nothing),
      // never above the floor it should follow, never at the very top of
      // the page (even a mis-detected anchor can't excuse landing above
      // the fold's opening content), never collapsed away.
      const t = focusEl.getBoundingClientRect();
      if (focusTop0 - t.top < REORDER_MIN_LIFT_PX) bad = "no-improvement";
      else if (floorEl && t.top < floorEl.getBoundingClientRect().bottom - 40)
        bad = "check-above-anchor";
      else if (t.top + window.scrollY < 300) bad = "check-page-top";
      else if (t.height < 2) bad = "check-collapsed";
    }
    if (bad) {
      undo();
      return { ok: false, err: bad };
    }
  } catch {
    undo();
    return { ok: false, err: "apply-threw" };
  }

  return { ok: true, undo, anchored: !!anchorKid };
}

const reorderProofFirst: Pattern = (inv, ctx) => {
  const secs = inv.sections;
  const ti = secs.findIndex((s) => s.type === "testimonials" && s.selector);
  if (ti < 0) return null;
  const heroI = secs.findIndex((s) => s.type === "hero" && s.selector);
  // Anchor = what the proof must sit AFTER. Never a header/nav/footer: on
  // pages where the hero goes undetected (webflow — its hero classifies as
  // plain "content"), the old sections[0] fallback anchored on the page
  // HEADER, and "below the nav" is satisfied by the very top of the page —
  // the showcase screenshots caught proof landing ABOVE the real hero. Fall
  // back to the first content-ish section instead (usually the real hero).
  const CHROME_SECTIONS = /^(header|nav|footer)$/;
  const anchorI =
    heroI >= 0
      ? heroI
      : secs.findIndex((s) => s.selector && !CHROME_SECTIONS.test(s.type));
  if (anchorI < 0) return null;
  const trail: string[] = [];
  const note = (reason: string): void => {
    trail.push(reason);
    try {
      (window as unknown as { __angelReorderWhy?: string }).__angelReorderWhy = trail.join(";");
    } catch {
      /* ignore */
    }
  };
  const why = (reason: string): null => {
    note(reason);
    return null;
  };
  if (ti <= anchorI + 2) return why("already-early"); // proof already sits early
  const testiEl = q(secs[ti].selector);
  const anchorEl = q(secs[anchorI].selector);
  if (!testiEl || !anchorEl) return why("selector-miss");

  // Sections often sit in per-section WRAPPERS (main > div > section), so
  // direct siblinghood is too strict. Find the nearest common ancestor — the
  // wrappers under it are what visually stack, so they are what `order` moves.
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
  const aChain = new Set(chain(anchorEl));
  let common: HTMLElement | null = null;
  for (const el of tChain) {
    if (el.parentElement && aChain.has(el.parentElement)) {
      common = el.parentElement;
      break;
    }
  }

  // The candidate ladder: L0 = the common ancestor (move the testimonial
  // wrapper to right after the hero wrapper), then each level down toward the
  // testimonial's own parent (move it to the top of its own wrapper group —
  // a smaller but still real lift, and the container there may already be
  // flex/grid where L0's block-promotion drifted). No common ancestor (rare:
  // separate top-level trees) → only the local move remains.
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
  if (!containers.length) return why("no-container");

  let keptAnchored = false;
  let keptDepth = -1;

  // Sections that must not ride along with the moved wrapper (anything
  // outside the testimonial itself).
  const otherSectionEls = secs
    .filter((s, i) => i !== ti && s.selector)
    .map((s) => q(s.selector))
    .filter((el): el is HTMLElement => !!el && !testiEl.contains(el));

  const attempt = (container: HTMLElement, depth: number): string => {
    const res = tryOrderMove({
      container,
      focusEl: testiEl,
      landAfterEl: anchorEl,
      floorEl: anchorEl,
      otherSectionEls,
      mode: "flex",
      minKids: 3,
    });
    if (!res.ok) return `L${depth}:${res.err}`;
    ctx.reverts.push(res.undo);
    keptAnchored = res.anchored;
    keptDepth = depth;
    return "";
  };

  const t0 = performance.now();
  let kept = false;
  for (let d = 0; d < containers.length && d < REORDER_MAX_ATTEMPTS; d++) {
    if (performance.now() - t0 > REORDER_TIME_BUDGET_MS) {
      note(`L${d}:time-budget`);
      break;
    }
    const err = attempt(containers[d], d);
    if (err === "") {
      note(`L${d}:PASS`);
      kept = true;
      break;
    }
    note(err);
  }
  if (!kept) return null; // full trail already in __angelReorderWhy

  const heading = (secs[ti].heading || "testimonials").slice(0, 40);
  return {
    patternId: "reorder_proof_first",
    label: "Move social proof up",
    detail: keptAnchored
      ? `"${heading}" → after ${secs[anchorI].type} (L${keptDepth})`
      : `"${heading}" → top of its group (L${keptDepth})`,
  };
};

// ── E3: Claude-designed reorder plans ───────────────────────────────────────
// The Claude Designer proposes WHERE to move (container/move/after/mode) in
// the safe-primitive vocabulary; this executor grants the plan no more power
// than the automatic ladder has. Non-negotiable regardless of what the plan
// says: the moved element must be the page's proof section, the semantic
// floor stays the detected hero, and every tryOrderMove self-check must pass
// or the attempt rolls itself back pre-paint. Plans only widen TARGETING
// (any container level, explicit anchors, grid promotion, 2-kid swaps).
export type PlannedReorder = {
  action: "reorder";
  container: string;
  move: string;
  after: string | null;
  mode: "flex" | "grid";
  rationale?: string;
};

export type PlannedResult = {
  ok: boolean;
  reason?: string;
  detail?: string;
  revert?: () => void;
};

export function applyPlannedReorder(inv: ContentInventory, plan: PlannedReorder): PlannedResult {
  try {
    if (!plan || plan.action !== "reorder") return { ok: false, reason: "plan-invalid" };
    const container = q(plan.container);
    if (!container) return { ok: false, reason: "container-not-found" };
    const moveEl = q(plan.move);
    if (!moveEl) return { ok: false, reason: "move-not-found" };
    if (!container.contains(moveEl)) return { ok: false, reason: "move-not-in-container" };

    const secs = inv.sections;
    const ti = secs.findIndex((s) => s.type === "testimonials" && s.selector);
    const testiEl = ti >= 0 ? q(secs[ti].selector) : null;
    if (!testiEl) return { ok: false, reason: "no-proof-section" };
    if (!(moveEl === testiEl || moveEl.contains(testiEl) || testiEl.contains(moveEl)))
      return { ok: false, reason: "move-not-proof-section" };

    const heroI = secs.findIndex((s) => s.type === "hero" && s.selector);
    const CHROME_RX = /^(header|nav|footer)$/;
    const floorI =
      heroI >= 0 ? heroI : secs.findIndex((s) => s.selector && !CHROME_RX.test(s.type));
    const floorEl = floorI >= 0 ? q(secs[floorI].selector) : null;

    let landAfterEl: HTMLElement | null = null;
    if (plan.after) {
      landAfterEl = q(plan.after);
      if (!landAfterEl) return { ok: false, reason: "after-not-found" };
      if (!container.contains(landAfterEl)) return { ok: false, reason: "after-not-in-container" };
    }

    const otherSectionEls = secs
      .filter((s, i) => i !== ti && s.selector)
      .map((s) => q(s.selector))
      .filter((el): el is HTMLElement => !!el && !testiEl.contains(el));

    const res = tryOrderMove({
      container,
      focusEl: testiEl,
      landAfterEl,
      floorEl,
      otherSectionEls,
      mode: plan.mode === "grid" ? "grid" : "flex",
      minKids: 2,
    });
    if (!res.ok) return { ok: false, reason: res.err };
    const heading = (secs[ti].heading || "testimonials").slice(0, 40);
    return {
      ok: true,
      detail: `"${heading}" → ${plan.after ? "after planned anchor" : "front of planned container"} (${plan.mode})`,
      revert: res.undo,
    };
  } catch {
    return { ok: false, reason: "planned-threw" };
  }
}

const ALL_PATTERNS: Record<string, Pattern> = {
  trust_bar: trustBar,
  emphasize_primary_cta: emphasizePrimaryCta,
  risk_reducer_bar: riskReducerBar,
  pricing_spotlight: pricingSpotlight,
  reorder_proof_first: reorderProofFirst,
};

// ── The decision layer (v3): which visitor sees which patterns ──────────────
// A segment names a visitor situation the behavior data can support; each maps
// to an ordered pattern set. "default" preserves the v2 behavior (trust bar +
// CTA emphasis) so existing installs are unchanged.
export type Segment = "default" | "new_skimmer" | "engaged_no_click" | "price_hesitant";

export const SEGMENT_PATTERNS: Record<Segment, string[]> = {
  default: ["trust_bar", "emphasize_primary_cta"],
  // First-time visitor bouncing along the surface: earn trust immediately.
  new_skimmer: ["trust_bar"],
  // Read deep, clicked nothing: the offer is interesting but the action isn't
  // landing — bring the proof up (v0.6 reorder), emphasise the action, and
  // back it with the trust bar.
  engaged_no_click: ["reorder_proof_first", "emphasize_primary_cta", "trust_bar"],
  // Interested in price but hesitant: answer the risk objection with the
  // page's own guarantee copy and light the pricing section up.
  price_hesitant: ["risk_reducer_bar", "pricing_spotlight"],
};

// Derive a segment from THIS session's real behavior events. Deliberately
// conservative: only patterns the events can actually support; anything murky
// stays "default". (Cross-session signals — returning visitor, pricing-page
// revisits — arrive with the collector-backed profile in a later milestone.)
export function deriveSegment(
  events: Array<{ type: string; value?: number }>,
  inv: ContentInventory,
): Segment {
  const maxScroll = Math.max(0, ...events.filter((e) => e.type === "scroll_depth").map((e) => e.value ?? 0));
  const ctaClicks = events.filter((e) => e.type === "cta_click").length;
  // The tracker emits time_on_page in MILLISECONDS (Date.now() - started); the
  // thresholds here think in seconds. Normalize: anything over 1000 is ms.
  // (v0.4 compared raw ms against 15 — new_skimmer could never fire on real
  // tracker data and fired always on empty data.)
  const timeRaw = Math.max(0, ...events.filter((e) => e.type === "time_on_page").map((e) => e.value ?? 0));
  const timeSec = timeRaw > 1000 ? timeRaw / 1000 : timeRaw;
  const hasPricing = inv.sections.some((s) => s.type === "pricing");
  if (hasPricing && maxScroll >= 60 && ctaClicks === 0) return "price_hesitant";
  if (maxScroll >= 70 && ctaClicks === 0) return "engaged_no_click";
  if (maxScroll <= 25 && timeSec <= 15) return "new_skimmer";
  return "default";
}

/**
 * Apply the pattern set for a segment (default: the v2 set). Returns what
 * changed and a single `revert()` that undoes all of it. Never throws.
 */
export function applyAdaptations(inv: ContentInventory, segment: Segment = "default"): AdaptationResult {
  const ctx: ApplyCtx = { reverts: [] };
  const applied: AppliedChange[] = [];
  const ids = SEGMENT_PATTERNS[segment] ?? SEGMENT_PATTERNS.default;
  for (const id of ids) {
    const pattern = ALL_PATTERNS[id];
    if (!pattern) continue;
    try {
      const change = pattern(inv, ctx);
      if (change) applied.push(change);
    } catch {
      /* a pattern failure must never affect the host page */
    }
  }
  return {
    applied,
    revert: () => {
      for (const undo of ctx.reverts.reverse()) {
        try {
          undo();
        } catch {
          /* best-effort restore */
        }
      }
      ctx.reverts.length = 0;
    },
  };
}
