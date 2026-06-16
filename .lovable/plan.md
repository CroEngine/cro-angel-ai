## Regen-modell (blockerande klargörande)

**Flow A bekräftad.** `scripts/breadth-replay.ts` rad 26 anropar `replayCorpus(name, BREADTH_ROOT)` **före** rad 31 läser `render-canary.families.json`. `replayCorpus` öppnar lokal `page.mhtml`, kör render-canary, och skriver om `render-canary.families.json` med den nya skrivar-koden. Läsaren ser alltid en receipt producerad av den nuvarande harness-versionen.

Konsekvens för `schemaVersion: z.literal(1)` (required):
- Befintliga v0-receipts på disk (stripe/intercom/vercel) saknar fältet, men de **läses aldrig** i sin v0-form — replay-steget skriver om dem till v1 först.
- Regressionsförväntan **2/2, 14/14, 21/21** håller på första körningen utan engångs-migration.
- `STALE_RECEIPT`-grenen är **försäkring**, inte normalväg. Den biter i två framtida scenarier: (a) en fast-path eller test som läser receipt utan att köra replay först, (b) schema-bump till v2 där en gammal v1-receipt läses innan replay hunnit regenerera. Den är billig (~10 rader) och ska etiketteras i koden:

```ts
// STALE-gren: försäkring mot skip-regen / framtida schema-bumps.
// Normal replay-väg regenererar receipt via replayCorpus() före läsning,
// så v0→v1-uppgradering sker automatiskt på första körningen.
```

Summary-loopen aggregerar `gate1Total` endast när `!r.staleReceipt`; stale räknas i en egen hink. Ingen `total += undefined` → ingen NaN, ingen tyst under-räkning.

## Filer

### Ny: `src/lib/tests/snapshot/render-canary-receipt.ts`

Sanningskälla. Ren typ + Zod, inga browser-globals, inga server-only-imports → säker att importera från `*.server.ts` (skrivare) **och** `scripts/*.ts` (läsare).

- `schemaVersion: z.literal(1)` på filnivå (required).
- `Gate1ReasonSchema = z.enum([...])` — alla 7 reasons från `render-canary.server.ts`.
- `Gate2ReasonSchema = z.enum(["ok","drift","skipped"])`.
- `BranchTakenSchema = z.enum([...8 branches])`.
- `Gate1DiagSchema` — fullt utfyllt, inkl. nested `strings: { manifestFamily, allDescriptorFamilies, matchedDescriptorFamilies, checkString, widthString }`, `canonMismatch`, `canonMismatchDetail`. **Inte** `z.unknown()`.
- `Gate1ReportSchema` — `{ wWith, wFallback, deltaLoad, fontsCheckPass, pass, reason, loadError? }`.
- `Gate2ReportSchema` — `{ wOrig, deltaSubset, pass, reason }`.
- `FamilyReceiptSchema = z.object({ family, gate1: Gate1ReportSchema, gate2: Gate2ReportSchema.optional(), diag: Gate1DiagSchema })`.
- `RenderCanaryEnvSchema = z.object({ chromiumPath, chromiumVersion, pinned })`.
- `FamiliesReceiptFileSchema = z.object({ schemaVersion: z.literal(1), env: RenderCanaryEnvSchema.optional(), families: z.array(FamilyReceiptSchema) })`.
- **Ingen `.strict()`** på fil-schemat → default-strip ger forward-compat när skrivaren adderar fält.
- Re-exporterar TS-typer via `z.infer<>`.
- Disciplin för framtida bumps: nya fält adderas `.optional()`; vid breaking change höjs `schemaVersion` och hela korpusen omfryses (replay räcker eftersom MHTML är intakt).

### Refaktor: `src/lib/tests/snapshot/render-canary.server.ts`

Ersätt de fyra hand-skrivna interfacen (`Gate1Report`, `Gate2Report`, `Gate1Diag`, `RenderCanaryEnv`) med `z.infer`-re-exporter från receipt-modulen. Det är det som gör schemat till sanningskälla — annars driftar interface och Zod osynligt isär. `FamilyReport` (in-memory) behåller sina extras (`registered, loadedCount, totalCount, sampleText, sampleSource, widthVsFallback, fontsCheckPass`) ovanpå de delade typerna; de skrivs aldrig till disk.

### Skrivare: `src/lib/tests/snapshot/harness.server.ts`

Annotera + **runtime-validera** vid receipt-konstruktionen (rad ~410):

```ts
import { FamiliesReceiptFileSchema, type FamiliesReceiptFile } from "./render-canary-receipt";

const receipt: FamiliesReceiptFile = {
  schemaVersion: 1,
  ...(canary.env ? { env: canary.env } : {}),
  families: canary.families.map((f) => ({
    family: f.family,
    gate1: f.gate1,
    ...(f.gate2 ? { gate2: f.gate2 } : {}),
    diag: f.diag,
  })),
};
const validated = FamiliesReceiptFileSchema.parse(receipt); // strippar in-memory-extras
writeFileSync(join(dir, "render-canary.families.json"), JSON.stringify(validated, null, 2));
```

Compile-time-annotering ensam fångar inte runtime-formdrift (t.ex. en family där `gate1` blir `undefined` via en silent-fail map). `.parse(receipt)` före `writeFileSync` säkerställer att en dålig artefakt **aldrig** blir durabel — Browserbase-frysning är dyr.

### Läsare: `scripts/breadth-replay.ts`

```ts
import { FamiliesReceiptFileSchema } from "../src/lib/tests/snapshot/render-canary-receipt";
import { ZodError } from "zod";

interface Out {
  // ...befintliga fält...
  staleReceipt?: string; // försäkring mot skip-regen / framtida schema-bump
}

// ...
if (existsSync(famPath)) {
  let fam;
  try {
    const raw = JSON.parse(readFileSync(famPath, "utf8"));
    fam = FamiliesReceiptFileSchema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) {
      const issue = e.issues[0];
      r.staleReceipt = `${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "drift"}`;
      results.push(r);
      continue;
    }
    throw e; // FS/JSON-parse-fel är riktiga fel
  }
  r.perFamily = fam.families.map((f) => ({
    family: f.family,
    registered: f.gate1.pass,
    reason: f.gate1.reason,
  }));
  r.gate1Total = fam.families.length;
  r.gate1Registered = r.perFamily.filter((x) => x.registered).length;
  // ...classification oförändrat...
}
```

Summary-loopen får en explicit stale-gren **före** aggregering:

```ts
for (const r of results) {
  console.log(`\n--- ${r.name} ---`);
  if (r.staleReceipt) {
    console.log(`  STALE: ${r.staleReceipt} — kör replay för att regenerera`);
    continue;
  }
  if (r.gate1Total == null) { /* befintlig no-families-gren */ continue; }
  // ...befintlig Gate1-rapport oförändrad...
}
```

Eventuella aggregat över alla sajter (om de tillkommer) hoppar `r.staleReceipt`-rader. Just nu finns ingen sådan totalsumma — bara per-sajt — så NaN-risken är hypotetisk men grenen är på plats för framtida summering.

## Verifiering (fyra drift-riktningar)

1. **Happy path / regression**: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/bin/chromium bun run scripts/breadth-replay.ts` mot befintlig v0-korpus → replay regenererar varje `render-canary.families.json` till v1 före läsning → `Gate1 2/2`, `14/14`, `21/21`. Efter körningen innehåller disk-receipten `"schemaVersion": 1`.

2. **Disk-drift biter (runtime-skydd, originalbuggens klass)**: kopiera vercel:s nyligen v1-stämplade receipt till `/tmp/drifted.json`, patcha `families[0].gate1.reason` → `42`, peka läsaren temporärt mot den → `STALE: families.0.gate1.reason: Invalid input...` + ingen `gate1Total`. Ej committad. Bevisar att false-floor från tyst `undefined` är död.

3. **Reader-drift omöjlig (compile-skydd)**: temporärt lägg `const _wrong: boolean = fam.families[0].registered;` i `breadth-replay.ts` → `tsc --noEmit` (harness kör det åt oss) kastar `Property 'registered' does not exist on type 'FamilyReceipt'`. Rad tas bort efter bevisning. Visar att originalbuggen (top-level `registered`/`reason`) är kompilerings-omöjlig nu.

4. **Skrivar-vakt biter**: temporärt mutera receipt-konstruktionen i `harness.server.ts` så `gate1` blir `undefined` på en family → frys/replay kastar `ZodError` **före** `writeFileSync`. Återställs.

## Out of scope

- Auto-regen-loop vid `STALE_RECEIPT` (manuell `rm` + replay räcker; replay regenererar redan i normalflödet — STALE-grenen är försäkring).
- Korpus-expansion 15→30.
- LFS-setup (sandboxen committar inte; kommandona ligger fast: `git lfs track 'fixtures/breadth-corpus/**/*.mhtml'` + `**/*.pre-embed.mhtml` + `**/*.jpg` **före** första `git add fixtures/breadth-corpus`).
- Ändringar i freeze/replay-logik utöver typer + Zod.
- Ändringar i frusna MHTML/JPG-fixtures.

## Avbrottskriterier

- `zod` ej installerad → `bun add zod` först, verifiera.
- Receipt-modulen kan inte importeras från `scripts/` (osannolikt: ren typ + Zod) → stoppa, byt inte filnamn till `.server`.
