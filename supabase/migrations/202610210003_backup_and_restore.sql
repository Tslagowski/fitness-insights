-- Ticket 12: portable backup and validated, atomic restore. Ticket 13 builds on capacity_status.
-- Applied by the Database migrations workflow; the Supabase CLI runs this file in one transaction.
--
-- export_backup returns every owner table row (retained history included) with no identity-bound
-- columns and no credentials. A restore is uploaded in chunks to restore_staging, then apply_restore
-- validates the staged row counts against the backup manifest and replaces everything in one
-- transaction; any failure leaves the existing data untouched. No table here holds a user id; display
-- preferences (the only identity-bound row) are carried in the backup manifest and saved by the app for
-- the signed-in owner through the ordinary preferences policy. Staging is private to these functions and
-- is removed after an apply, a discard, or one day.

-- Backup and restore run as the table owner. These client-written tables keep row-level security for
-- every client role (their owner policies are unchanged); only the forced check on the table owner is
-- lifted so the owner-only definer functions below can read and restore them.
alter table public.exercise_aliases no force row level security;
alter table public.review_decisions no force row level security;
alter table public.completeness_marks no force row level security;

create table public.restore_staging (
  restore_id uuid not null,
  table_name text not null check (table_name in ('source_files', 'data_revisions', 'import_batches', 'import_batch_sources', 'daily_records',
    'food_days', 'workout_days', 'reports', 'exercise_aliases', 'review_decisions', 'completeness_marks')),
  chunk integer not null check (chunk >= 0),
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  created_at timestamptz not null default now(),
  primary key (restore_id, table_name, chunk)
);
alter table public.restore_staging enable row level security;
revoke all on public.restore_staging from public, anon, authenticated;

create function public.backup_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['source_files', 'data_revisions', 'import_batches', 'import_batch_sources', 'daily_records', 'food_days', 'workout_days',
    'reports', 'exercise_aliases', 'review_decisions', 'completeness_marks'];
$$;

-- Database and archive usage against the Supabase Free limits (500 MB database, 1 GB storage).
create function public.capacity_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can check capacity.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'database_limit_bytes', 524288000,
    'archive_bytes', (select coalesce(sum(byte_size), 0) from public.source_files),
    'archive_limit_bytes', 1073741824,
    'staging_bytes', (select coalesce(sum(pg_column_size(rows)), 0) from public.restore_staging));
end;
$$;
revoke all on function public.capacity_status() from public, anon;
grant execute on function public.capacity_status() to authenticated;

-- Row counts per backed-up table, for restore previews.
create function public.workspace_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_count bigint;
  v_counts jsonb := '{}'::jsonb;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can read saved history.' using errcode = '42501';
  end if;
  foreach v_table in array public.backup_tables() loop
    execute format('select count(*) from public.%I', v_table) into v_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_count);
  end loop;
  return v_counts;
end;
$$;
revoke all on function public.workspace_counts() from public, anon;
grant execute on function public.workspace_counts() to authenticated;

create function public.export_backup()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_rows jsonb;
  v_tables jsonb := '{}'::jsonb;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can download a backup.' using errcode = '42501';
  end if;
  foreach v_table in array public.backup_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I as t', v_table) into v_rows;
    v_tables := v_tables || jsonb_build_object(v_table, v_rows);
  end loop;
  return jsonb_build_object(
    'schema_version', 1,
    'exported_at', now(),
    'tables', v_tables,
    'workspace_state', (select jsonb_build_object('active_revision_id', active_revision_id, 'retained_from_revision_id', retained_from_revision_id)
                        from public.workspace_state where singleton));
end;
$$;
revoke all on function public.export_backup() from public, anon;
grant execute on function public.export_backup() to authenticated;

-- Stores one chunk of a restore. Retrying the same chunk replaces it. Abandoned staging older than a day is removed.
create function public.stage_restore_chunk(p_restore_id uuid, p_table text, p_chunk integer, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can restore a backup.' using errcode = '42501';
  end if;
  if pg_column_size(p_rows) > 4194304 then
    raise exception 'A restore chunk is too large.' using errcode = '22023';
  end if;
  delete from public.restore_staging where restore_id <> p_restore_id and created_at < now() - interval '1 day';
  insert into public.restore_staging (restore_id, table_name, chunk, rows) values (p_restore_id, p_table, p_chunk, p_rows)
  on conflict (restore_id, table_name, chunk) do update set rows = excluded.rows, created_at = now();
  return jsonb_build_object('restore_id', p_restore_id, 'table', p_table, 'chunk', p_chunk, 'rows', jsonb_array_length(p_rows));
end;
$$;
revoke all on function public.stage_restore_chunk(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.stage_restore_chunk(uuid, text, integer, jsonb) to authenticated;

create function public.discard_restore(p_restore_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can restore a backup.' using errcode = '42501';
  end if;
  delete from public.restore_staging where restore_id = p_restore_id;
  get diagnostics v_removed = row_count;
  return jsonb_build_object('removed_chunks', v_removed);
end;
$$;
revoke all on function public.discard_restore(uuid) from public, anon;
grant execute on function public.discard_restore(uuid) to authenticated;

-- Validates the staged backup against its manifest and, unless p_dry_run, replaces all saved history atomically.
create function public.apply_restore(p_restore_id uuid, p_expected_revision_id bigint, p_manifest jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active bigint;
  v_table text;
  v_expected bigint;
  v_staged bigint;
  v_rows jsonb;
  v_counts jsonb := '{}'::jsonb;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can restore a backup.' using errcode = '42501';
  end if;
  if (p_manifest ->> 'schema_version') is distinct from '1' or jsonb_typeof(p_manifest -> 'counts') <> 'object' then
    raise exception 'This backup format is not supported.' using errcode = '22023';
  end if;
  select active_revision_id into v_active from public.workspace_state where singleton for update;
  if v_active is distinct from p_expected_revision_id then
    raise exception 'Your saved history changed after this restore was previewed. Review it again.' using errcode = 'FI409';
  end if;

  foreach v_table in array public.backup_tables() loop
    v_expected := (p_manifest -> 'counts' ->> v_table)::bigint;
    select coalesce(sum(jsonb_array_length(rows)), 0) into v_staged from public.restore_staging where restore_id = p_restore_id and table_name = v_table;
    if v_expected is null or v_staged <> v_expected then
      raise exception 'The uploaded backup is incomplete (%: % of % rows). Nothing was replaced; upload it again.', v_table, v_staged, coalesce(v_expected, 0) using errcode = '22023';
    end if;
    v_counts := v_counts || jsonb_build_object(v_table, v_staged);
  end loop;
  if p_dry_run then
    return jsonb_build_object('dry_run', true, 'counts', v_counts);
  end if;

  -- Replace everything in dependency order, then insert the backup's rows with their original ids.
  update public.workspace_state set active_revision_id = null, retained_from_revision_id = null where singleton;
  delete from public.reports;
  delete from public.daily_records;
  delete from public.food_days;
  delete from public.workout_days;
  delete from public.import_batch_sources;
  delete from public.import_batches;
  delete from public.data_revisions;
  delete from public.source_files;
  delete from public.exercise_aliases;
  delete from public.review_decisions;
  delete from public.completeness_marks;

  foreach v_table in array public.backup_tables() loop
    select coalesce(jsonb_agg(item order by staging.chunk, ordinal), '[]'::jsonb) into v_rows
    from public.restore_staging as staging, jsonb_array_elements(staging.rows) with ordinality as element(item, ordinal)
    where staging.restore_id = p_restore_id and staging.table_name = v_table;
    execute format('insert into public.%1$I overriding system value select * from jsonb_populate_recordset(null::public.%1$I, $1)', v_table) using v_rows;
  end loop;

  -- Identity counters continue after the restored ids.
  perform setval(pg_get_serial_sequence('public.data_revisions', 'id'), coalesce((select max(id) from public.data_revisions), 0) + 1, false);
  perform setval(pg_get_serial_sequence('public.daily_records', 'id'), coalesce((select max(id) from public.daily_records), 0) + 1, false);
  perform setval(pg_get_serial_sequence('public.food_days', 'id'), coalesce((select max(id) from public.food_days), 0) + 1, false);
  perform setval(pg_get_serial_sequence('public.workout_days', 'id'), coalesce((select max(id) from public.workout_days), 0) + 1, false);
  perform setval(pg_get_serial_sequence('public.review_decisions', 'id'), coalesce((select max(id) from public.review_decisions), 0) + 1, false);
  perform setval(pg_get_serial_sequence('public.completeness_marks', 'id'), coalesce((select max(id) from public.completeness_marks), 0) + 1, false);

  update public.workspace_state
  set active_revision_id = (p_manifest -> 'workspace_state' ->> 'active_revision_id')::bigint,
      retained_from_revision_id = (p_manifest -> 'workspace_state' ->> 'retained_from_revision_id')::bigint
  where singleton;

  delete from public.restore_staging where restore_id = p_restore_id;
  return jsonb_build_object('dry_run', false, 'counts', v_counts, 'revision_id', (select active_revision_id from public.workspace_state where singleton));
end;
$$;
revoke all on function public.apply_restore(uuid, bigint, jsonb, boolean) from public, anon;
grant execute on function public.apply_restore(uuid, bigint, jsonb, boolean) to authenticated;
