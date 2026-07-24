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
    // Åtstramad (precisionsfynd 2026-07-24): "growth"/"traffic based" typade
    // "Driving business growth" som pricing → fel lyftmål. Riktiga prisblock
    // fångas av pricing/plans/-per-månad-rubriker + den strukturella grinden
    // (>=2 prispunkter i kroppen).
    re: /(pricing|\bplans?\b|\/mo|per month|priser|prisplan|kostnad|per m[åa]nad|\/m[åa]n)/,
  },
  {
    type: "testimonials",
    // Åtstramad (precisionsfynd 2026-07-24): bara "love"/"people"/"review" som
    // SUBSTRÄNGAR typade "People" (Slack), "global people platform" (Deel),
    // "code review" som testimonials → fel lyftmål + falsk [proof]. Kräver nu
    // testimonial-KONTEXT.
    //
    // ÅTER-VIDGAD (LLM-revision 2026-07-24, ägaren: "Why millions love HelloFresh
    // är kopplad till scroll-karusellen under — det ÄR testimonials"): åtstram-
    // ningen tog också bort ÄKTA social-proof-ramade rubriker. En 210-sajts
    // korpusmätning (scripts/capture-eval/typing-audit.ts) bekräftade fyra SÄKRA
    // familjer — noll falska positiva över 1902 sektioner, och ingen av dem
    // återinför de 34 korrekt borttagna slogans ("products you love" saknar "us"/
    // siffra/"why"): "X love us" (brilliant), "N/millions (of …) love|choose|trust"
    // (hellofresh/mailchimp/slack), "why … (people|millions|…) choose|love|trust"
    // (coursera/calcom), "stories of people|customers" (wise). Bild-renderade
    // karuseller (hellofresh) når INGEN kroppsdetektor — rubriken är enda signalen.
    re: /(❤|loved by|(?:customers?|users?|people|teams?|clients?|they) (?:love|rave)|\blove us\b|(?:millions?|thousands?|hundreds?|\d[\d,. ]*\+?) (?:of (?:people|users|customers|companies|businesses|creators) )?(?:love|choose|trust|rely on)\b|why (?:\w+ ){0,4}(?:people|customers|users|teams|students|learners|businesses|developers|creators|millions|thousands) (?:choose|love|trust|switch|pick)|stories of (?:people|customers|our)|testimonials?|don'?t (?:just )?take our word|what (?:our )?(?:customers|users|people|clients|teams) (?:say|think)|say about (?:us|our)|customers think|\breviews\b|omd[öo]men?|recensioner?|kundr[öo]st(?:er)?|kundcitat|kunder (?:s[äa]ger|tycker|ber[äa]ttar)|betyg|referenser?)/,
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
  // Normalisera TYPOGRAFISKA citattecken → raka (LLM-revision 2026-07-24):
  // calcoms "Don't just take our word for it" (rubrik ÖVER en testimonial-vägg)
  // typades "section" för att källan bär ett LITTERAT krullat ' (U+2019), inte
  // &rsquo; — stripTags avkodar entiteter men rör aldrig litterala UTF-8-tecken,
  // så vokabulärens raka `don'?t` missade. Träffar även faq/övriga apostrof-mönster.
  const h = heading
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"');
  for (const p of SECTION_TYPE_PATTERNS) if (p.re.test(h)) return p.type;
  return "section";
}

/** Sektionstyper som bär BEVIS (socialt bevis/jämförelse/priser/FAQ) — det
 *  granska-sitens flytt-test lyfter och designern prioriterar. */
export const EVIDENCE_SECTION_TYPES: readonly string[] = [
  "testimonials",
  "logos",
  "stats",
  "comparison",
  "pricing",
  "faq",
];

/** Substantiv som gör en siffra till socialt bevis ("12 000 kunder"), EN+SV —
 *  samma ordlista som webbläsar-harvesterns social_proof_count. Exporteras som
 *  regex-KÄLLA så konsumenter bygger sina egna fångstgrupper runt den. */
export const SOCIAL_PROOF_NOUNS_SRC =
  "customers|companies|users|subscribers|businesses|teams|brands|organi[sz]ations|developers|sites|websites|members|downloads|reviews|kunder|anv[äa]ndare|medlemmar|f[öo]retag|team|varum[äa]rken|utvecklare|prenumeranter|nedladdningar|recensioner";

/** "Trusted by …"-inledningar, EN+SV. Regex-källa, samma skäl som ovan. */
export const TRUSTED_BY_LEADINS_SRC =
  "trusted by|used by|loved by|joined by|anv[äa]nds av|[äa]lskas av|valt av|f[öo]rtrodda av";
