// Delad tvåfas-mätning — EN implementation för alla harness (auto-generate,
// breadth-test, lab/redesign-render). Snippeten (public/adaptive.js) bär
// medvetet en egen kopia av samma semantik (den är fristående JS på kundens
// sida); CI-smoken bevisar ekvivalensen mellan snippet och denna mätning på
// fixturer. Här bor också den delade grind-loopen (runGatedAttempts): samma
// kollisions-retry — ETT extra lyft per UNIKT mål — i alla harness, så
// mätningen och serve_ops alltid räknar samma antal lyft.

import {
  evaluateRenderGates,
  type RenderMeasurements,
} from "../../src/adaptive/redesign/render-gates";

import type { Page } from "playwright-core";

/** En mät-op i PLANORDNING — samma form som snippetens serve-ops.
 *  insert_snippet: `find` lokaliserar hjältens h1, `set` är det ordagranna
 *  citatet som sätts in som <p> direkt efter hjältens toppnivå-block. */
export interface MeasureOp {
  op: "move_up" | "set_text" | "insert_snippet";
  tag?: string;
  find: string;
  set?: string;
  /** insert_snippet: klickväg (sajt-egen path) + stil-donator — speglar
   *  snippetens rendering exakt, annars ljuger evidensbilderna. */
  href?: string;
  styleClass?: string;
  /** insert_snippet: verifierad insättningspunkt — SPEGLAR ApplierOp.placement
   *  (håll i synk). Frånvarande = efter hjältens toppblock; "after_h1" =
   *  direkt efter h1-elementet, inne i hjälten. */
  placement?: string;
}

/** Fånga sidans LCP-element och märk det med data-angel-lcp — måste anropas
 *  DIREKT efter sidladdningen, före första skärmdumpen: fullPage-skärmdumpar
 *  scrollar sidan och får Chromium att emittera nya LCP-entries för element
 *  under folden, som en riktig besökares laddning aldrig ser. Markören läses
 *  sedan av measurePlan i varje mätning (task #105 — servbarhets-kollen).
 *  Buffrade entries levereras asynkront efter observe(); timeouten ger
 *  observern en task att hinna på. Returnerar diagnostik för loggning. */
export async function captureLcpElement(
  page: Page,
): Promise<{ found: boolean; tag: string | null; text: string | null }> {
  return page.evaluate(async () => {
    for (const el of Array.from(document.querySelectorAll("[data-angel-lcp]"))) {
      el.removeAttribute("data-angel-lcp");
    }
    const lcpEl: Element | null = await new Promise((resolve) => {
      try {
        let found: Element | null = null;
        const po = new PerformanceObserver((list) => {
          const es = list.getEntries();
          const last = es[es.length - 1] as { element?: Element } | undefined;
          if (last && last.element) found = last.element;
        });
        po.observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => {
          po.disconnect();
          resolve(found);
        }, 120);
      } catch {
        resolve(null);
      }
    });
    if (!lcpEl) return { found: false, tag: null, text: null };
    lcpEl.setAttribute("data-angel-lcp", "1");
    return {
      found: true,
      tag: lcpEl.tagName.toLowerCase(),
      text: (lcpEl.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) || null,
    };
  });
}

/** Tvåfas-mätningen — SAMMA kontrakt som snippetens applyVariant v3
 *  (granskningsfynd 2026-07-14): (1) upplös varje ops mål (och sektion) mot
 *  ORÖRD, main-scopad DOM; (2) applicera i planordning. keepApplied=true
 *  lämnar sidan applicerad (för EFTER-skärmdumpen) i stället för att en
 *  tredje algoritm återappliceras. */
export async function measurePlan(
  page: Page,
  ops: MeasureOp[],
  ctaTexts: string[],
  keepApplied = false,
  // Ägarens conversion_selector (rått-override-sajter har text=null) — hit-testas
  // precis som texterna så vakuum-varningen inte återkommer för dem.
  ctaSelectors: string[] = [],
) {
  return page.evaluate(
    ({ ops, ctaTexts, ctaSelectors, keepApplied }) => {
      const mainEl = document.querySelector("main") || document.body;
      const de = document.documentElement;
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();

      // ── CMP-dialoger bort FÖRE mätning ─────────────────────────────────
      // En fryst kopia bär ofta samtyckesdialogen i öppet läge (ingen JS som
      // stänger den) — den la sig över Trellos signup-knapp och fällde
      // CTA-hit-testet trots att sidans egen design är hel (retestfynd
      // 2026-07-18). Snippeten rör aldrig dessa live (NO_TOUCH-listan i
      // public/adaptive.js — SPEGELVÄND selektorlista, håll i synk); harnesset
      // mäter SIDAN, inte tredjeparts-CMP:n. Borttagningen sker i sidkopians
      // DOM och påverkar aldrig något live.
      const CMP_ROOTS =
        "#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay," +
        "#onetrust-consent-sdk,#onetrust-banner-sdk," +
        "#usercentrics-root,#uc-center-container," +
        ".osano-cm-window,.osano-cm-dialog," +
        "#didomi-host,#didomi-notice," +
        ".cc-window,.cc-banner," +
        "#cookiescript_injected," +
        "[data-lovable-cookie-root]," +
        // Atlassian/Trello-klassen: generiska consent-rot-id:n som inte täcks
        // av leverantörslistan men alltid är overlays i fryst läge.
        "[id*='cookie-consent' i],[class*='cookie-banner' i],[id*='consent-banner' i]";
      try {
        for (const el of Array.from(document.querySelectorAll(CMP_ROOTS))) el.remove();
      } catch {
        /* trasig selektor i någon motor — mätningen fortsätter utan strippning */
      }

      // ── LCP-elementet — samma vakt-semantik som snippeten ──────────────
      // Fångas EN gång per sidladdning av captureLcpElement (direkt efter
      // load, FÖRE skärmdumpar): fullPage-skärmdumpen scrollar sidan och får
      // Chromium att emittera nya LCP-entries för element under folden —
      // något en riktig besökares laddning aldrig gör (LCP-prob 2026-07-16).
      // Markören är sanningen; utan markör (inte anropad, eller elementet
      // föll ur DOM:en vid en reset) blir lcpFound=false och render-gates
      // säger ärligt att servbarhets-kollen var vakuös — fail closed.
      const lcpEl: Element | null = document.querySelector("[data-angel-lcp]");
      // Exakt snippet-semantik (touchesLcp i public/adaptive.js): målet ÄR
      // LCP-elementet, omsluter det, eller bor i det.
      const touchesLcp = (el: Element | null): boolean => {
        if (!lcpEl || !el) return false;
        try {
          return el === lcpEl || el.contains(lcpEl) || lcpEl.contains(el);
        } catch {
          return false;
        }
      };

      // ── v3-upplösning (identisk med snippeten) ──────────────────────────
      // Census: h2 i main, aldrig header/nav/footer/aside. Förberäknade
      // förfaderskartor gör allt linjärt (granskningens O(H²)-fynd).
      const census = Array.from(mainEl.querySelectorAll("h2")).filter(
        (h) => !h.closest("header,nav,footer,aside"),
      );
      const censusCount = new Map<Element, number>();
      for (const h of census) {
        let walk: Element | null = h;
        while (walk && walk !== document.documentElement) {
          censusCount.set(walk, (censusCount.get(walk) ?? 0) + 1);
          walk = walk.parentElement;
        }
      }
      function sectionOf(headEl: Element): Element | null {
        let n: Element | null = headEl.parentElement;
        while (n && n !== document.body && n !== mainEl.parentElement) {
          if ((censusCount.get(n) ?? 0) === 1) {
            const p: Element | null = n.parentElement;
            if (p) {
              for (const sib of Array.from(p.children)) {
                if (sib !== n && censusCount.has(sib)) return n;
              }
            }
          }
          n = n.parentElement;
        }
        return null;
      }
      function findByLocator(tag: string | undefined, find: string): Element | null {
        const full = norm(find).toLowerCase();
        if (!full) return null;
        const els = Array.from(mainEl.querySelectorAll(tag || "h1,h2,h3"));
        // Pass 1 — EXACT full-heading match. The locator text IS a section's own
        // heading (extract.ts: heading = h.text.slice(0,120)); when two sections
        // share the first 24 chars but differ later, only the exact match resolves
        // the INTENDED section — otherwise the harness verifies (and the snippet
        // then serves) a move of the WRONG section (bug-hunt 2026-07, sev high).
        // MIRRORED in the snippet (src/adaptive/runtime/applier.ts findByLocator).
        for (const el of els) {
          if (norm(el.textContent || "").toLowerCase() === full) return el;
        }
        // Pass 2 — substring fallback (first 24 chars): a drift-tolerant handle for
        // when the live heading changed slightly since the frozen page was verified.
        const needle = full.slice(0, 24);
        for (const el of els) {
          if (
            norm(el.textContent || "")
              .toLowerCase()
              .includes(needle)
          )
            return el;
        }
        return null;
      }

      // ── rapporterings-modellen: sektioner + block ───────────────────────
      const tracked: { label: string; el: Element }[] = [];
      for (const h of census) {
        const sec = sectionOf(h);
        if (sec && !tracked.some((t) => t.el === sec))
          tracked.push({ label: norm(h.textContent || "").slice(0, 40), el: sec });
      }
      const docSort = (a: Element, b: Element) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      // Identitetssekvens för logik (dubblettrubriker gör etiketter opålitliga),
      // etiketter för läsbar rapport — unika via #n-suffix vid krock.
      const displayLabels = tracked.map((t, i) => {
        const dupes = tracked.filter((x) => x.label === t.label);
        return dupes.length > 1 ? `${t.label} #${dupes.indexOf(t) + 1}` : t.label;
      });
      const identityOrder = () =>
        tracked
          .map((t, i) => ({ i, el: t.el }))
          .sort((a, b) => docSort(a.el, b.el))
          .map((x) => x.i);
      const labelsOf = (idx: number[]) => idx.map((i) => displayLabels[i]);

      // Block-mängd för överlapp/hjälte: barn till main + sektionsföräldrar,
      // nesting-fri (ett block som INNEHÅLLER ett annat block utesluts — annars
      // jämförs wrappern mot sin egen sektion). Granskningens fynd: överlapp
      // ska ses ÖVER föräldragränser (lyft sektion mot hjälte i annan låda).
      const parents = [
        ...new Set(tracked.map((t) => t.el.parentElement).filter(Boolean)),
      ] as Element[];
      const rawBlocks = [
        ...new Set([
          ...Array.from(mainEl.children),
          ...parents.flatMap((p) => Array.from(p.children)),
        ]),
      ].filter((b) => b.getBoundingClientRect().height > 30);
      const blocks = rawBlocks.filter((b) => !rawBlocks.some((o) => o !== b && b.contains(o)));
      const blockPairsOverlap = () => {
        const sorted = blocks.slice().sort(docSort);
        const m = new Map<Element, number>();
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i].getBoundingClientRect();
          const b = sorted[i + 1].getBoundingClientRect();
          m.set(sorted[i], Math.round(a.bottom - b.top));
        }
        return m;
      };
      // Hjälten = blocket som bär sidans h1 (finns alltid en h1 på sidorna vi
      // designar för; annars första blocket).
      const h1 = mainEl.querySelector("h1");
      const heroBlock =
        (h1 && blocks.find((b) => b === h1 || b.contains(h1))) ??
        blocks.slice().sort(docSort)[0] ??
        null;
      // Hjälte-klampens ankare — SPEGELVÄND snippetens (applier.ts, håll i
      // synk): main-scopad h1 (aldrig header/nav/footer/aside) klättrad till
      // sin HÖGSTA census-fria förfader, samma klätterregel som insert-ankaret.
      // (Skiljer sig medvetet från heroBlock ovan, som är grindarnas
      // block-modell — klampen måste räkna EXAKT som klienten räknar.)
      let clampHead: Element | null = h1;
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

      function hitTest(el: Element): boolean {
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        return !!top && (el.contains(top) || top.contains(el));
      }
      function ctaClickable(text: string): boolean | null {
        // Snabbvägen: a/button som bär texten i INNEHÅLL eller ARIA-LABEL —
        // cover-/ikonlänkar är ofta tomma element med namnet i aria
        // (Teamtailor-fyndet 2026-07-18: <a aria-label="Boka en demo"></a>).
        const direct = Array.from(document.querySelectorAll("a,button")).filter((n) =>
          norm(`${n.textContent || ""} ${n.getAttribute("aria-label") || ""}`).includes(text),
        );
        const visible = direct.find((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        // Träffar direktkandidaten är vi klara — men faller hit-testet
        // (overlay över knappen, Trello-obduktionen) provas ÄVEN bärarvägen
        // innan domen: en annan markup-form av samma CTA kan vara träffbar.
        if (visible && hitTest(visible)) return true;
        // Cover-link-mönstret: den SYNLIGA knappen är en ren text-div
        // (aria-hidden) och länken ett tomt absolut-positionerat syskon
        // OVANPÅ — ingen klickbar förfader finns, och a/button-kandidaterna
        // är gömda nav-dubbletter (0×0). Semantiken en användare bryr sig om:
        // träffar ett klick där TEXTEN står en länk/knapp? Djupaste synliga
        // textbärare (top-down så stora sidor inte skannas kvadratiskt),
        // klickpunkt i centrum, närmaste klickbara i det som tar emot klicket.
        const bearers: Element[] = [];
        const stack: Element[] = [document.body];
        while (stack.length && bearers.length < 8) {
          const el = stack.pop()!;
          const kids = Array.from(el.children).filter((c) =>
            norm(c.textContent || "").includes(text),
          );
          if (kids.length === 0) {
            if (el !== document.body && norm(el.textContent || "").includes(text)) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) bearers.push(el);
            }
          } else {
            for (const k of kids) stack.push(k);
          }
        }
        if (!direct.length && !bearers.length) return null;
        for (const el of bearers) {
          el.scrollIntoView({ block: "center" });
          const r = el.getBoundingClientRect();
          const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
          const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
          const top = document.elementFromPoint(cx, cy);
          const clickable = top ? top.closest("a,button,[role=button]") : null;
          if (!clickable) continue;
          // SAMMA komponent-krav: klickmottagaren måste bo i bärarens närmsta
          // komponent-förfäder (≤3 nivåer upp) — cover-länken i Teamtailors
          // knapp-widget gör det; en främmande overlay-länk ovanpå (Trellos
          // ostylade kollaps) gör det INTE och får aldrig räknas som träff.
          let anc: Element | null = el;
          for (let i = 0; i < 4 && anc; i++) {
            if (anc.contains(clickable)) return true;
            anc = anc.parentElement;
          }
        }
        return false;
      }
      function ctaClickableSel(sel: string): boolean | null {
        let el: Element | null = null;
        try {
          el = document.querySelector(sel);
        } catch {
          return null; // ogiltig selektor ≠ trasig sida — bara inget att kontrollera
        }
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return false;
        return hitTest(el);
      }
      // Text- och selektor-prober i EN lista; paras före/efter via index så
      // dubblett-nycklar aldrig kan korspara.
      const ctaProbes: { key: string; bySel: boolean }[] = [
        ...ctaTexts.map((t) => ({ key: t, bySel: false })),
        ...ctaSelectors.map((s) => ({ key: s, bySel: true })),
      ];
      const probeCta = (p: { key: string; bySel: boolean }) =>
        p.bySel ? ctaClickableSel(p.key) : ctaClickable(p.key);

      // ── FÖRE-mätningar ─────────────────────────────────────────────────
      const ctaBefore = ctaProbes.map((p) => probeCta(p));
      const beforeIdx = identityOrder();
      const hOverflowBeforePx = Math.max(0, de.scrollWidth - de.clientWidth);
      const overlapBefore = blockPairsOverlap();
      const vOverlapBeforePx = Math.max(0, ...overlapBefore.values());
      // LCP-elementets ABSOLUTA dokumentposition (scroll-invariant — CTA-
      // proberna scrollar). touchesLcp fångar bara ops PÅ elementet; en
      // insättning/flytt OVANFÖR det skjuter det utan att röra det, och det
      // är exakt vad lcpShiftPx mäter (task #117: grinden LCP-förskjutning).
      const lcpTop = () => (lcpEl ? lcpEl.getBoundingClientRect().top + window.scrollY : null);
      const lcpTopBefore = lcpTop();
      // Byte-exakt reset: ALLA noder (även textnoder) per berörd förälder.
      const resetParents = [...new Set([mainEl, ...parents])];
      const parentSnapshots = resetParents.map((p) => ({ p, nodes: Array.from(p.childNodes) }));

      // ── FAS 1: upplös allt mot orörd DOM ───────────────────────────────
      type Resolved =
        | { op: "move_up"; sec: Element }
        | { op: "set_text"; el: Element; set: string }
        | {
            op: "insert_snippet";
            anchor: Element;
            set: string;
            href?: string;
            styleClass?: string;
          };
      const resolved: Resolved[] = [];
      // No-touch-zonerna SPEGLADE (granskningsfynd 2026-07-28): klienten
      // vägrar HELA varianten när målet ligger i en no-touch-zon
      // (deps.isNoTouch i applier.ts). CMP-rötterna är redan bortstrippade
      // ovan (ekvivalent), men ägar-markerade zoner och våra egna badges
      // fanns INTE speglade — harnesset verifierade varianter klienten
      // alltid vägrar. Samma vägran här: oupplösbar, fail closed.
      const NO_TOUCH_MIRROR = "[data-angel-ignore],.angel-badge";
      let insertRefusedByLcpGuard = 0;
      let resolvedAll = true;
      for (const o of ops) {
        const el = findByLocator(o.tag, o.find);
        if (!el || el.closest(NO_TOUCH_MIRROR)) {
          resolvedAll = false;
          break;
        }
        if (o.op === "move_up") {
          const sec = sectionOf(el);
          if (!sec) {
            resolvedAll = false;
            break;
          }
          resolved.push({ op: "move_up", sec });
        } else if (o.op === "insert_snippet") {
          // Hjälte-ankaret: h1:ans HÖGSTA förfader som inte bär någon census-h2
          // — i wrapper-mönstret (main > .page > .hero + .wrapper) blir det
          // .hero, aldrig sid-wrappern ("under hjälten" får inte bli sidbotten).
          // SPEGELVÄND regel i snippetens applyVariant (public/adaptive.js) —
          // håll i synk.
          if (!o.set) {
            resolvedAll = false;
            break;
          }
          let anchor: Element = el;
          // Placerings-stegen (2026-07-27) — SPEGELVÄND snippetens (håll i
          // synk): "after_h1" hoppar över klättringen OCH re-ankringen —
          // raden landar direkt efter h1-elementet, inne i hjälten.
          if (o.placement !== "after_h1") {
            while (
              anchor.parentElement &&
              anchor.parentElement !== mainEl &&
              anchor.parentElement !== document.body &&
              !censusCount.has(anchor.parentElement)
            ) {
              anchor = anchor.parentElement;
            }
          }
          if (!anchor.parentElement) {
            resolvedAll = false;
            break;
          }
          // Artikelsidor: LCP-elementet är ofta intro-stycket DIREKT under
          // rubriken (plausible-fyndet 2026-07-18: +24px LCP-skjuts). Ligger
          // LCP-elementet NEDANFÖR insättningspunkten omankras till LCP-
          // elementets EGEN högsta census-fria förfader — citatet landar då
          // under hela hjälte-regionen (rubrik + intro) och largest paint
          // står stilla. Djupt liggande LCP ger stora gap som gap-varningen
          // håller tillbaka. SPEGELVÄND i snippeten — håll i synk.
          if (
            o.placement !== "after_h1" &&
            lcpEl &&
            !anchor.contains(lcpEl) &&
            anchor.compareDocumentPosition(lcpEl) & Node.DOCUMENT_POSITION_FOLLOWING
          ) {
            let re: Element = lcpEl;
            while (
              re.parentElement &&
              re.parentElement !== mainEl &&
              re.parentElement !== document.body &&
              !censusCount.has(re.parentElement)
            ) {
              re = re.parentElement;
            }
            if (re.parentElement) anchor = re;
          }
          // Snippetens AVSLUTANDE CWV-vakt SPEGLAD (granskningsfynd
          // 2026-07-28): klienten vägrar HELA varianten när LCP-elementet
          // ligger NEDANFÖR den slutliga insättningspunkten (applier.ts,
          // vakten efter omankringen) — den träffar särskilt after_h1 på
          // sidor där LCP inte är h1:an (hjältebild/intro under rubriken).
          // Utan spegling godkände harnesset varianter som klienten alltid
          // rullar tillbaka ⇒ A/B mäter original mot original. Räknas mot
          // det SLUTLIGA ankaret, precis som klienten räknar.
          if (
            lcpEl &&
            !anchor.contains(lcpEl) &&
            anchor.compareDocumentPosition(lcpEl) & Node.DOCUMENT_POSITION_FOLLOWING
          ) {
            insertRefusedByLcpGuard++;
          }
          if (anchor.closest(NO_TOUCH_MIRROR)) {
            resolvedAll = false;
            break;
          }
          resolved.push({
            op: "insert_snippet",
            anchor,
            set: o.set,
            href: o.href,
            styleClass: o.styleClass,
          });
        } else {
          if (!o.set) {
            resolvedAll = false;
            break;
          }
          resolved.push({ op: "set_text", el, set: o.set });
        }
      }
      // Servbarhets-kollen (task #105): snippetens vakt fäller HELA varianten
      // fail-closed när ett upplöst mål (sektionen för move_up, elementet för
      // set_text) rör LCP-elementet — en sådan variant når aldrig en riktig
      // besökare. Räknas mot exakt de mål appliceringen använder.
      // insert_snippet räknas MEDVETET inte här: ankaret (hjälten) omsluter
      // nästan alltid LCP-elementet men muteras inte — insättningens verkliga
      // CWV-effekt mäts geometriskt av lcpShiftPx nedan (och snippetens
      // klient-vakt vägrar insättningar OVANFÖR LCP-elementet).
      let opsTouchingLcp = 0;
      if (resolvedAll) {
        for (const r of resolved) {
          if (r.op === "insert_snippet") continue;
          if (touchesLcp(r.op === "move_up" ? r.sec : r.el)) opsTouchingLcp++;
        }
      }

      // ── FAS 2: applicera i planordning ─────────────────────────────────
      let appliedMoves = 0;
      // Flyttar som INTE lyfte sektionen visuellt (per steg, DOM-ordning ≠
      // visuell ordning: en "move up" landar före ett syskon som renderas
      // lägre → sektionen sjunker). SPEGELVÄND av snippetens reorder-självkoll
      // (src/adaptive/runtime/applier.ts, ADR-001 steg 2): där rullar en
      // no-lift-flytt HELA varianten tillbaka fail-closed. Mäts per steg —
      // exakt som klienten — så mätharnesset aldrig godkänner en flytt
      // klienten sedan vägrar serva (annars mäter A/B-armen original mot
      // original, samma fälla som LCP).
      let moveNoRise = 0;
      // Klientens ÖVRIGA självkoll-villkor, per steg med SAMMA trösklar
      // (granskningsfynd 2026-07-22 — harnesset speglade bara lyft-kollen;
      // dokumenthöjd/överflöde/kollaps saknades helt eller låg på lösare
      // globala trösklar, så en variant kunde verifieras som klienten sedan
      // alltid rullar tillbaka): |ΔdocH| > max(48, 3%), scrollWidth > +2px,
      // eller sektionen kollapsad (<1px) efter flytten.
      let moveUnsafe = 0;
      // Begärda flyttar vars mål saknar giltigt föregående syskon — klienten
      // fäller HELA varianten (ok=false), harnesset får inte nöja sig med en
      // tyst skip + warn (samma oservbarhets-klass som ovan).
      let moveUnappliable = 0;
      let appliedTexts = 0;
      let appliedInserts = 0;
      const movedEls: Element[] = [];
      const insertedEls: Element[] = [];
      const textSnapshots: { el: Element; html: string }[] = [];
      // Flytt-målens absoluta topp FÖRE apply: ordnings-jämförelsen ser bara
      // census-sektioner, men en flytt över en rubriklös GRANNSEKTION (Trello-
      // obduktionen, breddfynd 1) är visuellt äkta — förskjutningen i px är
      // beviset metriken annars är blind för.
      const moveTopsBefore = new Map<Element, number>();
      if (resolvedAll) {
        for (const r of resolved) {
          if (r.op === "move_up" && !moveTopsBefore.has(r.sec)) {
            moveTopsBefore.set(r.sec, r.sec.getBoundingClientRect().top + window.scrollY);
          }
        }
      }
      if (resolvedAll) {
        for (const r of resolved) {
          if (r.op === "move_up") {
            // Breddfynd 1 (linear-obduktionen 2026-07-18): syskonet närmast
            // ovanför är ofta en 1-2px dekor-divider — en-stegsflytten byter
            // då bara plats med en osynlig linje och sidan står still. Kliv
            // över triviala syskon (census-fria OCH < 8px höga) och landa
            // ovanför närmsta RIKTIGA syskon. SPEGELVÄND i snippetens
            // applyVariant (public/adaptive.js) — håll i synk.
            let prev = r.sec.previousElementSibling;
            while (prev && !censusCount.has(prev) && prev.getBoundingClientRect().height < 8) {
              prev = prev.previousElementSibling;
            }
            // Hjälte-klampen — SPEGELVÄND snippetens (applier.ts, håll i
            // synk): sitter sektionen nedanför hjälteblocket och skulle
            // flytten landa den ovanför ⇒ klienten vägrar hela varianten,
            // så grinden måste räkna samma vägran (moveUnappliable).
            let clampedByHero = false;
            if (heroClamp && prev && r.sec !== heroClamp) {
              try {
                const secBelowHero = !!(
                  heroClamp.compareDocumentPosition(r.sec) & Node.DOCUMENT_POSITION_FOLLOWING
                );
                const landsAboveHero =
                  prev === heroClamp ||
                  !!(prev.compareDocumentPosition(heroClamp) & Node.DOCUMENT_POSITION_FOLLOWING);
                clampedByHero = secBelowHero && landsAboveHero;
              } catch {
                /* som klienten: utan svar vilar klampen */
              }
            }
            if (!clampedByHero && prev && r.sec.parentElement === prev.parentElement) {
              // Per-steg självkoll — SPEGELVÄND snippetens (ADR-001 steg 2):
              // mät sektionens topp + dokumentets höjd/bredd direkt före/efter
              // DENNA insertBefore med exakt klientens trösklar (< 1px = lyfte
              // inte; |ΔH| > max(48, 3%); bredd > +2px; kollaps < 1px). Varje
              // villkor som fäller klienten (hela varianten, fail-closed) måste
              // fälla grinden här med — annars godkänns en variant som aldrig
              // servas och A/B-armen mäter original mot original.
              const topBefore = r.sec.getBoundingClientRect().top;
              const befH = de.scrollHeight;
              const befW = de.scrollWidth;
              r.sec.parentElement!.insertBefore(r.sec, prev);
              const rect = r.sec.getBoundingClientRect();
              const tol = Math.max(48, befH * 0.03);
              if (rect.top >= topBefore - 1) moveNoRise++;
              if (
                Math.abs(de.scrollHeight - befH) > tol ||
                de.scrollWidth > befW + 2 ||
                rect.width < 1 ||
                rect.height < 1
              ) {
                moveUnsafe++;
              }
              if (!movedEls.includes(r.sec)) movedEls.push(r.sec);
              appliedMoves++;
            } else {
              moveUnappliable++;
            }
          } else if (r.op === "insert_snippet") {
            // Samma applicering som snippeten: <p> med textContent (aldrig
            // innerHTML), markör, direkt efter hjälte-blocket.
            const node = document.createElement("p");
            // SPEGELVÄND rendering mot snippeten (håll i synk): giltig href ⇒
            // länk i landningssidans donatorklass, centrerad wrapper; annars
            // ren text. Alltid textContent — aldrig markup ur data.
            if (r.href) {
              const link = document.createElement("a");
              link.href = r.href;
              link.textContent = r.set;
              if (r.styleClass) link.className = r.styleClass;
              node.appendChild(link);
              node.style.textAlign = "center";
            } else {
              node.textContent = r.set;
            }
            node.setAttribute("data-angel-inserted", "");
            r.anchor.parentElement!.insertBefore(node, r.anchor.nextSibling);
            insertedEls.push(node);
            appliedInserts++;
          } else {
            textSnapshots.push({ el: r.el, html: r.el.innerHTML });
            // Behåll inline-formatet (färgad <span>, responsiv <br>): fördela
            // nya texten över befintliga textfragment proportionellt — samma
            // semantik som snippetens retextPreserve (public/adaptive.js);
            // håll i synk, annars ljuger evidensbilderna om live-utseendet.
            if (norm(r.el.textContent || "") !== norm(r.set)) {
              const texts: Text[] = [];
              const w = document.createTreeWalker(r.el, NodeFilter.SHOW_TEXT, null);
              let t: Node | null;
              while ((t = w.nextNode())) {
                if (((t as Text).data || "").trim()) texts.push(t as Text);
              }
              if (texts.length <= 1) {
                if (texts.length === 1) texts[0].data = r.set;
                else r.el.textContent = r.set;
              } else {
                const total = texts.reduce((a, x) => a + x.data.trim().length, 0);
                const words = r.set.split(/\s+/).filter(Boolean);
                let cum = 0;
                let wi = 0;
                texts.forEach((node, j) => {
                  const isLast = j === texts.length - 1;
                  cum += node.data.trim().length;
                  const upto = isLast ? words.length : Math.round((cum / total) * words.length);
                  const frag = words.slice(wi, Math.max(wi, upto));
                  wi = Math.max(wi, upto);
                  node.data = frag.length ? frag.join(" ") + (isLast ? "" : " ") : "";
                });
              }
            }
            appliedTexts++;
          }
        }
      }

      // ── EFTER-mätningar ────────────────────────────────────────────────
      const afterIdx = identityOrder();
      const hOverflowAfterPx = Math.max(0, de.scrollWidth - de.clientWidth);
      const overlapAfter = blockPairsOverlap();
      const vOverlapAfterPx = Math.max(0, ...overlapAfter.values());
      // Introducerat överlapp PER PAR (granskningens fynd: ett globalt
      // före-max får inte maskera ett nytt överlapp någon annanstans).
      let overlapIntroducedPx = 0;
      for (const [el, after] of overlapAfter) {
        const before = overlapBefore.get(el) ?? 0;
        overlapIntroducedPx = Math.max(overlapIntroducedPx, after - Math.max(0, before));
      }
      // Flyttad ovanför HJÄLTEN — i dokumentordning, fungerar även inne i
      // wrappers (geometri-ankaret kunde inte se in i lådor).
      let movedAboveMain = 0;
      if (heroBlock) {
        for (const el of movedEls) {
          if (
            el !== heroBlock &&
            !(heroBlock.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
          ) {
            movedAboveMain++;
          }
        }
      }
      // Insättningens egna mått (task #117): LCP-förskjutningen fångar det
      // touchesLcp inte kan (elementet skjuts utan att röras); ovanför-hjälten
      // speglar movedAboveMain; gapet till h1:an avslöjar wrapper-ankare där
      // "efter hjälte-blocket" i praktiken blev "sidans botten"; hit-testet
      // bevisar att det insatta blocket faktiskt SYNS (inte täckt/dolt).
      const lcpTopAfter = lcpTop();
      const lcpShiftPx =
        lcpTopBefore !== null && lcpTopAfter !== null
          ? Math.round(Math.abs(lcpTopAfter - lcpTopBefore))
          : null;
      // Största faktiska förflyttningen (px) bland flyttade sektioner —
      // avblindar "order unchanged"-varningen när flytten korsade en
      // rubriklös sektion som ordnings-listan inte kan se.
      let movedShiftPx = 0;
      for (const el of movedEls) {
        const b = moveTopsBefore.get(el);
        if (b !== undefined) {
          movedShiftPx = Math.max(
            movedShiftPx,
            Math.round(Math.abs(el.getBoundingClientRect().top + window.scrollY - b)),
          );
        }
      }
      let insertedAboveMain = 0;
      let insertedGapToHeroPx = 0;
      let insertedVisible = true;
      if (insertedEls.length > 0) {
        const h1El = mainEl.querySelector("h1");
        for (const el of insertedEls) {
          // Referensen är H1:AN, inte heroBlock: i wrapper-mönstret är hjälten
          // inget block (main > .page > .hero + .wrapper) och heroBlock-
          // fallbacken blir FÖRSTA SEKTIONEN — en korrekt insättning under
          // hjälten men ovanför sektionerna hade false-fällts (labbfynd
          // 2026-07-18). "Under hjälten" betyder efter hjälterubriken.
          if (h1El && !(h1El.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            insertedAboveMain++;
          }
          if (h1El) {
            const gap = Math.round(
              el.getBoundingClientRect().top +
                window.scrollY -
                (h1El.getBoundingClientRect().bottom + window.scrollY),
            );
            insertedGapToHeroPx = Math.max(insertedGapToHeroPx, gap);
          }
          if (!hitTest(el)) insertedVisible = false;
        }
      }
      const ctaAfter = ctaProbes.map((p) => probeCta(p));
      let ctaChecked = 0;
      let ctaBroken = 0;
      for (let i = 0; i < ctaBefore.length; i++) {
        if (ctaBefore[i] === true) {
          ctaChecked++;
          if (ctaAfter[i] !== true) ctaBroken++;
        }
      }

      // ── reset (om inte EFTER-läget ska behållas för skärmdump) ─────────
      let reversedOrderMatches = true;
      let insertedRemoved = true;
      if (!keepApplied) {
        // Insatta noder tas bort FÖRE snapshot-återuppspelningen: snapshots
        // återappenderar bara ORIGINALETS noder — en kvarglömd insättning
        // överlever annars osynlig för sektions-identitetsjämförelsen.
        for (const el of insertedEls) el.remove();
        for (const snap of parentSnapshots) for (const n of snap.nodes) snap.p.appendChild(n);
        for (const s of textSnapshots) s.el.innerHTML = s.html;
        for (const el of movedEls) el.removeAttribute("data-angel-moved");
        reversedOrderMatches = JSON.stringify(identityOrder()) === JSON.stringify(beforeIdx);
        insertedRemoved = insertedEls.every((el) => !document.contains(el));
      }

      return {
        resolvedAll,
        beforeOrder: labelsOf(beforeIdx),
        afterOrder: labelsOf(afterIdx),
        orderChanged: JSON.stringify(afterIdx) !== JSON.stringify(beforeIdx),
        hOverflowBeforePx,
        hOverflowAfterPx,
        vOverlapBeforePx,
        vOverlapAfterPx,
        overlapIntroducedPx: Math.max(0, overlapIntroducedPx),
        movedCount: movedEls.length,
        movedAboveMain,
        mainAnchorFound: heroBlock !== null,
        ctaChecked,
        ctaBroken,
        requestedMoves: ops.filter((o) => o.op === "move_up").length,
        appliedMoves,
        moveNoRise,
        moveUnsafe,
        moveUnappliable,
        requestedTexts: ops.filter((o) => o.op === "set_text").length,
        appliedTexts,
        requestedInserts: ops.filter((o) => o.op === "insert_snippet").length,
        appliedInserts,
        insertedAboveMain,
        insertedGapToHeroPx,
        insertedVisible,
        insertedRemoved,
        lcpShiftPx,
        movedShiftPx,
        reversedOrderMatches,
        lcpFound: lcpEl !== null,
        opsTouchingLcp,
        insertRefusedByLcpGuard,
      };
    },
    { ops, ctaTexts, ctaSelectors, keepApplied },
  );
}

/** measurePlan-råvärden → render-gates-form (inkl. namnbytet
 *  overlapIntroducedPx → verticalOverlapIntroducedPx). En mappning, tre
 *  harness — fältlistan kan inte glida isär per skript. */
export function toRenderMeasurements(
  raw: Awaited<ReturnType<typeof measurePlan>>,
): RenderMeasurements {
  return {
    beforeOrder: raw.beforeOrder,
    afterOrder: raw.afterOrder,
    hOverflowBeforePx: raw.hOverflowBeforePx,
    hOverflowAfterPx: raw.hOverflowAfterPx,
    movedCount: raw.movedCount,
    movedAboveMain: raw.movedAboveMain,
    mainAnchorFound: raw.mainAnchorFound,
    ctaChecked: raw.ctaChecked,
    ctaBroken: raw.ctaBroken,
    requestedMoves: raw.requestedMoves,
    appliedMoves: raw.appliedMoves,
    moveNoRise: raw.moveNoRise,
    moveUnsafe: raw.moveUnsafe,
    moveUnappliable: raw.moveUnappliable,
    reversedOrderMatches: raw.reversedOrderMatches,
    verticalOverlapIntroducedPx: raw.overlapIntroducedPx,
    lcpFound: raw.lcpFound,
    opsTouchingLcp: raw.opsTouchingLcp,
    insertRefusedByLcpGuard: raw.insertRefusedByLcpGuard,
    requestedInserts: raw.requestedInserts,
    appliedInserts: raw.appliedInserts,
    insertedAboveMain: raw.insertedAboveMain,
    insertedGapToHeroPx: raw.insertedGapToHeroPx,
    insertedVisible: raw.insertedVisible,
    insertedRemoved: raw.insertedRemoved,
    lcpShiftPx: raw.lcpShiftPx ?? undefined,
    movedShiftPx: raw.movedShiftPx,
  };
}

export interface GatedAttempt {
  attempt: number;
  measurements: RenderMeasurements;
  gate: ReturnType<typeof evaluateRenderGates>;
}

/** Retryns lyft-mål: unika move_up-lokatorer i planordning. EXPORTERAD för att
 *  serve-vägen ska kunna räkna EXAKT samma antal lyft (src/adaptive/redesign/
 *  extra-lift.ts) — divergerar de två räkningarna servas en annan layout än
 *  den som grindades (granskningsfynd 2026-08-08). */
export function extraLiftFinds(ops: MeasureOp[]): string[] {
  return [...new Set(ops.filter((o) => o.op === "move_up").map((o) => o.find))];
}

/** Den delade grind-loopen: mät → grinda → vid vertikal kollision EN retry
 *  med ett extra lyft per UNIKT flyttmål (prototyp-opens tag följer med).
 *  Fail-closed: oupplösbart mål ⇒ unresolvable, inga försök rapporteras som
 *  grindade. attemptOps är exakt de ops som det SISTA försöket körde — samma
 *  lista ska användas för keepApplied-återappliceringen (efter-skärmdumpen)
 *  och för serve_ops-räkningen. */
export async function runGatedAttempts(
  page: Page,
  ops: MeasureOp[],
  ctaTexts: string[],
  opts: { ctaSelectors?: string[]; onAttempt?: (a: GatedAttempt) => void } = {},
): Promise<{
  attempts: GatedAttempt[];
  attemptOps: MeasureOp[];
  unresolvable: boolean;
  extraLiftApplied: boolean;
}> {
  const extraLiftOps: MeasureOp[] = extraLiftFinds(ops).map((find) => {
    const proto = ops.find((o) => o.op === "move_up" && o.find === find)!;
    return { op: "move_up", tag: proto.tag, find };
  });
  const attempts: GatedAttempt[] = [];
  let attemptOps = ops;
  let extraLiftApplied = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await measurePlan(page, attemptOps, ctaTexts, false, opts.ctaSelectors ?? []);
    if (!raw.resolvedAll) {
      return { attempts, attemptOps, unresolvable: true, extraLiftApplied };
    }
    const measurements = toRenderMeasurements(raw);
    const gate = evaluateRenderGates(measurements);
    const entry = { attempt, measurements, gate };
    attempts.push(entry);
    opts.onAttempt?.(entry);
    const collision =
      gate.verdict === "fail" && gate.reasons.some((r) => /vertical overlap/.test(r));
    if (collision && attempt === 1 && extraLiftOps.length > 0) {
      attemptOps = [...ops, ...extraLiftOps];
      extraLiftApplied = true;
      continue;
    }
    break;
  }
  return { attempts, attemptOps, unresolvable: false, extraLiftApplied };
}
