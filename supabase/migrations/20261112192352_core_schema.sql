-- Core schema.
--
-- Two kinds of table live here:
--   * fact tables (observations, coa_reports, measurements, decisions, agent
--     runs) are append-only; the ledger migration attaches the guards.
--   * projection tables (products, submissions, disputes, labs) hold the
--     current state derived from those facts; every change to them is
--     written to the public ledger.

create extension if not exists pg_trgm with schema extensions;

-- Helpers and trigger functions live here; this schema is never exposed
-- through the Data API.
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Sources and catalog
-- ---------------------------------------------------------------------------

create type public.source_kind as enum (
  'public_dataset', 'regulator', 'lab', 'brand', 'consumer', 'crawler', 'maintainer'
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  kind public.source_kind not null,
  name text not null,
  url text,
  license text,
  -- 1 is the most trusted (regulators, accredited labs), 5 the least.
  trust_tier smallint not null check (trust_tier between 1 and 5),
  created_at timestamptz not null default now()
);

create type public.entity_type as enum (
  'product', 'food', 'water_system', 'location', 'restaurant'
);

-- One row per thing being tracked, whatever the domain.
create table public.entities (
  id uuid primary key default gen_random_uuid(),
  entity_type public.entity_type not null,
  name text not null,
  created_at timestamptz not null default now()
);
create index entities_type_idx on public.entities (entity_type);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  name_normalised text not null unique,
  website text,
  last_crawled_at timestamptz,
  created_at timestamptz not null default now()
);
create index brands_name_trgm_idx on public.brands using gin (name extensions.gin_trgm_ops);

-- Current view of a product, filled in from observations.
create table public.products (
  id uuid primary key references public.entities (id),
  brand_id uuid references public.brands (id),
  brand_name text,
  name text not null,
  gtin text unique,
  category text,
  categories text[] not null default '{}',
  image_url text,
  ingredients_text text,
  serving_size text,
  first_source_id uuid not null references public.sources (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(name, '') || ' ' || coalesce(brand_name, '') || ' ' || coalesce(gtin, '')
    )
  ) stored
);
create index products_search_idx on public.products using gin (search);
create index products_name_trgm_idx on public.products using gin (name extensions.gin_trgm_ops);
create index products_brand_idx on public.products (brand_id);

create table public.labs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalised text not null unique,
  website text,
  -- unknown: nothing on record. stated: a document claims accreditation.
  -- verified: confirmed against the accreditor's directory. revoked: lapsed.
  accreditation_status text not null default 'unknown'
    check (accreditation_status in ('unknown', 'stated', 'verified', 'revoked')),
  accreditation_body text,
  accreditation_number text,
  accreditation_source_url text,
  accreditation_checked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Agent runs
-- ---------------------------------------------------------------------------

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  prompt_version text not null,
  model text,
  subject_type text not null,
  subject_id text not null,
  -- Set when the run belongs to a submission; drives who may read its detail.
  submission_id uuid,
  status text not null check (status in ('succeeded', 'failed')),
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12, 6),
  started_at timestamptz not null,
  finished_at timestamptz not null default now()
);
create index agent_runs_subject_idx on public.agent_runs (subject_type, subject_id);
create index agent_runs_submission_idx on public.agent_runs (submission_id);
create index agent_runs_finished_idx on public.agent_runs (finished_at desc);

-- Inputs and outputs are kept apart from the run header because they can
-- quote submitted documents, so they follow the submission's visibility.
create table public.agent_run_io (
  run_id uuid primary key references public.agent_runs (id),
  is_public boolean not null default false,
  input jsonb not null default '{}',
  output jsonb,
  error text
);

create table public.agent_steps (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.agent_runs (id),
  idx integer not null,
  kind text not null check (kind in ('model_call', 'check', 'tool')),
  name text not null,
  duration_ms integer,
  detail jsonb not null default '{}',
  unique (run_id, idx)
);

-- ---------------------------------------------------------------------------
-- Documents and observations
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_bucket text not null,
  storage_path text not null,
  mime_type text not null,
  byte_size integer not null,
  page_count integer,
  origin_url text,
  redaction_status text not null default 'pending'
    check (redaction_status in ('pending', 'redacted', 'failed')),
  created_at timestamptz not null default now()
);

-- The public form of a document: a page-by-page transcript with personal
-- data removed. The original file stays in a private bucket.
create table public.document_pages (
  document_id uuid not null references public.documents (id),
  page_number integer not null,
  redacted_text text not null,
  agent_run_id uuid references public.agent_runs (id),
  created_at timestamptz not null default now(),
  primary key (document_id, page_number)
);

-- Every fact a source has stated about an entity. Never updated: a changed
-- value is a new row, and the latest row per (entity, source, attribute) wins.
create table public.observations (
  id bigint generated always as identity primary key,
  entity_id uuid not null references public.entities (id),
  source_id uuid not null references public.sources (id),
  attribute text not null,
  value jsonb not null,
  external_ref text,
  document_id uuid references public.documents (id),
  agent_run_id uuid references public.agent_runs (id),
  content_hash text not null,
  observed_at timestamptz not null default now(),
  unique (entity_id, source_id, attribute, content_hash)
);
create index observations_entity_idx on public.observations (entity_id, attribute, observed_at desc);

-- ---------------------------------------------------------------------------
-- Submissions and COA facts
-- ---------------------------------------------------------------------------

create type public.submitter_relationship as enum ('consumer', 'brand', 'lab', 'crawler');

create type public.submission_status as enum (
  'received',    -- stored, waiting for intake
  'processing',  -- moving through the agent pipeline
  'approved',    -- publish decision made, waiting for redaction
  'published',
  'rejected',
  'escalated',   -- waiting for a maintainer
  'withdrawn',   -- was published, later rejected
  'duplicate',
  'failed'       -- pipeline could not process it
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id),
  source_id uuid not null references public.sources (id),
  relationship public.submitter_relationship not null,
  claimed_product_id uuid references public.products (id),
  product_id uuid references public.products (id),
  lab_id uuid references public.labs (id),
  status public.submission_status not null default 'received',
  duplicate_of uuid references public.submissions (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index submissions_product_idx on public.submissions (product_id, status);
create index submissions_status_idx on public.submissions (status, created_at desc);
create index submissions_document_idx on public.submissions (document_id);

alter table public.agent_runs
  add constraint agent_runs_submission_fk
  foreign key (submission_id) references public.submissions (id);

-- Who submitted what. Kept out of `submissions` so that table can be fully
-- public without exposing identities.
create table public.submission_owners (
  submission_id uuid primary key references public.submissions (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index submission_owners_user_idx on public.submission_owners (user_id);

-- Free text and personal data tied to a submission. Service role only.
create table public.submission_private (
  submission_id uuid primary key references public.submissions (id),
  claimed_product_text text,
  notes text,
  pii_terms text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.coa_reports (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id),
  document_id uuid not null references public.documents (id),
  document_type text not null,
  lab_name_raw text,
  accreditation_stated jsonb,
  report_number text,
  lot_number text,
  sample_description text,
  sample_brand_raw text,
  sample_product_raw text,
  sample_matrix text,
  sample_received_on date,
  tested_on date,
  report_date date,
  methods text[] not null default '{}',
  extraction_confidence numeric(4, 3),
  agent_run_id uuid not null references public.agent_runs (id),
  supersedes_id uuid references public.coa_reports (id),
  created_at timestamptz not null default now()
);
create index coa_reports_submission_idx on public.coa_reports (submission_id, created_at desc);

-- How a report was tied to a product, brand, lab and lot.
create table public.coa_resolutions (
  id uuid primary key default gen_random_uuid(),
  coa_report_id uuid not null references public.coa_reports (id),
  submission_id uuid not null references public.submissions (id),
  match_kind text not null check (match_kind in ('existing', 'new', 'none')),
  product_id uuid references public.products (id),
  proposed_product jsonb,
  lab_id uuid references public.labs (id),
  confidence numeric(4, 3),
  rationale text,
  agent_run_id uuid not null references public.agent_runs (id),
  created_at timestamptz not null default now()
);
create index coa_resolutions_report_idx on public.coa_resolutions (coa_report_id, created_at desc);

create type public.analyte_category as enum (
  'heavy_metal', 'pfas', 'pesticide', 'mycotoxin', 'microbial', 'plasticiser',
  'solvent', 'process_contaminant', 'mineral', 'other'
);

create table public.analytes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  cas_number text,
  category public.analyte_category not null,
  synonyms text[] not null default '{}'
);

create type public.measurement_operator as enum ('eq', 'lt', 'lte', 'gt', 'gte', 'nd');

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  coa_report_id uuid not null references public.coa_reports (id),
  submission_id uuid not null references public.submissions (id),
  analyte_id uuid references public.analytes (id),
  analyte_name_raw text not null,
  -- 'nd' means reported as not detected; value is then null.
  operator public.measurement_operator not null,
  value numeric,
  unit text,
  lod numeric,
  loq numeric,
  -- Same quantity in a canonical unit, when the unit is recognised.
  normalised_value numeric,
  normalised_unit text,
  method text,
  page_number integer,
  citation text,
  created_at timestamptz not null default now()
);
create index measurements_report_idx on public.measurements (coa_report_id);
create index measurements_submission_idx on public.measurements (submission_id);
create index measurements_analyte_idx on public.measurements (analyte_id);

create table public.reference_limits (
  id uuid primary key default gen_random_uuid(),
  analyte_id uuid not null references public.analytes (id),
  authority text not null,
  jurisdiction text not null,
  kind text not null check (kind in ('regulatory', 'advisory')),
  -- concentration limits can be compared with a COA result directly;
  -- per_day limits depend on how much of the product is consumed.
  basis text not null check (basis in ('concentration', 'per_day')),
  limit_value numeric not null,
  unit text not null,
  normalised_value numeric,
  normalised_unit text,
  applies_to text not null,
  -- Lower-case keywords matched against product categories and sample matrix.
  category_keywords text[] not null default '{}',
  source_id uuid references public.sources (id),
  source_url text not null,
  effective_on date,
  notes text
);
create index reference_limits_analyte_idx on public.reference_limits (analyte_id);

create table public.verification_reports (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id),
  coa_report_id uuid not null references public.coa_reports (id),
  dispute_id uuid,
  risk text not null check (risk in ('low', 'medium', 'high')),
  -- [{ code, status: pass | warn | fail, detail }]
  checks jsonb not null,
  summary text,
  agent_run_id uuid not null references public.agent_runs (id),
  created_at timestamptz not null default now()
);
create index verification_reports_submission_idx
  on public.verification_reports (submission_id, created_at desc);

create table public.review_decisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id),
  coa_report_id uuid references public.coa_reports (id),
  dispute_id uuid,
  stage text not null
    check (stage in ('intake', 'extraction', 'adjudicator', 'supervisor', 'maintainer')),
  outcome text not null check (outcome in ('publish', 'reject', 'escalate')),
  confidence numeric(4, 3),
  reason_codes text[] not null default '{}',
  agent_run_id uuid references public.agent_runs (id),
  created_at timestamptz not null default now()
);
create index review_decisions_submission_idx
  on public.review_decisions (submission_id, created_at desc);

-- Which maintainer made an override. Separate from the decision so the
-- decision row stays immutable if the account is later deleted.
create table public.maintainer_actions (
  decision_id uuid primary key references public.review_decisions (id),
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Written reasons. Public once the submission is published; before that only
-- the submitter and maintainers can read them, since a rejected document may
-- be something personal uploaded by mistake.
create table public.review_decision_details (
  decision_id uuid primary key references public.review_decisions (id),
  submission_id uuid not null references public.submissions (id),
  summary text not null,
  reasons jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Disputes, brand accounts, maintainers
-- ---------------------------------------------------------------------------

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id),
  opened_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text not null check (
    category in ('factual_error', 'wrong_product', 'fraudulent_document', 'outdated', 'legal', 'other')
  ),
  status text not null default 'open'
    check (status in ('open', 'reopened', 'dismissed', 'upheld', 'escalated')),
  resolution_code text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index disputes_submission_idx on public.disputes (submission_id);
create index disputes_status_idx on public.disputes (status, created_at desc);

create table public.dispute_details (
  dispute_id uuid primary key references public.disputes (id) on delete cascade,
  relationship text not null check (relationship in ('consumer', 'brand', 'lab', 'other')),
  reason text not null check (char_length(reason) between 20 and 5000),
  evidence_url text check (evidence_url is null or evidence_url ~ '^https?://'),
  resolution text,
  created_at timestamptz not null default now()
);

alter table public.verification_reports
  add constraint verification_reports_dispute_fk
  foreign key (dispute_id) references public.disputes (id);
alter table public.review_decisions
  add constraint review_decisions_dispute_fk
  foreign key (dispute_id) references public.disputes (id);

create table public.brand_members (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  method text check (method in ('email_domain', 'dns_txt', 'maintainer')),
  email_domain text,
  challenge_token text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  attempts integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (brand_id, user_id)
);
create index brand_members_user_idx on public.brand_members (user_id);

create table public.maintainers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Recalls
-- ---------------------------------------------------------------------------

create table public.recalls (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id),
  external_ref text not null,
  firm text,
  product_description text,
  reason text,
  classification text,
  status text,
  recall_date date,
  report_date date,
  url text,
  raw jsonb not null default '{}',
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_id, external_ref)
);
create index recalls_unmatched_idx on public.recalls (created_at) where matched_at is null;

create table public.recall_products (
  recall_id uuid not null references public.recalls (id),
  product_id uuid not null references public.products (id),
  confidence numeric(4, 3) not null,
  rationale text,
  agent_run_id uuid references public.agent_runs (id),
  created_at timestamptz not null default now(),
  primary key (recall_id, product_id)
);
create index recall_products_product_idx on public.recall_products (product_id);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

create table public.sync_state (
  connector text primary key,
  cursor jsonb not null default '{}',
  items_total bigint not null default 0,
  last_run_at timestamptz,
  last_status text,
  last_error text
);

create table public.pipeline_controls (
  pipeline text primary key,
  paused boolean not null default false,
  paused_reason text,
  paused_at timestamptz,
  daily_budget_usd numeric(10, 2) not null
);

create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  git_sha text,
  model text not null,
  prompt_versions jsonb not null,
  metrics jsonb not null,
  passed boolean not null,
  created_at timestamptz not null default now()
);

create table public.data_exports (
  id uuid primary key default gen_random_uuid(),
  manifest_path text not null,
  ledger_head_seq bigint,
  ledger_head_hash text,
  tables jsonb not null,
  created_at timestamptz not null default now()
);
