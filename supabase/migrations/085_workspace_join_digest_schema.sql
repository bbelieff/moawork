-- BBE-169: keep the join-request contract intact while resolving pgcrypto
-- through its hosted `extensions` schema. No customer-row DML.

create or replace function public.submit_workspace_join_request(
  p_request_id uuid,
  p_lookup text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_lookup text := lower(btrim(coalesce(p_lookup, '')));
  v_created_at timestamptz := clock_timestamp();
  v_lookup_digest bytea;
  v_payload_digest bytea;
  v_target_org_id uuid;
  v_invite_id uuid;
  v_existing public.workspace_entry_requests%rowtype;
  v_inserted integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request id required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users where id = v_user_id) then
    raise exception 'profile required' using errcode = '42501';
  end if;

  v_lookup_digest := public.workspace_lookup_digest(v_lookup);
  v_payload_digest := extensions.digest(
    convert_to('join:' || encode(v_lookup_digest, 'hex'), 'utf8'),
    'sha256'
  );
  if v_lookup ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    select id into v_target_org_id from public.orgs where lower(slug) = v_lookup limit 1;
  end if;
  if v_target_org_id is null then
    select invite.id, invite.org_id into v_invite_id, v_target_org_id
    from public.workspace_invite_codes invite
    where invite.code_digest = v_lookup_digest and invite.revoked_at is null
      and invite.expires_at > v_created_at and invite.use_count < invite.use_limit
    limit 1;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || coalesce(v_target_org_id::text, encode(v_lookup_digest, 'hex')), 0)
  );

  with expired as (
    update public.workspace_entry_requests request
    set status = 'rejected', decision_code = 'review_window_expired',
        resolved_by = null, resolved_at = request.review_expires_at
    where request.requester_user_id = v_user_id
      and request.kind = 'join'
      and request.status = 'pending'
      and request.review_expires_at <= v_created_at
    returning request.id, request.target_org_id
  )
  insert into public.workspace_entry_events (request_id, org_id, event_type, outcome, metadata)
  select id, target_org_id, 'join_request_expired', 'rejected',
         jsonb_build_object('source', 'deadline')
  from expired;

  if v_target_org_id is not null and exists (
    select 1 from public.org_members
    where org_id = v_target_org_id and user_id = v_user_id and status = 'active'
  ) then
    return jsonb_build_object('accepted', true);
  end if;

  select * into v_existing
  from public.workspace_entry_requests
  where requester_user_id = v_user_id
    and kind = 'join'
    and status = 'pending'
    and review_expires_at > v_created_at
    and (
      (v_target_org_id is not null and target_org_id = v_target_org_id)
      or (v_target_org_id is null and target_org_id is null and lookup_digest = v_lookup_digest)
    )
  order by created_at, id
  limit 1;
  if found then
    return jsonb_build_object('accepted', true);
  end if;

  insert into public.workspace_entry_requests (
    id, requester_user_id, kind, status, target_org_id, invite_code_id,
    lookup_digest, payload_digest, created_at, review_expires_at
  ) values (
    p_request_id, v_user_id, 'join', 'pending', v_target_org_id, v_invite_id,
    v_lookup_digest, v_payload_digest, v_created_at, v_created_at + interval '14 days'
  ) on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_existing from public.workspace_entry_requests where id = p_request_id;
  if v_existing.requester_user_id <> v_user_id
     or v_existing.kind <> 'join'
     or v_existing.payload_digest <> v_payload_digest then
    raise exception 'idempotency key reuse with different request' using errcode = '22023';
  end if;
  if v_inserted = 1 then
    insert into public.workspace_entry_events (request_id, org_id, actor_user_id, event_type, outcome, metadata)
    values (p_request_id, v_target_org_id, v_user_id, 'join_request_submitted', 'accepted', jsonb_build_object('kind', 'join'));
  end if;
  return jsonb_build_object('accepted', true);
end;
$$;

revoke all on function public.submit_workspace_join_request(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_workspace_join_request(uuid, text)
  to authenticated;
