begin;
do $$
declare
 c uuid;
 waiting uuid;
 due uuid;
 blocked uuid;
 q uuid;
 start1 timestamptz;
 end1 timestamptz;
 result jsonb;
begin
 select id into c from public.kervenoa_chat_clients order by id limit 1;
 if c is null then raise exception 'Fixture workshop missing'; end if;
 insert into public.kervenoa_quote_requests(client_id,customer_name,request_text)
 values(c,'Synthetic retention test','No real customer') returning id into waiting;
 if exists(select 1 from public.kervenoa_quote_requests where id=waiting and purge_after is not null) then
   raise exception 'Timer started on receipt'; end if;
 select preparation_started_at,purge_after into start1,end1 from public.kervenoa_start_preparation(waiting,c);
 if end1-start1 <> interval '720 hours' then raise exception 'Wrong deadline'; end if;
 perform public.kervenoa_start_preparation(waiting,c);
 update public.kervenoa_quote_requests set status='a_valider',preparation_started_at=now()+interval '1 day' where id=waiting;
 if not exists(select 1 from public.kervenoa_quote_requests where id=waiting and preparation_started_at=start1 and purge_after=end1) then
   raise exception 'Deadline moved on retry'; end if;
 begin
   perform public.kervenoa_start_preparation(waiting,gen_random_uuid());
   raise exception 'Wrong workshop accepted';
 exception when no_data_found then null; end;
 insert into public.kervenoa_quote_requests(client_id,customer_name,request_text,status,preparation_started_at)
 values(c,'Synthetic expired','No real customer','en_preparation',now()-interval '31 days') returning id into due;
 insert into public.kervenoa_quotes(request_id,filename) values(due,'synthetic.pdf') returning id into q;
 insert into public.kervenoa_quote_events(quote_id,event_type,event_details) values(q,'synthetic','{"synthetic":true}');
 insert into public.kervenoa_email_deliveries(request_id,quote_id,recipient_type,recipient_email,message_type)
 values(due,q,'kervenoa','test@example.invalid','devis');
 insert into public.kervenoa_quote_requests(client_id,customer_name,request_text,status,preparation_started_at)
 values(c,'Synthetic storage guard','No real customer','en_preparation',now()-interval '31 days') returning id into blocked;
 insert into public.kervenoa_quotes(request_id,storage_path) values(blocked,'synthetic-does-not-exist.pdf');
 result := kervenoa_private.purge_expired_requests();
 if exists(select 1 from public.kervenoa_quote_requests where id=due) or exists(select 1 from public.kervenoa_quotes where id=q)
 or exists(select 1 from public.kervenoa_email_deliveries where request_id=due)
 or exists(select 1 from public.kervenoa_quote_events where quote_id=q) then raise exception 'Incomplete relational purge'; end if;
 if not exists(select 1 from public.kervenoa_quote_requests where id=waiting) then raise exception 'Unexpired request deleted'; end if;
 if not exists(select 1 from public.kervenoa_quote_requests where id=blocked) then raise exception 'Storage references discarded'; end if;
 if (result->>'failed')::integer < 1 then raise exception 'Storage failure not recorded'; end if;
 if has_function_privilege('anon','public.kervenoa_start_preparation(uuid,uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.kervenoa_start_preparation(uuid,uuid)','EXECUTE')
 or has_function_privilege('service_role','kervenoa_private.purge_expired_requests()','EXECUTE') then raise exception 'Excessive privileges'; end if;
 raise notice 'PASS: exact deadline, immutable clock, workshop isolation, child-row purge, unexpired preservation, storage failure handling and access control';
end;
$$;
rollback;
