-- Align the workspace-operations read guard with the canonical owner helper.
--
-- 015 intentionally removed the unwired member-account session prerequisite
-- from tenancy helpers. The read guard introduced in 012 retained that stale
-- prerequisite, so a verified active owner could mutate workspace operations
-- through 010 but could not read the same workspace through 012.

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
     or not public.is_protected_workspace_owner(p_org_id) then
    raise exception 'protected workspace owner required'
      using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

revoke all on function public.workspace_ops_read_require_owner(uuid)
  from public, anon, authenticated;

comment on function public.workspace_ops_read_require_owner(uuid) is
  'Internal owner-only read guard aligned with the active owner contract in migration 015.';
