# Snapshot-stabilitet: font-pinning först, sen tiebreak/diff, buckets sist

Empirisk diagnos: **font-substitution** är rotorsaken till hibobs uniforma `yBand: -100` och area-driften — inte cross-env subpixel-jitter.

## Bevis

- `corpus/hibob/page.mhtml`: 36 `@font-face`-deklarationer, **0** font Content-Type-parts
- `corpus/hubspot/page.mhtml`: 23 deklarationer, **0** font-parts, 3 externa `fonts.gstatic.com`-URLs
- `harness.server.ts:200-204` aborterar all icke-`file://`-trafik → fallback till OS-font
- Area-histogram 250-700 är kontinuerlig (260, 290, 310, 320, 360, 380, 420, 440, 530, 570, 580, 590, 630, 660, 680, 700) — **inga dalar** att placera bucket-gränser i
- Diff-kollision bekräftad: `jq` visar 3× `"Learn more about content agent"` i hubspots golden → `(tagName, text)` är inte unik

## Steg 0 — Pre-flight (5 minuter, billigt, avgör spår)

**Kolla `corpus/hubspot/screenshot.jpg` och `corpus/hibob/screenshot.jpg` med blotta ögat.**

- Rendrad med riktig webfont → fonterna laddades vid capture, `captureSnapshot` droppade dem ändå. Då är `document.fonts.ready` en no-op. Hoppa A1, gå direkt på **A2-proxy eller A3-pinnad container**.
- Rendrad med fallback (system-default) → fonterna hann inte ladda. `fonts.ready` löser det. A1 räcker.

Också: kontrollera om Chromium kan ladda MHTML-inlinade fonter genom `context.route("**/*", abort)`-gaten. MHTML-subresurser bör serveras internt utan interceptbar trafik, men osäkert. Skapa en minimal test-MHTML med en känd embeddad font, replaya, kör `document.fonts.check('12px "TestFont"')`. Om `false` → gaten dödar även `cid:`-resurser, då behöver gaten en undantagsregel `if (url.startsWith("cid:")) return route.continue()`.

## A. Font-fix vid capture (root cause)

Tre alternativ, väljs efter Steg 0. Implementera bara det/de som krävs.

### A1. `document.fonts.ready` före capture (om Steg 0 säger "fallback i screenshot")

`src/lib/tests/snapshot/freeze.server.ts`, innan `Page.captureSnapshot`:

```ts
// Returnera boolean — FontFaceSet serialiseras inte rent över CDP.
await page.evaluate(() => document.fonts.ready.then(() => true));

// Poll scrollHeight stabil i 3 frames istället för magisk timeout —
// font-swap triggar reflow som kan ändra lazy-load.
let last = -1, stable = 0;
const deadline = Date.now() + 2000;
while (Date.now() < deadline && stable < 3) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  stable = h === last ? stable + 1 : 0;
  last = h;
  await new Promise((r) => setTimeout(r, 100));
}
```

### A2. Inline fonter via @font-face-rewrite (om A1 inte räcker)

Före capture, intercepta `@font-face`-regler, fetcha varje `src: url(...)`, base64-encoda till `data:`-URL, ersätt regeln. Trade-off: gstatic splittar per `unicode-range × vikt × format` (36 deklarationer för hibob), så naiv inlining blåser upp `mhtmlKb`. Filtrera till bara aktivt använda subsets (matcha mot `document.fonts.entries()` filtered by `loaded`).

### A3. Pinnad replay-container (fallback om A1+A2 är för dyra)

Pinna Chromium + OS-font-paket via Docker image i CI **och** lokal replay. Garanterar att fallback-fonten är samma överallt. Lägre audit-fidelity (fontmetrics styr CRO-layouten), men en bråkdel av kod jämfört med A2.

**Beslutspunkt efter Steg 0:** Pinged om val mellan A2 och A3 om båda krävs.

### Mätning i `freeze-report.json`

```ts
capture.fontsLoadedCount: number   // document.fonts.size pre-capture
capture.mhtmlFontParts: number     // post-capture string-scan
capture.fontsReadyMs: number       // hur länge vi väntade
```

Soft assertion (warning, inte throw): `fontsLoadedCount > 0 && mhtmlFontParts === 0` → "fonter laddade vid capture men inte inlinade — overväg A2-proxy".

## B. Font-verifiering vid replay (defense in depth + disambiguation)

`src/lib/tests/snapshot/harness.server.ts`, efter `waitForStableContext`:

```ts
await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});

// Probe: avgör om font-fixen faktiskt landade i den här replayen.
const fontStatus = await page.evaluate(() => ({
  size: document.fonts.size,
  loaded: Array.from(document.fonts).filter((f) => f.status === "loaded").length,
  // För hubspot: 'Lato'. För hibob: huvudfont från CSS.
  // Logga listan i Steg 0 så vi kan hårdcoda 1-2 kanoniska familjer per corpus.
  families: Array.from(new Set(Array.from(document.fonts).map((f) => f.family))),
}));
console.log(`[replay] fonts:`, fontStatus);
```

Den loggade `fontStatus` skiljer:
- `size === 0` → A misslyckades, fonterna är inte i MHTML
- `size > 0, loaded === 0` → MHTML har fonterna men gaten aborterade `cid:`-trafiken → fixa gaten i Steg 0
- `size > 0, loaded > 0` → grönt

## C. Verifiering — run-to-run-determinism, INTE match mot gammal golden

Den gamla goldenen är `normalize(replay(gammal_mhtml))` med fallback-layout. A producerar `normalize(replay(ny_mhtml))` med riktig layout. De ska skilja sig på area/yBand överallt — det är inte ett fel, det är att fixen fungerar.

**Verifieringen kan inte vara match-mot-gammal-golden.** Den måste vara:

1. Frys om hibob + hubspot lokalt med A
2. Generera kastbar golden: `SNAPSHOT_UPDATE=1 bunx vitest run snapshot.test.ts` (skriver lokalt, committas INTE)
3. Kör snapshot-testen 3-5× mot den kastbara goldenen
4. **Pass-kriterium**: noll diff mellan replay-körningar. Run-to-run-determinism, inte cross-version match.
5. Om grönt → committa den nya goldenen (inkluderar hubspots äkta content-ändring som bonus)
6. Om rött → läs diffen, gå till D/E

Den committade regenen via CI ligger kvar i G, men *blockerar inte* lokal verifiering av A.

## D. Tiebreak — `domIndex` (oberoende av A för det den löser)

`src/lib/tests/scripts/collect.ts`: lägg till `domIndex: number` per element, satt via DOM-walk-counter (inte CSS-position).

Sorteringsnyckel i `normalize.ts elementKey`: `(section, category, intent, yBand, text, domIndex)`. `domIndex` är total-ordning, garanterar deterministisk sortering vid identiska primärnycklar (footer-länkar med samma yBand var ursprungsfallet).

**Notera:** `yBand_q`-stabilitet beror på A. Om residual-yBand-jitter kvarstår efter A flippar element över bandgränser → primärnyckeln ändras → `domIndex`-tiebreak räddar inte. D fungerar fullt ut först när A är grön.

## E. Buckets/tolerans — endast om residual finns efter A+D

Mät residual-drift efter A+D (run-to-run i C). Tre delbeslut:

- **Area**: bucket-gränser sätts empiriskt från residual-histogrammet, **inte** från nuvarande golden-histogrammet (som är fallback-renderad och inte representativt). Histogram-dalar bredare än p90-residualdrift.
- **yBand**: demotera från hård assert. `section` + `aboveFold` bär redan vertikal semantik. Antingen ±1-band-tolerans i jämförelsen eller demotera helt till receipt.
- **Score**: bucketisering **i normalize, inte i collectorn**. Bucket-i-collector ändrar produktbeteende (CTA-rankning, UI), vilket är ett tyst produktbeslut. Test-only stabilisering ska bo i test-lagret.

## F. Key-baserad diff (läsbarhet)

`normalize.ts diffNormalized`: matcha element på `(tagName, text, href, domIndex)` istället för array-index. `domIndex` är **obligatorisk** sista nyckel — bevisat av `jq`-kollen: hubspot har 3× `"Learn more about content agent"`, så `(tagName, text)` är inte unik.

Algoritm: bygg ett `Map<key, element>` per sida, iterera union av nycklar, emit `[added]`/`[removed]`/`[changed]`-rader. En insertion → 1 diff-rad, inte kaskad.

## G. `update-goldens.yml` workflow_dispatch

Sist. När A-F är gröna är regeneration via CI mekanisk: kör med `SNAPSHOT_UPDATE=1`, committa `corpus/*/golden.json` tillbaka via `github-actions[bot]`. Bara värde när vi vet att golden-en blir stabil.

## Inga nya filer

Rå area/yBand finns i `freeze-report.json` (capture-env) och `actual.json` (replay-env). För spot-debug: dumpa till `/tmp`, aldrig till `corpus/`.

## Ordning, kort

1. **Steg 0** (5 min): titta på screenshots, kör cid:-probe → bestäm A1/A2/A3
2. **A** (vald variant) + **B** (probe) — implementera tillsammans
3. **C** lokal verifiering: run-to-run-determinism
4. **D** + **F** (kan göras parallellt med A, oberoende fixar)
5. **E** bara om residual kvarstår
6. **G** sist

## Vad vi INTE rör

- `corpus/sites.ts` — orört
- 8 nya sites — separat runda när A-F är gröna
- Score-beräkning i `collect.ts`/`visualHierarchy.ts` — produktkod, inte test-stabilitetsmål
