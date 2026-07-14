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
//   6. same-page anchors (tabs/TOC) with no keyword evidence are in-page
//      NAVIGATION — the position fallback must never promote them (a booking
//      service page's "Bilder"/"Betyg"/"Om" tab strip is above-fold primary
//      chrome, not conversion; verbs still win, so <a href="#bokning">Boka</a>
//      classifies as the conversion it is);
//   7. position fallback: an above-fold primary with no keyword evidence is
//      most likely a conversion.
//
// Vocabulary provenance: corpus/vocab-harvest-2026-07-06.json (107-site
// harvest); inclusion bar >= 2 independent sites. Two deliberate deltas
// (2026-07-14): \btry\b added — mining missed it because harvest catches
// "Try X free" buttons via the position fallback (rule 7), but string-context
// callers (redesign extract.ts) have no category and need the word; Swedish
// "prova" was already in the list, the English twin plainly belongs. And
// bare `book` tightened to \bbook\b — "Employee handbook", "Books we wrote"
// and aria-labels like "Share on Facebook" are not bookings ("Book a demo"
// still matches; Swedish "boka" is its own entry).
export function classifyIntentShared(
  text: string,
  href: string,
  attrText: string,
  category: string,
  isFormSubmit: boolean,
  aboveFold: boolean,
  formKind?: "" | "search" | "newsletter",
  samePageAnchor?: boolean,
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

  // A submit is the form's whole point — but WHAT it converts depends on the
  // form (A2): a search submit is utility, an email-only newsletter submit is
  // engagement (the subscribe wordlist's home), everything else conversion.
  // Callers derive formKind with formKindShared().
  if (isFormSubmit) {
    if (formKind === "search") return "utility";
    if (formKind === "newsletter") return "engagement";
    return "conversion";
  }
  if (
    /(facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pinterest|snapchat|reddit|threads|mastodon)\./i.test(
      h,
    )
  ) {
    return "social";
  }
  if (
    /(\bbook\b|buy|demo|start|get started|sign[- ]?up|signup|register|subscribe|request|trial|\btry\b|checkout|order|apply|donate|download|add to cart|beställ|köp|boka|prova|kom igång|skapa konto|registrera|gå med|gratis|ladda ne[dr]|lägg i (varu|kund)?korg(en)?|lägg till|ansök|bidra|donera|teckna|jämför|shoppa|månadsgivare)/i.test(
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
  // Same-page anchor with NO keyword evidence (nothing above matched): an
  // in-page tab/TOC link — navigation, and deliberately BEFORE the position
  // fallback so an above-fold tab strip ("Bilder"/"Betyg"/"Om") can't be
  // promoted to conversion by placement alone. Callers compute the flag from
  // the DOM: an <a> whose href resolves to location's origin+path+search with
  // a fragment.
  if (samePageAnchor) return "navigation";
  // Position-based fallback: above-fold primary CTA without keyword match →
  // likely conversion.
  if (category === "cta_primary" && aboveFold) return "conversion";
  return "unknown";
}

/** Same-page anchor (tab/TOC): href resolves to THIS page + a fragment. Feeds
 *  rule 6 in classifyIntentShared — tabs must never be position-fallbacked to
 *  conversion. The comparison base is the page's DECLARED URL (canonical/
 *  og:url) with location as fallback: in MHTML replay location is a file://
 *  URL while the capture's anchors are absolute https self-URLs — without the
 *  declared base the rule never flips in replay and live/replay diverge.
 *  Page-safe contract: touches only its args + document/location, never throws. */
export function samePageAnchorShared(el: Element, href: string): boolean {
  if (el.tagName !== "A" || !href) return false;
  try {
    let pageUrl = new URL(location.href);
    const canon = document.querySelector('link[rel="canonical"]');
    const og = document.querySelector('meta[property="og:url"]');
    const declared =
      (canon && canon.getAttribute("href")) || (og && og.getAttribute("content")) || "";
    if (declared && /^https?:/i.test(declared)) pageUrl = new URL(declared);
    const u = new URL(href, pageUrl.href);
    return (
      !!u.hash &&
      u.origin === pageUrl.origin &&
      u.pathname === pageUrl.pathname &&
      u.search === pageUrl.search
    );
  } catch (e) {
    return false; // trasig href -> ingen flagga
  }
}

/** What kind of form does this (submit) element belong to? Same page-safe
 *  contract as isVisible: touches only its argument + DOM. Drives the A2
 *  rule in classifyIntentShared — search submits are not conversions, and an
 *  email-only field means a newsletter capture, not the site's money action. */
export function formKindShared(el: Element): "" | "search" | "newsletter" {
  try {
    const f = el.closest ? el.closest("form") : null;
    if (!f) return "";
    const role = (f.getAttribute("role") || "").toLowerCase();
    const action = f.getAttribute("action") || "";
    if (role === "search" || f.querySelector('input[type="search"]') || /(^|[/?#-])s(earch|ok)([/?#-]|$)/i.test(action)) {
      return "search";
    }
    const inputs = f.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])',
    );
    if (inputs.length === 1) {
      const i0 = inputs[0];
      const hint = (
        (i0.getAttribute("type") || "") + " " +
        (i0.getAttribute("name") || "") + " " +
        (i0.getAttribute("placeholder") || "") + " " +
        (i0.getAttribute("aria-label") || "")
      ).toLowerCase();
      if (/email|e-?post|nyhetsbrev|newsletter/.test(hint)) return "newsletter";
    }
  } catch (e) {
    /* classification must never break the page */
  }
  return "";
}
