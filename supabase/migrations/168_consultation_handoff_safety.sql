-- moa-migration-guard: logical_key=168_consultation_handoff_safety predecessor=167_consultation_two_stage_contract digest=0e0f875169967979a64fc76a1ef4860216e9b0f17dc7fe01f2c8e7cb394fad03 foundation=false
select public.begin_guarded_migration(
  p_logical_key => '168_consultation_handoff_safety',
  p_file_name => '168_consultation_handoff_safety.sql',
  p_file_digest => '0e0f875169967979a64fc76a1ef4860216e9b0f17dc7fe01f2c8e7cb394fad03',
  p_expected_predecessor => '167_consultation_two_stage_contract',
  p_executor => 'Codex',
  p_thread_id => '019f7fe5-46ea-7c00-b298-6dc690516250',
  p_foundation => false
);

-- #833 상담 인계 안전 보강
-- 계약금 칸의 존재/활성 상태를 판정하고, 실제 인계 변이에서는 칸과 값을 잠근다.

create or replace function public.consultation_contract_fee_ready(p_org_id uuid, p_item_id uuid)
returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
      from public.items i
      join public.board_columns c
        on c.org_id = i.org_id
       and c.board_id = i.board_id
       and c.key = 'contract_fee_status'
       and c.archived_at is null
      join public.item_values iv
        on iv.org_id = i.org_id
       and iv.item_id = i.id
       and iv.column_key = c.key
     where i.org_id = p_org_id
       and i.id = p_item_id
       and i.deleted_at is null
       and i.archived_at is null
       and iv.value_jsonb #>> '{}' = '계약금 완'
  );
$$;

create or replace function public.consultation_contract_missing(p_org_id uuid, p_item_id uuid)
returns text[]
language plpgsql stable set search_path = '' as $$
declare
  v_archived_at timestamptz;
begin
  select c.archived_at
    into v_archived_at
    from public.items i
    join public.board_columns c
      on c.org_id = i.org_id
     and c.board_id = i.board_id
     and c.key = 'contract_fee_status'
   where i.org_id = p_org_id
     and i.id = p_item_id
     and i.deleted_at is null
     and i.archived_at is null;

  if not found then
    return array['계약금 완료여부 칸 없음 — 보드 칸 관리에서 추가'];
  end if;
  if v_archived_at is not null then
    return array['계약금 완료여부 칸 보관됨 — 보드 칸 관리에서 복원'];
  end if;
  if not public.consultation_contract_fee_ready(p_org_id, p_item_id) then
    return array['계약금 입금 확인'];
  end if;
  return '{}'::text[];
end;
$$;

-- 내부 변이 전용. 호출자는 item -> deal -> consultation_state 잠금을 먼저 잡는다.
-- 여기서는 active column -> existing value 순서로 잠가 계약금 되돌리기와 인계를 직렬화한다.
create or replace function public.consultation_contract_fee_ready_locked(p_org_id uuid, p_item_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_column_id uuid;
  v_value text;
begin
  select c.id
    into v_column_id
    from public.items i
    join public.board_columns c
      on c.org_id = i.org_id
     and c.board_id = i.board_id
     and c.key = 'contract_fee_status'
     and c.archived_at is null
   where i.org_id = p_org_id
     and i.id = p_item_id
     and i.deleted_at is null
     and i.archived_at is null
   for update of c;
  if not found then
    return false;
  end if;

  select iv.value_jsonb #>> '{}'
    into v_value
    from public.item_values iv
   where iv.org_id = p_org_id
     and iv.item_id = p_item_id
     and iv.column_key = 'contract_fee_status'
   for update of iv;
  if not found then
    return false;
  end if;
  return v_value = '계약금 완';
end;
$$;

revoke all on function public.consultation_contract_fee_ready(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.consultation_contract_missing(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.consultation_contract_fee_ready_locked(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.consultation_handoff_block_reason(
  p_org_id uuid,
  p_item_id uuid,
  p_deal_id uuid
)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_state public.consultation_states%rowtype;
  v_missing text[];
  v_deal_seal text;
  v_board_seal text;
  v_move text;
  v_stage_kind text;
begin
  if v_actor is null then
    raise exception 'consultation authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.org_members m
    join public.orgs o on o.id = m.org_id
    where m.org_id = p_org_id and m.user_id = v_actor
      and m.status = 'active' and o.status = 'active'
  ) then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  if not public.effective_permission(p_org_id, 'work.view_tabs')
     or not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;

  select s.* into v_state from public.consultation_states s
   where s.org_id = p_org_id and s.item_id = p_item_id;
  if found then
    if v_state.deal_id is distinct from p_deal_id then
      return '상담 기록과 계약이 일치하지 않습니다.';
    end if;
    if v_state.mode not in ('remote', 'inperson') then
      return '상담 단계';
    end if;
  end if;

  if not public.consultation_contract_fee_ready_locked(p_org_id, p_item_id) then
    v_missing := public.consultation_contract_missing(p_org_id, p_item_id);
    return '인계 조건이 남았습니다: ' || array_to_string(v_missing, ' · ');
  end if;

  select coalesce(d.custom ->> 'seal_approval', d.custom ->> 'seal_status', '대기'),
         s.kind::text
    into v_deal_seal, v_stage_kind
    from public.deals d
    left join public.stages s on s.id = d.stage_id
   where d.id = p_deal_id and d.org_id = p_org_id;
  select iv.value_jsonb #>> '{}' into v_move from public.item_values iv
   where iv.org_id = p_org_id and iv.item_id = p_item_id and iv.column_key = 'work_move';
  select iv.value_jsonb #>> '{}' into v_board_seal from public.item_values iv
   where iv.org_id = p_org_id and iv.item_id = p_item_id and iv.column_key = 'seal_status';
  if coalesce(v_move, '') <> '업무관리 이동' then
    return '업무관리 이동을 먼저 선택해 주세요.';
  end if;
  if coalesce(v_board_seal, '대기') <> '완료' then
    return '대표 직인 승인이 필요합니다. 현재 직인(보드) = ' || coalesce(v_board_seal, '대기');
  end if;
  if v_deal_seal <> '완료' then
    return '대표 직인 승인이 필요합니다(계약 기준). 현재 = ' || coalesce(v_deal_seal, '대기');
  end if;
  if v_stage_kind is distinct from 'meeting' then
    return '상담 단계에서는 인계할 수 없습니다.';
  end if;
  return null;
end;
$$;

revoke all on function public.consultation_handoff_block_reason(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.execute_consultation_seal_handoff(
 p_org_id uuid,p_item_id uuid,p_request_id uuid,p_expected_version bigint,p_operation text,p_company_name text default null
) returns table(item_id uuid,deal_id uuid,company_id uuid,mode text,version bigint,replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid(); v_role text; v_scope text; v_item public.items%rowtype;
 v_deal public.deals%rowtype; v_state public.consultation_states%rowtype;
 v_prior public.consultation_requests%rowtype; v_snap record; v_out record;
 v_payload jsonb; v_version bigint; v_now timestamptz:=clock_timestamp(); v_before jsonb;
begin
 if v_actor is null then raise exception 'consultation authentication required' using errcode='42501'; end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0
   or p_operation is null or p_operation not in ('seal_approval','handoff') then
   raise exception 'consultation input required' using errcode='22023'; end if;
 select m.role::text,m.scope::text into v_role,v_scope from public.org_members m join public.orgs o on o.id=m.org_id
  where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
 if not found or not public.effective_permission(p_org_id,'work.view_tabs')
   or not public.effective_permission(p_org_id,'work.item_upsert') then
   raise exception 'consultation permission denied' using errcode='42501'; end if;
 if p_operation='seal_approval' and v_role not in ('owner','admin') then
   raise exception 'seal approval permission denied' using errcode='42501'; end if;
 v_payload:=jsonb_build_object('itemId',p_item_id,'operation',p_operation,'expectedVersion',p_expected_version,'companyName',p_company_name);
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
 select i.* into v_item from public.items i where i.org_id=p_org_id and i.id=p_item_id
   and i.deleted_at is null and i.archived_at is null for update;
 if not found then raise exception 'consultation item unavailable' using errcode='22023'; end if;
 select * into v_snap from public.read_consultation_snapshot(p_org_id,p_item_id);
 select d.* into v_deal from public.deals d where d.org_id=p_org_id and d.id=v_item.deal_id for update;
 if not found or not exists(select 1 from public.pipelines p join public.stages st on st.pipeline_id=p.id
   where p.id=v_deal.pipeline_id and p.org_id=p_org_id and st.id=v_deal.stage_id) then
   raise exception 'consultation canonical association required' using errcode='22023'; end if;
 if p_operation='handoff' and not coalesce(v_role in ('owner','admin') or v_scope='all'
   or (v_item.assigned_to=v_actor and v_deal.assigned_to=v_actor),false) then
   raise exception 'consultation permission denied' using errcode='42501'; end if;
 select s.* into v_state from public.consultation_states s where s.org_id=p_org_id and s.item_id=p_item_id for update;
 if not found or v_state.deal_id is distinct from v_deal.id then
   raise exception 'consultation canonical association required' using errcode='22023'; end if;
 select r.* into v_prior from public.consultation_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
 if found then
   if v_prior.actor_id is distinct from v_actor or v_prior.item_id is distinct from p_item_id
      or v_prior.deal_id is distinct from v_deal.id or v_prior.action is distinct from p_operation
      or v_prior.payload is distinct from v_payload then
     raise exception 'consultation idempotency key reuse' using errcode='22023'; end if;
   return query select p_item_id,v_deal.id,(v_prior.result->>'companyId')::uuid,
     v_prior.result->>'mode',(v_prior.result->>'version')::bigint,true;
   return;
 end if;
 select * into v_snap from public.read_consultation_snapshot(p_org_id,p_item_id);
 if v_snap.board_source is distinct from 'core.default-tab/contact' or v_snap.deal_stage_kind is distinct from 'meeting' then
   raise exception 'consultation stage unavailable' using errcode='22023'; end if;
 if v_state.version<>p_expected_version then raise exception 'consultation version conflict' using errcode='40001'; end if;
 if not public.consultation_contract_fee_ready_locked(p_org_id,p_item_id) then
   raise exception 'consultation contract fee required' using errcode='22023'; end if;
 v_version:=v_state.version;
 if p_operation='seal_approval' then
   v_before:=jsonb_build_object('deal',coalesce(v_deal.custom->>'seal_approval',v_deal.custom->>'seal_status'),
     'board',(select iv.value_jsonb from public.item_values iv where iv.org_id=p_org_id and iv.item_id=p_item_id and iv.column_key='seal_status'));
   update public.deals set custom=coalesce(custom,'{}'::jsonb)||jsonb_build_object('seal_approval','완료'),updated_at=v_now
    where id=v_deal.id and org_id=p_org_id;
   insert into public.item_values(org_id,item_id,column_key,value_jsonb) values(p_org_id,p_item_id,'seal_status','"완료"')
    on conflict on constraint item_values_pkey do update set value_jsonb=excluded.value_jsonb;
   v_version:=v_version+1;
   update public.consultation_states cs set version=v_version,updated_at=v_now,updated_by=v_actor
    where cs.org_id=p_org_id and cs.item_id=p_item_id;
   insert into public.consultation_events(org_id,item_id,deal_id,step,kind,before,after,actor_id,at,request_id,details)
    values(p_org_id,p_item_id,v_deal.id,'seal','seal_approved',false,true,v_actor,v_now,p_request_id,
      jsonb_build_object('before',v_before,'after',jsonb_build_object('deal','완료','board','완료')));
 else
   if coalesce(v_deal.custom->>'seal_approval',v_deal.custom->>'seal_status','대기')<>'완료'
      or not exists(select 1 from public.item_values iv where iv.org_id=p_org_id and iv.item_id=p_item_id
       and iv.column_key='seal_status' and iv.value_jsonb='"완료"'::jsonb) then
     raise exception '대표 직인 승인이 필요합니다.' using errcode='22023'; end if;
   insert into public.item_values(org_id,item_id,column_key,value_jsonb) values(p_org_id,p_item_id,'work_move','"업무관리 이동"')
    on conflict on constraint item_values_pkey do update set value_jsonb=excluded.value_jsonb;
   select * into v_out from public.execute_contact_pipeline_transition(
     p_org_id,v_deal.id,p_item_id,p_request_id,'contact_to_work',v_deal.company_id,coalesce(nullif(trim(p_company_name),''),v_item.title));
   if v_out.status is distinct from 'committed' or v_out.deal_id is distinct from v_deal.id then
     raise exception '%',coalesce(v_out.reason,'상담 인계를 완료하지 못했습니다.') using errcode='22023'; end if;
   v_deal.company_id:=v_out.company_id;
 end if;
 insert into public.consultation_requests(org_id,request_id,item_id,deal_id,action,payload,result,actor_id)
  values(p_org_id,p_request_id,p_item_id,v_deal.id,p_operation,v_payload,
    jsonb_build_object('version',v_version,'mode',v_state.mode,'companyId',v_deal.company_id),v_actor);
 return query select p_item_id,v_deal.id,v_deal.company_id,v_state.mode,v_version,false;
end $$;

revoke all on function public.execute_consultation_seal_handoff(uuid,uuid,uuid,bigint,text,text) from public,anon,service_role;
grant execute on function public.execute_consultation_seal_handoff(uuid,uuid,uuid,bigint,text,text) to authenticated;
