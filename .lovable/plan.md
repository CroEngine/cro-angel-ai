## Verifierat
- `/bin/chromium` → Chromium 146.0.7680.80 (Nix-store). Ingen `bunx playwright install` behövs.
- `~/.cache/ms-playwright/` saknas (förväntat — vi använder system-binären istället).
- Korpora finns i `/tmp/corpus-breadth/` (stripe, intercom, vercel) från tidigare freeze.

## Plan

1. **Ad-hoc replay-runner** `/tmp/replay-runner.ts` (skapas, körs, raderas — ingen commit):
   - Sätter `process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "/bin/chromium"` innan import av harness.
   - Loopar `replayCorpus(name, "/tmp/corpus-breadth")` för stripe/intercom/vercel.
   - För varje site läser:
     - `render-canary.families.json` → `gate1Registered/Total`, `classification`, per-family `registered`-flagga.
     - `freeze-report.json` → `capture.fontUrls[]`.

2. **Hink-attribution per miss**:
   - För varje family där `registered === false`, korsreferera mot `capture.fontUrls`:
     - URL embeddad i MHTML (cid: finns) men binder inte → **hink 3** (replay/descriptor).
     - URL saknas helt i `fontUrls` → **hink 4** (harvest-hål).
   - Skriver ut tabell per site: `Gate1 X/Y | classification | miss → family (hink N, url)`.

3. **Avbryter och rapporterar om**:
   - `/bin/chromium` ger launch-fel (t.ex. saknade .so-libs i Nix-sandbox).
   - `replayCorpus` saknar export eller kastar annat fel.
   - I så fall: ingen retry, rå felutskrift, stannar.

## Tekniska detaljer
- Inga filer i repo ändras. Inga npm-installer. Ingen Browserbase-session.
- Runner använder repo-källan direkt (`import { replayCorpus } from "@/..."` via bun) — kräver att `replayCorpus` är exporterad. Verifieras innan körning.
- Output: ren text i chatten + ev. `/tmp/replay-out.json` om utskriften blir lång.

## Acceptanskriterium
Tabell tillbaka per site med Gate1, classification och per-miss hink-attribution (3 vs 4). Inga skrivningar i repo.