# Mål

Separera **Collect → Interpret → Recommend** rent. Steg 1 ska bara visa **fakta** (mätvärden, counts, distributioner, placeringar). Diagnoser (`highCompetition`, `lacksProof`, `wrongSectionOrder`) och rekommendationer ("consider trimming", "add trust signals") flyttas bort — de hör hemma i framtida AI-lagret.

# Princip

| Behåll | Ta bort |
|---|---|
| `trustSignalCount: 7` | `lacksProof: true` |
| `competingAboveFold: 5` | `highCompetition: true` |
| `requiredFields: 8` | `highFriction: true` |
| `sectionOrder: ["nav","hero",...]` | `wrongSectionOrder: true` |
| `nearestTrustSignalDistance: 420` | "Primary CTAs without nearby trust ⚠" |
| `topNavCount: 11` | "consider trimming — choice overload" |

# Ändringar

## 1. `src/components/browser-shell/findings.ts`

- Ta bort `FindingSeverity` och `countBySeverity()`. Alla rader blir neutrala `{ label, detail }`.
- Skriv om varje `*Findings()` så den **bara listar fakta**:
  - `seoFindings`: behåll values (title, desc-längd, canonical, lang, ogImage status som "set"/"not set", H-counts, image counts, schema-typer, robots/sitemap som "found"/"not found", wordCount). Ta bort `for (const f of a.flags)`-loopen.
  - `croFindings`/`uxFindings`/`interactionFindings`: behåll counts, distributioner (`bySection`), top visual weight, hidden-count som siffra. Ta bort allt språk som "consider" eller varnings-tonalitet.
  - `structureFindings`: lista sektioner, sectionOrder, type-counts. Behåll allt — bara fakta.
  - `trustFindings`: behåll summary-rader (total, aboveFold, byType, aggregate rating, recognized brands, sample-rader). Ta bort "none — first impression lacks proof" och "no tel/email/address found" rekommendations-rader. Om `byType.contact_info` saknas → visa bara "Contact info: 0" som faktum.
  - `ctaFindings`: behåll totals + per-CTA-rader med metrics (intent, competing, distances). Ta bort `orphan`- och `highCompetition`-blocken.
  - `formFindings`: behåll per-form metrics. Ta bort friction-bedömningen (`f.requiredFields >= 6 ? "warn" : "info"`).
  - `navigationFindings`: behåll counts + present/missing som listor av fakta ("Pricing: not present"). Ta bort "Missing nav essentials ⚠"-tonen.
  - `hierarchyFindings`: behåll top-N. Ta bort "no CTA in top 5"-blocket.
  - `pageSummaryFindings`: behåll oförändrad — det är ren aggregering.

## 2. `src/components/browser-shell/FindingsView.tsx`

- `FindingRow`: ta bort ⚠/✓-ikon och färg-tone. Visa `label — detail` neutralt.
- `CategorySection`: ta bort `warns`-badge.
- `PageCard`-header: byt "⚠ N issues / ✓ N checks" mot t.ex. `N datapunkter`.
- Behåll kategori-grupperingen (SEO / CRO / UX / Interaction) — den motsvarar redan ungefär den föreslagna page-uppdelningen (Metadata / Trust+CTA+Forms / Sections+Nav+Hierarchy / Summary).

## 3. `src/lib/tests/engine.server.ts`

- **Behåll all insamling intakt** — alla scripts, alla mätvärden, alla aggregeringar, alla distanser, hela `pageSummary`.
- Ta bort **härledda diagnos-flaggor** ur `flags`-arrayen: `no_trust_signals`, `no_trust_above_fold`, `wrong_section_order`, `cta_no_trust_nearby`, `form_high_friction`. Behåll endast rena fakta-flaggor om sådana finns (t.ex. `has_robots_txt`); annars lämna `flags` som tom array.
- Schema/typer för `PageAuditData`, `CTAEntity`, `FormEntity`, `TrustSignal`, `NavigationData`, `VisualHierarchyEntry`, `PageSummary` — oförändrade.

# Vad som INTE ändras

- Datainsamlings-scripts (SECTIONS / TRUST / CTAS / FORMS / NAVIGATION / VISUAL_HIERARCHY).
- Download JSON-knappen och raw-payload.
- ConsolePanel-tabs och övrig UI-struktur.
- Inget AI-lager läggs till nu.

# Resultat

Findings-fliken blir en ren faktainventering. När AI-steget byggs senare matas exakt samma JSON in i prompten ("Use only the supplied data") och AI:n gör bedömningen — utan att vi behöver samla om något.
