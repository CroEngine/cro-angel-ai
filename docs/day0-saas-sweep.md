# Day-0 cold-start sweep — 104 SaaS sites, no data

**Dates:** 2026-07-20 (13 sites, engine v1.19) + the overnight expansion to 104
(engine v1.19 baseline → v1.20 fixes → targeted re-runs)
**Runner:** `scripts/day0-saas-sweep.ts` (`--from/--to` batches, `--names` re-runs)
**Dataset:** latest run per site (engine version annotated per row, appendix).

The new-prospect moment, end to end: point the engine at a homepage it has
never seen — **no database, no baseline, no install, no LLM** — and record what
it understands: hero, primary CTA, trust signals with evidence text, section
map. All sites are outside the benchmark corpora (true hold-out). Claims were
verified against full-page screenshots: every anomaly, plus a 20+-site sample
of passes.

## Final headline numbers (104 sites)

| metric | result |
|---|---|
| attempted / audited | **104 / 100** (4 failures, all named below) |
| hero headline (h1) read correctly | 99/100 |
| hero primary CTA asserted | **93/100** |
| **consent-button hero picks** | **0** (v1.19 had 3 — all eliminated by v1.20) |
| audit zero-outs (0 CTAs & 0 sections) | 1 (bamboohr, intermittent render; v1.19 had 3) |
| real trust signals found | **94/100** |
| sales-led motion recognized ("Book a demo"-class pick) | 22 sites |
| Swedish/Nordic subset | 15 audited, 14 hero CTAs asserted |

The engine reads the *go-to-market motion*, not just buttons: PLG products get
"Start free trial"/"Sign up" picks, sales-led products get "Book a demo"
(teamtailor, getaccept, oneflow, voyado, personio, retool, hotjar, mixpanel,
mynewsdesk, upsales …), and hybrid pages get the visible dominant action.

## The overnight loop: sweep → bugs → v1.20 → re-run

The sweep wasn't just a demo — it was used as a live benchmark. Running 91 new
sites overnight surfaced **seven engine defects**; all were fixed the same
night (v1.20 a–g), validated against the full regression stack (192 tests,
snapshot goldens byte-identical, trust-eval P 98.1/R 83.6 unchanged,
structure-eval CTA pick 85.7% unchanged), and the affected sites re-run:

| bug (site that exposed it) | v1.19 behavior | v1.20 behavior |
|---|---|---|
| Piwik PRO CMP unstamped (fortnox 🇸🇪) | hero CTA = **"Reject all"** | "Starta företag" ✓ |
| Enveloping cookie-root wipes all CTAs (typeform) | audit saw **0 CTAs** | "Get started—it's free" ✓ |
| Same, netlify | audit zeroed | "Start building" ✓ |
| Same, mailerlite | audit zeroed | "Sign up free" ✓ |
| `create account` regex too strict (epidemicsound 🇸🇪) | no CTA asserted | "Create free account" ✓ |
| Ungated form_submit fallback (quinyx 🇸🇪) | hero CTA = "Search Button" | honest empty (junk refused) ✓ |
| "Reject optional" variant (remote.com) | consent button picked | honest empty ✓ |
| "More Options" privacy-bar button (moz) | junk pick | honest empty ✓ |
| Nordic CMP vendors unstamped (quinyx/oneflow/teamtailor/kahoot) | element-level consent junk | stamped + filtered |

Design stance made explicit by these fixes: **when no clean conversion action
exists, the engine asserts nothing** rather than junk. An empty pick is
recoverable downstream (LLM fallback, human review); a cookie button served as
"the hero CTA" is not.

## Honest failures & known limitations

- **attio, clay, loops** — the remote Chromium tab itself crashes on load
  (`Page crashed`, reproducible in fresh sessions). WebGL/animation-heavy
  pages; an environment limitation, not a detection result.
- **contentful** — intermittent engine crash (`getComputedStyle: parameter 1
  is not of type 'Element'`): a transient-DOM race in an audit script (passed
  on one of three runs). Open bug, tracked.
- **bamboohr** — renders intermittently (audited fine once, zeroed twice);
  suspected bot-variance.
- **5 honest empty picks** (quinyx, whereby, auth0, algolia, remotecom) — real
  CTAs exist on-screen but the audit layer scored none as a clean primary;
  recall work, not precision work.
- **calcom** — picks its "launches v6.7" announcement banner; announcement-
  banner rejection is a candidate v1.21 gate.
- Element-level `cta_primary` remains over-broad on ~⅓ of sites (the precise
  layer is `deriveHero`); trust **counts** can inflate on badge walls
  (clickup's honeycomb) though type-presence stays correct.

## Reproduce

```bash
bun build scripts/day0-saas-sweep.ts --target=node --format=esm \
  --outfile=day0.node.mjs --external playwright --external @browserbasehq/sdk
NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
  node day0.node.mjs --from=0 --to=104        # or --names=a,b,c
```

Per-site JSON + above-fold & full-page screenshots land in the session
scratchpad; the merged dataset is `day0-sweep-FINAL.json` there.

## Flagship demo sites (screenshot-verified)

monday ("You lead. Agents act." / "Get Started"), calendly ("Sign up with
Google"), deel ("Book a demo"), basecamp ("Try Basecamp free" + 12-quote
wall), mentimeter 🇸🇪 (correct through a cookie modal), teamtailor 🇸🇪 ("Book a
demo" + 13,000-companies claim), bokio 🇸🇪 ("Skapa konto"), sentry ("GET
STARTED"), railway ("Deploy →"), slack, dropbox, canva (picked right among 107
CTAs), ramp & personio (correct despite modals covering the hero), savvycal,
clickhouse, pipedrive, close, grammarly, toggl, wrike, smartsheet, docusign,
vanta, chargebee, paddle …

## Appendix — all 104 sites (latest run each)

<!-- table generated from day0-sweep-FINAL.json -->
| # | site | hero CTA pick | trust | sections | engine | note |
|---|---|---|---|---|---|---|
| 1 | monday | Get Started | 5 | 13 | 1.19.0 |  |
| 2 | asana | Get started | 4 | 12 | 1.19.0 |  |
| 3 | clickup | Get started. It's FREE! | 141 | 12 | 1.19.0 |  |
| 4 | calendly | Sign up with Google | 3 | 12 | 1.19.0 |  |
| 5 | zapier | Start free with email | 10 | 12 | 1.19.0 |  |
| 6 | airtable | Get started for free | 4 | 14 | 1.19.0 |  |
| 7 | webflow | Start for free | 8 | 9 | 1.19.0 |  |
| 8 | typeform | Get started—it’s free | 13 | 11 | 1.20.0g |  |
| 9 | posthog | Get started – free | 3 | 3 | 1.19.0 |  |
| 10 | basecamp | Try Basecamp free | 13 | 6 | 1.19.0 |  |
| 11 | deel | Book a demo | 19 | 6 | 1.19.0 |  |
| 12 | mentimeter | Sign up with Google | 3 | 15 | 1.19.0 |  |
| 13 | fortnox | Starta företag | 2 | 12 | 1.20.0g |  |
| 14 | teamtailor | Book a demo | 16 | 14 | 1.19.0 |  |
| 15 | quinyx | — | 4 | 15 | 1.20.0g | no clean CTA asserted |
| 16 | getaccept | Book a demo | 32 | 17 | 1.19.0 |  |
| 17 | oneflow | Book a demo | 29 | 18 | 1.19.0 |  |
| 18 | scrive | Buy now | 4 | 38 | 1.19.0 |  |
| 19 | voyado | Book a demo | 3 | 10 | 1.19.0 |  |
| 20 | funnel | GET A DEMO | 6 | 22 | 1.19.0 |  |
| 21 | epidemicsound | Create free account | 8 | 13 | 1.20.0g |  |
| 22 | pleo | Get Started | 0 | 4 | 1.19.0 |  |
| 23 | dixa | Book a demo | 16 | 12 | 1.19.0 |  |
| 24 | whereby | — | 3 | 12 | 1.20.0g | no clean CTA asserted |
| 25 | kahoot | Sign up FREE | 4 | 10 | 1.19.0 |  |
| 26 | unleash | Start Free Trial | 17 | 30 | 1.19.0 |  |
| 27 | juni | Get started | 0 | 10 | 1.19.0 |  |
| 28 | trustly | Start your engine | 3 | 10 | 1.19.0 |  |
| 29 | sentry | GET STARTED | 6 | 10 | 1.19.0 |  |
| 30 | retool | Book a demo | 4 | 9 | 1.19.0 |  |
| 31 | railway | Deploy → | 12 | 9 | 1.19.0 |  |
| 32 | render | Start for free | 4 | 4 | 1.19.0 |  |
| 33 | flyio | Get Started | 4 | 13 | 1.19.0 |  |
| 34 | netlify | Start building | 6 | 0 | 1.20.0g |  |
| 35 | neon | Get started | 14 | 10 | 1.19.0 |  |
| 36 | clerk | Start building for free | 6 | 12 | 1.19.0 |  |
| 37 | auth0 | — | 4 | 9 | 1.20.0g | no clean CTA asserted |
| 38 | algolia | — | 6 | 11 | 1.20.0g | no clean CTA asserted |
| 39 | contentful | — | — | — | 1.20.0g | FAILED: page.evaluate: TypeError: Failed to exec |
| 40 | sanity | Start building | 9 | 15 | 1.19.0 |  |
| 41 | strapi | Get Started | 6 | 9 | 1.19.0 |  |
| 42 | ghost | Get Started — free | 1 | 16 | 1.19.0 |  |
| 43 | resend | Get started | 17 | 15 | 1.19.0 |  |
| 44 | n8n | Talk to sales | 24 | 11 | 1.19.0 |  |
| 45 | mailchimp | Start Free Trial | 5 | 13 | 1.19.0 |  |
| 46 | klaviyo | Sign up | 4 | 16 | 1.19.0 |  |
| 47 | activecampaign | Start trial | 5 | 12 | 1.19.0 |  |
| 48 | mailerlite | Sign up free | 5 | 0 | 1.20.0g |  |
| 49 | beehiiv | Get a demo | 6 | 14 | 1.19.0 |  |
| 50 | hotjar | Book a demo | 4 | 8 | 1.19.0 |  |
| 51 | mixpanel | Book a Demo | 2 | 6 | 1.19.0 |  |
| 52 | amplitude | Start for free | 0 | 8 | 1.19.0 |  |
| 53 | segment | Start for free | 0 | 5 | 1.19.0 |  |
| 54 | customerio | Get started Get started | 9 | 11 | 1.19.0 |  |
| 55 | semrush | Sign Up | 3 | 20 | 1.19.0 |  |
| 56 | ahrefs | Get Started | 13 | 17 | 1.19.0 |  |
| 57 | moz | — | 15 | 20 | 1.20.0g | no clean CTA asserted |
| 58 | surferseo | Try Surfer Platform → | 8 | 11 | 1.19.0 |  |
| 59 | pipedrive | Try it free | 13 | 18 | 1.19.0 |  |
| 60 | close | Start free with Google | 12 | 16 | 1.19.0 |  |
| 61 | gorgias | Book a demo | 3 | 13 | 1.19.0 |  |
| 62 | helpscout | Start for Free | 2 | 15 | 1.19.0 |  |
| 63 | front | Request demo | 18 | 11 | 1.19.0 |  |
| 64 | aircall | TRY FOR FREE | 7 | 12 | 1.19.0 |  |
| 65 | slack | GET STARTED | 10 | 24 | 1.19.0 |  |
| 66 | dropbox | Try Dropbox free | 2 | 15 | 1.19.0 |  |
| 67 | miro | Get started free | 9 | 6 | 1.19.0 |  |
| 68 | canva | Start designing | 0 | 9 | 1.19.0 |  |
| 69 | grammarly | Sign up It’s free | 10 | 8 | 1.19.0 |  |
| 70 | todoist | Start for free | 7 | 10 | 1.19.0 |  |
| 71 | superhuman | Sign up | 1 | 7 | 1.19.0 |  |
| 72 | calcom | Cal.com launches v6.7 | 4 | 12 | 1.20.0g | announcement-banner pick (known) |
| 73 | toggl | Start tracking for free | 7 | 9 | 1.19.0 |  |
| 74 | wrike | Try Wrike for free | 14 | 11 | 1.19.0 |  |
| 75 | smartsheet | Watch a demo | 5 | 4 | 1.19.0 |  |
| 76 | gusto | Create account | 7 | 13 | 1.19.0 |  |
| 77 | rippling | Create free account | 13 | 12 | 1.19.0 |  |
| 78 | bamboohr | — | 1 | 0 | 1.20.0g | intermittent render |
| 79 | personio | Book your demo | 9 | 10 | 1.19.0 |  |
| 80 | remotecom | — | 14 | 27 | 1.20.0g | no clean CTA asserted |
| 81 | ramp | Get started for free | 19 | 23 | 1.19.0 |  |
| 82 | mercury | Launch demo | 6 | 15 | 1.19.0 |  |
| 83 | onepassword | Get started free | 2 | 6 | 1.19.0 |  |
| 84 | vanta | Get a demo | 13 | 12 | 1.19.0 |  |
| 85 | docusign | TRY FOR FREE | 4 | 18 | 1.19.0 |  |
| 86 | pandadoc | Get Started | 5 | 9 | 1.19.0 |  |
| 87 | chargebee | Get a Demo | 7 | 7 | 1.19.0 |  |
| 88 | paddle | Get started | 1 | 8 | 1.19.0 |  |
| 89 | bokio | Skapa konto | 1 | 16 | 1.20.0 |  |
| 90 | mynewsdesk | Book a demo | 4 | 17 | 1.20.0 |  |
| 91 | upsales | Book demo | 8 | 15 | 1.20.0 |  |
| 92 | sanalabs | Book an intro | 1 | 3 | 1.20.0 |  |
| 93 | framer | Sign up | 7 | 8 | 1.20.0 |  |
| 94 | lemlist | Start for free | 7 | 10 | 1.20.0 |  |
| 95 | apollo | Sign up for free | 6 | 3 | 1.20.0 |  |
| 96 | attio | — | — | — | 1.20.0 | FAILED: page.goto: Page crashed |
| 97 | clay | — | — | — | 1.20.0 | FAILED: page.goto: Page crashed |
| 98 | loops | — | — | — | 1.20.0 | FAILED: page.goto: Page crashed |
| 99 | savvycal | Try SavvyCal risk-free | 3 | 9 | 1.20.0 |  |
| 100 | postmark | Start free trial | 0 | 10 | 1.20.0 |  |
| 101 | lucid | Sign up free | 1 | 8 | 1.20.0 |  |
| 102 | coda | Request a demo | 4 | 16 | 1.20.0 |  |
| 103 | planetscale | Watch the talk | 11 | 3 | 1.20.0 |  |
| 104 | clickhouse | Start free cloud trial | 1 | 14 | 1.20.0 |  |
