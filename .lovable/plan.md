# Slutför datafrysningen (v2 — med hård consent-assertion)

## Avstämning mot disk

| Bit | Status |
|---|---|
| MHTML-capture, replay, normalize | ✓ klart |
| Consent-**mekanism** i `freeze.server.ts` | ✓ finns redan (rad 80–95) |
| `scripts/freeze-site.ts` | ✓ finns |
| Hubspot frystes med `consentSelector: null` → banner infrusen | ✗ rot till "Accept All"/"Decline All" i golden |
| SSOT för selektorer per site | ✗ saknas |
| Hård fail om consent inte tog | ✗ saknas (tyst try/catch) |
| Git LFS för `corpus/` | ✗ inte uppsatt |
| 6/8 siter ofrysta | deferrade till separat runda |

Rot: två felvägar — (a) glömd selektor, (b) selektor satt men klicket träffar inte. `sites.ts` stänger (a). Hård post-klick-assertion stänger (b). Båda krävs.

## Steg

### 1. `corpus/sites.ts` — SSOT

```ts
export interface SiteSpec {
  name: string;
  url: string;
  consentSelector?: string;
  consentDismissCheck?: "detached" | "hidden"; // hur vi verifierar att klicket tog
  consentInstruction?: string; // Stagehand-fallback
  notes?: string;
}

// Policy: Accept All på alla siter. Inte för att det är "realistiskt" — utan
// för att blanda Accept/Decline över corpusen inför en icke-jämförbar axel
// i goldens. Konsistens > realism. hibob är redan Accept.
export const SITES: SiteSpec[] = [
  { name: "hibob", url: "https://www.hibob.com",
    consentSelector: "#onetrust-accept-btn-handler",
    consentDismissCheck: "detached" },
  { name: "hubspot", url: "https://www.hubspot.com/",
    consentSelector: "#hs-eu-confirmation-button",
    consentDismissCheck: "detached", // verifieras i steg 2; byt till "hidden" om HubSpot bara döljer
    notes: "HubSpot's hs-eu-cookie-confirmation, inte OneTrust" },
  // 6 andra siter: separat runda
];
```

`scripts/freeze-site.ts` slår upp i `SITES` via `--name`. CLI-flaggor blir override, inte enda källa.

### 2. Hårdna `freeze.server.ts` — assertera att bannern är borta

Idag (rad 81–87): klicket är inlindat i tyst try/catch. Det betyder att en stale selektor, A/B-variant eller sent-laddad banner ger `consentSelector: "..."` i meta.json medan bannern fortfarande är frusen i MHTML:en. Falskt självförtroende — exakt buggen vi vill stänga systemiskt.

Ändring:

```ts
if (opts.consentSelector) {
  await page.locator(opts.consentSelector).click(); // INGEN try/catch — vill veta om den misslyckas
  await page
    .waitForSelector(opts.consentSelector, {
      state: opts.consentDismissCheck ?? "detached",
      timeout: 5000,
    })
    .catch(() => {
      throw new Error(
        `[freeze] consent kvar efter klick: ${opts.name} — capture avbruten`,
      );
    });
  await new Promise((r) => setTimeout(r, 800));
}
```

Beteende: ingen MHTML, ingen screenshot, ingen golden skrivs om bannern står kvar. Vi cementerar inget brus tyst.

Konsekvens för Stagehand-fallback: samma assertion krävs där också. Annars är `consentInstruction` ett bakdörrshål till exakt samma bugg.

### 3. Re-freeze hubspot

```bash
bun run scripts/freeze-site.ts --name=hubspot
```

Vid första försöket: om assertion throwar med `state: "detached"` → HubSpot döljer istället för att ta bort. Byt `consentDismissCheck` till `"hidden"` i `sites.ts` och kör om. Beslutet dokumenteras i `sites.ts`, inte i runbook-minne.

### 4. Verifiering (pålitliga signaler, inte rg mot MHTML)

`rg` mot rå `page.mhtml` är opålitlig — MHTML är quoted-printable, så `hs-eu-cookie-confirmation` kan bli `hs-eu-cookie-confirmati=\nontion` och teckenkodning gör att `=3D` ersätter `=`. 0 träffar bevisar ingenting.

Pålitliga checks efter re-freeze:
1. `jq '.consentSelector' corpus/hubspot/meta.json` ≠ null
2. Freeze körde grönt → assertion bekräftar att banner är borta i live-DOM före capture
3. `SNAPSHOT_UPDATE=1` på snapshot-testet, sen:
   ```bash
   jq '.collect.elements[].text' corpus/hubspot/golden.json | rg -i "accept all|decline all|reject all"
   ```
   Måste ge 0 träffar. Detta är checken som faktiskt mäter det vi bryr oss om: vad collectorn såg, inte vad som finns i den kodade filen.
4. `jq '.pageAudit.ctaSummary.total' corpus/hubspot/golden.json` — sjunker från 15. Hur mycket är inte en gate (se nedan).

### 5. Determinism — 5 körningar på re-frysta hubspot

Återanvänd loopen från förra runbooken. Måste vara 5/5 innan vidare. Behåll samma diff-mot-körning-1-pattern — golden kan vara outliern.

### 6. Git LFS

```bash
git lfs install
cat >> .gitattributes <<'EOF'
corpus/**/page.mhtml filter=lfs diff=lfs merge=lfs -text
corpus/**/screenshot.jpg filter=lfs diff=lfs merge=lfs -text
EOF
```

`golden.json` + `meta.json` utanför LFS (små, ska diffas i PR).

**Villkorad:** om `corpus/hibob/` eller `corpus/hubspot/` redan är committade som vanliga blobbar, flyttar `.gitattributes` dem inte retroaktivt. Då krävs:
```bash
git lfs migrate import --include="corpus/**/page.mhtml,corpus/**/screenshot.jpg"
```
Kolla först: `git log -- corpus/hibob/page.mhtml`. Tom output → aldrig committat → migrate är no-op och kan hoppas.

### 7. Commit baseline

hibob + hubspot till LFS som första infrysta corpus. De 6 andra siterna är **separat runda** — varje site kan ha sin egen consent-quirk (`detached` vs `hidden`, eller en banner som behöver scroll först), och vi vill inte upptäcka det efter commit.

## Vad denna plan inte gör

- Lägger inte till nya siter.
- Rör inte normalize.ts eller replay-pipelinen.
- Kör inte artifacts-exporten (väntar tills commit).

## Decision points

- **`detached` vs `hidden` för hubspot:** vet vi inte än. Plan: starta med `detached`, byt till `hidden` om freeze throwar. Inte värt att kolla manuellt i förväg.
- **Om freeze-assertion fortsätter throw efter `hidden`-byte:** stoppa, debugga selektorn (kanske HubSpot bytt till nytt ID). Fixa i `sites.ts`, inte i `freeze.server.ts`.
- **Drift i `collect.count`:** ingen hård tröskel — banner-borttagning sänker count i sig (container + 2–3 knappar + paragraftext kan vara 10+ element). Granska diffen mot baseline manuellt: är minskningen i `text` som matchar "cookie/consent/accept" → väntat. Andra fält → utred.
