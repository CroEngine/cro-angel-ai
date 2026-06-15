# Dev Container — Part A acceptance

Den här devcontainern finns för att köra render-canary mot corpus i en miljö
där Playwright/Chromium fungerar out-of-the-box. Lovable-sandboxen kan inte
köra `playwright install-deps` (ingen root/apt), men en GitHub Codespace
byggd från den här configen kan.

## Använd

1. På GitHub: **Code → Codespaces → Create codespace on main**.
2. När containern är klar (`bun install` körs automatiskt via
   `postCreateCommand`):

   ```bash
   bun run scripts/render-canary.ts --all
   ```

3. Klistra in stdout + `corpus/<site>/render-canary.families.json` tillbaka
   i Lovable-chatten för triage per `gate1.reason`.

## Notes

- Bas-image: `mcr.microsoft.com/playwright:v1.60.0-jammy` — matchar
  `playwright` 1.60.0 i `devDependencies`. Chromium och alla
  systemberoenden (libatk, libnss, libxkbcommon m.fl.) är förinstallerade.
- **Kör inte** `npx playwright install` i containern — det laddar bara om en
  browser som redan finns i image:t.
- Bun installeras via devcontainer-feature, så `bun`/`bunx` finns i PATH.
- Port 3000 forwardas om du vill köra `bun run dev` i Codespacen.
