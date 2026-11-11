-- Kervenoa: working request data only. No workshop, branding or tariff deletion.
create schema if not exists kervenoa_private;
revoke all on schema kervenoa_private from public, anon, authenticated;

alter table public.kervenoa_quote_requests
  add column preparation_started_at timestamptz,
  add column purge_after timestamptz,
  add constraint kervenoa_retention_deadline check (
    (preparation_started_at is null and purge_after is null) or
    (preparation_started_at is not null and purge_after = preparation_started_at + interval '720 hours')
  );
create index kervenoa_requests_purge_due_idx on public.kervenoa_quote_requests(purge_after)
  where purge_after is not null;

create function kervenoa_private.set_request_retention()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and OLD.preparation_started_at is not null then
    NEW.preparation_started_at := OLD.preparation_started_at;
  elsif NEW.status <> 'demande_recue' and NEW.preparation_started_at is null then
    NEW.preparation_started_at := statement_timestamp();
  end if;
  NEW.purge_after := NEW.preparation_started_at + interval '720 hours';
  return NEW;
end;
$$;
revoke all on function kervenoa_private.set_request_retention() from public, anon, authenticated;
create trigger kervenoa_request_retention before insert or update on public.kervenoa_quote_requests
  for each row execute function kervenoa_private.set_request_retention();

-- The UUID and workshop UUID must both match. Repeated calls never restart the clock.
create function public.kervenoa_start_preparation(p_request_id uuid, p_client_id uuid)
returns table(request_id uuid, preparation_started_at timestamptz, purge_after timestamptz)
language plpgsql security invoker set search_path = '' as $$
begin
  return query update public.kervenoa_quote_requests r
    set status = case when r.status = 'demande_recue' then 'en_preparation' else r.status end,
        preparation_started_at = coalesce(r.preparation_started_at, statement_timestamp()),
        updated_at = statement_timestamp()
    where r.id = p_request_id and r.client_id = p_client_id
      and (r.purge_after is null or r.purge_after > statement_timestamp())
    returning r.id, r.preparation_started_at, r.purge_after;
  if not found then raise exception 'Request unavailable or expired' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.kervenoa_start_preparation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kervenoa_start_preparation(uuid, uuid) to service_role;

create table kervenoa_private.retention_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  deleted_count integer not null,
  failed_count integer not null
);
alter table kervenoa_private.retention_runs enable row level security;
revoke all on kervenoa_private.retention_runs from public, anon, authenticated;

-- Cron executes as postgres; no SECURITY DEFINER or public deletion endpoint.
-- Refuse to discard storage references: a storage worker must erase those objects first.
create function kervenoa_private.purge_expired_requests()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r record;
  removed integer := 0;
  failures integer := 0;
begin
  for r in select id from public.kervenoa_quote_requests
    where purge_after <= statement_timestamp()
    order by purge_after limit 100 for update skip locked
  loop
    begin
      if exists(select 1 from public.kervenoa_quotes q
                where q.request_id = r.id and q.storage_path is not null) then
        raise exception 'Storage cleanup required' using errcode = 'P0001';
      end if;
      delete from public.kervenoa_email_deliveries e where e.request_id = r.id
        or e.quote_id in (select id from public.kervenoa_quotes where request_id = r.id);
      delete from public.kervenoa_quote_events e where e.quote_id in
        (select id from public.kervenoa_quotes where request_id = r.id);
      delete from public.kervenoa_quotes where request_id = r.id;
      delete from public.kervenoa_quote_requests where id = r.id;
      removed := removed + 1;
    exception when others then
      failures := failures + 1;
      raise warning 'Kervenoa retention failed, SQLSTATE %', SQLSTATE;
    end;
  end loop;
  insert into kervenoa_private.retention_runs(deleted_count, failed_count) values (removed, failures);
  delete from kervenoa_private.retention_runs where ran_at < now() - interval '90 days';
  return jsonb_build_object('deleted', removed, 'failed', failures);
end;
$$;
revoke all on function kervenoa_private.purge_expired_requests() from public, anon, authenticated, service_role;

-- Explicit backend-only rights; RLS remains enabled without public policies.
grant usage on schema kervenoa_private to service_role;
grant execute on function kervenoa_private.set_request_retention() to service_role;
grant select, insert, update, delete on public.kervenoa_quote_requests, public.kervenoa_email_deliveries to service_role;

create extension if not exists pg_cron;
select cron.schedule('kervenoa-request-retention', '* * * * *',
  'select kervenoa_private.purge_expired_requests();');
select cron.schedule('kervenoa-retention-job-history', '17 2 * * *',
  $$delete from cron.job_run_details where jobid in
    (select jobid from cron.job where jobname in ('kervenoa-request-retention','kervenoa-retention-job-history'))
    and end_time < now() - interval '7 days';$$);
