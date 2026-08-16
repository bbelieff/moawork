-- BBE-165: inspect the caller's own approved create contract without exposing request rows.
create or replace function public.is_my_approved_workspace_creator(
  p_org_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.org_members m
      where m.org_id = p_org_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
        and m.status = 'active'
    )
    and exists (
      select 1 from public.workspace_entry_requests r
      where r.target_org_id = p_org_id
        and r.requester_user_id = auth.uid()
        and r.kind = 'create'
        and r.status = 'approved'
    );
$$;

revoke all on function public.is_my_approved_workspace_creator(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.is_my_approved_workspace_creator(uuid)
  to authenticated;
