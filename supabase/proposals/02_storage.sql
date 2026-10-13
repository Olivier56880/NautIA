-- Après 01_schema.sql, uniquement après revue des policies Storage existantes.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nautia-pdfs', 'nautia-pdfs', false, 20971520, array['application/pdf']);

-- Les policies permissives existantes s'additionnent avec OR. Ces garde-fous
-- restrictifs imposent donc l'isolation même si une ancienne policy est large.
create policy nautia_storage_anon_guard on storage.objects as restrictive
for all to anon using (bucket_id <> 'nautia-pdfs')
with check (bucket_id <> 'nautia-pdfs');
create policy nautia_storage_read_guard on storage.objects as restrictive
for select to authenticated using (bucket_id <> 'nautia-pdfs' or exists (
  select 1 from public.nautia_pdfs d where d.object_path = name
  and d.expires_at > now() and nautia_private.can_access(d.chantier_id)
));
create policy nautia_storage_insert_guard on storage.objects as restrictive
for insert to authenticated with check (bucket_id <> 'nautia-pdfs' or exists (
  select 1 from public.nautia_pdfs d where d.object_path = name
  and d.expires_at > now() and nautia_private.can_access(d.chantier_id, true)
));
create policy nautia_storage_update_guard on storage.objects as restrictive
for update to authenticated using (bucket_id <> 'nautia-pdfs')
with check (bucket_id <> 'nautia-pdfs');
create policy nautia_storage_delete_guard on storage.objects as restrictive
for delete to authenticated using (bucket_id <> 'nautia-pdfs');

create policy nautia_storage_read on storage.objects for select to authenticated
using (bucket_id = 'nautia-pdfs' and exists (
  select 1 from public.nautia_pdfs d where d.object_path = name
  and d.expires_at > now() and nautia_private.can_access(d.chantier_id)
));
create policy nautia_storage_upload on storage.objects for insert to authenticated
with check (bucket_id = 'nautia-pdfs' and exists (
  select 1 from public.nautia_pdfs d where d.object_path = name
  and d.expires_at > now() and nautia_private.can_access(d.chantier_id, true)
));
-- Pas de policy UPDATE/DELETE : pas d'upsert, déplacement ou effacement client.
-- Le worker de rétention emploie l'API Storage avec service_role côté serveur.
commit;
