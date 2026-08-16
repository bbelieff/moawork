-- BBE-167: restore the hosted in-app notification foundation without replaying 019.
-- Additive only: no customer-row backfill, UPDATE, or DELETE.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  target_type text,
  target_id uuid,
  actor_id uuid references public.users(id) on delete set null,
  is_action boolean not null default false,
  read_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  dedupe_key text
);

alter table public.notifications add column if not exists dedupe_key text;

create index if not exists notifications_user_open_actions_idx
  on public.notifications(user_id, org_id)
  where is_action and resolved_at is null;
create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, org_id)
  where read_at is null;
create index if not exists notifications_user_recent_idx
  on public.notifications(user_id, org_id, created_at desc);
create unique index if not exists notifications_recipient_dedupe_idx
  on public.notifications(org_id, user_id, dedupe_key)
  where dedupe_key is not null;

create table if not exists public.notification_surface_seen (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  surface_key text not null,
  seen_at timestamptz not null default now(),
  primary key (org_id, user_id, surface_key)
);

alter table public.notifications enable row level security;
alter table public.notification_surface_seen enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.org_members membership
      join public.orgs organization on organization.id = membership.org_id
      where membership.org_id = notifications.org_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and organization.status = 'active'
    )
  );

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.org_members membership
      join public.orgs organization on organization.id = membership.org_id
      where membership.org_id = notifications.org_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and organization.status = 'active'
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.org_members membership
      join public.orgs organization on organization.id = membership.org_id
      where membership.org_id = notifications.org_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and organization.status = 'active'
    )
  );

drop policy if exists surface_seen_rw_own on public.notification_surface_seen;
create policy surface_seen_rw_own on public.notification_surface_seen for all
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.org_members membership
      join public.orgs organization on organization.id = membership.org_id
      where membership.org_id = notification_surface_seen.org_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and organization.status = 'active'
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.org_members membership
      join public.orgs organization on organization.id = membership.org_id
      where membership.org_id = notification_surface_seen.org_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and organization.status = 'active'
    )
  );

revoke all on table public.notifications from public, anon, authenticated, service_role;
grant select on table public.notifications to authenticated;
grant update(read_at, resolved_at) on table public.notifications to authenticated;

revoke all on table public.notification_surface_seen from public, anon, authenticated, service_role;
grant select on table public.notification_surface_seen to authenticated;
grant insert(org_id, user_id, surface_key, seen_at) on table public.notification_surface_seen to authenticated;
grant update(seen_at) on table public.notification_surface_seen to authenticated;

-- The request-scoped app calls this only after a board move succeeds. The fixed copy
-- contains no email, profile name, item title, or customer data.
create or replace function public.notify_board_item_moved(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_event_key uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_scope text;
  v_assigned_to uuid;
  v_inserted integer := 0;
begin
  if v_actor is null or p_event_key is null then
    raise exception 'authenticated notification actor required' using errcode = '42501';
  end if;

  select membership.scope::text
    into v_scope
    from public.org_members membership
    join public.orgs organization on organization.id = membership.org_id
   where membership.org_id = p_org_id
     and membership.user_id = v_actor
     and membership.status = 'active'
     and organization.status = 'active';
  if not found then
    raise exception 'active organization membership required' using errcode = '42501';
  end if;

  if not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'work item update permission required' using errcode = '42501';
  end if;

  select item.assigned_to
    into v_assigned_to
    from public.items item
   where item.id = p_item_id
     and item.org_id = p_org_id
     and item.board_id = p_board_id;
  if not found then
    raise exception 'board item unavailable' using errcode = '42501';
  end if;
  if v_scope = 'assigned' and v_assigned_to is distinct from v_actor then
    raise exception 'board item unavailable' using errcode = '42501';
  end if;

  insert into public.notifications (
    org_id, user_id, type, title, body, target_type, target_id,
    actor_id, is_action, dedupe_key
  )
  select
    p_org_id,
    owner_member.user_id,
    'board_item_moved',
    '업무 위치가 변경되었습니다',
    '회사 업무의 위치가 변경되었습니다. 알림에서 해당 업무를 확인해 주세요.',
    'board_item',
    p_item_id,
    v_actor,
    false,
    'board-move:' || p_event_key::text
  from public.org_members owner_member
  where owner_member.org_id = p_org_id
    and owner_member.role = 'owner'
    and owner_member.status = 'active'
    and owner_member.user_id is distinct from v_actor
  on conflict (org_id, user_id, dedupe_key) where dedupe_key is not null do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.notify_board_item_moved(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.notify_board_item_moved(uuid, uuid, uuid, uuid)
  to authenticated;

-- Restore the current join-request producer/resolver using the same recipient and
-- least-data rules as the app contract, plus a recipient-scoped replay key.
create or replace function public.notify_owners_join_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind <> 'join' or new.status <> 'pending' or new.target_org_id is null then
    return new;
  end if;

  insert into public.notifications (
    org_id, user_id, type, title, body, target_type, target_id,
    actor_id, is_action, dedupe_key
  )
  select
    new.target_org_id,
    owner_member.user_id,
    'join_request',
    '합류 요청이 도착했습니다',
    '승인 대기 중인 합류 요청이 있습니다.',
    'member_approval',
    new.id,
    new.requester_user_id,
    true,
    'join-request:' || new.id::text
  from public.org_members owner_member
  join public.orgs organization on organization.id = owner_member.org_id
  where owner_member.org_id = new.target_org_id
    and owner_member.role = 'owner'
    and owner_member.status = 'active'
    and organization.status = 'active'
    and owner_member.user_id is distinct from new.requester_user_id
  on conflict (org_id, user_id, dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

create or replace function public.resolve_join_request_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = old.status or new.status = 'pending' then
    return new;
  end if;
  update public.notifications
     set resolved_at = coalesce(resolved_at, now()),
         read_at = coalesce(read_at, now())
   where org_id = new.target_org_id
     and target_type = 'member_approval'
     and target_id = new.id
     and resolved_at is null;
  return new;
end;
$$;

drop trigger if exists trg_notify_join_request on public.workspace_entry_requests;
create trigger trg_notify_join_request
  after insert on public.workspace_entry_requests
  for each row execute function public.notify_owners_join_request();

drop trigger if exists trg_resolve_join_request_notifications on public.workspace_entry_requests;
create trigger trg_resolve_join_request_notifications
  after update on public.workspace_entry_requests
  for each row execute function public.resolve_join_request_notifications();

revoke all on function public.notify_owners_join_request() from public, anon, authenticated, service_role;
revoke all on function public.resolve_join_request_notifications() from public, anon, authenticated, service_role;

-- Realtime is optional in local PostgreSQL/PGlite but required by the hosted bell.
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception
  when undefined_table or undefined_object or feature_not_supported then null;
end
$realtime$;
