# Snapshot-stabilitet: A2 font-embedding (post-capture rewrite), sen tiebreak/diff, buckets sist

Steg 0 körd. **A1 är död, A2 är vägen.** Diagnos uppdaterad med fyra beslutspunkter som annars hade återupptäckts mitt i implementationen.

## Steg 0 — Resultat

1. **`cid:`-gaten i `harness.server.ts:200-204`** — `context.route()` ser aldrig MHTML-interna parts (Chromium löser dem internt). Ingen undantagsregel behövs.
2. **`corpus/hibob/screenshot.jpg`** renderar HiBobs äkta slab-serif brand-font ("Loved by people. Built for growth."), inte fallback. Capture-screenshoten visar att fonterna **laddade** vid capture — men `mhtmlFontParts: 0` betyder att MHTML-savet inte bär binärerna. `document.fonts.ready` kan inte fixa ett embedding-problem.

**Konsekvens:** A1 stryks. A2 (inline-fonter vid capture) är default. A3 (pinnad container) kvarstår som dokumenterad fallback.

## Bevis

- `corpus/hibob/page.mhtml`: 36 `@font-face`-deklarationer, **0** font Content-Type-parts. Capture-screenshot i äkta brand-font.
- `corpus/hubspot/page.mhtml`: 23 deklarationer, **0** font-parts, 3 externa `fonts.gstatic.com`-URLs. Area-driften (`2200 → 2100`, ~5%) syns även på element utan text-ändring → hubspot drabbas av samma font-substitution som hibob.
- Area-histogram 250-700 är kontinuerlig (260, 290, 310, 320, 360, 380, 420, 440, 530, 570, 580, 590, 630, 660, 680, 700) — **inga dalar** att placera bucket-gränser i.
- Diff-kollision bekräftad: `jq` visar 3× `"Learn more about content agent"` i hubspots golden → `(tagName, text)` är inte unik.

## A2 — Inline-fonter vid capture (root cause-fix)

### Beslutspunkt 1: Post-capture-rewrite i Node, inte in-page DOM-mutation

In-page rewrite kan inte fungera: gstatic-CSS:n laddas cross-origin från `fonts.googleapis.com`, och `.cssRules` på en cross-origin-sheet utan CORS kastar `SecurityError` — inte åtkomst för att redigera `src`.

Men: efter `captureSnapshot` ligger `@font-face`-CSS:n inlinad som **textpart** i MHTML:en med upplösta gstatic-URL:erna (det är därför vi ser 36 deklarationer). Där är den ren text.

**Hybrid:**
- **In-page (vid capture, före `captureSnapshot`):** kör `document.fonts.entries()` *efter full scroll* för att bestämma vilken subset som faktiskt används. Filtrera `status === "loaded"`. Exportera lista `[{family, weight, style, unicodeRange, src}]`.
- **Node (post-capture):** parse MHTML-text, fetcha varje `src`-URL från subset-listan, embedda, skriv om `@font-face`-CSS:ns `src` till `url(cid:...)`.

### Beslutspunkt 2: cid: > data: (QP-fällan)

MHTML-textparten är nästan säkert `Content-Transfer-Encoding: quoted-printable`. En stor base64-`data:`-blob i en QP-part måste QP-re-encoda korrekt (`=` → `=3D`, soft line breaks, 76-tecken radlängd) annars korrumperas arkivet.

**cid: undviker det helt:** font-binären hamnar i egen ren `base64`-part med eget `Content-Location: cid:font-XYZ@snapshot`, CSS:n får bara `url(cid:font-XYZ@snapshot)`, och Steg 0 bekräftade att Chromium löser `cid:` internt vid replay utan att gå via `context.route()`.

Välj `data:` bara om vi vill bygga en korrekt QP-encoder — inte värt det.

### Beslutspunkt 3: Form-agnostisk success-metrik

`mhtmlFontParts > 0` funkar bara för `cid:` (data:-varianten har 0 parts men ÄR inbäddade). Använd istället:

```ts
capture.externalFontSrcCount: number  // antal @font-face src som fortfarande pekar på http(s):// efter rewrite
```

**Hård assertion:** `externalFontSrcCount === 0` efter A2. Det är invarianten som faktiskt ska vara sann oavsett embedding-form.

Behåll också `mhtmlFontParts` som diagnostik (per cid:-implementation > 0), men den är inte success-gaten.

### Beslutspunkt 4: Fetcha woff2-filerna, inte css-endpointen

Hämta `fonts.gstatic.com/s/...woff2`-URL:erna **direkt**. De är content-hashade → immutabla och byte-stabila → reproducerbar capture, UA-oberoende.

Rör **inte** `fonts.googleapis.com/css2?...`-endpointen; den UA-sniffar och returnerar olika `src`-format per browser. Vi har redan den upplösta gstatic-URL:en i MHTML-textparten — använd den.

### Restrisk: lazy/dolda subsets

`status === "loaded"`-filtret missar text som är lazy renderad eller dold (hidden tabs, below-the-fold collapsed sections) och aldrig triggade unicode-range-subset-fetchen under capture-scrollen. Den subseten inlineas inte → faller tillbaka vid replay → lokal drift just där.

Troligen försumbart efter full scroll, men dokumenterat. Om E (residual) visar drift koncentrerad till specifika sektioner — kolla detta först.

## A3 — Pinnad replay-container (dokumenterad fallback)

Pinna Chromium + OS-font-paket via Docker image i CI **och** lokal replay. Garanterar samma fallback-font överallt. Lägre audit-fidelity (fontmetrics styr CRO-layouten), används bara om A2 visar sig icke-trivialt.

## B — Font-verifiering vid replay (defense in depth)

`src/lib/tests/snapshot/harness.server.ts`, efter `waitForStableContext`:

```ts
await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});

const fontStatus = await page.evaluate(() => {
  // Passa representativt text-arg + exakt deklarerat family-namn,
  // annars triggas inte nödvändigtvis den unicode-range-subset som
  // faktiskt används, och check() utan text svarar på fel subset.
  // Hårdkoda 1-2 kanoniska familjer per corpus efter att vi sett
  // CSS:n vid första A2-körningen.
  const checks = {
    // hibob (slab brand-font), hubspot (Lato)
    "hibob-brand": document.fonts.check('12px "Recoleta"', "Loved by people"),
    "hubspot-lato": document.fonts.check('12px "Lato"', "Learn more"),
  };
  return {
    size: document.fonts.size,
    loaded: Array.from(document.fonts).filter((f) => f.status === "loaded").length,
    families: Array.from(new Set(Array.from(document.fonts).map((f) => f.family))),
    checks,
  };
});
console.log(`[replay] fonts:`, fontStatus);
```

Tolkning:
- `size === 0` → A2 misslyckades, fonterna är inte i MHTML
- `size > 0, loaded === 0` → embedding ok, replay-rendering fallerar (osannolikt efter Steg 0)
- `checks[*] === false` med `loaded > 0` → unicode-range-subset matchar inte, lazy/dold-restrisken

## C — Verifiering: run-to-run-determinism, INTE match mot gammal golden

Gammal golden = `normalize(replay(gammal_mhtml))` med fallback-layout. A2 producerar `normalize(replay(ny_mhtml))` med riktig layout. De **ska** skilja sig på area/yBand överallt — det är inte fel, det är att fixen fungerar.

1. Frys om hibob + hubspot lokalt med A2 (verifiera `externalFontSrcCount === 0`)
2. Generera kastbar golden: `SNAPSHOT_UPDATE=1 bunx vitest run snapshot.test.ts` (lokalt, committas INTE)
3. Kör snapshot-testen 3-5× mot den kastbara goldenen
4. **Pass-kriterium:** noll diff mellan replay-körningar
5. Om grönt → committa nya goldenen (inkluderar hubspots äkta content-ändring som bonus)
6. Om rött → läs diffen, gå till D/E

Committed regen via CI ligger kvar i G, men *blockerar inte* lokal verifiering av A2.

## D — Tiebreak: `domIndex` (oberoende av A2 för det den löser)

`src/lib/tests/scripts/collect.ts`: lägg till `domIndex: number` per element via DOM-walk-counter.

Sorteringsnyckel i `normalize.ts elementKey`: `(section, category, intent, yBand, text, domIndex)`. Total-ordning, garanterar deterministisk sortering vid identiska primärnycklar (footer-länkar var ursprungsfallet).

**Notera:** `yBand_q`-stabilitet beror på A2. Om residual-yBand-jitter kvarstår efter A2 flippar element över bandgränser → primärnyckeln ändras → `domIndex`-tiebreak räddar inte. D fungerar fullt ut först när A2 är grön.

## E — Buckets/tolerans: bara om residual finns efter A2+D

Mät residual-drift efter A2+D (run-to-run i C). Tre delbeslut:

- **Area:** bucket-gränser sätts empiriskt från residual-histogrammet, **inte** från nuvarande golden-histogrammet (fallback-renderad, ej representativt).
- **yBand:** demotera från hård assert. `section` + `aboveFold` bär redan vertikal semantik. Antingen ±1-band-tolerans eller demotera helt till receipt.
- **Score:** bucketisering **i normalize, inte i collectorn**. Bucket-i-collector ändrar produktbeteende (CTA-rankning, UI) — tyst produktbeslut. Test-only stabilisering bor i test-lagret.

## F — Key-baserad diff (läsbarhet)

`normalize.ts diffNormalized`: matcha på `(tagName, text, href, domIndex)` istället för array-index. `domIndex` **obligatorisk** sista nyckel — bevisat av `jq`-kollen (3× duplicates i hubspot).

Algoritm: bygg `Map<key, element>` per sida, iterera union av nycklar, emit `[added]`/`[removed]`/`[changed]`-rader. En insertion → 1 diff-rad, inte kaskad.

## G — `update-goldens.yml` workflow_dispatch

Sist. När A2-F är gröna är CI-regen mekanisk: `SNAPSHOT_UPDATE=1`, committa `corpus/*/golden.json` tillbaka via `github-actions[bot]`.

## Ordning

1. **A2** (post-capture Node-rewrite, cid:-embedding, `externalFontSrcCount === 0` som gate) — för **både hibob och hubspot** (hubspots area-drift bevisar att även den fångar fallback-layout)
2. **B** (replay-probe med exakt family + text-arg) — implementeras tillsammans med A2
3. **C** lokal verifiering: run-to-run-determinism, 3-5× mot kastbar golden
4. **D** + **F** (tiebreak + key-diff, kan göras parallellt med A2, oberoende fixar)
5. **E** bara om residual kvarstår
6. **G** sist

## Vad vi INTE rör

- `corpus/sites.ts` — orört
- 8 nya sites — separat runda när A2-F är gröna
- Score-beräkning i `collect.ts`/`visualHierarchy.ts` — produktkod, inte test-stabilitetsmål
- `cid:`-gaten i `harness.server.ts` — Steg 0 bekräftade att den inte rör MHTML-interna parts

## Vad som ändrades från förra plan-versionen

- **A1 struken** (Steg 0 bevisade att fonter ladade vid capture, det är embedding som saknas)
- **A2 omspecad:** hybrid in-page/Node, cid: framför data: (QP-fällan), `externalFontSrcCount === 0` som form-agnostisk gate, fetcha woff2-filer direkt (inte css-endpoint)
- **B uppdaterad:** `document.fonts.check()` tar text-arg + exakt family-namn för korrekt unicode-range-träff
- **Restrisk dokumenterad:** lazy/dolda subsets missas av `status === "loaded"`-filtret
