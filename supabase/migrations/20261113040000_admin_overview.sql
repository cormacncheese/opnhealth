-- Operations data for the maintainer dashboard (/admin). Queues, dead letters
-- and scheduler health live in schemas the API does not expose, so these
-- functions read them on behalf of maintainers only.

create function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  queues jsonb := '[]';
  q text;
  m record;
  working bigint;
begin
  if not private.is_maintainer() then
    raise exception 'maintainers only' using errcode = '42501';
  end if;

  foreach q in array private.work_queues() || array['dead_letter']
  loop
    select * into m from pgmq.metrics(q);
    -- Messages a worker has read and not yet finished are hidden until vt.
    execute format('select count(*) from pgmq.%I where read_ct > 0 and vt > clock_timestamp()', 'q_' || q)
      into working;
    queues := queues || jsonb_build_object(
      'name', q,
      'waiting', m.queue_length - working,
      'working', working,
      'oldest_seconds', m.oldest_msg_age_sec,
      'total', m.total_messages
    );
  end loop;

  return jsonb_build_object(
    'queues', queues,
    'dead_letters', (
      select coalesce(jsonb_agg(d order by d.enqueued_at desc), '[]') from (
        select msg_id, enqueued_at, message
        from pgmq.q_dead_letter
        order by enqueued_at desc
        limit 25
      ) d
    ),
    'submissions_by_status', (
      select coalesce(jsonb_object_agg(status, n), '{}') from (
        select status, count(*) as n from public.submissions group by status
      ) s
    ),
    'spend_today', (
      select coalesce(jsonb_object_agg(agent, cost), '{}') from (
        select agent, round(sum(cost_usd), 4) as cost
        from public.agent_runs
        where started_at >= date_trunc('day', now())
        group by agent
      ) c
    ),
    'runs_last_hour', (
      select jsonb_build_object(
        'succeeded', count(*) filter (where status = 'succeeded'),
        'failed', count(*) filter (where status = 'failed')
      )
      from public.agent_runs
      where started_at >= now() - interval '1 hour'
    ),
    'scheduler', (
      select coalesce(jsonb_agg(j order by j.jobname), '[]') from (
        select
          job.jobname,
          job.schedule,
          job.active,
          last.status as last_status,
          last.start_time as last_run_at,
          left(last.return_message, 300) as last_message
        from cron.job job
        left join lateral (
          select d.status, d.start_time, d.return_message
          from cron.job_run_details d
          where d.jobid = job.jobid
          order by d.start_time desc
          limit 1
        ) last on true
      ) j
    ),
    'function_calls', (
      select jsonb_build_object(
        'last_hour', count(*),
        'failed', count(*) filter (where r.status_code is null or r.status_code >= 400),
        'last_error', (
          select left(coalesce(r2.error_msg, r2.content::text), 300)
          from net._http_response r2
          where r2.created >= now() - interval '1 hour'
            and (r2.status_code is null or r2.status_code >= 400)
          order by r2.created desc
          limit 1
        )
      )
      from net._http_response r
      where r.created >= now() - interval '1 hour'
    )
  );
end;
$$;

-- Pauses or resumes a pipeline by hand. A manual pause is never lifted by the
-- Supervisor, which only resumes its own automatic pauses.
create function public.admin_set_pipeline(p_pipeline text, p_paused boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_maintainer() then
    raise exception 'maintainers only' using errcode = '42501';
  end if;

  update public.pipeline_controls
  set paused = p_paused,
      paused_reason = case when p_paused then coalesce(nullif(btrim(p_reason), ''), 'paused_by_maintainer') end,
      paused_at = case when p_paused then now() end
  where pipeline = p_pipeline;
  if not found then
    raise exception 'unknown pipeline %', p_pipeline;
  end if;

  perform private.record_event(
    case when p_paused then 'pipeline.paused' else 'pipeline.resumed' end,
    'pipeline', p_pipeline, 'maintainer',
    jsonb_build_object('reason', case when p_paused then coalesce(nullif(btrim(p_reason), ''), 'paused_by_maintainer') end)
  );
end;
$$;

revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_set_pipeline(text, boolean, text) from public, anon;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_set_pipeline(text, boolean, text) to authenticated;
