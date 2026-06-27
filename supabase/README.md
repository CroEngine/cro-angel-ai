# Supabase (direct)

We run Supabase **directly** (via the Supabase CLI / dashboard), not through
Lovable Cloud. This is the source of truth for schema and types.

## Environment variables

Set these in the deployment environment (and `.env` for local dev):

| Variable | Used by | Notes |
|----------|---------|-------|
| `SUPABASE_URL` | server + client | Project URL, `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | client (anon) | Safe to expose; RLS applies |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Secret. Bypasses RLS. Required for event/inventory persistence (`src/integrations/supabase/client.server.ts`). **Never** prefix with `VITE_`. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | client build | Vite inlines these at build time |

Without `SUPABASE_SERVICE_ROLE_KEY` the adaptive runtime still works — event and
inventory writes are best-effort and simply no-op (see `src/adaptive/persistence.server.ts`).

## Apply migrations

Migrations live in `supabase/migrations/`. Apply them straight to the project:

```bash
supabase login
supabase link --project-ref <project-ref>     # ref is in supabase/config.toml
supabase db push                              # applies supabase/migrations/*
```

Or paste a migration's SQL into the dashboard SQL editor.

## Regenerate typed schema

After the schema changes, regenerate the typed client so the code is fully typed:

```bash
supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

Once `types.ts` includes the `angel_*` tables, remove the temporary local-contract
cast in `src/adaptive/persistence.server.ts` and use the generated row types
directly (`supabaseAdmin.from("angel_events")` etc. become fully typed).

## Schema overview

`20260627153836_adaptive_core.sql` creates:

- `angel_sites` — one row per installed customer site.
- `angel_content_inventory` — published content the crawler extracted
  (written by `saveInventory`, read by `loadInventoryRows`).
- `angel_events` — analytics + decision/adaptation log (blueprint Step 8).

RLS is enabled and locked down — all runtime access is server-side via the
service role. Dashboard read policies (anon/authenticated) come in a later
migration once auth/tenancy is wired.

> Note: the auto-generated files under `src/integrations/supabase/` still print
> "Connect Supabase in Lovable Cloud" when env vars are missing. That string is
> cosmetic — the clients read the standard `SUPABASE_*` variables above.
