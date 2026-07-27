-- WORKSPACE-ENTRY-B3-SELF-STATE-RPC-01
-- Minimal self-only routing state. It intentionally returns no tenant identity.

create or replace function public.workspace_entry_self_route_state()
  returns text
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    return 'unknown';
  end if;

  -- A suspended membership or any non-terminal membership attached to a non-active
  -- Workspace is an account-safe block, never an invitation to create/join.
  if exists (
    select 1
    from public.org_members membership
    join public.orgs workspace on workspace.id = membership.org_id
    where membership.user_id = v_actor
      and (
        membership.status = 'suspended'
        or (
          workspace.status <> 'active'
          and membership.status not in ('removed', 'leave', 'expired')
        )
      )
  ) then
    return 'blocked_inactive';
  end if;

  -- Never-member and terminal non-active history (removed/leave/expired) are
  -- eligible to see the public entry flow. No row details leave this function.
  return 'eligible_entry';
end;
$$;

revoke all on function public.workspace_entry_self_route_state() from public;
revoke all on function public.workspace_entry_self_route_state() from anon;
grant execute on function public.workspace_entry_self_route_state() to authenticated;

comment on function public.workspace_entry_self_route_state() is
  'Authenticated self-only routing state: eligible_entry, blocked_inactive, or unknown; never returns tenant identity.';
