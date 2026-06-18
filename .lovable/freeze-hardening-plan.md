# Freeze-härdning — plan (post-review 2026-06-18)

## Kontext

En end-to-end-genomgång av freeze-steget (`freeze.server.ts` + `scripts/freeze-*.ts`
+ `mhtml-fonts.server.ts` + `harness.server.ts`) hittade fyra luckor i ett
annars rigoröst system. Den tyngsta är **självförvållad och osynlig för den
nuvarande determinism-analysen**: A2-font-embeddern myntar slumpade `cid:`-tokens
per körning, vilket bryter capture-determinism (Grind 1, promotion-kriterium #3)
oberoende av bot-tarpit och animation som rapporten redan känner till.

Syftet med planen: röj undan de delar av RED-verdiktet som är *vår egen*
icke-determinism (inte sajtens), stäng en falskt-GRÖN-fälla i determinism-checken,
och gör font-embed-fel diagnostiserbart mot miljö-confound — så att Grind 1 mäter
det den påstår sig mäta innan Block B/C angriper de äkta site-drivarna.

## Beroendegraf

```text
   Oberoende, parallell-körbara:
   ┌─────────────────────────────────────────────────────────┐
   │ [F1] Deterministiska font-cids        (HÖG, kritisk #3)  │
   │ [F2] Empty-MHTML-guard i det.-check   (MEDEL, korrekthet)│
   │ [F3] Control-probes i freeze-pathen   (MEDEL, diagnostik)│
   └─────────────────────────────────────────────────────────┘
                          │
                          ▼
   [F4] Animation-frame källfix (LÅG) — eliminerar en av två
        kvarvarande RED-drivare vid källan. Görs efter F1 så
        Grind 1-signalen är ren när effekten mäts.
```

Ingen av F1–F3 är beroende av de andra. F4 vinner på att F1 är klar först
(annars är diff:en förorenad av cid-brus och animationseffekten svår att läsa).

---

## Block F1 — Deterministiska font-cids (HÖG, kritisk för Grind 1)

**Problem.** `embedMhtmlFonts` sätter cid via `randomUUID()`:

```ts
// src/lib/tests/snapshot/mhtml-fonts.server.ts:728
urlToCid.set(resolved, `font-${randomUUID().replace(/-/g, "").slice(0, 16)}@snapshot`);
```

`normalizeMhtml` maskar bara Chromiums native `@mhtml.blink`-cids
(`mhtml-normalize.ts:45`), inte `@snapshot`. Bevis: committad
`corpus/hubspot/page.mhtml` har **53 `cid:font-…@snapshot`-referenser**, alla
slumpade per freeze, ingen maskad. Varje determinism-par driftar därför på ≥53
rader (part-`Content-Location` + `url("cid:…")` i CSS). Senaste rapporten
tillskriver allt tarpit-kaskaden och missar detta.

Score-determinism (#4) påverkas **inte** — Chromium löser `cid:` internt vid
replay; extractorn läser computed styles, inte cid-strängar. Rent #3.

**Åtgärd.**
1. I `mhtml-fonts.server.ts`, byt cid-genereringen mot innehållsadressering:
   `font-${sha256Hex(resolved).slice(0, 16)}@snapshot`. `resolved` finns redan
   i harvest-loopen (`~723-731`) vid tilldelningstillfället, före fetch — ingen
   omstrukturering krävs. Återanvänd hash-hjälpen (`createHash("sha256")`, jfr
   `externalize.server.ts:66`).
2. Inget annat rörs: `urlToCid` är redan keyad på `resolved`, så rewrite-passet
   (`~821-839`) och append-passet (`~841-855`) fungerar oförändrat. Part-ordningen
   är insertion-order på `urlToBinary` = harvest-order = deterministisk.
3. **Ingen whitelist-rad behövs** — till skillnad från snabbalternativet (maska
   `@snapshot` i `normalizeMhtml`). Innehållsadresserade cids är stabila vid
   källan, vilket är strikt bättre: re-freeze ger minimal diff i stället för 53
   brusrader, och substrate-löftet "frozen DOM är deterministisk" hålls på
   *artefakt*-nivå, inte bara i checken.

**Notera.** Committad `corpus/hubspot/page.mhtml` behöver **inte** regenereras
för korrekthet — dess slumpade cids är score-neutrala och replay bryr sig inte.
Nästa naturliga re-freeze producerar stabila cids av sig själv.

**Verifiering.**
- Nytt enhetstest (network-fritt) som kör `embedMhtmlFonts` två gånger på
  `__fixtures__/synthetic-fonts.mhtml` och asserterar **byte-identisk** output
  (eller identiska `fontUrlsSeen`/cid-set). Lägg i
  `__tests__/harvest-font-urls.test.ts` eller ny `mhtml-fonts-determinism.test.ts`.
- `bun run snapshot` grönt.

**Exit:** Två `embedMhtmlFonts`-anrop på samma input ger identiska cids;
enhetstest pinnar det. (Full Grind 1-grönt kvarstår blockerat av tarpit/animation
— men cid-bruset är borta ur diff:en, vilket gör tarpit-kaskaden läsbar.)

---

## Block F2 — Empty-MHTML-guard i determinism-checken (MEDEL, korrekthet)

**Problem.** `freeze-determinism-check.ts:112-113` läser:

```ts
const mhtml = existsSync(mhtmlPath) ? readFileSync(mhtmlPath, "utf8") : "";
```

För siter vars post-embed MHTML > 9 MB skriver `freezeSite` en `.asset.json`-pekare
och **ingen** lokal `page.mhtml` (`freeze.server.ts:606-641`). Då blir `mhtml=""`
för alla N körningar → `"" === ""` → **falskt GRÖN på tom indata**. Latent idag
(bara hubspot 6.8 MB checkas) men smäller exakt när en stor site läggs till.

**Åtgärd.**
1. I `freezeOnce`, ersätt fil-närvaro-läsningen med pekare-medveten läsning som
   speglar `harness.server.ts:167-275`: om `freeze-report.json` har
   `capture.externalized === true`, läs `page.mhtml.asset.json`, `resolveAssetUrl`,
   fetcha + sha256-verifiera; annars läs lokal `page.mhtml`.
2. Hård guard: om varken lokal MHTML eller pekare finns → `throw` (inte tyst `""`).
   En tom-sträng-jämförelse får aldrig kunna producera GREEN.

**Verifiering.** Determinism-check på hubspot beter sig oförändrat (icke-externaliserad
väg). Manuell: peka `freezeOnce` på en syntetisk pekar-only-katalog → ska throw:a,
inte rapportera GREEN.

**Exit:** Determinism-checken kan inte längre rapportera GREEN på tom MHTML;
externaliserade siter läses via pekaren med sha256-verifiering.

---

## Block F3 — Control-probes i freeze-pathen (MEDEL, diagnostik)

**Problem.** `freeze.server.ts:573` anropar `embedMhtmlFonts(snap.data)` **utan**
`controlProbes`. En enda ofetchbar font → `externalFontSrcCount > 0` → A2-gaten
kastar (`:586`) → `failureClass: "font-embed-failed"`. I nätrestriktiv miljö
(proxy blockar font-CDN) faller *alla* freezes på detta, oskiljbart från äkta
site-fel, och breadth-50-raten kollapsar av miljöskäl. Probe-maskineriet finns
(`mhtml-fonts.server.ts:623-653`) men anropas aldrig.

**Åtgärd.**
1. Skicka `controlProbes: {}` (defaults: positiv gstatic-woff2, negativ
   example.com) till `embedMhtmlFonts` från `freezeSite`. Kör en gång per freeze
   (billigt; två HEAD-liknande GET).
2. Stoppa in `controlProbes`-utfallet i `freeze-report.json` (nytt fält under
   `capture`). Vid A2-gate-fel: om positiv probe också failar → miljön blockar
   font-egress, sub-klassa `failureClass` som `font-embed-env-blocked` i
   `classifyFailure` (`:246-279`) i stället för `font-embed-failed`.
3. `freeze-breadth.ts` läser det nya fältet så `byFailureClass` separerar
   miljö-confound från äkta site-fel.

**Verifiering.** `--dry-run`-freeze i nuvarande miljö: receipt innehåller
`controlProbes` med positiv/negativ-utfall. Om positiv = `env_blocked` ska
A2-felet klassas `font-embed-env-blocked`.

**Exit:** `font-embed-failed` går att skilja från `font-embed-env-blocked` i
freeze-report och breadth-summary; control-probe-utfallet är committat i receiptet.

---

## Block F4 — Animation-frame källfix (LÅG, valfri; gör efter F1)

**Problem.** `lazyScroll` (`freeze.server.ts:283-292`) med fasta `setTimeout`
samplar hero-`animated-list` vid godtycklig frame → `translateY(-Npx)` driftar
per freeze (`animation:mid-frame-transform`, en av två kvarvarande RED-drivare).
Rapportens rekommendation #4.

**Åtgärd (källfix, inte mask).** Före `captureSnapshot`: injicera
`prefers-reduced-motion: reduce` (CDP `Emulation.setEmulatedMedia`) **och/eller**
en `* { animation-play-state: paused !important; transition: none !important; }`-stil,
så CSS-animationer fryses i ett deterministiskt läge i stället för en slumpad frame.

**Notera.** Detta är ett policybeslut som plan v2 medvetet sköt till Block C
(narrow-vs-eliminate kräver score-impact från Block B). Källfixen här är
*eliminate*-vägen för animation specifikt; den bör synkas med Block C-beslutet
och WHITELIST.md-raden snarare än landas isolerat. Tas med i planen för
fullständighet, men **rekommenderas inte före Block B** utan explicit beslut.

**Exit:** (Om/när beslutat) N=3 determinism visar 0 drift på
`wf-page-header_heading-animated-list`-transform; WHITELIST.md uppdaterad till
`present-no-observed-impact` eller raden borttagen.

---

## Backlog (edge cases, ej i huvudplan)

- **`page.pre-embed.mhtml` externaliseras aldrig** — en site vars pre-embed > 10 MB
  spränger repo-taket (bara post-embed har CDN-vägen, `freeze.server.ts:600-641`).
  Latent; åtgärda när en sådan site faktiskt tillkommer.
- **Namn-glapp:** `freeze-breadth.ts` skriver till `fixtures/breadth-50/` medan
  repot har `fixtures/breadth-corpus/`. Kosmetiskt.

## Rekommenderad ordning

**F1 först** (självförvållad, billig, network-fri verifiering, röjer diff-bruset).
Därefter F2 + F3 parallellt vid behov. F4 hålls tills Block B/C-beslutet.

## Vad planen INTE gör

- Lyfter inte `pending-determinism` på hubspot — tarpit-drivaren kvarstår RED
  efter F1 (F1 tar bort *vårt* brus, inte sajtens tarpit).
- Rör inte Block B/C-scope eller WHITELIST.md-policyn (utom F4:s noterade
  beroende).
- Tvingar ingen re-freeze av committade artefakter (cids är score-neutrala).
