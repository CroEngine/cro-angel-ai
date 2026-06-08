## Mål
Lägga till en GitHub Actions-workflow i `cro-angel-ai`-repot som uppdaterar `corpus/hubspot/golden.json` på knapptryck och committar tillbaka. Inget lokalt bun/Node krävs efter setup.

## Hur det fungerar
1. Du går till **Actions**-fliken i GitHub
2. Väljer workflow **"Update snapshot"**
3. Klickar **Run workflow** → välj branch (`main` eller en feature-branch)
4. Jobbet kör `SNAPSHOT_UPDATE=1 bun run snapshot`, committar ändringen och pushar tillbaka
5. CI-jobbet `Frostade hubspot MHTML` blir grönt på nästa körning

## Engångs-setup (du gör i GitHub-webben)

**Steg 1.** Gå till `cro-angel-ai`-repot på github.com
**Steg 2.** Klicka **Add file → Create new file**
**Steg 3.** Skriv som filnamn: `.github/workflows/update-snapshot.yml`
**Steg 4.** Klistra in följande innehåll:

```yaml
name: Update snapshot

on:
  workflow_dispatch:
    inputs:
      message:
        description: "Commit message"
        required: false
        default: "chore: update hubspot snapshot"

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install --frozen-lockfile

      - name: Regenerate snapshot
        run: SNAPSHOT_UPDATE=1 bun run snapshot

      - name: Commit & push if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if [[ -n "$(git status --porcelain)" ]]; then
            git add -A
            git commit -m "${{ inputs.message }}"
            git push
          else
            echo "No snapshot changes."
          fi
```

**Steg 5.** Scrolla ner, klicka **Commit new file** direkt på `main`.

## Verifiera att det funkar

1. Gå till **Actions**-fliken
2. I vänsterspalten ska **Update snapshot** nu finnas
3. Klicka på den → **Run workflow** (grön knapp till höger) → välj branch → **Run workflow**
4. Vänta ~1 minut, refresha
5. Om snapshot ändrats: en ny commit från `github-actions[bot]` dyker upp på branchen
6. Det ursprungliga CI-jobbet `Frostade hubspot MHTML` ska nu vara grönt

## Om `Run workflow`-knappen är gråad ut
Settings → Actions → General → "Workflow permissions" → välj **Read and write permissions** → Save.

## Tekniska detaljer
- `workflow_dispatch` = manuell trigger via knapp
- `permissions: contents: write` + default `GITHUB_TOKEN` räcker för att pusha till samma repo (inga PATs behövs)
- `oven-sh/setup-bun@v2` installerar bun i runnern
- `--frozen-lockfile` säkerställer samma deps som CI använder
- Om du vill att den ska köra automatiskt vid varje PR istället, lägg till `pull_request:` triggers — säg till så uppdaterar jag

## Begränsning
Den här Lovable-projektets repo är **inte** `cro-angel-ai`, så jag kan inte committa filen åt dig härifrån. Du måste skapa den manuellt i GitHub-webben enligt steg 1–5 ovan. Det är ett 2-minutersjobb.
