-- PROPOSITION : ne pas appliquer avant comparaison avec la base existante.
-- Exécuter dans une base Supabase, avec le rôle administrateur, après revue.
begin;

create schema nautia_private;
revoke all on schema nautia_private from public;

create table public.nautia_chantiers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null check (length(trim(name)) > 0),
  description text,
  created_at timestamptz not null default now()
);

create table public.nautia_members (
  chantier_id uuid not null references public.nautia_chantiers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('reader', 'editor')),
  primary key (chantier_id, user_id)
);
create index nautia_members_user_idx on public.nautia_members(user_id);

-- SECURITY DEFINER évite la récursion RLS. Aucun SQL dynamique ; uid issu du JWT.
create function nautia_private.can_access(p_chantier uuid, p_write boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.nautia_chantiers c where c.id = p_chantier
    and (c.owner_id = auth.uid() or exists (
      select 1 from public.nautia_members m
      where m.chantier_id = c.id and m.user_id = auth.uid()
      and (not p_write or m.role = 'editor')
    ))
  );
$$;
create function nautia_private.is_owner(p_chantier uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.nautia_chantiers c
    where c.id = p_chantier and c.owner_id = auth.uid());
$$;
revoke all on function nautia_private.can_access(uuid, boolean) from public;
revoke all on function nautia_private.is_owner(uuid) from public;
grant usage on schema nautia_private to authenticated;
grant execute on function nautia_private.can_access(uuid, boolean),
  nautia_private.is_owner(uuid) to authenticated;

create table public.nautia_hourly_rates (
  id uuid primary key default gen_random_uuid(),
  chantier_id uuid not null references public.nautia_chantiers(id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  hourly_amount numeric(14,4) not null check (hourly_amount >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  valid_from date not null default current_date,
  valid_until date check (valid_until >= valid_from),
  created_at timestamptz not null default now()
);

-- Un fournisseur et son catalogue sont propres au chantier, même s'ils portent
-- le même nom dans un autre chantier. Aucun catalogue global partagé.
create table public.nautia_suppliers (
  id uuid primary key default gen_random_uuid(),
  chantier_id uuid not null references public.nautia_chantiers(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  unique (chantier_id, id)
);
create table public.nautia_catalog_items (
  id uuid primary key default gen_random_uuid(),
  chantier_id uuid not null references public.nautia_chantiers(id) on delete cascade,
  supplier_id uuid not null,
  supplier_reference text not null check (length(trim(supplier_reference)) > 0),
  label text not null check (length(trim(label)) > 0),
  unit text not null check (length(trim(unit)) > 0),
  foreign key (chantier_id, supplier_id)
    references public.nautia_suppliers(chantier_id, id),
  unique (chantier_id, supplier_id, supplier_reference),
  unique (chantier_id, id)
);
create table public.nautia_price_history (
  id uuid primary key default gen_random_uuid(),
  chantier_id uuid not null references public.nautia_chantiers(id) on delete cascade,
  catalog_item_id uuid not null,
  unit_price numeric(14,4) not null check (unit_price >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  effective_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  foreign key (chantier_id, catalog_item_id)
    references public.nautia_catalog_items(chantier_id, id)
);
create index nautia_prices_lookup_idx on public.nautia_price_history
  (chantier_id, catalog_item_id, effective_at desc, recorded_at desc, id desc);

create table public.nautia_pdfs (
  id uuid primary key default gen_random_uuid(),
  chantier_id uuid not null references public.nautia_chantiers(id),
  supplier_id uuid not null,
  filename text not null check (length(trim(filename)) > 0),
  object_path text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  purge_claimed_at timestamptz,
  foreign key (chantier_id, supplier_id)
    references public.nautia_suppliers(chantier_id, id),
  check (object_path = chantier_id::text || '/' || id::text || '/document.pdf')
);
-- Horloge du serveur, sans prolongation possible depuis le client.
create function nautia_private.stamp_pdf()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_at := clock_timestamp();
  new.expires_at := (new.created_at at time zone 'UTC' + interval '6 months') at time zone 'UTC';
  return new;
end;
$$;
revoke all on function nautia_private.stamp_pdf() from public;
create trigger nautia_stamp_pdf before insert on public.nautia_pdfs
  for each row execute function nautia_private.stamp_pdf();
create index nautia_pdf_expiry_idx on public.nautia_pdfs(expires_at);

-- Index des clés de partition pour les contrôles d'accès et les suppressions.
create index nautia_rates_chantier_idx on public.nautia_hourly_rates(chantier_id);
create index nautia_pdf_chantier_idx on public.nautia_pdfs(chantier_id);
create index nautia_chantiers_owner_idx on public.nautia_chantiers(owner_id);

alter table public.nautia_chantiers enable row level security;
alter table public.nautia_members enable row level security;
alter table public.nautia_hourly_rates enable row level security;
alter table public.nautia_suppliers enable row level security;
alter table public.nautia_catalog_items enable row level security;
alter table public.nautia_price_history enable row level security;
alter table public.nautia_pdfs enable row level security;

revoke all on public.nautia_chantiers, public.nautia_members,
  public.nautia_hourly_rates, public.nautia_suppliers, public.nautia_catalog_items,
  public.nautia_price_history, public.nautia_pdfs
  from public, anon, authenticated, service_role;
grant select on public.nautia_chantiers, public.nautia_members,
  public.nautia_hourly_rates, public.nautia_suppliers, public.nautia_catalog_items,
  public.nautia_price_history, public.nautia_pdfs to authenticated;
grant insert (id, owner_id, name, description) on public.nautia_chantiers to authenticated;
grant update (name, description) on public.nautia_chantiers to authenticated;
grant delete on public.nautia_chantiers to authenticated;
grant insert, update, delete on public.nautia_members to authenticated;
grant insert, delete on public.nautia_hourly_rates, public.nautia_suppliers,
  public.nautia_catalog_items to authenticated;
grant update (label, hourly_amount, currency, valid_from, valid_until)
  on public.nautia_hourly_rates to authenticated;
grant update (name) on public.nautia_suppliers to authenticated;
grant update (supplier_id, supplier_reference, label, unit)
  on public.nautia_catalog_items to authenticated;
-- Historique append-only : aucune modification/suppression accordée au client.
grant insert (id, chantier_id, catalog_item_id, unit_price, currency, effective_at)
  on public.nautia_price_history to authenticated;
-- Métadonnées PDF immuables ; suppression réservée au worker côté serveur.
grant insert (id, chantier_id, supplier_id, filename, object_path)
  on public.nautia_pdfs to authenticated;
-- service_role n'a aucun accès direct aux tables NautIA. Les traitements serveur
-- passent uniquement par les RPC SECURITY DEFINER définies dans 03_retention.sql.

create policy nautia_chantiers_read on public.nautia_chantiers for select to authenticated
  using (nautia_private.can_access(id));
create policy nautia_chantiers_create on public.nautia_chantiers for insert to authenticated
  with check (owner_id = auth.uid());
create policy nautia_chantiers_edit on public.nautia_chantiers for update to authenticated
  using (nautia_private.is_owner(id)) with check (nautia_private.is_owner(id));
create policy nautia_chantiers_delete on public.nautia_chantiers for delete to authenticated
  using (nautia_private.is_owner(id));
create policy nautia_members_read on public.nautia_members for select to authenticated
  using (nautia_private.can_access(chantier_id));
create policy nautia_members_manage on public.nautia_members for all to authenticated
  using (nautia_private.is_owner(chantier_id))
  with check (nautia_private.is_owner(chantier_id));

do $$
declare t text;
begin
  foreach t in array array['nautia_hourly_rates','nautia_suppliers','nautia_catalog_items'] loop
    execute format('create policy %I on public.%I for select to authenticated using (nautia_private.can_access(chantier_id))', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (nautia_private.can_access(chantier_id, true)) with check (nautia_private.can_access(chantier_id, true))', t || '_write', t);
  end loop;
end;
$$;
create policy nautia_prices_read on public.nautia_price_history for select to authenticated
  using (nautia_private.can_access(chantier_id));
create policy nautia_prices_append on public.nautia_price_history for insert to authenticated
  with check (nautia_private.can_access(chantier_id, true));
create policy nautia_pdfs_read on public.nautia_pdfs for select to authenticated
  using (nautia_private.can_access(chantier_id) and expires_at > now());
create policy nautia_pdfs_create on public.nautia_pdfs for insert to authenticated
  with check (nautia_private.can_access(chantier_id, true));

commit;
