-- BBE-104: stable-label triggers, AND conditions, action payloads, and evaluation audit.

alter table public.board_automation_rules
  add column if not exists trigger_label_id text,
  add column if not exists conditions jsonb not null default '[]'::jsonb,
  add column if not exists action jsonb;

alter table public.board_automation_rules
  add constraint board_automation_trigger_label_id_check
    check (trigger_label_id is null or trigger_label_id ~ '^label:[A-Za-z0-9_-]+$'),
  add constraint board_automation_conditions_array_check
    check (jsonb_typeof(conditions) = 'array'),
  add constraint board_automation_action_object_check
    check (action is null or jsonb_typeof(action) = 'object');

create unique index if not exists board_automation_rules_stable_trigger_unique
  on public.board_automation_rules(board_id, status_column_key, trigger_label_id)
  where trigger_label_id is not null;

create or replace function public.validate_automation_conditions(p_conditions jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(p_conditions) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(p_conditions) condition
      where jsonb_typeof(condition) <> 'object'
        or nullif(btrim(condition->>'column_key'), '') is null
        or condition->>'operator' not in ('is', 'is_not')
        or condition->>'value_kind' not in ('label_id', 'user_id', 'text')
        or nullif(condition->>'value', '') is null
        or (
          condition->>'value_kind' = 'label_id'
          and condition->>'value' !~ '^label:[A-Za-z0-9_-]+$'
        )
    );
$$;

create or replace function public.validate_automation_action(p_action jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_action is null or (
    jsonb_typeof(p_action) = 'object'
    and case p_action->>'kind'
      when 'move_group' then nullif(p_action->>'group_id', '') is not null
      when 'move_board' then nullif(p_action->>'board_id', '') is not null
        and nullif(p_action->>'group_id', '') is not null
        and jsonb_typeof(p_action->'field_mapping') = 'object'
      when 'set_field' then nullif(p_action->>'column_key', '') is not null
        and p_action ? 'value'
      when 'button' then p_action->>'command' = 'move_to_top'
      else false
    end
  );
$$;

alter table public.board_automation_rules
  add constraint board_automation_conditions_shape_check
    check (public.validate_automation_conditions(conditions)),
  add constraint board_automation_action_shape_check
    check (public.validate_automation_action(action)),
  add constraint board_automation_conditional_trigger_check
    check (jsonb_array_length(conditions) = 0 or trigger_label_id is not null);

create table if not exists public.board_automation_evaluations (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  rule_id uuid not null references public.board_automation_rules(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  outcome text not null check (outcome in ('executed', 'skipped')),
  blocked_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check (jsonb_typeof(blocked_reasons) = 'array'),
  check (
    (outcome = 'executed' and jsonb_array_length(blocked_reasons) = 0)
    or (outcome = 'skipped' and jsonb_array_length(blocked_reasons) > 0)
  )
);

create index if not exists board_automation_evaluations_rule_created_idx
  on public.board_automation_evaluations(rule_id, created_at desc);

alter table public.board_automation_evaluations enable row level security;
create policy board_automation_evaluations_read on public.board_automation_evaluations
  for select to authenticated using (public.is_org_member(org_id));

revoke all on public.board_automation_evaluations from public, anon, authenticated;
grant select on public.board_automation_evaluations to authenticated;

create or replace function public.record_board_automation_evaluation(
  p_org_id uuid,
  p_rule_id uuid,
  p_item_id uuid,
  p_outcome text,
  p_blocked_reasons jsonb default '[]'::jsonb
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  if p_outcome not in ('executed', 'skipped')
    or jsonb_typeof(p_blocked_reasons) <> 'array'
    or (p_outcome = 'executed' and jsonb_array_length(p_blocked_reasons) <> 0)
    or (p_outcome = 'skipped' and jsonb_array_length(p_blocked_reasons) = 0)
    or not exists (
      select 1 from public.board_automation_rules rule
      join public.items item on item.id = p_item_id and item.org_id = p_org_id
      where rule.id = p_rule_id and rule.org_id = p_org_id and rule.board_id = item.board_id
    )
  then raise exception 'invalid automation evaluation' using errcode = '22023';
  end if;
  insert into public.board_automation_evaluations(org_id, rule_id, item_id, outcome, blocked_reasons)
    values(p_org_id, p_rule_id, p_item_id, p_outcome, p_blocked_reasons)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.validate_automation_conditions(jsonb),
  public.validate_automation_action(jsonb) from public, anon, authenticated;
revoke all on function public.record_board_automation_evaluation(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_board_automation_evaluation(uuid, uuid, uuid, text, jsonb)
  to service_role;
