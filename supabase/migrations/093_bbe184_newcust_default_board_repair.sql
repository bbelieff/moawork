-- BBE-184: serialize additive repair for the exact workspace entered by an active manager.
-- Provisional 090: BBE-176 owns active 089; renumber against latest main before merge.

create or replace function public.acquire_default_tab_repair_lease(
  p_org_id uuid,
  p_holder uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_acquired uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.org_members m
    where m.org_id=p_org_id and m.user_id=v_actor
      and m.role in ('owner','admin') and m.status='active'
  ) then
    raise exception 'default tab repair denied' using errcode='42501';
  end if;

  insert into public.workspace_bootstrap_leases(org_id,holder,expires_at,updated_at)
  values(p_org_id,p_holder,clock_timestamp()+interval '30 seconds',clock_timestamp())
  on conflict(org_id) do update
    set holder=excluded.holder,expires_at=excluded.expires_at,updated_at=excluded.updated_at
    where public.workspace_bootstrap_leases.expires_at <= clock_timestamp()
       or public.workspace_bootstrap_leases.holder=excluded.holder
  returning holder into v_acquired;
  return coalesce(v_acquired=p_holder,false);
end;
$$;

create or replace function public.renew_default_tab_repair_lease(
  p_org_id uuid,
  p_holder uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.org_members m
    where m.org_id=p_org_id and m.user_id=v_actor
      and m.role in ('owner','admin') and m.status='active'
  ) then
    raise exception 'default tab repair denied' using errcode='42501';
  end if;
  update public.workspace_bootstrap_leases
    set expires_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp()
    where org_id=p_org_id and holder=p_holder and expires_at>clock_timestamp();
  return found;
end;
$$;

create or replace function public.release_default_tab_repair_lease(
  p_org_id uuid,
  p_holder uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.org_members m
    where m.org_id=p_org_id and m.user_id=v_actor
      and m.role in ('owner','admin') and m.status='active'
  ) then
    raise exception 'default tab repair denied' using errcode='42501';
  end if;
  delete from public.workspace_bootstrap_leases
    where org_id=p_org_id and holder=p_holder;
  return found;
end;
$$;

revoke all on function public.acquire_default_tab_repair_lease(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.renew_default_tab_repair_lease(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.release_default_tab_repair_lease(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.acquire_default_tab_repair_lease(uuid,uuid) to authenticated;
grant execute on function public.renew_default_tab_repair_lease(uuid,uuid) to authenticated;
grant execute on function public.release_default_tab_repair_lease(uuid,uuid) to authenticated;
