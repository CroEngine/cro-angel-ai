# Kör B2b Rev3

Rev3-koden är implementerad. Det här är körnings- och tolkningssteget.

## Steg

1. **Kör unit-testerna**
   - `bunx vitest run src/lib/tests/snapshot/__tests__/fetch-records.test.ts`
   - Förväntat: 8/8 gröna. Om något fallerar → stopp, fixa innan smoke.

2. **Kör hela snapshot-test-sviten** (regressionscheck)
   - `bunx vitest run src/lib/tests/snapshot`
   - Förväntat: 20/20 (12 gamla + 8 nya). Pre-existing Chromium-fel i `hubspot`-snapshotet ignoreras om det är samma som tidigare.

3. **Kör breadth-smoke**
   - `bun run scripts/breadth-smoke.ts`
   - Skriver per site: `font-fetch-records.json`, `control-probes.json`, ev. `B2b-*.md`.

4. **Läs control-probes först** (innan någon fetcher-tolkning)
   - `positive.outcome !== "ok"` → `blocked_hard` → skriv `B2b-environment-block.md`, stopp.
   - `negative.outcome === "env_blocked"` → `ok_block_validated` → fortsätt till steg 5.
   - `negative.outcome ∈ {ok, http_error}` → `ok_open_egress` → fortsätt till steg 5 (ingen block existerar; alla `network_error` är äkta).
   - `negative.outcome ∈ {network_error, timeout}` → `blocked_detector_inert` → skriv `B2b-detector-inert.md`, stopp.

5. **Tolka fetch-records** (endast om steg 4 säger fortsätt)
   - Per host: räkna `env_blocked` / `attempted`. Hosts med 100% env_blocked → exkludera från fetcher-tolkning.
   - Resterande hosts: rapportera `ok/http_error/empty_body/network_error/timeout` i tre baser `A/attempted`, `A/uniq`, `A/occ`.
   - Completeness-assert verifieras automatiskt (kastar annars).

6. **Sammanfatta utfall till användaren**
   - Probe-utfall + guard-beslut.
   - Per-host env_blocked-karta.
   - Outcome-fördelning för icke-blockade hosts.
   - Rekommendation: är B2 en produktbugg (äkta `http_error`/`empty_body`/`network_error` mot öppna hosts) eller miljöartefakt (allt `env_blocked` eller detector-inert)?

## Inga kodändringar

Endast körning + tolkning. Om steg 1–2 visar regressioner fixas de innan smoke körs.
