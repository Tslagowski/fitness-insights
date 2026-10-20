-- Ticket 02: private archive of raw source exports in Supabase Storage (Free plan).
-- Run in the Supabase SQL editor after 202610190001_workbook_daily_history.sql.
-- Objects are owner-only and immutable: there is no update or delete policy.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('source-archives', 'source-archives', false, 20971520,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy owner_reads_source_archives on storage.objects
for select to authenticated
using (bucket_id = 'source-archives' and (select public.is_app_owner()));

create policy owner_adds_source_archives on storage.objects
for insert to authenticated
with check (bucket_id = 'source-archives' and (select public.is_app_owner()));

commit;
