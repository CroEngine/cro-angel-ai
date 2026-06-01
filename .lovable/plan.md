## Pipeline-ramverk (överenskommet)

```
1. Collect      → fakta (klar — buildPageReports + findings)
2. Interpret    → findings + scores (deterministiska regler)  ← detta PR
3. Recommend    → konkreta åtgärdsförslag (deterministisk mappning)
4. AI Consultant→ LLM ovanpå facts+findings+recs (senare)
```

Analyze-knappen kommer att trigga **Steg 2 (Interpret)**. Steg 3 byggs som separat lager senare, Steg 4 ännu senare.

## Detta PR: bara Steg 2-modulen, ingen UI

En fil. Ingen knapp, ingen state, ingen vy, ingen koppling till `BrowserShell`. Vi verifierar output via tillfällig `console.log` innan vi rör UI.

### Ny fil: `src/components/browser-shell/interpret.ts`

**Namngivning:** `interpret.ts` (inte `analyze.ts`) så filnamnet matchar pipeline-steget. Exporterar `interpretReports()` (inte `analyzeReports`).

**Typer:**
```ts
export type Severity = "low" | "medium" | "high";
export type Category = "seo" | "cro" | "ux" | "trust";

export type Finding = {
  ruleId: string;
  category: Category;
  severity: Severity;
  title: string;
  evidence: string;       // konkret datapunkt, t.ex. "8 competing actions above fold"
};

export type Win = {
  ruleId: string;
  category: Category;
  title: string;
};

export type PageInterpretation = {
  url: string;
  scores: { seo: number; cro: number; ux: number; trust: number; overall: number };
  findings: Finding[];    // sorterade severity desc, sedan weight desc
  wins: Win[];
};

type Rule = {
  id: string;
  category: Category;
  severity: Severity;
  weight: number;         // 5/10/20 default per severity, men override tillåtet
  title: string;
  evaluate: (r: PageReport) => null | { evidence: string };
  // null = passed (→ win), object = triggered (→ finding)
};
```

**Konstanter:**
```ts
const SEVERITY_WEIGHT: Record<Severity, number> = { low: 5, medium: 10, high: 20 };
```

**Konservativ v1-regeluppsättning (~3 per kategori, lätta att utöka):**

- `SEO_RULES`:
  - `seo.title.missing` (high) — `head.title` tom
  - `seo.meta.description.missing` (medium) — `head.description` tom
  - `seo.h1.count` (medium) — `headings.h1Count !== 1` (evidence: `"h1Count = N"`)

- `CRO_RULES`:
  - `cro.primaryCta.missing` (high) — `pageSummary.primaryCtaCount === 0`
  - `cro.hero.headline.missing` (high) — `hero` saknas eller `hero.headline === ""`
  - `cro.cta.competition` (medium) — `pageSummary.competingAboveFold > 3` (evidence: `"N competing actions above fold"`)

- `UX_RULES`:
  - `ux.hidden.interactive` (high) — `(hiddenInteractive ?? 0) > 0` *(skippas om fältet saknas)*
  - `ux.abovefold.ratio` (medium) — `foldHeightPx / pageHeightPx < 0.3`

- `TRUST_RULES`:
  - `trust.signals.none` (high) — `trustSummary.total === 0`
  - `trust.abovefold.missing` (medium) — `trustSummary.total > 0 && trustSummary.aboveFold === 0`

**Explicit utelämnade (per tidigare diskussion):**
- "navigation saknar pricing/login/docs" — skippas i v1, kräver business-model-detection
- Form-fieldCount-regler — skippas i v1
- Section-h1 — skippas i v1

**Score per kategori:**
```ts
score = clamp(100 - sum(rule.weight for triggered rules in category), 0, 100)
overall = round((seo + cro + ux + trust) / 4)
```

**Sortering:** findings sorteras `severity desc → weight desc → ruleId asc` (stabilt).

**Export:**
```ts
export function interpretReports(reports: PageReport[]): PageInterpretation[]
```

`PageReport` är redan typad — vi återanvänder den från `findings.ts`/befintlig kod (verifieras vid implementation; om typen inte är exporterad lägger jag till `export`).

## Verifiering (utan UI)

Efter implementation: tillfällig `console.log(interpretReports(buildPageReports(events)))` i `BrowserShell` (eller direkt i devtools) för att inspektera output mot en redan körd run. Det loggandet **tas bort** innan vi går vidare till UI-steget.

## Vad detta PR INTE gör

- Ingen `Analyze`-knapp (kommer i nästa PR)
- Ingen `UrlBar`/`Viewport`/`BrowserShell`-ändring
- Ingen `InterpretView`/`ConsolePanel`-tab
- Inga rekommendationer (Steg 3)
- Ingen AI (Steg 4)
- Ingen schema-/engine-ändring

## Nästa steg efter detta

1. **PR 2 — UI:** Resume → Analyze (BarChart3-ikon), `interpretation` state, `InterpretView`, `ConsolePanel`-tab `Interpret`
2. **PR 3 — Steg 3 (Recommend):** `recommend.ts` som mappar `ruleId → Recommendation[]`
3. **PR 4 — Steg 4 (AI Consultant):** edge function ovanpå facts+findings+recs
