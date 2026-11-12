-- Public ledger: an append-only, hash-chained record of every state change.
--
-- Each row's hash covers the previous row's hash, so removing or altering any
-- row breaks the chain from that point on. Anyone holding a copy of the table
-- (the nightly dumps include it) can recompute the chain with
-- public.verify_ledger() or with the formula in private.event_hash().

create table public.events (
  seq bigint primary key,
  occurred_at timestamptz not null,
  event_type text not null,
  subject_type text not null,
  subject_id text not null,
  -- 'agent:<name>', 'user', 'maintainer', 'system:<name>'. Never a user id.
  actor text not null,
  agent_run_id uuid references public.agent_runs (id),
  payload jsonb not null default '{}',
  prev_hash text not null,
  hash text not null
);
create index events_subject_idx on public.events (subject_type, subject_id, seq);
create index events_type_idx on public.events (event_type, seq desc);

-- sha256 over the previous hash and the row's fields, joined with '|'.
-- The timestamp is UTC with microseconds; payload is Postgres's jsonb text.
create function private.event_hash(
  p_prev_hash text,
  p_seq bigint,
  p_occurred_at timestamptz,
  p_event_type text,
  p_subject_type text,
  p_subject_id text,
  p_actor text,
  p_agent_run_id uuid,
  p_payload jsonb
) returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    sha256(
      convert_to(
        concat_ws(
          '|',
          p_prev_hash,
          p_seq::text,
          to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          p_event_type,
          p_subject_type,
          p_subject_id,
          p_actor,
          coalesce(p_agent_run_id::text, ''),
          p_payload::text
        ),
        'UTF8'
      )
    ),
    'hex'
  );
$$;

create function private.events_chain()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  last_seq bigint;
  last_hash text;
begin
  -- One writer at a time, so seq is gapless and the chain has no forks.
  perform pg_advisory_xact_lock(hashtext('public.events'));

  select e.seq, e.hash into last_seq, last_hash
  from public.events e
  order by e.seq desc
  limit 1;

  new.seq := coalesce(last_seq, 0) + 1;
  new.occurred_at := clock_timestamp();
  new.prev_hash := coalesce(last_hash, repeat('0', 64));
  new.hash := private.event_hash(
    new.prev_hash, new.seq, new.occurred_at, new.event_type, new.subject_type,
    new.subject_id, new.actor, new.agent_run_id, new.payload
  );
  return new;
end;
$$;

create trigger events_chain
  before insert on public.events
  for each row execute function private.events_chain();

create function private.record_event(
  p_event_type text,
  p_subject_type text,
  p_subject_id text,
  p_actor text,
  p_payload jsonb default '{}',
  p_agent_run_id uuid default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_seq bigint;
begin
  insert into public.events (
    seq, occurred_at, event_type, subject_type, subject_id, actor, agent_run_id,
    payload, prev_hash, hash
  )
  values (
    0, now(), p_event_type, p_subject_type, p_subject_id, p_actor, p_agent_run_id,
    coalesce(p_payload, '{}'), '', ''
  )
  returning seq into new_seq;
  return new_seq;
end;
$$;

-- Recomputes the chain over a range. Returns the first seq whose stored hash
-- or link does not match, or null when the range is intact.
create function public.verify_ledger(from_seq bigint default 1, to_seq bigint default null)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  ev public.events%rowtype;
  expected_prev text;
begin
  if from_seq <= 1 then
    expected_prev := repeat('0', 64);
  else
    select e.hash into expected_prev from public.events e where e.seq = from_seq - 1;
    if expected_prev is null then
      return from_seq - 1;
    end if;
  end if;

  for ev in
    select * from public.events e
    where e.seq >= from_seq and (to_seq is null or e.seq <= to_seq)
    order by e.seq
  loop
    if ev.prev_hash <> expected_prev
      or ev.hash <> private.event_hash(
        ev.prev_hash, ev.seq, ev.occurred_at, ev.event_type, ev.subject_type,
        ev.subject_id, ev.actor, ev.agent_run_id, ev.payload
      )
    then
      return ev.seq;
    end if;
    expected_prev := ev.hash;
  end loop;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Append-only guards
-- ---------------------------------------------------------------------------

create function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%.% is append-only: % is not allowed', tg_table_schema, tg_table_name, tg_op
    using errcode = 'integrity_constraint_violation';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'events', 'observations', 'agent_runs', 'agent_run_io', 'agent_steps',
    'coa_reports', 'coa_resolutions', 'measurements', 'verification_reports',
    'review_decisions', 'review_decision_details'
  ]
  loop
    execute format(
      'create trigger %I before update or delete on public.%I
         for each row execute function private.forbid_mutation()',
      t || '_append_only', t
    );
    execute format(
      'create trigger %I before truncate on public.%I
         for each statement execute function private.forbid_mutation()',
      t || '_no_truncate', t
    );
  end loop;
end;
$$;

-- A stored file never changes identity once recorded.
create function private.documents_immutable_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sha256 <> old.sha256
    or new.storage_bucket <> old.storage_bucket
    or new.storage_path <> old.storage_path
    or new.byte_size <> old.byte_size
  then
    raise exception 'documents: the stored file cannot be changed'
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$$;

create trigger documents_immutable_identity
  before update on public.documents
  for each row execute function private.documents_immutable_identity();
