-- moa-migration-guard: logical_key=177_consultation_stage_redefine predecessor=176_default_tab_rev_qa884_apply digest=c93ad1fd21fd61c5a5942637eb4e3080fe18687ac348f5625c3da8927db86733 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '177_consultation_stage_redefine',
  p_file_name => '177_consultation_stage_redefine.sql',
  p_file_digest => 'c93ad1fd21fd61c5a5942637eb4e3080fe18687ac348f5625c3da8927db86733',
  p_expected_predecessor => '176_default_tab_rev_qa884_apply',
  p_executor => 'DC',
  p_thread_id => '9ffa2331-f8b8-46fc-9b09-6375b2e85f6c',
  p_foundation => false
);

-- Issue: belie 2026-10-19 상담 단계 재정의.
--
--   비대면: 정보수집 → 상담예정 → 상담중 · 부재 · 재상담 · 계약고민 → 계약 진행(계약금 → 직인 → 확인) / 끝: 보류 · 거절
--   대면:   미팅대기 → 결과 분기 계약 · 완료(다시 미팅대기로 갈 수 있음) · 변경(일시가 바뀜) / 끝: 취소(노쇼·전화 취소)
--
--   · 단계 값 'rescheduled'(변경)를 새로 허용한다 — 일시가 필요하다.
--   · 비대면에서 'deliberating'(계약고민)을 허용한다(전엔 대면 «미팅 후 고민 중» 전용).
--   · 대면 'deliberating' 은 이미 저장된 행을 깨지 않도록 계속 허용만 한다(화면 목록에서는 뺀다).
--   다른 규칙(버전·멱등·담당자·인계 조건)은 167 그대로다.

alter table public.consultation_states drop constraint if exists consultation_phase_valid;
alter table public.consultation_states add constraint consultation_phase_valid check (phase = any (array[
  'information','scheduled','consulting','absent','on_hold','rejected','follow_up',
  'meeting_scheduled','meeting_done','cancelled','deliberating','contract','rescheduled']::text[]));
alter table public.consultation_states drop constraint if exists consultation_absent_from_valid;
alter table public.consultation_states add constraint consultation_absent_from_valid check (absent_from_phase is null or (
  coalesce(phase,'')='absent' and absent_from_phase = any (array[
  'information','scheduled','consulting','on_hold','rejected','follow_up','meeting_scheduled','meeting_done',
  'cancelled','deliberating','contract','rescheduled']::text[])));

create or replace function public.execute_consultation_workflow(
 p_org_id uuid,p_item_id uuid,p_request_id uuid,p_expected_version bigint,
 p_mode text,p_phase text,p_meeting_at timestamptz default null,p_assignee uuid default null,p_cancel boolean default false
) returns table(item_id uuid,deal_id uuid,company_id uuid,mode text,version bigint,replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid := auth.uid(); v_item public.items%rowtype; v_snap record;
 v_state public.consultation_states%rowtype; v_prior public.consultation_requests%rowtype;
 v_payload jsonb; v_before jsonb; v_after jsonb; v_result jsonb; v_phase text;
 v_meeting timestamptz; v_version bigint; v_now timestamptz := clock_timestamp(); v_from text;
begin
 if v_actor is null then raise exception 'consultation authentication required' using errcode='42501'; end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0
    or p_mode is null or p_mode not in ('remote','inperson') or p_phase is null or p_cancel is null then
   raise exception 'consultation input required' using errcode='22023'; end if;
 if not public.effective_permission(p_org_id,'work.item_upsert') then
   raise exception 'consultation permission denied' using errcode='42501'; end if;
 v_payload:=jsonb_build_object('itemId',p_item_id,'mode',p_mode,'phase',p_phase,'meetingAt',p_meeting_at,
   'assignee',p_assignee,'cancel',p_cancel,'expectedVersion',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
 select i.* into v_item from public.items i where i.org_id=p_org_id and i.id=p_item_id and i.deleted_at is null for update;
 if not found then raise exception 'consultation item unavailable' using errcode='22023'; end if;
 -- Reuse 151 exact active-org/member/view-tabs/current-row department authorization BEFORE replay.
 select * into v_snap from public.read_consultation_snapshot(p_org_id,p_item_id);
 select r.* into v_prior from public.consultation_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
 if found then
   if v_prior.actor_id is distinct from v_actor or v_prior.item_id is distinct from p_item_id
     or v_prior.action <> 'workflow' or v_prior.payload is distinct from v_payload then
     raise exception 'consultation idempotency key reuse' using errcode='22023'; end if;
   return query select p_item_id,v_prior.deal_id,v_snap.company_id,
     (v_prior.result->>'mode'),(v_prior.result->>'version')::bigint,true;
   return;
 end if;
 if v_snap.board_source is distinct from 'core.default-tab/contact' or v_snap.deal_id is null then
   raise exception 'consultation canonical association required' using errcode='22023'; end if;
 perform 1 from public.deals d where d.org_id=p_org_id and d.id=v_snap.deal_id for update;
 -- Re-read under the same canonical lock order as 151 and the handoff pipeline.
 select * into v_snap from public.read_consultation_snapshot(p_org_id,p_item_id);
 if v_snap.deal_stage_kind is distinct from 'meeting' then
   raise exception 'consultation stage unavailable' using errcode='22023'; end if;
 select s.* into v_state from public.consultation_states s where s.org_id=p_org_id and s.item_id=p_item_id for update;
 if found and v_state.deal_id is distinct from v_snap.deal_id then
   raise exception 'consultation canonical association required' using errcode='22023'; end if;
 if v_snap.version <> p_expected_version then raise exception 'consultation version conflict' using errcode='40001'; end if;
 -- ★ 167: 비대면 absent(부재), 대면 deliberating(미팅 후 고민 중). 둘 다 일정 불필요.
 -- ★ 177(belie 2026-10-19): 비대면에 계약고민(deliberating), 대면에 변경(rescheduled). 대면 deliberating 은 옛 행 호환으로만 남긴다.
 if (p_mode='remote' and p_phase not in ('information','scheduled','consulting','absent','follow_up','deliberating','on_hold','rejected','contract'))
    or (p_mode='inperson' and p_phase not in ('meeting_scheduled','contract','meeting_done','rescheduled','cancelled','deliberating')) then
   raise exception 'consultation phase unsupported' using errcode='22023'; end if;
 if p_cancel and (p_mode<>v_snap.mode or p_phase<>case when p_mode='remote' then 'on_hold' else 'cancelled' end) then
   raise exception 'consultation cancel phase unsupported' using errcode='22023'; end if;
 v_meeting:=case when p_cancel or p_phase='cancelled' then null else p_meeting_at end;
 if (p_phase in ('scheduled','follow_up','meeting_scheduled','rescheduled') or p_mode<>v_snap.mode) and v_meeting is null then
   raise exception 'consultation schedule meeting required' using errcode='22023'; end if;
 if v_meeting is not null then
   if p_assignee is distinct from v_item.assigned_to then
     raise exception 'consultation assignee change requires lineage' using errcode='22023'; end if;
   if p_assignee is null then raise exception 'consultation schedule assignee required' using errcode='22023'; end if;
   if not exists(select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=p_assignee and m.status='active') then
     raise exception 'consultation assignee unavailable' using errcode='42501'; end if;
 end if;
 v_phase:=coalesce(v_state.phase,public.consultation_default_phase(v_snap.mode,v_snap.meeting_at,v_snap.checklist));
 -- ★ 167: 부재로 들어갈 때 출발 단계를 남긴다. 이미 부재면 처음 출발 단계를 유지하고, 떠나면 비운다.
 v_from:=case when p_phase<>'absent' then null
   when v_phase='absent' then v_state.absent_from_phase else v_phase end;
 v_before:=jsonb_build_object('mode',v_snap.mode,'phase',v_phase,'meetingAt',v_snap.meeting_at,'assigneeId',v_item.assigned_to)
   || case when v_phase='absent' and v_state.absent_from_phase is not null
     then jsonb_build_object('absentFromPhase',v_state.absent_from_phase) else '{}'::jsonb end;
 v_after:=jsonb_build_object('mode',p_mode,'phase',p_phase,'meetingAt',v_meeting,'assigneeId',v_item.assigned_to)
   || case when v_from is not null then jsonb_build_object('absentFromPhase',v_from) else '{}'::jsonb end;
 v_version:=v_snap.version;
 if v_before is distinct from v_after then
   v_version:=v_version+1;
   insert into public.consultation_states(org_id,item_id,deal_id,mode,version,meeting_at,checklist,updated_at,updated_by,phase,absent_from_phase)
   values(p_org_id,p_item_id,v_snap.deal_id,p_mode,v_version,v_meeting,v_snap.checklist,v_now,v_actor,p_phase,v_from)
   on conflict on constraint consultation_states_pkey do update set mode=excluded.mode,version=excluded.version,
     meeting_at=excluded.meeting_at,phase=excluded.phase,absent_from_phase=excluded.absent_from_phase,
     updated_at=excluded.updated_at,updated_by=excluded.updated_by;
   insert into public.consultation_events(org_id,item_id,deal_id,step,kind,actor_id,at,request_id,details)
   values(p_org_id,p_item_id,v_snap.deal_id,'phase',
     case when p_cancel or p_phase='cancelled' then 'appointment_cancelled'
       when v_snap.meeting_at is distinct from v_meeting and v_phase=p_phase and v_snap.mode=p_mode then 'rescheduled'
       else 'phase_changed' end,v_actor,v_now,p_request_id,jsonb_build_object('before',v_before,'after',v_after));
 end if;
 v_result:=jsonb_build_object('version',v_version,'mode',p_mode);
 insert into public.consultation_requests(org_id,request_id,item_id,deal_id,action,payload,result,actor_id)
 values(p_org_id,p_request_id,p_item_id,v_snap.deal_id,'workflow',v_payload,v_result,v_actor);
 return query select p_item_id,v_snap.deal_id,v_snap.company_id,p_mode,v_version,false;
end $$;
revoke all on function public.execute_consultation_workflow(uuid,uuid,uuid,bigint,text,text,timestamptz,uuid,boolean) from public,anon,service_role;
grant execute on function public.execute_consultation_workflow(uuid,uuid,uuid,bigint,text,text,timestamptz,uuid,boolean) to authenticated;
