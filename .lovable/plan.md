## PR 2 — UI-lager för Steg 2 (Interpret)

Mål: gör `interpretReports()` synlig i appen. Ingen ny logik, ingen ny data — bara koppla in regelmotorn i UI:t.

### Konventioner (låsta innan kodning)

- **Severity-namn:** `"low" | "medium" | "high"` (matchar `interpret.ts` exakt)
- **Tab-id internt:** `"interpret"` · **UI-label:** `Analysis`
- **Tab-typ:** `type ConsoleTab = "findings" | "activity" | "interpret"`

### 1. `UrlBar.tsx` — Resume → Analyze

- Byt ikon `RotateCw` → `BarChart3`
- Byt prop `onResume` → `onAnalyze`
- Knappen `Analyze` visas **alltid** (live/frozen/done) — inte bundet till session-state. När `isLive` är true visas `Stop`, annars visas `Run` + `Analyze` sida vid sida (eller bara `Analyze` om en run redan körts; `Run` alltid synlig så man kan starta ny URL)
- Ny prop `analyzeDisabled?: boolean` → disablar knappen om ingen data finns

### 2. `Viewport.tsx` — ta bort Resume-overlay

- Ta bort `onResume`-prop och eventuell overlay-knapp på frozen viewport
- Viewport visar fortfarande frozen screenshot, bara utan knapp

### 3. `BrowserShell.tsx` — state + handler

```ts
import { interpretReports, type PageInterpretation } from "./interpret";
import { buildPageReports } from "./findings";

type ConsoleTab = "findings" | "activity" | "interpret";

const [interpretation, setInterpretation] = useState<PageInterpretation[] | null>(null);
const [consoleTab, setConsoleTab] = useState<ConsoleTab>("findings");

const pageReports = useMemo(() => buildPageReports(events), [events]);
const analyzeDisabled = pageReports.length === 0;

const handleAnalyze = useCallback(() => {
  setInterpretation(interpretReports(pageReports));
  setConsoleTab("interpret");
}, [pageReports]);
```

- Ta bort `handleResume`
- Töm `interpretation` vid ny `handleRun`
- Skicka `onAnalyze`, `analyzeDisabled` till `UrlBar`; ta bort `onResume` från `Viewport`; skicka `interpretation`, `tab`, `onTabChange` till `ConsolePanel`

### 4. `ConsolePanel.tsx` — kontrollerad Tabs + ny tab

- Tabs blir kontrollerad:
  ```tsx
  <Tabs value={tab} onValueChange={(v) => onTabChange?.(v as ConsoleTab)}>
  ```
- Ny trigger: `<TabsTrigger value="interpret" className="text-xs">Analysis</TabsTrigger>`
- Ny content: `<TabsContent value="interpret">` med `<InterpretView interpretation={interpretation} />` i `ScrollArea`
- Nya props: `interpretation: PageInterpretation[] | null`, `tab?: ConsoleTab`, `onTabChange?: (v: ConsoleTab) => void`
- Exportera `ConsoleTab`-typen så `BrowserShell` kan återanvända den

### 5. Ny fil: `src/components/browser-shell/InterpretView.tsx`

Samma visuella språk som `FindingsView` (Cloud White, Sora/Manrope, sticky header, `rounded-xl border border-border bg-muted/30`).

**Tom-state:** centrerat meddelande `Click Analyze to interpret findings.`

**Per `PageInterpretation`:**
- Sticky header: hostname (font-heading) + overall score som stor siffra höger + `Download analysis JSON`-knapp (laddar bara ner **denna** interpretation, inte findings)
- 4 mini score-pills under header: `SEO · CRO · UX · Trust` med score (grön ≥80, amber 50–79, röd <50)
- Body `p-5 space-y-8`. Fyra `CategorySection`-block: `SEO Analysis` / `Conversion (CRO)` / `UX & Structure` / `Trust` — samma uppercase-header + divider + count-pill som FindingsView
- Inom varje kategori: `grid grid-cols-2 gap-3` av `<IssueCard>`:
  - Severity-pill uppe vänster (`high`=röd, `medium`=amber, `low`=blå)
  - Titel (`font-heading text-sm font-semibold`)
  - Evidence-chip under (mono, muted)
  - `ruleId` som liten muted footer
  - `col-span-2` om evidence är lång
- Wins-rad collapsed under varje kategori: chevron-toggle `N passed checks` → lista titlar
- Empty category: grön pill med texten `No issues found` (inte "All checks passed")

### 6. Vad detta PR INTE gör

- Ingen ny regel, ingen ändring i `interpret.ts`
- Inga recommendations (Steg 3)
- Ingen AI
- Ingen ändring i schema, engine, eller FindingsView

### Resultat

1. Så fort en run gett `pageAudit`-data är `Analyze` aktiv — oavsett om sessionen är live, frozen eller done
2. Klick → ConsolePanel byter till `Analysis`-tab och visar scores + findings per URL
3. Du kan växla fritt mellan `Findings`, `Activity` och `Analysis` utan att tappa data
