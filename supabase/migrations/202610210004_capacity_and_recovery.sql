-- Ticket 13: safe recovery from service and quota failures.
-- Applied by the Database migrations workflow; the Supabase CLI runs this file in one transaction.
--
-- The browser checks capacity before imports, report saves, and restores (stopping at 90% of the free
-- limits), but the database also refuses any statement that would add history once usage passes 95% of
-- the limit, so a stale or wrong browser estimate can never push the project into an overage or a
-- forced upgrade. Deletes (retention, discarding restore uploads) are never blocked, so space can always
-- be recovered. Limits live in one private row so they match the plan and can be lowered in tests.

create table private.capacity_limits (
  singleton boolean primary key default true check (singleton),
  database_limit_bytes bigint not null check (database_limit_bytes > 0),
  archive_limit_bytes bigint not null check (archive_limit_bytes > 0),
  hard_stop_fraction numeric not null default 0.95 check (hard_stop_fraction > 0 and hard_stop_fraction <= 1)
);
insert into private.capacity_limits (database_limit_bytes, archive_limit_bytes) values (524288000, 1073741824);
revoke all on private.capacity_limits from public, anon, authenticated;

create or replace function public.capacity_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limits private.capacity_limits%rowtype;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can check capacity.' using errcode = '42501';
  end if;
  select * into v_limits from private.capacity_limits where singleton;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'database_limit_bytes', v_limits.database_limit_bytes,
    'archive_bytes', (select coalesce(sum(byte_size), 0) from public.source_files),
    'archive_limit_bytes', v_limits.archive_limit_bytes,
    'hard_stop_fraction', v_limits.hard_stop_fraction,
    'staging_bytes', (select coalesce(sum(pg_column_size(rows)), 0) from public.restore_staging),
    'staging_uploads', (select count(distinct restore_id) from public.restore_staging),
    'oldest_staging_at', (select min(created_at) from public.restore_staging));
end;
$$;

create function private.enforce_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits private.capacity_limits%rowtype;
begin
  select * into v_limits from private.capacity_limits where singleton;
  if pg_database_size(current_database()) > v_limits.database_limit_bytes * v_limits.hard_stop_fraction then
    raise exception 'The free database is nearly full, so nothing new was saved. Your existing data is unchanged. Remove older versions in Version retention or download a backup and free space, then try again.'
      using errcode = 'FI507';
  end if;
  return null;
end;
$$;

create trigger enforce_capacity before insert on public.daily_records for each statement execute function private.enforce_capacity();
create trigger enforce_capacity before insert on public.food_days for each statement execute function private.enforce_capacity();
create trigger enforce_capacity before insert on public.workout_days for each statement execute function private.enforce_capacity();
create trigger enforce_capacity before insert on public.import_batches for each statement execute function private.enforce_capacity();
create trigger enforce_capacity before insert on public.reports for each statement execute function private.enforce_capacity();
create trigger enforce_capacity before insert on public.restore_staging for each statement execute function private.enforce_capacity();
create trigger enforce_capacity before insert on public.source_files for each statement execute function private.enforce_capacity();

-- Owner-reviewed cleanup of restore uploads that were never applied (older than p_older_than).
-- Only staging is touched: current records, retained versions, reports, and archives are never removed here.
create function public.discard_stale_restores(p_older_than interval default interval '10 minutes')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uploads integer;
  v_chunks integer;
begin
  if not public.is_app_owner() then
    raise exception 'Only the workspace owner can clean up uploads.' using errcode = '42501';
  end if;
  if p_older_than < interval '10 minutes' then
    raise exception 'Only uploads older than 10 minutes can be removed, so a restore in progress is never interrupted.' using errcode = '22023';
  end if;
  select count(distinct restore_id), count(*) into v_uploads, v_chunks from public.restore_staging where created_at < now() - p_older_than;
  delete from public.restore_staging where created_at < now() - p_older_than;
  return jsonb_build_object('removed_uploads', v_uploads, 'removed_chunks', v_chunks);
end;
$$;
revoke all on function public.discard_stale_restores(interval) from public, anon;
grant execute on function public.discard_stale_restores(interval) to authenticated;
