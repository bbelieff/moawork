-- moa-migration-guard: logical_key=151_consultation_protected_state predecessor=150_issue700_detail_event_edit digest=c67efb51f489b22bb665818674e8a607a1fe9870feecc23738c236dfa7a2f2df foundation=false

select public.begin_guarded_migration(
  p_logical_key => '151_consultation_protected_state',
  p_file_name => '151_consultation_protected_state.sql',
  p_file_digest => 'c67efb51f489b22bb665818674e8a607a1fe9870feecc23738c236dfa7a2f2df',
  p_expected_predecessor => '150_issue700_detail_event_edit',
  p_executor => 'DG-03',
  p_thread_id => '01a02046-56a7-76c3-8b1f-08a71a7e557a',
  p_foundation => false
);

-- 151_consultation_protected_state — 상담 보호 상태/사건/요청 영속 계층.
--
-- 왜: v17 초기 구현(EAV consultation_ledger + readVersion->setValues)은 원자 CAS가 아니다.
--   동시 version0 쓰기가 둘 다 성공해 version1/history1/request1 로 끝나고(lost update),
--   checkbox 거울을 손으로 채우면 confirmed(true)+actor/time/history 없이 ready 가 되며,
--   contact_to_work 가 4체크를 우회한다. 이 파일이 정본(RPC+행잠금+CAS)으로 교체한다.
--
-- 무엇:
--   · consultation_states (org,item) PK — mode remote|inperson, version CAS, meeting_at,
--     checklist jsonb(4단계 각 confirmed/actor/at), FK (org,item)->items + (org,deal)->deals.
--   · consultation_events — append-only. 확인 1건, 취소는 대상(unconfirmed)+뒤 무효(invalidated).
--   · consultation_requests — (org,request) PK. request+target/action/payload 바인딩을
--     전이 검증보다 먼저 검사한다(replay/mismatch). version CAS 는 그 다음이다.
--   · execute_consultation_transition — check|mode 원자 전이. auth.uid + 현 org active
--     member + effective work.item_upsert + assigned scope, source/identity 확인,
--     자문잠금+rowlock+CAS, 순차확인/앞취소 뒤무효+사건append, 원자커밋.
--   · read_consultation_snapshot — 읽기 전용 스냅샷+준비도(정식 seal 포함). 쓰기 없음.
--   · execute_contact_pipeline_transition 래퍼 — 069 본체를 _069 로 개명하고 같은
--     시그니처/가드로 감싼다. contact_to_work 일 때 활성 상담행이 있으면 4완료 AND
--     보드 직인(item_values) AND 정식 seal(deals.custom)을 같은 트랜잭션 안에서
--     요구한다(첫 변이). replay(committed)는 그대로 inner 에 위임해 undo 후
--     replay 가 깨지지 않는다.
--
-- 업그레이드 동작(기존 기록을 함부로 막지 않는다):
--   · 상담행이 없는 contact 보드 item 은 스냅샷이 mode=remote, version=0, 빈 체크리스트로
--     읽힌다(읽기만 — backfill 쓰기 없음).
--   · new-lead 보드 item 의 상담 쓰기는 stage_contract 로 거부된다. new_lead 단계는
--     기존 advance_new_lead_to_contact(lead_to_contact)로만 옮기고 ID를 보존한다.
--   · 상담행이 없는 contact item 의 contact_to_work 는 기존 동작 그대로다(seal/work_move
--     게이트만). 상담행이 생긴 뒤(=활성 상담 기록)부터 4체크 게이트가 함께 잠근다.
--     UI readiness 만 믿지 않고 DB 트랜잭션 안에서 강제하므로 직접 RPC 호출 우회가 없다.
--   · EAV consultation_ledger/checkbox 거울 쓰기는 정본이 아니다. 새 쓰기 경로는 이
--     RPC뿐이며, EAV를 손으로 채워도 readiness 가 되지 않는다(위조 거부).
--   · deal stage 가 meeting 이 아닐 때 상담 쓰기는 거부된다(원장-정식 파이프라인 동기).
--     인계 후(work)에는 체크리스트를 다시 열 수 없고, 되돌리기는 기존
--     contact_to_work 롤백/재요청 경로를 쓴다.
--   · 담당자 변경은 이 RPC가 직접 쓰지 않는다. p_assignee 가 현재 item assigned_to 와
--     다르면 lineage 선행(reassign_deal_with_lineage)을 요구하는 22023 을 낸다.
--     일정 검증은 전달값이 아니라 정식(current/lineage) 담당자로 한다.

create unique index if not exists deals_org_id_id_uq
  on public.deals(org_id, id);
create unique index if not exists items_org_id_id_uq
  on public.items(org_id, id);

create table public.consultation_states (
  org_id uuid not null references public.orgs(id) on delete cascade,
  item_id uuid not null,
  deal_id uuid not null,
  mode text not null check (mode in ('remote', 'inperson')),
  version bigint not null default 0 check (version >= 0),
  meeting_at timestamptz,
  checklist jsonb not null default '{"contract_sent": {"confirmed": false, "actor": null, "at": null}, "signed_copy_sent": {"confirmed": false, "actor": null, "at": null}, "counterparty_signature_confirmed": {"confirmed": false, "actor": null, "at": null}, "deposit_confirmed": {"confirmed": false, "actor": null, "at": null}}'::jsonb,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (org_id, item_id),
  foreign key (org_id, item_id) references public.items(org_id, id) on delete cascade,
  foreign key (org_id, deal_id) references public.deals(org_id, id) on delete cascade
);

create table public.consultation_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  item_id uuid not null,
  deal_id uuid not null,
  step text not null check (step in ('contract_sent', 'signed_copy_sent', 'counterparty_signature_confirmed', 'deposit_confirmed', 'mode', 'meeting')),
  kind text not null check (kind in ('confirmed', 'unconfirmed', 'invalidated', 'mode_changed', 'rescheduled')),
  before boolean,
  after boolean,
  actor_id uuid not null references public.users(id) on delete restrict,
  at timestamptz not null default clock_timestamp(),
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (org_id, item_id) references public.items(org_id, id) on delete cascade
);
create index if not exists consultation_events_org_item_idx
  on public.consultation_events(org_id, item_id, created_at);

create table public.consultation_requests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  item_id uuid not null,
  deal_id uuid not null,
  action text not null check (action in ('check', 'mode')),
  payload jsonb not null,
  result jsonb not null,
  actor_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (org_id, request_id),
  foreign key (org_id, item_id) references public.items(org_id, id) on delete cascade
);

alter table public.consultation_states enable row level security;
alter table public.consultation_states force row level security;
alter table public.consultation_events enable row level security;
alter table public.consultation_events force row level security;
alter table public.consultation_requests enable row level security;
alter table public.consultation_requests force row level security;

revoke all on public.consultation_states, public.consultation_events, public.consultation_requests
  from public, anon, authenticated, service_role;
grant select on public.consultation_states, public.consultation_events to authenticated;

-- F5: 076:812-814 부서 가시성 공유 헬퍼. 행위자의 부서 subtree 안에 담당자가 있으면 true.
-- RLS 상관 CTE 문제를 피하려고 값 인자 함수로 둔다. 진행 상세를 새지 않는 boolean 만 돌려준다.
create or replace function public.consultation_actor_sees_assignee(p_org_id uuid, p_assigned_to uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  with recursive actor_departments as (
    select dm.dept_id from public.department_members dm
     where dm.org_id = p_org_id and dm.user_id = auth.uid() and dm.is_primary
    union all
    select d.id from public.departments d
     join actor_departments parent on d.parent_id = parent.dept_id
    where d.org_id = p_org_id and d.archived_at is null
  )
  select exists (
    select 1 from public.department_members dm
     join actor_departments ad on ad.dept_id = dm.dept_id
    where dm.org_id = p_org_id and dm.user_id = p_assigned_to
  );
$$;
revoke all on function public.consultation_actor_sees_assignee(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.consultation_actor_sees_assignee(uuid, uuid) to authenticated;

drop policy if exists consultation_states_select on public.consultation_states;
create policy consultation_states_select on public.consultation_states
for select to authenticated using (
  public.is_org_member(org_id)
  and public.effective_permission(org_id, 'work.view_tabs')
  and exists (
    select 1 from public.items i
    where i.org_id = consultation_states.org_id and i.id = consultation_states.item_id
      and (public.org_role(org_id) in ('owner', 'admin')
        or public.org_scope(org_id) = 'all'
        or i.assigned_to = auth.uid()
        or ((public.org_role(org_id) = 'team_lead' or public.org_scope(org_id) = 'department')
          and public.consultation_actor_sees_assignee(org_id, i.assigned_to)))
  )
);

drop policy if exists consultation_events_select on public.consultation_events;
create policy consultation_events_select on public.consultation_events
for select to authenticated using (
  public.is_org_member(org_id)
  and public.effective_permission(org_id, 'work.view_tabs')
  and exists (
    select 1 from public.items i
    where i.org_id = consultation_events.org_id and i.id = consultation_events.item_id
      and (public.org_role(org_id) in ('owner', 'admin')
        or public.org_scope(org_id) = 'all'
        or i.assigned_to = auth.uid()
        or ((public.org_role(org_id) = 'team_lead' or public.org_scope(org_id) = 'department')
          and public.consultation_actor_sees_assignee(org_id, i.assigned_to)))
  )
);

create or replace function public.consultation_blank_checklist()
returns jsonb
language sql immutable set search_path = '' as $$
  select '{"contract_sent": {"confirmed": false, "actor": null, "at": null}, "signed_copy_sent": {"confirmed": false, "actor": null, "at": null}, "counterparty_signature_confirmed": {"confirmed": false, "actor": null, "at": null}, "deposit_confirmed": {"confirmed": false, "actor": null, "at": null}}'::jsonb;
$$;
revoke all on function public.consultation_blank_checklist() from public, anon, authenticated, service_role;

create or replace function public.consultation_checklist_complete(p_checklist jsonb)
returns boolean
language sql immutable set search_path = '' as $$
  select coalesce((p_checklist -> 'contract_sent' ->> 'confirmed')::boolean, false)
    and coalesce((p_checklist -> 'signed_copy_sent' ->> 'confirmed')::boolean, false)
    and coalesce((p_checklist -> 'counterparty_signature_confirmed' ->> 'confirmed')::boolean, false)
    and coalesce((p_checklist -> 'deposit_confirmed' ->> 'confirmed')::boolean, false);
$$;
revoke all on function public.consultation_checklist_complete(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.consultation_checklist_complete(jsonb) to authenticated;

create or replace function public.consultation_missing_labels(p_checklist jsonb)
returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  v_missing text[] := '{}';
begin
  if not coalesce((p_checklist -> 'contract_sent' ->> 'confirmed')::boolean, false) then
    v_missing := v_missing || array['계약서 송부'];
  end if;
  if not coalesce((p_checklist -> 'signed_copy_sent' ->> 'confirmed')::boolean, false) then
    v_missing := v_missing || array['서명본 발송'];
  end if;
  if not coalesce((p_checklist -> 'counterparty_signature_confirmed' ->> 'confirmed')::boolean, false) then
    v_missing := v_missing || array['상대 서명 확인'];
  end if;
  if not coalesce((p_checklist -> 'deposit_confirmed' ->> 'confirmed')::boolean, false) then
    v_missing := v_missing || array['착수금 입금 확인'];
  end if;
  return v_missing;
end;
$$;
revoke all on function public.consultation_missing_labels(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.consultation_missing_labels(jsonb) to authenticated;

create or replace function public.execute_consultation_transition(
  p_org_id uuid,
  p_item_id uuid,
  p_request_id uuid,
  p_action text,
  p_step text default null,
  p_confirmed boolean default null,
  p_mode text default null,
  p_meeting_at timestamptz default null,
  p_assignee uuid default null,
  p_expected_version bigint default null
)
returns table(item_id uuid, deal_id uuid, company_id uuid, mode text, version bigint, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_payload jsonb;
  v_prior public.consultation_requests%rowtype;
  v_item public.items%rowtype;
  v_board_source text;
  v_deal public.deals%rowtype;
  v_stage_kind text;
  v_state public.consultation_states%rowtype;
  v_has_state boolean := false;
  v_checklist jsonb;
  v_version bigint;
  v_mode text;
  v_meeting timestamptz;
  v_now timestamptz := clock_timestamp();
  v_step_index int;
  v_prior_step text;
  v_changed boolean := false;
  v_result jsonb;
  v_effective_assignee uuid;
  v_company uuid;
  v_step_order text[] := array['contract_sent', 'signed_copy_sent', 'counterparty_signature_confirmed', 'deposit_confirmed'];
begin
  if v_actor is null then
    raise exception 'consultation authentication required' using errcode = '42501';
  end if;
  if p_request_id is null or p_action not in ('check', 'mode') then
    raise exception 'consultation input required' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'consultation expected version required' using errcode = '22023';
  end if;
  if p_action = 'check'
    and (p_step is null or not (p_step = any (v_step_order)) or p_confirmed is null) then
    raise exception 'consultation step unsupported' using errcode = '22023';
  end if;
  if p_action = 'mode' and (p_mode is null or p_mode not in ('remote', 'inperson')) then
    raise exception 'consultation mode unsupported' using errcode = '22023';
  end if;

  select m.role::text, m.scope::text into v_role, v_scope
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id and m.user_id = v_actor
     and m.status = 'active' and o.status = 'active';
  -- F4: 076:792 계약을 재사용한다. view_tabs 없이 읽기·쓰기를 허용하지 않는다.
  if not found or not public.effective_permission(p_org_id, 'work.view_tabs') then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  if not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'itemId', p_item_id, 'action', p_action,
    'step', p_step, 'confirmed', p_confirmed,
    'mode', p_mode, 'meetingAt', p_meeting_at,
    'assignee', p_assignee, 'expectedVersion', p_expected_version);

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));

  -- P1-real: 현재 행 권한을 영수증 replay 보다 먼저 확정한다. 박탈·재배정된
  -- 호출자에게 현재 mode/version/company 를 새지 않는다. 권한을 통과한
  -- replay 는 여전히 CAS·상태 전제조건보다 먼저 답한다(F6 유지).
  select i.* into v_item
    from public.items i
   where i.id = p_item_id and i.org_id = p_org_id and i.deleted_at is null
   for update of i;
  if not found then
    raise exception 'consultation item unavailable' using errcode = '22023';
  end if;
  -- F5: 076:812-814 공유 헬퍼를 재사용한다.
  if v_role in ('owner', 'admin') or v_scope = 'all' or v_item.assigned_to = v_actor then
    null;
  elsif (v_role = 'team_lead' or v_scope = 'department')
    and public.consultation_actor_sees_assignee(p_org_id, v_item.assigned_to) then
    null;
  else
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;

  -- F6: 인증된 영수증 replay 를 현재 상태 전제조건보다 먼저 처리한다(유실 응답 재시도).
  select * into v_prior
    from public.consultation_requests r
   where r.org_id = p_org_id and r.request_id = p_request_id;
  if found then
    if v_prior.item_id is distinct from p_item_id
       or v_prior.action is distinct from p_action
       or v_prior.payload is distinct from v_payload
       or v_prior.actor_id is distinct from v_actor then
      raise exception 'consultation idempotency key reuse' using errcode = '22023';
    end if;
    -- F6: 초기 noop 은 상태행 없이 영수증만 남긴다. replay 는 저장된 결과로 답한다.
    select s.* into v_state
      from public.consultation_states s
     where s.org_id = p_org_id and s.item_id = p_item_id;
    if not found then
      select d.company_id into v_company
        from public.deals d where d.org_id = p_org_id and d.id = v_prior.deal_id;
      return query select v_prior.item_id, v_prior.deal_id, v_company,
        (v_prior.result ->> 'mode'), (v_prior.result ->> 'version')::bigint, true;
      return;
    end if;
    select d.company_id into v_company
      from public.deals d where d.org_id = p_org_id and d.id = v_state.deal_id;
    return query select v_state.item_id, v_state.deal_id, v_company,
      v_state.mode, v_state.version, true;
    return;
  end if;

  select b.source into v_board_source
    from public.boards b where b.id = v_item.board_id and b.org_id = p_org_id;
  if not found then
    raise exception 'consultation board unavailable' using errcode = '22023';
  end if;
  if v_board_source = 'core.default-tab/new-lead' then
    raise exception 'consultation new lead transfer required' using errcode = '22023';
  end if;
  if v_board_source is distinct from 'core.default-tab/contact' then
    raise exception 'consultation board unavailable' using errcode = '22023';
  end if;
  if v_item.deal_id is null then
    raise exception 'consultation canonical association required' using errcode = '22023';
  end if;

  select d.* into v_deal
    from public.deals d
   where d.id = v_item.deal_id and d.org_id = p_org_id
   for update of d;
  if not found then
    raise exception 'consultation canonical association required' using errcode = '22023';
  end if;
  select s.kind::text into v_stage_kind
    from public.stages s where s.id = v_deal.stage_id;
  if v_stage_kind is distinct from 'meeting' then
    raise exception 'consultation stage unavailable' using errcode = '22023';
  end if;

  select s.* into v_state
    from public.consultation_states s
   where s.org_id = p_org_id and s.item_id = p_item_id
   for update of s;
  if found then
    v_has_state := true;
    if v_state.deal_id is distinct from v_deal.id then
      raise exception 'consultation canonical association required' using errcode = '22023';
    end if;
  end if;
  v_checklist := case when v_has_state then v_state.checklist else public.consultation_blank_checklist() end;
  v_version := case when v_has_state then v_state.version else 0 end;
  v_mode := case when v_has_state then v_state.mode else 'remote' end;
  v_meeting := case when v_has_state then v_state.meeting_at else null end;

  if v_version <> p_expected_version then
    raise exception 'consultation version conflict' using errcode = '40001';
  end if;

  if p_action = 'check' then
    select array_position(v_step_order, p_step) into v_step_index;
    if p_confirmed then
      if coalesce((v_checklist -> p_step ->> 'confirmed')::boolean, false) then
        v_result := jsonb_build_object('version', v_version, 'mode', v_mode);
        insert into public.consultation_requests(org_id, request_id, item_id, deal_id, action, payload, result, actor_id)
        values (p_org_id, p_request_id, p_item_id, v_deal.id, p_action, v_payload, v_result, v_actor);
        return query select p_item_id, v_deal.id, v_deal.company_id, v_mode, v_version, false;
        return;
      end if;
      for v_prior_step in select unnest(v_step_order[1:v_step_index - 1]) loop
        if not coalesce((v_checklist -> v_prior_step ->> 'confirmed')::boolean, false) then
          raise exception 'consultation checklist blocked' using errcode = '22023';
        end if;
      end loop;
      v_checklist := jsonb_set(v_checklist, array[p_step],
        jsonb_build_object('confirmed', true, 'actor', v_actor, 'at', v_now), true);
      v_version := v_version + 1;
      v_changed := true;
      insert into public.consultation_events(org_id, item_id, deal_id, step, kind, before, after, actor_id, at, request_id)
      values (p_org_id, p_item_id, v_deal.id, p_step, 'confirmed', false, true, v_actor, v_now, p_request_id);
    else
      v_changed := false;
      for v_prior_step in select unnest(v_step_order[v_step_index:array_length(v_step_order, 1)]) loop
        if coalesce((v_checklist -> v_prior_step ->> 'confirmed')::boolean, false) then
          v_checklist := jsonb_set(v_checklist, array[v_prior_step],
            jsonb_build_object('confirmed', false, 'actor', null, 'at', null), true);
          insert into public.consultation_events(org_id, item_id, deal_id, step, kind, before, after, actor_id, at, request_id)
          values (p_org_id, p_item_id, v_deal.id, v_prior_step,
            case when v_prior_step = p_step then 'unconfirmed' else 'invalidated' end,
            true, false, v_actor, v_now, p_request_id);
          v_changed := true;
        end if;
      end loop;
      if v_changed then
        v_version := v_version + 1;
      else
        v_result := jsonb_build_object('version', v_version, 'mode', v_mode);
        insert into public.consultation_requests(org_id, request_id, item_id, deal_id, action, payload, result, actor_id)
        values (p_org_id, p_request_id, p_item_id, v_deal.id, p_action, v_payload, v_result, v_actor);
        return query select p_item_id, v_deal.id, v_deal.company_id, v_mode, v_version, false;
        return;
      end if;
    end if;
  else
    if p_meeting_at is null then
      raise exception 'consultation schedule meeting required' using errcode = '22023';
    end if;
    v_effective_assignee := coalesce(p_assignee, v_item.assigned_to);
    if p_assignee is not null and p_assignee is distinct from v_item.assigned_to then
      raise exception 'consultation assignee change requires lineage' using errcode = '22023';
    end if;
    if v_effective_assignee is null then
      raise exception 'consultation schedule assignee required' using errcode = '22023';
    end if;
    if not exists (select 1 from public.org_members m join public.orgs o on o.id = m.org_id
                    where m.org_id = p_org_id and m.user_id = v_effective_assignee
                      and m.status = 'active' and o.status = 'active') then
      raise exception 'consultation assignee unavailable' using errcode = '42501';
    end if;
    if v_mode = p_mode and v_meeting is not distinct from p_meeting_at then
      v_result := jsonb_build_object('version', v_version, 'mode', v_mode);
      insert into public.consultation_requests(org_id, request_id, item_id, deal_id, action, payload, result, actor_id)
      values (p_org_id, p_request_id, p_item_id, v_deal.id, p_action, v_payload, v_result, v_actor);
      return query select p_item_id, v_deal.id, v_deal.company_id, v_mode, v_version, false;
      return;
    end if;
    if v_mode is distinct from p_mode then
      insert into public.consultation_events(org_id, item_id, deal_id, step, kind, before, after, actor_id, at, request_id)
      values (p_org_id, p_item_id, v_deal.id, 'mode', 'mode_changed',
        (v_mode = 'inperson'), (p_mode = 'inperson'), v_actor, v_now, p_request_id);
      v_mode := p_mode;
      v_changed := true;
    end if;
    if v_meeting is distinct from p_meeting_at then
      insert into public.consultation_events(org_id, item_id, deal_id, step, kind, before, after, actor_id, at, request_id)
      values (p_org_id, p_item_id, v_deal.id, 'meeting', 'rescheduled', null, null, v_actor, v_now, p_request_id);
      v_meeting := p_meeting_at;
      v_changed := true;
    end if;
    v_version := v_version + 1;
  end if;

  if v_has_state then
    update public.consultation_states as s
       set mode = v_mode, version = v_version, meeting_at = v_meeting,
           checklist = v_checklist, updated_at = v_now, updated_by = v_actor
     where s.org_id = p_org_id and s.item_id = p_item_id;
  else
    insert into public.consultation_states(org_id, item_id, deal_id, mode, version, meeting_at, checklist, updated_by)
    values (p_org_id, p_item_id, v_deal.id, v_mode, v_version, v_meeting, v_checklist, v_actor);
  end if;
  v_result := jsonb_build_object('version', v_version, 'mode', v_mode);
  insert into public.consultation_requests(org_id, request_id, item_id, deal_id, action, payload, result, actor_id)
  values (p_org_id, p_request_id, p_item_id, v_deal.id, p_action, v_payload, v_result, v_actor);
  return query select p_item_id, v_deal.id, v_deal.company_id, v_mode, v_version, false;
end;
$$;

revoke all on function public.execute_consultation_transition(uuid, uuid, uuid, text, text, boolean, text, timestamptz, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.execute_consultation_transition(uuid, uuid, uuid, text, text, boolean, text, timestamptz, uuid, bigint)
  to authenticated;

create or replace function public.read_consultation_snapshot(
  p_org_id uuid,
  p_item_id uuid
)
returns table(
  item_id uuid, deal_id uuid, company_id uuid, board_source text,
  mode text, version bigint, meeting_at timestamptz, checklist jsonb,
  ready boolean, missing jsonb, seal_approved boolean, seal_detail text,
  deal_stage_kind text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_item public.items%rowtype;
  v_board_source text;
  v_deal public.deals%rowtype;
  v_stage_kind text;
  v_state public.consultation_states%rowtype;
  v_has_state boolean := false;
  v_checklist jsonb;
  v_version bigint := 0;
  v_mode text;
  v_meeting timestamptz := null;
  v_seal text;
  v_move text;
  v_seal_custom text;
  v_ready boolean := false;
  v_missing text[] := '{}';
  v_seal_ok boolean := false;
  v_seal_detail text := '';
  v_deal_seal text := '대기';
begin
  if v_actor is null then
    raise exception 'consultation authentication required' using errcode = '42501';
  end if;
  select m.role::text, m.scope::text into v_role, v_scope
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id and m.user_id = v_actor
     and m.status = 'active' and o.status = 'active';
  -- F4: 076:792 계약을 재사용한다. view_tabs 없이 단일 스냅샷을 읽지 못한다.
  if not found or not public.effective_permission(p_org_id, 'work.view_tabs') then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  select i.* into v_item
    from public.items i
   where i.id = p_item_id and i.org_id = p_org_id and i.deleted_at is null;
  if not found then
    raise exception 'consultation item unavailable' using errcode = '22023';
  end if;
  -- F5: 076:812-814 공유 헬퍼를 재사용한다.
  if v_role in ('owner', 'admin') or v_scope = 'all' or v_item.assigned_to = v_actor then
    null;
  elsif (v_role = 'team_lead' or v_scope = 'department')
    and public.consultation_actor_sees_assignee(p_org_id, v_item.assigned_to) then
    null;
  else
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  select b.source into v_board_source
    from public.boards b where b.id = v_item.board_id and b.org_id = p_org_id;
  if v_item.deal_id is not null then
    select d.* into v_deal from public.deals d
     where d.id = v_item.deal_id and d.org_id = p_org_id;
    if found then
      select s.kind::text into v_stage_kind from public.stages s where s.id = v_deal.stage_id;
      v_seal_custom := coalesce(v_deal.custom ->> 'seal_approval', v_deal.custom ->> 'seal_status');
    end if;
  end if;
  select iv.value_jsonb #>> '{}' into v_seal from public.item_values iv
   where iv.item_id = p_item_id and iv.column_key = 'seal_status';
  select iv.value_jsonb #>> '{}' into v_move from public.item_values iv
   where iv.item_id = p_item_id and iv.column_key = 'work_move';

  if v_board_source = 'core.default-tab/new-lead' then
    return query select p_item_id, v_deal.id, v_deal.company_id, v_board_source,
      'new_lead'::text, 0::bigint, null::timestamptz, public.consultation_blank_checklist(),
      false, to_jsonb(array['상담 단계']::text[]), false,
      '신규리드는 리드컨택으로 먼저 옮겨 주세요.'::text, v_stage_kind;
    return;
  end if;

  select s.* into v_state from public.consultation_states s
   where s.org_id = p_org_id and s.item_id = p_item_id;
  if found then
    v_has_state := true;
    v_checklist := v_state.checklist;
    v_version := v_state.version;
    v_mode := v_state.mode;
    v_meeting := v_state.meeting_at;
  else
    v_checklist := public.consultation_blank_checklist();
    v_mode := 'remote';
  end if;

  if v_board_source is distinct from 'core.default-tab/contact' then
    return query select p_item_id, v_deal.id, v_deal.company_id, v_board_source,
      v_mode, v_version, v_meeting, v_checklist,
      false, to_jsonb(array['상담 단계']::text[]), false,
      '상담 보드의 건이 아닙니다.'::text, v_stage_kind;
    return;
  end if;

  -- P1-real: 실제 069 deal-branch 는 deals.custom 직인(정본)을 읽는다.
  -- 보드 거울(item_values)만 보고 ready 를 주장하면 정식 인계에서 직인대기로
  -- 막히는 false-ready 가 된다. 정본 미승인을 UI 에 그대로 보여준다.
  v_missing := public.consultation_missing_labels(v_checklist);
  v_deal_seal := coalesce(v_deal.custom ->> 'seal_approval', v_deal.custom ->> 'seal_status', '대기');
  if coalesce(v_move, '') <> '업무관리 이동' then
    v_seal_ok := false;
    v_seal_detail := '업무관리 이동을 먼저 선택해 주세요.';
  elsif coalesce(v_seal, '대기') <> '완료' then
    v_seal_ok := false;
    v_seal_detail := '대표 직인 승인이 필요합니다. 현재 직인(보드) = ' || coalesce(v_seal, '대기');
  elsif v_deal_seal <> '완료' then
    v_seal_ok := false;
    v_seal_detail := '대표 직인 승인이 필요합니다(계약 기준). 현재 = ' || v_deal_seal;
  else
    v_seal_ok := true;
    v_seal_detail := '대표 직인 승인 완료';
  end if;
  v_ready := v_missing = '{}'::text[]
    and public.consultation_checklist_complete(v_checklist)
    and v_seal_ok
    and v_stage_kind = 'meeting';
  if v_stage_kind is distinct from 'meeting' then
    v_missing := v_missing || array['상담 단계'];
  end if;
  return query select p_item_id, v_deal.id, v_deal.company_id, v_board_source,
    v_mode, v_version, v_meeting, v_checklist,
    v_ready, to_jsonb(v_missing), v_seal_ok, v_seal_detail, v_stage_kind;
end;
$$;

revoke all on function public.read_consultation_snapshot(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.read_consultation_snapshot(uuid, uuid) to authenticated;

-- 활성 상담행의 인계 차단 사유. null = 게이트 없음(레거시 그대로 inner 에 위임).
-- 내부 전용: public 실행을 주지 않는다. 래퍼가 잠금(item->deal->state)을 잡은 뒤 호출한다.
-- 직접 호출 검증용으로 auth/소속/기능 권한을 자체 확인한다(F1).
create or replace function public.consultation_handoff_block_reason(
  p_org_id uuid,
  p_item_id uuid,
  p_deal_id uuid
)
returns text
language plpgsql security definer set search_path = '' as $$
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
  if not public.effective_permission(p_org_id, 'work.view_tabs') then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  if not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  select s.* into v_state from public.consultation_states s
   where s.org_id = p_org_id and s.item_id = p_item_id;
  if not found then
    return null;
  end if;
  if v_state.deal_id is distinct from p_deal_id then
    return '상담 기록과 계약이 일치하지 않습니다.';
  end if;
  if v_state.mode not in ('remote', 'inperson') then
    return '상담 단계';
  end if;
  v_missing := public.consultation_missing_labels(v_state.checklist);
  if v_missing <> '{}'::text[] or not public.consultation_checklist_complete(v_state.checklist) then
    return '인계 조건이 남았습니다: ' || array_to_string(v_missing, ' · ');
  end if;
  -- P1-real/edge: 호출자가 잡은 잠금(item->deal->state) 안에서 정식 게이트를 재확인한다.
  -- 실제 069 deal-branch 는 deals.custom 직인(정본)을 강제하고, 스냅샷 ready 는
  -- 보드 거울(item_values.seal_status)까지 요구한다. 여기서 둘 중 하나라도
  -- 미승인이면 먼저 막아야 ready=false 뒤 첫 변이 커밋이라는 어긋남이 없다.
  -- 직인을 끄거나 우회하지 않고, 미승인 사유를 실제 값과 함께 돌려준다.
  -- 순서는 스냅샷과 같다: 업무관리 이동 -> 보드 직인 -> 계약 정본 직인.
  select coalesce(d.custom ->> 'seal_approval', d.custom ->> 'seal_status', '대기'),
         s.kind::text
    into v_deal_seal, v_stage_kind
    from public.deals d
    left join public.stages s on s.id = d.stage_id
   where d.id = p_deal_id and d.org_id = p_org_id;
  select iv.value_jsonb #>> '{}' into v_move from public.item_values iv
   where iv.item_id = p_item_id and iv.column_key = 'work_move';
  select iv.value_jsonb #>> '{}' into v_board_seal from public.item_values iv
   where iv.item_id = p_item_id and iv.column_key = 'seal_status';
  if coalesce(v_move, '') <> '업무관리 이동' then
    return '업무관리 이동을 먼저 선택해 주세요.';
  end if;
  if coalesce(v_board_seal, '대기') <> '완료' then
    return '대표 직인 승인이 필요합니다. 현재 직인(보드) = ' || coalesce(v_board_seal, '대기');
  end if;
  if v_deal_seal <> '완료' then
    return '대표 직인 승인이 필요합니다(계약 기준). 현재 = ' || v_deal_seal;
  end if;
  if v_stage_kind is distinct from 'meeting' then
    return '상담 단계에서는 인계할 수 없습니다.';
  end if;
  return null;
end;
$$;
revoke all on function public.consultation_handoff_block_reason(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- 069 본체를 보존하고 같은 시그니처로 감싼다. lead_to_contact 는 그대로 위임한다.
alter function public.execute_contact_pipeline_transition(uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, date, numeric)
  rename to execute_contact_pipeline_transition_069;

create or replace function public.execute_contact_pipeline_transition(
  p_org_id uuid, p_deal_id uuid, p_source_item_id uuid, p_request_id uuid, p_kind text,
  p_company_id uuid default null, p_company_name text default null,
  p_biz_no text default null, p_owner_name text default null,
  p_business_type text default null, p_industry text default null,
  p_region_sido text default null, p_region_sigungu text default null,
  p_phone text default null, p_founded_on date default null,
  p_revenue numeric default null
) returns table(status text, deal_id uuid, company_id uuid, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_item_row public.items%rowtype;
  v_deal_row public.deals%rowtype;
  v_state public.consultation_states%rowtype;
  v_has_state boolean := false;
  v_existing public.contact_pipeline_transitions%rowtype;
  v_gate text;
  v_from uuid;
  v_item uuid := null;
  v_deal uuid := null;
  v_row_ok boolean := false;
  v_status text;
  v_out_deal uuid;
  v_out_company uuid;
  v_out_reason text;
begin
  -- F1: auth/org/feature BEFORE any receipt read, gate read, or blocked write.
  -- non-contact_to_work 도 같은 문을 먼저 통과한 뒤 inner 에 위임한다.
  if v_actor is null then
    raise exception 'transition unavailable' using errcode = '42501';
  end if;
  if p_request_id is null or p_kind not in ('lead_to_contact', 'contact_to_work') then
    raise exception 'transition unavailable' using errcode = '22023';
  end if;
  select m.role::text, m.scope::text into v_role, v_scope
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id and m.user_id = v_actor
     and m.status = 'active' and o.status = 'active';
  if not found then
    raise exception 'transition unavailable' using errcode = '42501';
  end if;
  if not public.effective_permission(p_org_id, 'work.view_tabs') then
    raise exception 'transition unavailable' using errcode = '42501';
  end if;
  if p_kind is distinct from 'contact_to_work' then
    return query select * from public.execute_contact_pipeline_transition_069(
      p_org_id, p_deal_id, p_source_item_id, p_request_id, p_kind,
      p_company_id, p_company_name, p_biz_no, p_owner_name, p_business_type, p_industry,
      p_region_sido, p_region_sigungu, p_phone, p_founded_on, p_revenue);
    return;
  end if;
  if not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'transition unavailable' using errcode = '42501';
  end if;

  -- F2: 정본 ID 확정. 둘 다 없으면 거부한다.
  if p_source_item_id is null and p_deal_id is null then
    raise exception 'transition unavailable' using errcode = '22023';
  end if;

  -- F3: item -> deal -> state 순서로 행잠금을 잡고 게이트를 재확인한다.
  -- execute_consultation_transition 과 같은 순서이며 handoff 위임까지 유지된다.
  if p_source_item_id is not null then
    select i.* into v_item_row
      from public.items i
     where i.id = p_source_item_id and i.org_id = p_org_id and i.deleted_at is null
     for update of i;
    if not found then
      raise exception 'transition request target mismatch' using errcode = '22023';
    end if;
    v_item := v_item_row.id;
    -- F2: 명시 deal 이 정본(item.deal_id)과 다르면 거부한다. null 로 새 deal 생성을 막는다.
    if p_deal_id is not null and v_item_row.deal_id is distinct from p_deal_id then
      raise exception 'transition request target mismatch' using errcode = '22023';
    end if;
    v_deal := coalesce(p_deal_id, v_item_row.deal_id);
  else
    -- deal 만 온 경우: 정본 contact item 을 찾아 같은 순서로 잠근다.
    select i.id into v_item
      from public.items i
      join public.boards b on b.id = i.board_id and b.org_id = i.org_id
     where i.org_id = p_org_id and i.deal_id = p_deal_id and i.deleted_at is null
       and b.source = 'core.default-tab/contact'
     order by i.created_at limit 1;
    if v_item is not null then
      select i.* into v_item_row
        from public.items i
       where i.id = v_item and i.org_id = p_org_id and i.deleted_at is null
       for update of i;
      v_deal := p_deal_id;
    else
      v_deal := p_deal_id;
    end if;
  end if;

  if v_deal is not null then
    select d.* into v_deal_row
      from public.deals d
     where d.id = v_deal and d.org_id = p_org_id
     for update of d;
    if not found then
      raise exception 'transition request target mismatch' using errcode = '22023';
    end if;
    -- F2: 명시 company 가 정본(deal.company_id)과 다르면 거부한다.
    if p_company_id is not null
       and v_deal_row.company_id is not null
       and v_deal_row.company_id is distinct from p_company_id then
      raise exception 'transition request target mismatch' using errcode = '22023';
    end if;
  end if;

  if v_item is not null then
    select s.* into v_state
      from public.consultation_states s
     where s.org_id = p_org_id and s.item_id = v_item
     for update of s;
    if found then
      v_has_state := true;
      -- F2: 활성 상담행이 있으면 요청 deal 은 상태 deal 과 일치해야 한다(null 포함).
      if p_deal_id is distinct from v_state.deal_id then
        raise exception 'transition request target mismatch' using errcode = '22023';
      end if;
      if v_deal is distinct from v_state.deal_id then
        raise exception 'transition request target mismatch' using errcode = '22023';
      end if;
    end if;
  end if;

  -- 행 권한: 실제 069:109 전이 계약과 같은 눈(owner/admin/all/self)이다.
  -- 부서 가시성(076:812-814)은 상담 진행·읽기까지이며, 계약 이동(인계)은 정식
  -- 체인이 강제하는 좁은 계약을 그대로 따른다. 담당자가 아니면 lineage
  -- 선행 이전(reassign_deal_with_lineage)으로 담당을 옮긴 뒤 인계한다.
  -- 부서를 넘어 넓히지 않고, 레거시 lead_to_contact/contact 위임 동작은 그대로 둔다.
  if v_item_row.id is not null then
    if v_role in ('owner', 'admin') or v_scope = 'all'
       or v_item_row.assigned_to = v_actor then
      v_row_ok := true;
    end if;
  elsif v_deal_row.id is not null then
    if v_role in ('owner', 'admin') or v_scope = 'all'
       or v_deal_row.assigned_to = v_actor then
      v_row_ok := true;
    end if;
  end if;
  if not v_row_ok then
    raise exception 'transition unavailable' using errcode = '42501';
  end if;

  -- F1: 영수증은 권한 뒤에 읽는다. 다른 동작의 영수증은 절대 덮어쓰지 않는다.
  select * into v_existing from public.contact_pipeline_transitions t
   where t.org_id = p_org_id and t.request_id = p_request_id;
  if found then
    if v_existing.kind is distinct from p_kind then
      raise exception 'transition request target mismatch' using errcode = '22023';
    end if;
    if p_source_item_id is not null then
      if v_existing.source_item_id is not null
         and v_existing.source_item_id is distinct from p_source_item_id then
        raise exception 'transition request target mismatch' using errcode = '22023';
      end if;
      if v_existing.source_item_id is null then
        -- P1-real: 실제 069 deal-branch 영수증은 deal 만 싣고 source_item_id 가
        -- null 이다. 잠금 확정 projection(v_item->v_deal)과 영수증 deal 이
        -- 일치할 때만 같은 행으로 묶고, 아니면 위조·혼선으로 거부한다.
        -- 다른 행 영수증은 절대 풀지 않는다.
        if v_item is null or v_existing.deal_id is distinct from v_deal then
          raise exception 'transition request target mismatch' using errcode = '22023';
        end if;
      end if;
    else
      if v_existing.deal_id is distinct from p_deal_id then
        raise exception 'transition request target mismatch' using errcode = '22023';
      end if;
    end if;
    if v_existing.status = 'committed' then
      if v_item is not null then
        update public.contact_pipeline_transitions as t
           set source_item_id = v_item
         where t.org_id = p_org_id and t.request_id = p_request_id
           and t.source_item_id is null and t.deal_id is not distinct from v_deal;
      end if;
      return query select * from public.execute_contact_pipeline_transition_069(
        p_org_id, p_deal_id, p_source_item_id, p_request_id, p_kind,
        p_company_id, p_company_name, p_biz_no, p_owner_name, p_business_type, p_industry,
        p_region_sido, p_region_sigungu, p_phone, p_founded_on, p_revenue);
      return;
    end if;
  end if;

  -- F3: 잠금 안에서 게이트를 재확인한다. 취소 경합이 잠금 뒤에 와도 같은 트랜잭션에서 보인다.
  if v_item is not null then
    v_gate := public.consultation_handoff_block_reason(p_org_id, v_item, v_deal);
    if v_gate is not null then
      if p_source_item_id is not null then
        -- P1-edge: 차단 영수증에도 잠금 확정 target(deal+source)을 전부 싣는다.
        -- deal 없이 막으면 같은 요청 재시도가 inner 069:114(deal 대조)에서
        -- 22023 으로 어긋난다. 바인딩은 위 영수증 검사에서 이미 검증됐다.
        select d.stage_id into v_from from public.deals d where d.id = v_deal and d.org_id = p_org_id;
        insert into public.contact_pipeline_transitions(org_id, deal_id, source_item_id, request_id, kind, from_stage_id, actor_id, status, block_reason)
        values (p_org_id, v_deal, v_item, p_request_id, p_kind, v_from, v_actor, 'blocked', v_gate)
        on conflict (org_id, request_id) do update
          set deal_id = excluded.deal_id, source_item_id = excluded.source_item_id,
              from_stage_id = excluded.from_stage_id,
              status = 'blocked', block_reason = excluded.block_reason, actor_id = excluded.actor_id;
        return query select 'blocked'::text, v_deal, null::uuid, v_gate;
        return;
      else
        select d.stage_id into v_from from public.deals d where d.id = v_deal and d.org_id = p_org_id;
        insert into public.contact_pipeline_transitions(org_id, deal_id, request_id, kind, from_stage_id, actor_id, status, block_reason)
        values (p_org_id, v_deal, p_request_id, p_kind, v_from, v_actor, 'blocked', v_gate)
        on conflict (org_id, request_id) do update
          set status = 'blocked', block_reason = excluded.block_reason, actor_id = excluded.actor_id;
        return query select 'blocked'::text, v_deal, null::uuid, v_gate;
        return;
      end if;
    end if;
  end if;

  -- F2: 정본 v_deal(잠금 확정)을 inner 에 넘긴다. null 그대로 넘겨 새 deal 생성을 막는다.
  -- P1-real: inner 가 같은 트랜잭션에서 남긴 영수증의 빈 source_item_id 를
  -- 잠금 확정 projection 으로 원자 바인딩한다. 다른 행은 건드리지 않는다.
  select r.status, r.deal_id, r.company_id, r.reason
    into v_status, v_out_deal, v_out_company, v_out_reason
    from public.execute_contact_pipeline_transition_069(
      p_org_id, v_deal, p_source_item_id, p_request_id, p_kind,
      p_company_id, p_company_name, p_biz_no, p_owner_name, p_business_type, p_industry,
      p_region_sido, p_region_sigungu, p_phone, p_founded_on, p_revenue) r;
  if v_item is not null then
    update public.contact_pipeline_transitions as t
       set source_item_id = v_item
     where t.org_id = p_org_id and t.request_id = p_request_id
       and t.source_item_id is null and t.deal_id is not distinct from v_deal;
  end if;
  return query select v_status, v_out_deal, v_out_company, v_out_reason;
end;
$$;

revoke all on function public.execute_contact_pipeline_transition(uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, date, numeric)
  from public, anon, service_role;
grant execute on function public.execute_contact_pipeline_transition(uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, date, numeric)
  to authenticated;
revoke all on function public.execute_contact_pipeline_transition_069(uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, date, numeric)
  from public, anon, authenticated, service_role;
