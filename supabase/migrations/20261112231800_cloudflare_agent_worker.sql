-- Agent work can run on a Cloudflare Worker instead of the agent-worker Edge
-- Function. Set the Vault secret `agent_worker_url` to the Worker's /dispatch
-- address to switch; remove it to switch back.

create or replace function private.invoke_function(p_name text, p_body jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_secret text;
  v_url text;
begin
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret';
  if v_base is null or v_secret is null then
    return;
  end if;

  if p_name = 'agent-worker' then
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'agent_worker_url';
  end if;

  perform net.http_post(
    url := coalesce(v_url, v_base || '/functions/v1/' || p_name),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    body := p_body,
    timeout_milliseconds := 150000
  );
end;
$$;
