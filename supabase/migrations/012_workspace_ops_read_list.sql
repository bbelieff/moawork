-- FUNCTIONAL-MVP-CLOSE-WAVE3-DATA3-012-READ-LIST
-- Owner-scoped read contracts for the builder, import, and automation surfaces.
-- No RPC returns actor identity, request identifiers, or other user data.

create or replace function public.workspace_ops_read_require_owner(p_org_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null
     or p_org_id is null
     or not public.member_account_session_valid()
     or not public.is_protected_workspace_owner(p_org_id) then
    raise exception 'protected workspace owner with valid session required'
      using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

create or replace function public.list_workspace_ops_boards(p_org_id uuid)
returns table(
  board_id uuid,
  name text,
  description text,
  icon text,
  is_system boolean,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.workspace_ops_read_require_owner(p_org_id);

  return query
    select board.id, board.name, board.description, board.icon,
      board.is_system, board.sort_order
    from public.boards board
    where board.org_id = p_org_id
    order by board.sort_order, board.name, board.id;
end;
$$;

create or replace function public.get_workspace_builder_config(p_org_id uuid)
returns table(
  configuration jsonb,
  version integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.workspace_ops_read_require_owner(p_org_id);

  return query
    select config.configuration, config.version, config.updated_at
    from public.workspace_builder_configs config
    where config.org_id = p_org_id;
end;
$$;

create or replace function public.list_workspace_automation_configs(p_org_id uuid)
returns table(
  automation_id uuid,
  board_id uuid,
  draft jsonb,
  state text,
  updated_at timestamptz,
  activated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.workspace_ops_read_require_owner(p_org_id);

  return query
    select automation.id, automation.board_id, automation.draft,
      automation.state, automation.updated_at, automation.activated_at
    from public.workspace_automation_configs automation
    where automation.org_id = p_org_id
    order by automation.updated_at desc, automation.id;
end;
$$;

revoke all on function public.workspace_ops_read_require_owner(uuid)
  from public, anon, authenticated;
revoke all on function public.list_workspace_ops_boards(uuid),
  public.get_workspace_builder_config(uuid),
  public.list_workspace_automation_configs(uuid)
  from public, anon, authenticated;

grant execute on function public.list_workspace_ops_boards(uuid),
  public.get_workspace_builder_config(uuid),
  public.list_workspace_automation_configs(uuid)
  to authenticated;
