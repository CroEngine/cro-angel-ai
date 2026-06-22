# CRO survey — scoring the corpus at scale

Replays every captured breadth site through the extractor + deterministic CRO
scorer (`scripts/cro-survey.ts`), recording page-type + score. This is the
screenshot-ground-truth technique (which caught the techcrunch "editorial $ →
ecommerce" trap) run across all 45 sites. Regenerate with:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bun run scripts/cro-survey.ts --concurrent=1 --timeout=90
```

(`CRO-SURVEY.json`/`.jsonl` are gitignored — regenerable. This report is the
durable record.)

## Coverage

~35/45 sites score in any single run. The shortfall is **replay-harness**, not
the scorer:

- **Transient browser crashes** under memory pressure at concurrency 1 in this
  container — *which* sites fail varies run to run (hubspot/allbirds failed in
  one run, scored fine in others). Mitigated by the internal `deadlineMs`
  (force-closes the browser so a hung site can't starve later ones) but not
  eliminated.
- **Genuinely replay-hard** (consistent): `guardian`, `nytimes` (169MB),
  `tradera`, `svd`, `substack` — frozen SPAs whose JS never stops re-rendering
  (fail the context-stability gate even at 60 tries) or pathological page sizes.

The union across runs covers ~43/45. For *scorer validation* this is ample —
every page-type and category is well represented.

## Classification accuracy

Clear cases are reliably right; boundaries are fuzzy. Representative run:

| Category | Correct | Notable misses |
|---|---|---|
| saas-landing | figma, hibob 97A, vercel 92A, hubspot 92A, linear, intercom, notion, stripe | **loom → generic** (weak signals) |
| ecommerce | casper 90A, gymshark, warby-parker, away, rei | **patagonia → generic**, **ikea-se → content-media** (i18n) |
| media / news | bbc, techcrunch, verge, lemonde, spiegel, dn | **aftonbladet → ecommerce** (see i18n note) |
| spa / iframe | trello, asana → saas; medium → saas; dev-to, stackoverflow, github-blog → content-media | airbnb/spotify → content-media (debatable) |

### The i18n lesson (important)

An attempt to detect Swedish commerce terms ("köp/handla/lägg i varukorg") to
fix `ikea-se` was **reverted**: it didn't fix IKEA (its cart terms live in body
text, not the collected *interactive* elements) **and** it false-positived
`aftonbladet` (a Swedish newspaper with "köp"/subscribe copy) into ecommerce.
Each text-heuristic fix introduced a new edge case — classic whack-a-mole.

**Takeaway:** reliable cross-language, cross-layout **page-type classification
from text heuristics is a losing game**. That judgement belongs in the **LLM
layer (#4)** — it can read "this is a Swedish newspaper" directly. The
deterministic classifier stays as a cheap, good-enough default for the common
case; i18n ecommerce is a documented limit.

## What this validates

- ✅ **The deterministic dimension scoring is solid.** cta-focus, visual
  hierarchy, value-prop, trust, friction, quality produce sensible,
  evidence-backed scores across all page types (avg overall ~78; grades spread
  A–D, not clustered — the rubric discriminates).
- ✅ **Page-type *adaptation* works** where classification is right (ecommerce
  shop-CTAs not penalized, media subscribe-path recognized, content hubs not
  failed for a missing hero headline).
- ⚠️ **Page-type *classification* is the weak link** — fuzzy at boundaries
  (link-heavy product/service sites, i18n, multi-purpose homepages). Best
  delegated to the LLM, with the deterministic scorer providing the grounded
  dimension signals underneath.

## Score distribution (representative run)

`A:6 B:15 C:14 D:1` over 35 scored, avg overall ~78. The grade spread (not all
clustered at one value) confirms the rubric separates strong pages (hibob 97,
vercel 92, casper 90) from weak ones — the signal the Angel LLM will reason over.
