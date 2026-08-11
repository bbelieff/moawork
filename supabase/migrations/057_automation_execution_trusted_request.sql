-- BBE-20 P0: only a trusted server-side producer may create a request.
-- The worker receives an opaque key and this single transaction recomputes
-- current state before it moves an item.  No current product producer exists.

create table public.board_automation_execution_requests (
  execution_key text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  rule_id uuid not null references public.board_automation_rules(id) on delete cascade,
  from_group_id uuid references public.board_groups(id) on delete set null,
  source_column_key text not null,
  source_label_id text not null,
  visited_rule_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(visited_rule_ids) = 'array'),
  state text not null default 'pending' check (state in ('pending', 'succeeded', 'blocked', 'failed')),
  outcome jsonb,
  terminal_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.board_automation_execution_requests enable row level security;
revoke all on table public.board_automation_execution_requests from public, anon, authenticated;
grant select, insert, update on table public.board_automation_execution_requests to service_role;

create or replace function public.automation_condition_matches(p_value jsonb, p_condition jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_value is null
      or p_value = 'null'::jsonb
      or jsonb_typeof(p_value) <> 'object'
      or p_condition is null
      or p_condition = 'null'::jsonb
      or p_condition->>'operator' not in ('is', 'is_not')
      or p_condition->>'value_kind' not in ('label_id', 'user_id', 'text')
    then false
    when p_condition->>'value_kind' = 'label_id' and nullif(p_value->>'label_id', '') is null then false
    when p_condition->>'value_kind' = 'user_id' and nullif(p_value->>'user_id', '') is null then false
    when p_condition->>'value_kind' = 'text' and nullif(coalesce(p_value->>'value', p_value #>> '{}'), '') is null then false
    when p_condition->>'operator' = 'is' then case p_condition->>'value_kind'
      when 'label_id' then p_value->>'label_id' = p_condition->>'value'
      when 'user_id' then p_value->>'user_id' = p_condition->>'value'
      when 'text' then coalesce(p_value->>'value', p_value #>> '{}') = p_condition->>'value'
    end
    else not (case p_condition->>'value_kind'
      when 'label_id' then p_value->>'label_id' = p_condition->>'value'
      when 'user_id' then p_value->>'user_id' = p_condition->>'value'
      when 'text' then coalesce(p_value->>'value', p_value #>> '{}') = p_condition->>'value'
    end)
  end
$$;

create or replace function public.execute_trusted_board_automation(p_execution_key text)
returns table(status text, error_code text, visited_rule_ids jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.board_automation_execution_requests%rowtype;
  rule_row public.board_automation_rules%rowtype;
  status_value jsonb;
  next_trace jsonb;
  result jsonb;
  failure_code text;
begin
  if nullif(btrim(p_execution_key), '') is null then
    return query select 'rejected'::text, 'malformed'::text, '[]'::jsonb;
    return;
  end if;

  select * into request_row
  from public.board_automation_execution_requests
  where execution_key = p_execution_key
  for update;
  if not found then
    return query select 'rejected'::text, 'missing'::text, '[]'::jsonb;
    return;
  end if;
  if request_row.state <> 'pending' then
    return query select 'duplicate'::text, coalesce(request_row.outcome->>'error_code', request_row.state), request_row.visited_rule_ids;
    return;
  end if;

  begin
    select rule.* into rule_row
    from public.board_automation_rules rule
    join public.items item on item.id = request_row.item_id
    join public.board_groups target on target.id = rule.to_group_id
    where rule.id = request_row.rule_id
      and rule.enabled
      and rule.org_id = request_row.org_id
      and item.org_id = request_row.org_id
      and item.board_id = rule.board_id
      and target.org_id = request_row.org_id
      and target.board_id = rule.board_id;
    if not found then
      raise exception 'trusted automation scope is no longer valid' using errcode = '23514';
    end if;

    select value_jsonb into status_value
    from public.item_values
    where item_id = request_row.item_id and org_id = request_row.org_id
      and column_key = rule_row.status_column_key;
    if request_row.visited_rule_ids ? rule_row.id::text
      or jsonb_array_length(request_row.visited_rule_ids) >= 32
    then
      result := jsonb_build_object('status', 'blocked', 'error_code', 'automation_loop_blocked');
      update public.board_automation_execution_requests
        set state = 'blocked', outcome = result, terminal_at = now()
        where execution_key = request_row.execution_key;
      return query select 'blocked'::text, 'automation_loop_blocked'::text, request_row.visited_rule_ids;
      return;
    end if;

    if request_row.source_column_key is distinct from rule_row.status_column_key
      or request_row.source_label_id is distinct from rule_row.trigger_label_id
      or coalesce(status_value->>'label_id', '') is distinct from rule_row.trigger_label_id
      or exists (
        select 1
        from jsonb_array_elements(rule_row.conditions) condition
        left join lateral (
          select value_jsonb from public.item_values
          where item_id = request_row.item_id and org_id = request_row.org_id
            and column_key = condition->>'column_key'
        ) current_value on true
        where not public.automation_condition_matches(current_value.value_jsonb, condition)
      )
    then
      next_trace := request_row.visited_rule_ids;
      result := jsonb_build_object('status', 'blocked', 'error_code', 'status_or_condition_not_current');
      update public.board_automation_execution_requests
        set state = 'blocked', outcome = result, terminal_at = now()
        where execution_key = request_row.execution_key;
      return query select 'blocked'::text, 'status_or_condition_not_current'::text, next_trace;
      return;
    end if;

    next_trace := request_row.visited_rule_ids || jsonb_build_array(rule_row.id::text);
    update public.items
      set group_id = rule_row.to_group_id, updated_at = now()
      where id = request_row.item_id and org_id = request_row.org_id
        and board_id = rule_row.board_id
        and group_id is not distinct from request_row.from_group_id;
    if not found then
      raise exception 'automation item group changed before execution' using errcode = '40001';
    end if;

    result := jsonb_build_object('status', 'succeeded');
    update public.board_automation_execution_requests
      set state = 'succeeded', outcome = result, terminal_at = now(), visited_rule_ids = next_trace
      where execution_key = request_row.execution_key;
    return query select 'succeeded'::text, null::text, next_trace;
  exception when others then
    get stacked diagnostics failure_code = returned_sqlstate;
    update public.board_automation_execution_requests
      set state = 'failed', outcome = jsonb_build_object('status', 'failed', 'error_code', failure_code), terminal_at = now()
      where execution_key = request_row.execution_key;
    return query select 'failed'::text, failure_code, request_row.visited_rule_ids;
  end;
end;
$$;

-- Disable the old RPCs that trusted queue-supplied tenant and move fields.
revoke execute on function public.execute_board_automation_move(text, uuid, uuid, uuid, uuid, uuid, jsonb) from service_role;
revoke execute on function public.record_board_automation_blocked(text, uuid, uuid, uuid, jsonb, jsonb) from service_role;
revoke all on function public.automation_condition_matches(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.execute_trusted_board_automation(text) from public, anon, authenticated;
grant execute on function public.execute_trusted_board_automation(text) to service_role;
