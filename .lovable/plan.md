# Bedömning

Av de tre punkterna är 2 av 3 redan på plats i collectorn:

- ✅ **Section headings** — varje `PageSection` har redan `heading` + `subheading` (rad 134–135 i `engine.server.ts`).
- ✅ **Trust signal text + person/company** — `TrustSignal` har redan `text`, `personName`, `company`, `rating`, `reviewSource`, `recognizedBrands` (rad 166–183).
- ❌ **Hero content som top-level fält** — finns inte som dedikerat objekt. Måste härledas idag från första hero-sektion + första primary CTA.

Resten av punkterna håller jag med om: vi fryser collectorn efter denna lilla addition och börjar bygga Interpret-lagret härnäst.

# Ändring

## `src/lib/tests/engine.server.ts`

1. Lägg till typ:
   ```ts
   export type HeroContent = {
     headline: string;
     subheadline: string;
     primaryCtaText: string;
     primaryCtaIntent: string;
     sectionId: string;
     aboveFold: boolean;
   };
   ```
2. Lägg till `hero?: HeroContent` i `PageAuditData`.
3. I huvudpipelinen (där `sections`, `ctas`, `pageSummary` byggs ihop): härled `hero` deterministiskt:
   - Hitta första sektionen med `type === "hero"`. Fallback: första sektionen där `aboveFold && containsPrimaryCTA && heading`.
   - Hitta första `cta_primary` inom den sektionen (via `section`-matchning). Fallback: första `cta_primary` `aboveFold`.
   - Returnera `{ headline: section.heading, subheadline: section.subheading, primaryCtaText: cta.text, primaryCtaIntent: cta.intent, sectionId: section.id, aboveFold: section.aboveFold }`.
   - Om inget hittas → lämna `hero` undefined (collector rapporterar fakta, inte gissningar).

## `src/components/browser-shell/findings.ts`

- Lägg till `heroFindings(a)` som visar tre faktarader när `a.hero` finns:
  - `Hero headline — "…"`
  - `Hero subheadline — "…"` (om finns)
  - `Hero primary CTA — "…" · intent · aboveFold`
- Pusha överst i CRO/UX-grupp (sätter den i `cro`-kategorin).

# Vad som INTE ändras

- Inga nya scripts, inga nya DOM-evaluations — `hero` byggs från redan insamlad data.
- Inga severities, inga varningar, inga rekommendationer.
- Inga ändringar i SEO-insamlingen — den är redan komplett.
- FindingsView, ConsolePanel, raw JSON-export: oförändrade.

# Efter detta

Collectorn är "frusen" för v1. Nästa steg blir Interpret-lagret (AI som konsumerar den färdiga JSON-strukturen och producerar diagnoser + rekommendationer).
