"""Validation locale uniquement, dans un conteneur PostgreSQL jetable.
Ne connecte jamais une base Supabase existante. Requiert Docker et postgres:17.
Les schémas auth/storage ci-dessous sont des simulations, pas Supabase complet.
"""
import pathlib
import subprocess
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTAINER = 'nautia-sql-check'


def sql(statement, success=True):
    result = subprocess.run(
        ['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres',
         '-v', 'ON_ERROR_STOP=1', '-At'],
        input=statement, text=True, capture_output=True)
    if success and result.returncode:
        raise AssertionError(result.stderr)
    if not success and not result.returncode:
        raise AssertionError('Une opération interdite a réussi')
    return result.stdout.strip(), result.stderr


def ident(n):
    return str(uuid.UUID(int=n))


def as_user(n, statement, success=True):
    return sql("begin; set local role authenticated; "
               f"set local request.jwt.claim.sub = '{ident(n)}'; "
               + statement + '; rollback;', success)


def expect_count(n, table, count):
    output, _ = as_user(n, f'select count(*) from public.{table}')
    assert str(count) in output.splitlines(), output


sql('''
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean,
 file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(),
 bucket_id text references storage.buckets(id), name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated, anon;
-- Simule une ancienne policy permissive trop large : les guards doivent gagner.
create policy legacy_open_policy on storage.objects for all to authenticated, anon
 using (true) with check (true);
''')
for filename in ('01_schema.sql', '02_storage.sql', '03_retention.sql'):
    sql((ROOT / 'proposals' / filename).read_text())

sql(f"""
insert into auth.users values ('{ident(1)}'), ('{ident(2)}'), ('{ident(3)}'), ('{ident(4)}');
insert into public.nautia_chantiers(id, owner_id, name) values
 ('{ident(10)}','{ident(1)}','A'), ('{ident(20)}','{ident(2)}','B');
insert into public.nautia_members values ('{ident(10)}','{ident(3)}','reader'),
 ('{ident(10)}','{ident(4)}','editor');
insert into public.nautia_suppliers(id, chantier_id, name) values
 ('{ident(11)}','{ident(10)}','Fournisseur A'), ('{ident(21)}','{ident(20)}','Fournisseur B');
insert into public.nautia_catalog_items(id, chantier_id, supplier_id, supplier_reference,label,unit)
 values ('{ident(12)}','{ident(10)}','{ident(11)}','REF','Article','u');
insert into public.nautia_price_history(chantier_id,catalog_item_id,unit_price)
 values ('{ident(10)}','{ident(12)}',12.50);
insert into public.nautia_pdfs(id,chantier_id,filename,object_path) values
 ('{ident(13)}','{ident(10)}','devis.pdf','{ident(10)}/{ident(13)}/document.pdf');
insert into storage.objects(bucket_id,name) values
 ('nautia-pdfs','{ident(10)}/{ident(13)}/document.pdf');
""")
for user, expected in ((1, 1), (2, 1), (3, 1), (4, 1)):
    expect_count(user, 'nautia_chantiers', expected)
expect_count(2, 'nautia_price_history', 0)
expect_count(3, 'nautia_price_history', 1)
expect_count(2, 'nautia_pdfs', 0)

# A ne voit pas les fournisseurs de B, même via un filtre explicite.
out, _ = as_user(1, f"select count(*) from public.nautia_suppliers where chantier_id='{ident(20)}'")
assert '0' in out.splitlines(), out
as_user(1, f"insert into public.nautia_hourly_rates(chantier_id,label,hourly_amount) values ('{ident(20)}','Test',1)", False)
as_user(3, f"insert into public.nautia_hourly_rates(chantier_id,label,hourly_amount) values ('{ident(10)}','Test',1)", False)
as_user(4, f"insert into public.nautia_hourly_rates(chantier_id,label,hourly_amount) values ('{ident(10)}','Test',1)")
as_user(3, f"insert into public.nautia_members values ('{ident(10)}','{ident(3)}','editor')", False)
as_user(1, f"update public.nautia_chantiers set owner_id='{ident(2)}' where id='{ident(10)}'", False)
as_user(4, f"insert into public.nautia_catalog_items(chantier_id,supplier_id,supplier_reference,label,unit) values ('{ident(10)}','{ident(21)}','X','X','u')", False)
as_user(4, 'update public.nautia_price_history set unit_price=0', False)
as_user(4, 'delete from public.nautia_price_history', False)
as_user(4, 'update public.nautia_pdfs set expires_at=now()', False)
as_user(4, f"insert into public.nautia_pdfs(chantier_id,filename,object_path) values ('{ident(10)}','x.pdf','wrong/path.pdf')", False)

for user, expected in ((1, 1), (2, 0), (3, 1), (4, 1)):
    out, _ = as_user(user, 'select count(*) from storage.objects')
    assert str(expected) in out.splitlines(), out
out, _ = sql('begin; set local role anon; select count(*) from storage.objects; rollback;')
assert '0' in out.splitlines(), out
out, _ = as_user(4, "update storage.objects set name='changed' returning id")
assert 'UPDATE 0' in out, out
out, _ = as_user(4, 'delete from storage.objects returning id')
assert 'DELETE 0' in out, out
as_user(2, f"insert into storage.objects(bucket_id,name) values ('nautia-pdfs','{ident(10)}/{ident(13)}/document.pdf')", False)
as_user(3, f"insert into storage.objects(bucket_id,name) values ('nautia-pdfs','{ident(10)}/{ident(13)}/document.pdf')", False)
as_user(4, f"insert into storage.objects(bucket_id,name) values ('nautia-pdfs','{ident(10)}/{ident(13)}/document.pdf')")
as_user(1, 'select * from public.nautia_expired_pdfs()', False)
out, _ = sql('select bool_and(expires_at = ((created_at at time zone \'UTC\' + interval \'6 months\') at time zone \'UTC\')) from public.nautia_pdfs;')
assert out == 't', out
sql('update public.nautia_pdfs set expires_at=now()-interval \'1 second\';')
expect_count(1, 'nautia_pdfs', 0)
out, _ = as_user(1, 'select count(*) from storage.objects')
assert '0' in out.splitlines(), out
out, _ = sql('begin; set local role service_role; select count(*) from public.nautia_expired_pdfs(); rollback;')
assert '1' in out.splitlines(), out
print('OK : schéma, RLS, séparation des relations, rôles, Storage privé et expiration.')
