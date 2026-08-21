-- moa-migration-guard: logical_key=116_bbe225_workspace_entry_pure_read predecessor=115_bbe176_column_date_schedule digest=c866eebe9eed9f6d53e55bae3ba986d47df461055dd98ed5d8f18623f4281cfd foundation=false

select public.begin_guarded_migration(
  p_logical_key => '116_bbe225_workspace_entry_pure_read',
  p_file_name => '116_bbe225_workspace_entry_pure_read.sql',
  p_file_digest => 'c866eebe9eed9f6d53e55bae3ba986d47df461055dd98ed5d8f18623f4281cfd',
  p_expected_predecessor => '115_bbe176_column_date_schedule',
  p_executor => 'DG-04',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

create or replace function public.list_my_workspace_entry_requests()
  returns table (
    request_id uuid, entry_kind text, request_status text, created_at timestamptz,
    review_deadline timestamptz, resolved_at timestamptz, decision_state text,
    approved_target_slug text
  )
  language sql stable security definer set search_path = public, pg_temp
as $$
  select request.id,
         request.kind,
         case
           when request.status = 'pending'
            and request.review_expires_at is not null
            and request.review_expires_at <= statement_timestamp()
             then 'rejected'
           else request.status
         end,
         request.created_at,
         request.review_expires_at,
         case
           when request.status = 'pending'
            and request.review_expires_at is not null
            and request.review_expires_at <= statement_timestamp()
             then request.review_expires_at
           else request.resolved_at
         end,
         case
           when request.status = 'pending'
            and request.review_expires_at is not null
            and request.review_expires_at <= statement_timestamp()
             then 'not_approved'
           when request.status = 'pending' then 'pending'
           when request.status = 'approved' then 'approved'
           when request.status = 'cancelled' then 'cancelled'
           else 'not_approved'
         end,
         case
           when request.status = 'approved'
            and organization.status = 'active'
            and exists (
              select 1
              from public.org_members membership
              where membership.org_id = request.target_org_id
                and membership.user_id = auth.uid()
                and membership.status = 'active'
            )
             then organization.slug
           else null
         end
  from public.workspace_entry_requests request
  left join public.orgs organization on organization.id = request.target_org_id
  where auth.uid() is not null
    and request.requester_user_id = auth.uid()
  order by request.created_at desc, request.id desc
$$;

create or replace function public.expire_my_workspace_entry_requests()
  returns jsonb
  language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_expired integer := 0;
  v_events integer := 0;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  with expired as (
    update public.workspace_entry_requests request
    set status = 'rejected',
        decision_code = 'review_window_expired',
        resolved_by = null,
        resolved_at = request.review_expires_at
    where request.requester_user_id = v_actor
      and request.status = 'pending'
      and request.review_expires_at is not null
      and request.review_expires_at <= statement_timestamp()
    returning request.id, request.target_org_id, request.kind
  ), inserted as (
    insert into public.workspace_entry_events (
      request_id, org_id, event_type, outcome, metadata
    )
    select id, target_org_id, kind || '_request_expired', 'rejected',
           jsonb_build_object('source', 'explicit_deadline')
    from expired
    returning 1
  )
  select (select count(*) from expired), (select count(*) from inserted)
    into v_expired, v_events;

  return jsonb_build_object('expired', v_expired, 'events', v_events);
end;
$$;

revoke all on function public.list_my_workspace_entry_requests()
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_workspace_entry_requests() to authenticated;

revoke all on function public.expire_my_workspace_entry_requests()
  from public, anon, authenticated, service_role;
grant execute on function public.expire_my_workspace_entry_requests() to authenticated;

comment on function public.list_my_workspace_entry_requests() is
  'Pure requester-owned lifecycle projection. Expired pending rows are reported effectively without table or event mutation.';
comment on function public.expire_my_workspace_entry_requests() is
  'Explicit requester-owned expiry mutation. Repeated or concurrent calls update and emit each expiry exactly once.';
