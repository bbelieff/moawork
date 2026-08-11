-- BBE-20: atomic automation execution, idempotency, history and loop trace.
-- GT04 owns condition evaluation and board_automation_rules shape (042).

create table if not exists public.board_automation_execution_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  execution_key text not null,
  rule_id uuid references public.board_automation_rules(id) on delete set null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'blocked')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  unique (execution_key, rule_id)
);

create table if not exists public.board_automation_executions (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid references public.board_automation_execution_claims(id) on delete set null,
  org_id uuid not null references public.orgs(id) on delete cascade,
  execution_key text not null,
  rule_id uuid references public.board_automation_rules(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'blocked')),
  visited_rule_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(visited_rule_ids) = 'array'),
  blocked_reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(blocked_reasons) = 'array'),
  error_code text,
  attempt_count integer not null default 1 check (attempt_count > 0),
  attempted_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists board_automation_executions_org_attempted_idx
  on public.board_automation_executions(org_id, attempted_at desc);

alter table public.board_automation_executions enable row level security;
alter table public.board_automation_execution_claims enable row level security;

create or replace function public.execute_board_automation_move(
  p_execution_key text,
  p_org_id uuid,
  p_rule_id uuid,
  p_item_id uuid,
  p_from_group_id uuid,
  p_to_group_id uuid,
  p_visited_rule_ids jsonb default '[]'::jsonb
)
returns table(status text, error_code text, visited_rule_ids jsonb)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  claimed_id uuid;
  history_id uuid;
  current_attempt integer;
  next_trace jsonb;
  failure_code text;
begin
  if nullif(btrim(p_execution_key), '') is null
    or jsonb_typeof(p_visited_rule_ids) <> 'array'
  then
    raise exception 'invalid automation execution input' using errcode = '22023';
  end if;

  if p_visited_rule_ids ? p_rule_id::text
    or jsonb_array_length(p_visited_rule_ids) >= 32
  then
    insert into public.board_automation_executions (
      org_id, execution_key, rule_id, item_id, status, visited_rule_ids,
      blocked_reasons, error_code, finished_at
    ) values (
      p_org_id, p_execution_key, p_rule_id, p_item_id, 'blocked',
      p_visited_rule_ids, '["automation_loop_blocked"]'::jsonb,
      'automation_loop_blocked', now()
    );
    return query select 'blocked'::text, 'automation_loop_blocked'::text, p_visited_rule_ids;
    return;
  end if;

  next_trace := p_visited_rule_ids || jsonb_build_array(p_rule_id::text);
  insert into public.board_automation_execution_claims (
    org_id, execution_key, rule_id, status
  ) values (
    p_org_id, p_execution_key, p_rule_id, 'running'
  ) on conflict (execution_key, rule_id) do update
    set status = 'running',
        attempt_count = public.board_automation_execution_claims.attempt_count + 1
    where public.board_automation_execution_claims.status = 'failed'
  returning id, attempt_count into claimed_id, current_attempt;

  if claimed_id is null then
    return query select 'duplicate'::text, 'automation_duplicate'::text, next_trace;
    return;
  end if;

  insert into public.board_automation_executions (
    claim_id, org_id, execution_key, rule_id, item_id, status,
    visited_rule_ids, attempt_count
  ) values (
    claimed_id, p_org_id, p_execution_key, p_rule_id, p_item_id, 'running',
    next_trace, current_attempt
  ) returning id into history_id;

  begin
    if not exists (
      select 1 from public.board_automation_rules rule
      join public.items item on item.id = p_item_id
      join public.board_groups target on target.id = p_to_group_id
      where rule.id = p_rule_id
        and rule.enabled
        and rule.org_id = p_org_id
        and item.org_id = p_org_id
        and item.board_id = rule.board_id
        and target.board_id = rule.board_id
        and rule.to_group_id = p_to_group_id
    ) then
      raise exception 'automation decision is stale or outside its organization'
        using errcode = '23514';
    end if;

    update public.items
    set group_id = p_to_group_id, updated_at = now()
    where id = p_item_id
      and org_id = p_org_id
      and group_id is not distinct from p_from_group_id;
    if not found then
      raise exception 'automation item group changed before execution'
        using errcode = '40001';
    end if;

    update public.board_automation_executions
    set status = 'succeeded', finished_at = now()
    where id = history_id;
    update public.board_automation_execution_claims
    set status = 'succeeded'
    where id = claimed_id;
    return query select 'succeeded'::text, null::text, next_trace;
  exception when others then
    get stacked diagnostics failure_code = returned_sqlstate;
    update public.board_automation_executions
    set status = 'failed', error_code = failure_code, finished_at = now()
    where id = history_id;
    update public.board_automation_execution_claims
    set status = 'failed'
    where id = claimed_id;
    return query select 'failed'::text, failure_code, next_trace;
  end;
end;
$$;

create or replace function public.record_board_automation_blocked(
  p_execution_key text,
  p_org_id uuid,
  p_rule_id uuid,
  p_item_id uuid,
  p_blocked_reasons jsonb,
  p_visited_rule_ids jsonb default '[]'::jsonb
)
returns table(status text, error_code text, visited_rule_ids jsonb)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p_blocked_reasons) <> 'array'
    or jsonb_typeof(p_visited_rule_ids) <> 'array'
  then
    raise exception 'invalid automation block record' using errcode = '22023';
  end if;
  insert into public.board_automation_executions (
    org_id, execution_key, rule_id, item_id, status, visited_rule_ids,
    blocked_reasons, finished_at
  ) values (
    p_org_id, p_execution_key, p_rule_id, p_item_id, 'blocked', p_visited_rule_ids,
    p_blocked_reasons, now()
  );
  return query select 'blocked'::text, null::text, p_visited_rule_ids;
end;
$$;

revoke all on table public.board_automation_executions from public, anon, authenticated;
revoke all on table public.board_automation_execution_claims from public, anon, authenticated;
revoke all on function public.execute_board_automation_move(text, uuid, uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_board_automation_blocked(text, uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant select, insert, update on table public.board_automation_executions to service_role;
grant select, insert, update on table public.board_automation_execution_claims to service_role;
grant execute on function public.execute_board_automation_move(text, uuid, uuid, uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.record_board_automation_blocked(text, uuid, uuid, uuid, jsonb, jsonb)
  to service_role;
