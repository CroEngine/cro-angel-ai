# Consent gate — design spec

> Status: **proposal, pending legal sign-off.** No code implements this yet.
> This is the plan for how the on-page snippet + inventory harvester should read
> a site's *existing* consent so we never add our own cookie banner and never
> store a persistent identifier or send personal/behavioural data before consent.

## Goal

- **Consume the site's existing consent** (their CMP / cookie banner). Render **no banner of our own**.
- **Nothing personal or persistent before consent:** no persistent visitor id, no cross-visit linking, no behavioural events.
- When we can't read a consent signal, fall back to **anonymous mode** — never to adding a banner.

## Why "we can't tie it to a person" is not enough

Under GDPR/ePrivacy a **persistent pseudonymous identifier** (e.g. a visitor id in `localStorage` that recognises the same browser across visits) is **personal data** (GDPR Recital 30), even without a name. And **ePrivacy** governs *storing/reading anything on the device* regardless of whether it's personal data — so a persistent id or a stored sampling flag triggers the consent requirement unless it is *strictly necessary* for the service the user requested (personalisation/analytics generally is not).

So the consent-relevant part of the system is the **adaptive snippet** (`public/adaptive.js`), which stores a visitor id and sends events + context (device, geo country, isReturning/visitCount, referrer). The **inventory harvester** reads the *site's published content* (not personal data); its only device touch is a sampling flag.

## Configuration (per site) — reuses existing schema

`public.sites` already has `consent_mode` and `consent_config` (jsonb):

| `consent_mode` | `consent_config` shape |
|---|---|
| `tcf` | `{ vendorId?: number, purposes?: number[] /* default [1] */ }` |
| `site_signal` | `{ type: "dataLayer" \| "global" \| "cookie" \| "event" \| "selector", ... }` |
| `anonymous_default` | `{}` |

**Delivery to the client:** `GET /api/adaptive/consent-config?site=SLUG` (public, heavily cached), or override via data-attributes on the snippet tag (`data-consent-mode=…`). Reading the *actual* consent happens client-side; the config only says *how* to read it.

## Consent resolution order (shared client module `consent.ts`)

1. **Hard opt-outs first (override everything):**
   - **GPC:** `navigator.globalPrivacyControl === true` → no consent → anonymous mode.
   - **DNT:** `navigator.doNotTrack === "1"` → treat as no (configurable; DNT is weaker/deprecated but respected).
2. **By `consent_mode`:**
   - **`tcf`:** wait for `window.__tcfapi`; `__tcfapi("addEventListener", 2, cb)`. Granted when `tcData.gdprApplies === false` **or** (our purpose(s) consented **and**, if a `vendorId` is set, vendor consent true). If `__tcfapi` is absent within ~3 s → fall through.
   - **`site_signal`:** per `config.type` — a `dataLayer` event, a global variable becoming truthy, a cookie value/regex, a custom `event`, or (last resort) a click on an accept-button `selector`.
   - **`anonymous_default`:** never assume consent → always anonymous.
3. **Known-CMP auto-detect (fallback):** no TCF but a known global present (`Cookiebot` + `CookiebotOnAccept`, `OnetrustActiveGroups` + `OptanonWrapper`, `window.Didomi`, Usercentrics) → read its state/events.

We listen to the consent **state**, not to the site's specific button, and re-evaluate live (TCF `addEventListener`) so a change upgrades/downgrades immediately.

## Two operating modes (what consent gates)

| | Consented (full) | Anonymous (none / pre-consent / opt-out) |
|---|---|---|
| localStorage visitor id + history | yes | **no** |
| localStorage sampling flag | yes | **no** → in-memory probabilistic sampling |
| `events` (with `visitorHash`) | yes | **not sent** until consent |
| `decide` (isReturning/visitCount/geo) | full | conservative: skip, or only non-storing/non-identifying signals |
| adaptations applied | yes | limited / off |
| our own banner | **never** | **never** |

## Harvester specifics

The harvester reads the **site's content** (not personal data); its only device touch is the sampling flag. In anonymous mode: **write nothing to the device** (probabilistic in-memory sampling instead) → the ePrivacy storage trigger is avoided and the payload carries no visitor data. So the harvester can likely run even pre-consent *if* it stores nothing. **(Confirm with legal.)**

## Timing / UX

Snippet loads → resolves consent asynchronously → **buffers** anything consent-gated until it has an answer. Grant → upgrade (set id, flush buffer). Deny/timeout → anonymous. Keep listening for changes → live upgrade/downgrade (on downgrade: stop sending, optionally clear the id). Never blocks render.

## Plug-in points (code map)

- New shared browser module `src/adaptive/consent.ts` → compiled into both the snippet and the harvest bundle.
- `public/adaptive.js`: gate `visitorId()` / `writeStore()` / `send()` / decide behind the consent state, with anonymous fallbacks.
- Harvest bundle (`scripts/build-harvest.ts`): gate sampling-storage + POST (or run in no-storage mode).
- Config endpoint `GET /api/adaptive/consent-config`.
- **Auditability:** stamp events/decisions with the basis used (`mode` + `granted`) so the controller can demonstrate compliance.

## Responsibilities

- **Site owner = data controller:** must include us in their CMP / purposes (or have a lawful basis), disclose in their privacy policy — the banner is theirs.
- **Croengine = processor:** a DPA is needed; we provide the consent reading + anonymous fallback + config.

## Open questions for legal

1. Does harvested **site content** + **no device storage** count as processing personal data? (Likely no — confirm.)
2. Weight of **DNT** (deprecated) vs **GPC** (legally recognised in some jurisdictions).
3. Do we need **IAB vendor registration**, or does the site's purpose consent suffice?
4. Default when GDPR applies but no signal is found must be **opt-in** (no consent), not opt-out.

## Net answer

Yes — we can recognise the site's consent (via TCF / known CMP / site-configured signal) and avoid becoming a second banner. Only when we can't read any signal do we run in anonymous mode — still with no banner of our own.
