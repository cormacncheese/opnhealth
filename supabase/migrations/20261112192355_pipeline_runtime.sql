-- Queues, state transitions, catalog ingestion and the cron schedule.

create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Queues: one per agent stage, plus a dead-letter queue
-- ---------------------------------------------------------------------------

create function private.work_queues()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'intake', 'extraction', 'resolution', 'verification', 'adjudication', 'redaction',
    'dispute', 'brand_verification', 'discovery', 'monitor', 'supervisor'
  ];
$$;

do $$
declare
  q text;
begin
  foreach q in array private.work_queues() || array['dead_letter']
  loop
    perform pgmq.create(q);
  end loop;
end;
$$;

create function private.enqueue(p_queue text, p_payload jsonb, p_delay_seconds integer default 0)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select * from pgmq.send(p_queue, p_payload, p_delay_seconds);
$$;

-- Enqueue unless an identical message is already waiting.
create function private.enqueue_once(p_queue text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  already boolean;
begin
  execute format('select exists (select 1 from pgmq.%I where message = $1)', 'q_' || p_queue)
    into already using p_payload;
  if not already then
    perform pgmq.send(p_queue, p_payload);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Submission state
-- ---------------------------------------------------------------------------

create function private.set_submission_status(
  p_submission_id uuid,
  p_status public.submission_status,
  p_actor text,
  p_payload jsonb default '{}',
  p_agent_run_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.submission_status;
begin
  select s.status into previous
  from public.submissions s
  where s.id = p_submission_id
  for update;

  if previous is null then
    raise exception 'submission % not found', p_submission_id;
  end if;
  if previous = p_status then
    return;
  end if;

  update public.submissions
  set status = p_status, updated_at = now()
  where id = p_submission_id;

  perform private.record_event(
    'submission.' || p_status::text,
    'submission',
    p_submission_id::text,
    p_actor,
    coalesce(p_payload, '{}') || jsonb_build_object('from', previous),
    p_agent_run_id
  );
end;
$$;

-- Every decision, whether from an agent or a maintainer, takes effect here,
-- so the ledger entry and the state change cannot drift apart.
create function private.apply_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.submission_status;
  next_status public.submission_status;
  actor text;
begin
  select s.status into current_status
  from public.submissions s
  where s.id = new.submission_id
  for update;

  if new.stage = 'maintainer' then
    actor := 'maintainer';
    insert into public.maintainer_actions (decision_id, user_id) values (new.id, auth.uid());
  else
    actor := 'agent:' || new.stage;
  end if;

  if new.outcome = 'publish' then
    next_status := case when current_status = 'published' then 'published' else 'approved' end;
  elsif new.outcome = 'reject' then
    next_status := case
      when current_status in ('published', 'approved') then 'withdrawn'
      else 'rejected'
    end;
  else
    next_status := 'escalated';
  end if;

  perform private.record_event(
    'decision.' || new.outcome,
    'submission',
    new.submission_id::text,
    actor,
    jsonb_build_object(
      'decision_id', new.id,
      'stage', new.stage,
      'reason_codes', new.reason_codes,
      'confidence', new.confidence,
      'dispute_id', new.dispute_id
    ),
    new.agent_run_id
  );

  perform private.set_submission_status(
    new.submission_id, next_status, actor,
    jsonb_build_object('decision_id', new.id), new.agent_run_id
  );

  if next_status = 'approved' then
    perform pgmq.send('redaction', jsonb_build_object('submission_id', new.submission_id));
  end if;

  if new.dispute_id is not null then
    update public.disputes
    set
      status = case new.outcome
        when 'reject' then 'upheld'
        when 'publish' then 'dismissed'
        else 'escalated'
      end,
      resolution_code = case new.outcome
        when 'reject' then 'record_withdrawn'
        when 'publish' then 'record_reaffirmed'
        else 'sent_to_maintainer'
      end,
      resolved_at = case when new.outcome = 'escalate' then null else now() end
    where id = new.dispute_id;

    perform private.record_event(
      case when new.outcome = 'escalate' then 'dispute.escalated' else 'dispute.resolved' end,
      'dispute',
      new.dispute_id::text,
      actor,
      jsonb_build_object('submission_id', new.submission_id, 'outcome', new.outcome),
      new.agent_run_id
    );
  end if;

  return new;
end;
$$;

create trigger review_decisions_apply
  after insert on public.review_decisions
  for each row execute function private.apply_decision();

-- ---------------------------------------------------------------------------
-- Disputes and brand claims start their pipelines on insert
-- ---------------------------------------------------------------------------

create function private.disputes_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_count integer;
  target_status public.submission_status;
begin
  select s.status into target_status from public.submissions s where s.id = new.submission_id;
  if target_status is distinct from 'published' then
    raise exception 'only published records can be disputed';
  end if;

  select count(*) into open_count
  from public.disputes d
  where d.opened_by = new.opened_by and d.status in ('open', 'reopened', 'escalated');
  if open_count >= 5 then
    raise exception 'you already have 5 unresolved disputes';
  end if;
  return new;
end;
$$;

create trigger disputes_guard
  before insert on public.disputes
  for each row execute function private.disputes_guard();

create function private.dispute_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.disputes%rowtype;
begin
  select * into d from public.disputes where id = new.dispute_id;
  perform private.record_event(
    'dispute.opened', 'dispute', d.id::text, 'user',
    jsonb_build_object(
      'submission_id', d.submission_id,
      'category', d.category,
      'relationship', new.relationship
    )
  );
  perform pgmq.send('dispute', jsonb_build_object('dispute_id', d.id));
  return new;
end;
$$;

create trigger dispute_opened
  after insert on public.dispute_details
  for each row execute function private.dispute_opened();

create function private.brand_claim_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Never trust client-supplied verification fields.
  new.status := 'pending';
  new.method := null;
  new.attempts := 0;
  new.decided_at := null;
  new.challenge_token := encode(extensions.gen_random_bytes(16), 'hex');
  select lower(split_part(u.email, '@', 2)) into new.email_domain
  from auth.users u
  where u.id = new.user_id and u.email_confirmed_at is not null;
  return new;
end;
$$;

create trigger brand_claim_prepare
  before insert on public.brand_members
  for each row execute function private.brand_claim_prepare();

create function private.brand_claim_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_event(
    'brand_claim.opened', 'brand', new.brand_id::text, 'user',
    jsonb_build_object('claim_id', new.id)
  );
  perform pgmq.send('brand_verification', jsonb_build_object('claim_id', new.id));
  return new;
end;
$$;

create trigger brand_claim_opened
  after insert on public.brand_members
  for each row execute function private.brand_claim_opened();

create function private.brand_claim_decided()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status <> 'pending' then
    new.decided_at := now();
    perform private.record_event(
      'brand_claim.' || new.status, 'brand', new.brand_id::text,
      case when new.method = 'maintainer' then 'maintainer' else 'agent:brand_verification' end,
      jsonb_build_object('claim_id', new.id, 'method', new.method)
    );
  end if;
  return new;
end;
$$;

create trigger brand_claim_decided
  before update on public.brand_members
  for each row execute function private.brand_claim_decided();

-- ---------------------------------------------------------------------------
-- Catalog ingestion
-- ---------------------------------------------------------------------------

create function private.normalise_name(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(regexp_replace(lower(p), '[^a-z0-9]+', '', 'g'), ''),
    lower(btrim(p))
  );
$$;

create function private.ensure_brand(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm text := private.normalise_name(p_name);
  v_slug text;
  v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    return null;
  end if;

  select b.id into v_id from public.brands b where b.name_normalised = v_norm;
  if v_id is not null then
    return v_id;
  end if;

  v_slug := btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-');
  if v_slug = '' or exists (select 1 from public.brands b where b.slug = v_slug) then
    v_slug := btrim(v_slug || '-' || substr(md5(v_norm), 1, 6), '-');
  end if;

  insert into public.brands (slug, name, name_normalised)
  values (v_slug, btrim(p_name), v_norm)
  on conflict (name_normalised) do update set name = public.brands.name
  returning id into v_id;
  return v_id;
end;
$$;

create function private.ensure_lab(p_name text, p_accreditation jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm text := private.normalise_name(p_name);
  v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    return null;
  end if;

  select l.id into v_id from public.labs l where l.name_normalised = v_norm;
  if v_id is null then
    insert into public.labs (name, name_normalised, accreditation_status, accreditation_body, accreditation_number)
    values (
      btrim(p_name),
      v_norm,
      case when p_accreditation is null then 'unknown' else 'stated' end,
      p_accreditation ->> 'body',
      p_accreditation ->> 'number'
    )
    on conflict (name_normalised) do update set name = public.labs.name
    returning id into v_id;
  elsif p_accreditation is not null then
    -- A claim on a document only ever lifts 'unknown' to 'stated'.
    update public.labs
    set
      accreditation_status = 'stated',
      accreditation_body = coalesce(accreditation_body, p_accreditation ->> 'body'),
      accreditation_number = coalesce(accreditation_number, p_accreditation ->> 'number')
    where id = v_id and accreditation_status = 'unknown';
  end if;
  return v_id;
end;
$$;

create function private.create_product(
  p_source_id uuid,
  p_name text,
  p_brand_name text,
  p_gtin text default null,
  p_categories text[] default '{}',
  p_image_url text default null,
  p_ingredients_text text default null,
  p_serving_size text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_brand_id uuid := private.ensure_brand(p_brand_name);
begin
  insert into public.entities (entity_type, name)
  values ('product', p_name)
  returning id into v_id;

  insert into public.products (
    id, brand_id, brand_name, name, gtin, category, categories, image_url,
    ingredients_text, serving_size, first_source_id
  )
  values (
    v_id, v_brand_id, nullif(btrim(p_brand_name), ''), p_name, p_gtin,
    p_categories[1], coalesce(p_categories, '{}'), p_image_url,
    p_ingredients_text, p_serving_size, p_source_id
  );
  return v_id;
end;
$$;

create index observations_source_ref_idx
  on public.observations (source_id, external_ref)
  where attribute = 'catalog_record';

-- Takes a batch of normalised catalog records from one source. Each record
-- becomes an observation (skipped when identical to one already stored) and
-- fills in any gaps in the product's current view.
create function private.upsert_catalog_records(p_source_id uuid, p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb;
  v_product_id uuid;
  v_gtin text;
  v_name text;
  v_categories text[];
  v_value jsonb;
  v_rows integer;
  v_created integer := 0;
  v_changed integer := 0;
  v_skipped integer := 0;
  v_was_created boolean;
begin
  for rec in select * from jsonb_array_elements(p_records)
  loop
    v_name := nullif(btrim(rec ->> 'name'), '');
    v_gtin := nullif(rec ->> 'gtin', '');
    if v_name is null or nullif(rec ->> 'external_ref', '') is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select coalesce(array_agg(x), '{}') into v_categories
    from jsonb_array_elements_text(coalesce(rec -> 'categories', '[]')) as x;

    v_product_id := null;
    v_was_created := false;
    if v_gtin is not null then
      select p.id into v_product_id from public.products p where p.gtin = v_gtin;
    end if;
    if v_product_id is null then
      select o.entity_id into v_product_id
      from public.observations o
      where o.source_id = p_source_id
        and o.attribute = 'catalog_record'
        and o.external_ref = rec ->> 'external_ref'
      limit 1;
    end if;

    if v_product_id is null then
      v_product_id := private.create_product(
        p_source_id, v_name, rec ->> 'brand_name', v_gtin, v_categories,
        rec ->> 'image_url', rec ->> 'ingredients_text', rec ->> 'serving_size'
      );
      v_was_created := true;
      v_created := v_created + 1;
    else
      update public.products p
      set
        brand_id = coalesce(p.brand_id, private.ensure_brand(rec ->> 'brand_name')),
        brand_name = coalesce(p.brand_name, nullif(btrim(rec ->> 'brand_name'), '')),
        gtin = coalesce(p.gtin, v_gtin),
        category = coalesce(p.category, v_categories[1]),
        categories = case when cardinality(p.categories) = 0 then v_categories else p.categories end,
        image_url = coalesce(p.image_url, rec ->> 'image_url'),
        ingredients_text = coalesce(p.ingredients_text, rec ->> 'ingredients_text'),
        serving_size = coalesce(p.serving_size, rec ->> 'serving_size'),
        updated_at = now()
      where p.id = v_product_id
        and (
          p.brand_id is null or p.gtin is null or p.category is null
          or cardinality(p.categories) = 0 or p.image_url is null
          or p.ingredients_text is null or p.serving_size is null
        );
    end if;

    v_value := rec - 'nutrition';
    insert into public.observations (entity_id, source_id, attribute, value, external_ref, content_hash)
    values (v_product_id, p_source_id, 'catalog_record', v_value, rec ->> 'external_ref', md5(v_value::text))
    on conflict (entity_id, source_id, attribute, content_hash) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 and not v_was_created then
      v_changed := v_changed + 1;
    end if;

    if jsonb_typeof(rec -> 'nutrition') = 'object' then
      insert into public.observations (entity_id, source_id, attribute, value, external_ref, content_hash)
      values (
        v_product_id, p_source_id, 'nutrition', rec -> 'nutrition', rec ->> 'external_ref',
        md5((rec -> 'nutrition')::text)
      )
      on conflict (entity_id, source_id, attribute, content_hash) do nothing;
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'changed', v_changed, 'skipped', v_skipped);
end;
$$;

create function private.upsert_recalls(p_source_id uuid, p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer;
begin
  with inserted as (
    insert into public.recalls (
      source_id, external_ref, firm, product_description, reason, classification,
      status, recall_date, report_date, url, raw
    )
    select
      p_source_id,
      r ->> 'external_ref',
      r ->> 'firm',
      r ->> 'product_description',
      r ->> 'reason',
      r ->> 'classification',
      r ->> 'status',
      (r ->> 'recall_date')::date,
      (r ->> 'report_date')::date,
      r ->> 'url',
      coalesce(r -> 'raw', '{}')
    from jsonb_array_elements(p_records) as r
    where nullif(r ->> 'external_ref', '') is not null
    on conflict (source_id, external_ref) do nothing
    returning 1
  )
  select count(*) into v_created from inserted;
  return jsonb_build_object('created', v_created, 'changed', 0, 'skipped', jsonb_array_length(p_records) - v_created);
end;
$$;

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------

create function public.search_products(q text, max_results integer default 20)
returns setof public.products
language sql
stable
set search_path = ''
as $$
  select p.*
  from public.products p
  where
    p.search @@ websearch_to_tsquery('simple', q)
    or extensions.word_similarity(q, p.name) > 0.5
    or p.gtin = lpad(nullif(regexp_replace(q, '\D', '', 'g'), ''), 14, '0')
  order by
    (p.gtin = lpad(nullif(regexp_replace(q, '\D', '', 'g'), ''), 14, '0')) desc nulls last,
    ts_rank(p.search, websearch_to_tsquery('simple', q))
      + extensions.word_similarity(q, coalesce(p.brand_name, '') || ' ' || p.name) desc
  limit least(greatest(max_results, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

-- Calls an Edge Function. Does nothing until the two Vault secrets exist, so
-- a fresh database stays quiet until it is configured (see README).
create function private.invoke_function(p_name text, p_body jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_secret text;
begin
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret';
  if v_base is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_base || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    body := p_body,
    timeout_milliseconds := 150000
  );
end;
$$;

-- Wakes the worker once for each queue that has a message ready.
create function private.dispatch_workers()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q text;
  ready boolean;
begin
  foreach q in array private.work_queues()
  loop
    execute format(
      'select exists (select 1 from pgmq.%I where vt <= clock_timestamp())', 'q_' || q
    ) into ready;
    if ready then
      perform private.invoke_function('agent-worker', jsonb_build_object('queue', q));
    end if;
  end loop;
end;
$$;

create function private.enqueue_discovery(p_limit integer default 10)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
begin
  for b in
    select br.id
    from public.brands br
    where br.last_crawled_at is null or br.last_crawled_at < now() - interval '30 days'
    order by br.last_crawled_at nulls first, br.created_at
    limit p_limit
  loop
    perform private.enqueue_once('discovery', jsonb_build_object('brand_id', b.id));
  end loop;
end;
$$;

select cron.schedule('dispatch-workers', '10 seconds', $$select private.dispatch_workers()$$);

select cron.schedule('sync-openfoodfacts', '*/10 * * * *',
  $$select private.invoke_function('source-sync', '{"connector":"openfoodfacts"}')$$);
select cron.schedule('sync-fdc', '5-59/10 * * * *',
  $$select private.invoke_function('source-sync', '{"connector":"fdc"}')$$);
select cron.schedule('sync-openfda', '17 * * * *',
  $$select private.invoke_function('source-sync', '{"connector":"openfda"}')$$);

select cron.schedule('enqueue-discovery', '23 * * * *', $$select private.enqueue_discovery(10)$$);
select cron.schedule('enqueue-recall-matching', '*/30 * * * *',
  $$select private.enqueue_once('monitor', '{"task":"recalls"}')$$);
select cron.schedule('enqueue-stale-check', '15 3 * * *',
  $$select private.enqueue_once('monitor', '{"task":"stale"}')$$);
select cron.schedule('enqueue-supervisor', '*/10 * * * *',
  $$select private.enqueue_once('supervisor', '{"task":"sweep"}')$$);

select cron.schedule('data-export', '30 4 * * *', $$select private.invoke_function('data-export')$$);

select cron.schedule('trim-cron-history', '45 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
