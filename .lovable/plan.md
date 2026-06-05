## Mål
Kör `freeze-visibility.test.ts` + `bun run typecheck` automatiskt i GitHub Actions varje gång Lovable pushar en ändring. Du ser grön/röd bock direkt på github.com — ingen terminal någonsin igen.

## Förutsättning (engångsgrej, gör du själv)
1. I Lovable: **+** (nere vänster i chatten) → **GitHub** → **Connect project** → välj `Kortifyio/cro-angel-ai` (eller skapa nytt repo om det inte är kopplat än).
2. Säg till när det är klart — utan koppling kan workflow-filen jag skapar inte köra.

## Vad jag bygger

**Ny fil:** `.github/workflows/ci.yml`

Workflow:
- Triggar på `push` till alla branches + `pull_request`
- Kör på `ubuntu-latest` (har redan alla Playwright-sysdeps förinstallerade — slipper `--with-deps`-strulet du sett)
- Steg:
  1. Checkout
  2. Setup Bun
  3. `bun install --frozen-lockfile`
  4. `bunx playwright install chromium` (utan `--with-deps` — Ubuntu-imagen har dem)
  5. `bun run typecheck`
  6. `bunx vitest run src/lib/tests/snapshot/__tests__/freeze-visibility.test.ts`

Inga secrets behövs — testet använder lokal Playwright-Chromium, inte Browserbase. `freeze.server.ts` importeras bara för konstanten `POST_DISMISS_HITS_FN`, ingen nätverkstrafik.

## Vad du gör efter att jag pushat workflow-filen
- Gå till `github.com/Kortifyio/cro-angel-ai/actions` → se körningarna live
- Grön bock = allt funkar. Röd = klicka in, se loggen, klistra in felet här så fixar vi.

## Vad som INTE ingår (och varför)
- **Inga Browserbase-secrets** — `freeze-visibility.test.ts` behöver dem inte. Om du senare vill köra själva `freezeSite()` i CI behöver vi lägga till `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` som GitHub repo secrets, men det är en separat fråga.
- **Ingen full vitest-svit** — bara det specifika testet vi pratat om. Lätt att utöka till `bunx vitest run` senare om du vill ha all-in.
- **Ingen deploy/publish-trigger** — det här är bara test-CI, påverkar inte Lovables egen deploy.

## När du godkänner planen
Jag skriftar workflow-filen. Sen, så fort GitHub-kopplingen finns och Lovable pushar, kör CI:n automatiskt på första commiten.
