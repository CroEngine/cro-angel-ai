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
`crawl_runs`, `content_inventory` — the M0 + M2 tables. **They are already applied
to the collector project `upvthvbhqzqqimsyjpxw`**, so there's nothing to run before
deploying. (The migration SQL itself — `…_m0_adaptive_foundation.sql`,
`…_m2_content_inventory.sql` — ships via the M0/M2 PR; you only need
`supabase db push` if you ever stand up a fresh project.)

> ⚠️ **Two projects, on purpose.** `supabase/config.toml` stays pointed at
> `hmhuqqgckuujxwrtdrkj` (the Lovable-managed app project) — **don't repoint it**,
> or Lovable's own deploys get confused. The collector and its M0/M2 schema live on
> the self-managed project **`upvthvbhqzqqimsyjpxw`**. Target that project
> explicitly with `supabase link --project-ref upvthvbhqzqqimsyjpxw` (below) so the
> CLI deploys there without touching `config.toml`.

## Deploy

```bash
# point the CLI at the self-managed collector project (leaves config.toml alone)
supabase link --project-ref upvthvbhqzqqimsyjpxw

# schema is already applied on upvthvbhqzqqimsyjpxw — skip unless it's a fresh project
# supabase db push

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
-- owner_user_id references auth.users. In the dashboard SQL editor auth.uid() is
-- NULL (it runs as the service role, not a signed-in user), so grab your real id
-- first and paste it in:  select id, email from auth.users;
insert into public.sites (owner_user_id, domain, public_site_key, allowed_origins)
values (
  '00000000-0000-0000-0000-000000000000',          -- ← your auth.users.id
  'glutenforum.se', 'glutenforum', array['https://glutenforum.se']
);
```

## Install the snippet

```html
<script src="https://<your-domain>/adaptive.js"
        data-site-id="glutenforum"
        data-endpoint="https://upvthvbhqzqqimsyjpxw.supabase.co/functions/v1/collect"></script>
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
