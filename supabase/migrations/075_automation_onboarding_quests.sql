-- BBE-113: derive company-specific onboarding quests from automation rules.
-- 075 is provisional until the BBE-115 (073) and BBE-30 successor (074)
-- migrations are merged. Reconfirm latest+1 before publishing this branch.

alter table public.board_automation_rules
  add column if not exists onboarding_why text;

create table public.onboarding_automation_quests (
  rule_id uuid primary key references public.board_automation_rules(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  quest_key text not null check (quest_key ~ '^automation-rule:[0-9a-f-]{36}$'),
  title text not null,
  description text,
  why text,
  judge_params jsonb not null check (jsonb_typeof(judge_params) = 'object'),
  rule_fingerprint text not null,
  pipeline_order integer not null,
  hidden boolean not null default false,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, quest_key)
);

create index onboarding_automation_quests_org_order_idx
  on public.onboarding_automation_quests(org_id, pipeline_order, quest_key);

alter table public.onboarding_automation_quests enable row level security;
revoke all on table public.onboarding_automation_quests from public, anon, authenticated;

create policy onboarding_automation_quests_select
  on public.onboarding_automation_quests for select
  to authenticated
  using (public.is_org_member(org_id));

grant select on table public.onboarding_automation_quests to authenticated;

create or replace function public.reconcile_automation_onboarding_quest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_column_label text;
  v_column_order integer;
  v_target_name text;
  v_target_order integer;
  v_fingerprint text;
  v_changed integer := 0;
begin
  select column_def.label, column_def.sort_order
    into v_column_label, v_column_order
    from public.board_columns column_def
   where column_def.org_id = new.org_id
     and column_def.board_id = new.board_id
     and column_def.key = new.status_column_key;

  select target_group.name, target_group.sort_order
    into v_target_name, v_target_order
    from public.board_groups target_group
   where target_group.id = new.to_group_id
     and target_group.org_id = new.org_id
     and target_group.board_id = new.board_id;
  if not found then
    raise exception 'automation target group unavailable' using errcode = '23514';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'boardId', new.board_id,
    'statusColumnKey', new.status_column_key,
    'statusValue', new.status_value,
    'triggerLabelId', new.trigger_label_id,
    'conditions', new.conditions,
    'targetGroupId', new.to_group_id,
    'enabled', new.enabled
  )::text);

  insert into public.onboarding_automation_quests (
    rule_id, org_id, board_id, quest_key, title, description, why,
    judge_params, rule_fingerprint, pipeline_order, synced_at, updated_at
  ) values (
    new.id,
    new.org_id,
    new.board_id,
    'automation-rule:' || new.id::text,
    coalesce(v_column_label, new.status_column_key) || '을(를) “' || new.status_value || '” 상태로 바꾸기',
    new.status_value || ' 상태가 되면 ' || v_target_name || ' 단계로 자동 이동해요.',
    nullif(btrim(new.onboarding_why), ''),
    jsonb_build_object(
      'ruleId', new.id,
      'boardId', new.board_id,
      'statusColumnKey', new.status_column_key,
      'triggerLabelId', new.trigger_label_id,
      'targetGroupId', new.to_group_id
    ),
    v_fingerprint,
    (v_target_order * 1000) + coalesce(v_column_order, 0),
    now(),
    coalesce(new.created_at, now())
  )
  on conflict (rule_id) do update set
    org_id = excluded.org_id,
    board_id = excluded.board_id,
    quest_key = excluded.quest_key,
    title = excluded.title,
    description = excluded.description,
    why = excluded.why,
    judge_params = excluded.judge_params,
    rule_fingerprint = excluded.rule_fingerprint,
    pipeline_order = excluded.pipeline_order,
    synced_at = excluded.synced_at,
    updated_at = case
      when public.onboarding_automation_quests.rule_fingerprint is distinct from excluded.rule_fingerprint
        then excluded.synced_at
      else public.onboarding_automation_quests.updated_at
    end
  where (
    public.onboarding_automation_quests.org_id,
    public.onboarding_automation_quests.board_id,
    public.onboarding_automation_quests.quest_key,
    public.onboarding_automation_quests.title,
    public.onboarding_automation_quests.description,
    public.onboarding_automation_quests.why,
    public.onboarding_automation_quests.judge_params,
    public.onboarding_automation_quests.rule_fingerprint,
    public.onboarding_automation_quests.pipeline_order
  ) is distinct from (
    excluded.org_id,
    excluded.board_id,
    excluded.quest_key,
    excluded.title,
    excluded.description,
    excluded.why,
    excluded.judge_params,
    excluded.rule_fingerprint,
    excluded.pipeline_order
  );

  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    insert into public.audit_logs(org_id, actor, action, target_type, target_id, meta)
    values (
      new.org_id,
      auth.uid(),
      'onboarding.automation_quest_generated',
      'automation_rule',
      new.id,
      jsonb_build_object('enabled', new.enabled)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.reconcile_automation_onboarding_quest()
  from public, anon, authenticated;

create trigger reconcile_automation_onboarding_quest_after_write
after insert or update of board_id, status_column_key, status_value,
  trigger_label_id, conditions, to_group_id, enabled, onboarding_why
on public.board_automation_rules
for each row execute function public.reconcile_automation_onboarding_quest();

create or replace function public.sync_my_automation_onboarding_quests(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_changed integer := 0;
begin
  if v_actor is null or p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'organization unavailable' using errcode = '42501';
  end if;

  insert into public.onboarding_automation_quests (
    rule_id, org_id, board_id, quest_key, title, description, why,
    judge_params, rule_fingerprint, pipeline_order, synced_at, updated_at
  )
  select
    rule.id,
    rule.org_id,
    rule.board_id,
    'automation-rule:' || rule.id::text,
    coalesce(column_def.label, rule.status_column_key) || '을(를) “' || rule.status_value || '” 상태로 바꾸기',
    rule.status_value || ' 상태가 되면 ' || target_group.name || ' 단계로 자동 이동해요.',
    nullif(btrim(rule.onboarding_why), ''),
    jsonb_build_object(
      'ruleId', rule.id,
      'boardId', rule.board_id,
      'statusColumnKey', rule.status_column_key,
      'triggerLabelId', rule.trigger_label_id,
      'targetGroupId', rule.to_group_id
    ),
    md5(jsonb_build_object(
      'boardId', rule.board_id,
      'statusColumnKey', rule.status_column_key,
      'statusValue', rule.status_value,
      'triggerLabelId', rule.trigger_label_id,
      'conditions', rule.conditions,
      'targetGroupId', rule.to_group_id,
      'enabled', rule.enabled
    )::text),
    (target_group.sort_order * 1000) + coalesce(column_def.sort_order, 0),
    now(),
    coalesce(rule.created_at, now())
  from public.board_automation_rules rule
  join public.board_groups target_group
    on target_group.id = rule.to_group_id
   and target_group.board_id = rule.board_id
   and target_group.org_id = rule.org_id
  left join public.board_columns column_def
    on column_def.board_id = rule.board_id
   and column_def.org_id = rule.org_id
   and column_def.key = rule.status_column_key
  where rule.org_id = p_org_id
  on conflict (rule_id) do update set
    org_id = excluded.org_id,
    board_id = excluded.board_id,
    quest_key = excluded.quest_key,
    title = excluded.title,
    description = excluded.description,
    why = excluded.why,
    judge_params = excluded.judge_params,
    rule_fingerprint = excluded.rule_fingerprint,
    pipeline_order = excluded.pipeline_order,
    synced_at = excluded.synced_at,
    updated_at = case
      when public.onboarding_automation_quests.rule_fingerprint is distinct from excluded.rule_fingerprint
        then excluded.synced_at
      else public.onboarding_automation_quests.updated_at
    end
  where (
    public.onboarding_automation_quests.org_id,
    public.onboarding_automation_quests.board_id,
    public.onboarding_automation_quests.quest_key,
    public.onboarding_automation_quests.title,
    public.onboarding_automation_quests.description,
    public.onboarding_automation_quests.why,
    public.onboarding_automation_quests.judge_params,
    public.onboarding_automation_quests.rule_fingerprint,
    public.onboarding_automation_quests.pipeline_order
  ) is distinct from (
    excluded.org_id,
    excluded.board_id,
    excluded.quest_key,
    excluded.title,
    excluded.description,
    excluded.why,
    excluded.judge_params,
    excluded.rule_fingerprint,
    excluded.pipeline_order
  );

  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    insert into public.audit_logs(org_id, actor, action, target_type, meta)
    values (
      p_org_id,
      v_actor,
      'onboarding.automation_quests_synced',
      'organization',
      jsonb_build_object('changedCount', v_changed)
    );
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'questKey', quest.quest_key,
      'ruleId', quest.rule_id,
      'title', quest.title,
      'description', quest.description,
      'why', quest.why,
      'judgeParams', quest.judge_params,
      'sortOrder', quest.pipeline_order,
      'hidden', quest.hidden or not rule.enabled,
      'completed', exists (
        select 1
        from public.board_automation_execution_requests execution
        where execution.org_id = quest.org_id
          and execution.rule_id = quest.rule_id
          and execution.state = 'succeeded'
          and execution.terminal_at >= quest.updated_at
      )
    ) order by quest.pipeline_order, quest.quest_key)
    from public.onboarding_automation_quests quest
    join public.board_automation_rules rule on rule.id = quest.rule_id
    where quest.org_id = p_org_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.sync_my_automation_onboarding_quests(uuid)
  from public, anon, authenticated;
grant execute on function public.sync_my_automation_onboarding_quests(uuid)
  to authenticated;

create or replace function public.update_my_automation_onboarding_quest(
  p_org_id uuid,
  p_rule_id uuid,
  p_hidden boolean,
  p_why text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null
    or p_org_id is null
    or p_rule_id is null
    or p_hidden is null
    or public.org_role(p_org_id) not in ('owner', 'admin')
  then
    raise exception 'quest management unavailable' using errcode = '42501';
  end if;

  update public.board_automation_rules rule
     set onboarding_why = nullif(btrim(p_why), '')
   where rule.id = p_rule_id and rule.org_id = p_org_id;
  if not found then
    raise exception 'automation rule unavailable' using errcode = 'P0002';
  end if;

  v_result := public.sync_my_automation_onboarding_quests(p_org_id);

  update public.onboarding_automation_quests quest
     set hidden = p_hidden,
         synced_at = now()
   where quest.rule_id = p_rule_id and quest.org_id = p_org_id;
  if not found then
    raise exception 'automation quest unavailable' using errcode = 'P0002';
  end if;

  insert into public.audit_logs(org_id, actor, action, target_type, target_id, meta)
  values (
    p_org_id,
    v_actor,
    'onboarding.automation_quest_preferences_updated',
    'automation_rule',
    p_rule_id,
    jsonb_build_object('hidden', p_hidden, 'hasWhy', nullif(btrim(p_why), '') is not null)
  );

  return jsonb_build_object('updated', true, 'questCount', jsonb_array_length(v_result));
end;
$$;

revoke all on function public.update_my_automation_onboarding_quest(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.update_my_automation_onboarding_quest(uuid, uuid, boolean, text)
  to authenticated;
