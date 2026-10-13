-- Interface SQL pour le futur worker. Ce fichier ne planifie aucun job.
begin;
create function public.nautia_expired_pdfs(p_limit integer default 100)
returns table (document_id uuid, object_path text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.id, d.object_path, d.expires_at from public.nautia_pdfs d
  where d.expires_at <= now()
  order by d.expires_at, d.id
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;
revoke all on function public.nautia_expired_pdfs(integer) from public, anon, authenticated;
grant execute on function public.nautia_expired_pdfs(integer) to service_role;
commit;
