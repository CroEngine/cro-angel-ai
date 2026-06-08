## Problem
`.github/workflows/update-snapshot.yml` försöker köra snapshot-regenereringen utan att först installera Playwrights Chromium-binär. Resultat: `browserType.launch: Executable doesn't exist`. CI-workflowen har redan rätt steg — Update snapshot-workflowen saknar det bara.

## Fix
Lägg till ett steg i `.github/workflows/update-snapshot.yml` efter `bun install` och före `Regenerate snapshot`:

```yaml
- name: Install Playwright Chromium
  run: bunx playwright install chromium
```

Det är allt. Ingen annan ändring behövs.

## Vad du gör efter att jag implementerat
1. Gå till **Actions → Update snapshot → Run workflow → main**.
2. Vänta ~1–2 min.
3. Om grön ✅: en ny commit från `github-actions[bot]` uppdaterar `corpus/hubspot/golden.json`, och nästa CI-körning blir grön.
4. Om röd ❌: klistra in loggen så fixar vi nästa sak.
