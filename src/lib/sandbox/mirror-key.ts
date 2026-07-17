// Lagringsnyckeln för frysta spegel-backdroppar (angel-evidence-bucketen).
// REN och delad: nattloopen (uppladdaren) och createPagePreview (läsaren)
// måste härleda EXAKT samma nyckel ur en sidväg — annars hittas kopiorna
// aldrig. Samma teckenregel som nattloopens artefaktfilnamn (?fbclid-filnamn
// fällde uppladdningen i generalrepet 2026-07-17).

/** Sidväg → filnamnssäker nyckeldel; "/" ⇒ "home". Query/hash strippas. */
export function mirrorPathKey(path: string): string {
  const stripped = (path || "/").split("#")[0].split("?")[0];
  const safe = stripped
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe || "home";
}

/** Full lagringsnyckel i angel-evidence för sajtens frysta kopia av en sida. */
export function mirrorStorageKey(site: string, path: string): string {
  return `mirrors/${site}/${mirrorPathKey(path)}.html`;
}
