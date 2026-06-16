
# Normalisera-sedan-unifiera v2: input-equality som invariant

Tre revideringar mot v1, alla för att stänga seams där planen kunde landa "grön" och ändå vara fel:

1. **Invarianten är call-site-inputen, inte funktionen.** P och M måste iterera över *identiska* `(part, Content-Location, src-value, token)`-tripplar. Garanteras *by construction* via delad part-iterator + delad `@font-face`-scopad harvester — inte genom att två skilda kodvägar råkar anropa samma rena funktion.
2. **Differentialtest ersätter identitetstest som regressionsvakt.** Skyddet för de 2/40 fungerande familjerna är att nya extraktorn ger samma `https?://`-mängd som gamla `ANY_HTTP_URL_RE` på befintliga fixtures — inte `normalize(abs)===abs` på syntetisk sträng.
3. **P och M adopterar chokepointen atomärt (en commit).** Splittrad adoption skapar P>M-fönster som bara är grönt om man togglar en förväntan = fejk-grönt. Adoptionen av det unifierade universumet *är* en atomär sanning.

Determinismkrav, en-fix-per-logisk-ändring, regression mellan varje commit (`bun scripts/breadth-smoke.ts` på Vercel + Intercom + HubSpot), durabla receipts framför efemära loggar — oförändrat.

---

## Designkontrakt

Två delade primitiver, en enda källa till sanning för "URL som Chromium resolverar vid replay":

```ts
// Enda källan till MHTML → CSS-part-partitionering.
// Både P och M itererar HÄR, aldrig var för sig.
export function iterateCssParts(mhtml: string): Array<{
  css: string;
  contentLocation: string | undefined;
}>;

// @font-face-scopad. Tokeniserar ENDAST url() inom src-deskriptorer.
// Ren funktion: output är en deterministisk funktion av (css, contentLocation).
export function harvestFontUrls(
  css: string,
  contentLocation: string | undefined,
): NormalizedFontUrl[];

export type NormalizedFontUrl =
  | { kind: "embedded"; original: string }                                            // hink 1
  | { kind: "absolute"; original: string; resolved: string }                          // hink 2
  | { kind: "relative-resolved"; original: string; resolved: string; base: string }   // hink 3
  | { kind: "relative-unresolvable"; original: string; reason: "no-base" | "invalid-base" }; // hink 4
```

Invarianten P==M opererar över `hink2 ∪ hink3`, **dedupad på `resolved`** (mängd-, inte multiset-semantik — båda sidor bygger `Map<resolved, …>`). Hink 1 räknas separat. Hink 4 → receipt + assert.

**Scope-regel (kritisk):** harvestern parsar `@font-face`-block och extraherar endast deras `src`-deskriptorvärden. `url()` i `background-image`, `@import` etc. är *inte* fonter och får aldrig in i universumet. Skillnaden mot v1: där matades P hela part-CSS:en och M bara src-värdet → olika `css`-argument → P>M för evigt. Nu matas båda samma `css` (parten) och harvestern scopar internt.

**Tokeniserings-grammatik harvestern måste klara** (annars drift i hink 2):

- `url(x)`, `url("x")`, `url('x')`, `url(  x  )` (whitespace)
- komma-separerad multi-url: `src: url(a) format("woff2"), url(b) format("woff")` → två tokens
- `local("X")` → ignoreras (inte url())
- `format(...)` / `tech(...)` → argument strippas, ingår ej i token
- `url(data:font/woff2;base64,…==)` → hink 1 (quoterad form hanterar ev. parenteser)

**Resolution (hink 3):** `new URL(rel, contentLocation).href`. Rätt primitiv förutsatt basen är partens egen Content-Location (CSS resolverar mot stylesheetens bas, inte dokumentets — stämmer i MHTML-replay). Täcker `/x`, `x` / `../x`, `//host/x` (ärver schema från basen). Ogiltig/saknad bas → hink 4.

**Identitetsegenskap** (fortfarande sann, men *inte* huvudvakten): `harvestFontUrls` på ren absolut token ger `resolved === original`.

---

## Commit 1 — Delade primitiver + harvester (ren addition, inga konsumenter)

Ny fil `src/lib/tests/snapshot/harvest-font-urls.ts`: `iterateCssParts`, `harvestFontUrls`, typerna.

Testfil `__tests__/harvest-font-urls.test.ts`, minst:

- **Differentialtest (huvudvakten).** På befintliga fixtures (HubSpot + Vercels 2 absoluta): för varje URL gamla `ANY_HTTP_URL_RE` fångade måste nya harvestern klassa den som hink 2 med oförändrad `resolved`. Formellt: `oldRegexSet ⊆ newHink2Set` OCH `newHink2Set ∩ {^https?://} === oldRegexSet`. Ingen `https?://`-URL får försvinna eller muteras. (Nya hink 2 *får* innehålla fler — protokoll-relativa — det är de tidigare tysta droppen.)
- Protokoll-relativ: `//cdn/x` + https-bas → hink 2, `resolved === "https://cdn/x"`.
- Relativ + bas → hink 3 med korrekt `resolved` för `/x`, `x`, `../x`.
- Relativ utan/ogiltig bas → hink 4 med rätt `reason`.
- `data:` / `cid:` → hink 1.
- Grammatik: `local()` ignoreras; multi-url ger N tokens; `format()`-arg exkluderas; `url(data:…==)` ger hink 1, inte trasig token.

Ingen annan kod ändras. Grön.

---

## Commit 2 — P och M adopterar chokepointen **atomärt** + rename + hink 4

*En* logisk ändring: "orakel och fetcher adopterar det unifierade universumet." P-only eller M-only är inte koherent halva utan känt-trasigt mellanläge — splittringen tvingar fram fejk-grönt P>M-fönster. Därför tillsammans, trots normal en-fix-granularitet.

**P — `extractFontFaceDiagnostics` (`mhtml-fonts.server.ts:490`):**

- Iterera via `iterateCssParts`; per part anropa `harvestFontUrls(css, contentLocation)`.
- **Verifiera gammalt scope först:** om gamla P scannade hela CSS:en (inte bara src) kommer differentialtestet visa *minskning* (background-image-URLer försvinner). Avsiktlig korrekthetsförbättring — dokumentera i commit-meddelandet, inte tysta.
- **Rename, inte semantikbyte:** `absoluteUrls` → `replayUrls` (hink 2 ∪ 3, dedupad på `resolved`). Lägg `embeddedUrls` (hink 1), `unresolvableUrls` (hink 4 med reason). `hasOnlyRelativeUrl` → `hasUnresolvableRelativeUrl` (hink 4 > 0).
- Uppdatera konsumenterna i samma commit: `cid-probe.ts`, `fetch-records.test.ts`, `extract-families.test.ts`, samt `breadth-smoke.ts`-fältet `b1UniqueAbsUrls` → `b1ReplayUrls`.

**M — `embedMhtmlFonts` (`mhtml-fonts.server.ts:621 ff`):**

- Iterera via **samma** `iterateCssParts`; ersätt `ANY_HTTP_URL_RE.matchAll(srcValue)` med `harvestFontUrls(css, contentLocation)`.
- `urlToCid` byggs från hink 2 ∪ hink 3, **nyckel = `resolved`**.
- Hink 1 hoppas över (redan embedded).
- CSS-rewrite slår upp på `resolved`, inte originaltoken: map `originalToken → resolved → cid`.
- **Hink 4:** skriv till receipt-fältet `unresolvableRelativeUrls` i `finally` **före** throw (samma idiom som completeness-throw rad 712). Asserten fäller *sajtens* test — aborterar inte korpus-globalt. Frys-artefakten lämnas inspekterbar så 15–30-sajtsmålet inte blockeras av en enda trasig part.

Eftersom båda sidor delar `iterateCssParts` **och** `harvestFontUrls` håller input-equality by construction: Vercels 38/40 börjar räknas i P i exakt samma commit som de embeddas i M. Invarianten går aldrig röd transient.

Smoke: **P==M på alla tre sajter** efter commit, Vercels relativa familjer med `cid:`-rewrites och `gate1.pass: true`.

---

## Commit 3 — Input-equality som stående invariant + diff-keying (test-only)

Durabel vakt mot framtida drift (någon ändrar ett anropsställe):

- Ny test per fixture-sajt: P:s och M:s **trippel-mängd** — `(contentLocation, srcValue, token)` *före* klassificering — är identisk. Fångar divergens som post-klassificerings-räknarna kan missa.
- `harmonization-diff.json`-matchningen nycklas på `resolved` (mängd-likhet, ordningsoberoende) — inte list-likhet, inte originaltoken.

Omöjligt för ett ensidigt anropsställe-byte att passera grönt.

---

## Commit 4 — Receipt-observability (städ, ej logik)

I receipt-skrivaren (`harness.server.ts` / `freeze-site.ts`):

- `fontUrls.embedded` (hink 1 count)
- `fontUrls.absolute` (hink 2 count)
- `fontUrls.relativeResolved` (hink 3 count)
- `fontUrls.unresolvable` (hink 4 lista `{url, reason}`)

Möjliggör grep på hink 4 över korpus utan att läsa MHTML.

---

## Verifiering

`bun scripts/breadth-smoke.ts` efter commit 2 (oförändrat efter 3–4):

- **Vercel:** Gate1 ~40/40 registered, `classification: {"OK": 40}`.
- **Intercom:** motsvarande lyft.
- **HubSpot:** oförändrat grön — regressionstest för differentialvakten.
- **Harmonisering:** P==M på alla sajter, `p,m >` tidigare värden.

Nya hink-4-misser = äkta harvest-fel (CSS-part utan giltig Content-Location), nu synligt i receipt med reason. Adresseras separat, blockerar inte andra sajter.

---

## Vad denna plan medvetet INTE gör

- **Inget pass-1.5.** En invariant, ett universum.
- **Ingen P-frysning + parallell `P_rel`.** P muteras in-place; differentialtestet (inte identitet) skyddar de 2/40.
- **Ingen delad P/M-adoption.** Atomär i commit 2 — splittring tvingar fram fejk-grönt.
- **Ingen semantik under gammalt namn.** `absoluteUrls` → `replayUrls`.
- **Ingen ändring i `render-canary.server.ts` / descriptor-matchning.** Diagnosen visade koden är korrekt — den saknade bara `cid:`-URLer att binda till.
