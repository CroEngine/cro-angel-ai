# `collect` — Angel Adaptive collector

The backend half of **"först samlar vi data"**. The snippet (`adaptive.js`) POSTs
each page's Content Inventory + the visitor's behavior events here; this function
persists them to the M0/M2 schema, keyed by site → visitor → session.

```
adaptive.js  ──POST {siteId, visitorKey, sessionId, url, inventory?, events?}──▶  collect
                                                                                    │
                          sites (public_site_key) · visitors · sessions ·          ▼
                          content_inventory (flattened items) · events  ◀── service-role
```

## Requires the M0 + M2 schema

This function writes to `sites`, `visitors`, `sessions`, `events`,
`crawl_runs`, `content_inventory`. Those tables are defined by the migrations in
`supabase/migrations/` (M0 `…_m0_adaptive_foundation.sql`, M2
`…_m2_content_inventory.sql`). **Apply them before deploying the function.** They
are already applied to project `upvthvbhqzqqimsyjpxw`.

> ⚠️ **Project choice.** `supabase/config.toml` currently points at
> `hmhuqqgckuujxwrtdrkj` (the Lovable-managed project), but the M0/M2 schema lives
> on `upvthvbhqzqqimsyjpxw`. Pick one canonical project, make sure the schema is
> applied there, and deploy this function to the same one. (If you standardize on
> `upvthvbhqzqqimsyjpxw`, update `config.toml`'s `project_id` to match.)

## Deploy

```bash
# link to the chosen project once
supabase link --project-ref <ref>

# apply the schema if it isn't already there
supabase db push

# deploy the function. --no-verify-jwt because the snippet POSTs anonymously,
# cross-origin, from the customer's site — the gate is the Origin allowlist +
# public_site_key, not a JWT.
supabase functions deploy collect --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the
platform; the function uses the service-role client (raw `events` are
service-role-only by design).

## Register a site

Insert one `sites` row per customer site. `public_site_key` is what goes in the
snippet's `data-site-id`; `allowed_origins` gates who may POST (leave empty to
accept any origin during first install, then lock it down):

```sql
insert into public.sites (owner_user_id, domain, public_site_key, allowed_origins)
values (auth.uid(), 'glutenforum.se', 'glutenforum', array['https://glutenforum.se']);
```

## Install the snippet

```html
<script src="https://<your-domain>/adaptive.js"
        data-site-id="glutenforum"
        data-endpoint="https://<project-ref>.functions.supabase.co/collect"></script>
```

That's it — the page now collects in **learn mode** (changes nothing) and ships
inventory + behavior to this function. Flip to adapting later with
`data-mode="adaptive"`.

## Contract (verified by `bun run scripts/collector-check.ts`)

`POST` JSON body:

| field        | notes |
|--------------|-------|
| `siteId`     | → `sites.public_site_key` (required) |
| `v`          | snippet version → `crawl_runs.extractor_version` |
| `url`        | current page URL (required) |
| `visitorKey` | first-party random id (localStorage) → `visitors.visitor_key` |
| `sessionId`  | per-tab uuid (sessionStorage) → `sessions.id` |
| `inventory`  | one `ContentInventory`; flattened into `content_inventory` rows (cta / trust-signal types / section), keyed on `(site_id,url,selector,category)` |
| `events`     | `BehaviorEvent[]` (pageview / scroll_depth / cta_click / time_on_page) → `events` |

Always replies `204` (even on error) so a misconfigured endpoint can never
surface on the host page. Unknown `siteId` or a disallowed `Origin` is silently
ignored.

## Known v1 limitations

- `visitors.is_returning` is not yet set on repeat visits; `sessions`
  aggregates (`max_scroll_pct`, `duration_ms`, `exit_url`) are not updated after
  insert. `events_rollup` is not populated — add a scheduled rollup before the
  dashboard reads it.
- No rate limiting / payload-signature yet; the Origin allowlist is the only
  gate. Add a per-site write token before opening to untrusted installs.
