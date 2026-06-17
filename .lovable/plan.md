## Mål

Köra hela kedjan — typecheck → freeze-visibility → render-canary → snapshot-diff — och bekräfta att ghost-disambiguatorn klassar HubSpots "Lexend Deca" som **ghost**, inte **failure**.

## Steg

1. **YAML-sanity på `.github/workflows/ci.yml`** — parse:a med `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` så GitHub inte avvisar workflowen vid push.

2. **Typecheck** — `bun run typecheck`. Säkerställer att inga edits från tidigare turn brutit typerna i `harness.server.ts` / `render-canary.server.ts` / receipt-modulen.

3. **Försök köra canary lokalt i sandbox** — `bunx vitest run src/lib/tests/snapshot/__tests__/render-canary.test.ts`.  
   Förväntat utfall: tests **skippas** (sandboxen saknar Chromium-deps). Det är ok — vi vill bara verifiera att testfilen laddas, vitest-konfigen är intakt, och att skip-grenen triggar istället för en module-load-crash. Om något skip:as för fel orsak (t.ex. import error) är det en riktig bug att fixa innan vi förlitar oss på CI.

4. **Snapshot-diff lokalt** — `bunx vitest run src/lib/tests/snapshot/__tests__/snapshot.test.ts`. Samma logik: skip förväntat, men vi vill ha bekräftelse att harness-modulerna importerar rent.

5. **Inspektera ev. färska artefakter** — om `corpus/hubspot/render-canary.families.json` finns från en tidigare körning, läsa den och bekräfta att "Lexend Deca" hamnar i `ghosts[]` snarare än `failures[]`. Om filen saknas: notera att sanningen kommer från första gröna CI-körningen efter push.

6. **Rapportera** — en kort sammanfattning av varje steg (PASS/SKIP/FAIL) + exakt vad du ska titta efter under Actions-fliken på GitHub efter nästa push:
   - "Run render-canary" → `[replay] canary ghosts (non-blocking): Lexend Deca`
   - "Run snapshot diff" → `[snapshot] hubspot: N off-flow suspects`
   - Artefakt `render-canary-artifacts` → diff:bar `families.json`

## Vad som INTE görs

- Ingen kod ändras. Det här är rena read-only verifierings-körningar.
- Ingen push, ingen commit — det sköter Lovables sync.
- Ingen Chromium-install i sandbox — det är CI:s jobb.
