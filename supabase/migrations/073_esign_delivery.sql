-- BBE-115: tenant-scoped e-sign requests and replay-safe signed webhook receipts.
create table public.esign_requests (
  id uuid primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  template_id text not null,
  signer_reference text not null,
  status text not null default 'queued' check (status in ('queued','delivery_started','awaiting_signature','signed','delivery_unknown','failed')),
  provider_document_id text unique,
  signed_at timestamptz,
  contract_date date,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  unique(org_id, deal_id, template_id)
);
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
