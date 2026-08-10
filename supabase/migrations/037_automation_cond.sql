-- BBE-104: stable-label triggers and flat AND condition storage.
-- Execution, retries, and history belong to BBE-20 (GT09).

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

alter table public.board_automation_rules
  add constraint board_automation_conditions_shape_check
    check (public.validate_automation_conditions(conditions)),
  add constraint board_automation_conditional_trigger_check
    check (jsonb_array_length(conditions) = 0 or trigger_label_id is not null);

revoke all on function public.validate_automation_conditions(jsonb)
  from public, anon, authenticated;
