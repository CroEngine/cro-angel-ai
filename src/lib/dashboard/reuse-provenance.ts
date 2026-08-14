// Återbrukets proveniens i ägarens vy — EN sanning, delad av servern som
// läser evidence.reuse och kortet som skriver ut den.
//
// Varför en egen modul: etiketten är ett PÅSTÅENDE om vad som är bevisat, och
// blockbibliotekets två former bevisar olika saker. Textblocket bevisar den
// ordagranna raden ("den här texten vann"); flytt-vinnaren (transferformen
// steg 4) bevisar TYPKLASSEN ("att lyfta en sådan sektion vann") — sektionen
// som lyfts på den här sidan är målsidans egen och har aldrig testats. Skrevs
// etiketten inline i kortet kunde de två glida isär, och den enda som märkte
// det vore ägaren som läste ett bevis som inte finns.

export type ReuseKind = "text" | "move";

/** Vilken form av bevis bär evidence.reuse? null när varianten inte är
 *  återbruk alls. Rader födda FÖRE steg 4 saknar kind — de var alltid
 *  textblock, så frånvaro läses som "text". */
export function reusedKindOf(reuse: unknown): ReuseKind | null {
  if (!reuse || typeof reuse !== "object") return null;
  const r = reuse as { provedOnPath?: unknown; kind?: unknown };
  if (typeof r.provedOnPath !== "string" || r.provedOnPath.length === 0) return null;
  return r.kind === "move" ? "move" : "text";
}

/** Kortets etikett + tooltip. Bägge formerna säger RAKT UT att överföringen
 *  till den här sidan är obevisad tills cellens eget A/B körts — det är hela
 *  poängen med att visa proveniensen. */
export function reuseProvenanceLabel(
  kind: ReuseKind,
  provedOnPath: string,
): { label: string; title: string } {
  return kind === "move"
    ? {
        label: `reused move · won on ${provedOnPath}`,
        title: `Reused proven move: moving a section of this type up won its A/B test on ${provedOnPath}. The section moved here is this page's own — whether the move works on THIS page is unproven until this test runs.`,
      }
    : {
        label: `reused · won on ${provedOnPath}`,
        title: `Reused proven block: this exact text won its A/B test on ${provedOnPath}. Whether it works on THIS page is unproven until this test runs.`,
      };
}
