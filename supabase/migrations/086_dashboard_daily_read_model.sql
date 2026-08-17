-- BBE-185: one request-scoped, tenant-bound snapshot for the V6 home.
-- Sources are deliberately limited to product-owned boards and canonical notifications.
create or replace function public.read_today_dashboard(
  p_org_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_today date := (p_as_of at time zone 'Asia/Seoul')::date;
  v_month_start date := date_trunc('month', p_as_of at time zone 'Asia/Seoul')::date;
  v_month_end date := (date_trunc('month', p_as_of at time zone 'Asia/Seoul') + interval '1 month')::date;
  v_missing text[] := array[]::text[];
  v_kpis jsonb;
  v_tasks jsonb;
  v_notifications jsonb;
  v_action_count integer;
begin
  if v_actor is null or p_org_id is null or p_as_of is null then
    raise exception 'authenticated dashboard request required' using errcode = '42501';
  end if;

  select membership.role::text, membership.scope::text
    into v_role, v_scope
    from public.org_members membership
    join public.orgs organization on organization.id = membership.org_id
   where membership.org_id = p_org_id
     and membership.user_id = v_actor
     and membership.status = 'active'
     and organization.status = 'active';
  if not found then
    raise exception 'active organization membership required' using errcode = '42501';
  end if;
  if not public.effective_permission(p_org_id, 'work.view_tabs') then
    raise exception 'dashboard read permission required' using errcode = '42501';
  end if;

  if not exists (select 1 from public.boards where org_id = p_org_id and source = 'core.default-tab/new-lead') then
    v_missing := array_append(v_missing, 'new-lead');
  end if;
  if not exists (select 1 from public.boards where org_id = p_org_id and source = 'core.default-tab/contact') then
    v_missing := array_append(v_missing, 'contact');
  end if;
  if not exists (select 1 from public.boards where org_id = p_org_id and source = 'core.default-tab/contract-work') then
    v_missing := array_append(v_missing, 'work');
  end if;

  with visible_items as (
    select item.*, board.source
      from public.items item
      join public.boards board on board.id = item.board_id and board.org_id = item.org_id
     where item.org_id = p_org_id
       and board.source in ('core.default-tab/new-lead','core.default-tab/contact','core.default-tab/contract-work')
       and (v_role in ('owner','admin') or v_scope = 'all' or item.assigned_to = v_actor)
  ), values_typed as (
    select visible.id, visible.source, visible.assigned_to,
      max(case when value.column_key = 'meeting_at' then value.value_jsonb #>> '{}' end) as meeting_at,
      max(case when value.column_key = 'recall_at' then value.value_jsonb #>> '{}' end) as recall_at,
      max(case when value.column_key = 'recontact_on' then value.value_jsonb #>> '{}' end) as recontact_on,
      max(case when value.column_key = 'contract_status' then value.value_jsonb #>> '{}' end) as contract_status,
      max(case when value.column_key = 'work_move' then value.value_jsonb #>> '{}' end) as work_move,
      max(case when value.column_key = 'contract_deposit' then value.value_jsonb #>> '{}' end) as deposit,
      max(case when value.column_key = 'contract_deposit_paid_on' then value.value_jsonb #>> '{}' end) as deposit_paid_on,
      max(case when value.column_key = 'fee_amount' then value.value_jsonb #>> '{}' end) as fee,
      max(case when value.column_key = 'fee_paid_on' then value.value_jsonb #>> '{}' end) as fee_paid_on
    from visible_items visible
    left join public.item_values value on value.item_id = visible.id and value.org_id = visible.org_id
    group by visible.id, visible.source, visible.assigned_to
  )
  select jsonb_build_object(
    'todayConsultations', count(*) filter (
      where source in ('core.default-tab/new-lead','core.default-tab/contact')
        and meeting_at is not null
        and case
          when meeting_at ~ '^\d{4}-\d{2}-\d{2}$' then meeting_at::date = v_today
          when meeting_at ~ '^\d{4}-\d{2}-\d{2}T' then (meeting_at::timestamptz at time zone 'Asia/Seoul')::date = v_today
          else false end
    ),
    'callbacks', count(*) filter (
      where source in ('core.default-tab/new-lead','core.default-tab/contact')
        and (
          case when recall_at ~ '^\d{4}-\d{2}-\d{2}$' then recall_at::date <= v_today
            when recall_at ~ '^\d{4}-\d{2}-\d{2}T' then (recall_at::timestamptz at time zone 'Asia/Seoul')::date <= v_today
            else false end
          or case when recontact_on ~ '^\d{4}-\d{2}-\d{2}$' then recontact_on::date <= v_today
            when recontact_on ~ '^\d{4}-\d{2}-\d{2}T' then (recontact_on::timestamptz at time zone 'Asia/Seoul')::date <= v_today
            else false end
        )
    ),
    'contractsWaiting', count(*) filter (
      where source = 'core.default-tab/contact'
        and contract_status is not null and contract_status <> ''
        and coalesce(work_move, '') = ''
    ),
    'contractDeposits', coalesce(sum(
      case when source = 'core.default-tab/contract-work'
             and deposit_paid_on ~ '^\d{4}-\d{2}-\d{2}$'
             and deposit_paid_on::date >= v_month_start and deposit_paid_on::date < v_month_end
             and deposit ~ '^-?\d+(\.\d+)?$' then deposit::numeric else 0 end
    ), 0),
    'fees', coalesce(sum(
      case when source = 'core.default-tab/contract-work'
             and fee_paid_on ~ '^\d{4}-\d{2}-\d{2}$'
             and fee_paid_on::date >= v_month_start and fee_paid_on::date < v_month_end
             and fee ~ '^-?\d+(\.\d+)?$' then fee::numeric else 0 end
    ), 0)
  ) into v_kpis from values_typed;

  select coalesce(jsonb_agg(row order by rank, due_on, item_id), '[]'::jsonb)
    into v_tasks
    from (
      select jsonb_build_object(
        'kind', 'work_due', 'itemId', item.id, 'title', item.title,
        'dueOn', version.due_date, 'status', version.workflow_status,
        'href', '/work?notification=' || item.id::text
      ) row,
      case when version.due_date < v_today then 10 else 20 end rank,
      version.due_date due_on, item.id item_id
      from public.items item
      join public.boards board on board.id = item.board_id and board.org_id = item.org_id
      join public.work_item_versions version on version.item_id = item.id and version.org_id = item.org_id
      where item.org_id = p_org_id and board.source = 'core.default-tab/contract-work'
        and version.workflow_status not in ('done') and version.due_date <= v_today
        and (v_role in ('owner','admin') or v_scope = 'all' or item.assigned_to = v_actor)
      order by rank, due_on, item_id
      limit 5
    ) ranked;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', notification.id, 'type', notification.type, 'title', notification.title,
      'body', notification.body, 'targetType', notification.target_type,
      'targetId', notification.target_id, 'isAction', notification.is_action,
      'readAt', notification.read_at, 'createdAt', notification.created_at,
      'href', '/settings/notifications?notification=' || notification.id::text
    ) order by notification.created_at desc, notification.id), '[]'::jsonb)
    into v_notifications
    from (select * from public.notifications
      where org_id = p_org_id and user_id = v_actor and resolved_at is null
      order by created_at desc, id limit 5) notification;

  v_action_count := jsonb_array_length(v_tasks) + jsonb_array_length(v_notifications);
  return jsonb_build_object(
    'version', 1,
    'orgId', p_org_id,
    'viewer', jsonb_build_object('userId', v_actor, 'role', v_role, 'scope', v_scope),
    'asOf', p_as_of,
    'timezone', 'Asia/Seoul',
    'period', jsonb_build_object('today', v_today, 'monthStart', v_month_start, 'monthEndExclusive', v_month_end),
    'status', case when cardinality(v_missing) > 0 then 'partial' when v_action_count = 0
      and (v_kpis->>'todayConsultations')::int = 0 and (v_kpis->>'callbacks')::int = 0
      and (v_kpis->>'contractsWaiting')::int = 0 and (v_kpis->>'contractDeposits')::numeric = 0
      and (v_kpis->>'fees')::numeric = 0 then 'empty' else 'ready' end,
    'missingSources', to_jsonb(v_missing),
    'kpis', v_kpis,
    'tasks', v_tasks,
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.read_today_dashboard(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.read_today_dashboard(uuid, timestamptz) to authenticated;
