-- Prévol destiné à l'éditeur SQL Supabase : une seule instruction SELECT,
-- un seul résultat JSON à copier. Lecture de métadonnées uniquement.
-- Aucun DDL/DML, aucune création d'objet, aucun changement de paramètre.
--
-- Le rapport ne lit aucune ligne métier ni aucun objet Storage. Les expressions
-- de policies sont incluses pour vérifier les règles : les examiner avant de
-- partager le rapport au cas où une valeur sensible y aurait été codée en dur.

select jsonb_pretty(
  jsonb_build_object(
    'notice',
    'Métadonnées seulement; les estimations de lignes sont approximatives.',

    'tables',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'schema', t.table_schema,
          'name', t.table_name,
          'kind', t.table_type
        ) order by t.table_schema, t.table_name
      )
      from information_schema.tables t
      where (t.table_schema = 'public'
             and (t.table_name in ('client', 'clients', 'demande_devis')
                  or t.table_name ilike '%client%'
                  or t.table_name ilike '%devis%'
                  or t.table_name like 'nautia_%'))
         or (t.table_schema = 'storage'
             and t.table_name in ('buckets', 'objects'))
    ), '[]'::jsonb),

    'columns',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'schema', c.table_schema,
          'table', c.table_name,
          'position', c.ordinal_position,
          'column', c.column_name,
          'type', c.data_type,
          'database_type', c.udt_name,
          'nullable', c.is_nullable,
          'identity', c.is_identity
        ) order by c.table_schema, c.table_name, c.ordinal_position
      )
      from information_schema.columns c
      where (c.table_schema = 'public'
             and (c.table_name in ('client', 'clients', 'demande_devis')
                  or c.table_name ilike '%client%'
                  or c.table_name ilike '%devis%'
                  or c.table_name like 'nautia_%'))
         or (c.table_schema = 'storage'
             and c.table_name in ('buckets', 'objects'))
    ), '[]'::jsonb),

    'constraints',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'schema', src_ns.nspname,
          'table', src.relname,
          'name', con.conname,
          'type', case con.contype
            when 'p' then 'PRIMARY KEY'
            when 'f' then 'FOREIGN KEY'
            when 'u' then 'UNIQUE'
            when 'c' then 'CHECK'
            when 'x' then 'EXCLUDE'
            else con.contype::text
          end,
          'definition', pg_get_constraintdef(con.oid, true),
          'references_schema', dst_ns.nspname,
          'references_table', dst.relname,
          'on_update', case con.confupdtype
            when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
            when 'c' then 'CASCADE' when 'n' then 'SET NULL'
            when 'd' then 'SET DEFAULT' else null end,
          'on_delete', case con.confdeltype
            when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
            when 'c' then 'CASCADE' when 'n' then 'SET NULL'
            when 'd' then 'SET DEFAULT' else null end
        ) order by src_ns.nspname, src.relname, con.conname
      )
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_namespace src_ns on src_ns.oid = src.relnamespace
      left join pg_class dst on dst.oid = con.confrelid
      left join pg_namespace dst_ns on dst_ns.oid = dst.relnamespace
      where src_ns.nspname = 'public'
        and (
          src.relname in ('client', 'clients', 'demande_devis')
          or src.relname ilike '%client%'
          or src.relname ilike '%devis%'
          or src.relname like 'nautia_%'
          or (con.contype = 'f' and dst_ns.nspname = 'public'
              and (dst.relname in ('client', 'clients', 'demande_devis')
                   or dst.relname ilike '%client%'
                   or dst.relname ilike '%devis%'
                   or dst.relname like 'nautia_%'))
        )
    ), '[]'::jsonb),

    'row_security',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'schema', n.nspname,
          'table', c.relname,
          'enabled', c.relrowsecurity,
          'forced', c.relforcerowsecurity
        ) order by n.nspname, c.relname
      )
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and (
          (n.nspname = 'public'
           and (c.relname in ('client', 'clients', 'demande_devis')
                or c.relname ilike '%client%'
                or c.relname ilike '%devis%'
                or c.relname like 'nautia_%'))
          or (n.nspname = 'storage' and c.relname in ('buckets', 'objects'))
        )
    ), '[]'::jsonb),

    'policies',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'schema', p.schemaname,
          'table', p.tablename,
          'name', p.policyname,
          'mode', p.permissive,
          'roles', p.roles,
          'command', p.cmd,
          'using', p.qual,
          'check', p.with_check
        ) order by p.schemaname, p.tablename, p.policyname
      )
      from pg_policies p
      where (p.schemaname = 'public'
             and (p.tablename in ('client', 'clients', 'demande_devis')
                  or p.tablename ilike '%client%'
                  or p.tablename ilike '%devis%'
                  or p.tablename like 'nautia_%'))
         or (p.schemaname = 'storage'
             and p.tablename in ('buckets', 'objects'))
    ), '[]'::jsonb),

    'table_grants',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'schema', g.table_schema,
          'table', g.table_name,
          'grantee', g.grantee,
          'privilege', g.privilege_type,
          'grantable', g.is_grantable
        ) order by g.table_schema, g.table_name, g.grantee, g.privilege_type
      )
      from information_schema.role_table_grants g
      where (g.table_schema = 'public'
             and (g.table_name in ('client', 'clients', 'demande_devis')
                  or g.table_name ilike '%client%'
                  or g.table_name ilike '%devis%'
                  or g.table_name like 'nautia_%'))
         or (g.table_schema = 'storage'
             and g.table_name in ('buckets', 'objects'))
    ), '[]'::jsonb),

    'storage_buckets',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'name', b.name,
          'public', b.public,
          'file_size_limit', b.file_size_limit,
          'allowed_mime_types', b.allowed_mime_types
        ) order by b.id
      )
      from storage.buckets b
      where b.id like 'nautia-%'
    ), '[]'::jsonb),

    'relevant_extensions',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', e.extname,
          'version', e.extversion,
          'schema', e.extnamespace::regnamespace::text
        ) order by e.extname
      )
      from pg_extension e
      where e.extname in ('pg_cron', 'pg_net', 'supabase_vault')
    ), '[]'::jsonb),

    'estimated_table_rows',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'schema', s.schemaname,
          'table', s.relname,
          'estimated_rows', s.n_live_tup,
          'last_analyze', s.last_analyze,
          'last_autoanalyze', s.last_autoanalyze
        ) order by s.schemaname, s.relname
      )
      from pg_stat_user_tables s
      where (s.schemaname = 'public'
             and (s.relname in ('client', 'clients', 'demande_devis')
                  or s.relname ilike '%client%'
                  or s.relname ilike '%devis%'
                  or s.relname like 'nautia_%'))
         or (s.schemaname = 'storage'
             and s.relname in ('buckets', 'objects'))
    ), '[]'::jsonb)
  )
) as preflight_report;
