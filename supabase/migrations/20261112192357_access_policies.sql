-- Access model.
--
--   anon / authenticated: read everything that is public; authenticated users
--     can additionally open disputes and brand claims, and read their own
--     private rows. Maintainers (rows in public.maintainers) can read
--     escalated material and insert override decisions.
--   service_role: used only inside Edge Functions; does every other write.
--
-- Table privileges are granted explicitly rather than relying on defaults.

-- ---------------------------------------------------------------------------
-- Visibility helpers (security definer, in the unexposed private schema)
-- ---------------------------------------------------------------------------

create function private.is_maintainer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.maintainers m where m.user_id = (select auth.uid()));
$$;

create function private.owns_submission(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.submission_owners o
    where o.submission_id = p_submission_id and o.user_id = (select auth.uid())
  );
$$;

create function private.submission_is_public(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.submissions s
    where s.id = p_submission_id and s.status = 'published'
  );
$$;

-- Public once published; before that, visible to the submitter and maintainers.
create function private.can_read_submission_detail(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.submission_is_public(p_submission_id)
    or private.owns_submission(p_submission_id)
    or private.is_maintainer();
$$;

create function private.document_is_public(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.submissions s
    where s.document_id = p_document_id and s.status = 'published'
  ) or private.is_maintainer();
$$;

create function private.run_is_visible(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agent_runs r
    join public.agent_run_io io on io.run_id = r.id
    where r.id = p_run_id
      and (
        io.is_public
        or (r.submission_id is not null and private.can_read_submission_detail(r.submission_id))
        or private.is_maintainer()
      )
  );
$$;

create function private.owns_dispute(p_dispute_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.disputes d
    where d.id = p_dispute_id and d.opened_by = (select auth.uid())
  );
$$;

grant usage on schema private to anon, authenticated, service_role;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_maintainer(),
  private.owns_submission(uuid),
  private.submission_is_public(uuid),
  private.can_read_submission_detail(uuid),
  private.document_is_public(uuid),
  private.run_is_visible(uuid),
  private.owns_dispute(uuid),
  private.event_hash(text, bigint, timestamptz, text, text, text, text, uuid, jsonb)
to anon, authenticated;
grant execute on all functions in schema private to service_role;
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Reset privileges, then grant exactly what each role needs
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant all on all tables in schema public to service_role;
grant execute on function public.search_products(text, integer) to anon, authenticated, service_role;
grant execute on function public.verify_ledger(bigint, bigint) to anon, authenticated, service_role;

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Fully public reference and catalog tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sources', 'entities', 'brands', 'products', 'labs', 'observations', 'analytes',
    'reference_limits', 'events', 'agent_runs', 'submissions', 'review_decisions',
    'recalls', 'recall_products', 'sync_state', 'pipeline_controls', 'eval_runs',
    'data_exports'
  ]
  loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format(
      'create policy "Public read" on public.%I for select to anon, authenticated using (true)', t
    );
  end loop;
end;
$$;

-- Documents: metadata only, and only for published submissions. The storage
-- location of the original is never exposed.
grant select (id, sha256, mime_type, byte_size, page_count, origin_url, redaction_status, created_at)
  on public.documents to anon, authenticated;
create policy "Read documents of published submissions" on public.documents
  for select to anon, authenticated
  using (private.document_is_public(id));

grant select on public.document_pages to anon, authenticated;
create policy "Read redacted pages of published submissions" on public.document_pages
  for select to anon, authenticated
  using (private.document_is_public(document_id));

-- COA facts follow the submission.
do $$
declare
  t text;
begin
  foreach t in array array[
    'coa_reports', 'coa_resolutions', 'measurements', 'verification_reports',
    'review_decision_details'
  ]
  loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format(
      'create policy "Read when published, own, or maintainer" on public.%I
         for select to anon, authenticated
         using (private.can_read_submission_detail(submission_id))', t
    );
  end loop;
end;
$$;

grant select on public.agent_run_io, public.agent_steps to anon, authenticated;
create policy "Read visible run detail" on public.agent_run_io
  for select to anon, authenticated
  using (private.run_is_visible(run_id));
create policy "Read visible run steps" on public.agent_steps
  for select to anon, authenticated
  using (private.run_is_visible(run_id));

grant select on public.submission_owners to authenticated;
create policy "Read own submissions" on public.submission_owners
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Disputes: the public sees that a dispute exists and how it ended; the
-- written reason stays with the person who opened it and maintainers.
grant select (id, submission_id, category, status, resolution_code, created_at, resolved_at)
  on public.disputes to anon, authenticated;
grant insert (submission_id, category) on public.disputes to authenticated;
create policy "Public read" on public.disputes
  for select to anon, authenticated using (true);
create policy "Open a dispute as yourself" on public.disputes
  for insert to authenticated
  with check (opened_by = (select auth.uid()));

grant select on public.dispute_details to authenticated;
grant insert (dispute_id, relationship, reason, evidence_url) on public.dispute_details to authenticated;
create policy "Read own or as maintainer" on public.dispute_details
  for select to authenticated
  using (private.owns_dispute(dispute_id) or private.is_maintainer());
create policy "Add detail to own dispute" on public.dispute_details
  for insert to authenticated
  with check (private.owns_dispute(dispute_id));

-- Brand claims.
grant select on public.brand_members to authenticated;
grant insert (brand_id) on public.brand_members to authenticated;
grant update (status, method, note, decided_at) on public.brand_members to authenticated;
create policy "Read own or as maintainer" on public.brand_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_maintainer());
create policy "Claim a brand as yourself" on public.brand_members
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Maintainers decide claims" on public.brand_members
  for update to authenticated
  using (private.is_maintainer())
  with check (private.is_maintainer() and method = 'maintainer');

grant select on public.maintainers to authenticated;
create policy "Read own maintainer row" on public.maintainers
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Maintainer overrides enter through the same table as agent decisions; the
-- apply_decision trigger records who acted and writes the ledger entry.
grant insert (submission_id, coa_report_id, dispute_id, stage, outcome, reason_codes)
  on public.review_decisions to authenticated;
create policy "Maintainers add override decisions" on public.review_decisions
  for insert to authenticated
  with check (stage = 'maintainer' and private.is_maintainer());

grant insert (decision_id, submission_id, summary, reasons)
  on public.review_decision_details to authenticated;
create policy "Maintainers explain override decisions" on public.review_decision_details
  for insert to authenticated
  with check (private.is_maintainer());

-- submission_private and maintainer_actions have RLS on and no policies:
-- only the service role can touch them.

-- ---------------------------------------------------------------------------
-- Convenience view for product pages and the public API
-- ---------------------------------------------------------------------------

create view public.published_measurements
with (security_invoker = true) as
select
  m.id,
  s.product_id,
  m.submission_id,
  m.coa_report_id,
  m.analyte_id,
  a.slug as analyte_slug,
  coalesce(a.name, m.analyte_name_raw) as analyte_name,
  a.category as analyte_category,
  m.analyte_name_raw,
  m.operator,
  m.value,
  m.unit,
  m.lod,
  m.loq,
  m.normalised_value,
  m.normalised_unit,
  m.method,
  m.page_number,
  m.citation,
  r.report_date,
  r.lot_number,
  r.sample_matrix,
  s.relationship,
  s.lab_id,
  l.name as lab_name,
  l.accreditation_status as lab_accreditation_status
from public.measurements m
join public.coa_reports r on r.id = m.coa_report_id
join public.submissions s on s.id = m.submission_id and s.status = 'published'
left join public.analytes a on a.id = m.analyte_id
left join public.labs l on l.id = s.lab_id
-- Only the latest extraction of each submission counts.
where not exists (
  select 1 from public.coa_reports newer where newer.supersedes_id = r.id
);

grant select on public.published_measurements to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('coa-originals', 'coa-originals', false, 10485760,
    array['application/pdf', 'image/png', 'image/jpeg']),
  ('exports', 'exports', true, null, null)
on conflict (id) do nothing;

-- Originals are written and read by the service role. Maintainers may read
-- them to review escalations; nobody else has a policy.
create policy "Maintainers read originals" on storage.objects
  for select to authenticated
  using (bucket_id = 'coa-originals' and private.is_maintainer());

-- ---------------------------------------------------------------------------
-- Realtime: the activity feed listens to the ledger
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.events;
