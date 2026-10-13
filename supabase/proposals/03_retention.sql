-- RPC minimales pour le worker de rétention. Aucun accès direct aux tables n'est
-- accordé à service_role. À exécuter après 01_schema.sql.
begin;

-- Réserve un lot expiré. SKIP LOCKED évite que deux workers prennent le même lot ;
-- un claim abandonné redevient disponible après quinze minutes.
create function public.nautia_claim_expired_pdfs(p_limit integer default 100)
returns table (document_id uuid, object_path text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
begin
  return query
  with candidates as (
    select d.id
    from public.nautia_pdfs d
    where d.expires_at <= clock_timestamp()
      and (d.purge_claimed_at is null
        or d.purge_claimed_at < clock_timestamp() - interval '15 minutes')
    order by d.expires_at, d.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 1000)
  ), claimed as (
    update public.nautia_pdfs d
    set purge_claimed_at = clock_timestamp()
    from candidates c
    where d.id = c.id
    returning d.id, d.object_path, d.expires_at
  )
  select c.id, c.object_path, c.expires_at from claimed c;
end;
$$;

-- À appeler uniquement après confirmation de suppression du binaire par l'API
-- Storage. Le filtre d'expiration empêche toute suppression anticipée.
create function public.nautia_finalize_pdf_deletions(p_documents jsonb)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  deleted_count integer;
begin
  if p_documents is null
    or jsonb_typeof(p_documents) <> 'array'
    or jsonb_array_length(p_documents) > 1000 then
    raise exception 'Invalid retention batch';
  end if;

  with requested as (
    select distinct x.document_id, x.object_path
    from jsonb_to_recordset(p_documents)
      as x(document_id uuid, object_path text)
  ), deleted as (
    delete from public.nautia_pdfs d
    using requested r
    where d.id = r.document_id
      and d.object_path = r.object_path
      and d.expires_at <= clock_timestamp()
      and d.purge_claimed_at is not null
      and not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'nautia-pdfs' and o.name = d.object_path
      )
    returning d.id
  )
  select count(*)::integer into deleted_count from deleted;
  return deleted_count;
end;
$$;

revoke all on function public.nautia_claim_expired_pdfs(integer)
  from public, anon, authenticated;
revoke all on function public.nautia_finalize_pdf_deletions(jsonb)
  from public, anon, authenticated;
grant execute on function public.nautia_claim_expired_pdfs(integer) to service_role;
grant execute on function public.nautia_finalize_pdf_deletions(jsonb) to service_role;
commit;
