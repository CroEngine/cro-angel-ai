# Database — owned via the Supabase CLI

The Postgres schema for Angel Adaptive lives in `supabase/migrations/` and is
applied with the **Supabase CLI** (pinned as a devDependency), **not** through
Lovable. This repo is the single source of truth for the schema.

> ⚠️ **One owner only.** Do not let Lovable *also* apply migrations to the same
> project — two owners will drift. We own migrations + type generation here.

- **Project:** `hmhuqqgckuujxwrtdrkj` (in `supabase/config.toml`)
- **Migrations:** `supabase/migrations/*.sql` — timestamped, additive, applied in order
- **Generated types:** `src/integrations/supabase/types.ts` — do not hand-edit

## One-time: link the project

```bash
bun run db:link        # supabase link --project-ref hmhuqqgckuujxwrtdrkj
```

Prompts for the database password (or set `SUPABASE_DB_PASSWORD`). Link state is
stored under `supabase/.temp/` (gitignored).

## Everyday flow

```bash
# 1. add/edit a migration in supabase/migrations/
bun run db:push        # apply pending migrations to the linked project
bun run db:types       # regenerate src/integrations/supabase/types.ts
# 2. commit BOTH the migration and the regenerated types.ts
```

`bun run db:diff` shows the schema diff vs. the linked DB if you need to inspect drift.

## Credentials (secrets — see [SECRETS.md](../SECRETS.md))

| Variable | Used for | Where it lives |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | CLI auth (`db push`, `gen types`) | your shell / CI secret |
| `SUPABASE_DB_PASSWORD` | `db push` / `db:link` non-interactive | your shell / CI secret |

`SUPABASE_ACCESS_TOKEN` comes from the Supabase dashboard → **Account → Access
Tokens**. Both are secrets — never commit them.

## Where this runs

`db push` opens a **direct connection** to the Postgres database. Run it from your
machine or CI — a managed cloud sandbox may not be able to reach the DB directly.
The migration SQL is authored in the repo regardless of where it's applied; only
the *apply* step needs DB reachability.

## CI — migrate on merge

`.github/workflows/db-migrate.yml` runs `db:push` + `db:types` when a migration
lands on `main` (and on manual **Run workflow** dispatch), then commits the
refreshed `types.ts` back — so the schema applies itself without anyone running the
CLI by hand.

It needs two repo **Actions** secrets (Settings → Secrets and variables → Actions):

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

Until those are set, the job **no-ops and stays green**. Note: the commit-back
pushes to `main`, so if `main` has branch protection that blocks the
`github-actions` bot, allow it (or swap in a PAT).
