begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Owner enrollment is an administrator action, never a first-sign-in claim.
create table private.app_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id)
);
revoke all on private.app_owner from public, anon, authenticated;

create function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.app_owner
    where user_id = (select auth.uid())
  ) and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'github';
$$;
revoke all on function public.is_app_owner() from public, anon;
grant execute on function public.is_app_owner() to authenticated;

create table public.preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_density text not null default 'comfortable'
    check (display_density in ('comfortable', 'compact')),
  timezone text not null default 'America/Denver' check (timezone = 'America/Denver'),
  week_starts_on integer not null default 1 check (week_starts_on = 1)
);
alter table public.preferences enable row level security;
alter table public.preferences force row level security;
revoke all on public.preferences from public, anon, authenticated;
grant select, insert, update on public.preferences to authenticated;

create policy owner_reads_preferences on public.preferences
for select to authenticated
using ((select public.is_app_owner()) and user_id = (select auth.uid()));

create policy owner_creates_preferences on public.preferences
for insert to authenticated
with check ((select public.is_app_owner()) and user_id = (select auth.uid()));

create policy owner_updates_preferences on public.preferences
for update to authenticated
using ((select public.is_app_owner()) and user_id = (select auth.uid()))
with check ((select public.is_app_owner()) and user_id = (select auth.uid()));

commit;
