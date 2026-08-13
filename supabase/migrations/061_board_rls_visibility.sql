-- BBE-159: align board value/view RLS with the request-scoped BoardsRepo contract.
-- Existing tables remain unchanged; only overly broad policies are replaced.

drop policy if exists items_rw on public.items;

create policy items_rw on public.items
for all to authenticated
using (
  public.is_org_member(org_id)
  and (
    public.org_role(org_id) in ('owner', 'admin')
    or public.org_scope(org_id) = 'all'
    or assigned_to = auth.uid()
  )
)
with check (
  public.is_org_member(org_id)
  and (
    public.org_role(org_id) in ('owner', 'admin')
    or public.org_scope(org_id) = 'all'
    or assigned_to = auth.uid()
  )
);

drop policy if exists itemvals_rw on public.item_values;
drop policy if exists item_values_assigned_scope on public.item_values;

create policy item_values_assigned_scope on public.item_values
for all to authenticated
using (
  public.is_org_member(org_id)
  and exists (
    select 1
      from public.items i
     where i.id = item_values.item_id
       and i.org_id = item_values.org_id
       and (
         public.org_role(i.org_id) in ('owner', 'admin')
         or public.org_scope(i.org_id) = 'all'
         or i.assigned_to = auth.uid()
       )
  )
)
with check (
  public.is_org_member(org_id)
  and exists (
    select 1
      from public.items i
     where i.id = item_values.item_id
       and i.org_id = item_values.org_id
       and (
         public.org_role(i.org_id) in ('owner', 'admin')
         or public.org_scope(i.org_id) = 'all'
         or i.assigned_to = auth.uid()
       )
  )
);

drop policy if exists bviews_rw on public.board_views;
drop policy if exists boardviews_rw on public.board_views;
drop policy if exists board_views_visible on public.board_views;
drop policy if exists board_views_insert_own on public.board_views;
drop policy if exists board_views_update_own on public.board_views;
drop policy if exists board_views_delete_own on public.board_views;

create policy board_views_visible on public.board_views
for select to authenticated
using (
  public.is_org_member(org_id)
  and (shared or user_id = auth.uid() or user_id is null)
);

create policy board_views_insert_own on public.board_views
for insert to authenticated
with check (
  public.is_org_member(org_id)
  and user_id = auth.uid()
);

create policy board_views_update_own on public.board_views
for update to authenticated
using (
  public.is_org_member(org_id)
  and user_id = auth.uid()
)
with check (
  public.is_org_member(org_id)
  and user_id = auth.uid()
);

create policy board_views_delete_own on public.board_views
for delete to authenticated
using (
  public.is_org_member(org_id)
  and user_id = auth.uid()
);
