-- Local development only. Hosted projects set these two secrets by hand
-- (see README) so the cron jobs can reach the Edge Functions.
select vault.create_secret('http://api.supabase.internal:8000', 'project_url');
select vault.create_secret('local-worker-secret', 'worker_secret');
