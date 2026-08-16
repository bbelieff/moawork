-- BBE-167 successor: clear the new notification advisor findings from 082.
-- Additive indexes plus policy recreation only; no customer-row DML.

create index if not exists notification_surface_seen_user_org_idx
  on public.notification_surface_seen(user_id, org_id);
create index if not exists notifications_actor_idx
  on public.notifications(actor_id)
  where actor_id is not null;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.org_members membership
      join public.orgs organization on organization.id = membership.org_id
      where membership.org_id = notifications.org_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and organization.status = 'active'
    )
  );

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.org_members membership
      join public.orgs organization on organization.id = membership.org_id
      where membership.org_id = notifications.org_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and organization.status = 'active'
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.org_members membership
      join public.orgs organization on organization.id = membership.org_id
      where membership.org_id = notifications.org_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and organization.status = 'active'
    )
  );

drop policy if exists surface_seen_rw_own on public.notification_surface_seen;
create policy surface_seen_rw_own on public.notification_surface_seen for all
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.org_members membership
      join public.orgs organization on organization.id = membership.org_id
      where membership.org_id = notification_surface_seen.org_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and organization.status = 'active'
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.org_members membership
      join public.orgs organization on organization.id = membership.org_id
      where membership.org_id = notification_surface_seen.org_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and organization.status = 'active'
    )
  );
