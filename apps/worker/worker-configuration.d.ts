// Replace by running `yarn workspace @opnhealth/worker types` once logged in to Wrangler.
interface Env {
  AGENT_JOBS: Queue<{ queue: string }>;
  WORKER_SECRET: string;
  SUPABASE_DB_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  AI_GATEWAY_API_KEY: string;
}
