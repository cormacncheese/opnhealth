# OpnHealth

An open data intelligence layer for consumer products. Public datasets and
submitted lab reports (COAs) are reviewed by AI agents, and every source,
decision and correction is written to a public, hash-chained ledger.

| Path | What |
|---|---|
| `apps/web` | Next.js website (deploys to Vercel, root directory `apps/web`) |
| `apps/ios` | SwiftUI iOS app (`xcodegen generate` in `apps/ios`) |
| `supabase/migrations` | Schema, ledger, queues, cron, row level security |
| `supabase/functions` | Edge Functions: agent worker, source sync, COA upload, data export |
| `apps/worker` | Cloudflare Worker that can run the agent pipeline |
| `evals` | Golden set of lab reports and the scoring runner that gates agent changes |
| `tests` | Unit tests and database tests |

## Local development

```sh
yarn install
supabase start                       # local stack on ports 553xx
cp supabase/functions/.env.example supabase/functions/.env
supabase functions serve --env-file supabase/functions/.env
cp apps/web/.env.example apps/web/.env.local   # values from `supabase status`
yarn dev                             # http://localhost:3100
yarn test && yarn test:db
```


## Agent runtime on Cloudflare

`apps/worker` runs the agent pipeline on Cloudflare Workers and Queues. pgmq
in Postgres stays the job store; pg_cron posts to the Worker's `/dispatch`
when work is waiting. To switch from the Edge Function:

```sh
cd apps/worker
npx wrangler queues create opnhealth-agent-jobs
npx wrangler queues create opnhealth-agent-jobs-dlq
for s in WORKER_SECRET SUPABASE_DB_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY AI_GATEWAY_API_KEY; do npx wrangler secret put $s; done
npx wrangler deploy
```

Then add the Vault secret `agent_worker_url` = `https://<worker host>/dispatch`.

## Hosted setup

1. Link and migrate: `supabase link --project-ref <ref>` then `supabase db push`.
2. Function secrets: `supabase secrets set WORKER_SECRET=<random> AI_GATEWAY_API_KEY=<key>` (optionally `FDC_API_KEY`, `AGENT_MODEL`, `AGENT_MODEL_FAST`).
3. Deploy functions: `supabase functions deploy`.
4. Vault secrets, which switch on the cron jobs (run in the SQL editor):
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<the same WORKER_SECRET>', 'worker_secret');
   ```
5. Add maintainers: `insert into public.maintainers (user_id) values ('<auth user id>');`
6. Website on Vercel: root directory `apps/web`, framework Next.js, with
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## Evals

`yarn evals` runs the golden set in `evals/cases.ts` through the real agents
against the local stack and compares the scores with `evals/baseline.json`.
CI runs it on any pull request that touches the agents, and nightly on `main`.
Nightly results are written to the hosted `eval_runs` table
(`EVAL_RESULTS_DATABASE_URL` secret); a failing run makes the Supervisor pause
publishing until a passing run is recorded. GitHub secrets needed:
`AI_GATEWAY_API_KEY` and, for nightly runs, `EVAL_RESULTS_DATABASE_URL`.

The cases are synthetic. Add real, hand-labelled reports to measure reading
accuracy on messy scans.

## Checking the ledger

Every row in `events` stores `prev_hash` and `hash`, where `hash` is the
SHA-256 of the previous hash and the entry's fields joined by `|` (see
`private.event_hash` in `supabase/migrations`). Anyone can call
`rpc/verify_ledger?from_seq=1&to_seq=N`, or recompute the chain from the
nightly export, whose manifest records the ledger head.

## Licences

Code: Apache-2.0 (`LICENSE`). Data: ODbL-1.0 (`DATA_LICENSE.md`).
