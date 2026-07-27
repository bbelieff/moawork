-- C0-ENTRY-UX-BACKEND-01
-- Request lifecycle only. This migration never grants tenant access, creates a
-- membership, or derives tenant authority from the platform control plane.

-- Historical 7-day join requests remain valid records; all newly submitted
-- create and join requests receive the common 14-day review window.
alter table public.workspace_entry_requests
  drop constraint if exists workspace_entry_request_shape_check;

alter table public.workspace_entry_requests
  add constraint workspace_entry_request_shape_check check (
    (
      kind = 'create'
      and desired_name is not null
      and desired_slug is not null
      and char_length(desired_name) between 1 and 80
      and char_length(desired_slug) between 3 and 40
      and desired_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      and desired_slug not in (
        '_next', 'account', 'admin', 'api', 'auth', 'boards', 'contract',
        'dash', 'login', 'logout', 'newcust', 'notices', 'onboarding',
        'platform', 'policyfund', 'settings', 'support', 'w', 'work',
        'workspace-entry', 'workspaces', 'www'
      )
      and lookup_digest is null
      and (review_expires_at is null or review_expires_at = created_at + interval '14 days')
    )
    or (
      kind = 'join'
      and desired_name is null
      and desired_slug is null
      and lookup_digest is not null
      and review_expires_at in (
        created_at + interval '7 days',
        created_at + interval '14 days'
      )
    )
  );

alter table public.workspace_entry_requests
  drop constraint if exists workspace_entry_review_window_shape_check;

alter table public.workspace_entry_requests
  add constraint workspace_entry_review_window_shape_check check (
    review_expires_at is null or review_expires_at > created_at
  );

-- Advisory locks in the RPCs are the concurrency authority. These lookup
-- indexes support the same dedupe decisions without changing old records.
create index if not exists workspace_entry_pending_create_payload_idx
  on public.workspace_entry_requests (requester_user_id, payload_digest, created_at)
  where kind = 'create' and status = 'pending';

create index if not exists workspace_entry_pending_join_lookup_idx
  on public.workspace_entry_requests (requester_user_id, lookup_digest, created_at)
  where kind = 'join' and status = 'pending';

create or replace function public.submit_workspace_create_request(
  p_request_id uuid,
  p_name text,
  p_slug text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := public.normalize_workspace_slug(coalesce(p_slug, ''));
  v_created_at timestamptz := clock_timestamp();
  v_payload_digest bytea;
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
  if char_length(v_name) not between 1 and 80 then
    raise exception 'workspace name length invalid' using errcode = '22023';
  end if;
  if char_length(v_slug) not between 3 and 40
     or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or v_slug in (
       '_next', 'account', 'admin', 'api', 'auth', 'boards', 'contract',
       'dash', 'login', 'logout', 'newcust', 'notices', 'onboarding',
       'platform', 'policyfund', 'settings', 'support', 'w', 'work',
       'workspace-entry', 'workspaces', 'www'
     ) then
    raise exception 'workspace address invalid' using errcode = '22023';
  end if;

  v_payload_digest := digest(convert_to('create:' || v_name || ':' || v_slug, 'utf8'), 'sha256');
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || encode(v_payload_digest, 'hex'), 0));

  with expired as (
    update public.workspace_entry_requests request
    set status = 'rejected', decision_code = 'review_window_expired',
        resolved_by = null, resolved_at = request.review_expires_at
    where request.requester_user_id = v_user_id
      and request.kind = 'create'
      and request.status = 'pending'
      and request.review_expires_at is not null
      and request.review_expires_at <= v_created_at
    returning request.id, request.target_org_id
  )
  insert into public.workspace_entry_events (request_id, org_id, event_type, outcome, metadata)
  select id, target_org_id, 'create_request_expired', 'rejected',
         jsonb_build_object('source', 'deadline')
  from expired;

  select * into v_existing
  from public.workspace_entry_requests
  where requester_user_id = v_user_id
    and kind = 'create'
    and payload_digest = v_payload_digest
    and status = 'pending'
    and review_expires_at > v_created_at
  order by created_at, id
  limit 1;

  if found then
    return jsonb_build_object('accepted', true);
  end if;

  insert into public.workspace_entry_requests (
    id, requester_user_id, kind, desired_name, desired_slug, payload_digest,
    created_at, review_expires_at
  ) values (
    p_request_id, v_user_id, 'create', v_name, v_slug, v_payload_digest,
    v_created_at, v_created_at + interval '14 days'
  ) on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_existing
  from public.workspace_entry_requests where id = p_request_id;
  if v_existing.requester_user_id <> v_user_id
     or v_existing.kind <> 'create'
     or v_existing.payload_digest <> v_payload_digest then
    raise exception 'idempotency key reuse with different request' using errcode = '22023';
  end if;

  if v_inserted = 1 then
    insert into public.workspace_entry_events (request_id, actor_user_id, event_type, outcome, metadata)
    values (p_request_id, v_user_id, 'create_request_submitted', 'accepted', jsonb_build_object('kind', 'create'));
  end if;

  return jsonb_build_object('accepted', true);
end;
$$;

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
  v_payload_digest := digest(convert_to('join:' || encode(v_lookup_digest, 'hex'), 'utf8'), 'sha256');
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

create or replace function public.count_pending_workspace_join_requests(p_org_id uuid)
  returns integer
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_protected_workspace_owner(p_org_id) then
    raise exception 'protected workspace owner required' using errcode = '42501';
  end if;
  return (
    select count(*)::integer
    from public.workspace_entry_requests request
    where request.kind = 'join' and request.status = 'pending'
      and request.target_org_id = p_org_id
      and request.review_expires_at > clock_timestamp()
  );
end;
$$;

create or replace function public.cancel_workspace_entry_request(p_request_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.workspace_entry_requests%rowtype;
begin
  select * into v_request from public.workspace_entry_requests where id = p_request_id for update;
  if not found or v_actor is null or v_request.requester_user_id <> v_actor then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if v_request.status = 'cancelled' then
    return jsonb_build_object('accepted', true, 'replayed', true, 'status', 'cancelled');
  end if;
  if v_request.status = 'pending'
     and v_request.review_expires_at is not null
     and v_request.review_expires_at <= clock_timestamp() then
    update public.workspace_entry_requests
    set status = 'rejected', decision_code = 'review_window_expired',
        resolved_by = null, resolved_at = review_expires_at
    where id = p_request_id;
    insert into public.workspace_entry_events (request_id, org_id, event_type, outcome, metadata)
    values (p_request_id, v_request.target_org_id, 'entry_request_expired', 'rejected', jsonb_build_object('source', 'deadline'));
    return jsonb_build_object('accepted', true, 'replayed', false, 'status', 'expired');
  end if;
  if v_request.status <> 'pending' then
    raise exception 'only a pending request can be cancelled' using errcode = '23514';
  end if;
  update public.workspace_entry_requests
  set status = 'cancelled', decision_code = 'cancelled_by_requester',
      resolved_by = v_actor, resolved_at = clock_timestamp()
  where id = p_request_id;
  insert into public.workspace_entry_events (request_id, org_id, actor_user_id, event_type, outcome, metadata)
  values (p_request_id, v_request.target_org_id, v_actor, 'entry_request_cancelled', 'cancelled', '{}'::jsonb);
  return jsonb_build_object('accepted', true, 'replayed', false, 'status', 'cancelled');
end;
$$;

create or replace function public.list_pending_workspace_create_requests()
  returns table (request_id uuid, desired_name text, desired_slug text, created_at timestamptz)
  language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  return query
    select request.id, request.desired_name, request.desired_slug, request.created_at
    from public.workspace_entry_requests request
    where request.kind = 'create' and request.status = 'pending'
      and request.review_expires_at > clock_timestamp()
    order by request.created_at, request.id;
end;
$$;

create or replace function public.list_my_workspace_entry_requests()
  returns table (
    request_id uuid, entry_kind text, request_status text, created_at timestamptz,
    review_deadline timestamptz, resolved_at timestamptz, decision_state text,
    approved_target_slug text
  )
  language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  with expired as (
    update public.workspace_entry_requests request
    set status = 'rejected', decision_code = 'review_window_expired',
        resolved_by = null, resolved_at = request.review_expires_at
    where request.requester_user_id = v_actor and request.status = 'pending'
      and request.review_expires_at is not null
      and request.review_expires_at <= clock_timestamp()
    returning request.id, request.target_org_id, request.kind
  )
  insert into public.workspace_entry_events (request_id, org_id, event_type, outcome, metadata)
  select id, target_org_id, kind || '_request_expired', 'rejected', jsonb_build_object('source', 'deadline')
  from expired;
  return query
    select request.id, request.kind, request.status, request.created_at,
           request.review_expires_at, request.resolved_at,
           case when request.status = 'pending' then 'pending'
                when request.status = 'approved' then 'approved'
                when request.status = 'cancelled' then 'cancelled'
                else 'not_approved' end,
           case when request.status = 'approved' and organization.status = 'active'
                  and exists (
                    select 1 from public.org_members membership
                    where membership.org_id = request.target_org_id
                      and membership.user_id = v_actor and membership.status = 'active'
                  ) then organization.slug else null end
    from public.workspace_entry_requests request
    left join public.orgs organization on organization.id = request.target_org_id
    where request.requester_user_id = v_actor
    order by request.created_at desc, request.id desc;
end;
$$;

revoke all on function public.count_pending_workspace_join_requests(uuid) from public, anon;
grant execute on function public.count_pending_workspace_join_requests(uuid) to authenticated;

comment on function public.count_pending_workspace_join_requests(uuid) is
  'Protected-owner-only aggregate for an active workspace; no requester or rejection detail is returned.';
comment on function public.list_my_workspace_entry_requests() is
  'Requester-owned lifecycle read; all new requests expire after 14 days. Expiry is lazy-on-read/RPC; no periodic scheduler is introduced by 009.';
