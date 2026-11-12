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
| `tests` | Unit tests and database pipeline tests |

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

Code is Apache-2.0. Published data is ODbL-1.0.

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
