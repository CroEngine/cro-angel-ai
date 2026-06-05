# Freeze-receipt + dry-run + before-screenshot

## Scope

Lägg till per-freeze auditerbar receipt + två debug-flaggor. Rör bara `freeze.server.ts` och `scripts/freeze-site.ts`. Inga deps, ingen viewer, ingen replay-påverkan.

## 1. `corpus/<name>/freeze-report.json` — alltid skriven

Mätt löpande in i ett `report`-objekt, **flushad i `finally`** så receiptet finns även när hard-gaten throwar. Detta är fixen för den blinda felmoden: stale selektor → assertion throw → utan finally får du ingen rapport och kan inte se att `matchCountBeforeClick` var 0.

```jsonc
{
  "ok": true,                      // false om assertion throwade
  "error": null,                   // felmeddelande om ok=false
  "consent": {
    "selector": "#hs-eu-confirmation-button",
    "matchCountBeforeClick": 1,    // mätt EFTER waitForSelector(visible), inte vid rå load
    "visibleBeforeClick": true,
    "dismissCheck": "detached",
    "dismissedAfterMs": 412,       // null om assertion throwade
    "postDismissDomHits": {        // mätt via in-page evaluate, synlig text, lowercase
      "accept all": 0,
      "decline all": 0,
      "reject all": 0,
      "cookie": 3                  // OBSERVATION-only — footer-policy-länkar är legitima
    }
  },
  "capture": {
    "mhtmlKb": 2840,
    "screenshotKb": 312
  },
  "timing": { "gotoMs": 4210, "consentMs": 1320, "scrollMs": 3800, "captureMs": 890 }
}
```

### Två mätnings-detaljer som avgör om receiptet förutsäger golden

**a. `postDismissDomHits` mäts som collectorn mäter — synlig text, inte rå `page.content()`.**

Substring mot `content()` har båda felriktningarna:
- Banner med `display:none` ligger kvar i HTML → falskt >0
- Banner i shadow DOM eller iframe → osynlig i `content()` → falskt 0

Lösning: in-page `evaluate` som plockar synlig text via samma synlighetslogik collectorn använder (lånas från `COLLECT_SCRIPT` eller spegelimplementation: bbox > 0, computed `visibility !== hidden`, `display !== none`, opacity > 0, traversar `shadowRoot`). Haystack lowercase:as innan substring-match — `content()` bevarar "Accept All" men nycklarna är gemener.

**b. `matchCountBeforeClick` mäts efter settle, inte vid rå load.**

Consent-banners injiceras ofta async (OneTrust laddas via tagghanterare flera sekunder efter `load`). Mätning vid rå load ger spöke-nollor och feltolkas som "stale selektor". Mät efter samma `waitForSelector(state: "visible", timeout: 5000)` vi redan gör före klicket. Om den waiten i sig timear ut → då vet vi det är stale selektor (eller banner laddade aldrig), och det loggas explicit i `error`.

### Struktur

```ts
const report: FreezeReport = {
  ok: false, error: null,
  consent: { selector: opts.consentSelector ?? null, /* ... defaults */ },
  capture: { mhtmlKb: 0, screenshotKb: 0 },
  timing: { gotoMs: 0, consentMs: 0, scrollMs: 0, captureMs: 0 },
};
try {
  // goto → mät gotoMs
  // waitForSelector(visible) → mät matchCountBeforeClick, visibleBeforeClick
  // click → waitForSelector(detached|hidden) → mät dismissedAfterMs
  // in-page evaluate för postDismissDomHits
  // scroll → mät scrollMs
  // captureSnapshot + screenshot + meta → mät captureMs, mhtmlKb, screenshotKb
  report.ok = true;
} catch (e) {
  report.error = e instanceof Error ? e.message : String(e);
  throw e;
} finally {
  writeFileSync(join(dir, "freeze-report.json"), JSON.stringify(report, null, 2));
}
```

Receipt skrivs alltid. Throw bubblar upp efteråt. CLI catch:en visar felet som idag.

## 2. `--dry-run` (på `scripts/freeze-site.ts`)

Kör hela pipelinen utom de fyra `writeFileSync` som rör `corpus/` (`page.mhtml`, `screenshot.jpg`, `meta.json`, `freeze-report.json`). Skriv istället bara `freeze-report.json` till `/tmp/freeze-<name>-<ts>.json` och printa sökvägen.

Användbart för 6-site-utrullningen: hitta rätt selektor + `detached`-vs-`hidden`-val utan att röra `corpus/`. Default off.

Implementation: passa `dryRun: boolean` ner i `FreezeOptions`. Gate de fyra write-anropen. Receipten skrivs alltid (samma `finally`), bara annan path i dry-run.

## 3. `--screenshot-before-dismiss`

Extra screenshot **före** consent-klicket, sparad som `corpus/<name>/screenshot.before-dismiss.jpg` (eller `/tmp/...` i dry-run). Visuell bekräftelse att bannern verkligen fanns vid frystidpunkten — annars är "matchCountBeforeClick=1, visibleBeforeClick=true" bara siffror.

Default off, opt-in per körning. Inte tänkt att committas till `corpus/` — lägg till i `.gitignore` så den inte slinker in i baseline-committen.

## Vad denna plan inte gör

- Ingen viewer-UI. `cat freeze-report.json | jq` räcker.
- Inga hårda gates på `postDismissDomHits` — bara observation. När vi har baseline från 3–4 siter kan vi promovera till gate, men då bara på `"accept all"`/`"decline all"`/`"reject all"`. **Aldrig** `"cookie"` — den matchar legitima footer-policy-länkar och skulle blockera giltiga frysningar.
- Ingen ändring i `meta.json`-formatet (snapshot-testet läser det, vi vill inte röra kontraktet).
- Hjälper inte replay-debug. Separat problem, replay funkar 5/5.

## Beslutspunkter

- **Var bor synlighets-helpern för `postDismissDomHits`?** Två alternativ: (a) liten lokal in-page evaluate i `freeze.server.ts` som speglar collectorns regler (duplicering, men isolerar freeze från collector-refactors), (b) importera och återanvänd `COLLECT_SCRIPT`-helpern direkt (DRY, men kopplar freeze till collectorns interna API). Förslag **(a)** — receiptet ska vara stabilt även om collectorn refactoras, och reglerna är 4–5 rader.
- **Throwar dry-run på consent-fail?** Förslag **ja, samma som riktig freeze.** Annars förlorar dry-run sitt värde som "selektor-prober" — vi vill se det röda felet, inte en grön körning med tom rapport.
