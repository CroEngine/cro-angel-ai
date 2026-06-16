# Smart canary-gate: ghost-diskriminator på State B

## Bakgrund (verifierade fakta, inte antaganden)

- `corpus/hubspot/render-canary.families.json` visar att "Lexend Deca" failar med `gate1.reason = "descriptor_missing"` (`branchTaken: "A2-no-descriptor"`). **Inte** State A (`!registered` → "missing families: …").
- `corpus/hubspot/page.mhtml` har 23 `@font-face`-block, inget för "Lexend Deca". De 87 träffarna är `font-family:`-användningar i CSS-variabler.
- `extractEmbeddedFamilies(mhtml)` i `mhtml-fonts.server.ts:469` returnerar bara familjer med `@font-face { ...; src: url(...) }` (filter via `hasRemoteSrc`). Importeras redan i `harness.server.ts:28`.
- "Lexend Deca" hamnar i `expectedFamilies` via `freeze-report.embeddedFamilies` (rad 31). Backfillen via `extractEmbeddedFamilies` (harness:283) hade INTE inkluderat den.

→ Lexend Deca är en **freeze-time-ghost**: freeze över-recordade familjen, men det finns ingen `@font-face`-deklaration i MHTML. Diskriminatorn på replay-sidan är därför "finns familjen i `extractEmbeddedFamilies(mhtml)` eller ej".

## Scope

En commit. Rör bara State B (`gate1.reason === "descriptor_missing"`). Allt annat orört och blockerande:
- State A (`!registered` → "missing families: …") — blockerar
- Andra gate1-reasons (`unresolved`, `timeout`, `check_mismatch`, `fallback`) — blockerar
- Gate 2 drift — blockerar

## Ändringar

### 1. `runRenderCanary` tar emot deklarerade familjer

`src/lib/tests/snapshot/render-canary.server.ts`:

- Lägg till `declaredFamilies?: string[]` i `RunCanaryOpts`. Tom/odefinierad = fail-closed (alla `descriptor_missing` blockerar, som idag).
- I post-processeringen (rad 492–510), splitta `descriptor_missing`-failures:
  - Bygg `declaredSet = new Set((opts.declaredFamilies ?? []).map(canon))` med samma `stripQuotes().toLowerCase()`-canon som klassificeraren använder.
  - För varje familj med `gate1.reason === "descriptor_missing"`:
    - `declaredSet.has(canon(f.family)) === false` → klassa som **ghost**, gå INTE in i `failures`.
    - Annars → behåll i `failures` som idag (`gate1 descriptor_missing: "X" loadError=...`).
- Lägg till `ghosts: string[]` på `RenderCanaryReport` (familjer som klassats som ghost). Tom array när `declaredFamilies` inte angetts.
- `ok = failures.length === 0` oförändrat. Ghosts påverkar inte `ok`.

Fail-closed-fallback: om `declaredFamilies` är `undefined`, om canon-uppslag kastar, eller om listan är ambiguös (samma canon-värde med olika spelling) → klassa som registered_fail (= behåll i failures).

### 2. Harness passerar MHTML-deklarerade familjer

`src/lib/tests/snapshot/harness.server.ts`, rad ~385:

```ts
const mhtmlDeclared = extractEmbeddedFamilies(readFileSync(tmpFile, "utf8"));
canary = await runRenderCanary(page, embeddedFamilies, {
  env: { chromiumPath, chromiumVersion, pinned },
  declaredFamilies: mhtmlDeclared,
});
```

(`mhtmlText` läses redan i backfill-pathen på rad 282, men bara villkorligt; vi behöver ovillkorlig läsning här. Liten omstrukturering — läs en gång, dela.)

### 3. Receipt: ghosts på canary-sidan, inte i freeze-report

I harness:404–423 (`FamiliesReceiptFile`-skrivningen), inkludera `ghosts: canary.ghosts` i den durabla artefakten `render-canary.families.json`. Lägg till `ghosts` i `FamiliesReceiptFileSchema` (`render-canary-receipt.ts`).

Logga icke-blockerande warning före `if (!canary.ok)`-gaten:
```ts
if (canary.ghosts.length > 0) {
  console.warn(`[replay] canary ghosts (non-blocking): ${canary.ghosts.join(", ")}`);
}
```

`freeze-report.json` rörs inte. Ghost-listan är en replay-time-observation, inte freeze-input.

## Verifiering

1. Kör `bunx vitest run src/lib/tests/snapshot/__tests__/snapshot.test.ts`.
   - **Förväntat:** render-canary passar på hubspot. Console: `[replay] canary ghosts (non-blocking): Lexend Deca`. Testet går vidare och producerar `[snapshot] hubspot: N off-flow suspects`.
   - **Förväntat:** `corpus/hubspot/render-canary.families.json` har `ghosts: ["Lexend Deca"]` och Lexend Deca-entryn finns kvar med `pass: false, reason: "descriptor_missing"` (transparens — vi maskerar inte, vi reklassificerar konsekvensen).
2. Kör `bunx vitest run src/lib/tests/snapshot/__tests__/render-canary.test.ts` — befintliga negativa cases (unresolved, timeout, check_mismatch, fallback, gate2-drift) ska fortsatt failas hårt.
3. `bunx tsc --noEmit` — grön.
4. Spot-check artefakt-diffen i `corpus/hubspot/render-canary.families.json`: bara `ghosts`-fältet tillkommer; per-familj-data oförändrad.

Rapportera done först när både diff + faktiskt testresultat är grönt — inte på grön CI-status ensam.

## Inte i scope

- Re-freeze av hubspot (ghost-bug i freeze.server.ts är en separat commit; den här ändringen behöver inte den för att unblocka).
- CI-patch för `playwright install --with-deps chromium` (separat commit).
- State A-vägen (`!registered`). Inga kända fall just nu; om/när det dyker upp samma diskriminator-mönster där, separat commit.
