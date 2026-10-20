-- Ticket 05: workouts with original logging conventions.
-- Applied by the Database migrations workflow; the Supabase CLI runs this file in one transaction.
--
-- Workout sets are stored per date as one "workout day": every set in source order (identical sets
-- kept) with values exactly as logged. A workout CSV is authoritative over the workbook Workout Log
-- for any date it covers, including across imports. Loads are never combined with
-- "Exercise Base Weight (lb)"; that value is metadata only.

alter table public.import_batches
  add column workout_added integer not null default 0 check (workout_added >= 0),
  add column workout_changed integer not null default 0 check (workout_changed >= 0),
  add column workout_unchanged integer not null default 0 check (workout_unchanged >= 0),
  add column workout_kept_by_precedence integer not null default 0 check (workout_kept_by_precedence >= 0);

alter table public.import_batch_sources drop constraint import_batch_sources_source_kind_check;
alter table public.import_batch_sources add constraint import_batch_sources_source_kind_check check (source_kind in ('workbook', 'food_csv', 'workout_csv'));

create table public.workout_days (
  id bigint generated always as identity primary key,
  workout_date date not null,
  source_kind text not null check (source_kind in ('workout_csv', 'workbook_workout_log')),
  sets jsonb not null check (jsonb_typeof(sets) = 'array'),
  set_count integer not null check (set_count >= 0),
  source_file_id uuid not null references public.source_files(id),
  introduced_revision_id bigint not null references public.data_revisions(id),
  retired_revision_id bigint references public.data_revisions(id),
  check (retired_revision_id is null or retired_revision_id > introduced_revision_id)
);
create unique index workout_days_one_active on public.workout_days (workout_date) where retired_revision_id is null;
create index workout_days_introduced on public.workout_days (introduced_revision_id);
create index workout_days_retired on public.workout_days (retired_revision_id);
alter table public.workout_days enable row level security;
revoke all on public.workout_days from public, anon, authenticated;
grant select on public.workout_days to authenticated;
create policy owner_reads_workout_days on public.workout_days for select to authenticated using ((select public.is_app_owner()));

-- Cosmetic display names for logged exercise names. Raw records are never changed; distinct names
-- are only grouped when the owner explicitly maps them to the same display name.
create table public.exercise_aliases (
  source_name text primary key check (length(source_name) between 1 and 200),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  updated_at timestamptz not null default now()
);
alter table public.exercise_aliases enable row level security;
alter table public.exercise_aliases force row level security;
revoke all on public.exercise_aliases from public, anon, authenticated;
grant select, insert, update, delete on public.exercise_aliases to authenticated;
create policy owner_reads_aliases on public.exercise_aliases for select to authenticated using ((select public.is_app_owner()));
create policy owner_adds_aliases on public.exercise_aliases for insert to authenticated with check ((select public.is_app_owner()));
create policy owner_changes_aliases on public.exercise_aliases for update to authenticated using ((select public.is_app_owner())) with check ((select public.is_app_owner()));
create policy owner_removes_aliases on public.exercise_aliases for delete to authenticated using ((select public.is_app_owner()));

-- Provisional interpretation of the exported duration values (unverified; seconds by default).
alter table public.preferences
  add column duration_unit text not null default 'seconds' check (duration_unit in ('seconds', 'minutes'));

-- commit_sources gains workouts (a new parameter changes the signature, so it is recreated).
drop function public.commit_sources(uuid, bigint, jsonb, jsonb, jsonb, boolean, boolean);

-- Atomically applies a previewed import of up to one workbook, one food CSV, and one workout CSV.
-- Safe to retry with the same request id. With p_dry_run it returns the comparison without writing.
-- p_sources:  [{"kind":"workbook"|"food_csv"|"workout_csv","sha256","file_name","byte_size","media_type"}]
-- p_daily:    [{"date","domain","fields":{label: number|null}}]                         (workbook)
-- p_food:     [{"date","source_kind":"food_csv"|"workbook_food_log","entries":[...]}]
-- p_workouts: [{"date","source_kind":"workout_csv"|"workbook_workout_log","sets":[{label: text|number}]}]
create function public.commit_sources(
  p_request_id uuid,
  p_expected_revision_id bigint,
  p_sources jsonb,
  p_daily jsonb,
  p_food jsonb,
  p_accept_reconciliation boolean default false,
  p_dry_run boolean default false,
  p_workouts jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.import_batches%rowtype;
  v_active bigint;
  v_revision bigint;
  v_source jsonb;
  v_sha text;
  v_path text;
  v_archived boolean;
  v_source_id uuid;
  v_workbook_id uuid;
  v_food_csv_id uuid;
  v_workout_csv_id uuid;
  v_daily_added integer;
  v_daily_changed integer;
  v_daily_unchanged integer;
  v_food_added integer;
  v_food_changed integer;
  v_food_unchanged integer;
  v_food_kept integer;
  v_workout_added integer;
  v_workout_changed integer;
  v_workout_unchanged integer;
  v_workout_kept integer;
  v_conflicts jsonb;
  v_first date;
  v_last date;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can import data.' using errcode = '42501';
  end if;

  if p_dry_run then
    select active_revision_id into v_active from public.workspace_state where singleton;
  else
    if p_request_id is null then
      raise exception 'An import request id is required.' using errcode = '22023';
    end if;
    select active_revision_id into v_active from public.workspace_state where singleton for update;
    select * into v_existing from public.import_batches where request_id = p_request_id;
    if found then
      return jsonb_build_object('batch_id', v_existing.id, 'kind', v_existing.kind, 'outcome', v_existing.outcome, 'replayed', true,
        'revision_id', coalesce(v_existing.revision_id, v_existing.base_revision_id),
        'added', v_existing.added_records, 'changed', v_existing.changed_records, 'unchanged', v_existing.unchanged_records,
        'food_added', v_existing.food_added, 'food_changed', v_existing.food_changed, 'food_unchanged', v_existing.food_unchanged,
        'food_kept', v_existing.food_kept_by_precedence, 'workout_added', v_existing.workout_added, 'workout_changed', v_existing.workout_changed,
        'workout_unchanged', v_existing.workout_unchanged, 'workout_kept', v_existing.workout_kept_by_precedence, 'conflicts', v_existing.reconciliation);
    end if;
  end if;
  if v_active is distinct from p_expected_revision_id then
    raise exception 'Your saved history changed after this preview was prepared. Refresh and preview the import again.' using errcode = 'FI409';
  end if;

  if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 3
     or (select count(distinct item ->> 'kind') from jsonb_array_elements(p_sources) as item) <> jsonb_array_length(p_sources) then
    raise exception 'An import needs at most one workbook, one food CSV, and one workout CSV.' using errcode = '22023';
  end if;
  for v_source in select * from jsonb_array_elements(p_sources) loop
    if coalesce(v_source ->> 'kind', '') not in ('workbook', 'food_csv', 'workout_csv') or lower(coalesce(v_source ->> 'sha256', '')) !~ '^[0-9a-f]{64}$' then
      raise exception 'A source file description is invalid.' using errcode = '22023';
    end if;
  end loop;

  -- Stage the incoming records.
  drop table if exists pg_temp.incoming_records;
  create temporary table incoming_records (record_date date not null, domain text not null, fields jsonb not null, status text) on commit drop;
  insert into pg_temp.incoming_records (record_date, domain, fields)
  select (item ->> 'date')::date, item ->> 'domain', item -> 'fields' from jsonb_array_elements(coalesce(p_daily, '[]'::jsonb)) as item;

  drop table if exists pg_temp.incoming_food;
  create temporary table incoming_food (food_date date not null, source_kind text not null, entries jsonb not null, status text) on commit drop;
  insert into pg_temp.incoming_food (food_date, source_kind, entries)
  select (item ->> 'date')::date, item ->> 'source_kind', item -> 'entries' from jsonb_array_elements(coalesce(p_food, '[]'::jsonb)) as item;

  drop table if exists pg_temp.incoming_workouts;
  create temporary table incoming_workouts (workout_date date not null, source_kind text not null, sets jsonb not null, status text) on commit drop;
  insert into pg_temp.incoming_workouts (workout_date, source_kind, sets)
  select (item ->> 'date')::date, item ->> 'source_kind', item -> 'sets' from jsonb_array_elements(coalesce(p_workouts, '[]'::jsonb)) as item;

  if not exists (select 1 from pg_temp.incoming_records) and not exists (select 1 from pg_temp.incoming_food)
     and not exists (select 1 from pg_temp.incoming_workouts) then
    raise exception 'The import contains no records.' using errcode = '22023';
  end if;
  if (select count(*) from pg_temp.incoming_records) > 20000 or (select count(*) from pg_temp.incoming_food) > 5000
     or (select count(*) from pg_temp.incoming_workouts) > 5000 then
    raise exception 'The import is too large for one commit.' using errcode = '54000';
  end if;
  if exists (
    select 1 from pg_temp.incoming_records
    where domain not in ('scale_weight', 'trend_weight', 'expenditure', 'nutrition_totals', 'targets', 'steps')
      or jsonb_typeof(fields) is distinct from 'object'
      or exists (select 1 from jsonb_each(fields) as field where jsonb_typeof(field.value) not in ('number', 'null'))
  ) or exists (
    select 1 from pg_temp.incoming_food
    where source_kind not in ('food_csv', 'workbook_food_log')
      or jsonb_typeof(entries) is distinct from 'array'
      or exists (select 1 from jsonb_array_elements(entries) as entry
                 where jsonb_typeof(entry) is distinct from 'object'
                    or exists (select 1 from jsonb_each(entry) as field where jsonb_typeof(field.value) not in ('number', 'string')))
  ) or exists (
    select 1 from pg_temp.incoming_workouts
    where source_kind not in ('workout_csv', 'workbook_workout_log')
      or jsonb_typeof(sets) is distinct from 'array'
      or exists (select 1 from jsonb_array_elements(sets) as set_item
                 where jsonb_typeof(set_item) is distinct from 'object'
                    or exists (select 1 from jsonb_each(set_item) as field where jsonb_typeof(field.value) not in ('number', 'string')))
  ) then
    raise exception 'The import contains an unsupported domain or value.' using errcode = '22023';
  end if;
  if exists (select 1 from pg_temp.incoming_records group by record_date, domain having count(*) > 1)
     or exists (select 1 from pg_temp.incoming_food group by food_date having count(*) > 1)
     or exists (select 1 from pg_temp.incoming_workouts group by workout_date having count(*) > 1) then
    raise exception 'The import repeats a date within one domain.' using errcode = '22023';
  end if;
  if (exists (select 1 from pg_temp.incoming_records)
      or exists (select 1 from pg_temp.incoming_food where source_kind = 'workbook_food_log')
      or exists (select 1 from pg_temp.incoming_workouts where source_kind = 'workbook_workout_log'))
     and not exists (select 1 from jsonb_array_elements(p_sources) as item where item ->> 'kind' = 'workbook') then
    raise exception 'Daily records and workbook detail require the workbook source.' using errcode = '22023';
  end if;
  if exists (select 1 from pg_temp.incoming_food where source_kind = 'food_csv')
     and not exists (select 1 from jsonb_array_elements(p_sources) as item where item ->> 'kind' = 'food_csv') then
    raise exception 'Food CSV entries require the food CSV source.' using errcode = '22023';
  end if;
  if exists (select 1 from pg_temp.incoming_workouts where source_kind = 'workout_csv')
     and not exists (select 1 from jsonb_array_elements(p_sources) as item where item ->> 'kind' = 'workout_csv') then
    raise exception 'Workout CSV sets require the workout CSV source.' using errcode = '22023';
  end if;

  -- Compare with the active history.
  update pg_temp.incoming_records as incoming
  set status = case when active.id is null then 'added' when active.fields = incoming.fields then 'unchanged' else 'changed' end
  from (select inner_incoming.record_date, inner_incoming.domain, existing.id, existing.fields
        from pg_temp.incoming_records as inner_incoming
        left join public.daily_records as existing
          on existing.record_date = inner_incoming.record_date and existing.domain = inner_incoming.domain and existing.retired_revision_id is null) as active
  where active.record_date = incoming.record_date and active.domain = incoming.domain;

  update pg_temp.incoming_food as incoming
  set status = case
    when active.id is null then 'added'
    when active.source_kind = 'food_csv' and incoming.source_kind = 'workbook_food_log' then 'kept'
    when active.entries = incoming.entries and active.source_kind = incoming.source_kind then 'unchanged'
    else 'changed' end
  from (select inner_incoming.food_date, existing.id, existing.entries, existing.source_kind
        from pg_temp.incoming_food as inner_incoming
        left join public.food_days as existing on existing.food_date = inner_incoming.food_date and existing.retired_revision_id is null) as active
  where active.food_date = incoming.food_date;

  update pg_temp.incoming_workouts as incoming
  set status = case
    when active.id is null then 'added'
    -- The workout CSV has precedence: workbook Workout Log detail never replaces saved CSV detail.
    when active.source_kind = 'workout_csv' and incoming.source_kind = 'workbook_workout_log' then 'kept'
    when active.sets = incoming.sets and active.source_kind = incoming.source_kind then 'unchanged'
    else 'changed' end
  from (select inner_incoming.workout_date, existing.id, existing.sets, existing.source_kind
        from pg_temp.incoming_workouts as inner_incoming
        left join public.workout_days as existing on existing.workout_date = inner_incoming.workout_date and existing.retired_revision_id is null) as active
  where active.workout_date = incoming.workout_date;

  select count(*) filter (where status = 'added'), count(*) filter (where status = 'changed'), count(*) filter (where status = 'unchanged')
  into v_daily_added, v_daily_changed, v_daily_unchanged from pg_temp.incoming_records;
  select count(*) filter (where status = 'added'), count(*) filter (where status = 'changed'),
         count(*) filter (where status = 'unchanged'), count(*) filter (where status = 'kept')
  into v_food_added, v_food_changed, v_food_unchanged, v_food_kept from pg_temp.incoming_food;
  select count(*) filter (where status = 'added'), count(*) filter (where status = 'changed'),
         count(*) filter (where status = 'unchanged'), count(*) filter (where status = 'kept')
  into v_workout_added, v_workout_changed, v_workout_unchanged, v_workout_kept from pg_temp.incoming_workouts;
  select min(day), max(day) into v_first, v_last
  from (select record_date as day from pg_temp.incoming_records union all select food_date from pg_temp.incoming_food
        union all select workout_date from pg_temp.incoming_workouts) as days;

  -- Food reconciliation on dates this import touches (unchanged from ticket 04).
  with final_food as (
    select food_date, entries from pg_temp.incoming_food where status in ('added', 'changed')
    union all
    select existing.food_date, existing.entries from public.food_days as existing
    where existing.retired_revision_id is null
      and not exists (select 1 from pg_temp.incoming_food as incoming where incoming.food_date = existing.food_date and incoming.status in ('added', 'changed'))
  ), final_totals as (
    select record_date, fields from pg_temp.incoming_records where domain = 'nutrition_totals' and status in ('added', 'changed', 'unchanged')
    union all
    select existing.record_date, existing.fields from public.daily_records as existing
    where existing.domain = 'nutrition_totals' and existing.retired_revision_id is null
      and not exists (select 1 from pg_temp.incoming_records as incoming where incoming.record_date = existing.record_date and incoming.domain = 'nutrition_totals')
  ), touched as (
    select food_date as day from pg_temp.incoming_food where status in ('added', 'changed')
    union
    select record_date from pg_temp.incoming_records where domain = 'nutrition_totals' and status in ('added', 'changed')
  ), compared as (
    select touched.day, public.food_calories(final_food.entries) as detail_calories,
           case when jsonb_typeof(final_totals.fields -> 'Calories (kcal)') = 'number' then (final_totals.fields ->> 'Calories (kcal)')::numeric end as workbook_calories
    from touched
    join final_food on final_food.food_date = touched.day
    join final_totals on final_totals.record_date = touched.day
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', day, 'detail_calories', detail_calories, 'workbook_calories', workbook_calories,
    'difference', detail_calories - workbook_calories) order by day), '[]'::jsonb)
  into v_conflicts
  from compared
  where detail_calories is not null and workbook_calories is not null
    and abs(detail_calories - workbook_calories) > greatest(5, abs(workbook_calories) * 0.01);

  if p_dry_run then
    return jsonb_build_object('revision_id', v_active,
      'added', v_daily_added, 'changed', v_daily_changed, 'unchanged', v_daily_unchanged,
      'food_added', v_food_added, 'food_changed', v_food_changed, 'food_unchanged', v_food_unchanged, 'food_kept', v_food_kept,
      'workout_added', v_workout_added, 'workout_changed', v_workout_changed, 'workout_unchanged', v_workout_unchanged, 'workout_kept', v_workout_kept,
      'kept_dates', coalesce((select jsonb_agg(food_date order by food_date) from pg_temp.incoming_food where status = 'kept'), '[]'::jsonb),
      'changed_food_dates', coalesce((select jsonb_agg(food_date order by food_date) from pg_temp.incoming_food where status = 'changed'), '[]'::jsonb),
      'kept_workout_dates', coalesce((select jsonb_agg(workout_date order by workout_date) from pg_temp.incoming_workouts where status = 'kept'), '[]'::jsonb),
      'changed_workout_dates', coalesce((select jsonb_agg(workout_date order by workout_date) from pg_temp.incoming_workouts where status = 'changed'), '[]'::jsonb),
      'conflicts', v_conflicts);
  end if;

  if jsonb_array_length(v_conflicts) > 0 and not coalesce(p_accept_reconciliation, false) then
    raise exception 'Food detail and workbook calorie totals disagree on % date(s). Review them and accept the food detail as the source before importing.', jsonb_array_length(v_conflicts)
      using errcode = 'FI422';
  end if;

  for v_source in select * from jsonb_array_elements(p_sources) loop
    v_sha := lower(v_source ->> 'sha256');
    v_path := case v_source ->> 'kind' when 'workbook' then 'workbooks/' || v_sha || '.xlsx'
                                       when 'food_csv' then 'food-csv/' || v_sha || '.csv'
                                       else 'workout-csv/' || v_sha || '.csv' end;
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)' into v_archived using 'source-archives', v_path;
      if not v_archived then
        raise exception 'The source file archive was not found. Retry the import.' using errcode = 'FI404';
      end if;
    end if;
    insert into public.source_files (sha256, file_name, byte_size, media_type, storage_path)
    values (v_sha, left(coalesce(nullif(v_source ->> 'file_name', ''), 'source'), 255), (v_source ->> 'byte_size')::bigint,
            coalesce(nullif(v_source ->> 'media_type', ''), 'application/octet-stream'), v_path)
    on conflict (sha256) do nothing;
    select id into v_source_id from public.source_files where sha256 = v_sha;
    case v_source ->> 'kind'
      when 'workbook' then v_workbook_id := v_source_id;
      when 'food_csv' then v_food_csv_id := v_source_id;
      else v_workout_csv_id := v_source_id;
    end case;
  end loop;

  if v_daily_added + v_daily_changed + v_food_added + v_food_changed + v_workout_added + v_workout_changed > 0 then
    insert into public.data_revisions (parent_id) values (v_active) returning id into v_revision;

    update public.daily_records as existing set retired_revision_id = v_revision
    from pg_temp.incoming_records as incoming
    where incoming.status = 'changed' and existing.record_date = incoming.record_date
      and existing.domain = incoming.domain and existing.retired_revision_id is null;
    insert into public.daily_records (record_date, domain, fields, source_file_id, introduced_revision_id)
    select record_date, domain, fields, v_workbook_id, v_revision from pg_temp.incoming_records where status in ('added', 'changed');

    update public.food_days as existing set retired_revision_id = v_revision
    from pg_temp.incoming_food as incoming
    where incoming.status = 'changed' and existing.food_date = incoming.food_date and existing.retired_revision_id is null;
    insert into public.food_days (food_date, source_kind, entries, entry_count, source_file_id, introduced_revision_id)
    select food_date, source_kind, entries, jsonb_array_length(entries),
           case source_kind when 'food_csv' then v_food_csv_id else v_workbook_id end, v_revision
    from pg_temp.incoming_food where status in ('added', 'changed');

    update public.workout_days as existing set retired_revision_id = v_revision
    from pg_temp.incoming_workouts as incoming
    where incoming.status = 'changed' and existing.workout_date = incoming.workout_date and existing.retired_revision_id is null;
    insert into public.workout_days (workout_date, source_kind, sets, set_count, source_file_id, introduced_revision_id)
    select workout_date, source_kind, sets, jsonb_array_length(sets),
           case source_kind when 'workout_csv' then v_workout_csv_id else v_workbook_id end, v_revision
    from pg_temp.incoming_workouts where status in ('added', 'changed');

    update public.workspace_state set active_revision_id = v_revision where singleton;
  end if;

  insert into public.import_batches (request_id, source_file_id, kind, outcome, base_revision_id, revision_id,
    added_records, changed_records, unchanged_records, food_added, food_changed, food_unchanged, food_kept_by_precedence,
    workout_added, workout_changed, workout_unchanged, workout_kept_by_precedence, reconciliation, first_date, last_date)
  values (p_request_id, coalesce(v_workbook_id, v_food_csv_id, v_workout_csv_id), 'import',
    case when v_revision is null then 'unchanged' else 'changed' end, v_active, v_revision,
    v_daily_added, v_daily_changed, v_daily_unchanged, v_food_added, v_food_changed, v_food_unchanged, v_food_kept,
    v_workout_added, v_workout_changed, v_workout_unchanged, v_workout_kept, v_conflicts, v_first, v_last)
  returning * into v_existing;
  insert into public.import_batch_sources (batch_id, source_file_id, source_kind)
  select v_existing.id, source_id, kind from (values (v_workbook_id, 'workbook'), (v_food_csv_id, 'food_csv'), (v_workout_csv_id, 'workout_csv')) as sources (source_id, kind)
  where source_id is not null;

  return jsonb_build_object('batch_id', v_existing.id, 'kind', 'import', 'outcome', v_existing.outcome, 'replayed', false,
    'revision_id', coalesce(v_revision, v_active), 'added', v_daily_added, 'changed', v_daily_changed, 'unchanged', v_daily_unchanged,
    'food_added', v_food_added, 'food_changed', v_food_changed, 'food_unchanged', v_food_unchanged, 'food_kept', v_food_kept,
    'workout_added', v_workout_added, 'workout_changed', v_workout_changed, 'workout_unchanged', v_workout_unchanged, 'workout_kept', v_workout_kept,
    'conflicts', v_conflicts);
end;
$$;
revoke all on function public.commit_sources(uuid, bigint, jsonb, jsonb, jsonb, boolean, boolean, jsonb) from public, anon;
grant execute on function public.commit_sources(uuid, bigint, jsonb, jsonb, jsonb, boolean, boolean, jsonb) to authenticated;

-- Clearing now also covers a date's workout sets (domain 'workout_sets').
create or replace function public.clear_day(
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

  if p_domain = 'food_entries' then
    select id into v_record_id from public.food_days where food_date = p_date and retired_revision_id is null;
  elsif p_domain = 'workout_sets' then
    select id into v_record_id from public.workout_days where workout_date = p_date and retired_revision_id is null;
  else
    select id into v_record_id from public.daily_records where record_date = p_date and domain = p_domain and retired_revision_id is null;
  end if;
  if v_record_id is null then
    raise exception 'There is no saved record for that date and domain.' using errcode = 'P0002';
  end if;

  insert into public.data_revisions (parent_id) values (v_active) returning id into v_revision;
  if p_domain = 'food_entries' then
    update public.food_days set retired_revision_id = v_revision where id = v_record_id;
  elsif p_domain = 'workout_sets' then
    update public.workout_days set retired_revision_id = v_revision where id = v_record_id;
  else
    update public.daily_records set retired_revision_id = v_revision where id = v_record_id;
  end if;
  update public.workspace_state set active_revision_id = v_revision where singleton;
  insert into public.import_batches (request_id, kind, outcome, base_revision_id, revision_id, added_records, changed_records,
    unchanged_records, removed_records, first_date, last_date, cleared_date, cleared_domain)
  values (p_request_id, 'clear', 'changed', v_active, v_revision, 0, 0, 0, 1, p_date, p_date, p_date, p_domain)
  returning * into v_existing;

  return jsonb_build_object('batch_id', v_existing.id, 'kind', 'clear', 'outcome', 'changed', 'replayed', false,
    'revision_id', v_revision, 'removed', 1);
end;
$$;

-- Undo now restores workout sets as well as daily records and food detail.
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

-- Active history adds per-date workout summaries, exercise aliases, and workout import counts.
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
    'food_days', coalesce((
      select jsonb_agg(jsonb_build_object('date', day.food_date, 'source_kind', day.source_kind, 'entries', day.entry_count,
        'calories', totals.calories, 'protein', totals.protein, 'fat', totals.fat, 'carbs', totals.carbs,
        'missing_calories', totals.missing_calories, 'revision_id', day.introduced_revision_id) order by day.food_date)
      from public.food_days as day
      cross join lateral (
        select sum((entry ->> 'Calories (kcal)')::numeric) filter (where jsonb_typeof(entry -> 'Calories (kcal)') = 'number') as calories,
               sum((entry ->> 'Protein (g)')::numeric) filter (where jsonb_typeof(entry -> 'Protein (g)') = 'number') as protein,
               sum((entry ->> 'Fat (g)')::numeric) filter (where jsonb_typeof(entry -> 'Fat (g)') = 'number') as fat,
               sum((entry ->> 'Carbs (g)')::numeric) filter (where jsonb_typeof(entry -> 'Carbs (g)') = 'number') as carbs,
               count(*) filter (where jsonb_typeof(entry -> 'Calories (kcal)') is distinct from 'number') as missing_calories
        from jsonb_array_elements(day.entries) as entry) as totals
      where day.retired_revision_id is null), '[]'::jsonb),
    'workout_days', coalesce((
      select jsonb_agg(jsonb_build_object('date', day.workout_date, 'source_kind', day.source_kind, 'sets', day.set_count,
        'workouts', summary.workouts, 'durations', summary.durations, 'exercises', summary.exercises,
        'revision_id', day.introduced_revision_id) order by day.workout_date)
      from public.workout_days as day
      cross join lateral (
        select coalesce(jsonb_agg(distinct set_item -> 'Workout') filter (where set_item ? 'Workout'), '[]'::jsonb) as workouts,
               coalesce(jsonb_agg(distinct set_item -> 'Workout Duration') filter (where set_item ? 'Workout Duration'), '[]'::jsonb) as durations,
               count(distinct set_item ->> 'Exercise') as exercises
        from jsonb_array_elements(day.sets) as set_item) as summary
      where day.retired_revision_id is null), '[]'::jsonb),
    'aliases', coalesce((select jsonb_object_agg(source_name, display_name) from public.exercise_aliases), '{}'::jsonb),
    'exercise_names', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'sets', set_total, 'days', day_total) order by name)
      from (select set_item ->> 'Exercise' as name, count(*) as set_total, count(distinct day.workout_date) as day_total
            from public.workout_days as day cross join lateral jsonb_array_elements(day.sets) as set_item
            where day.retired_revision_id is null and set_item ? 'Exercise'
            group by set_item ->> 'Exercise') as names), '[]'::jsonb),
    'imports', coalesce((
      select jsonb_agg(jsonb_build_object('id', batch.id, 'kind', batch.kind, 'committed_at', batch.committed_at,
        'outcome', batch.outcome, 'revision_id', batch.revision_id, 'added', batch.added_records, 'changed', batch.changed_records,
        'unchanged', batch.unchanged_records, 'removed', batch.removed_records, 'first_date', batch.first_date,
        'last_date', batch.last_date, 'cleared_date', batch.cleared_date, 'cleared_domain', batch.cleared_domain,
        'undoes_batch_id', batch.undoes_batch_id,
        'undone', exists (select 1 from public.import_batches as undo where undo.undoes_batch_id = batch.id),
        'food_added', batch.food_added, 'food_changed', batch.food_changed, 'food_unchanged', batch.food_unchanged,
        'food_kept', batch.food_kept_by_precedence, 'workout_added', batch.workout_added, 'workout_changed', batch.workout_changed,
        'workout_unchanged', batch.workout_unchanged, 'workout_kept', batch.workout_kept_by_precedence,
        'reconciliation', batch.reconciliation, 'file_name', source.file_name, 'byte_size', source.byte_size,
        'file_names', coalesce((select jsonb_agg(files.file_name order by link.source_kind)
                                from public.import_batch_sources as link join public.source_files as files on files.id = link.source_file_id
                                where link.batch_id = batch.id), case when source.file_name is null then '[]'::jsonb else jsonb_build_array(source.file_name) end))
        order by batch.committed_at desc, batch.revision_id desc nulls last)
      from (select * from public.import_batches order by committed_at desc limit 50) as batch
      left join public.source_files as source on source.id = batch.source_file_id), '[]'::jsonb),
    'undo_target_id', (
      select batch.id from public.import_batches as batch
      where batch.outcome = 'changed' and batch.kind <> 'undo'
        and not exists (select 1 from public.import_batches as undo where undo.undoes_batch_id = batch.id)
      order by batch.revision_id desc limit 1)
  ) where (select public.is_app_owner());
$$;

-- The sets of one saved workout day, for browsing.
create function public.workout_day_sets(p_date date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('date', day.workout_date, 'source_kind', day.source_kind, 'sets', day.sets, 'revision_id', day.introduced_revision_id)
  from public.workout_days as day
  where day.workout_date = p_date and day.retired_revision_id is null and (select public.is_app_owner());
$$;
revoke all on function public.workout_day_sets(date) from public, anon;
grant execute on function public.workout_day_sets(date) to authenticated;
