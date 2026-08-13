-- BBE-159: align board value/view RLS with the request-scoped BoardsRepo contract.
-- Existing tables remain unchanged; only overly broad policies are replaced.

create or replace function public.is_org_notice_board(
  p_org_id uuid,
  p_board_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.boards b
     where b.id = p_board_id
       and b.org_id = p_org_id
       and (
         b.source = 'core.notice'
         or (b.source is null and b.name = '공지사항')
       )
  )
$$;

revoke all on function public.is_org_notice_board(uuid, uuid) from public;
grant execute on function public.is_org_notice_board(uuid, uuid) to authenticated;

create or replace function public.can_read_org_notice(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.boards b
     where b.id = p_board_id
       and b.org_id = p_org_id
       and public.is_org_member(p_org_id)
       and (
         b.source = 'core.notice'
         or (b.source is null and b.name = '공지사항')
       )
       and coalesce((
         select iv.value_jsonb #>> '{}'
           from public.item_values iv
          where iv.item_id = p_item_id
            and iv.org_id = p_org_id
            and iv.column_key = 'audience'
       ), '') <> 'notice-audience-managers'
       and coalesce((
         select iv.value_jsonb #>> '{}'
           from public.item_values iv
          where iv.item_id = p_item_id
            and iv.org_id = p_org_id
            and iv.column_key = 'published_at'
       ), '') <= to_char(current_timestamp at time zone 'Asia/Seoul', 'YYYY-MM-DD')
       and (
         coalesce((
           select iv.value_jsonb #>> '{}'
             from public.item_values iv
            where iv.item_id = p_item_id
              and iv.org_id = p_org_id
              and iv.column_key = 'ended_at'
         ), '') = ''
         or (
           select iv.value_jsonb #>> '{}'
             from public.item_values iv
            where iv.item_id = p_item_id
              and iv.org_id = p_org_id
              and iv.column_key = 'ended_at'
         ) >= to_char(current_timestamp at time zone 'Asia/Seoul', 'YYYY-MM-DD')
       )
  )
$$;

revoke all on function public.can_read_org_notice(uuid, uuid, uuid) from public;
grant execute on function public.can_read_org_notice(uuid, uuid, uuid) to authenticated;

drop policy if exists items_rw on public.items;
drop policy if exists items_visible on public.items;
drop policy if exists items_insert_assigned_scope on public.items;
drop policy if exists items_update_assigned_scope on public.items;
drop policy if exists items_delete_assigned_scope on public.items;

create policy items_visible on public.items
for select to authenticated
using (
  public.is_org_member(org_id)
  and (
    public.org_role(org_id) in ('owner', 'admin')
    or public.can_read_org_notice(org_id, board_id, id)
    or (
      not public.is_org_notice_board(org_id, board_id)
      and (
        public.org_scope(org_id) = 'all'
        or assigned_to = auth.uid()
      )
    )
  )
);

create policy items_insert_assigned_scope on public.items
for insert to authenticated
with check (
  public.is_org_member(org_id)
  and (
    public.org_role(org_id) in ('owner', 'admin')
    or (
      not public.is_org_notice_board(org_id, board_id)
      and (public.org_scope(org_id) = 'all' or assigned_to = auth.uid())
    )
  )
);

create policy items_update_assigned_scope on public.items
for update to authenticated
using (
  public.is_org_member(org_id)
  and (
    public.org_role(org_id) in ('owner', 'admin')
    or (
      not public.is_org_notice_board(org_id, board_id)
      and (public.org_scope(org_id) = 'all' or assigned_to = auth.uid())
    )
  )
)
with check (
  public.is_org_member(org_id)
  and (
    public.org_role(org_id) in ('owner', 'admin')
    or (
      not public.is_org_notice_board(org_id, board_id)
      and (public.org_scope(org_id) = 'all' or assigned_to = auth.uid())
    )
  )
);

create policy items_delete_assigned_scope on public.items
for delete to authenticated
using (
  public.is_org_member(org_id)
  and (
    public.org_role(org_id) in ('owner', 'admin')
    or (
      not public.is_org_notice_board(org_id, board_id)
      and (public.org_scope(org_id) = 'all' or assigned_to = auth.uid())
    )
  )
);

drop policy if exists itemvals_rw on public.item_values;
drop policy if exists item_values_assigned_scope on public.item_values;
drop policy if exists item_values_visible on public.item_values;
drop policy if exists item_values_insert_assigned_scope on public.item_values;
drop policy if exists item_values_update_assigned_scope on public.item_values;
drop policy if exists item_values_delete_assigned_scope on public.item_values;

create policy item_values_visible on public.item_values
for select to authenticated
using (
  public.is_org_member(org_id)
  and exists (
    select 1
      from public.items i
     where i.id = item_values.item_id
       and i.org_id = item_values.org_id
       and (
         public.org_role(i.org_id) in ('owner', 'admin')
         or public.can_read_org_notice(i.org_id, i.board_id, i.id)
         or (
           not public.is_org_notice_board(i.org_id, i.board_id)
           and (
             public.org_scope(i.org_id) = 'all'
             or i.assigned_to = auth.uid()
           )
         )
       )
  )
);

create policy item_values_insert_assigned_scope on public.item_values
for insert to authenticated
with check (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.items i
     where i.id = item_values.item_id
       and i.org_id = item_values.org_id
       and (
         public.org_role(i.org_id) in ('owner', 'admin')
         or (
           not public.is_org_notice_board(i.org_id, i.board_id)
           and (public.org_scope(i.org_id) = 'all' or i.assigned_to = auth.uid())
         )
       )
  )
);

create policy item_values_update_assigned_scope on public.item_values
for update to authenticated
using (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.items i
     where i.id = item_values.item_id
       and i.org_id = item_values.org_id
       and (
         public.org_role(i.org_id) in ('owner', 'admin')
         or (
           not public.is_org_notice_board(i.org_id, i.board_id)
           and (public.org_scope(i.org_id) = 'all' or i.assigned_to = auth.uid())
         )
       )
  )
)
with check (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.items i
     where i.id = item_values.item_id
       and i.org_id = item_values.org_id
       and (
         public.org_role(i.org_id) in ('owner', 'admin')
         or (
           not public.is_org_notice_board(i.org_id, i.board_id)
           and (public.org_scope(i.org_id) = 'all' or i.assigned_to = auth.uid())
         )
       )
  )
);

create policy item_values_delete_assigned_scope on public.item_values
for delete to authenticated
using (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.items i
     where i.id = item_values.item_id
       and i.org_id = item_values.org_id
       and (
         public.org_role(i.org_id) in ('owner', 'admin')
         or (
           not public.is_org_notice_board(i.org_id, i.board_id)
           and (public.org_scope(i.org_id) = 'all' or i.assigned_to = auth.uid())
         )
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
