-- Ticket 02: workbook daily history with atomic, idempotent, owner-only imports.
-- Run after 202609150001_owner_preferences.sql. Then run 202610190002_source_archive_storage.sql.
begin;

-- Immutable metadata for each distinct source file. Content-addressed by SHA-256.
create table public.source_files (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null check (length(file_name) between 1 and 255),
  byte_size bigint not null check (byte_size > 0),
  media_type text not null check (length(media_type) between 1 and 255),
  storage_path text not null unique,
  received_at timestamptz not null default now()
);

-- Each changing import creates one revision; the parent links preserve history for undo.
create table public.data_revisions (
  id bigint generated always as identity primary key,
  parent_id bigint references public.data_revisions(id),
  created_at timestamptz not null default now()
);

-- Exactly one row: the currently active shared revision (null before the first import).
create table public.workspace_state (
  singleton boolean primary key default true check (singleton),
  active_revision_id bigint references public.data_revisions(id)
);
insert into public.workspace_state (singleton) values (true);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  source_file_id uuid not null references public.source_files(id),
  kind text not null check (kind in ('workbook')),
  outcome text not null check (outcome in ('changed', 'unchanged')),
  base_revision_id bigint references public.data_revisions(id),
  revision_id bigint unique references public.data_revisions(id),
  added_records integer not null check (added_records >= 0),
  changed_records integer not null check (changed_records >= 0),
  unchanged_records integer not null check (unchanged_records >= 0),
  first_date date,
  last_date date,
  committed_at timestamptz not null default now(),
  check ((outcome = 'changed') = (revision_id is not null))
);

-- One row per (date, domain) per revision span. Active rows have no retired revision.
create table public.daily_records (
  id bigint generated always as identity primary key,
  record_date date not null,
  domain text not null check (domain in ('scale_weight', 'trend_weight', 'expenditure', 'nutrition_totals', 'targets', 'steps')),
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  source_file_id uuid not null references public.source_files(id),
  introduced_revision_id bigint not null references public.data_revisions(id),
  retired_revision_id bigint references public.data_revisions(id),
  check (retired_revision_id is null or retired_revision_id > introduced_revision_id)
);
create unique index daily_records_one_active on public.daily_records (record_date, domain) where retired_revision_id is null;
create index daily_records_introduced on public.daily_records (introduced_revision_id);
create index daily_records_retired on public.daily_records (retired_revision_id);

-- Owner-only reads. No client may write these tables directly; writes go through commit_import.
-- Row-level security is enabled but not forced: client roles are always restricted, while the
-- security-definer commit function (running as the table owner) can write.
do $$
declare table_name text;
begin
  foreach table_name in array array['source_files', 'data_revisions', 'workspace_state', 'import_batches', 'daily_records'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('create policy owner_reads_%s on public.%I for select to authenticated using ((select public.is_app_owner()))', table_name, table_name);
  end loop;
end $$;

-- Atomically applies a previewed import. Safe to retry with the same request id.
-- p_expected_revision_id: the active revision the preview was built against (null for none).
-- p_source: {"sha256","file_name","byte_size","media_type"}; the archive must already be stored.
-- p_records: [{"date":"YYYY-MM-DD","domain":"...","fields":{"Label (unit)": number|null}}]
create function public.commit_import(
  p_request_id uuid,
  p_expected_revision_id bigint,
  p_source jsonb,
  p_records jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.import_batches%rowtype;
  v_active bigint;
  v_sha text := lower(p_source ->> 'sha256');
  v_path text;
  v_source_id uuid;
  v_revision bigint;
  v_added integer;
  v_changed integer;
  v_unchanged integer;
  v_first date;
  v_last date;
  v_archived boolean;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can import data.' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'An import request id is required.' using errcode = '22023';
  end if;

  -- Serialize every shared change behind the single workspace row.
  select active_revision_id into v_active from public.workspace_state where singleton for update;

  -- A retried request returns its original result instead of committing twice.
  select * into v_existing from public.import_batches where request_id = p_request_id;
  if found then
    return jsonb_build_object('batch_id', v_existing.id, 'outcome', v_existing.outcome, 'replayed', true,
      'revision_id', coalesce(v_existing.revision_id, v_existing.base_revision_id), 'added', v_existing.added_records,
      'changed', v_existing.changed_records, 'unchanged', v_existing.unchanged_records);
  end if;

  if v_active is distinct from p_expected_revision_id then
    raise exception 'Your saved history changed after this preview was prepared. Refresh and preview the import again.'
      using errcode = 'FI409';
  end if;

  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'The source file fingerprint is invalid.' using errcode = '22023';
  end if;
  v_path := 'workbooks/' || v_sha || '.xlsx';

  -- When Supabase Storage is present, require the private archive to exist before committing.
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)'
      into v_archived using 'source-archives', v_path;
    if not v_archived then
      raise exception 'The source file archive was not found. Retry the import.' using errcode = 'FI404';
    end if;
  end if;

  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) = 0 then
    raise exception 'The import contains no daily records.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_records) > 20000 then
    raise exception 'The import is too large for one commit.' using errcode = '54000';
  end if;

  drop table if exists pg_temp.incoming_records;
  create temporary table incoming_records (
    record_date date not null,
    domain text not null,
    fields jsonb not null,
    status text
  ) on commit drop;

  insert into pg_temp.incoming_records (record_date, domain, fields)
  select (item ->> 'date')::date, item ->> 'domain', item -> 'fields'
  from jsonb_array_elements(p_records) as item;

  if exists (
    select 1 from pg_temp.incoming_records
    where domain not in ('scale_weight', 'trend_weight', 'expenditure', 'nutrition_totals', 'targets', 'steps')
      or jsonb_typeof(fields) is distinct from 'object'
      or exists (select 1 from jsonb_each(fields) as field where jsonb_typeof(field.value) not in ('number', 'null'))
  ) then
    raise exception 'The import contains an unsupported domain or value.' using errcode = '22023';
  end if;
  if exists (select 1 from pg_temp.incoming_records group by record_date, domain having count(*) > 1) then
    raise exception 'The import repeats a date within one domain.' using errcode = '22023';
  end if;

  update pg_temp.incoming_records as incoming
  set status = case
    when active.id is null then 'added'
    when active.fields = incoming.fields then 'unchanged'
    else 'changed' end
  from (select incoming_inner.record_date, incoming_inner.domain, existing.id, existing.fields
        from pg_temp.incoming_records as incoming_inner
        left join public.daily_records as existing
          on existing.record_date = incoming_inner.record_date
         and existing.domain = incoming_inner.domain
         and existing.retired_revision_id is null) as active
  where active.record_date = incoming.record_date and active.domain = incoming.domain;

  select count(*) filter (where status = 'added'), count(*) filter (where status = 'changed'),
         count(*) filter (where status = 'unchanged'), min(record_date), max(record_date)
  into v_added, v_changed, v_unchanged, v_first, v_last
  from pg_temp.incoming_records;

  insert into public.source_files (sha256, file_name, byte_size, media_type, storage_path)
  values (v_sha, left(coalesce(nullif(p_source ->> 'file_name', ''), 'workbook.xlsx'), 255),
          (p_source ->> 'byte_size')::bigint, coalesce(nullif(p_source ->> 'media_type', ''), 'application/octet-stream'), v_path)
  on conflict (sha256) do nothing;
  select id into v_source_id from public.source_files where sha256 = v_sha;

  if v_added + v_changed > 0 then
    insert into public.data_revisions (parent_id) values (v_active) returning id into v_revision;

    update public.daily_records as existing
    set retired_revision_id = v_revision
    from pg_temp.incoming_records as incoming
    where incoming.status = 'changed'
      and existing.record_date = incoming.record_date
      and existing.domain = incoming.domain
      and existing.retired_revision_id is null;

    insert into public.daily_records (record_date, domain, fields, source_file_id, introduced_revision_id)
    select record_date, domain, fields, v_source_id, v_revision
    from pg_temp.incoming_records where status in ('added', 'changed');

    update public.workspace_state set active_revision_id = v_revision where singleton;
  end if;

  insert into public.import_batches (request_id, source_file_id, kind, outcome, base_revision_id, revision_id,
    added_records, changed_records, unchanged_records, first_date, last_date)
  values (p_request_id, v_source_id, 'workbook', case when v_revision is null then 'unchanged' else 'changed' end,
    v_active, v_revision, v_added, v_changed, v_unchanged, v_first, v_last)
  returning * into v_existing;

  return jsonb_build_object('batch_id', v_existing.id, 'outcome', v_existing.outcome, 'replayed', false,
    'revision_id', coalesce(v_revision, v_active), 'added', v_added, 'changed', v_changed, 'unchanged', v_unchanged);
end;
$$;
revoke all on function public.commit_import(uuid, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.commit_import(uuid, bigint, jsonb, jsonb) to authenticated;

-- One consistent snapshot of the active history (avoids the API's default row limit).
-- Runs with the caller's rights, so row-level security still restricts it to the owner.
create function public.active_history()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'revision_id', (select active_revision_id from public.workspace_state),
    'records', coalesce((
      select jsonb_agg(jsonb_build_object('date', record.record_date, 'domain', record.domain, 'fields', record.fields,
        'source_file_id', record.source_file_id, 'revision_id', record.introduced_revision_id) order by record.record_date, record.domain)
      from public.daily_records as record where record.retired_revision_id is null), '[]'::jsonb),
    'imports', coalesce((
      select jsonb_agg(jsonb_build_object('id', batch.id, 'committed_at', batch.committed_at, 'outcome', batch.outcome,
        'revision_id', batch.revision_id, 'added', batch.added_records, 'changed', batch.changed_records,
        'unchanged', batch.unchanged_records, 'first_date', batch.first_date, 'last_date', batch.last_date,
        'file_name', source.file_name, 'byte_size', source.byte_size) order by batch.committed_at desc)
      from (select * from public.import_batches order by committed_at desc limit 50) as batch
      join public.source_files as source on source.id = batch.source_file_id), '[]'::jsonb)
  ) where (select public.is_app_owner());
$$;
revoke all on function public.active_history() from public, anon;
grant execute on function public.active_history() to authenticated;

commit;
