# Go-live checklist — from code-complete to selling

The funnel is code-complete and wired end-to-end:

> paste URL → `/try` example + report → **Start free** → `/signup` → dashboard →
> Stripe checkout (card on file, **free until proven**) → install snippet →
> collect → nightly loop generates + verifies a variant → you approve → A/B
> measures → `sweepProvenBilling` charges 7 days after the first verified variant.

What stands between that and a paying customer is **configuration, not code**:
apply the DB schema, set env vars, wire Stripe, deploy, verify. This is the map.

---

## 1. Apply the database schema (the one real landmine)

There is **no auto-apply** — migrations in `supabase/migrations/` must be pushed
to the project or features break silently (`/try` needs `angel_preview_jobs`,
billing needs `angel_billing`, etc.).

Two ways:

- **One click (new):** GitHub → Actions → **DB migrate** → Run workflow. Leave
  `mode=list` first to preview pending migrations, then run again with
  `mode=push` to apply. Requires repo secrets `SUPABASE_ACCESS_TOKEN` and
  `SUPABASE_DB_PASSWORD` (see §3).
- **Local CLI:** `supabase link --project-ref upvthvbhqzqqimsyjpxw && supabase db push`.

After applying, regenerate the typed client if the schema changed:
`supabase gen types typescript --linked > src/integrations/supabase/types.ts`.

---

## 2. Netlify environment variables (runtime + client build)

Netlify → Site settings → Environment variables. **Changes only take effect on a
new deploy.**

| Variable | Required? | Without it |
|---|---|---|
| `SUPABASE_URL` | **yes** | server has no backend — dashboard empty, `/decide`+`/events` no-op |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** (secret) | same as above |
| `SUPABASE_PUBLISHABLE_KEY` | **yes** | client can't read (anon, RLS applies) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | **yes** (build-time) | client build has no Supabase |
| `ANTHROPIC_API_KEY` | **yes** | CTA/goal classification at ingest degrades to the deterministic floor |
| `STRIPE_SECRET_KEY` | **to charge** | checkout is a polite no-op (funnel works up to signup) |
| `STRIPE_PRICE_ID` | **to charge** | checkout can't build a line item |
| `STRIPE_WEBHOOK_SECRET` | **to charge** | subscription status never syncs back |
| `RESEND_API_KEY` + `NOTIFY_FROM` | recommended | the trust emails (installed / week-one / variant-ready) are **log-only** |
| `APP_ORIGIN` | recommended | email links default to `croengine.netlify.app` |
| `ANGEL_GH_DISPATCH_TOKEN` + `ANGEL_GH_REPO` | optional | `/try` previews wait ≤15 min for the cron instead of firing instantly |

Kill-switches (default **on**, set to `0` only to disable): `ANGEL_PREVIEW_FUNNEL`
(the paste-URL funnel), `ANGEL_INVENTORY_INGEST` (event/inventory writes).

---

## 3. GitHub repo secrets (the scheduled Actions)

Repo → Settings → Secrets and variables → Actions.

| Secret | Used by | Required? |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | nightly-loop, preview-jobs, day0-review | **yes** (loops no-op without them) |
| `ANTHROPIC_API_KEY` | nightly-loop (variant generation), preview granska | **yes** for variants + `/try` reports |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | **DB migrate** workflow | for the one-click apply in §1 |
| `GOOGLE_PAGESPEED_API_KEY` | CWV gate | optional |
| `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` | crawler **+ SPA rendering** of the paste-URL freeze (a remote stealth browser that reaches live sites and dodges datacenter bot-blocks; without it, SPA shells fall back to the static copy) | recommended |

---

## 4. Stripe setup (one-time)

1. **Product + Price** — create a Product with a **recurring $399/month** price →
   copy the price id into `STRIPE_PRICE_ID`. (The "free until proven" trial is set
   per-checkout by the code, not on the price — see `billing.ts` `PLAN`.)
2. **Secret key** — `STRIPE_SECRET_KEY` (Developers → API keys).
3. **Webhook** — add an endpoint at `https://<your-domain>/api/stripe/webhook`
   subscribed to `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted` → copy the
   signing secret into `STRIPE_WEBHOOK_SECRET`.

The trial shortens to a 7-day notice the moment a site earns its first verified
variant (`sweepProvenBilling`, nightly) — that's the whole pricing promise: the
card waits until the robot has earned it.

---

## 5. Verify the funnel (the "can we sell it" walkthrough)

1. **Paste** a real URL on `/` (or `/try`) → within ~15 min (instant with the
   dispatch token) an honest example + full before/after report appears.
2. **Start free** → `/signup` → create an account → land on the dashboard.
3. Confirm the conversion goal → **add card** → Stripe Checkout opens (test mode
   first). Card captured, subscription `trialing`, nothing charged.
4. **Install the one-line snippet** on a real site → visit it → the dashboard's
   journey advances (installed → mapped → profiled → segments).
5. Let the nightly loop run (or trigger `nightly-loop` manually) → a variant is
   generated + verified → `variant_ready` email → **approve** in the dashboard.
6. The variant serves against a held-back control; once verified,
   `sweepProvenBilling` shortens the trial → first invoice after the 7-day grace.

If steps 1, 3, and 5 each produce their artifact, the money path is live.

---

## 6. What degrades gracefully (safe to defer)

Every external dependency fails to a **logged no-op**, never a crash — so you can
launch the top of the funnel before wiring the bottom:

- No Stripe → funnel works through signup; no card, no charge.
- No Resend → the trust loop still runs; emails just log instead of send.
- No dispatch token → previews are ≤15 min slower.
- No PageSpeed / Browserbase → CWV gate and crawler features skip.

The only hard requirements to have *anything* work are the `SUPABASE_*` vars and
the applied schema (§1–2).
