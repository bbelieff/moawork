-- moa-migration-guard: logical_key=117_bbe237_company_start_work predecessor=116_bbe225_workspace_entry_pure_read digest=c35661310aa0c994cfac3b4082c4b69113f72298dfc1262552758c9ff611c4ba foundation=false

select public.begin_guarded_migration(
  p_logical_key => '117_bbe237_company_start_work',
  p_file_name => '117_bbe237_company_start_work.sql',
  p_file_digest => 'c35661310aa0c994cfac3b4082c4b69113f72298dfc1262552758c9ff611c4ba',
  p_expected_predecessor => '116_bbe225_workspace_entry_pure_read',
  p_executor => 'DG-07',
  p_thread_id => '01a02046-57fc-7141-bb41-ccf13704b618',
  p_foundation => false
);

create table if not exists public.company_work_start_requests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (org_id, request_id),
  unique (org_id, deal_id),
  unique (org_id, item_id)
);

alter table public.company_work_start_requests enable row level security;
revoke all on table public.company_work_start_requests from public, anon, authenticated, service_role;

create policy company_work_start_requests_read on public.company_work_start_requests
  for select to authenticated
  using (
    actor_id = (select auth.uid())
    and public.is_org_member(org_id)
  );

create or replace function public.start_company_work(
  p_org_id uuid,
  p_company_id uuid,
  p_request_id uuid
) returns table(deal_id uuid, item_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_company public.companies%rowtype;
  v_pipeline uuid;
  v_stage uuid;
  v_board uuid;
  v_group uuid;
  v_deal uuid;
  v_item uuid;
  v_payload jsonb;
  v_prior public.company_work_start_requests%rowtype;
begin
  if v_actor is null or p_request_id is null or p_company_id is null then
    raise exception 'company work start input required' using errcode = '22023';
  end if;

  select m.role::text, m.scope::text
    into v_role, v_scope
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id
     and m.user_id = v_actor
     and m.status = 'active'
     and o.status = 'active';
  if not found or not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'company work start permission denied' using errcode = '42501';
  end if;

  select c.* into v_company
    from public.companies c
   where c.id = p_company_id
     and c.org_id = p_org_id
     and c.merged_into is null
     and (v_role in ('owner', 'admin') or v_scope = 'all' or c.assigned_to = v_actor);
  if not found then
    raise exception 'company unavailable' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object('company_id', p_company_id);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));
  select r.* into v_prior
    from public.company_work_start_requests r
   where r.org_id = p_org_id and r.request_id = p_request_id;
  if found then
    if v_prior.actor_id <> v_actor or v_prior.company_id <> p_company_id or v_prior.payload <> v_payload then
      raise exception 'company work start idempotency key reuse' using errcode = '22023';
    end if;
    return query select v_prior.deal_id, v_prior.item_id, true;
    return;
  end if;

  select s.pipeline_id, s.id into v_pipeline, v_stage
    from public.stages s
    join public.pipelines p on p.id = s.pipeline_id
   where p.org_id = p_org_id
   order by p.id, s.sort_order, s.id
   limit 1;
  if v_stage is null then
    raise exception 'deal pipeline unavailable' using errcode = '22023';
  end if;

  select b.id into v_board
    from public.boards b
   where b.org_id = p_org_id and b.source = 'core.default-tab/contract-work'
   order by b.id limit 1;
  if v_board is null then
    raise exception 'contract work board unavailable' using errcode = '22023';
  end if;
  select g.id into v_group
    from public.board_groups g
   where g.org_id = p_org_id and g.board_id = v_board
   order by g.sort_order, g.id limit 1;

  insert into public.deals(org_id, company_id, pipeline_id, stage_id, assigned_to, title)
  values (p_org_id, p_company_id, v_pipeline, v_stage, coalesce(v_company.assigned_to, v_actor), v_company.name)
  returning id into v_deal;

  insert into public.items(org_id, board_id, group_id, title, assigned_to, deal_id)
  values (p_org_id, v_board, v_group, v_company.name, coalesce(v_company.assigned_to, v_actor), v_deal)
  returning id into v_item;

  insert into public.company_work_start_requests(org_id, request_id, company_id, actor_id, deal_id, item_id, payload)
  values (p_org_id, p_request_id, p_company_id, v_actor, v_deal, v_item, v_payload);
  insert into public.audit_logs(org_id, actor, action, target_type, target_id, meta)
  values (p_org_id, v_actor, 'company.work_started', 'deal', v_deal,
    jsonb_build_object('request_id', p_request_id, 'company_id', p_company_id, 'item_id', v_item));

  return query select v_deal, v_item, false;
end;
$$;

revoke all on function public.start_company_work(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.start_company_work(uuid, uuid, uuid) to authenticated;

comment on function public.start_company_work(uuid, uuid, uuid) is
  'BBE-237 explicit company-only to work start. Atomically creates one deal and one contract-work item; request replay returns the same result.';
