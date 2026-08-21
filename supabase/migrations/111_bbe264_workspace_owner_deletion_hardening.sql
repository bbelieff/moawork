-- moa-migration-guard: logical_key=111_bbe264_workspace_owner_deletion_hardening predecessor=110_bbe171_new_lead_title_audit digest=db44d1e2ef8ee89dd1ef37fb0ccb1725c873cfa314466e2b2a1e51e8a47637a9 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '111_bbe264_workspace_owner_deletion_hardening', p_file_name => '111_bbe264_workspace_owner_deletion_hardening.sql',
  p_file_digest => 'db44d1e2ef8ee89dd1ef37fb0ccb1725c873cfa314466e2b2a1e51e8a47637a9',
  p_expected_predecessor => '110_bbe171_new_lead_title_audit', p_executor => 'DG-03',
  p_thread_id => '01a02046-554e-7471-9911-0813a9645a6c', p_foundation => false
);

drop function if exists public.request_workspace_deletion(uuid);

create or replace function public.list_my_workspaces()
returns table(org_id uuid,name text,slug text,status text,role text,deletion_requested_at timestamptz)
language sql stable security definer set search_path='' as $$
  select o.id,o.name,o.slug,o.status,m.role::text,o.deletion_requested_at
  from public.org_members m join public.orgs o on o.id=m.org_id
  where m.user_id=auth.uid() and m.status='active' and m.role='owner'
    and o.status in ('active','pending_delete') order by o.created_at
$$;

create function public.request_workspace_deletion(p_org_id uuid,p_confirmation text)
returns text language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_status text; v_name text;
begin
  if v_actor is null then raise exception 'only an active owner can delete this workspace' using errcode='42501'; end if;
  select o.status,o.name into v_status,v_name from public.orgs o join public.org_members m on m.org_id=o.id
   where o.id=p_org_id and m.user_id=v_actor and m.status='active' and m.role='owner' for update of o,m;
  if not found then raise exception 'only an active owner can delete this workspace' using errcode='42501'; end if;
  if p_confirmation is distinct from v_name then raise exception 'workspace name confirmation mismatch' using errcode='22023'; end if;
  if v_status<>'active' then raise exception 'workspace is not active' using errcode='55000'; end if;
  update public.orgs set status='pending_delete',deletion_requested_at=now(),deletion_requested_by=v_actor where id=p_org_id and status='active';
  return 'pending_delete';
end $$;

create or replace function public.restore_workspace_deletion(p_org_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_status text;
begin
  if v_actor is null then raise exception 'only an active owner can restore this workspace' using errcode='42501'; end if;
  select o.status into v_status from public.orgs o join public.org_members m on m.org_id=o.id
   where o.id=p_org_id and m.user_id=v_actor and m.status='active' and m.role='owner' for update of o,m;
  if not found then raise exception 'only an active owner can restore this workspace' using errcode='42501'; end if;
  if v_status<>'pending_delete' then raise exception 'workspace is not pending deletion' using errcode='55000'; end if;
  update public.orgs set status='active',deletion_requested_at=null,deletion_requested_by=null where id=p_org_id and status='pending_delete';
  return 'active';
end $$;

revoke all on function public.list_my_workspaces() from public,anon,service_role;
revoke all on function public.request_workspace_deletion(uuid,text) from public,anon,service_role;
revoke all on function public.restore_workspace_deletion(uuid) from public,anon,service_role;
grant execute on function public.list_my_workspaces() to authenticated;
grant execute on function public.request_workspace_deletion(uuid,text) to authenticated;
grant execute on function public.restore_workspace_deletion(uuid) to authenticated;
