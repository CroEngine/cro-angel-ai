// The customer snippet's VARIANT APPLIER — the single source of truth (ADR-001
// step 4). This module IS the code that runs in the visitor's browser: it is
// compiled (types stripped, target es2017) by scripts/build/gen-applier.ts and
// spliced verbatim into public/adaptive.js between the GENERATED APPLIER
// markers. Edit HERE, never the generated block — `bun run gen:applier` re-
// emits it, and CI pins the two together (gen + git diff --exit-code, same
// discipline as the harvest-bundle codegen pin).
//
// Design constraints (why this file looks the way it does):
//  - DEPENDENCY-FREE: no imports. The emitted JS must be self-contained inside
//    the snippet IIFE — every collaborator the applier needs from the snippet
//    (LCP guard, no-touch zones, undo recording, debug-touch feed) is passed in
//    via ApplierDeps instead of closed over.
//  - OLD-SCHOOL BODIES: var/function style, matching the hand-maintained
//    snippet. The snippet is deliberately conservative JS for maximal browser
//    coverage; the es2017 transform guarantees the floor, the style keeps the
//    generated block reviewable next to the rest of the file.
//  - The unit tests (src/adaptive/runtime/__tests__/applier.test.ts) run THIS
//    module in real Chromium; scripts/ci/serving-smoke.mjs then proves the
//    spliced snippet (source + minified) behaves identically on the frozen
//    plausible.io fixture. Two nets, one source.
//
// The apply semantics MIRROR the render harness that verified the plan
// (scripts/redesign/measure.ts) — move_up = lift the located section ONE step
// (per op), skipping trivial dividers; per-move self-check; whole-variant
// atomicity. Op vocabulary: src/adaptive/redesign/serve.ts (ServeOp).

/** A serve-op locator: the section's heading text — the most drift-tolerant
 *  handle a frozen page offers (plus an optional tag filter). */
export interface ApplierLocator {
  tag?: string;
  text: string;
}

/** One browser-applicable op, shape-compatible with ServeOp (serve.ts). */
export interface ApplierOp {
  op: "move_up" | "set_text" | "insert_snippet";
  locator: ApplierLocator;
  value?: string;
  href?: string;
  styleClass?: string;
}

/** The variant the server decided to serve (only the fields the applier reads). */
export interface ApplierVariant {
  id?: string;
  ops: ApplierOp[];
}

/** Everything the applier needs from the host snippet. Injected — the applier
 *  never reaches into snippet globals, so the module is testable in isolation
 *  and the generated block has exactly ONE wiring point. */
export interface ApplierDeps {
  /** True when `el` sits in a no-touch zone (consent chrome, our own badges). */
  isNoTouch(el: Element): boolean;
  /** True when an op on `el` would move/hide/retext the LCP element. */
  touchesLcp(el: Element): boolean;
  /** The page's observed LCP element right now (mutable snippet state). */
  lcpEl(): Element | null;
  /** Sandbox previews have no real visitor to protect — CWV guards stand down. */
  isSandbox: boolean;
  /** Push an undo onto the snippet's reversal stack (reset() runs them LIFO). */
  record(undo: () => void): void;
  /** Feed the debug outline: `el` was modified by `pattern` this apply() run. */
  touched(el: Element, pattern: string): void;
}

// Behåll rubrikens inline-format vid retext (ägarfynd: plausible-hemsidans
// h1 bär en färgad <span> + responsiv <br> som textContent plattade bort).
// Nya texten fördelas över befintliga textfragment proportionellt mot deras
// gamla längd (hela ord) — färger, brytningar och struktur följer med.
// SPEGELVÄND implementation i scripts/redesign/measure.ts — håll i synk.
export function retextPreserve(el: Element, value: string): void {
  var texts: Text[] = [];
  try {
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var t;
    while ((t = w.nextNode())) {
      if (((t as Text).data || "").trim()) texts.push(t as Text);
    }
  } catch (e) {
    /* TreeWalker saknas → platta som förut */
  }
  if (texts.length <= 1) {
    if (texts.length === 1) texts[0].data = String(value);
    else el.textContent = value;
    return;
  }
  var total = 0;
  for (var i = 0; i < texts.length; i++) total += texts[i].data.trim().length;
  var words = String(value).split(/\s+/).filter(Boolean);
  var cum = 0;
  var wi = 0;
  for (var j = 0; j < texts.length; j++) {
    var isLast = j === texts.length - 1;
    cum += texts[j].data.trim().length;
    var upto = isLast ? words.length : Math.round((cum / total) * words.length);
    var frag = words.slice(wi, Math.max(wi, upto));
    wi = Math.max(wi, upto);
    texts[j].data = frag.length ? frag.join(" ") + (isLast ? "" : " ") : "";
  }
}

// En serverad variant är en KORT lista verifierade ops med rubrik-lokatorer.
//
// TVÅFAS-KONTRAKTET (granskningsfynd 2026-07-14 — samma semantik måste gälla
// här och i verifieringsharnesset, annars kan en verifierad design serveras
// annorlunda än den granskades):
//   FAS 1 — UPPLÖS ALLT MOT ORÖRD DOM: varje ops mål (och för move_up dess
//   sektion) slås upp INNAN någon mutation sker. En omtextning kan därför
//   aldrig sabotera en senare flytts lokator. Kan något inte upplösas vägras
//   HELA varianten före första ändringen.
//   FAS 2 — APPLICERA I PLANORDNING på de upplösta elementen: move_up lyfter
//   sektionen ETT syskonsteg per op (aldrig "till toppen"), set_text byter
//   till det exakta verifierade värdet. Failar något rullas allt tillbaka.
//
// Sektionsupplösningen (v3): censusen är h2:or i main, UTAN header/nav/
// footer/aside (logotyp-h1:or och sidfotsrubriker är inte sektioner).
// Sektionen = närmaste FÖRFADER till rubriken som (a) innehåller EXAKT EN
// census-rubrik (sin egen — en wrapper med tre sektioner i är ingen sektion)
// och (b) har minst ett syskon som bär en census-rubrik (nivån där de andra
// sektionerna bor). Ingen sådan nivå ⇒ null ⇒ varianten vägras. Det gör
// platta artikelsidor, delrenderade SPA-vyer och sidor utan sektionsstruktur
// till ärliga vägranden i stället för att hela innehållet flyttas ovanför
// headern (granskningens reproducerade haverier).
/** Build the applier. Returns applyVariant(v): true ⇔ the WHOLE variant landed
 *  (or its residue already marks the page — hydration re-run). Fail-closed and
 *  atomic: any op that cannot resolve or apply safely rolls EVERYTHING back
 *  byte-clean and returns false — a visitor sees the exact approved variant or
 *  the untouched baseline, never a half-variant. */
export function createApplyVariant(deps: ApplierDeps): (v: ApplierVariant) => boolean {
  return function applyVariant(v: ApplierVariant): boolean {
    if (!v || !v.ops || !v.ops.length) return false;
    // Hydrerings-omkörning: syns variant-residue redan är designen på plats —
    // en andra applicering skulle dubbel-lyfta sektionen.
    try {
      if (document.querySelector("[data-angel-moved],[data-angel-retext],[data-angel-inserted]"))
        return true;
    } catch (e) {
      /* querySelector saknas ⇒ fortsätt som förstagångskörning */
    }
    var mainEl = document.querySelector("main") || document.body;
    // Lokatorer är main-scopade — verifieringen såg bara main-innehållet, så
    // en dubblettrubrik i header/footer får aldrig stjäla målet.
    function findByLocator(loc: ApplierLocator): Element | null {
      if (!loc || !loc.text) return null;
      var needle = String(loc.text).replace(/\s+/g, " ").trim().slice(0, 24).toLowerCase();
      if (!needle) return null;
      var els = mainEl.querySelectorAll(loc.tag || "h1,h2,h3");
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (t.indexOf(needle) >= 0) return els[i];
      }
      return null;
    }
    // Census + förberäknade kartor (linjärt, inga H²-skanningar): för varje
    // census-h2 vandras förfäderskedjan en gång; censusCount[el] = antal
    // census-rubriker i el:s underträd.
    var census: Element[] = [];
    var allH2 = mainEl.querySelectorAll("h2");
    for (var c = 0; c < allH2.length; c++) {
      if (!allH2[c].closest("header,nav,footer,aside")) census.push(allH2[c]);
    }
    var censusCount = new Map<Node, number>();
    for (var h = 0; h < census.length; h++) {
      var walk: Node | null = census[h];
      while (walk && walk !== document.body.parentElement) {
        censusCount.set(walk, (censusCount.get(walk) || 0) + 1);
        walk = walk.parentElement;
      }
    }
    function bearsCensus(el: Node): boolean {
      return censusCount.has(el);
    }
    function sectionOf(headEl: Element): Element | null {
      var n = headEl.parentElement;
      while (n && n !== document.body && n !== mainEl.parentElement) {
        if ((censusCount.get(n) || 0) === 1) {
          var p = n.parentElement;
          if (p) {
            for (var i = 0; i < p.children.length; i++) {
              if (p.children[i] !== n && bearsCensus(p.children[i])) return n;
            }
          }
        }
        n = n.parentElement;
      }
      return null; // ingen sektionsnivå ⇒ vägra (aldrig "flytta allt")
    }

    // ── FAS 1: upplös allt mot orörd DOM ──────────────────────────────────
    type Resolved =
      | { op: "move_up"; sec: Element }
      | { op: "set_text"; el: Element; value: string }
      | {
          op: "insert_snippet";
          anchor: Element;
          value: string;
          href: string | null;
          styleClass: string | null;
        };
    var resolved: Resolved[] = [];
    for (var i = 0; i < v.ops.length; i++) {
      var op = v.ops[i];
      var el = findByLocator(op.locator);
      if (!el || deps.isNoTouch(el)) return false;
      if (op.op === "move_up") {
        var sec = sectionOf(el);
        if (!sec || deps.touchesLcp(sec)) return false;
        resolved.push({ op: "move_up", sec: sec });
      } else if (op.op === "set_text") {
        if (!op.value || deps.touchesLcp(el)) return false;
        resolved.push({ op: "set_text", el: el, value: op.value });
      } else if (op.op === "insert_snippet") {
        // Korssid-lyftet (task #117): lokatorn pekar på hjältens h1; det
        // verifierade citatet sätts in som ett <p> DIREKT EFTER hjälte-blocket.
        // Ankaret = h1:ans HÖGSTA förfader som inte bär någon census-h2 — i
        // wrapper-mönstret (main > .page > .hero + .wrapper) blir det .hero,
        // aldrig sid-wrappern (då hade "under hjälten" blivit sidbotten).
        // SPEGELVÄND regel i measure.ts — håll i synk.
        if (!op.value) return false;
        var anchor = el;
        while (
          anchor.parentElement &&
          anchor.parentElement !== mainEl &&
          anchor.parentElement !== document.body &&
          !bearsCensus(anchor.parentElement)
        ) {
          anchor = anchor.parentElement;
        }
        if (!anchor.parentElement || deps.isNoTouch(anchor)) return false;
        // Artikelsidor: LCP-elementet är ofta intro-stycket DIREKT under
        // rubriken. Ligger LCP-elementet NEDANFÖR insättningspunkten omankras
        // till LCP-elementets EGEN högsta census-fria förfader — citatet
        // landar då under hela hjälte-regionen (rubrik + intro) och largest
        // paint står stilla. SPEGELVÄND i measure.ts — håll i synk.
        var lcp0 = deps.lcpEl();
        if (lcp0 && !anchor.contains(lcp0)) {
          try {
            if (anchor.compareDocumentPosition(lcp0) & Node.DOCUMENT_POSITION_FOLLOWING) {
              var re: Element = lcp0 as Element;
              while (
                re.parentElement &&
                re.parentElement !== mainEl &&
                re.parentElement !== document.body &&
                !bearsCensus(re.parentElement)
              ) {
                re = re.parentElement;
              }
              if (re.parentElement) anchor = re;
            }
          } catch (e) {
            /* compareDocumentPosition saknas — behåll hjälte-ankaret */
          }
        }
        // CWV-vakt för insättning: touchesLcp räcker inte här — hjälten FÅR
        // omsluta LCP-elementet (det ligger då OVANFÖR insättningspunkten och
        // rörs inte). Men bor LCP-elementet NEDANFÖR punkten skjuts det när
        // blocket tar plats — vägra, fail closed.
        var lcp1 = deps.lcpEl();
        if (!deps.isSandbox && lcp1 && !anchor.contains(lcp1)) {
          try {
            if (anchor.compareDocumentPosition(lcp1) & Node.DOCUMENT_POSITION_FOLLOWING)
              return false;
          } catch (e) {
            /* som ovan — utan svar vägrar vi hellre inte än gissar */
          }
        }
        // Klickväg + stil-donator (ägarbeslut 2026-07-18 alt. D). Klienten
        // OMVALIDERAR href trots serverns grind — försvarsdjup: bara en
        // sajt-egen absolut path ("/priser") släpps igenom, allt annat
        // renderas som ren text utan länk.
        var insHref =
          typeof op.href === "string" &&
          op.href.charAt(0) === "/" &&
          op.href.indexOf("//") !== 0 &&
          op.href.indexOf(":") < 0 &&
          !/\s/.test(op.href)
            ? op.href
            : null;
        var insClass =
          typeof op.styleClass === "string" && /^[\w -]{1,120}$/.test(op.styleClass)
            ? op.styleClass
            : null;
        resolved.push({
          op: "insert_snippet",
          anchor: anchor,
          value: op.value,
          href: insHref,
          styleClass: insClass,
        });
      } else {
        return false; // okänt verb — fail closed, före första mutation
      }
    }

    // ── FAS 2: applicera i planordning ────────────────────────────────────
    var undos: (() => void)[] = [];
    var ok = true;
    for (var a = 0; a < resolved.length && ok; a++) {
      var r0 = resolved[a];
      if (r0.op === "move_up") {
        // Breddfynd 1: kliv över triviala syskon (census-fria OCH < 8px höga
        // dekor-dividers) så flytten landar ovanför närmsta RIKTIGA syskon i
        // stället för att byta plats med en osynlig linje. SPEGELVÄND regel i
        // mätharnesset (scripts/redesign/measure.ts) — håll i synk.
        var prev = r0.sec.previousElementSibling;
        while (prev && !bearsCensus(prev) && prev.getBoundingClientRect().height < 8) {
          prev = prev.previousElementSibling;
        }
        if (!prev || prev.parentElement !== r0.sec.parentElement) {
          ok = false;
          break;
        }
        var next = r0.sec.nextSibling;
        // Self-check (ADR-001 step 2, ported from the lab's tryOrderMove): a real
        // DOM move can still fail to help or actively break the live page — the
        // frozen page the server verified against may have drifted. Measure the
        // section's top + the document height/width around the move; put it
        // straight back and FAIL THE WHOLE VARIANT (fail-closed) if it:
        //   • never rose — DOM order ≠ visual order in this container (flex/grid
        //     order, a visually-lower earlier sibling), so "move up" doesn't lift
        //     the section — or sends it DOWN; the reorder earns nothing,
        //   • grew/shrank the page past tolerance or introduced horizontal
        //     overflow — the reflow broke the layout,
        //   • collapsed the element away.
        // Whole-variant, NOT skip-this-op: the variant was verified + owner-
        // approved AS A UNIT and its A/B arm must stay one consistent treatment —
        // a visitor sees the exact approved variant or the clean baseline, never a
        // half-variant. (The lab skips just the move because it is client-
        // autonomous with no atomic-variant / measurement contract.) The !ok path
        // below rolls everything back byte-clean. Cheap: runs once, on apply.
        var _doc = document.documentElement;
        var _befTop = r0.sec.getBoundingClientRect().top;
        var _befH = _doc.scrollHeight,
          _befW = _doc.scrollWidth;
        r0.sec.parentElement!.insertBefore(r0.sec, prev);
        var _rect = r0.sec.getBoundingClientRect();
        var _tol = Math.max(48, _befH * 0.03);
        if (
          _befTop - _rect.top < 1 || // never rose ⇒ no benefit (or DOM≠visual order)
          Math.abs(_doc.scrollHeight - _befH) > _tol || // grew/shrank the page
          _doc.scrollWidth > _befW + 2 || // new horizontal overflow
          _rect.width < 1 ||
          _rect.height < 1 // element collapsed/vanished
        ) {
          if (r0.sec.parentElement) r0.sec.parentElement.insertBefore(r0.sec, next);
          ok = false;
          break;
        }
        r0.sec.setAttribute("data-angel-moved", "");
        undos.push(
          (function (s, n) {
            return function () {
              s.removeAttribute("data-angel-moved");
              s.parentElement!.insertBefore(s, n);
            };
          })(r0.sec, next),
        );
        deps.touched(r0.sec, "variant_moved");
      } else if (r0.op === "insert_snippet") {
        // Hydrerings-dedupe (DOM-koll, badge-precedens): finns vårt block redan
        // är designen på plats — hoppa i stället för att skapa en dubblett.
        if (!document.querySelector("[data-angel-inserted]")) {
          var insNode = document.createElement("p");
          // ALLTID textContent, aldrig innerHTML — värdet är data, inte markup;
          // en komprometterad DB-rad kan därför aldrig bli en skriptkanal.
          // Med giltig href blir citatet en LÄNK till källsidan, klädd i
          // landningssidans egen donatorklass (sajtens stilmall bestämmer
          // utseendet). Wrappern centreras — samma neutrala layout-nivå som
          // badge/pill-injektionerna, aldrig färg/typografi från oss.
          if (r0.href) {
            var insLink = document.createElement("a");
            insLink.href = r0.href;
            insLink.textContent = String(r0.value);
            if (r0.styleClass) insLink.className = r0.styleClass;
            insNode.appendChild(insLink);
            insNode.style.textAlign = "center";
          } else {
            insNode.textContent = String(r0.value);
          }
          insNode.setAttribute("data-angel-inserted", "");
          r0.anchor.parentElement!.insertBefore(insNode, r0.anchor.nextSibling);
          undos.push(
            (function (n) {
              return function () {
                if (n.parentElement) n.parentElement.removeChild(n);
              };
            })(insNode),
          );
          deps.touched(insNode, "variant_inserted");
        }
      } else {
        // Ångra via innerHTML, inte textContent: en rubrik kan bära egen markup
        // (spans/radbrytningar) som textContent-skrivningen ersätter — reset
        // måste ge tillbaka sidan BYTE-exakt, inte bara samma text.
        var prevHtml = r0.el.innerHTML;
        var normA = (r0.el.textContent || "").replace(/\s+/g, " ").trim();
        var normB = String(r0.value).replace(/\s+/g, " ").trim();
        if (normA !== normB) retextPreserve(r0.el, r0.value);
        // Markören håller skörde-spärren + hydrerings-kollen seende: variant-
        // text får ALDRIG skördas som sidans egen baslinje (feedback-loopen).
        r0.el.setAttribute("data-angel-retext", "");
        undos.push(
          (function (e, hh) {
            return function () {
              e.removeAttribute("data-angel-retext");
              e.innerHTML = hh;
            };
          })(r0.el, prevHtml),
        );
        deps.touched(r0.el, "variant_retext");
      }
    }
    if (!ok) {
      for (var u = undos.length - 1; u >= 0; u--) {
        try {
          undos[u]();
        } catch (e) {
          /* en trasig ångring får inte stoppa de övriga */
        }
      }
      return false;
    }
    for (var rr = 0; rr < undos.length; rr++) deps.record(undos[rr]);
    return true;
  };
}
