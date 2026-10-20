-- Ticket 03: explicit day clearing, undo of the latest change, and a change log that explains each result.
-- Applied by the Database migrations workflow; the Supabase CLI runs this file in one transaction.
--
-- History stays linear and append-only: every change (import, clear, undo) creates a new revision,
-- and records are never rewritten except to mark the revision that retired them. The active set at
-- any revision R is: introduced_revision_id <= R and (retired_revision_id is null or > R).

-- import_batches becomes the change log for every kind of shared change.
alter table public.import_batches alter column source_file_id drop not null;
alter table public.import_batches drop constraint import_batches_kind_check;
alter table public.import_batches add constraint import_batches_kind_check check (kind in ('workbook', 'clear', 'undo'));
alter table public.import_batches
  add column removed_records integer not null default 0 check (removed_records >= 0),
  add column cleared_date date,
  add column cleared_domain text,
  add column undoes_batch_id uuid unique references public.import_batches(id);
alter table public.import_batches add constraint import_batches_kind_details check (
  (kind = 'workbook' and source_file_id is not null and cleared_date is null and cleared_domain is null and undoes_batch_id is null)
  or (kind = 'clear' and source_file_id is null and cleared_date is not null and cleared_domain is not null and undoes_batch_id is null)
  or (kind = 'undo' and source_file_id is null and cleared_date is null and cleared_domain is null and undoes_batch_id is not null)
);

-- Removes one domain's saved record for one date. Other domains and dates are untouched.
create function public.clear_day(
  p_request_id uuid,
  p_expected_revision_id bigint,
  p_date date,
  p_domain text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.import_batches%rowtype;
  v_active bigint;
  v_record_id bigint;
  v_revision bigint;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can change saved history.' using errcode = '42501';
  end if;
  if p_request_id is null or p_date is null or p_domain is null then
    raise exception 'A request id, date, and domain are required.' using errcode = '22023';
  end if;

  select active_revision_id into v_active from public.workspace_state where singleton for update;

  select * into v_existing from public.import_batches where request_id = p_request_id;
  if found then
    return jsonb_build_object('batch_id', v_existing.id, 'kind', v_existing.kind, 'outcome', v_existing.outcome, 'replayed', true,
      'revision_id', coalesce(v_existing.revision_id, v_existing.base_revision_id), 'removed', v_existing.removed_records);
  end if;
  if v_active is distinct from p_expected_revision_id then
    raise exception 'Your saved history changed after this preview was prepared. Refresh and review it again.' using errcode = 'FI409';
  end if;

  select id into v_record_id from public.daily_records
  where record_date = p_date and domain = p_domain and retired_revision_id is null;
  if v_record_id is null then
    raise exception 'There is no saved record for that date and domain.' using errcode = 'P0002';
  end if;

  insert into public.data_revisions (parent_id) values (v_active) returning id into v_revision;
  update public.daily_records set retired_revision_id = v_revision where id = v_record_id;
  update public.workspace_state set active_revision_id = v_revision where singleton;
  insert into public.import_batches (request_id, kind, outcome, base_revision_id, revision_id, added_records, changed_records,
    unchanged_records, removed_records, first_date, last_date, cleared_date, cleared_domain)
  values (p_request_id, 'clear', 'changed', v_active, v_revision, 0, 0, 0, 1, p_date, p_date, p_date, p_domain)
  returning * into v_existing;

  return jsonb_build_object('batch_id', v_existing.id, 'kind', 'clear', 'outcome', 'changed', 'replayed', false,
    'revision_id', v_revision, 'removed', 1);
end;
$$;
revoke all on function public.clear_day(uuid, bigint, date, text) from public, anon;
grant execute on function public.clear_day(uuid, bigint, date, text) to authenticated;

-- Reverts the most recent import or clear that has not already been undone, restoring the exact
-- records that were active before it. Repeating it steps further back. With p_dry_run it only
-- reports what would happen and writes nothing.
create function public.undo_last_change(
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

  drop table if exists pg_temp.undo_snapshot;
  create temporary table undo_snapshot on commit drop as
  select record_date, domain, fields, source_file_id
  from public.daily_records
  where v_base is not null
    and introduced_revision_id <= v_base
    and (retired_revision_id is null or retired_revision_id > v_base);

  drop table if exists pg_temp.undo_plan;
  create temporary table undo_plan on commit drop as
  select coalesce(snapshot.record_date, current_record.record_date) as record_date,
         coalesce(snapshot.domain, current_record.domain) as domain,
         current_record.id as current_id,
         snapshot.fields as restored_fields,
         snapshot.source_file_id as restored_source_file_id,
         case when current_record.id is null then 'added'
              when snapshot.record_date is null then 'removed'
              else 'changed' end as action
  from pg_temp.undo_snapshot as snapshot
  full join (select * from public.daily_records where retired_revision_id is null) as current_record
    on current_record.record_date = snapshot.record_date and current_record.domain = snapshot.domain
  where snapshot.record_date is null
     or current_record.id is null
     or current_record.fields is distinct from snapshot.fields;

  select count(*) filter (where action = 'added'), count(*) filter (where action = 'changed'),
         count(*) filter (where action = 'removed'), min(record_date), max(record_date)
  into v_added, v_changed, v_removed, v_first, v_last
  from pg_temp.undo_plan;

  if p_dry_run then
    return jsonb_build_object('target_batch_id', v_target.id, 'target_kind', v_target.kind,
      'target_committed_at', v_target.committed_at, 'restores_revision_id', v_base,
      'added', v_added, 'changed', v_changed, 'removed', v_removed, 'first_date', v_first, 'last_date', v_last);
  end if;

  if v_added + v_changed + v_removed > 0 then
    insert into public.data_revisions (parent_id) values (v_active) returning id into v_revision;
    update public.daily_records as existing set retired_revision_id = v_revision
    from pg_temp.undo_plan as plan
    where plan.current_id = existing.id and plan.action in ('changed', 'removed');
    insert into public.daily_records (record_date, domain, fields, source_file_id, introduced_revision_id)
    select record_date, domain, restored_fields, restored_source_file_id, v_revision
    from pg_temp.undo_plan where action in ('added', 'changed');
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
revoke all on function public.undo_last_change(uuid, bigint, boolean) from public, anon;
grant execute on function public.undo_last_change(uuid, bigint, boolean) to authenticated;

-- The active snapshot now also describes every change and which one Undo would revert.
create or replace function public.active_history()
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
      select jsonb_agg(jsonb_build_object('id', batch.id, 'kind', batch.kind, 'committed_at', batch.committed_at,
        'outcome', batch.outcome, 'revision_id', batch.revision_id, 'added', batch.added_records, 'changed', batch.changed_records,
        'unchanged', batch.unchanged_records, 'removed', batch.removed_records, 'first_date', batch.first_date,
        'last_date', batch.last_date, 'cleared_date', batch.cleared_date, 'cleared_domain', batch.cleared_domain,
        'undoes_batch_id', batch.undoes_batch_id,
        'undone', exists (select 1 from public.import_batches as undo where undo.undoes_batch_id = batch.id),
        'file_name', source.file_name, 'byte_size', source.byte_size) order by batch.committed_at desc, batch.revision_id desc nulls last)
      from (select * from public.import_batches order by committed_at desc limit 50) as batch
      left join public.source_files as source on source.id = batch.source_file_id), '[]'::jsonb),
    'undo_target_id', (
      select batch.id from public.import_batches as batch
      where batch.outcome = 'changed' and batch.kind <> 'undo'
        and not exists (select 1 from public.import_batches as undo where undo.undoes_batch_id = batch.id)
      order by batch.revision_id desc limit 1)
  ) where (select public.is_app_owner());
$$;
