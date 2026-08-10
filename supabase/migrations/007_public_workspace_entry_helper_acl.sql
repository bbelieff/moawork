-- PUBLIC-WORKSPACE-ENTRY-01 / hosted ACL forward-fix materialization.
-- 006 is already applied and remains immutable. Supabase default privileges can
-- grant anon EXECUTE directly, so revoking PUBLIC alone is not sufficient.

revoke execute on function public.is_platform_admin() from public;
revoke execute on function public.is_platform_admin() from anon;
revoke execute on function public.is_protected_workspace_owner(uuid) from public;
revoke execute on function public.is_protected_workspace_owner(uuid) from anon;
revoke execute on function public.shares_workspace_with(uuid) from public;
revoke execute on function public.shares_workspace_with(uuid) from anon;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_protected_workspace_owner(uuid) to authenticated;
grant execute on function public.shares_workspace_with(uuid) to authenticated;
