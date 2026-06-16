# Commit 5 — pre-embed.mhtml som korpus-input + real-corpus P==M (v2)

Två delar. Vaktar harvest/projektions-invarianten på real corpus, deterministiskt och Playwright-fritt.

## Bakgrund (verifierat)

`freeze.server.ts` skriver redan `page.pre-embed.mhtml` till `dir` (= `corpus/<name>/` när inte dryRun) **före** `embedMhtmlFonts`-anropet. Receipt-före-throw är alltså redan uppfyllt för pre-embed-fixturen. Commit 5a är därför dokumentation + README — ingen logikändring.

Att existerande korpora (`corpus/hubspot/`, `corpus/hibob/`) saknar `page.pre-embed.mhtml` beror på att de frystes innan den raden landade. Re-freeze kräver Browserbase och är **explicit out-of-scope för denna commit** (se nedan).

## Commit 5a — Dokumentera pre-embed som första-klass artefakt

**Ändring 1: `freeze.server.ts`** — uppdatera kommentaren ovanför pre-embed-skrivningen (samma rad som idag, ankrad mot `report.capture.mhtmlKbBeforeFontEmbed = ...` och raden direkt före `embedMhtmlFonts(`-anropet). Ny kommentar:

> "Skriv page.pre-embed.mhtml FÖRE embedMhtmlFonts och FÖRE A2-gaten (samma receipt-före-throw-princip som report.capture.fontUrls). Korpusen blir då self-contained: input + post-embed-output båda frusna, re-embed är en deterministisk diff istället för ett live-re-capture."

**Ändring 2: `corpus/README.md`** — dokumentera att varje `corpus/<name>/` ska innehålla både `page.pre-embed.mhtml` (rå captureSnapshot, externa font-URLer kvar) och `page.mhtml` (post-embed, cid:-rewriten).

## Commit 5b — Real-corpus P==M test med allowlist-gata

I `src/lib/tests/snapshot/__tests__/harvest-font-urls.test.ts`, lägg till ny test-suite. Tre design-låsningar baserat på review-feedback:

### Låsning 1: Repo-rotsankrad sökväg

Härled corpus-rot från testfilens egen plats (`fileURLToPath(import.meta.url)` → `../../../../../corpus`), **inte** `process.cwd()`. En testkörning från fel CWD ska inte tyst kunna skip:a sviten.

### Låsning 2: Allowlist för icke-vakuitet, inte blank toBeGreaterThan(0)

```ts
// Korpora där vi vet att harvesten ska producera externa URLer
// (innan A2-embedding). Lägg till sajter när de re-freezas.
// Font-lösa sajter (system-stack / pure local()) hör INTE hit.
const KNOWN_REMOTE_FONT_CORPORA = new Set<string>([
  "hubspot",
  "hibob",
  // "vercel", "intercom", ... lägg till efter re-freeze
]);
```

För varje upptäckt `corpus/<name>/page.pre-embed.mhtml`:
- Asserten `toEqual(pReplay)` körs alltid (invarianten).
- Asserten `mTargets.size > 0` körs **endast** om `name ∈ KNOWN_REMOTE_FONT_CORPORA`. Det fångar per-sajt tyst-harvest-död utan att straffa legitimt font-lösa sajter.

### Låsning 3: Skip→fail-flip så fort ≥1 allowlistad fixture finns

```ts
const discovered = corpora.filter(name =>
  existsSync(join(CORPUS_ROOT, name, "page.pre-embed.mhtml"))
);
const expectedFromAllowlist = corpora
  .filter(n => KNOWN_REMOTE_FONT_CORPORA.has(n))
  .filter(n => existsSync(join(CORPUS_ROOT, n, "page.pre-embed.mhtml")));

if (discovered.length === 0) {
  it.skip("ingen page.pre-embed.mhtml committad än — re-freeze krävs", () => {});
  return;
}

// Så fort minst en allowlistad pre-embed finns: en framtida radering
// får INTE tyst återgå till skip-grön.
it("allowlistade KNOWN_REMOTE_FONT_CORPORA har sina pre-embed-fixturer committade", () => {
  const missing = [...KNOWN_REMOTE_FONT_CORPORA].filter(
    n => !existsSync(join(CORPUS_ROOT, n, "page.pre-embed.mhtml"))
  );
  // Under övergången (innan första re-freeze) är listan tom → testet passerar.
  // Efter första re-freeze: radering av en allowlistad fixture failar.
  if (expectedFromAllowlist.length > 0) {
    expect(missing).toEqual([]);
  }
});
```

### Testkroppen (per korpus)

```ts
for (const name of discovered) {
  it(`${name}: extractFontFaceDiagnostics.flatMap(replayUrls) ≡ collectEmbedTargets(resolved)`, () => {
    const raw = readFileSync(join(CORPUS_ROOT, name, "page.pre-embed.mhtml"), "utf8");
    const pReplay = new Set(extractFontFaceDiagnostics(raw).flatMap(f => f.replayUrls));
    const mTargets = new Set(collectEmbedTargets(raw).map(u => u.resolved));
    expect(mTargets).toEqual(pReplay); // invarianten — alltid
    if (KNOWN_REMOTE_FONT_CORPORA.has(name)) {
      expect(mTargets.size).toBeGreaterThan(0); // icke-vakuitet — bara där vi vet
    }
  });
}
```

## Explicit out-of-scope för denna commit

Implementera **inte** något av nedanstående — det är användarens nästa steg, separat från denna agentkörning:

- Re-freeze av befintliga korpora. Kör inte `scripts/freeze-site.ts`. Anropa inte Browserbase. Hitta inte på `BROWSERBASE_*`-secrets.
- Ändringar i embedding-/rewrite-logiken (`mhtml-fonts.server.ts` — embedMhtmlFonts-kroppen, cid:-genereringen, A2-gaten).
- Ändringar i MHTML-format eller `FontEmbedResult`-shape.
- Ändringar i Test 1 (syntetisk, pinnad) eller Test 2 (consumption-equality på syntetisk).
- Nya CLI-flaggor, nya skript, ändringar i `breadth-smoke.ts`.

## Acceptanskriterier

- `bun vitest run src/lib/tests/snapshot/__tests__/harvest-font-urls.test.ts` kör grönt i nuvarande repo-state. Den nya suiten antingen skip:as (om ingen `page.pre-embed.mhtml` finns committad än) eller passerar (om någon committats utanför denna commit).
- Test 1 och Test 2 är oförändrade och passerar.
- Inga ändringar i exporter från `harvest-font-urls.ts`, `mhtml-fonts.server.ts`, `freeze.server.ts` utöver kommentaren i 5a.
- Inga andra testfiler ändrade.
- `freeze.server.ts`-diff är enbart kommentar; ingen kodrad flyttad eller logik ändrad.