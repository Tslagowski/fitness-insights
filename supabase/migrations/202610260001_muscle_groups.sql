-- Ticket 22: muscle-group balance and stalled lifts.
-- Applied by the Database migrations workflow; the Supabase CLI runs this file in one transaction.
--
-- MacroFactor's "Muscle Groups - Sets" sheet gives fractional daily totals per muscle but not the
-- exercise-to-muscle mapping behind them (several exercises always appear together, so it cannot be
-- recovered), so its accounting cannot be verified per set. The owner maps each exercise instead:
-- one primary muscle and optional secondary muscles. The mapping is private, owner-only, and backed up.

create function public.muscle_groups()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['Chest', 'Front Delts', 'Side Delts', 'Rear Delts', 'Triceps', 'Biceps', 'Forearms', 'Upper Back', 'Lats', 'Upper Traps',
    'Neck', 'Serratus', 'Abs', 'Obliques', 'Lower Back', 'Glutes', 'Quads', 'Hamstrings', 'Adductors', 'Abductors', 'Calves', 'Tibialis'];
$$;

create table public.exercise_muscles (
  exercise_name text primary key check (length(exercise_name) between 1 and 200),
  primary_muscle text not null check (primary_muscle = any (public.muscle_groups())),
  secondary_muscles text[] not null default '{}' check (secondary_muscles <@ public.muscle_groups() and cardinality(secondary_muscles) <= 8
    and not (primary_muscle = any (secondary_muscles))),
  updated_at timestamptz not null default now()
);
alter table public.exercise_muscles enable row level security;
revoke all on public.exercise_muscles from public, anon, authenticated;
grant select, insert, update, delete on public.exercise_muscles to authenticated;
create policy owner_reads_muscles on public.exercise_muscles for select to authenticated using ((select public.is_app_owner()));
create policy owner_adds_muscles on public.exercise_muscles for insert to authenticated with check ((select public.is_app_owner()));
create policy owner_changes_muscles on public.exercise_muscles for update to authenticated using ((select public.is_app_owner())) with check ((select public.is_app_owner()));
create policy owner_removes_muscles on public.exercise_muscles for delete to authenticated using ((select public.is_app_owner()));

-- Owner settings: how many consecutive comparisons make a lift "stalled", and the credit a secondary
-- muscle receives per set (0 = primary only; 0.5 = half a set, the fractional convention MacroFactor shows).
alter table public.preferences
  add column stall_comparisons integer not null default 3 check (stall_comparisons between 2 and 10),
  add column secondary_set_credit numeric(2, 1) not null default 0 check (secondary_set_credit in (0, 0.5));

-- Backups gain the mapping. Tables added after backup format 1 may be absent from older backups.
create function public.optional_backup_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['exercise_muscles'];
$$;

create or replace function public.backup_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['source_files', 'data_revisions', 'import_batches', 'import_batch_sources', 'daily_records', 'food_days', 'workout_days',
    'reports', 'exercise_aliases', 'review_decisions', 'completeness_marks'] || public.optional_backup_tables();
$$;

alter table public.restore_staging drop constraint restore_staging_table_name_check;
alter table public.restore_staging add constraint restore_staging_table_name_check check (table_name = any (public.backup_tables()));

-- Validates the staged backup against its manifest and, unless p_dry_run, replaces all saved history atomically.
create or replace function public.apply_restore(p_restore_id uuid, p_expected_revision_id bigint, p_manifest jsonb, p_dry_run boolean default false)
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
    -- Tables added after a backup was made are absent from its manifest and restore empty.
    v_expected := coalesce((p_manifest -> 'counts' ->> v_table)::bigint, case when v_table = any (public.optional_backup_tables()) then 0 end);
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
  foreach v_table in array public.optional_backup_tables() loop
    execute format('delete from public.%I', v_table);
  end loop;

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
