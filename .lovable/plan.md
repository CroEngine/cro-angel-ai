# Fix 4 v4 — Embedded Form Detection (final)

## Goal

Make `formCount`, `embeddedFormCount`, and `conversionFormCount` reflect reality on demo/signup pages whose forms are SaaS-embedded. Detect from **source only** — inline scripts, form-specific external script URLs, and declarative widget attributes. **Never scan rendered DOM iframes**. Invariant: provider detected ⇒ entry emitted; IDs are best-effort, never a gate. One real-world form = exactly one entry, deterministically, regardless of whether the provider's JS has injected its `<form>` into the DOM at snapshot time.

## Detection layers (per-provider raw signals → two-phase resolve → cross-detector dedup)

| Provider | External script URL (form-specific only) | Imperative call (inline-script) | Declarative attributes |
|---|---|---|---|
| HubSpot | `js.hsforms.net`, `js-eu1.hsforms.net` (**not** `js.hs-scripts.com` — that's tracking) | `hbspt.forms.create({ portalId, formId, region? })` | `<script src=".../v2.js" data-portal-id data-form-id>` |
| Marketo | `app-*.marketo.com/js/forms2/js/forms2(.min).js` | `MktoForms2.loadForm("//app-<id>.marketo.com", "<munchkin>", <formId>)` | source-string match for `<form id="mktoForm_*">` (no rendered-iframe scan) |
| Calendly | `assets.calendly.com/.../widget.js` | `Calendly.init(Inline|Popup)Widget({ url })` | `.calendly-inline-widget[data-url]`, `[data-calendly-url]` |
| Typeform | `embed.typeform.com/next/embed.js` | — | `<div data-tf-widget|data-tf-live="<formId>">` |
| Pardot | `go.pardot.com` (form/LP handler — **not** `pi.pardot.com`, tracking pixel) | — | — |

Tracking scripts (`hs-scripts`, `pi.pardot`) belong in `techStack`, not form detection. Matching them produces false positives on every B2B site running provider tracking without a form on the audited page.

Window globals (`window.hbspt`, `MktoForms2`, `Calendly`, `tf`) are last-resort confirmation only.

### Two-phase resolver (per provider, intra-detector dedup)

1. Collect raw signals per provider: `{ source, portalId?, formId?, munchkinId?, calendlyUrl?, scriptSrc?, mountSelector? }`.
2. Partition into **identified** (has ID) and **provider-only**.
3. If identified ≥ 1: emit one entry per unique ID (merge signals; pick strongest `detectedVia` per priority `inline-script > declarative-attr > external-script > window-global`). Discard provider-only signals — superseded.
4. Else if provider-only ≥ 1: emit exactly one provider-only entry (`formId: undefined`).

### Cross-detector dedup (embedded vs native)

After embed entries are produced, build a `claimedMounts` set of selectors/IDs the embed detector owns:
- Marketo: `form[id="mktoForm_<formId>"]` and `form[id^="mktoForm_"]` for provider-only Marketo
- HubSpot: any `form.hs-form`, `form[id^="hsForm_"]`, plus the target container `#hbspt-form-<formId>` and any `form` descendant of it
- Calendly / Typeform / Pardot: no native `<form>` collision (iframe/widget mounts)

Native loop **skips** any `<form>` element whose selector matches `claimedMounts` or that is a descendant of a claimed container. Result: one real form = one entry, deterministically, whether or not the provider injected its `<form>` before snapshot.

### Regex constants at module scope (Vitest-importable)

```ts
export const PROVIDER_PATTERNS = {
  hubspotExternalScript: /js(?:-eu1)?\.hsforms\.net/i,
  hubspotCall: /hbspt\.forms\.create\(\s*\{/,
  hubspotPortalId: /portalId\s*:\s*["']?([\w-]+)["']?/,
  hubspotFormId: /formId\s*:\s*["']([\w-]+)["']/,
  marketoExternalScript: /app-[\w-]+\.marketo\.com\/js\/forms2\/js\/forms2(?:\.min)?\.js/i,
  marketoCall: /MktoForms2\.loadForm\(\s*["']\/\/app-([\w-]+)\.marketo\.com["']\s*,\s*["']([\w-]+)["']\s*,\s*(\d+)/,
  marketoFormPlaceholder: /<form[^>]+id=["']mktoForm_(\d+)["']/i,
  calendlyExternalScript: /assets\.calendly\.com\/[\w./-]+widget\.js/i,
  calendlyCall: /Calendly\.init(?:Inline|Popup)Widget\(\s*\{/,
  calendlyUrl: /url\s*:\s*["']([^"']+calendly\.com[^"']+)["']/,
  typeformExternalScript: /embed\.typeform\.com\/next\/embed\.js/i,
  pardotExternalScript: /go\.pardot\.com/i,
} as const;
```

The IIFE serializes these via `.source` when emitted to `page.evaluate`. Vitest imports `PROVIDER_PATTERNS` and runs each regex against raw HTML from the real-source corpus — no browser, no jsdom.

## Output shape

```ts
export type EmbeddedFormProvider = "hubspot" | "marketo" | "calendly" | "typeform" | "pardot";

export type EmbeddedFormEntity = {
  kind: "embedded";
  provider: EmbeddedFormProvider;
  detectedVia: "inline-script" | "external-script" | "declarative-attr" | "window-global";
  portalId?: string;
  formId?: string;
  munchkinId?: string;
  calendlyUrl?: string;
  scriptSrc?: string;
  section: SectionKind;
  aboveFold: boolean | null;  // null = undetermined from source
  selector: string | null;
};

export type NativeFormFormType =
  | "search" | "newsletter" | "login" | "signup" | "lead" | "checkout" | "unknown";

export type NativeFormEntity = { kind: "native"; formType: NativeFormFormType } & FormEntity;
export type FormDetection = EmbeddedFormEntity | NativeFormEntity;
```

`PageSummary` adds:
- `embeddedFormCount` — embedded only
- `conversionFormCount` — `embedded.length + native.filter(f => f.formType === "lead" || f.formType === "signup" || f.formType === "checkout").length`. Excludes login (retention), search/newsletter/unknown (noise).
- `formCount` stays raw total.

## Native classifier

| Signal | formType |
|---|---|
| field `type="search"` OR name matches `/^(q|query|search|s)$/i` OR `form[role="search"]` | `search` |
| one email field, no password, submit matches `/subscribe\|newsletter\|prenumerera/i` | `newsletter` |
| password field, no confirm-password, submit matches `/log[ -]?in\|sign[ -]?in\|logga in/i` | `login` |
| password + confirm-password OR submit matches `/sign[ -]?up\|register\|create account\|skapa konto\|registrera/i` | `signup` |
| credit-card fields | `checkout` |
| else `fieldCount >= 2` | `lead` |
| else | `unknown` |

(Swedish variants `logga in`, `skapa konto`, `registrera` added since target market is Swedish.)

## Implementation steps

1. **Fixtures** in `src/routes/test-fixtures/`: `hubspot-imperative`, `hubspot-declarative`, `hubspot-two-forms` (asserts 2 entries), `hubspot-provider-only`, `hubspot-native-collision` (renders both `hbspt.forms.create` AND a `<form class="hs-form">` to assert cross-detector dedup → exactly 1 entry), `calendly-declarative`, `calendly-imperative`, `marketo` (includes the `<form id="mktoForm_1234">` placeholder — asserts 1 entry, not 2), `pardot` (script-URL only, asserts no iframe path), plus native fixtures (`native-search`, `native-newsletter`, `native-login`, `native-lead`).
2. **Real-source corpus** in `src/lib/tests/fixtures/real-pages/`: HubSpot, Calendly, Marketo, Pardot HTML snapshots. Plus a **negative**: a page that loads `js.hs-scripts.com` but no form embed — asserts zero HubSpot entries (regression gate for the tracking-vs-form distinction).
3. **`forms.ts`**: hoist `PROVIDER_PATTERNS`; new IIFE branch before native loop runs the two-phase resolver; embed branch returns `{ entries, claimedMounts }`; native loop filters out forms matching `claimedMounts` or descended from claimed containers; both branches feed the merged result; `classifyNativeForm` attached.
4. **`schema.ts`**: union, `EmbeddedFormProvider`, `NativeFormFormType`, nullable `aboveFold` on embedded, new summary fields.
5. **Aggregation** in `engine.server.ts`/`audit-helpers.ts`: counts + legacy normalizer (entries without `kind` → `{kind:"native", formType:"unknown"}`).
6. **Consumer audit**: `rg "\.forms\["` + `rg "FormEntity|formCount"`. Narrow on `kind` in `FindingsView.tsx`, `PageInsightsView.tsx`, `findings.ts`, `llmContext.ts`. `tsc` enforces.
7. **Regenerate form baselines** — additive schema change.

## Verification (must-have, ordered)

1. **Vitest** regex tests against real-source corpus pass, including the negative `hs-scripts`-only page → 0 HubSpot entries.
2. **Synthetic fixtures**: dedup gates pass — `hubspot-imperative` = 1, `hubspot-two-forms` = 2, `hubspot-provider-only` = 1, `hubspot-native-collision` = 1, `marketo` = 1. `pardot` succeeds without iframe selector path.
3. **Native regression**: existing native-form pages unchanged in legacy fields, correct `formType` attached; HubSpot search box → `formType: "search"`, excluded from `conversionFormCount`.
4. **HiBob smoke** (informational): `embeddedFormCount: 0`, counts stable within noise floor.

## Out of scope

HubSpot/Calendly API enrichment; bespoke React/Vue forms; Mål A (group threshold); Fix 3; layout/viewportDelta; `trustDebug` strip; surfacing "login form on landing page" as its own finding.

## Files touched

- `src/lib/tests/scripts/forms.ts` — patterns, two-phase resolver, cross-detector dedup, native classifier
- `src/lib/tests/schema.ts` — union + summary fields
- `src/lib/tests/engine.server.ts` / `audit-helpers.ts` — aggregation + legacy normalizer
- `src/routes/test-fixtures/*.tsx` (new) — incl. `hubspot-native-collision`
- `src/lib/tests/fixtures/real-pages/*.html` (new) — incl. negative tracking-only page
- `src/lib/tests/__tests__/forms.regex.test.ts` (new)
- Consumer narrowings in `FindingsView.tsx` / `PageInsightsView.tsx` / `findings.ts` / `llmContext.ts`

## Risks

- Cross-detector dedup over-skips a real distinct native form. Mitigated: `claimedMounts` is keyed on provider-specific selectors (`form.hs-form`, `form[id^="mktoForm_"]`), not generic.
- Provider changes embed syntax or script host. Real-source corpus is the canary.
- `aboveFold: null` cascade — `tsc` + consumer audit cover it.
- Snapshot schema break — baselines regenerated, not excluded.
