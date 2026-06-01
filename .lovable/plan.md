Höj tidsgränserna till 15 minuter så användaren hinner se sessionen i lugn och ro.

1. `src/lib/tests/run.functions.ts` — ändra `HOLD_MS = 60_000` → `HOLD_MS = 15 * 60_000` (15 min). Uppdatera log-strängen.
2. `src/lib/tests/browserbase.server.ts` — höj `timeout: 300` → `timeout: 16 * 60` (16 min, lite marginal över hold-fönstret så BB inte timeoutar precis när vi själva avslutar).

Close-knappen och Run again-overlayen fungerar redan — användaren kan alltid avsluta tidigare.