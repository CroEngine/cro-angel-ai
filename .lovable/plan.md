# Mål

Optimera och städa upp koden vi har innan vi går vidare. Inga nya features, inga ändringar i hur data samlas. Vi siktar på: snabbare pageAudit, mindre filer, en enda källa för typer, och bort med kvarvarande "diagnos"-kod i UI:t.

# Vad som är problemet idag

1. **`pageAudit` kör 7 sekventiella `page.evaluate`-anrop** (SECTIONS, TRUST_SIGNALS, CTAS, FORMS, NAVIGATION, VISUAL_HIERARCHY, dims). De är oberoende och read-only → mycket onödig väntan över nätet.
2. **`engine.server.ts` är 2228 rader** — 9 stora script-strängar (~1700 rader) blandas med pipelining och typer.
3. **Typer dupliceras** i tre filer: `engine.server.ts`, `findings.ts` (som `*Like`-interfaces) och `ConsolePanel.tsx`. Driftrisk när schema ändras.
4. **Leftover diagnos-kod i `ConsolePanel.tsx`**:
   - `PageAuditDetails` renderar `flags` som amber-varningar (men `flags` är nu alltid tom).
   - `CollectDetails` har amber-styling för `competingAboveFold >= 4` — bedömning, hör inte hemma här.
5. **Massiv `pageAudit`-case-block** (~160 rader inline-logik): section-enrichment, summary-byggande, hero-härledning — svår att läsa.

# Ändringar

## 1. Parallellisera `pageAudit`-evaluations (`engine.server.ts`)

Byt de 7 sekventiella `await page.evaluate(...)`-anropen mot `Promise.all([...])`. Förväntat: ~1–2s snabbare per audit. Felhantering: om en evaluation kastar, hela `pageAudit` failar (samma beteende som idag).

## 2. Skapa en delad schema-fil (`src/lib/tests/schema.ts`)

Browser-safe (inga server-imports). Flytta dit alla publika typer som UI:t och engine båda behöver:

`CollectTarget`, `ElementCategory`, `ElementIntent`, `ViewportZone`, `SectionKind`, `SectionType`, `TrustSignalType`, `CollectedElement`, `RepeatedGroup`, `PageSection`, `HeroContent`, `TrustSignal`, `CTAEntity`, `FormField`, `FormEntity`, `NavigationData`, `VisualHierarchyEntry`, `PageSummary`, `PageAuditData`, `CollectData` (det objekt collect-steget returnerar), `EngineEvent`.

Då kan vi:
- Ta bort `*Like`-shadowtyperna i `findings.ts` och importera direkt.
- Ta bort de duplicerade typerna i `ConsolePanel.tsx`.
- `engine.server.ts` re-exporterar från schema-filen.

## 3. Flytta script-strängar till `src/lib/tests/scripts/`

Ren refactor — varje fil exporterar en string-konstant:

```
src/lib/tests/scripts/
  collect.ts            // COLLECT_SCRIPT
  pageAudit.ts          // PAGE_AUDIT_SCRIPT
  sections.ts           // SECTIONS_SCRIPT
  trustSignals.ts       // TRUST_SIGNALS_SCRIPT
  ctas.ts               // CTAS_SCRIPT
  forms.ts              // FORMS_SCRIPT
  navigation.ts         // NAVIGATION_SCRIPT
  visualHierarchy.ts    // VISUAL_HIERARCHY_SCRIPT
  overlay.ts            // OVERLAY_FN
```

`engine.server.ts` importerar dem. Filstorlek faller från ~2228 till ~600 rader. Inga ändringar i script-innehållet.

## 4. Bryt ut pure helpers (`src/lib/tests/audit-helpers.ts`)

Flytta logik som idag bor inline i `pageAudit`-caset:

- `enrichSections(sections, ctas, trustSignals, forms)` — sätter `containsX`-flaggor + raffinerar `type` baserat på heading.
- `buildTrustSummary(trustSignals)`.
- `buildPageSummary(ctas, trustSignals, forms, navigation, sections, dims)`.
- `deriveHero(sections, ctas)`.

`pageAudit`-caset krymper till ~30 rader: anropa scripts parallellt, kör helpers, bygg `full`-objektet.

## 5. Städa `ConsolePanel.tsx`

- Ta bort `PageAuditDetails`-blocket som renderar `flags` som amber-warnings (alltid tom array nu).
- Ta bort amber-styling i `CollectDetails` för `competingAboveFold >= 4` — visa neutralt.
- Ta bort lokala typdefinitioner; importera från `schema.ts`.
- Behåll: `CollectDetails` (preview av top elements + visual weight + repeated controls), `PageAuditDetails` (head/structure sammanfattning), event-line-rendering, Activity-tab. Allt är fortfarande användbart i Activity-fliken som "raw debug".

## 6. Mindre putsning

- I `engine.server.ts`: ersätt `within(t.rect as { x:y:w:h })`-cast med korrekt typad helper (TrustSignal.rect är redan typad som `{x,y,w,h} | undefined`).
- Ta bort kvarvarande `flags`-mentions i logmeddelandet på rad ~734 (visar alltid `0 flag(s)`).

# Vad som INTE ändras

- Inga DOM-script ändras (samma data samlas in).
- Schema oförändrat — bara flyttat till en fil.
- Findings-fliken ser likadan ut.
- Scroll-warm-up, screenshot-flöde, overlay-ritning, Stagehand keepAlive: oförändrat.
- Inga nya beroenden.
- Inga server-fn-signaturer ändras.

# Förväntat resultat

- `pageAudit` ~1–2s snabbare.
- `engine.server.ts` 2228 → ~600 rader.
- `findings.ts` ~540 → ~360 rader (ingen typduplicering).
- `ConsolePanel.tsx` ~457 → ~300 rader.
- En källa för alla publika typer → mindre risk för drift när Interpret-lagret byggs nästa.
