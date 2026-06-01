## PR — Wins läser som påståenden, inte negationer

### 1. `interpret.ts` — `Rule` får obligatoriskt `passTitle`

```ts
interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  weight?: number;
  title: string;       // visas när regeln triggar (issue)
  passTitle: string;   // visas när regeln passerar (win)
  evaluate: (audit: PageAuditData) => null | { evidence: string };
}
```

I `interpretOne()`: när `evaluate()` returnerar `null`, pusha `{ ruleId, category, title: rule.passTitle }` (Win-typen är oförändrad — fältet `title` finns redan).

### 2. `passTitle` för alla 10 v1-regler

| ruleId | passTitle |
|---|---|
| `seo.title.missing` | Page title set |
| `seo.meta.description.missing` | Meta description set |
| `seo.h1.count` | Exactly one H1 present |
| `cro.primaryCta.missing` | Primary CTA detected |
| `cro.hero.headline.missing` | Hero headline present |
| `cro.cta.competition` | CTA competition within limits |
| `ux.hidden.interactive` | No hidden interactive elements |
| `ux.abovefold.ratio` | Fold/page ratio within threshold |
| `trust.signals.none` | Trust signals present |
| `trust.abovefold.missing` | Trust signals above the fold |

### 3. `InterpretView.tsx` — liten textfix

- Byt `N passed check(s)` → `N passed`

### Inte i scope

- Ingen ändring i score-modell, regeluppsättning, eller UI-layout
- Ingen recommend, ingen AI
