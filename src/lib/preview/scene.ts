// Scenens grindbeslut på /try (ägarfynd 2026-08-31, "ens egna hemsida ska
// poppa upp helt, och att man ska kunna skrolla fast med vår uppfinning i
// det"): REN mappning av probe-lägen + verdict → vad sidan visar. before-
// kopian bär scenen — uppslukande även för HÅLLNA jobb; after-kopian styr
// växlaren; verdictet styr default-armen och den ärliga märkningen. Hållna
// förslag öppnar på Original (sidan som publicerad) och varianten heter
// "Proposed" — aldrig något som låter serverat.

export type ProbeState = "pending" | "ok" | "missing";

export interface SceneMode {
  /** "wait" = probes pågår (vyn hålls tillbaka — inga blixtar); "classic" =
   *  ingen before-kopia (äldre jobb) ⇒ kortvyn; "scene" = uppslukande. */
  show: "wait" | "classic" | "scene";
  /** after-kopian finns ⇒ Original/Variant|Proposed-växlaren visas. */
  canFlip: boolean;
  /** Verifierat förslag öppnar på varianten (grindarna godkände exakt den);
   *  allt annat öppnar på sidan som publicerad. */
  defaultArm: "before" | "after";
}

export function sceneMode(before: ProbeState, after: ProbeState, verified: boolean): SceneMode {
  if (before === "pending" || after === "pending") {
    return { show: "wait", canFlip: false, defaultArm: "before" };
  }
  if (before !== "ok") return { show: "classic", canFlip: false, defaultArm: "before" };
  const canFlip = after === "ok";
  return { show: "scene", canFlip, defaultArm: verified && canFlip ? "after" : "before" };
}
