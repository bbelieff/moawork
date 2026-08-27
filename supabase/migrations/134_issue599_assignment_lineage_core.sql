-- moa-migration-guard: logical_key=134_issue599_assignment_lineage_core predecessor=133_issue571_department_management_ui digest=629a19f798643d5c47930f0f2b2495703b52141dfd89c18a50ad5e28085fd969 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '134_issue599_assignment_lineage_core',
  p_file_name => '134_issue599_assignment_lineage_core.sql',
  p_file_digest => '629a19f798643d5c47930f0f2b2495703b52141dfd89c18a50ad5e28085fd969',
  p_expected_predecessor => '133_issue571_department_management_ui',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- #599 — no customer-row backfill. Existing deals are represented as a read-only
-- baseline until their first lineage mutation initializes version zero.
create table public.assignment_lineage_state (
  org_id uuid not null references public.orgs(id) on delete cascade,
  deal_id uuid primary key references public.deals(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  baseline_assignee_id uuid references public.users(id) on delete set null,
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  unique (org_id, deal_id),
  unique (org_id, item_id)
);

create table public.assignment_transition_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  deal_id uuid not null,
  item_id uuid not null,
  sequence bigint not null check (sequence > 0),
  from_user_id uuid,
  to_user_id uuid,
  actor_user_id uuid not null,
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (org_id, request_id),
  unique (org_id, deal_id, sequence)
);

create table public.assignment_followers (
  org_id uuid not null references public.orgs(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  user_id uuid not null,
  added_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (org_id, deal_id, user_id)
);

create table public.assignment_pending_handoffs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  from_user_id uuid,
  to_user_id uuid not null,
  created_by uuid not null,
  expected_version bigint not null check (expected_version >= 0),
  status text not null default 'pending' check (status in ('pending', 'executed', 'cancelled', 'superseded')),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  check ((status = 'pending' and resolved_at is null) or (status <> 'pending' and resolved_at is not null))
);
create unique index assignment_one_pending_handoff_idx
  on public.assignment_pending_handoffs(org_id, deal_id) where status = 'pending';

create table public.assignment_handoff_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  deal_id uuid not null,
  item_id uuid not null,
  handoff_id uuid not null,
  event_type text not null check (event_type in ('scheduled', 'cancelled', 'executed', 'superseded')),
  from_user_id uuid,
  to_user_id uuid not null,
  actor_user_id uuid not null,
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (org_id, request_id)
);

create table public.assignment_lineage_requests (
  org_id uuid not null,
  request_id uuid not null,
  actor_user_id uuid not null,
  operation text not null check (operation in ('reassign', 'follower_add', 'follower_remove', 'handoff_schedule', 'handoff_cancel')),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (org_id, request_id)
);

create index assignment_transition_deal_idx
  on public.assignment_transition_events(org_id, deal_id, sequence);
create index assignment_handoff_deal_idx
  on public.assignment_handoff_events(org_id, deal_id, created_at, id);
create index assignment_follower_user_idx
  on public.assignment_followers(org_id, user_id);

alter table public.assignment_lineage_state enable row level security;
alter table public.assignment_transition_events enable row level security;
alter table public.assignment_followers enable row level security;
alter table public.assignment_pending_handoffs enable row level security;
alter table public.assignment_handoff_events enable row level security;
alter table public.assignment_lineage_requests enable row level security;

create or replace function public.assignment_lineage_can_read(p_org_id uuid, p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.org_members m
      join public.orgs o on o.id = m.org_id
      join public.deals d on d.id = p_deal_id and d.org_id = m.org_id
     where m.org_id = p_org_id
       and m.user_id = auth.uid()
       and m.status = 'active'
       and o.status = 'active'
       and public.effective_permission(p_org_id, 'work.view_tabs')
       and (
         m.role::text in ('owner', 'admin')
         or m.scope::text = 'all'
         or d.assigned_to = auth.uid()
         or exists (
           select 1 from public.assignment_followers f
            where f.org_id = p_org_id and f.deal_id = p_deal_id and f.user_id = auth.uid()
         )
       )
  );
$$;

create policy assignment_state_read on public.assignment_lineage_state for select
  using (public.assignment_lineage_can_read(org_id, deal_id));
create policy assignment_transition_read on public.assignment_transition_events for select
  using (public.assignment_lineage_can_read(org_id, deal_id));
create policy assignment_followers_read on public.assignment_followers for select
  using (public.assignment_lineage_can_read(org_id, deal_id));
create policy assignment_pending_read on public.assignment_pending_handoffs for select
  using (public.assignment_lineage_can_read(org_id, deal_id));
create policy assignment_handoff_event_read on public.assignment_handoff_events for select
  using (public.assignment_lineage_can_read(org_id, deal_id));

-- Requests contain idempotency payloads and are never exposed through PostgREST.
-- The RPCs below are their only access path.

create or replace function public.assignment_lineage_require_writer(
  p_org_id uuid,
  p_board_id uuid,
  p_deal_id uuid,
  p_item_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1
      from public.org_members m
      join public.orgs o on o.id = m.org_id
      join public.deals d on d.id = p_deal_id and d.org_id = m.org_id
      join public.items i on i.id = p_item_id and i.org_id = d.org_id
        and i.board_id = p_board_id and i.deal_id = d.id and i.deleted_at is null
     where m.org_id = p_org_id
       and m.user_id = v_actor
       and m.status = 'active'
       and o.status = 'active'
       and (m.role::text in ('owner', 'admin') or m.scope::text = 'all')
       and public.effective_permission(p_org_id, 'work.item_upsert')
  ) then
    raise exception 'assignment writer required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.assignment_lineage_require_active_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or not exists (
    select 1 from public.org_members m
    join public.orgs o on o.id = m.org_id
    where m.org_id = p_org_id and m.user_id = p_user_id
      and m.status = 'active' and o.status = 'active'
  ) then
    raise exception 'active organization member required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.assignment_lineage_replay(
  p_org_id uuid,
  p_request_id uuid,
  p_actor uuid,
  p_operation text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_request public.assignment_lineage_requests%rowtype;
begin
  if p_request_id is null then
    raise exception 'request id required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_org_id::text || ':' || p_request_id::text));
  select * into v_request from public.assignment_lineage_requests
   where org_id = p_org_id and request_id = p_request_id;
  if not found then return null; end if;
  if v_request.actor_user_id = p_actor
     and v_request.operation = p_operation
     and v_request.payload = p_payload then
    return v_request.result || jsonb_build_object('replayed', true);
  end if;
  raise exception 'idempotency key reuse with different request' using errcode = '22023';
end;
$$;

create or replace function public.read_assignment_lineage(
  p_org_id uuid,
  p_board_id uuid,
  p_deal_id uuid,
  p_item_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_current uuid;
  v_item uuid;
  v_baseline uuid;
  v_version bigint := 0;
begin
  if not public.assignment_lineage_can_read(p_org_id, p_deal_id) then
    raise exception 'assignment lineage unavailable' using errcode = '42501';
  end if;
  select d.assigned_to, i.id into v_current, v_item
    from public.deals d
    join public.items i on i.org_id = d.org_id and i.deal_id = d.id and i.deleted_at is null
   where d.org_id = p_org_id and d.id = p_deal_id
     and i.board_id = p_board_id and i.id = p_item_id;
  if not found then raise exception 'assignment projection unavailable' using errcode = '42501'; end if;
  select s.baseline_assignee_id, s.version into v_baseline, v_version
    from public.assignment_lineage_state s
   where s.org_id = p_org_id and s.deal_id = p_deal_id and s.item_id = p_item_id;
  if not found then v_baseline := v_current; v_version := 0; end if;
  return jsonb_build_object(
    'orgId', p_org_id, 'boardId', p_board_id, 'dealId', p_deal_id, 'itemId', v_item,
    'baselineAssigneeId', v_baseline, 'currentAssigneeId', v_current, 'version', v_version,
    'transitions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'sequence', e.sequence, 'fromUserId', e.from_user_id,
        'toUserId', e.to_user_id, 'actorUserId', e.actor_user_id,
        'requestId', e.request_id, 'createdAt', e.created_at
      ) order by e.sequence)
      from public.assignment_transition_events e
      where e.org_id = p_org_id and e.deal_id = p_deal_id and e.item_id = p_item_id
    ), '[]'::jsonb),
    'followers', coalesce((
      select jsonb_agg(jsonb_build_object('userId', f.user_id, 'addedBy', f.added_by, 'createdAt', f.created_at) order by f.created_at, f.user_id)
      from public.assignment_followers f
      join public.org_members m on m.org_id = f.org_id and m.user_id = f.user_id and m.status = 'active'
       where f.org_id = p_org_id and f.deal_id = p_deal_id
    ), '[]'::jsonb),
    'pendingHandoff', (
      select jsonb_build_object('id', h.id, 'fromUserId', h.from_user_id, 'toUserId', h.to_user_id,
        'createdBy', h.created_by, 'expectedVersion', h.expected_version, 'createdAt', h.created_at)
      from public.assignment_pending_handoffs h
      join public.org_members m on m.org_id = h.org_id and m.user_id = h.to_user_id and m.status = 'active'
      where h.org_id = p_org_id and h.deal_id = p_deal_id
        and h.item_id = p_item_id and h.status = 'pending'
    )
  );
end;
$$;

create or replace function public.reassign_deal_with_lineage(
  p_org_id uuid,
  p_board_id uuid,
  p_deal_id uuid,
  p_item_id uuid,
  p_assigned_to uuid,
  p_expected_assigned_to uuid,
  p_expected_version bigint,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_current uuid;
  v_item uuid;
  v_version bigint;
  v_payload jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_pending public.assignment_pending_handoffs%rowtype;
  v_projection_guard text;
  v_previous_version bigint;
begin
  v_actor := public.assignment_lineage_require_writer(p_org_id, p_board_id, p_deal_id, p_item_id);
  if p_expected_version is null or p_expected_version < 0 then raise exception 'expected version required' using errcode = '22023'; end if;
  v_payload := jsonb_build_object('boardId', p_board_id, 'dealId', p_deal_id, 'itemId', p_item_id,
    'assignedTo', p_assigned_to,
    'expectedAssignedTo', p_expected_assigned_to, 'expectedVersion', p_expected_version);
  v_replay := public.assignment_lineage_replay(p_org_id, p_request_id, v_actor, 'reassign', v_payload);
  if v_replay is not null then return v_replay; end if;
  if p_assigned_to is not null then perform public.assignment_lineage_require_active_member(p_org_id, p_assigned_to); end if;

  select d.assigned_to, i.id into v_current, v_item
    from public.deals d
    join public.items i on i.org_id = d.org_id and i.deal_id = d.id and i.deleted_at is null
   where d.org_id = p_org_id and d.id = p_deal_id
     and i.board_id = p_board_id and i.id = p_item_id
   for update of d, i;
  if not found then raise exception 'assignment projection unavailable' using errcode = '42501'; end if;
  insert into public.assignment_lineage_state(org_id, deal_id, item_id, baseline_assignee_id, version)
  values (p_org_id, p_deal_id, v_item, v_current, 0)
  on conflict (deal_id) do nothing;
  select version into v_version from public.assignment_lineage_state
   where org_id = p_org_id and deal_id = p_deal_id and item_id = p_item_id for update;
  if not found then raise exception 'assignment projection unavailable' using errcode = '42501'; end if;
  if v_current is distinct from p_expected_assigned_to or v_version <> p_expected_version then
    raise exception 'assignment version conflict' using errcode = '40001';
  end if;

  if v_current is distinct from p_assigned_to then
    v_previous_version := v_version;
    update public.deals set assigned_to = p_assigned_to, updated_at = clock_timestamp()
     where org_id = p_org_id and id = p_deal_id;
    update public.items set assigned_to = p_assigned_to, updated_at = clock_timestamp()
     where org_id = p_org_id and id = v_item and deal_id = p_deal_id;
    v_projection_guard := current_setting('moawork.new_lead_projection_write', true);
    perform set_config('moawork.new_lead_projection_write', 'on', true);
    insert into public.item_values(org_id, item_id, column_key, value_jsonb)
    values (p_org_id, v_item, 'owner', case when p_assigned_to is null then to_jsonb('미정'::text) else to_jsonb(p_assigned_to) end)
    on conflict (item_id, column_key) do update
      set org_id = excluded.org_id, value_jsonb = excluded.value_jsonb;
    perform set_config('moawork.new_lead_projection_write', coalesce(v_projection_guard, ''), true);

    v_version := v_version + 1;
    update public.assignment_lineage_state set version = v_version, updated_at = clock_timestamp()
     where org_id = p_org_id and deal_id = p_deal_id and item_id = p_item_id;
    insert into public.assignment_transition_events(
      org_id, deal_id, item_id, sequence, from_user_id, to_user_id, actor_user_id, request_id
    ) values (p_org_id, p_deal_id, v_item, v_version, v_current, p_assigned_to, v_actor, p_request_id);

    select * into v_pending from public.assignment_pending_handoffs
     where org_id = p_org_id and deal_id = p_deal_id and status = 'pending' for update;
    if found then
      if v_pending.item_id = v_item
         and v_pending.from_user_id is not distinct from v_current
         and v_pending.to_user_id = p_assigned_to
         and v_pending.expected_version = v_previous_version then
        update public.assignment_pending_handoffs set status = 'executed', resolved_at = clock_timestamp() where id = v_pending.id;
      else
        update public.assignment_pending_handoffs set status = 'superseded', resolved_at = clock_timestamp() where id = v_pending.id;
      end if;
      insert into public.assignment_handoff_events(
        org_id, deal_id, item_id, handoff_id, event_type, from_user_id, to_user_id, actor_user_id, request_id
      ) values (p_org_id, p_deal_id, v_item, v_pending.id,
        case when v_pending.item_id = v_item
          and v_pending.from_user_id is not distinct from v_current
          and v_pending.to_user_id = p_assigned_to
          and v_pending.expected_version = v_previous_version
        then 'executed' else 'superseded' end,
        v_pending.from_user_id, v_pending.to_user_id, v_actor, p_request_id);
    end if;

    insert into public.notifications(
      org_id, user_id, type, title, body, target_type, target_id, actor_id, is_action, dedupe_key
    )
    select p_org_id, recipient.user_id, 'assignment_changed', '담당자가 변경되었습니다',
      '담당자 흐름에서 현재 배정과 알림 대상을 확인해 주세요.', 'board_item', v_item,
      v_actor, false, 'assignment:' || p_request_id::text
    from (
      select p_assigned_to as user_id where p_assigned_to is not null
      union
      select f.user_id from public.assignment_followers f where f.org_id = p_org_id and f.deal_id = p_deal_id
    ) recipient
    join public.org_members m on m.org_id = p_org_id and m.user_id = recipient.user_id and m.status = 'active'
    where recipient.user_id <> v_actor
    on conflict (org_id, user_id, dedupe_key) where dedupe_key is not null do nothing;
  end if;

  v_result := jsonb_build_object('accepted', true, 'replayed', false, 'version', v_version,
    'currentAssigneeId', p_assigned_to, 'itemId', v_item);
  insert into public.assignment_lineage_requests(org_id, request_id, actor_user_id, operation, payload, result)
  values (p_org_id, p_request_id, v_actor, 'reassign', v_payload, v_result);
  return v_result;
end;
$$;

create or replace function public.set_assignment_follower(
  p_org_id uuid,
  p_board_id uuid,
  p_deal_id uuid,
  p_item_id uuid,
  p_user_id uuid,
  p_follow boolean,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_actor uuid; v_payload jsonb; v_replay jsonb; v_result jsonb; v_version bigint;
begin
  v_actor := public.assignment_lineage_require_writer(p_org_id, p_board_id, p_deal_id, p_item_id);
  if p_user_id is null or p_follow is null then raise exception 'follower payload required' using errcode = '22023'; end if;
  v_payload := jsonb_build_object('boardId', p_board_id, 'dealId', p_deal_id, 'itemId', p_item_id,
    'userId', p_user_id, 'follow', p_follow);
  v_replay := public.assignment_lineage_replay(p_org_id, p_request_id, v_actor,
    case when p_follow then 'follower_add' else 'follower_remove' end, v_payload);
  if v_replay is not null then return v_replay; end if;
  if p_follow then perform public.assignment_lineage_require_active_member(p_org_id, p_user_id); end if;
  perform 1 from public.deals d
    join public.items i on i.org_id = d.org_id and i.deal_id = d.id and i.deleted_at is null
    where d.org_id = p_org_id and d.id = p_deal_id
      and i.board_id = p_board_id and i.id = p_item_id
    for update of d, i;
  if not found then raise exception 'assignment projection unavailable' using errcode = '42501'; end if;
  if p_follow then
    insert into public.assignment_followers(org_id, deal_id, user_id, added_by)
    values (p_org_id, p_deal_id, p_user_id, v_actor) on conflict do nothing;
  else
    delete from public.assignment_followers where org_id = p_org_id and deal_id = p_deal_id and user_id = p_user_id;
  end if;
  select coalesce(version, 0) into v_version from public.assignment_lineage_state
   where org_id = p_org_id and deal_id = p_deal_id and item_id = p_item_id;
  v_result := jsonb_build_object('accepted', true, 'replayed', false, 'version', coalesce(v_version, 0));
  insert into public.assignment_lineage_requests(org_id, request_id, actor_user_id, operation, payload, result)
  values (p_org_id, p_request_id, v_actor, case when p_follow then 'follower_add' else 'follower_remove' end, v_payload, v_result);
  return v_result;
end;
$$;

create or replace function public.schedule_assignment_handoff(
  p_org_id uuid,
  p_board_id uuid,
  p_deal_id uuid,
  p_item_id uuid,
  p_to_user_id uuid,
  p_expected_assigned_to uuid,
  p_expected_version bigint,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid; v_current uuid; v_item uuid; v_version bigint; v_handoff uuid := gen_random_uuid();
  v_payload jsonb; v_replay jsonb; v_result jsonb;
begin
  v_actor := public.assignment_lineage_require_writer(p_org_id, p_board_id, p_deal_id, p_item_id);
  if p_expected_version is null or p_expected_version < 0 then raise exception 'expected version required' using errcode = '22023'; end if;
  v_payload := jsonb_build_object('boardId', p_board_id, 'dealId', p_deal_id, 'itemId', p_item_id,
    'toUserId', p_to_user_id,
    'expectedAssignedTo', p_expected_assigned_to, 'expectedVersion', p_expected_version);
  v_replay := public.assignment_lineage_replay(p_org_id, p_request_id, v_actor, 'handoff_schedule', v_payload);
  if v_replay is not null then return v_replay; end if;
  perform public.assignment_lineage_require_active_member(p_org_id, p_to_user_id);
  select d.assigned_to, i.id into v_current, v_item from public.deals d
    join public.items i on i.org_id = d.org_id and i.deal_id = d.id and i.deleted_at is null
    where d.org_id = p_org_id and d.id = p_deal_id
      and i.board_id = p_board_id and i.id = p_item_id for update of d, i;
  if not found then raise exception 'assignment projection unavailable' using errcode = '42501'; end if;
  select coalesce(s.version, 0) into v_version from public.assignment_lineage_state s
   where s.org_id = p_org_id and s.deal_id = p_deal_id and s.item_id = p_item_id;
  v_version := coalesce(v_version, 0);
  if v_current is distinct from p_expected_assigned_to or v_version <> p_expected_version then
    raise exception 'assignment version conflict' using errcode = '40001';
  end if;
  if exists (select 1 from public.assignment_pending_handoffs where org_id = p_org_id and deal_id = p_deal_id and status = 'pending') then
    raise exception 'pending handoff already exists' using errcode = '40001';
  end if;
  insert into public.assignment_pending_handoffs(id, org_id, deal_id, item_id, from_user_id, to_user_id, created_by, expected_version)
  values (v_handoff, p_org_id, p_deal_id, v_item, v_current, p_to_user_id, v_actor, v_version);
  insert into public.assignment_handoff_events(org_id, deal_id, item_id, handoff_id, event_type, from_user_id, to_user_id, actor_user_id, request_id)
  values (p_org_id, p_deal_id, v_item, v_handoff, 'scheduled', v_current, p_to_user_id, v_actor, p_request_id);
  v_result := jsonb_build_object('accepted', true, 'replayed', false, 'version', v_version, 'handoffId', v_handoff);
  insert into public.assignment_lineage_requests(org_id, request_id, actor_user_id, operation, payload, result)
  values (p_org_id, p_request_id, v_actor, 'handoff_schedule', v_payload, v_result);
  return v_result;
end;
$$;

create or replace function public.cancel_assignment_handoff(
  p_org_id uuid,
  p_board_id uuid,
  p_deal_id uuid,
  p_item_id uuid,
  p_handoff_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid; v_row public.assignment_pending_handoffs%rowtype;
  v_payload jsonb; v_replay jsonb; v_result jsonb; v_version bigint;
begin
  v_actor := public.assignment_lineage_require_writer(p_org_id, p_board_id, p_deal_id, p_item_id);
  v_payload := jsonb_build_object('boardId', p_board_id, 'dealId', p_deal_id, 'itemId', p_item_id,
    'handoffId', p_handoff_id);
  v_replay := public.assignment_lineage_replay(p_org_id, p_request_id, v_actor, 'handoff_cancel', v_payload);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.deals d
    join public.items i on i.org_id = d.org_id and i.deal_id = d.id and i.deleted_at is null
    where d.org_id = p_org_id and d.id = p_deal_id
      and i.board_id = p_board_id and i.id = p_item_id
    for update of d, i;
  if not found then raise exception 'assignment projection unavailable' using errcode = '42501'; end if;
  select * into v_row from public.assignment_pending_handoffs
   where id = p_handoff_id and org_id = p_org_id and deal_id = p_deal_id
     and item_id = p_item_id and status = 'pending' for update;
  if not found then raise exception 'pending handoff unavailable' using errcode = '40001'; end if;
  update public.assignment_pending_handoffs set status = 'cancelled', resolved_at = clock_timestamp() where id = v_row.id;
  insert into public.assignment_handoff_events(org_id, deal_id, item_id, handoff_id, event_type, from_user_id, to_user_id, actor_user_id, request_id)
  values (p_org_id, p_deal_id, v_row.item_id, v_row.id, 'cancelled', v_row.from_user_id, v_row.to_user_id, v_actor, p_request_id);
  select coalesce(version, 0) into v_version from public.assignment_lineage_state
   where org_id = p_org_id and deal_id = p_deal_id and item_id = p_item_id;
  v_result := jsonb_build_object('accepted', true, 'replayed', false, 'version', coalesce(v_version, 0));
  insert into public.assignment_lineage_requests(org_id, request_id, actor_user_id, operation, payload, result)
  values (p_org_id, p_request_id, v_actor, 'handoff_cancel', v_payload, v_result);
  return v_result;
end;
$$;

create or replace function public.assignment_ledger_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'assignment ledger is append-only' using errcode = '55000';
end;
$$;
create trigger assignment_transition_immutable before update or delete on public.assignment_transition_events
  for each row execute function public.assignment_ledger_immutable();
create trigger assignment_handoff_event_immutable before update or delete on public.assignment_handoff_events
  for each row execute function public.assignment_ledger_immutable();
create trigger assignment_request_immutable before update or delete on public.assignment_lineage_requests
  for each row execute function public.assignment_ledger_immutable();

revoke all on table public.assignment_lineage_state, public.assignment_transition_events,
  public.assignment_followers, public.assignment_pending_handoffs,
  public.assignment_handoff_events, public.assignment_lineage_requests
  from public, anon, authenticated, service_role;
grant select on table public.assignment_lineage_state, public.assignment_transition_events,
  public.assignment_followers, public.assignment_pending_handoffs, public.assignment_handoff_events
  to authenticated;

revoke all on function public.assignment_lineage_can_read(uuid, uuid),
  public.assignment_lineage_require_writer(uuid, uuid, uuid, uuid),
  public.assignment_lineage_require_active_member(uuid, uuid),
  public.assignment_lineage_replay(uuid, uuid, uuid, text, jsonb),
  public.read_assignment_lineage(uuid, uuid, uuid, uuid),
  public.reassign_deal_with_lineage(uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid),
  public.set_assignment_follower(uuid, uuid, uuid, uuid, uuid, boolean, uuid),
  public.schedule_assignment_handoff(uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid),
  public.cancel_assignment_handoff(uuid, uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_assignment_lineage(uuid, uuid, uuid, uuid),
  public.assignment_lineage_can_read(uuid, uuid),
  public.reassign_deal_with_lineage(uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid),
  public.set_assignment_follower(uuid, uuid, uuid, uuid, uuid, boolean, uuid),
  public.schedule_assignment_handoff(uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid),
  public.cancel_assignment_handoff(uuid, uuid, uuid, uuid, uuid, uuid)
  to authenticated;

do $$
declare v_function regprocedure;
begin
  foreach v_function in array array[
    'public.assignment_lineage_can_read(uuid,uuid)'::regprocedure,
    'public.read_assignment_lineage(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.reassign_deal_with_lineage(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure,
    'public.set_assignment_follower(uuid,uuid,uuid,uuid,uuid,boolean,uuid)'::regprocedure,
    'public.schedule_assignment_handoff(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure,
    'public.cancel_assignment_handoff(uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure
  ] loop
    if exists (
      select 1 from information_schema.role_routine_grants
       where specific_schema = 'public'
         and routine_name = split_part(v_function::text, '(', 1)
         and grantee in ('PUBLIC', 'anon', 'service_role')
    ) then raise exception 'unsafe_issue599_rpc_acl'; end if;
  end loop;
end;
$$;
