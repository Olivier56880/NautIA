-- PRÉVOL EN LECTURE SEULE. À lancer sur la base cible avant toute migration.
-- N'inspecte ni ne renvoie les lignes métier ou les valeurs de secrets.
-- Exemple : psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f ce_fichier.sql
begin transaction read only;

-- 1. Présence des tables métier connues et candidates au conflit.
select table_schema, table_name
from information_schema.tables
where table_schema in ('public', 'storage')
  and table_type = 'BASE TABLE'
  and (table_name in ('client', 'demande_devis', 'buckets', 'objects')
       or table_name like 'nautia_%')
order by table_schema, table_name;

-- 2. Colonnes uniquement (pas de données) : notamment types, nullabilité,
-- valeurs par défaut et identité éventuelle des tables métier existantes.
select table_schema, table_name, ordinal_position, column_name, data_type,
       udt_name, is_nullable, is_identity
from information_schema.columns
where table_schema = 'public'
  and (table_name in ('client', 'demande_devis') or table_name like 'nautia_%')
order by table_name, ordinal_position;

-- 3. PK, FK, UNIQUE, CHECK et leurs colonnes. Les règles de suppression de FK
-- sont incluses pour préparer un plan qui ne cascade pas dans client/demande.
select tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type,
       rc.update_rule, rc.delete_rule,
       string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on kcu.constraint_catalog = tc.constraint_catalog
 and kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
left join information_schema.referential_constraints rc
  on rc.constraint_catalog = tc.constraint_catalog
 and rc.constraint_schema = tc.constraint_schema
 and rc.constraint_name = tc.constraint_name
where tc.table_schema = 'public'
  and (tc.table_name in ('client', 'demande_devis') or tc.table_name like 'nautia_%')
group by tc.table_schema, tc.table_name, tc.constraint_name,
         tc.constraint_type, rc.update_rule, rc.delete_rule
order by tc.table_name, tc.constraint_type, tc.constraint_name;

-- 4. État RLS et policies sur tables concernées, sans afficher le contenu.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'storage')
  and c.relkind in ('r', 'p')
  and (c.relname in ('client', 'demande_devis', 'buckets', 'objects')
       or c.relname like 'nautia_%')
order by n.nspname, c.relname;

select schemaname, tablename, policyname, permissive, roles,
       cmd, qual as using_expression, with_check as check_expression
from pg_policies
where (schemaname = 'public'
       and (tablename in ('client', 'demande_devis') or tablename like 'nautia_%'))
   or (schemaname = 'storage' and tablename in ('buckets', 'objects'))
order by schemaname, tablename, policyname;

-- 5. Grants effectifs déclarés sur les tables existantes. À examiner notamment
-- pour anon/authenticated/service_role et tout rôle applicatif personnalisé.
select table_schema, table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema in ('public', 'storage')
  and (table_name in ('client', 'demande_devis', 'buckets', 'objects')
       or table_name like 'nautia_%')
order by table_schema, table_name, grantee, privilege_type;

-- 6. Bucket(s) et limites de stockage, sans lire les fichiers ni chemins objets.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'nautia-pdfs' or id like 'nautia-%'
order by id;

-- 7. Extensions utiles au plan de purge. Leur présence seule ne prouve pas que
-- la configuration Vault/cron/net est valide.
select extname, extversion, extnamespace::regnamespace as schema_name
from pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault');

-- 8. Estimations statistiques de volume uniquement (approximation PostgreSQL),
-- pour préparer la validation des comptes après migration sans lire les lignes.
select schemaname, relname as table_name, n_live_tup as estimated_rows,
       last_analyze, last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
  and (relname in ('client', 'demande_devis') or relname like 'nautia_%')
order by relname;

commit;
