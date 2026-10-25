-- Ticket 19: food-level patterns on over-target days.
-- Applied by the Database migrations workflow; the Supabase CLI runs this file in one transaction.
--
-- The analysis runs in the browser over every active food day, so it needs their entries in one read.

-- Every active food day with its entries, oldest first. Empty for anyone but the owner.
create function public.active_food_entries()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', day.food_date, 'source_kind', day.source_kind, 'entries', day.entries, 'revision_id', day.introduced_revision_id)
    order by day.food_date), '[]'::jsonb)
  from public.food_days as day
  where day.retired_revision_id is null and (select public.is_app_owner());
$$;
revoke all on function public.active_food_entries() from public, anon;
grant execute on function public.active_food_entries() to authenticated;
