-- À appliquer uniquement après déploiement de l'Edge Function
-- purge-nautia-pdfs et création des deux secrets Vault documentés.
begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Échoue explicitement plutôt que d'enregistrer un job incomplet ou d'envoyer le
-- secret vers une destination non prévue.
do $$
declare
  retention_url text;
  retention_secret text;
begin
  select decrypted_secret into retention_url
  from vault.decrypted_secrets where name = 'nautia_retention_url';
  select decrypted_secret into retention_secret
  from vault.decrypted_secrets where name = 'nautia_retention_secret';

  if retention_url is null or retention_url !~
    '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/purge-nautia-pdfs$' then
    raise exception 'Secret Vault nautia_retention_url absent ou invalide';
  end if;
  if retention_secret is null or length(retention_secret) < 32 then
    raise exception 'Secret Vault nautia_retention_secret absent ou trop court';
  end if;
end;
$$;

-- Le job ne reçoit jamais SUPABASE_SERVICE_ROLE_KEY. Il transmet seulement un
-- secret dédié, conservé dans Vault et également configuré dans l'Edge Function.
select cron.schedule(
  'nautia-pdf-retention-every-10-minutes',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
      where name = 'nautia_retention_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Nautia-Retention-Secret',
      (select decrypted_secret from vault.decrypted_secrets
        where name = 'nautia_retention_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $job$
);

commit;
