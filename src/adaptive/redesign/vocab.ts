// Delad sektions- + trust-vokabulär (task #90, återanvändnings-auditens
// NOW-punkt 3). Redesign-kedjans extract.ts var engelsk-bara — samma klass av
// lucka som CTA-fyndet: svenska sajter fick "section" på allt och noll
// trust-signaler, så briefer och flytt-förslag blev blinda på svenska.
//
// Kärnan här är VOKABULÄREN (nyckelord per sektionstyp + trust-fraser),
// EN+SV. Varje konsument behåller sin harness: extract.ts klassificerar
// rubriker och skannar platt HTML-text; granska-site.ts pekar ut bevis-
// sektioner via samma typlista. Webbläsar-harvesterns trust-skript
// (src/lib/tests/scripts/trustSignals.ts) är den AVSIKTLIGA dubbletten —
// ett självbärande page.evaluate-skript utan imports, rikare (stjärnkluster,
// widgets, schema.org) och redan EN+SV; harvest-bundlens kodgen-pinne låser
// det. Utöka båda när vokabulären växer.

/** Sektionstyps-vokabulären i MATCHNINGSORDNING — första träff vinner, så
 *  specifika typer (pricing/testimonials) står före breda (features). Samma
 *  typsträngar som extract.ts sektions-id:n (sec-N-typ) och granska-sitens
 *  bevislista. EN + SV per typ. */
export const SECTION_TYPE_PATTERNS: readonly { type: string; re: RegExp }[] = [
  {
    type: "pricing",
    re: /(pricing|plans?|\/mo|per month|traffic based|growth|priser|prisplan|kostnad|per m[åa]nad|\/m[åa]n)/,
  },
  {
    type: "testimonials",
    re: /(love|❤|people|testimonial|review|say about|customers think|omd[öo]m|recension|kundr[öo]st|kundcitat|kunder (s[äa]ger|tycker|ber[äa]ttar)|medlemmar|betyg|referens)/,
  },
  {
    type: "logos",
    re: /(trusted|companies|logos|as seen|featured in|anv[äa]nds av|f[öo]retag som|som setts i|i pressen)/,
  },
  {
    type: "features",
    re: /(why|benefit|feature|how it works|what you get|simple|lightweight|no need|d[äa]rf[öo]r|varf[öo]r|f[öo]rdelar|s[åa] fungerar|funktioner|det h[äa]r f[åa]r du|enkelt)/,
  },
  {
    type: "comparison",
    re: /(compare|vs\b|ditch|switch|alternative|migrate|j[äa]mf[öo]r|byt fr[åa]n|alternativ till)/,
  },
  {
    type: "cta",
    re: /(ready|start|try|get started|sign up|free trial|today|kom ig[åa]ng|prova|testa|skapa konto|b[öo]rja|idag)/,
  },
  { type: "faq", re: /(faq|question|frequently|vanliga fr[åa]gor|fr[åa]gor och svar)/ },
  {
    type: "footer",
    re: /(follow|footer|©|copyright|all rights|f[öo]lj oss|alla r[äa]ttigheter)/,
  },
];

/** Klassificera en sektionsrubrik → typ. Delad av extract.ts (sektionsmodellen)
 *  och granska-site.ts (bevis-sektionen). Rubriken utan träff är ärligt
 *  "section" — hellre otypad än felgissad. */
export function classifySectionHeading(heading: string, isFirst: boolean): string {
  if (isFirst) return "hero";
  const h = heading.toLowerCase();
  for (const p of SECTION_TYPE_PATTERNS) if (p.re.test(h)) return p.type;
  return "section";
}

/** Sektionstyper som bär BEVIS (socialt bevis/jämförelse/priser/FAQ) — det
 *  granska-sitens flytt-test lyfter och designern prioriterar. */
export const EVIDENCE_SECTION_TYPES: readonly string[] = [
  "testimonials",
  "logos",
  "comparison",
  "pricing",
  "faq",
];

/** Substantiv som gör en siffra till socialt bevis ("12 000 kunder"), EN+SV —
 *  samma ordlista som webbläsar-harvesterns social_proof_count. Exporteras som
 *  regex-KÄLLA så konsumenter bygger sina egna fångstgrupper runt den. */
export const SOCIAL_PROOF_NOUNS_SRC =
  "customers|companies|users|subscribers|businesses|sites|websites|members|downloads|reviews|kunder|anv[äa]ndare|medlemmar|f[öo]retag|prenumeranter|nedladdningar|recensioner";

/** "Trusted by …"-inledningar, EN+SV. Regex-källa, samma skäl som ovan. */
export const TRUSTED_BY_LEADINS_SRC =
  "trusted by|used by|loved by|joined by|anv[äa]nds av|[äa]lskas av|valt av|f[öo]rtrodda av";
