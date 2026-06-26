
## Mål

Bygga en `/dashboard`-vy som läser de fem M0 foundation-tabellerna (sites, runs, findings m.fl.) och visar dem som en faktisk dashboard — inte bara den befintliga BrowserShell på `/` och Corpus inspector på `/corpus`.

## Blockerare som måste lösas först (Phase 0)

M0-migrationen finns INTE i denna sandbox. PR #4 (`claude/friendly-bell-fg6fbd`) är inte i remote här, och databasen är tom (0 publika tabeller). Innan dashboarden kan byggas måste schemat finnas. Tre vägar:

- **A. Du klistrar in `20260625000000_m0_adaptive_foundation.sql`** verbatim → jag kör den via `supabase--migration` (med GRANTs verifierade per Lovable Cloud-reglerna). Säkrast.
- **B. Du ger GitHub-länk till råfilen** → jag curl:ar och applicerar verbatim.
- **C. Jag skriver M0 från scratch utifrån C2-handoff/spec.** Risk: divergerar från PR #4:s exakta SQL → två sanningar att avstämma senare.

Phase 1+ nedan förutsätter att en av A/B/C är vald och kör.

## Phase 1 — Route + datakontrakt

- Skapa `src/routes/dashboard.tsx` (publik route, ingen auth — projektet har ingen auth-grind ännu, samma mönster som `/` och `/corpus`).
- Skapa `src/lib/dashboard.functions.ts` med en `getDashboardOverview` `createServerFn` som läser counts + senaste rader från M0-tabellerna via den server-publishable klienten (inte admin) — kräver narrow `TO anon SELECT` policies på dessa tabeller, vilket M0-migrationen redan ska sätta upp.
- Loader: `context.queryClient.ensureQueryData(...)`. Component: `useSuspenseQuery`. `head()` med egen title/description.

## Phase 2 — UI-sektioner

Layout: `min-h-screen bg-background`, `max-w-6xl` container, header med länkar till `/` och `/corpus`. Sektioner (en `Card` per):

1. **Översikt** — KPI-rad: antal sites, antal runs (senaste 7d), antal findings (open vs resolved), senaste run-tid.
2. **Sites** — tabell: name, url, last_run_at, status-badge. Klick → öppnar i ny flik (eller framtida `/dashboard/sites/$id`).
3. **Senaste runs** — tabell: site, started_at, status, duration. Tom-state om 0 rader.
4. **Findings** — gruppera per severity (badges), visa de 10 senaste open. Tom-state.
5. **Tom-state global** — om alla tabeller är tomma: visa "kör en freeze/run för att populera" + länk till `/`.

Komponenter: shadcn `Card`, `Badge`, `Button`, `Table` (lägg till `bunx shadcn@latest add table` om saknas). Inga custom färger — semantiska tokens.

## Phase 3 — Navigation

Lägg en lättviktig top-nav (text-länkar) i `BrowserShell` `TabStrip`-raden ELLER i `CorpusPage`-headern: `/ · /dashboard · /corpus`. Ingen sidebar-shell (overkill för 3 sidor; matcha befintlig stil).

## Vad jag INTE rör

- `BrowserShell` (befintlig `/`-flödet) — orört.
- `CorpusPage` — orört bortsett från ev. nav-länk.
- M0-tabellernas struktur — appliceras verbatim från valt källa (A/B), inte omdesignat.
- Auth — projektet har ingen `_authenticated/` än; dashboard blir publik tills auth tas in separat.

## Teknisk sammanfattning

- Datalager: `createServerFn` + server-publishable Supabase-klient (inte `supabaseAdmin`), TanStack Query primar i loader.
- Routing: TanStack file-based, ny fil `src/routes/dashboard.tsx`.
- Stil: shadcn + semantiska tokens, ingen ny styles.css-ändring nödvändig.
- Beroende: ev. `shadcn add table` om Table-komponenten inte redan finns.

## Beslut jag behöver från dig innan implementation startar

1. **Phase 0**: Vilken väg — A (klistra SQL), B (GitHub-länk), eller C (jag skriver från spec)?
2. Annars är planen klar att köras rakt igenom efter att M0 är applicerat.
