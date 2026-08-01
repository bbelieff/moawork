-- Platform-reviewed demo workspace bootstrap.
-- Creates tenant data only when the platform actor is also the selected
-- workspace owner. Platform status alone never grants tenant access.

create or replace function public.platform_ensure_selected_demo_workspace(
  p_request_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_board_id uuid;
  v_created boolean := false;
begin
  v_actor := public.release_rings_require_operator();

  if p_request_id is null or p_org_id is null then
    raise exception 'request and workspace required' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.admin_mode_workspace_selections selection
      join public.workspace_release_profiles profile
        on profile.org_id = selection.org_id
      join public.feature_release_controls feature
        on feature.feature_key = 'platform_reviewed_demo'
       and feature.release_ring = 'canary'
     where selection.actor_user_id = v_actor
       and selection.org_id = p_org_id
       and selection.authorization_kind = 'active_membership'
       and selection.authorization_version is null
       and profile.release_ring = 'canary'
       and profile.is_internal is true
       and profile.internal_source = 'platform_reviewed_demo'
       and feature.enabled is true
       and public.is_protected_workspace_owner(p_org_id)
  ) then
    raise exception 'selected demo workspace owner required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('platform-demo-workspace:' || p_org_id::text, 0)
  );

  select board.id
    into v_board_id
    from public.boards board
   where board.org_id = p_org_id
     and board.source = 'platform_reviewed_demo'
   order by board.created_at, board.id
   limit 1;

  if v_board_id is null then
    v_board_id := gen_random_uuid();
    insert into public.boards (
      id, org_id, name, description, icon, is_system, source,
      sort_order, created_by
    ) values (
      v_board_id, p_org_id, '데모 운영 보드',
      '배포 검수와 내부 실험을 위한 전용 보드', null, false,
      'platform_reviewed_demo', 10, v_actor
    );

    insert into public.board_groups (
      org_id, board_id, name, color, sort_order
    ) values (
      p_org_id, v_board_id, '테스트 항목', null, 10
    );

    insert into public.board_columns (
      org_id, board_id, key, label, type, options_jsonb, sort_order, width
    ) values
      (p_org_id, v_board_id, 'status', '상태', 'select',
       '[{"id":"todo","label":"대기"},{"id":"doing","label":"진행 중"},{"id":"done","label":"완료"}]'::jsonb,
       10, 150),
      (p_org_id, v_board_id, 'note', '실험 메모', 'longtext', null, 20, 320);

    insert into public.workspace_ops_audit (
      org_id, actor_user_id, operation, entity_type, entity_id,
      request_id, metadata
    ) values (
      p_org_id, v_actor, 'demo_workspace_bootstrapped', 'board',
      v_board_id, p_request_id, jsonb_build_object('source', 'platform_reviewed_demo')
    );
    v_created := true;
  end if;

  return jsonb_build_object('accepted', true, 'created', v_created);
end;
$$;

revoke all on function public.platform_ensure_selected_demo_workspace(uuid, uuid)
  from public, anon;
grant execute on function public.platform_ensure_selected_demo_workspace(uuid, uuid)
  to authenticated;

comment on function public.platform_ensure_selected_demo_workspace(uuid, uuid) is
  'Idempotently creates a DB-backed internal demo board only for a selected canary workspace the platform actor already owns.';
