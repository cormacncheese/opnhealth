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
