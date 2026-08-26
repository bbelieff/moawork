-- moa-migration-guard: logical_key=129_issue558_dispatch_lineage_notifications predecessor=128_issue542_new_lead_v6plus digest=22fa55ea0db3ebe4d6544cf38b7b8c14621a11e41f617fbeee4b8bfaf74cb778 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '129_issue558_dispatch_lineage_notifications',
  p_file_name => '129_issue558_dispatch_lineage_notifications.sql',
  p_file_digest => '22fa55ea0db3ebe4d6544cf38b7b8c14621a11e41f617fbeee4b8bfaf74cb778',
  p_expected_predecessor => '128_issue542_new_lead_v6plus',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- `collaborators` is the user-facing 출동 lineage. Every active lineage member,
-- the current assignee, and owners receive the status/move signal. Customer fields,
-- titles, profile names and phone numbers never enter the notification body.
create or replace function public.notify_board_item_moved(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_event_key uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_scope text;
  v_assigned_to uuid;
  v_inserted integer := 0;
begin
  if v_actor is null or p_event_key is null then
    raise exception 'authenticated notification actor required' using errcode = '42501';
  end if;

  select membership.scope::text
    into v_scope
    from public.org_members membership
    join public.orgs organization on organization.id = membership.org_id
   where membership.org_id = p_org_id
     and membership.user_id = v_actor
     and membership.status = 'active'
     and organization.status = 'active';
  if not found or not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'work item update permission required' using errcode = '42501';
  end if;

  select item.assigned_to
    into v_assigned_to
    from public.items item
   where item.id = p_item_id
     and item.org_id = p_org_id
     and item.board_id = p_board_id
     and item.deleted_at is null;
  if not found or (v_scope = 'assigned' and v_assigned_to is distinct from v_actor) then
    raise exception 'board item unavailable' using errcode = '42501';
  end if;

  with requested_recipients(user_id) as (
    select member.user_id
      from public.org_members member
     where member.org_id = p_org_id and member.role = 'owner'
    union
    select v_assigned_to where v_assigned_to is not null
    union
    select lineage.value::uuid
      from public.item_values value_row
      cross join lateral jsonb_array_elements_text(value_row.value_jsonb) lineage(value)
     where value_row.org_id = p_org_id
       and value_row.item_id = p_item_id
       and value_row.column_key = 'collaborators'
       and jsonb_typeof(value_row.value_jsonb) = 'array'
       and lineage.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ), eligible_recipients as (
    select distinct member.user_id
      from requested_recipients requested
      join public.org_members member
        on member.org_id = p_org_id
       and member.user_id = requested.user_id
       and member.status = 'active'
  )
  insert into public.notifications (
    org_id, user_id, type, title, body, target_type, target_id,
    actor_id, is_action, dedupe_key
  )
  select
    p_org_id,
    recipient.user_id,
    'board_item_moved',
    '회사 상태가 변경되었습니다',
    '담당 중인 회사의 상태가 변경되었습니다. 알림에서 해당 회사를 확인해 주세요.',
    'board_item',
    p_item_id,
    v_actor,
    false,
    'board-status:' || p_event_key::text
  from eligible_recipients recipient
  on conflict (org_id, user_id, dedupe_key) where dedupe_key is not null do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.notify_board_item_moved(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.notify_board_item_moved(uuid, uuid, uuid, uuid)
  to authenticated;

do $$
begin
  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name = 'notify_board_item_moved'
       and grantee in ('PUBLIC', 'anon', 'service_role')
  ) then
    raise exception 'unsafe_issue558_notification_acl';
  end if;
end;
$$;
