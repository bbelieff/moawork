-- BBE-165: serialize idempotent default-tab reconciliation across server instances.
create table if not exists public.workspace_bootstrap_leases (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  holder uuid not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.workspace_bootstrap_leases enable row level security;
revoke all on table public.workspace_bootstrap_leases from public, anon, authenticated, service_role;

create or replace function public.acquire_workspace_bootstrap_lease(
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
    where m.org_id=p_org_id and m.user_id=v_actor and m.role='owner' and m.status='active'
  ) or not exists (
    select 1 from public.workspace_entry_requests r
    where r.target_org_id=p_org_id and r.requester_user_id=v_actor
      and r.kind='create' and r.status='approved'
  ) then
    raise exception 'workspace bootstrap denied' using errcode='42501';
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

create or replace function public.renew_workspace_bootstrap_lease(
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
    where m.org_id=p_org_id and m.user_id=v_actor and m.role='owner' and m.status='active'
  ) or not exists (
    select 1 from public.workspace_entry_requests r
    where r.target_org_id=p_org_id and r.requester_user_id=v_actor
      and r.kind='create' and r.status='approved'
  ) then
    raise exception 'workspace bootstrap denied' using errcode='42501';
  end if;
  update public.workspace_bootstrap_leases
    set expires_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp()
    where org_id=p_org_id and holder=p_holder and expires_at>clock_timestamp();
  return found;
end;
$$;

create or replace function public.release_workspace_bootstrap_lease(
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
    where m.org_id=p_org_id and m.user_id=v_actor and m.role='owner' and m.status='active'
  ) or not exists (
    select 1 from public.workspace_entry_requests r
    where r.target_org_id=p_org_id and r.requester_user_id=v_actor
      and r.kind='create' and r.status='approved'
  ) then
    raise exception 'workspace bootstrap denied' using errcode='42501';
  end if;
  delete from public.workspace_bootstrap_leases
    where org_id=p_org_id and holder=p_holder;
  return found;
end;
$$;

revoke all on function public.acquire_workspace_bootstrap_lease(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.renew_workspace_bootstrap_lease(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.release_workspace_bootstrap_lease(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.acquire_workspace_bootstrap_lease(uuid,uuid) to authenticated;
grant execute on function public.renew_workspace_bootstrap_lease(uuid,uuid) to authenticated;
grant execute on function public.release_workspace_bootstrap_lease(uuid,uuid) to authenticated;
