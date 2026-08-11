-- BBE-104: stable status-label triggers and flat AND condition storage.
-- This migration defines rule data only. Execution, retry/idempotency, history,
-- and external delivery remain outside this boundary.

alter table public.board_automation_rules
  add column if not exists trigger_label_id text,
  add column if not exists conditions jsonb not null default '[]'::jsonb;

alter table public.board_automation_rules
  add constraint board_automation_trigger_label_id_check
    check (trigger_label_id is null or trigger_label_id ~ '^label:[A-Za-z0-9_-]+$'),
  add constraint board_automation_conditions_array_check
    check (jsonb_typeof(conditions) = 'array');

create unique index if not exists board_automation_rules_stable_trigger_unique
  on public.board_automation_rules(board_id, status_column_key, trigger_label_id)
  where trigger_label_id is not null;

create or replace function public.validate_automation_conditions(p_conditions jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
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

alter table public.board_automation_rules
  add constraint board_automation_conditions_shape_check
    check (public.validate_automation_conditions(conditions)),
  add constraint board_automation_conditional_trigger_check
    check (jsonb_array_length(conditions) = 0 or trigger_label_id is not null);

revoke all on function public.validate_automation_conditions(jsonb) from public, anon;
grant execute on function public.validate_automation_conditions(jsonb) to authenticated;

create or replace function public.validate_automation_rule_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.boards board
    where board.id = new.board_id
      and board.org_id = new.org_id
  ) then
    raise exception 'automation rule board must belong to its organization'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.board_groups board_group
    where board_group.id = new.to_group_id
      and board_group.board_id = new.board_id
  ) then
    raise exception 'automation rule target group must belong to its board'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_automation_rule_scope() from public, anon, authenticated;

create or replace function public.require_stable_automation_trigger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT'
    or new.status_column_key is distinct from old.status_column_key
    or new.status_value is distinct from old.status_value
    or new.trigger_label_id is distinct from old.trigger_label_id
    or new.conditions is distinct from old.conditions
  then
    if new.trigger_label_id is null then
      raise exception 'trigger_label_id is required for new or changed automation triggers'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.require_stable_automation_trigger() from public, anon, authenticated;

drop trigger if exists board_automation_validate_scope on public.board_automation_rules;
create trigger board_automation_validate_scope
  before insert or update on public.board_automation_rules
  for each row execute function public.validate_automation_rule_scope();

drop trigger if exists board_automation_require_stable_trigger on public.board_automation_rules;
create trigger board_automation_require_stable_trigger
  before insert or update on public.board_automation_rules
  for each row execute function public.require_stable_automation_trigger();
