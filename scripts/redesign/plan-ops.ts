// Plan → ops: de RENA mapparna mellan designplanens språk (RedesignOp) och det
// harnessen mäter (MeasureOp) respektive det snippeten servar (ServeOp).
//
// VARFÖR EN EGEN MODUL (städsvepet 2026-08-14): de fem kodar fail-closed-regler
// som är precis den sorts logik som ska gå att testa billigt — ett drag vars
// lokator inte kan lösas får ALDRIG serveras halvt, condense/reveal har ingen
// serve-form i v1, och bevis-lyftets reserv måste bära en siffra. De låg mitt i
// auto-generate.ts, vars modulkropp läser plans.json och startar Chromium redan
// vid import: enda sättet att röra dem var att spawna en riktig webbläsare, och
// det testet skippar helt på en maskin som saknar den. Flytten är ordagrann
// (samma funktioner, samma ordning, samma kommentarer) och följer repots egen
// konvention — se scripts/loop/cell-plan.ts, extraherad av samma skäl.

import { tidySignalText } from "../../src/adaptive/redesign/candidates";

import type { RedesignContentModel } from "../../src/adaptive/redesign/context";
import type { RedesignOp } from "../../src/adaptive/redesign/generate";
import type { ServeOp } from "../../src/adaptive/redesign/serve";
import type { MeasureOp } from "./measure";

/** Sektions-id → DOM-lokator för serve_ops, per sidas innehållsmodell.
 *  Hjälte-sektionen bor i h1, allt annat i h2 — samma struktur extract.ts
 *  läste ur sidan. */
export function locatorFor(
  content: RedesignContentModel,
  targetId: string,
): ServeOp["locator"] | null {
  const sec = content.sections.find((s) => s.id === targetId);
  if (!sec?.heading) return null;
  return { tag: sec.type === "hero" ? "h1" : "h2", text: sec.heading };
}

/** Hjältens h1-lokator — insert_snippet-opens ankare. "hero" är ett syntetiskt
 *  targetId (ingen sektionsrad), så locatorFor kan inte slå upp det. */
export function heroLocatorFor(content: RedesignContentModel): ServeOp["locator"] | null {
  const heroSec = content.sections.find((s) => s.type === "hero");
  const text = heroSec?.heading || content.hero?.headline;
  return text ? { tag: "h1", text } : null;
}

/** Sektions-id → mät-ops (delas av huvudplanen och fallback-steget). Null när
 *  någon lokator saknas — fail closed, samma regel som toServeOps. */
export function toMeasureOps(
  content: RedesignContentModel,
  ops: RedesignOp[],
  styleDonor: string | null,
): MeasureOp[] | null {
  const out: MeasureOp[] = [];
  for (const o of ops) {
    const loc =
      o.op === "insert_snippet" ? heroLocatorFor(content) : locatorFor(content, o.targetId);
    if (!loc) return null;
    if (o.op === "move_up") {
      out.push({ op: "move_up", tag: loc.tag, find: loc.text });
    } else if (o.op === "insert_snippet") {
      out.push({
        op: "insert_snippet",
        tag: loc.tag,
        find: loc.text,
        set: o.detail,
        ...(o.sourcePath ? { href: o.sourcePath } : {}),
        ...(styleDonor ? { styleClass: styleDonor } : {}),
        ...(o.placement ? { placement: o.placement } : {}),
      });
    } else if (o.op === "set_text") {
      out.push({ op: "set_text", tag: loc.tag, find: loc.text, set: o.detail });
    } else {
      // condense/reveal serveras inte i v1 (toServeOps vägrar dem) — då får
      // de inte heller MÄTAS som något annat (granskningsfynd 2026-07-28:
      // de föll igenom till set_text, klarade grindarna och dog först som
      // no_serve_ops utan orsak). En enda semantik: omätbart ⇒ null.
      return null;
    }
  }
  return out;
}

/** Fallback-steget (ägarbeslut 2026-07-27: tratten ska LEVERERA — men aldrig
 *  genom en trasig sida): när flytt-planen fälls i grinden provas ett
 *  bevis-lyft i stället. Texten är ORDAGRANN sidtext — extract.ts garanterar
 *  att varje trust-signal är en äkta substräng ur sidan, och rubriker kommer
 *  ur markupen; vi hittar aldrig på. insert_snippet är LCP-säker by
 *  construction (omankrar under LCP-elementet, vägrar ovanför) — det är
 *  därför den kan lyckas där flytten inte fick plats. Ingen sourcePath:
 *  texten kommer från samma sida, så raden renderas som ren text utan länk. */
export function proofInsertFallback(
  content: RedesignContentModel,
  ops: RedesignOp[],
): RedesignOp[] | null {
  const firstMove = ops.find((o) => o.op === "move_up");
  if (!firstMove) return null;
  if (ops.some((o) => o.op === "insert_snippet")) return null; // max EN insert per plan
  // Textvalet: målsektionens EGEN rubrik först — den kommer ren ur markupen
  // och är exakt den sektion designern pekade på. Trust-signalerna är
  // sid-globala regex-fångster ur platt text och kan dra med sig UI-brus
  // (talentium-fixturen: "0:30 Product overview Play video" följde med) —
  // de är reserven, inte förstahandsvalet.
  //
  // SUBSTANSKRAVET (ägarfynd fikajobs 2026-07-28): rubriken måste SJÄLV bära
  // bevis (minst en siffra — "4,9/5", "12 000+ kunder"). "People love Fika.
  // Here's what they say." är en LOVNAD om innehåll — lyft ensam blev en tom
  // rad som lovar testimonials som inte följer med. Hellre hållen variant
  // (rapporten levereras ändå) än en rad som skadar sidan.
  const sec = content.sections.find((s) => s.id === firstMove.targetId);
  const headingOk = !!sec?.heading && /\d/.test(sec.heading);
  // tidySignalText: samma städning som katalogens meny (UI-brus, Framers
  // SSR-dubbletter) — raden ägaren ser ska vara ren sidtext, inte skarvskräp.
  const signal = ["trusted_by", "social_proof_count", "guarantee"]
    .map((t) => {
      const raw = content.trustSignals.find((s) => s.type === t)?.text;
      return raw ? tidySignalText(raw) : undefined;
    })
    .find((t) => !!t && t.trim().length >= 8);
  const text = ((headingOk ? sec!.heading : null) ?? signal ?? "").trim();
  if (!text) return null;
  return [
    {
      op: "insert_snippet",
      targetId: "hero",
      detail: text,
      why:
        "The move didn't fit without disturbing the hero block — instead the page's own proof is surfaced verbatim as a line directly below the hero heading. " +
        (firstMove.why || ""),
    },
    ...ops.filter((o) => o.op !== "move_up"),
  ];
}

export function toServeOps(
  content: RedesignContentModel,
  ops: RedesignOp[],
  // Klickväg + stil-donator (ägarbeslut 2026-07-18 alt. D): citatet länkar
  // till sin källsida och klär sig i landningssidans egen mest använda
  // länkklass — sajtens stilmall bestämmer utseendet, aldrig vår.
  styleDonor: string | null = null,
): ServeOp[] | null {
  const out: ServeOp[] = [];
  for (const o of ops) {
    if (o.op === "insert_snippet") {
      const locator = heroLocatorFor(content);
      if (!locator) return null;
      out.push({
        op: "insert_snippet",
        locator,
        value: o.detail,
        ...(o.sourcePath ? { href: o.sourcePath } : {}),
        ...(styleDonor ? { styleClass: styleDonor } : {}),
        // Placerings-stegen (2026-07-27): den verifierade insättningspunkten
        // följer med till serve_ops — klienten applicerar EXAKT det grindade.
        ...(o.placement ? { placement: o.placement } : {}),
        why: o.why,
      });
      continue;
    }
    const locator = locatorFor(content, o.targetId);
    if (!locator) return null;
    if (o.op === "move_up") out.push({ op: "move_up", locator, why: o.why });
    else if (o.op === "set_text")
      out.push({ op: "set_text", locator, value: o.detail, why: o.why });
    else return null; // condense/reveal serveras inte i v1 — fail closed
  }
  return out;
}
