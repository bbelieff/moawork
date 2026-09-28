-- moa-migration-guard: logical_key=156_consultation_workflow predecessor=155_intake_labels_atomic_repair digest=95afff23f4bc8c6728633d67aa3836a40b1bd3ccd83b964bfd8b0f44c70d78cf foundation=false
select public.begin_guarded_migration(
  p_logical_key => '156_consultation_workflow', p_file_name => '156_consultation_workflow.sql',
  p_file_digest => '95afff23f4bc8c6728633d67aa3836a40b1bd3ccd83b964bfd8b0f44c70d78cf', p_expected_predecessor => '155_intake_labels_atomic_repair',
  p_executor => 'Codex', p_thread_id => 'consultation-workflow-156', p_foundation => false
);

-- Additive draft: 151/152 signatures and protected handoff/checklist remain intact.
alter table public.consultation_states add column phase text;
alter table public.consultation_states add constraint consultation_phase_valid check
 (phase in ('information','scheduled','consulting','on_hold','rejected','follow_up','meeting_scheduled','meeting_done','cancelled','contract'));
alter table public.consultation_events add column details jsonb;
alter table public.consultation_events drop constraint consultation_events_step_check;
alter table public.consultation_events add constraint consultation_events_step_check check
 (step in ('contract_sent','signed_copy_sent','counterparty_signature_confirmed','deposit_confirmed','mode','meeting','phase'));
alter table public.consultation_events drop constraint consultation_events_kind_check;
alter table public.consultation_events add constraint consultation_events_kind_check check
 (kind in ('confirmed','unconfirmed','invalidated','mode_changed','rescheduled','phase_changed','appointment_cancelled'));
alter table public.consultation_requests drop constraint consultation_requests_action_check;
alter table public.consultation_requests add constraint consultation_requests_action_check check(action in ('check','mode','workflow'));

create function public.consultation_default_phase(p_mode text, p_meeting timestamptz, p_checklist jsonb)
returns text language sql immutable set search_path='' as $$
 select case when exists(select 1 from jsonb_each(coalesce(p_checklist,'{}'::jsonb)) e where e.value->>'confirmed'='true') then 'contract'
   when p_mode='inperson' then 'meeting_scheduled'
   when p_meeting is not null then 'scheduled' else 'information' end
$$;
revoke all on function public.consultation_default_phase(text,timestamptz,jsonb) from public,anon,service_role;
grant execute on function public.consultation_default_phase(text,timestamptz,jsonb) to authenticated;
-- Only derived phase is initialized; IDs, version, checklist, meeting and canonical data stay unchanged.
-- 153 blocks child writes for archived items. Leave their phase NULL; v2 readers
-- derive the same conservative value when the item is restored, without touching history.
update public.consultation_states s
   set phase=public.consultation_default_phase(s.mode,s.meeting_at,s.checklist)
  from public.items i
 where i.org_id=s.org_id and i.id=s.item_id
   and i.archived_at is null and i.deleted_at is null;

-- Legacy 151 callers may still switch modes/check contracts. Keep their signatures and semantics.
create function public.consultation_phase_compat() returns trigger language plpgsql set search_path='' as $$
begin
 if new.phase is null then new.phase := public.consultation_default_phase(new.mode,new.meeting_at,new.checklist);
 elsif tg_op='UPDATE' then
   if new.mode is distinct from old.mode and new.phase is not distinct from old.phase then
     new.phase := public.consultation_default_phase(new.mode,new.meeting_at,new.checklist);
   elsif new.checklist is distinct from old.checklist
     and public.consultation_default_phase(new.mode,new.meeting_at,new.checklist)='contract' then
     new.phase := 'contract';
   end if;
 end if;
 return new;
end $$;
revoke all on function public.consultation_phase_compat() from public,anon,authenticated,service_role;
create trigger consultation_phase_compat before insert or update on public.consultation_states
 for each row execute function public.consultation_phase_compat();

create function public.execute_consultation_workflow(
 p_org_id uuid,p_item_id uuid,p_request_id uuid,p_expected_version bigint,
 p_mode text,p_phase text,p_meeting_at timestamptz default null,p_assignee uuid default null,p_cancel boolean default false
) returns table(item_id uuid,deal_id uuid,company_id uuid,mode text,version bigint,replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid := auth.uid(); v_item public.items%rowtype; v_snap record;
 v_state public.consultation_states%rowtype; v_prior public.consultation_requests%rowtype;
 v_payload jsonb; v_before jsonb; v_after jsonb; v_result jsonb; v_phase text;
 v_meeting timestamptz; v_version bigint; v_now timestamptz := clock_timestamp();
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
 if (p_mode='remote' and p_phase not in ('information','scheduled','consulting','on_hold','rejected','follow_up','contract'))
    or (p_mode='inperson' and p_phase not in ('meeting_scheduled','meeting_done','cancelled','contract')) then
   raise exception 'consultation phase unsupported' using errcode='22023'; end if;
 if p_cancel and (p_mode<>v_snap.mode or p_phase<>case when p_mode='remote' then 'on_hold' else 'cancelled' end) then
   raise exception 'consultation cancel phase unsupported' using errcode='22023'; end if;
 v_meeting:=case when p_cancel or p_phase='cancelled' then null else p_meeting_at end;
 if (p_phase in ('scheduled','follow_up','meeting_scheduled') or p_mode<>v_snap.mode) and v_meeting is null then
   raise exception 'consultation schedule meeting required' using errcode='22023'; end if;
 if v_meeting is not null then
   if p_assignee is distinct from v_item.assigned_to then
     raise exception 'consultation assignee change requires lineage' using errcode='22023'; end if;
   if p_assignee is null then raise exception 'consultation schedule assignee required' using errcode='22023'; end if;
   if not exists(select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=p_assignee and m.status='active') then
     raise exception 'consultation assignee unavailable' using errcode='42501'; end if;
 end if;
 v_phase:=coalesce(v_state.phase,public.consultation_default_phase(v_snap.mode,v_snap.meeting_at,v_snap.checklist));
 v_before:=jsonb_build_object('mode',v_snap.mode,'phase',v_phase,'meetingAt',v_snap.meeting_at,'assigneeId',v_item.assigned_to);
 v_after:=jsonb_build_object('mode',p_mode,'phase',p_phase,'meetingAt',v_meeting,'assigneeId',v_item.assigned_to);
 v_version:=v_snap.version;
 if v_before is distinct from v_after then
   v_version:=v_version+1;
   insert into public.consultation_states(org_id,item_id,deal_id,mode,version,meeting_at,checklist,updated_at,updated_by,phase)
   values(p_org_id,p_item_id,v_snap.deal_id,p_mode,v_version,v_meeting,v_snap.checklist,v_now,v_actor,p_phase)
   on conflict on constraint consultation_states_pkey do update set mode=excluded.mode,version=excluded.version,
     meeting_at=excluded.meeting_at,phase=excluded.phase,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
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

-- New read signatures avoid changing 151/152 callers; visibility and pagination stay delegated to them.
create function public.read_consultation_snapshot_v2(p_org_id uuid,p_item_id uuid)
returns table(item_id uuid,deal_id uuid,company_id uuid,board_source text,mode text,version bigint,meeting_at timestamptz,
 checklist jsonb,ready boolean,missing jsonb,seal_approved boolean,seal_detail text,deal_stage_kind text,
 phase text,assignee_id uuid,history jsonb)
language sql security definer set search_path='' as $$
 select b.*,coalesce(s.phase,public.consultation_default_phase(b.mode,b.meeting_at,b.checklist)),i.assigned_to,
   coalesce((select jsonb_agg(e.entry order by e.at desc,e.id desc) from
     (select ev.id,ev.at,jsonb_build_object('id',ev.id,'at',ev.at,'actorId',ev.actor_id,'kind',ev.kind,'details',ev.details) entry
      from public.consultation_events ev where ev.org_id=p_org_id and ev.item_id=b.item_id and ev.details is not null
      order by ev.at desc,ev.id desc limit 20) e),'[]'::jsonb)
 from public.read_consultation_snapshot(p_org_id,p_item_id) b
 join public.items i on i.id=b.item_id and i.org_id=p_org_id
 left join public.consultation_states s on s.item_id=b.item_id and s.org_id=p_org_id
$$;
revoke all on function public.read_consultation_snapshot_v2(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_consultation_snapshot_v2(uuid,uuid) to authenticated;

create function public.read_consultation_board_view_v2(p_org_id uuid,p_board_id uuid,p_item_ids uuid[] default null,p_limit integer default 200,p_offset integer default 0)
returns table(item_id uuid,deal_id uuid,company_id uuid,mode text,version bigint,meeting_at timestamptz,checklist jsonb,
 ready boolean,missing jsonb,seal_approved boolean,seal_detail text,deal_stage_kind text,phase text)
language sql security definer set search_path='' as $$
 select b.*,coalesce(s.phase,public.consultation_default_phase(b.mode,b.meeting_at,b.checklist))
 from public.read_consultation_board_view(p_org_id,p_board_id,p_item_ids,p_limit,p_offset) b
 left join public.consultation_states s on s.item_id=b.item_id and s.org_id=p_org_id
$$;
revoke all on function public.read_consultation_board_view_v2(uuid,uuid,uuid[],integer,integer) from public,anon,service_role;
grant execute on function public.read_consultation_board_view_v2(uuid,uuid,uuid[],integer,integer) to authenticated;
