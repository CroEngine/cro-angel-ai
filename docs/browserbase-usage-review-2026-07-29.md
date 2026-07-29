# Browserbase usage review — 2026-07-29

> Question asked (owner, 2026-07-29): *"are we really using browserbase as we
> should? is there not more and better things it can do?"* This doc is the
> full answer: every function Browserbase exposes (API + Node SDK v2.16.0,
> verified against the typings we actually have installed) mapped against what
> this repo uses, with concrete recommendations. Companion chat review ran the
> same day; this is the durable version.

## TL;DR

The core pattern is right: Browserbase is our remote stealth Chrome
(residential proxies + ad-block + captcha solving) plus the live-view iframe,
driven through Stagehand-as-Playwright-transport, with replay/scoring
deliberately on local pinned Chromium ("Browserbase adds zero value at
replay", `snapshot/harness.server.ts`). Session lifecycle hygiene is good:
one wrapper owns creation, release is explicit and idempotent everywhere,
and fleet runs recycle sessions before timeout.

But we drive it with three booleans while the platform solves several
problems we have *documented in this repo*:

| # | Gap | Maps to which documented pain | Effort |
|---|-----|-------------------------------|--------|
| 1 | No proxy **geo-targeting** — `proxies: true` routes best-effort US | Svensk Fast/Cookiebot rendered no banner against the Browserbase IP (site dropped from corpus, `corpus/README.md`); CMP behaviour noted IP-dependent; whole `i18n-routing` fixture class is geo-sensitive | ~5 lines |
| 2 | No **region** — every session runs in `us-west-2` (Oregon) fetching mostly-Nordic sites | `load` never fires on heavy SPAs (`loadStateDegraded`), Cloudflare interstitial waits, general capture latency. **Ships together with #1** (see P2) | 1 line |
| 3 | Hard-coded **concurrency 3** ("plan-gräns") + zero 429 handling — **live-verified 2026-07-29: the project's real limit is 25** | `scale-test.ts`/`render-fidelity.ts` throttled to 12 % of entitlement; scale docs call capture throughput the real ceiling | small |
| 4 | No **userMetadata** on sessions; dashboard artifacts (video, CDP/network logs — recorded by default, we already pay for them) never linked | "map run hung 3h at site 89"; MHTML `-32000` "root cause not isolated" | small |
| 5 | No **cost telemetry** — `projects.usage()` and per-session `proxyBytes` unused | Only cost note in repo is "spending more Browserbase sessions" (promote-corpus) | small |
| 6 | No **Contexts** — every session is a cold profile | Consent re-dismissal on every repeat audit; blocks future logged-in-funnel analysis | medium |
| 7 | Capture ceiling: `advancedStealth`/`verified` are **Scale-plan-gated** | "the 18% fetch failure is the real ceiling on scale" (`docs/section-scale-2026-07-25.md`) | commercial, not code |

Items 1+2 are correctness fixes for a Swedish-market CRO product (we currently
freeze the US-IP rendering of Swedish sites). Items 3–5 are ops/throughput.
Item 6 is a design decision with a determinism caveat. Item 7 is a pricing
conversation.

### Live-verified against our actual account (2026-07-29)

The load-bearing claims were checked against the real project (read-only API
calls + one throwaway 2-minute probe session, released after use):

- `projects.retrieve()` → **`concurrency: 25`**, `defaultTimeout: 300`.
  `MAX_RENDERS = 3` is confirmed a fossil, not a plan reality. (Our code
  always overrides the 300 s default with 960 s — fine.)
- `projects.usage()` → **2 315 browser-minutes, 25.17 GB proxy traffic** to
  date. The proxy number is the striking one: at metered residential-GB
  rates that is the dominant cost driver, and nothing in the repo watches it.
- Docs confirm `proxies: true` routes **best-effort US** ("may route through
  nearby countries like Canada") — so today's captures really do see the
  US-IP web.
- A probe session with `region: "eu-central-1"` +
  `proxies: [{ type: "browserbase", geolocation: { country: "SE" } }]` +
  `userMetadata` was **accepted on our plan** (no gating error), and an
  in-session fetch of an IP-echo service returned **country SE
  (46.236.108.224)**. P1+P2+P4 work end-to-end on the plan we have today.
- The one `RUNNING` session found during the check carried **no metadata** —
  illustrating the attribution gap of P4 exactly.

### Implemented (same day, this branch)

P1–P4 are code now, verified by an end-to-end `--dry-run` freeze of cdon.se
through the real pipeline (SE residential exit + `eu-central-1` + metadata;
Didomi banner rendered under Swedish IP and dismissed in 1.3 s;
`env.proxyCountry: "SE"` stamped in the report):

- `browserbase.server.ts`: `proxyCountry` (+ env `BROWSERBASE_PROXY_COUNTRY`),
  region-follows-geo (EU → `eu-central-1`; `BROWSERBASE_REGION` override),
  `userMetadata` stamping (`{pipeline, site, runId}`, script-name fallback),
  inspector-URL log line, SDK `maxRetries: 5` (Retry-After honored),
  `resolveSessionBudget()` (plan concurrency − reserve; env override;
  fallback 3) and `getSessionRegion()`.
- `corpus/sites.ts`: `geo?: string` on `SiteSpec`; the 7 Swedish sites carry
  `geo: "SE"`. US/international sites untouched. `freeze-site.ts` takes
  `--geo=` as override and reports carry `env.proxyCountry`.
- `scale-test.ts` / `render-fidelity.ts`: session caps read the plan's real
  concurrency instead of the hard-coded 3.
- `withBrowserPage(meta, fn)` + `app-crawl`/`crawl`/`robustness`/`freeze`/
  `redesign-render` pipelines stamped at every creation site.
- `scripts/bb-sweep.ts`: lists RUNNING sessions with age/metadata/inspector
  links + prints plan concurrency and usage; `--release` with
  `--pipeline=`/`--older-than=`/`--all` guards for stray cleanup.

**Discovery from the e2e test (this is why you dry-run):** Stagehand v3's
hosted API is **region-pinned** — driving an `eu-central-1` session against
the default endpoint 400:s with "route your request to the eu-central-1
Stagehand API endpoint". Stagehand only learns the region from
`browserbaseSessionCreateParams.region` (never from the session ID), so every
Stagehand attach now forwards the region: from the `createSession` result
where the session is created locally, via `getSessionRegion()` in the app's
create-in-POST/attach-in-stream handoff (`engine.server.ts`). Raw
`connectOverCDP` scripts are unaffected (`connectUrl` is region-correct).

Not implemented (unchanged recommendations): P5 nightly usage telemetry
beyond bb-sweep's printout, P6 Contexts, P7 Scale-plan stealth. Goldens for
the 7 Swedish sites re-promote on their next write-freeze — that diff (e.g.
a consent banner appearing for the first time) is the correctness fix
landing, not drift.

## 1. What we use today

All session creation goes through `src/lib/tests/browserbase.server.ts`
(the only importer of `@browserbasehq/sdk`):

- `sessions.create({ projectId, keepAlive: true, timeout: 960, proxies: true,
  browserSettings: { blockAds: true, solveCaptchas: true } })`
  — plus opt-in `{ advancedStealth: true, os: "mac" }` with graceful fallback
  (currently zero callers; Enterprise/Scale-gated).
- `sessions.debug(id)` → `debuggerFullscreenUrl` for the live-view iframe
  (`Viewport.tsx`), replaced by a homegrown frozen screenshot when a run ends.
- `sessions.update(id, { status: "REQUEST_RELEASE" })` on every exit path.
- CDP over `connectUrl`: via Stagehand in the app pipelines, via raw
  `chromium.connectOverCDP` in most scripts. MHTML capture is raw CDP
  `Page.captureSnapshot`; screenshots are Playwright `page.screenshot()`.

Consumers: the live crawl/audit (`run.functions.ts` → `$runId.stream.ts`),
`withBrowserPage()` for crawl/robustness SSE routes, the corpus freeze
(`snapshot/freeze.server.ts`), and ~20 scripts (fleet-shots, scale-test,
render-fidelity, sweeps, e2e, diagnostics). One-session-per-task everywhere
except `fleet-shots/run.ts`, which holds one session and recycles at 11 min.

## 2. Full function map: Browserbase API/SDK v2.16.0 vs this repo

Verified against `node_modules/@browserbasehq/sdk` typings (2.16.0) and the
OpenAPI spec at `docs.browserbase.com/reference/api/openapi.v1.yaml`
(2026-07-29; 52 REST operations across 10 namespaces — all accounted for
below). ✔ = used, ◐ = wired but effectively unused, ✘ = unused.

REST-only surface missing from SDK v2.16.0 (none of it needed by us):
the 11 Functions endpoints, the newer `/v1/downloads` list/get/delete
namespace, and `POST /v1/agents/runs/{runId}/stop`. Conversely
`sessions.downloads.list` exists in the SDK but has left the spec.

### `sessions.create` parameters

| Param | Status | Notes / recommendation |
|---|---|---|
| `projectId`, `keepAlive`, `timeout` | ✔ | Correct. `keepAlive` is what lets the live iframe outlive the Stagehand attach; timeout 16 min is a sane backstop (max allowed: 6 h). |
| `proxies: true` | ✔ | **Upgrade to config form.** `proxies` accepts an array: `[{ type: "browserbase", geolocation: { country: "SE" } }]` (ISO 3166-1; `state`/`city` for US). Also supports `domainPattern` routing, `type: "external"` (bring-your-own proxy), `type: "none"` bypass. We use none of it. → **P1** |
| `region` | ✘ | `us-west-2` (default) \| `us-east-1` \| `eu-central-1` \| `ap-southeast-1`. We never set it; Frankfurt is one line and no documented plan gating. → **P2** |
| `userMetadata` | ✘ | Arbitrary JSON (≤512 chars), queryable via `sessions.list({ q })`. Zero attribution today across nightly/fleet runs. → **P4** |
| `extensionId` | ✘ | No use case (no extension needed for capture). Skip. |
| `proxySettings.caCertificates` | ✘ | Enterprise MITM certs. Skip. |
| `browserSettings.blockAds` | ✔ | Default is `false`, so keeping it explicit is right. Also trims proxy GB. |
| `browserSettings.solveCaptchas` | ✔ | Explicit-for-intent (it defaults `true`). Fine. |
| `browserSettings.advancedStealth` | ◐ | Wired with fallback, zero callers, **Scale plan only**. → **P7** |
| `browserSettings.verified` | ✘ | Newer Scale-gated mode (fingerprints recognized by bot-protection vendors; supports `os`, locks viewport). The `"mac OS is only available for verified users"` error our comment quotes is this gate. Evaluate together with advancedStealth if/when on Scale. |
| `browserSettings.os` | ◐ | Only inside the dead `ADVANCED_STEALTH` block. Correct placement (gated). |
| `browserSettings.viewport` | ✘ | Deliberately unused — session-level viewport only holds until first navigation under Stagehand (documented in `browserbase.server.ts`); per-device emulation happens post-goto. Correct as-is. |
| `browserSettings.context` | ✘ | `{ id, persist }` — persistent profile attach. → **P6** |
| `browserSettings.allowedDomains` | ✘ | Main-frame navigation allowlist. Marginal safety net for the crawler; low value (doesn't block subresources). Skip for now. |
| `browserSettings.captchaImageSelector` / `captchaInputSelector` | ✘ | Custom captcha solving for non-standard captchas. Keep in the toolbox for specific corpus sites; nothing needs it today. |
| `browserSettings.ignoreCertificateErrors` | ✘ | Defaults `true`; fine. |
| `browserSettings.logSession` / `recordSession` | ✔ (implicit) | Both default `true` — **every session already records video + CDP/network/console logs**. We pay for this and never look at it. → **P4/P5** |

### Everything else in the SDK

| Function | Status | Notes / recommendation |
|---|---|---|
| `sessions.retrieve(id)` | ✘ | Returns `status`, `region`, and **`proxyBytes`** (per-session proxy usage). Cheap per-site cost signal for fleet logs. → **P5** |
| `sessions.list({ q, status })` | ✘ | Query by metadata (`q: "user_metadata['runId']:'…'"`, string equality only) or status. Enables (a) run forensics, (b) an **orphan sweep**: list `RUNNING` sessions and `REQUEST_RELEASE` strays after crashed runs — the "3h hang" class currently leaks sessions until timeout. → **P4** |
| `sessions.update(id, REQUEST_RELEASE)` | ✔ | Still the only/current way to end early. Correct. |
| `sessions.debug(id)` | ✔ | We use `debuggerFullscreenUrl`. Also returns per-tab `pages[]` (multi-tab live view) and `wsUrl`; our UI is single-tab by design — nothing to do. |
| `sessions.logs.list(id)` | ✘ | Post-session CDP event log. Attach to freeze failure reports — the standing `-32000 "Failed to generate MHTML"` mystery is exactly what this exists for. → **P5** |
| `sessions.recording.retrieve(id)` | ✘ | Raw rrweb event stream (legacy replay format, deprecated in favour of video). Skip. |
| `sessions.recording.downloads.create/list(id)` | ✘ | **MP4 export**, one file per tab: async POST → poll list; signed URL (6 h TTL, re-minted per GET); source retained 31 days; 409 until the session has ended. Post-mortems for nightly failures. → **P5** |
| `sessions.replays.retrieve(id)` / `retrievePage` | ✘ | HLS replay: page metadata + per-page `.m3u8` playlist. Dashboard link is usually enough. |
| `sessions.downloads.list(id)` | ✘ | Legacy zip endpoint (SDK-only; the current REST API has a richer `/v1/downloads` list/get/delete namespace with checksums — not in SDK v2.16.0). No use case either way (we never download files). Skip. |
| `sessions.uploads.create(id)` | ✘ | Multipart upload → file lands at `/tmp/.uploads/` in the session, attached via CDP `DOM.setFileInputFiles`. No use case. Skip. |
| `contexts.create/retrieve/update/delete` | ✘ | Persistent encrypted profiles (cookies, localStorage, IndexedDB — not HTTP cache). → **P6** |
| `projects.retrieve(id)` | ✘ | Returns **`concurrency`** — the project's real concurrent-session limit. Replaces the hard-coded `MAX_RENDERS = 3`. → **P3** |
| `projects.usage(id)` | ✘ | `{ browserMinutes, proxyBytes }` — programmatic spend. One call in the nightly summary makes cost drift visible. → **P5** |
| `projects.list()` | ✘ | Trivial; not needed. |
| `extensions.create/retrieve/delete` | ✘ | Custom Chrome extensions (ZIP ≤100 MB; slower session start). No use case. Skip. |
| `certificates.*` | ✘ | TLS cert management for `proxySettings`. Skip. |
| `fetchAPI.create` | ✘ | Hosted single-page fetch (`format: raw` open to all plans; `json`/`markdown` need project enablement; optional proxies). We already run our own static-fetch pool; *possibly* a middle tier between static fetch and a full session in scale runs — only worth an experiment if it prices below a browser-minute. Not a priority. |
| `search.web` | ✘ | Hosted web search. No use case. Skip. |
| `agents.*` (hosted natural-language browser agents) | ✘ | We *are* the automation; a hosted agent runner doesn't fit. Skip. |

### Platform features with no SDK surface (docs-verified)

- **Webhooks / lifecycle events: do not exist.** Polling + your own CDP
  connection is the only model — our current architecture is already the
  right shape. Nothing to adopt.
- **Functions** (serverless runtime next to the browsers): beta,
  `us-west-2`-only — wrong region for us. Skip.
- **Model Gateway** (LLM proxy at list price): we hold our own Anthropic key.
  Skip.
- **Director / Agents "generate a script"**: no-code workflow authoring. Skip.
- **rrweb Session Replay API: deprecated** (replaced by video/HLS/MP4 above).
  Good thing we never built on it; don't start now.
- **`browserSettings.fingerprint` (old viewport/locales/httpVersion object):
  removed from the API.** Only `os` + `viewport` survive. Don't resurrect old
  examples; our `ADVANCED_STEALTH` shape is still valid.

## 3. Recommended changes, in order

### P1 — Geo-targeted proxies (correctness)

The corpus is Swedish/Nordic-heavy and the product's premise is "analyze what
real visitors see". Today we capture what an *American* residential IP sees:
consent walls differ (documented: Svensk Fast's Cookiebot showed no banner →
site replaced by sector-alarm), i18n routing differs (tradera, klarna,
spotify-se, ikea-se, dn, svd fixtures), prices/currency can differ.

```ts
// browserbase.server.ts
export async function createSession(
  opts: { advancedStealth?: boolean; proxyCountry?: string } = {},
) {
  // …
  proxies: opts.proxyCountry
    ? [{ type: "browserbase" as const, geolocation: { country: opts.proxyCountry } }]
    : true,
```

Thread a per-site `geo` field through `corpus/sites.ts` (default `"SE"` for
the Swedish corpus, unset → current behaviour). Then re-run
`freeze-determinism-check` on a couple of CMP-sensitive sites — captures may
legitimately change (that's the point), so goldens need re-promotion where
the banner appears for the first time.

Verified live on our plan (2026-07-29): the config is accepted with no
gating error and the session's traffic exits from a Swedish residential IP
(see "Live-verified" above). Docs caveat: "if there's no proxy in the
specified location, the closest proxy is used" — matches the "none in
region" behaviour already noted in `corpus/README.md`.

### P2 — Region (ships together with P1, not alone)

```ts
import type { SessionCreateParams } from "@browserbasehq/sdk/resources/sessions/sessions";
const region = (process.env.BROWSERBASE_REGION ??
  "eu-central-1") as SessionCreateParams["region"];
```

**Important nuance found while double-checking:** Browserbase's own region
guidance optimizes for proximity to *your driver* ("running browser sessions
in or near your region significantly improves performance") — and our
drivers are US-hosted (Netlify functions, GitHub Actions runners). What
makes Frankfurt right for us anyway is the *proxy path*: page loads flow
browser → proxy → origin, and that path is paid per request (dozens–hundreds
per page), while the driver ↔ browser CDP hop is one persistent socket paid
per round-trip (a handful of `evaluate`s per step).

That also means the two changes are coupled:

- **SE proxy + `eu-central-1`** → browser→proxy→origin all short. ✔
- SE proxy + `us-west-2` (P1 alone) → every page request crosses the
  Atlantic browser→proxy. Worse than intended.
- US proxy + `eu-central-1` (P2 alone) → every page request crosses the
  Atlantic **twice** (Frankfurt→US proxy→SE origin). Actively worse than
  today. **Don't ship P2 without P1.**

The live-view iframe (the owner, in Sweden) also gets closer with Frankfurt.
Roll out behind the env override, and measure on a handful of corpus sites:
freeze wall-time + `loadStateDegraded` rate before/after is the acceptance
test.

### P3 — Plan-aware concurrency + 429 handling

`MAX_RENDERS = 3` ("plan-gräns") is a fossil — **verified live 2026-07-29**:
`projects.retrieve()` returns `concurrency: 25` for our project. Git history
shows the cap was written in with the comment on day one (`eaddb4b`); nothing
ever *hit* a limit at 4+ — "höll på 3" meant the run was stable at 3, not
that more failed. We throttle our stated bottleneck to 12 % of entitlement.

- Size the semaphore at runtime: `(await client.projects.retrieve(projectId)).concurrency`,
  minus a reserve of 1–2 for the interactive app, capped by the script's own
  `CONC`.
- Wrap `createSession` in a 429 handler honoring `retry-after` (the API
  sends it; today a burst just throws). Creates/min limits also exist
  (Developer 25/min) — the retry handles those too.

### P4 — Attribution + orphan sweep

```ts
userMetadata: { pipeline, site, runId },   // ≤512 chars total
```

- Log `https://www.browserbase.com/sessions/${id}` in run artifacts and
  failure reports — every session already has video + network/console logs
  waiting in the dashboard (retention: 7 days on Developer, 30 on Startup).
- Add a tiny `scripts/bb-sweep.ts`: `sessions.list({ status: "RUNNING" })` →
  `REQUEST_RELEASE` anything older than N minutes with none of our metadata
  or a dead runId. Crashed fleet runs currently leak sessions until the
  16-minute timeout bills out.

### P5 — Post-mortems + cost telemetry

- On freeze/fleet failure: fetch `sessions.logs.list(id)`, store alongside
  `freeze-report.json`; link the recording. First target: the intermittent
  CDP `-32000` MHTML failure ("root cause not isolated",
  `freeze.server.ts`) — the CDP event log around the failed
  `Page.captureSnapshot` is the missing evidence.
- Nightly summary: one `projects.usage()` call → `{ browserMinutes,
  proxyBytes }` trend line. Per-run: `sessions.retrieve(id).proxyBytes`
  identifies which sites eat proxy GB (billed per GB: ~$12/GB Developer,
  $10/GB Startup beyond included 1/5 GB). **This is not hypothetical: the
  account has already pushed 25.17 GB through residential proxies**
  (live-checked 2026-07-29) — at metered rates that dwarfs the
  browser-minute spend, and no one is watching the number.

### P6 — Contexts, selectively (design decision)

Persistent profiles fit two paths — and must stay OUT of a third:

- **Repeat audits/previews of the same customer site**: accept the CMP once,
  persist (`browserSettings.context: { id, persist: true }`), stop
  re-dismissing consent on every run. One live session per context at a time.
- **Logged-in funnels (roadmap)**: authenticate once via the live-view
  iframe (it's interactive — the customer can type credentials into their
  own site), persist the context, analyze post-login pages. This is the
  platform-blessed auth pattern and a real product unlock.
- **Never in the corpus freeze**: N independent cold captures → byte-identical
  golden is the determinism contract; persisted state would poison it.

### P7 — The capture ceiling is commercial

`advancedStealth` (and the newer `verified`) live on the **Scale plan**. Our
code is already wired to attempt-and-fallback, so adoption is: upgrade plan,
flip the opt-in at the call sites that face PerimeterX/Akamai/Cloudflare
walls, measure the capture-rate delta on the known-blocked list. Given
`docs/section-scale-2026-07-25.md` ("no typing change beats capturing the
page"), the ROI question is price-of-Scale vs. value of the blocked ~18%.
Decide with the pricing page, not more engineering.

## 4. Stagehand (v3.7.0 installed)

Used strictly as a Playwright transport; the AI layer is dead weight today:

- `act`/`extract`/`observe` are reachable only via step kinds nothing emits;
  `click`/`fill` throw "use act instead"; `agent()` unreferenced; no model
  configured anywhere. Either wire the one genuinely useful case — consent
  banners with no stable selector, via the existing-but-throwing
  `consentInstruction` path — or delete the dead step kinds. If revived:
  Stagehand v3 has **server-side act caching** (`cacheStatus: HIT/MISS`,
  disable via `serverCache: false`) and deterministic replay, which blunts
  the determinism objection; model is a single `"provider/model"` string and
  we already ship an Anthropic key.
- Keep the hard-won quirk workarounds documented where they live (positional
  `setViewportSize`, page-on-`context`-not-`stagehand.page`, no
  `page.keyboard`, no `page.route`, non-Playwright timeout errors) — they're
  version-sensitive; re-verify on every Stagehand minor bump. Longer-term
  cleanup: one connection style per pipeline (Stagehand for app + freeze,
  raw CDP for scripts) instead of the current mix.

## 5. Housekeeping done in this review

- Deleted `api/browserbase` — a 16-byte stray ("api browserbase") committed
  accidentally in #131; the `api/` directory carried nothing else.

## 6. What we're already doing right (keep)

- Local pinned Chromium for replay/scoring; Browserbase only where its
  network position + stealth matter. This is the cost-correct split.
- Single wrapper owning session lifecycle; explicit idempotent release on
  every path (timeout is a backstop, not the mechanism).
- Session recycling at 11 min in fleet runs; bounded create/connect with
  retries (the 3h-hang fix).
- The frozen-screenshot live-view replacement (no session minutes burned on
  backgrounded tabs).
- Advanced-stealth attempt-with-fallback pre-wiring — ready the day the plan
  allows it.
