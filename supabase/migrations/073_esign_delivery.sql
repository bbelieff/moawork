-- BBE-115: tenant-scoped e-sign requests and replay-safe signed webhook receipts.
create table public.esign_requests (
  id uuid primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  template_id text not null,
  signer_reference text not null,
  status text not null default 'queued' check (status in ('queued','delivery_started','provider_accepted','awaiting_signature','signed','delivery_unknown','failed')),
  provider_document_id text unique,
  provider_signing_url text,
  signed_at timestamptz,
  contract_date date,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  unique(org_id, deal_id, template_id)
);
create index esign_request_dispatch_idx on public.esign_requests(created_at) where status in ('queued','provider_accepted');
create table public.esign_event_receipts (
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_id text not null,
  request_id uuid not null references public.esign_requests(id) on delete cascade,
  received_at timestamptz not null default now(),
  primary key(org_id,event_id)
);
alter table public.esign_requests enable row level security;
alter table public.esign_event_receipts enable row level security;
create policy esign_request_read on public.esign_requests for select to authenticated using (public.is_org_member(org_id));
create policy esign_receipt_read on public.esign_event_receipts for select to authenticated using (public.is_org_member(org_id));

create or replace function public.enqueue_esign_request(p_deal_id uuid,p_template_id text,p_signer_reference text,p_request_id uuid)
returns table(request_id uuid,status text,inserted boolean)
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_assigned uuid; v_role text; v_scope text; v_count integer;
begin
  if auth.uid() is null or nullif(trim(p_template_id),'') is null or nullif(trim(p_signer_reference),'') is null then raise exception '전자계약 요청을 확인해 주세요.' using errcode='22023'; end if;
  select d.org_id,d.assigned_to into v_org,v_assigned from public.deals d where d.id=p_deal_id;
  select m.role,m.scope into v_role,v_scope from public.org_members m join public.orgs o on o.id=m.org_id
   where m.org_id=v_org and m.user_id=auth.uid() and m.status='active' and o.status='active';
  if v_role is null or not (v_role in ('owner','admin') or v_scope='all' or v_assigned=auth.uid()) then raise exception '전자계약 요청 권한이 없어요.' using errcode='42501'; end if;
  insert into public.esign_requests(id,org_id,deal_id,template_id,signer_reference,created_by)
  values(p_request_id,v_org,p_deal_id,trim(p_template_id),trim(p_signer_reference),auth.uid())
  on conflict(org_id,deal_id,template_id) do nothing;
  get diagnostics v_count = row_count;
  select e.id,e.status,(v_count=1) into request_id,status,inserted from public.esign_requests e where e.org_id=v_org and e.deal_id=p_deal_id and e.template_id=trim(p_template_id);
  if v_count=1 then insert into public.audit_logs(org_id,actor,action,target_type,target_id,meta) values(v_org,auth.uid(),'esign.queued','deal',p_deal_id,jsonb_build_object('request_id',request_id)); end if;
  return next;
end $$;

create or replace function public.list_queued_esign_requests(p_limit integer default 100)
returns table(request_id uuid) language sql security definer set search_path='' as $$
  select e.id from public.esign_requests e where e.status in ('queued','provider_accepted') order by e.created_at limit least(greatest(p_limit,1),100)
$$;
create or replace function public.start_esign_delivery(p_request_id uuid)
returns table(request_id uuid,org_id uuid,deal_id uuid,template_id text,signer_reference text,provider_document_id text,provider_signing_url text)
language sql security definer set search_path='' as $$
  with claimed as (
    update public.esign_requests e set status='delivery_started'
    where e.id=p_request_id and e.status='queued'
    returning e.id,e.org_id,e.deal_id,e.template_id,e.signer_reference,e.provider_document_id,e.provider_signing_url
  )
  select * from claimed
  union all
  select e.id,e.org_id,e.deal_id,e.template_id,e.signer_reference,e.provider_document_id,e.provider_signing_url
  from public.esign_requests e where e.id=p_request_id and e.status='provider_accepted'
$$;
create or replace function public.mark_esign_provider_accepted(p_request_id uuid,p_provider_document_id text,p_signing_url text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if nullif(trim(p_provider_document_id),'') is null or p_signing_url !~ '^https://' then
    raise exception '전자계약 provider 응답이 올바르지 않아요.' using errcode='22023';
  end if;
  update public.esign_requests set status='provider_accepted',provider_document_id=trim(p_provider_document_id),provider_signing_url=p_signing_url
   where id=p_request_id and status='delivery_started';
  if not found and not exists (
    select 1 from public.esign_requests where id=p_request_id and status in ('provider_accepted','awaiting_signature','signed')
      and provider_document_id=trim(p_provider_document_id) and provider_signing_url=p_signing_url
  ) then raise exception '전자계약 provider 응답을 확정할 수 없어요.' using errcode='40001'; end if;
end $$;
create or replace function public.mark_esign_awaiting(p_request_id uuid,p_provider_document_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.esign_requests set status='awaiting_signature'
   where id=p_request_id and status='provider_accepted' and provider_document_id=p_provider_document_id;
  if not found then raise exception '전자계약 delivery lease가 유효하지 않아요.' using errcode='40001'; end if;
end $$;
create or replace function public.mark_esign_delivery_unknown(p_request_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.esign_requests set status='delivery_unknown' where id=p_request_id and status='delivery_started';
  if found then insert into public.audit_logs(org_id,actor,action,target_type,target_id,meta)
    select org_id,null,'esign.delivery_unknown','deal',deal_id,jsonb_build_object('request_id',id,'reason',left(p_reason,100)) from public.esign_requests where id=p_request_id; end if;
end $$;
create or replace function public.enqueue_esign_signing_link(p_request_id uuid,p_message_template_id uuid,p_channel public.message_channel,p_sender text,p_signing_url text)
returns table(outbox_id uuid,inserted boolean) language plpgsql security definer set search_path='' as $$
declare v public.esign_requests%rowtype; v_message uuid:=gen_random_uuid(); v_outbox uuid; v_count integer; v_key text;
begin
  select * into v from public.esign_requests where id=p_request_id and status='provider_accepted' and provider_signing_url=p_signing_url;
  if not found or p_signing_url !~ '^https://' then raise exception '전자계약 링크를 전달할 수 없어요.' using errcode='22023'; end if;
  insert into public.messages(id,org_id,template_id,to_addr,from_addr,body_snapshot,status,source_entity_id,channel,idempotency_key,trigger_column_key,trigger_value)
  values(v_message,v.org_id,p_message_template_id,v.signer_reference,p_sender,'전자계약 서명 링크: '||p_signing_url,'queued',v.deal_id,p_channel,
    encode(extensions.digest('esign'||v.org_id::text||v.id::text,'sha256'),'hex'),'esign_request',v.id::text)
  on conflict(org_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into v_message;
  v_key:=encode(extensions.digest('esign'||v.org_id::text||v.id::text||p_message_template_id::text||p_channel::text,'sha256'),'hex');
  insert into public.message_outbox(org_id,message_id,idempotency_key,actor_kind,actor_id)
  values(v.org_id,v_message,v_key,'automation','esign:'||v.id::text)
  on conflict(org_id,idempotency_key) do nothing returning id into v_outbox;
  get diagnostics v_count=row_count;
  if v_count=0 then select id into v_outbox from public.message_outbox where org_id=v.org_id and idempotency_key=v_key; end if;
  if v_count=1 then insert into public.message_outbox_audit(outbox_id,org_id,event,actor_kind,actor_id,attempt_count) values(v_outbox,v.org_id,'enqueued','automation','esign:'||v.id::text,0); end if;
  return query select v_outbox,(v_count=1);
end $$;

create or replace function public.apply_esign_signed_event(p_event_id text,p_provider_document_id text,p_signed_at timestamptz)
returns text language plpgsql security definer set search_path='' as $$
declare v_req public.esign_requests%rowtype; v_count integer;
begin
  if auth.role() <> 'service_role' or nullif(trim(p_event_id),'') is null or nullif(trim(p_provider_document_id),'') is null then raise exception '서명 이벤트를 처리할 수 없어요.' using errcode='42501'; end if;
  select * into v_req from public.esign_requests where provider_document_id=p_provider_document_id for update;
  if not found then return 'unknown_document'; end if;
  insert into public.esign_event_receipts(org_id,event_id,request_id) values(v_req.org_id,trim(p_event_id),v_req.id) on conflict do nothing;
  get diagnostics v_count = row_count;
  if v_count=0 then return 'duplicate'; end if;
  if v_req.status='signed' then return 'already_signed'; end if;
  update public.esign_requests set status='signed',signed_at=p_signed_at,contract_date=(p_signed_at at time zone 'Asia/Seoul')::date where id=v_req.id;
  update public.deals set custom=coalesce(custom,'{}'::jsonb)||jsonb_build_object('electronic_contract_date',(p_signed_at at time zone 'Asia/Seoul')::date::text),updated_at=now() where id=v_req.deal_id and org_id=v_req.org_id;
  insert into public.activities(org_id,deal_id,type,content,actor) values(v_req.org_id,v_req.deal_id,'status','전자계약 서명이 완료되어 계약일을 기록했습니다.',null);
  insert into public.audit_logs(org_id,actor,action,target_type,target_id,meta) values(v_req.org_id,null,'esign.signed','deal',v_req.deal_id,jsonb_build_object('request_id',v_req.id,'event_id',p_event_id));
  return 'applied';
end $$;

revoke all on public.esign_requests,public.esign_event_receipts from anon,authenticated,service_role;
grant select on public.esign_requests,public.esign_event_receipts to authenticated;
revoke all on function public.enqueue_esign_request(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.enqueue_esign_request(uuid,text,text,uuid) to authenticated;
revoke all on function public.apply_esign_signed_event(text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.apply_esign_signed_event(text,text,timestamptz) to service_role;

revoke all on function public.list_queued_esign_requests(integer),public.start_esign_delivery(uuid),public.mark_esign_provider_accepted(uuid,text,text),public.mark_esign_awaiting(uuid,text),public.mark_esign_delivery_unknown(uuid,text),public.enqueue_esign_signing_link(uuid,uuid,public.message_channel,text,text) from public,anon,authenticated,service_role;
grant execute on function public.list_queued_esign_requests(integer),public.start_esign_delivery(uuid),public.mark_esign_provider_accepted(uuid,text,text),public.mark_esign_awaiting(uuid,text),public.mark_esign_delivery_unknown(uuid,text),public.enqueue_esign_signing_link(uuid,uuid,public.message_channel,text,text) to moawork_outbox_worker;
