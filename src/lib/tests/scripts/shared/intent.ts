// THE shared CTA-intent classifier — single source of truth for both
// in-browser audit scripts (B1 in docs/contradictions-audit.md).
//
// History: CTAS_SCRIPT and COLLECT_SCRIPT each carried their own copy of the
// intent wordlists and rule order. The copies drifted (different Swedish
// terms, a form-submit rule in one but not the other, a regex typo that never
// matched "lägg i varukorgen") — so the same button could be a conversion CTA
// in one half of the findings report and not in the other. This function is
// inlined into BOTH scripts via `${classifyIntentShared.toString()}` (the
// same pattern collect.ts already uses for isVisible), so the lists cannot
// drift again — and it is imported directly by unit tests.
//
// Contract: PURE and self-contained — no imports, no closures, no DOM access.
// Callers pre-compute everything DOM-derived (attr text, category, fold).
//
// Rule order (deliberate, golden-affecting — change with care):
//   1. form submits are conversions (a submit is the form's whole point);
//   2. social-host links stay social no matter the label ("Subscribe" on a
//      YouTube link is not a site conversion);
//   3. conversion keywords — BEFORE the tel:/mailto: check, so "Ring och
//      boka" reads as the conversion it is (A1);
//   4. contact actions (tel:/mailto:/contact wording) are their own intent —
//      NOT 'utility': for lead-gen businesses contact IS the goal, and the
//      goal system already treats it that way (A1);
//   5. the remaining wordlists in the order collect.ts always used;
//   6. position fallback: an above-fold primary with no keyword evidence is
//      most likely a conversion.
//
// Vocabulary provenance: corpus/vocab-harvest-2026-07-06.json (107-site
// harvest); inclusion bar >= 2 independent sites.
export function classifyIntentShared(
  text: string,
  href: string,
  attrText: string,
  category: string,
  isFormSubmit: boolean,
  aboveFold: boolean,
):
  | "conversion"
  | "contact"
  | "engagement"
  | "navigation"
  | "social"
  | "utility"
  | "information"
  | "unknown" {
  const t = (text || "").trim();
  const probe = t + " " + (attrText || "");
  const h = href || "";

  if (isFormSubmit) return "conversion";
  if (
    /(facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pinterest|snapchat|reddit|threads|mastodon)\./i.test(
      h,
    )
  ) {
    return "social";
  }
  if (
    /(book|buy|demo|start|get started|sign[- ]?up|signup|register|subscribe|request|trial|checkout|order|apply|donate|download|add to cart|beställ|köp|boka|prova|kom igång|skapa konto|registrera|gå med|gratis|ladda ne[dr]|lägg i (varu|kund)?korg(en)?|lägg till|ansök|bidra|donera|teckna|jämför|shoppa|månadsgivare)/i.test(
      probe,
    )
  ) {
    return "conversion";
  }
  if (/^(tel:|mailto:)/i.test(h) || /(contact|kontakt)/i.test(probe)) return "contact";
  if (
    /(like|love|save|bookmark|share|comment|reply|follow|subscribe|upvote|downvote|gilla|spara|kommentar|svara|följ|prenumerera|rösta|röst)/i.test(
      probe,
    )
  ) {
    return "engagement";
  }
  if (
    /(login|log in|sign in|account|menu|home|profile|settings|logga in|mina sidor|hem|inställningar)/i.test(
      probe,
    )
  ) {
    return "navigation";
  }
  if (/(facebook|instagram|linkedin|twitter|youtube|tiktok|share|dela)/i.test(probe)) {
    return "social";
  }
  if (/(search|sök|language|språk|cookie|accept|godkänn|help|hjälp|faq)/i.test(probe)) {
    return "utility";
  }
  if (/(learn|read|explore|see how|how |why |about |läs|utforska|så funkar|mer info)/i.test(probe)) {
    return "information";
  }
  // Position-based fallback: above-fold primary CTA without keyword match →
  // likely conversion.
  if (category === "cta_primary" && aboveFold) return "conversion";
  return "unknown";
}
