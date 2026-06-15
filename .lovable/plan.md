# Plan: Kör Part A i GitHub Codespaces

Codespaces ersätter den "dev-maskin" som Part A:s hand-off-kommando kräver. Sandboxen kan inte köra `playwright install-deps` (ingen root/apt), men en Codespace-container kan — den har sudo och full Ubuntu-bas. Part B påverkas inte; SSE-reproduktionen sker fortsatt mot workerd-previewen.

## Förutsättning: koppla till GitHub

Projektet är på `tanstack_start_ts_2026-05-29`-mallen och har CI-workflows (`ci.yml`, `update-snapshot.yml`) men ingen synlig GitHub-remote-koppling från Lovable-sidan. Du kopplar via Plus-menyn (+) i chatten → **GitHub** → **Connect project** → välj konto/org → **Create Repository**. Efter det får repot Lovables två-vägs-sync, och Codespaces-knappen blir tillgänglig på GitHub-sidan (Code → Codespaces → Create codespace on main).

Inga code-ändringar i detta steg, bara integration.

## Steg 1 — Ad-hoc-körning (omedelbar, inget incheckat)

När repot finns på GitHub: öppna en Codespace på `main` och kör, i terminalen i Codespacen:

```bash
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun install
npx playwright install --with-deps chromium
bun run scripts/render-canary.ts --all
```

Förväntade artefakter:
- stdout med per-site / per-family rader
- `corpus/<site>/render-canary.families.json` per körd corpus-site (`hibob`, `hubspot`)

Klistra in stdout + receipts hit för Part A:s triage enligt v3-planen (`gate1.reason` → en av `ok` / `metric_twin` / `fallback` / `check_mismatch` / `unresolved` / `timeout`). A1, A2, A3 utförs sedan här i Lovable, inte i Codespacen.

Inga incheckade filändringar i detta steg.

## Steg 2 — Incheckad `.devcontainer/` (reproducerbar)

Skapa två filer så att framtida Codespaces (och alla i teamet) får en redo-att-köra miljö utan manuella installationssteg.

### `.devcontainer/devcontainer.json`

- Bas: `mcr.microsoft.com/playwright:v1.60.0-jammy` (matchar `playwright` 1.60.0 i `devDependencies`; ger Chromium + alla systemberoenden förinstallerade, ingen `install-deps` behövs).
- Feature: `ghcr.io/shyim/devcontainers-features/bun:0` för Bun.
- `postCreateCommand`: `bun install`
- `forwardPorts`: `[3000]` för Lovable-previewen om man vill öppna `bun run dev` i Codespacen.
- VS Code-extensions: `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `biomejs.biome` (valfritt — låt vara om teamet inte använder dem).

### `.devcontainer/README.md` (kort)

En paragraf som dokumenterar enstegsflödet efter Create codespace:

```
bun run scripts/render-canary.ts --all
```

…och påminner om att Chromium redan finns i image:t, så `playwright install` inte ska köras (det skulle ladda om browsern i onödan).

### Vad som inte ändras

- Inga app- eller server-filer rörs.
- `canary-constants.ts` förblir orörd (samma princip som v3-planen).
- `scripts/render-canary.ts` förblir orörd — devcontainern är bara en miljö-wrapper.
- `package.json` förblir orörd; ingen ny `scripts`-post behövs eftersom hand-off-kommandot redan är ett enradigt `bun run`.

## Steg 3 — Uppdatera `.lovable/plan.md`

Lägg till en kort sektion under Part A som dokumenterar hand-off-vägen: "Part A acceptance körs i GitHub Codespaces (devcontainer förinstallerar Chromium via Playwright-image). Sandboxen kan inte köra `playwright install-deps`; Codespaces kan. Part B opåverkad."

Inga andra ändringar i plan.md.

## Vad detta inte gör (medvetet)

- **Löser inte Part B.** Codespaces är en Node/Linux-miljö, inte workerd. Cancel-reason-strängen måste fortfarande fångas från Lovable-previewen eller `wrangler dev`. Part B förblir read-only-utredning tills den strängen finns.
- **Lägger inte till CI-jobb** för render-canary. Acceptance är manuell/triage-driven enligt v3; om vi senare vill köra den i GitHub Actions blir det en separat ändring (workflow + secret för corpus-källor om relevant).
- **Ändrar inte Worker-runtime, SSE eller subset-algoritm.** Allt utanför Part A scope.

## Sekvensering

1. Du kopplar GitHub via Plus-menyn (manuellt steg i Lovable UI:t).
2. Jag skriver in `.devcontainer/devcontainer.json` + README och uppdaterar `.lovable/plan.md` (en commit, bisectable).
3. Du öppnar Codespace på `main` och kör hand-off-kommandot. (Eller, om du vill komma igång direkt: kör ad-hoc-flödet från Steg 1 innan devcontainern landat — det fungerar parallellt.)
4. Klistra in stdout + `render-canary.families.json` hit; jag kör triage per `gate1.reason`.

Två separata commits hålls åtskilda: Part A devcontainer (det här) och eventuell Part B SSE-fix (senare, signaturdriven).
