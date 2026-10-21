-- Ticket 09: exercise performance and workload.
-- Applied by the Database migrations workflow; the Supabase CLI runs this file in one transaction.
--
-- The analysis runs in the browser over every active workout set, so it needs them in one read.
-- The progress label band (accepted default ±2.5%) is an owner setting, not a constant.

alter table public.preferences
  add column strength_band_percent numeric(4, 1) not null default 2.5
  check (strength_band_percent >= 0.5 and strength_band_percent <= 20);

-- Every active workout day with its sets, oldest first. Empty for anyone but the owner.
create function public.active_workout_sets()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', day.workout_date, 'source_kind', day.source_kind, 'sets', day.sets, 'revision_id', day.introduced_revision_id)
    order by day.workout_date), '[]'::jsonb)
  from public.workout_days as day
  where day.retired_revision_id is null and (select public.is_app_owner());
$$;
revoke all on function public.active_workout_sets() from public, anon;
grant execute on function public.active_workout_sets() to authenticated;
