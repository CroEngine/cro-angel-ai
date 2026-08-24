// Den enda hållbara install-taggen för en sajt — delad mellan dashboarden
// (Settings) och /welcome (onboardingen), så de två aldrig kan glida isär.
// Ren funktion: origin skickas in av anroparen (window.location.origin på
// klienten) i stället för att läsas här, så byggaren går att testa utan DOM.

/** Deploy-preview-origins skalas bort så en dashboard/welcome öppnad på en
 *  preview aldrig delar ut en efemär URL i taggen. */
export function normalizeSnippetOrigin(origin: string): string {
  return origin.replace(/^https:\/\/deploy-preview-\d+--/, "https://");
}

export function buildSnippet(site: string, ingestKey: string | null, origin: string): string {
  const clean = normalizeSnippetOrigin(origin);
  const keyAttr = ingestKey ? ` data-key="${ingestKey}"` : "";
  return `<script async src="${clean}/adaptive.js" data-site="${site}"${keyAttr}></script>`;
}
