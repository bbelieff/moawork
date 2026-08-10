-- =====================================================================
-- 030_workspace_entry_create_deadline_repair.sql
--
-- 018 redefined submit_workspace_create_request to support direct creation
-- by platform admins, but omitted the 14-day lifecycle introduced by 009.
-- Normal-user requests could therefore remain pending with a NULL deadline:
-- hidden from the admin queue while still appearing to the requester forever.
--
-- This forward-only repair:
--   1. backfills only pending create requests with a missing deadline;
--   2. prevents that invalid pending shape from recurring; and
--   3. merges the 009 lifecycle with the 018 platform-admin fast path.
--
-- Existing approved/cancelled/rejected rows, RLS policies, app_admins and
-- is_org_member() are intentionally untouched.
-- =====================================================================

update public.workspace_entry_requests
set review_expires_at = created_at + interval '14 days'
where kind = 'create'
  and status = 'pending'
  and review_expires_at is null;

alter table public.workspace_entry_requests
  drop constraint if exists workspace_entry_pending_create_deadline_check;

alter table public.workspace_entry_requests
  add constraint workspace_entry_pending_create_deadline_check check (
    kind <> 'create'
    or status <> 'pending'
    or review_expires_at is not null
  );

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
  v_updated integer;
  v_is_platform_admin boolean;
  v_org_id uuid;
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
       '_next', 'account', 'admin', 'api', 'auth', 'boards', 'companies',
       'contract', 'dash', 'deals', 'login', 'logout', 'mode', 'newcust',
       'notices', 'onboarding', 'platform', 'policyfund', 'settings',
       'support', 'w', 'work', 'workspace-entry', 'workspaces', 'www'
     ) then
    raise exception 'workspace address invalid' using errcode = '22023';
  end if;

  v_payload_digest := digest(
    convert_to('create:' || v_name || ':' || v_slug, 'utf8'),
    'sha256'
  );

  -- The unique pending-create contract is per requester, so serialize at the
  -- same scope. This also makes expiry + replacement one atomic transition.
  perform pg_advisory_xact_lock(
    hashtextextended('workspace-create:' || v_user_id::text, 0)
  );

  with expired as (
    update public.workspace_entry_requests request
    set status = 'rejected',
        decision_code = 'review_window_expired',
        resolved_by = null,
        resolved_at = request.review_expires_at
    where request.requester_user_id = v_user_id
      and request.kind = 'create'
      and request.status = 'pending'
      and request.review_expires_at <= v_created_at
    returning request.id, request.target_org_id
  )
  insert into public.workspace_entry_events (
    request_id, org_id, event_type, outcome, metadata
  )
  select id, target_org_id, 'create_request_expired', 'rejected',
         jsonb_build_object('source', 'deadline')
  from expired;

  select * into v_existing
  from public.workspace_entry_requests
  where id = p_request_id;

  if found then
    if v_existing.requester_user_id <> v_user_id
       or v_existing.kind <> 'create'
       or v_existing.payload_digest <> v_payload_digest then
      raise exception 'idempotency key reuse with different request'
        using errcode = '22023';
    end if;
  else
    -- Preserve 009's same-payload replay behavior for a still-live request.
    select * into v_existing
    from public.workspace_entry_requests
    where requester_user_id = v_user_id
      and kind = 'create'
      and payload_digest = v_payload_digest
      and status = 'pending'
      and review_expires_at > v_created_at
    order by created_at, id
    limit 1;

    if not found then
      insert into public.workspace_entry_requests (
        id, requester_user_id, kind, desired_name, desired_slug,
        payload_digest, created_at, review_expires_at
      ) values (
        p_request_id, v_user_id, 'create', v_name, v_slug,
        v_payload_digest, v_created_at, v_created_at + interval '14 days'
      )
      on conflict (id) do nothing;
      get diagnostics v_inserted = row_count;

      select * into v_existing
      from public.workspace_entry_requests
      where id = p_request_id;

      if v_existing.requester_user_id <> v_user_id
         or v_existing.kind <> 'create'
         or v_existing.payload_digest <> v_payload_digest then
        raise exception 'idempotency key reuse with different request'
          using errcode = '22023';
      end if;

      if v_inserted = 1 then
        insert into public.workspace_entry_events (
          request_id, actor_user_id, event_type, outcome, metadata
        ) values (
          p_request_id, v_user_id, 'create_request_submitted', 'accepted',
          jsonb_build_object('kind', 'create')
        );
      end if;
    end if;
  end if;

  -- resolve_workspace_create_request locks the request row before taking the
  -- slug advisory lock. Use the same order so an admin decision cannot race
  -- with this direct-create path or produce conflicting audit outcomes.
  select * into v_existing
  from public.workspace_entry_requests
  where id = v_existing.id
  for update;

  v_is_platform_admin := public.is_platform_admin();

  if not v_is_platform_admin then
    return jsonb_build_object('accepted', true);
  end if;

  if v_existing.status = 'approved' then
    return jsonb_build_object(
      'accepted', true,
      'auto_approved', true,
      'replayed', true,
      'status', 'approved',
      'org_id', v_existing.target_org_id,
      'slug', v_existing.desired_slug
    );
  end if;

  if v_existing.status <> 'pending' then
    raise exception 'request already resolved with a different outcome'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('workspace-slug:' || v_existing.desired_slug, 0)
  );

  insert into public.orgs (name, slug, status)
  values (v_existing.desired_name, v_existing.desired_slug, 'active')
  returning id into v_org_id;

  insert into public.org_members (org_id, user_id, role, scope, status)
  values (v_org_id, v_user_id, 'owner', 'all', 'active');

  update public.workspace_entry_requests
  set status = 'approved',
      target_org_id = v_org_id,
      decision_code = 'platform_admin_direct_create',
      resolved_by = v_user_id,
      resolved_at = v_created_at
  where id = v_existing.id
    and status = 'pending';
  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    raise exception 'request already resolved with a different outcome'
      using errcode = '23505';
  end if;

  insert into public.workspace_entry_events (
    request_id, org_id, actor_user_id, event_type, outcome, metadata
  ) values (
    v_existing.id, v_org_id, v_user_id,
    'create_request_resolved', 'approved',
    jsonb_build_object(
      'owner_created', true,
      'platform_admin_direct_create', true,
      'reason', 'platform admin direct create',
      'self_approved', true
    )
  );

  return jsonb_build_object(
    'accepted', true,
    'auto_approved', true,
    'replayed', false,
    'status', 'approved',
    'org_id', v_org_id,
    'slug', v_existing.desired_slug
  );
end;
$$;

revoke all on function public.submit_workspace_create_request(uuid, text, text)
  from public, anon;
grant execute on function public.submit_workspace_create_request(uuid, text, text)
  to authenticated;
