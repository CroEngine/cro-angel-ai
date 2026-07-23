// Vilka viewportar måste GRINDA en variant innan den får serva? (gap-audit
// Tier-1 #3 — "mobile validated only at desktop" i labbet; efter ADR-001 var
// läget inverterat: kundkedjan verifierade ENBART mobil 390×844 medan grova
// segment servar båda enheterna. En variant som servas till en enhet vars
// layout aldrig grindats är overifierad för den trafiken.)
//
// Regeln följer serverns egen segmentering (serve.ts matchar segmentKey-prefix;
// dimension 2 är device ur classifyDevice: mobile/tablet/desktop):
//   - segment pinnat till mobile  ⇒ grinda mobil (390×844 — repostandarden)
//   - segment pinnat till desktop ⇒ grinda desktop (1280×900 — samma standard
//     som structure-eval/snapshot-replayen)
//   - tablet, okänt eller GROVT segment (ingen device-dimension) ⇒ grinda BÅDA
//     ytterligheterna — tablet saknar egen standard och ett grovt segment
//     servar alla enheter.
// Första viewporten i listan är den KANONISKA (retry-stegen + ägar-skärmdumparna
// körs där); resten är bekräftelsepass som måste klara EXAKT samma ops.

import { segmentDims } from "../../lib/segment-key";

export interface GateViewport {
  width: number;
  height: number;
  /** Stabil etikett — används i evidens, skärmdumpsnamn och verdikter. */
  label: "mobile" | "desktop";
}

export const MOBILE_VIEWPORT: GateViewport = { width: 390, height: 844, label: "mobile" };
export const DESKTOP_VIEWPORT: GateViewport = { width: 1280, height: 900, label: "desktop" };

/** Viewportarna som måste grinda en variant för `segmentKey`, kanonisk först.
 *  Nyckeln kan vara ett PREFIX (grovt segment) — saknad device ⇒ båda. */
export function viewportsForSegmentKey(segmentKey: string): GateViewport[] {
  const device = segmentDims(segmentKey)[1] ?? null;
  if (device === "mobile") return [MOBILE_VIEWPORT];
  if (device === "desktop") return [DESKTOP_VIEWPORT];
  return [MOBILE_VIEWPORT, DESKTOP_VIEWPORT];
}
