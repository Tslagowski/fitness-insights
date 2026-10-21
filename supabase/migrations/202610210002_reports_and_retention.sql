-- Ticket 11: immutable saved reports and retention of the latest 12 changing versions.
-- Applied by the Database migrations workflow; the Supabase CLI runs this file in one transaction.
--
-- A report stores its full rendered content plus the exact inputs (data revision, cutoffs, settings,
-- method versions, review state), so it renders identically forever and never depends on records that
-- retention later removes. Reports are written only through save_report and never updated.
-- Retention is owner-reviewed: prune_history previews, then removes only records retired before the
-- 12th latest revision and reports tied to those older revisions. Active records, the retained
-- versions (and the snapshot just before the oldest, so it can still be undone), import provenance,
-- and source archives are never removed.

alter table public.workspace_state add column retained_from_revision_id bigint references public.data_revisions(id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  revision_id bigint references public.data_revisions(id),
  report_date date not null,
  period_end date,
  template_version text not null check (length(template_version) between 1 and 40),
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now()
);
create index reports_created on public.reports (created_at desc);
create index reports_revision on public.reports (revision_id);
alter table public.reports enable row level security;
revoke all on public.reports from public, anon, authenticated;
grant select on public.reports to authenticated;
create policy owner_reads_reports on public.reports for select to authenticated using ((select public.is_app_owner()));

-- Saves a generated report for the currently active revision. Idempotent by fingerprint.
create function public.save_report(
  p_fingerprint text,
  p_expected_revision_id bigint,
  p_report_date date,
  p_period_end date,
  p_template_version text,
  p_inputs jsonb,
  p_content jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active bigint;
  v_report public.reports%rowtype;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can save reports.' using errcode = '42501';
  end if;
  select active_revision_id into v_active from public.workspace_state where singleton for share;
  if v_active is distinct from p_expected_revision_id or (p_inputs ->> 'revisionId')::bigint is distinct from p_expected_revision_id then
    raise exception 'Your saved history changed after this report was prepared. Refresh and try again.' using errcode = 'FI409';
  end if;
  if pg_column_size(p_content) + pg_column_size(p_inputs) > 524288 then
    raise exception 'This report is too large to save.' using errcode = '22023';
  end if;
  select * into v_report from public.reports where fingerprint = p_fingerprint;
  if found then
    return jsonb_build_object('id', v_report.id, 'created_at', v_report.created_at, 'replayed', true);
  end if;
  insert into public.reports (fingerprint, revision_id, report_date, period_end, template_version, inputs, content)
  values (p_fingerprint, p_expected_revision_id, p_report_date, p_period_end, p_template_version, p_inputs, p_content)
  returning * into v_report;
  return jsonb_build_object('id', v_report.id, 'created_at', v_report.created_at, 'replayed', false);
end;
$$;
revoke all on function public.save_report(text, bigint, date, date, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_report(text, bigint, date, date, text, jsonb, jsonb) to authenticated;

-- Previews (dry run) or applies retention of the latest p_keep revisions.
create function public.prune_history(p_expected_revision_id bigint, p_dry_run boolean default true, p_keep integer default 12)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active bigint;
  v_keep_from bigint;
  v_revisions integer;
  v_daily integer;
  v_food integer;
  v_workouts integer;
  v_reports integer;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can change saved history.' using errcode = '42501';
  end if;
  if p_keep < 12 then
    raise exception 'At least 12 versions are always retained.' using errcode = '22023';
  end if;
  if p_dry_run then
    select active_revision_id into v_active from public.workspace_state where singleton;
  else
    select active_revision_id into v_active from public.workspace_state where singleton for update;
  end if;
  if v_active is distinct from p_expected_revision_id then
    raise exception 'Your saved history changed after this preview was prepared. Refresh and review it again.' using errcode = 'FI409';
  end if;
  select count(*) into v_revisions from public.data_revisions;
  select id into v_keep_from from public.data_revisions order by id desc offset p_keep - 1 limit 1;

  select count(*) into v_daily from public.daily_records where v_keep_from is not null and retired_revision_id < v_keep_from;
  select count(*) into v_food from public.food_days where v_keep_from is not null and retired_revision_id < v_keep_from;
  select count(*) into v_workouts from public.workout_days where v_keep_from is not null and retired_revision_id < v_keep_from;
  select count(*) into v_reports from public.reports where v_keep_from is not null and revision_id < v_keep_from;

  if not p_dry_run and v_keep_from is not null then
    delete from public.reports where revision_id < v_keep_from;
    delete from public.daily_records where retired_revision_id < v_keep_from;
    delete from public.food_days where retired_revision_id < v_keep_from;
    delete from public.workout_days where retired_revision_id < v_keep_from;
    update public.workspace_state set retained_from_revision_id = v_keep_from
    where singleton and (retained_from_revision_id is null or retained_from_revision_id < v_keep_from);
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'revisions', v_revisions, 'keep', p_keep, 'keep_from_revision_id', v_keep_from,
    'retained_from_revision_id', (select retained_from_revision_id from public.workspace_state where singleton),
    'daily_records', v_daily, 'food_days', v_food, 'workout_days', v_workouts, 'reports', v_reports);
end;
$$;
revoke all on function public.prune_history(bigint, boolean, integer) from public, anon;
grant execute on function public.prune_history(bigint, boolean, integer) to authenticated;

-- Undo refuses to reach past the retained window (everything else is unchanged from 202610200003).
create or replace function public.undo_last_change(
  p_request_id uuid,
  p_expected_revision_id bigint,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.import_batches%rowtype;
  v_target public.import_batches%rowtype;
  v_active bigint;
  v_base bigint;
  v_revision bigint;
  v_added integer;
  v_changed integer;
  v_removed integer;
  v_first date;
  v_last date;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can change saved history.' using errcode = '42501';
  end if;

  if p_dry_run then
    select active_revision_id into v_active from public.workspace_state where singleton;
  else
    if p_request_id is null then
      raise exception 'An undo request id is required.' using errcode = '22023';
    end if;
    select active_revision_id into v_active from public.workspace_state where singleton for update;
    select * into v_existing from public.import_batches where request_id = p_request_id;
    if found then
      return jsonb_build_object('batch_id', v_existing.id, 'kind', v_existing.kind, 'outcome', v_existing.outcome, 'replayed', true,
        'revision_id', coalesce(v_existing.revision_id, v_existing.base_revision_id), 'added', v_existing.added_records,
        'changed', v_existing.changed_records, 'removed', v_existing.removed_records, 'undoes_batch_id', v_existing.undoes_batch_id);
    end if;
  end if;
  if v_active is distinct from p_expected_revision_id then
    raise exception 'Your saved history changed after this preview was prepared. Refresh and review it again.' using errcode = 'FI409';
  end if;

  select batch.* into v_target from public.import_batches as batch
  where batch.outcome = 'changed' and batch.kind <> 'undo'
    and not exists (select 1 from public.import_batches as undo where undo.undoes_batch_id = batch.id)
  order by batch.revision_id desc
  limit 1;
  if not found then
    raise exception 'There is no import or correction to undo.' using errcode = 'P0002';
  end if;
  v_base := v_target.base_revision_id;
  -- Versions older than the retained window may have been pruned; their snapshots cannot be rebuilt.
  if v_base is not null and v_base < coalesce((select retained_from_revision_id from public.workspace_state where singleton), 0) - 1 then
    raise exception 'This change is older than the retained versions, so it can no longer be undone. Restore a backup to go further back.' using errcode = 'FI410';
  end if;

  drop table if exists pg_temp.undo_plan;
  create temporary table undo_plan on commit drop as
  select coalesce(snapshot.record_date, current_record.record_date) as record_date,
         coalesce(snapshot.domain, current_record.domain) as domain,
         current_record.id as current_id,
         snapshot.fields as restored_fields,
         snapshot.source_file_id as restored_source_file_id,
         case when current_record.id is null then 'added' when snapshot.record_date is null then 'removed' else 'changed' end as action
  from (select * from public.daily_records
        where v_base is not null and introduced_revision_id <= v_base and (retired_revision_id is null or retired_revision_id > v_base)) as snapshot
  full join (select * from public.daily_records where retired_revision_id is null) as current_record
    on current_record.record_date = snapshot.record_date and current_record.domain = snapshot.domain
  where snapshot.record_date is null or current_record.id is null or current_record.fields is distinct from snapshot.fields;

  drop table if exists pg_temp.undo_food_plan;
  create temporary table undo_food_plan on commit drop as
  select coalesce(snapshot.food_date, current_day.food_date) as food_date,
         current_day.id as current_id,
         snapshot.source_kind as restored_source_kind,
         snapshot.entries as restored_entries,
         snapshot.source_file_id as restored_source_file_id,
         case when current_day.id is null then 'added' when snapshot.food_date is null then 'removed' else 'changed' end as action
  from (select * from public.food_days
        where v_base is not null and introduced_revision_id <= v_base and (retired_revision_id is null or retired_revision_id > v_base)) as snapshot
  full join (select * from public.food_days where retired_revision_id is null) as current_day
    on current_day.food_date = snapshot.food_date
  where snapshot.food_date is null or current_day.id is null
     or current_day.entries is distinct from snapshot.entries or current_day.source_kind is distinct from snapshot.source_kind;

  drop table if exists pg_temp.undo_workout_plan;
  create temporary table undo_workout_plan on commit drop as
  select coalesce(snapshot.workout_date, current_day.workout_date) as workout_date,
         current_day.id as current_id,
         snapshot.source_kind as restored_source_kind,
         snapshot.sets as restored_sets,
         snapshot.source_file_id as restored_source_file_id,
         case when current_day.id is null then 'added' when snapshot.workout_date is null then 'removed' else 'changed' end as action
  from (select * from public.workout_days
        where v_base is not null and introduced_revision_id <= v_base and (retired_revision_id is null or retired_revision_id > v_base)) as snapshot
  full join (select * from public.workout_days where retired_revision_id is null) as current_day
    on current_day.workout_date = snapshot.workout_date
  where snapshot.workout_date is null or current_day.id is null
     or current_day.sets is distinct from snapshot.sets or current_day.source_kind is distinct from snapshot.source_kind;

  select count(*) filter (where action = 'added'), count(*) filter (where action = 'changed'),
         count(*) filter (where action = 'removed'), min(day), max(day)
  into v_added, v_changed, v_removed, v_first, v_last
  from (select action, record_date as day from pg_temp.undo_plan
        union all select action, food_date from pg_temp.undo_food_plan
        union all select action, workout_date from pg_temp.undo_workout_plan) as plan;

  if p_dry_run then
    return jsonb_build_object('target_batch_id', v_target.id, 'target_kind', v_target.kind,
      'target_committed_at', v_target.committed_at, 'restores_revision_id', v_base,
      'added', v_added, 'changed', v_changed, 'removed', v_removed, 'first_date', v_first, 'last_date', v_last);
  end if;

  if v_added + v_changed + v_removed > 0 then
    insert into public.data_revisions (parent_id) values (v_active) returning id into v_revision;
    update public.daily_records as existing set retired_revision_id = v_revision
    from pg_temp.undo_plan as plan where plan.current_id = existing.id and plan.action in ('changed', 'removed');
    insert into public.daily_records (record_date, domain, fields, source_file_id, introduced_revision_id)
    select record_date, domain, restored_fields, restored_source_file_id, v_revision from pg_temp.undo_plan where action in ('added', 'changed');
    update public.food_days as existing set retired_revision_id = v_revision
    from pg_temp.undo_food_plan as plan where plan.current_id = existing.id and plan.action in ('changed', 'removed');
    insert into public.food_days (food_date, source_kind, entries, entry_count, source_file_id, introduced_revision_id)
    select food_date, restored_source_kind, restored_entries, jsonb_array_length(restored_entries), restored_source_file_id, v_revision
    from pg_temp.undo_food_plan where action in ('added', 'changed');
    update public.workout_days as existing set retired_revision_id = v_revision
    from pg_temp.undo_workout_plan as plan where plan.current_id = existing.id and plan.action in ('changed', 'removed');
    insert into public.workout_days (workout_date, source_kind, sets, set_count, source_file_id, introduced_revision_id)
    select workout_date, restored_source_kind, restored_sets, jsonb_array_length(restored_sets), restored_source_file_id, v_revision
    from pg_temp.undo_workout_plan where action in ('added', 'changed');
    update public.workspace_state set active_revision_id = v_revision where singleton;
  end if;

  insert into public.import_batches (request_id, kind, outcome, base_revision_id, revision_id, added_records, changed_records,
    unchanged_records, removed_records, first_date, last_date, undoes_batch_id)
  values (p_request_id, 'undo', case when v_revision is null then 'unchanged' else 'changed' end, v_active, v_revision,
    v_added, v_changed, 0, v_removed, v_first, v_last, v_target.id)
  returning * into v_existing;

  return jsonb_build_object('batch_id', v_existing.id, 'kind', 'undo', 'outcome', v_existing.outcome, 'replayed', false,
    'revision_id', coalesce(v_revision, v_active), 'added', v_added, 'changed', v_changed, 'removed', v_removed,
    'undoes_batch_id', v_target.id);
end;
$$;
