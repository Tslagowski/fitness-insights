-- Ticket 06: review decisions for suspicious values and nutrition completeness marks.
-- Applied by the Database migrations workflow; the Supabase CLI runs this file in one transaction.
--
-- Both are append-only owner logs: every decision is a new row and the latest row for the same key
-- wins, so earlier decisions remain reconstructable for saved reports (ticket 11). They are not part
-- of import revisions: importing, clearing, or undoing data never deletes them. A review decision is
-- keyed to the exact saved value, so a changed value is evaluated again.

create table public.review_decisions (
  id bigint generated always as identity primary key,
  record_date date not null,
  domain text not null check (domain in ('scale_weight')),
  field text not null check (length(field) between 1 and 120),
  value numeric not null,
  decision text not null check (decision in ('keep', 'exclude', 'pending')),
  decided_at timestamptz not null default now()
);
create index review_decisions_key on public.review_decisions (record_date, domain, field, value, decided_at desc);

create table public.completeness_marks (
  id bigint generated always as identity primary key,
  mark_date date not null,
  domain text not null check (domain in ('nutrition')),
  status text not null check (status in ('incomplete', 'complete')),
  decided_at timestamptz not null default now()
);
create index completeness_marks_key on public.completeness_marks (mark_date, domain, decided_at desc);

do $$
declare table_name text;
begin
  foreach table_name in array array['review_decisions', 'completeness_marks'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    -- Append-only for the owner: read and add, never update or delete.
    execute format('grant select, insert on public.%I to authenticated', table_name);
    execute format('create policy owner_reads_%s on public.%I for select to authenticated using ((select public.is_app_owner()))', table_name, table_name);
    execute format('create policy owner_adds_%s on public.%I for insert to authenticated with check ((select public.is_app_owner()))', table_name, table_name);
  end loop;
end $$;

-- The full decision and mark logs (small), ordered so the latest per key is last.
create function public.review_state()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('date', record_date, 'domain', domain, 'field', field, 'value', value,
      'decision', decision, 'decided_at', decided_at) order by decided_at, id) from public.review_decisions), '[]'::jsonb),
    'completeness', coalesce((select jsonb_agg(jsonb_build_object('date', mark_date, 'domain', domain, 'status', status,
      'decided_at', decided_at) order by decided_at, id) from public.completeness_marks), '[]'::jsonb)
  ) where (select public.is_app_owner());
$$;
revoke all on function public.review_state() from public, anon;
grant execute on function public.review_state() to authenticated;
