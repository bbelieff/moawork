-- moa-migration-guard: logical_key=161_consultation_seal_handoff predecessor=160_new_lead_pipeline_structure digest=161de941e3634363e7d2e06503ff426b5eb1b7b77e9d06df6078ad4c48b329a0 foundation=false
select public.begin_guarded_migration(
  p_logical_key => '161_consultation_seal_handoff', p_file_name => '161_consultation_seal_handoff.sql',
  p_file_digest => '161de941e3634363e7d2e06503ff426b5eb1b7b77e9d06df6078ad4c48b329a0', p_expected_predecessor => '160_new_lead_pipeline_structure',
  p_executor => 'Codex', p_thread_id => 'v17-seal-handoff', p_foundation => false
);

-- Complete the existing 070 owner/admin seal-approver workflow. No role or
-- table privileges are added. Approval is a manual product record, not e-signing.
alter table public.consultation_requests drop constraint consultation_requests_action_check;
alter table public.consultation_requests add constraint consultation_requests_action_check
 check(action in ('check','mode','workflow','seal_approval','handoff'));
alter table public.consultation_events drop constraint consultation_events_step_check;
alter table public.consultation_events add constraint consultation_events_step_check
 check(step in ('contract_sent','signed_copy_sent','counterparty_signature_confirmed','deposit_confirmed','mode','meeting','phase','seal'));
alter table public.consultation_events drop constraint consultation_events_kind_check;
alter table public.consultation_events add constraint consultation_events_kind_check
 check(kind in ('confirmed','unconfirmed','invalidated','mode_changed','rescheduled','phase_changed','appointment_cancelled','seal_approved'));

create function public.read_consultation_handoff_controls(p_org_id uuid,p_item_id uuid)
returns table(can_approve_seal boolean,seal_approved boolean,ready boolean,version bigint,missing jsonb)
language plpgsql security definer set search_path='' as $$
declare v_snap record; v_seal boolean; v_edit boolean; v_role text; v_scope text; v_handoff boolean;
begin
 -- Active tenant/member/view-tabs and current row scope precede every read.
 select * into v_snap from public.read_consultation_snapshot(p_org_id,p_item_id);
 if not exists(select 1 from public.items i where i.org_id=p_org_id and i.id=p_item_id
    and i.deleted_at is null and i.archived_at is null) then
   raise exception 'consultation item unavailable' using errcode='22023'; end if;
 select m.role::text,m.scope::text into v_role,v_scope from public.org_members m
  where m.org_id=p_org_id and m.user_id=auth.uid() and m.status='active';
 v_edit:=public.effective_permission(p_org_id,'work.item_upsert');
 select coalesce(d.custom->>'seal_approval',d.custom->>'seal_status','대기')='완료'
   and exists(select 1 from public.item_values iv where iv.org_id=p_org_id and iv.item_id=p_item_id
     and iv.column_key='seal_status' and iv.value_jsonb='"완료"'::jsonb)
 into v_seal from public.deals d where d.org_id=p_org_id and d.id=v_snap.deal_id;
 -- Match BOTH actual write gates: 151 item assignee and 069 deal assignee.
 -- Department visibility allows reading/progress, never handoff of another owner.
 select coalesce(v_role in ('owner','admin') or v_scope='all'
   or (i.assigned_to=auth.uid() and d.assigned_to=auth.uid()),false)
 into v_handoff from public.items i join public.deals d on d.id=i.deal_id and d.org_id=i.org_id
 where i.org_id=p_org_id and i.id=p_item_id;
 return query select
   v_edit and v_role in ('owner','admin') and v_snap.board_source='core.default-tab/contact' and v_snap.deal_stage_kind='meeting',
   coalesce(v_seal,false),
   v_edit and coalesce(v_handoff,false) and coalesce(v_seal,false) and public.consultation_checklist_complete(v_snap.checklist)
     and v_snap.board_source='core.default-tab/contact' and v_snap.deal_stage_kind='meeting',
   v_snap.version, v_snap.missing || case when not coalesce(v_handoff,false) then '["인계 담당자 권한"]'::jsonb else '[]'::jsonb end;
end $$;
revoke all on function public.read_consultation_handoff_controls(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_consultation_handoff_controls(uuid,uuid) to authenticated;

create function public.execute_consultation_seal_handoff(
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
 -- Reuse precisely the approver role set from request_deal_seal_approval (070).
 if p_operation='seal_approval' and v_role not in ('owner','admin') then
   raise exception 'seal approval permission denied' using errcode='42501'; end if;
 v_payload:=jsonb_build_object('itemId',p_item_id,'operation',p_operation,'expectedVersion',p_expected_version,'companyName',p_company_name);
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
 select i.* into v_item from public.items i where i.org_id=p_org_id and i.id=p_item_id
   and i.deleted_at is null and i.archived_at is null for update;
 if not found then raise exception 'consultation item unavailable' using errcode='22023'; end if;
 -- Checks current row scope before receipt access, including after a handoff.
 select * into v_snap from public.read_consultation_snapshot(p_org_id,p_item_id);
 select d.* into v_deal from public.deals d where d.org_id=p_org_id and d.id=v_item.deal_id for update;
 if not found or not exists(select 1 from public.pipelines p join public.stages st on st.pipeline_id=p.id
   where p.id=v_deal.pipeline_id and p.org_id=p_org_id and st.id=v_deal.stage_id) then
   raise exception 'consultation canonical association required' using errcode='22023'; end if;
 -- The real 151/069 write scope also applies to committed request replay.
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
 if not public.consultation_checklist_complete(v_state.checklist) then
   raise exception 'consultation checklist blocked' using errcode='22023'; end if;
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
   -- The click records intent in the SAME transaction as the established
   -- 154 -> 151 -> 087 -> 069 -> 065 pipeline. Never manufacture either approval.
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
