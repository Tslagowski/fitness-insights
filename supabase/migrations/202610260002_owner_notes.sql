-- Ticket 25: dated owner notes (for example a new program or travel).
-- Applied by the Database migrations workflow; the Supabase CLI runs this file in one transaction.
--
-- Notes are append-only: an edit or a removal adds a new version of the note, so its history is kept.
-- The latest version of each note wins; a removed note's latest version has removed = true. Private,
-- owner-only, and included in backups (older backups restore with no notes).

create table public.owner_notes (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null,
  version integer not null check (version >= 1),
  start_date date not null,
  end_date date not null,
  body text not null check (length(btrim(body)) between 1 and 280),
  category text check (category in ('Training', 'Nutrition', 'Travel', 'Health', 'Life', 'Other')),
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (note_id, version),
  check (end_date >= start_date and end_date - start_date <= 366)
);
alter table public.owner_notes enable row level security;
revoke all on public.owner_notes from public, anon, authenticated;
grant select, insert on public.owner_notes to authenticated;
create policy owner_reads_notes on public.owner_notes for select to authenticated using ((select public.is_app_owner()));
create policy owner_adds_notes on public.owner_notes for insert to authenticated with check ((select public.is_app_owner()));

create or replace function public.optional_backup_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['exercise_muscles', 'owner_notes'];
$$;
