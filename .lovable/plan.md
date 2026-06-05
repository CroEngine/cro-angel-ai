## Diagnos vi accepterar

Asymmetrin (COLLECT lyckas, scroll dör) förklaras av evaluate-livslängd, inte två separata buggar. Den långlivade async-IIFE:n i `runPageAudit` ligger pending när MHTML:ens fördröjda commit förstör execution-contexten.

Hårdnad insikt: bara Node-loop-scroll räcker inte. Den skyddar scrollen men flyttar COLLECT senare i tiden — rakt in i samma fönster (~1.5–4s) där commiten slår. Om commiten är dokument-ersättande nollställs scroll-position + `data-lovable-cookie-root`-stämpeln, och tysta try/catch-svalg ger flaky diff.

Lösning: en **context-stabilitets-gate** före allt sidpåverkande. Gaten kräver att `page.evaluate(() => location.href)` lyckas N gånger i rad med stabil URL innan vi scrollar, stämplar eller kör COLLECT.

## Ändringar

### 1. `src/lib/tests/runners/pageAudit.server.ts`
- Lägg till `runPageAudit(page, opts?: { skipScrollWarmup?: boolean; skipCookiePoll?: boolean })`.
- När flaggorna är satta hoppas respektive in-page-IIFE över. Default oförändrat — engine.server.ts rör vi inte.

### 2. `src/lib/tests/snapshot/harness.server.ts`

Ny ordning efter `goto` + `waitForReady`:

```text
URL-stabilization (befintlig)
  ↓
waitForStableContext()   ← NY: evaluate måste överleva N=2 ggr i rad
  ↓
Node-loop scroll
  ↓
Node-loop cookie-root-stämpling
  ↓
runPageAudit(page, { skipScrollWarmup: true, skipCookiePoll: true })
```

**`waitForStableContext`** (ny helper i harnessen):
- Loop tries=20, gap=150ms, kräver streak=2 av samma `location.href` där `evaluate` inte kastat.
- Vid kastat fel (context destroyed): nollställ streak och fortsätt poll.
- Kastar om kontexten aldrig stabiliseras — då vill vi inte fortsätta, då är MHTML:en trasig.

**Scroll** (efter gate):
- Läs `scrollHeight` **direkt före** varje steg, inte en gång uppifrån — lazy-load via IntersectionObserver kan expandera dokumentet under loopen.
- 8 steg, **150ms paus** mellan steg (inte 80ms — diff-stabilitet vinner över hastighet).
- Varje `page.evaluate(...scrollTo...)` är trivialt kort. Wrappas i try/catch + en `waitForStableContext`-runda vid fel, så att vi inte sväljer ett tappat steg utan rekonvalescens.
- Sluttsteg: scrolla till botten, paus 600ms, tillbaka till topp, paus 200ms — separata Node-steg.

**Cookie-root-stämpling** (efter gate, efter scroll):
- Loop upp till ~2.5s, korta `page.evaluate`-anrop som letar selektorn och sätter `data-lovable-cookie-root` på outer container. Ingen långlivad in-page IIFE.

**Diagnostik kvar**: `framenavigated`-listener + `console.log(page.url(), seenUrls)` — om commit ändå sker syns det utan att testet kraschar.

### 3. Ingen ändring i `engine.server.ts` eller `freeze.server.ts`.

### 4. `waitForLoadState('networkidle')` används inte (file:// → resolvar tomt).

## Verifiering

1. `bun run snapshot` på hibob → ska gå igenom utan "Execution context was destroyed".
2. Loggen visar `url=file://...` + tom/stabil `seenUrls`. Faktisk commit ⇒ separat åtgärd, inte denna PR.
3. **Determinism**: kör snapshot 3× i rad utan `SNAPSHOT_UPDATE`. Tom diff varje gång. Diff mellan körningar = scroll/stamp inte deterministisk → öka gap eller streak.

## Vad denna PR inte gör

- Ingen single-file-HTML-fallback.
- Inga ändringar i `freeze.server.ts`, `classifiers.ts`, CI eller live engine-flödet.
