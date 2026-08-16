-- BBE-163: additive repair for hosted projects that predate the permission
-- read foundation. No customer rows are updated or deleted.

create or replace function public.perm_baseline()
returns table(
  perm_group text, scope_key text, label text, is_danger boolean,
  allowed_owner boolean, allowed_admin boolean, allowed_team_lead boolean, allowed_member boolean
)
language sql immutable
set search_path = public, pg_temp
as $$ values
  ('work','work.view_tabs','View tabs',false,true,true,true,true),
  ('work','work.item_upsert','Edit items',false,true,true,true,true),
  ('work','work.item_delete','Delete items',false,true,false,false,false),
  ('structure','structure.column_manage','Manage columns',false,true,true,false,false),
  ('structure','structure.section_manage','Manage sections',false,true,true,false,false),
  ('danger','danger.bulk_edit_delete','Bulk edit/delete',true,true,false,false,false)
$$;

create table if not exists public.org_role_permission_overrides (
  org_id uuid not null references public.orgs(id) on delete cascade,
  role public.member_role not null,
  scope_key text not null,
  allowed boolean not null,
  updated_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (org_id, role, scope_key),
  check (role <> 'owner')
);
alter table public.org_role_permission_overrides enable row level security;
revoke all on table public.org_role_permission_overrides from public, anon, authenticated, service_role;

create or replace function public.effective_permission(p_org_id uuid, p_scope_key text)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.member_role;
  v_baseline boolean;
  v_override boolean;
  v_exception text;
begin
  if v_actor is null or p_org_id is null or p_scope_key is null then return false; end if;
  select m.role into v_role
  from public.org_members m join public.orgs o on o.id=m.org_id
  where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if v_role is null then return false; end if;
  if v_role='owner' then return true; end if;
  select case when v_role='admin' then allowed_admin else allowed_member end
    into v_baseline from public.perm_baseline() where scope_key=p_scope_key;
  if v_baseline is null then return false; end if;
  select allowed into v_override from public.org_role_permission_overrides
   where org_id=p_org_id and role=v_role and scope_key=p_scope_key;
  select decision into v_exception from public.member_scoped_permission_bindings
   where org_id=p_org_id and subject_user_id=v_actor and scope_key=p_scope_key;
  if v_exception='deny' then return false; end if;
  if v_exception='allow' then return true; end if;
  return coalesce(v_override,v_baseline);
end;
$$;

create or replace function public.read_permission_scoped_work_items(
  p_org_id uuid,
  p_view_assignee uuid default null
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.member_role;
  v_scope public.member_scope;
  v_visible jsonb;
  v_hidden integer;
begin
  if v_actor is null or p_org_id is null then
    raise exception 'active workspace membership required' using errcode='42501';
  end if;
  select m.role,m.scope into v_role,v_scope
  from public.org_members m join public.orgs o on o.id=m.org_id
  where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if v_role is null or not public.effective_permission(p_org_id,'work.view_tabs') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  with org_items as (
    select i.id,i.assigned_to from public.items i where i.org_id=p_org_id
  ), visible as (
    select i.id from org_items i
    where (v_role in ('owner','admin') or v_scope='all' or i.assigned_to=v_actor)
      and (p_view_assignee is null or i.assigned_to=p_view_assignee)
  )
  select coalesce(jsonb_agg(v.id order by v.id),'[]'::jsonb),
         (select count(*) from org_items i where p_view_assignee is null or i.assigned_to=p_view_assignee)-count(*)
  into v_visible,v_hidden from visible v;
  return jsonb_build_object('itemIds',v_visible,'hiddenCount',v_hidden);
end;
$$;

revoke all on function public.perm_baseline() from public, anon, authenticated, service_role;
revoke all on function public.effective_permission(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.read_permission_scoped_work_items(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.effective_permission(uuid,text) to authenticated;
grant execute on function public.read_permission_scoped_work_items(uuid,uuid) to authenticated;
