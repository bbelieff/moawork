-- PUBLIC-WORKSPACE-ENTRY-01 / T03 / Lane C DB-RPC-RLS
-- CHECKPOINT exploration-complete 2026-07-27 KST
-- Base: 00929168ea440a2532e632b7141135b956b91fca (001..005 only).
-- Ordering decision: 001..005 -> this strict 006 -> compatible app cutover ->
-- non-overlapping P0/session/profile work under a newly assigned number ->
-- first-lead under a later number. Historical auto-first-lead 007 is not reused.
-- Release gate: this migration revokes legacy direct org/member writes. Deploy only
-- in a maintenance/read-only window with the compatible RPC caller ready. It is
-- intentionally fail-closed and never repairs ambiguous production ownership.
-- Operational gate: disposable PostgreSQL tests are mandatory; hosted/production
-- migration, PostgREST/pooler, and production credentials are outside this lane.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Workspace identity and exact-one protected owner invariant
-- ---------------------------------------------------------------------------

alter table public.orgs
  add column if not exists slug text;

alter table public.orgs
  add column if not exists status text not null default 'active';

alter table public.org_members
  add column if not exists status text not null default 'active';

alter table public.orgs
  drop constraint if exists orgs_status_check;

alter table public.orgs
  add constraint orgs_status_check
  check (status in ('active', 'provisioning', 'suspended', 'pending_delete', 'deleted'));

alter table public.org_members
  drop constraint if exists org_members_status_check;

alter table public.org_members
  add constraint org_members_status_check
  check (status in ('active', 'invited', 'pending', 'suspended', 'removed', 'leave', 'expired'));

alter table public.orgs
  drop constraint if exists orgs_slug_format_check;

alter table public.orgs
  add constraint orgs_slug_format_check
  check (
    slug is null
    or (
      slug = lower(slug)
      and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      and char_length(slug) between 3 and 40
      and slug not in (
        'account', 'admin', 'api', 'auth', 'login', 'logout', 'platform',
        'settings', 'support', 'workspace-entry', 'workspaces', 'www'
      )
    )
  );

create unique index if not exists orgs_slug_unique_idx
  on public.orgs (lower(slug))
  where slug is not null;

do $$
declare
  v_invalid_count bigint;
begin
  select count(*)
    into v_invalid_count
  from public.orgs organization
  where (
    select count(*)
    from public.org_members membership
    where membership.org_id = organization.id
      and membership.role = 'owner'
  ) <> 1;

  if v_invalid_count <> 0 then
    raise exception
      'P0 preflight failed: % workspace(s) do not have exactly one owner; manual decision required',
      v_invalid_count
      using errcode = '23514';
  end if;
end;
$$;

alter table public.org_members
  drop constraint if exists org_members_owner_scope_all_check;

alter table public.org_members
  drop constraint if exists org_members_protected_owner_check;

alter table public.org_members
  add constraint org_members_protected_owner_check
  check (role <> 'owner' or (scope = 'all' and status = 'active'));

create unique index if not exists org_members_exactly_one_owner_max_idx
  on public.org_members (org_id)
  where role = 'owner';

create or replace function public.assert_workspace_exactly_one_owner(p_org_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_owner_count integer;
begin
  if p_org_id is null
     or not exists (select 1 from public.orgs where id = p_org_id) then
    return;
  end if;

  select count(*)::integer
    into v_owner_count
  from public.org_members
  where org_id = p_org_id
    and role = 'owner';

  if v_owner_count <> 1 then
    raise exception 'workspace must have exactly one protected owner'
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.assert_workspace_exactly_one_owner(uuid) from public;
revoke all on function public.assert_workspace_exactly_one_owner(uuid) from anon;
revoke all on function public.assert_workspace_exactly_one_owner(uuid) from authenticated;

create or replace function public.enforce_workspace_owner_from_org()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.assert_workspace_exactly_one_owner(new.id);
  end if;

  if tg_op = 'UPDATE' and old.id is distinct from new.id then
    perform public.assert_workspace_exactly_one_owner(old.id);
  end if;

  return null;
end;
$$;

create or replace function public.enforce_workspace_owner_from_membership()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.assert_workspace_exactly_one_owner(old.org_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and (tg_op = 'INSERT' or old.org_id is distinct from new.org_id or old.role is distinct from new.role) then
    perform public.assert_workspace_exactly_one_owner(new.org_id);
  end if;

  return null;
end;
$$;

drop trigger if exists orgs_exactly_one_owner_deferred on public.orgs;
create constraint trigger orgs_exactly_one_owner_deferred
  after insert or update on public.orgs
  deferrable initially deferred
  for each row execute function public.enforce_workspace_owner_from_org();

drop trigger if exists org_members_exactly_one_owner_deferred on public.org_members;
create constraint trigger org_members_exactly_one_owner_deferred
  after insert or update or delete on public.org_members
  deferrable initially deferred
  for each row execute function public.enforce_workspace_owner_from_membership();

-- The 001 trigger allowed any authenticated account to create a workspace and
-- silently become owner. Public entry now has one atomic approval path instead.
drop trigger if exists trg_orgs_add_owner on public.orgs;
drop function if exists public.add_org_owner();

-- Replace the 001 helpers so every existing tenant policy fails closed for an
-- inactive workspace or membership. Status is not a presentation-only field.
create or replace function public.is_org_member(p_org uuid)
  returns boolean
  language sql stable security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members membership
    join public.orgs organization on organization.id = membership.org_id
    where membership.org_id = p_org
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and organization.status = 'active'
  );
$$;

create or replace function public.org_role(p_org uuid)
  returns public.member_role
  language sql stable security definer
  set search_path = public, pg_temp
as $$
  select membership.role
  from public.org_members membership
  join public.orgs organization on organization.id = membership.org_id
  where membership.org_id = p_org
    and membership.user_id = auth.uid()
    and membership.status = 'active'
    and organization.status = 'active'
$$;

create or replace function public.org_scope(p_org uuid)
  returns public.member_scope
  language sql stable security definer
  set search_path = public, pg_temp
as $$
  select membership.scope
  from public.org_members membership
  join public.orgs organization on organization.id = membership.org_id
  where membership.org_id = p_org
    and membership.user_id = auth.uid()
    and membership.status = 'active'
    and organization.status = 'active'
$$;

-- ---------------------------------------------------------------------------
-- Request, digest-only invite, and dedicated immutable audit structures
-- ---------------------------------------------------------------------------

create table if not exists public.workspace_entry_requests (
  id uuid primary key,
  requester_user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('create', 'join')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  desired_name text,
  desired_slug text,
  target_org_id uuid references public.orgs(id) on delete set null,
  invite_code_id uuid,
  lookup_digest bytea,
  payload_digest bytea not null,
  decision_code text,
  resolved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  review_expires_at timestamptz,
  resolved_at timestamptz,
  constraint workspace_entry_request_shape_check check (
    (
      kind = 'create'
      and desired_name is not null
      and desired_slug is not null
      and char_length(desired_name) between 1 and 80
      and char_length(desired_slug) between 3 and 40
      and desired_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      and desired_slug not in (
        'account', 'admin', 'api', 'auth', 'login', 'logout', 'platform',
        'settings', 'support', 'workspace-entry', 'workspaces', 'www'
      )
      and lookup_digest is null
    )
    or (
      kind = 'join'
      and desired_name is null
      and desired_slug is null
      and lookup_digest is not null
      and review_expires_at is not null
      and review_expires_at = created_at + interval '7 days'
    )
  ),
  constraint workspace_entry_review_window_shape_check check (
    (kind = 'create' and review_expires_at is null)
    or (kind = 'join' and review_expires_at > created_at)
  ),
  constraint workspace_entry_resolution_shape_check check (
    (status = 'pending' and resolved_at is null and resolved_by is null)
    or (status <> 'pending' and resolved_at is not null)
  )
);

create unique index if not exists workspace_entry_one_pending_join_idx
  on public.workspace_entry_requests (requester_user_id, target_org_id)
  where kind = 'join' and status = 'pending' and target_org_id is not null;

create index if not exists workspace_entry_pending_create_idx
  on public.workspace_entry_requests (created_at, id)
  where kind = 'create' and status = 'pending';

create index if not exists workspace_entry_pending_join_idx
  on public.workspace_entry_requests (target_org_id, created_at, id)
  where kind = 'join' and status = 'pending' and target_org_id is not null;

create table if not exists public.workspace_invite_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  code_digest bytea not null unique,
  created_by uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  use_limit integer not null default 1 check (use_limit between 1 and 1000),
  use_count integer not null default 0 check (use_count >= 0 and use_count <= use_limit),
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

create table if not exists public.workspace_entry_events (
  id bigint generated always as identity primary key,
  request_id uuid references public.workspace_entry_requests(id) on delete set null,
  org_id uuid references public.orgs(id) on delete set null,
  actor_user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  outcome text not null check (outcome in ('accepted', 'approved', 'rejected', 'cancelled', 'replayed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workspace_entry_event_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.workspace_entry_requests enable row level security;
alter table public.workspace_entry_requests force row level security;
alter table public.workspace_invite_codes enable row level security;
alter table public.workspace_invite_codes force row level security;
alter table public.workspace_entry_events enable row level security;
alter table public.workspace_entry_events force row level security;

-- CHECKPOINT first-write 2026-07-27 KST
-- Exact base/branch were re-read clean immediately before this file was added.
-- This is the first and only product-schema path in the exclusive lease.

alter table public.workspace_entry_requests
  add constraint workspace_entry_request_invite_fk
  foreign key (invite_code_id) references public.workspace_invite_codes(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Trusted identity/authorization helpers. Platform authority is control-plane
-- only; it is never interpreted as workspace membership or tenant-data access.
-- ---------------------------------------------------------------------------

create or replace function public.normalize_workspace_slug(p_value text)
  returns text
  language sql
  immutable
  strict
  set search_path = public, pg_temp
as $$
  select lower(btrim(p_value));
$$;

create or replace function public.workspace_lookup_digest(p_value text)
  returns bytea
  language sql
  immutable
  strict
  set search_path = public, extensions, pg_temp
as $$
  select digest(convert_to(lower(btrim(p_value)), 'utf8'), 'sha256');
$$;

create or replace function public.is_platform_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from auth.users auth_user
    join public.app_admins platform_admin
      on lower(platform_admin.email) = lower(auth_user.email)
    where auth_user.id = auth.uid()
      and platform_admin.is_platform is true
      and platform_admin.role = 'admin'
  );
$$;

create or replace function public.is_protected_workspace_owner(p_org_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members membership
    join public.orgs organization on organization.id = membership.org_id
    where membership.org_id = p_org_id
      and membership.user_id = auth.uid()
      and membership.role = 'owner'
      and membership.scope = 'all'
      and membership.status = 'active'
      and organization.status = 'active'
  );
$$;

create or replace function public.shares_workspace_with(p_other_user_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select p_other_user_id = auth.uid()
    or exists (
      select 1
      from public.org_members mine
      join public.org_members theirs on theirs.org_id = mine.org_id
      join public.orgs organization on organization.id = mine.org_id
      where mine.user_id = auth.uid()
        and theirs.user_id = p_other_user_id
        and mine.status = 'active'
        and theirs.status = 'active'
        and organization.status = 'active'
    );
$$;

revoke all on function public.normalize_workspace_slug(text) from public;
revoke all on function public.workspace_lookup_digest(text) from public;
revoke all on function public.is_platform_admin() from public;
revoke all on function public.is_protected_workspace_owner(uuid) from public;
revoke all on function public.shares_workspace_with(uuid) from public;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_protected_workspace_owner(uuid) to authenticated;
grant execute on function public.shares_workspace_with(uuid) to authenticated;

-- A lookup never confirms whether a slug/code exists. Resolution happens only
-- inside submit_workspace_join_request and the response has a constant shape.
create or replace function public.lookup_workspace_entry(p_lookup text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform public.workspace_lookup_digest(coalesce(p_lookup, ''));
  return jsonb_build_object('accepted', true);
end;
$$;

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
       'account', 'admin', 'api', 'auth', 'login', 'logout', 'platform',
       'settings', 'support', 'workspace-entry', 'workspaces', 'www'
     ) then
    raise exception 'workspace address invalid' using errcode = '22023';
  end if;

  v_payload_digest := digest(
    convert_to('create:' || v_name || ':' || v_slug, 'utf8'),
    'sha256'
  );
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_request_id::text, 0));

  insert into public.workspace_entry_requests (
    id, requester_user_id, kind, desired_name, desired_slug, payload_digest
  ) values (
    p_request_id, v_user_id, 'create', v_name, v_slug, v_payload_digest
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

  return jsonb_build_object('accepted', true);
end;
$$;

create or replace function public.resolve_workspace_create_request(
  p_request_id uuid,
  p_approve boolean,
  p_decision_code text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.workspace_entry_requests%rowtype;
  v_org_id uuid;
  v_expected_status text := case when p_approve then 'approved' else 'rejected' end;
begin
  if v_actor is null or not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = '42501';
  end if;

  select * into v_request
  from public.workspace_entry_requests
  where id = p_request_id and kind = 'create'
  for update;

  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'pending' then
    if v_request.status = v_expected_status then
      return jsonb_build_object(
        'accepted', true,
        'replayed', true,
        'status', v_request.status,
        'org_id', v_request.target_org_id
      );
    end if;
    raise exception 'request already resolved with a different outcome'
      using errcode = '23505';
  end if;

  if p_approve then
    perform pg_advisory_xact_lock(hashtextextended('workspace-slug:' || v_request.desired_slug, 0));

    insert into public.orgs (name, slug, status)
    values (v_request.desired_name, v_request.desired_slug, 'active')
    returning id into v_org_id;

    insert into public.org_members (org_id, user_id, role, scope, status)
    values (v_org_id, v_request.requester_user_id, 'owner', 'all', 'active');

    update public.workspace_entry_requests
    set status = 'approved',
        target_org_id = v_org_id,
        decision_code = coalesce(nullif(btrim(p_decision_code), ''), 'approved'),
        resolved_by = v_actor,
        resolved_at = now()
    where id = p_request_id;

    insert into public.workspace_entry_events (
      request_id, org_id, actor_user_id, event_type, outcome, metadata
    ) values (
      p_request_id, v_org_id, v_actor, 'create_request_resolved', 'approved',
      jsonb_build_object('owner_created', true)
    );

    return jsonb_build_object(
      'accepted', true, 'replayed', false, 'status', 'approved', 'org_id', v_org_id
    );
  end if;

  update public.workspace_entry_requests
  set status = 'rejected',
      decision_code = coalesce(nullif(btrim(p_decision_code), ''), 'rejected'),
      resolved_by = v_actor,
      resolved_at = now()
  where id = p_request_id;

  insert into public.workspace_entry_events (
    request_id, actor_user_id, event_type, outcome, metadata
  ) values (
    p_request_id, v_actor, 'create_request_resolved', 'rejected', '{}'::jsonb
  );

  return jsonb_build_object('accepted', true, 'replayed', false, 'status', 'rejected');
end;
$$;

create or replace function public.create_workspace_invite_code(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_expires_at timestamptz,
  p_use_limit integer default 1
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_code text;
  v_invite_id uuid;
begin
  if v_actor is null or not public.is_protected_workspace_owner(p_org_id) then
    raise exception 'protected workspace owner required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_expires_at <= now() then
    raise exception 'valid idempotency key and future expiry required' using errcode = '22023';
  end if;
  if p_use_limit not between 1 and 1000 then
    raise exception 'invite use limit invalid' using errcode = '22023';
  end if;

  select id into v_invite_id
  from public.workspace_invite_codes
  where org_id = p_org_id and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object('accepted', true, 'replayed', true, 'invite_id', v_invite_id, 'code', null);
  end if;

  v_code := 'mw_' || encode(gen_random_bytes(18), 'hex');
  insert into public.workspace_invite_codes (
    org_id, code_digest, created_by, idempotency_key, expires_at, use_limit
  ) values (
    p_org_id, public.workspace_lookup_digest(v_code), v_actor,
    p_idempotency_key, p_expires_at, p_use_limit
  ) returning id into v_invite_id;

  insert into public.workspace_entry_events (
    org_id, actor_user_id, event_type, outcome, metadata
  ) values (
    p_org_id, v_actor, 'invite_created', 'accepted',
    jsonb_build_object('invite_id', v_invite_id, 'use_limit', p_use_limit)
  );

  return jsonb_build_object(
    'accepted', true, 'replayed', false, 'invite_id', v_invite_id, 'code', v_code
  );
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

  -- Empty, malformed, unknown, and known lookups all produce the same public
  -- response. Only a one-way digest is retained for join attempts.
  v_lookup_digest := public.workspace_lookup_digest(v_lookup);
  v_payload_digest := digest(
    convert_to('join:' || encode(v_lookup_digest, 'hex'), 'utf8'),
    'sha256'
  );

  if v_lookup ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    select id into v_target_org_id
    from public.orgs
    where lower(slug) = v_lookup
    limit 1;
  end if;

  if v_target_org_id is null then
    select invite.id, invite.org_id
      into v_invite_id, v_target_org_id
    from public.workspace_invite_codes invite
    where invite.code_digest = v_lookup_digest
      and invite.revoked_at is null
      and invite.expires_at > now()
      and invite.use_count < invite.use_limit
    limit 1;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || coalesce(v_target_org_id::text, encode(v_lookup_digest, 'hex')), 0)
  );

  if v_target_org_id is not null and exists (
    select 1 from public.org_members
    where org_id = v_target_org_id and user_id = v_user_id
  ) then
    v_target_org_id := null;
    v_invite_id := null;
  elsif v_target_org_id is not null and exists (
    select 1 from public.workspace_entry_requests
    where requester_user_id = v_user_id
      and target_org_id = v_target_org_id
      and kind = 'join'
      and status = 'pending'
      and review_expires_at > v_created_at
  ) then
    v_target_org_id := null;
    v_invite_id := null;
  end if;

  insert into public.workspace_entry_requests (
    id, requester_user_id, kind, status, target_org_id, invite_code_id,
    lookup_digest, payload_digest, created_at, review_expires_at
  ) values (
    p_request_id, v_user_id, 'join', 'pending', v_target_org_id, v_invite_id,
    v_lookup_digest, v_payload_digest, v_created_at, v_created_at + interval '7 days'
  )
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_existing
  from public.workspace_entry_requests
  where id = p_request_id;

  if v_existing.requester_user_id <> v_user_id
     or v_existing.kind <> 'join'
     or v_existing.payload_digest <> v_payload_digest then
    raise exception 'idempotency key reuse with different request'
      using errcode = '22023';
  end if;

  if v_inserted = 1 then
    insert into public.workspace_entry_events (
      request_id, org_id, actor_user_id, event_type, outcome, metadata
    ) values (
      p_request_id, v_target_org_id, v_user_id, 'join_request_submitted', 'accepted',
      jsonb_build_object('kind', 'join')
    );
  end if;

  return jsonb_build_object('accepted', true);
end;
$$;

create or replace function public.resolve_workspace_join_request(
  p_request_id uuid,
  p_approve boolean,
  p_decision_code text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.workspace_entry_requests%rowtype;
  v_invite public.workspace_invite_codes%rowtype;
  v_expected_status text := case when p_approve then 'approved' else 'rejected' end;
begin
  select * into v_request
  from public.workspace_entry_requests
  where id = p_request_id and kind = 'join'
  for update;

  if not found or v_request.target_org_id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if v_actor is null or not public.is_protected_workspace_owner(v_request.target_org_id) then
    raise exception 'protected workspace owner required' using errcode = '42501';
  end if;

  if v_request.status = 'pending'
     and v_request.review_expires_at <= clock_timestamp() then
    update public.workspace_entry_requests
    set status = 'rejected',
        decision_code = 'review_window_expired',
        resolved_by = null,
        resolved_at = review_expires_at
    where id = p_request_id;

    insert into public.workspace_entry_events (
      request_id, org_id, actor_user_id, event_type, outcome, metadata
    ) values (
      p_request_id, v_request.target_org_id, null,
      'join_request_expired', 'rejected',
      jsonb_build_object('reason', 'review_window_expired', 'source', 'deadline')
    );

    return jsonb_build_object(
      'accepted', true, 'replayed', false, 'status', 'rejected', 'expired', true
    );
  end if;

  if v_request.status <> 'pending' then
    if v_request.status = v_expected_status then
      return jsonb_build_object('accepted', true, 'replayed', true, 'status', v_request.status);
    end if;
    raise exception 'request already resolved with a different outcome'
      using errcode = '23505';
  end if;

  if p_approve then
    if exists (
      select 1 from public.org_members
      where org_id = v_request.target_org_id
        and user_id = v_request.requester_user_id
    ) then
      raise exception 'requester already has workspace membership'
        using errcode = '23505';
    end if;

    if v_request.invite_code_id is not null then
      select * into v_invite
      from public.workspace_invite_codes
      where id = v_request.invite_code_id
      for update;

      if not found
         or v_invite.org_id <> v_request.target_org_id
         or v_invite.revoked_at is not null
         or v_invite.expires_at <= now()
         or v_invite.use_count >= v_invite.use_limit then
        raise exception 'invite is no longer actionable' using errcode = '23514';
      end if;

      update public.workspace_invite_codes
      set use_count = use_count + 1
      where id = v_invite.id;
    end if;

    -- The payload cannot choose a role or scope. Every approved join begins at
    -- the least-privileged base membership and never becomes owner/admin.
    insert into public.org_members (org_id, user_id, role, scope, status)
    values (v_request.target_org_id, v_request.requester_user_id, 'member', 'assigned', 'active');

    update public.workspace_entry_requests
    set status = 'approved',
        decision_code = coalesce(nullif(btrim(p_decision_code), ''), 'approved'),
        resolved_by = v_actor,
        resolved_at = now()
    where id = p_request_id;

    insert into public.workspace_entry_events (
      request_id, org_id, actor_user_id, event_type, outcome, metadata
    ) values (
      p_request_id, v_request.target_org_id, v_actor,
      'join_request_resolved', 'approved',
      jsonb_build_object('role', 'member', 'scope', 'assigned')
    );

    return jsonb_build_object('accepted', true, 'replayed', false, 'status', 'approved');
  end if;

  update public.workspace_entry_requests
  set status = 'rejected',
      decision_code = coalesce(nullif(btrim(p_decision_code), ''), 'rejected'),
      resolved_by = v_actor,
      resolved_at = now()
  where id = p_request_id;

  insert into public.workspace_entry_events (
    request_id, org_id, actor_user_id, event_type, outcome, metadata
  ) values (
    p_request_id, v_request.target_org_id, v_actor,
    'join_request_resolved', 'rejected', '{}'::jsonb
  );

  return jsonb_build_object('accepted', true, 'replayed', false, 'status', 'rejected');
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
  select * into v_request
  from public.workspace_entry_requests
  where id = p_request_id
  for update;

  if not found or v_actor is null or v_request.requester_user_id <> v_actor then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if v_request.status = 'cancelled' then
    return jsonb_build_object('accepted', true, 'replayed', true, 'status', 'cancelled');
  end if;
  if v_request.status <> 'pending' then
    raise exception 'only a pending request can be cancelled' using errcode = '23514';
  end if;

  update public.workspace_entry_requests
  set status = 'cancelled', decision_code = 'cancelled_by_requester',
      resolved_by = v_actor, resolved_at = now()
  where id = p_request_id;

  insert into public.workspace_entry_events (
    request_id, org_id, actor_user_id, event_type, outcome, metadata
  ) values (
    p_request_id, v_request.target_org_id, v_actor,
    'entry_request_cancelled', 'cancelled', '{}'::jsonb
  );

  return jsonb_build_object('accepted', true, 'replayed', false, 'status', 'cancelled');
end;
$$;

-- Narrow discovery functions expose only fields needed to make a decision.
-- They do not grant direct table SELECT and do not enumerate workspaces.
create or replace function public.list_pending_workspace_create_requests()
  returns table (request_id uuid, desired_name text, desired_slug text, created_at timestamptz)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  return query
    select request.id, request.desired_name, request.desired_slug, request.created_at
    from public.workspace_entry_requests request
    where request.kind = 'create' and request.status = 'pending'
    order by request.created_at, request.id;
end;
$$;

create or replace function public.list_pending_workspace_join_requests(p_org_id uuid)
  returns table (request_id uuid, requester_user_id uuid, created_at timestamptz)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_protected_workspace_owner(p_org_id) then
    raise exception 'protected workspace owner required' using errcode = '42501';
  end if;
  return query
    select request.id, request.requester_user_id, request.created_at
    from public.workspace_entry_requests request
    where request.kind = 'join'
      and request.status = 'pending'
      and request.target_org_id = p_org_id
      and request.review_expires_at > clock_timestamp()
    order by request.created_at, request.id;
end;
$$;

create or replace function public.list_my_workspace_entry_requests()
  returns table (
    request_id uuid,
    entry_kind text,
    request_status text,
    created_at timestamptz,
    review_deadline timestamptz,
    resolved_at timestamptz,
    decision_state text,
    approved_target_slug text
  )
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
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
      and request.kind = 'join'
      and request.status = 'pending'
      and request.review_expires_at <= clock_timestamp()
    returning request.id, request.target_org_id
  )
  insert into public.workspace_entry_events (
    request_id, org_id, actor_user_id, event_type, outcome, metadata
  )
  select
    expired.id, expired.target_org_id, null,
    'join_request_expired', 'rejected',
    jsonb_build_object('reason', 'review_window_expired', 'source', 'deadline')
  from expired;

  return query
    select
      request.id,
      request.kind,
      request.status,
      request.created_at,
      request.review_expires_at,
      request.resolved_at,
      case
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
             and membership.user_id = v_actor
             and membership.status = 'active'
         )
        then organization.slug
        else null
      end
    from public.workspace_entry_requests request
    left join public.orgs organization on organization.id = request.target_org_id
    where request.requester_user_id = v_actor
    order by request.created_at desc, request.id desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock down every client-writable bypass. Existing tenant SELECT policies stay
-- unchanged in this migration; notably, Platform Admin receives no tenant read.
-- ---------------------------------------------------------------------------

drop policy if exists orgs_insert on public.orgs;
drop policy if exists orgs_update on public.orgs;
drop policy if exists orgs_delete on public.orgs;
drop policy if exists members_manage on public.org_members;
drop policy if exists users_select on public.users;
drop policy if exists users_select_tenant_scoped on public.users;
create policy users_select_tenant_scoped on public.users
  for select using (public.shares_workspace_with(id));

revoke insert, update, delete on public.orgs from public, anon, authenticated;
revoke insert, update, delete on public.org_members from public, anon, authenticated;
revoke all on public.workspace_entry_requests from public, anon, authenticated;
revoke all on public.workspace_invite_codes from public, anon, authenticated;
revoke all on public.workspace_entry_events from public, anon, authenticated;
revoke all on sequence public.workspace_entry_events_id_seq from public, anon, authenticated;

revoke all on function public.lookup_workspace_entry(text) from public, anon;
revoke all on function public.submit_workspace_create_request(uuid, text, text) from public, anon;
revoke all on function public.resolve_workspace_create_request(uuid, boolean, text) from public, anon;
revoke all on function public.create_workspace_invite_code(uuid, uuid, timestamptz, integer) from public, anon;
revoke all on function public.submit_workspace_join_request(uuid, text) from public, anon;
revoke all on function public.resolve_workspace_join_request(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_workspace_entry_request(uuid) from public, anon;
revoke all on function public.list_pending_workspace_create_requests() from public, anon;
revoke all on function public.list_pending_workspace_join_requests(uuid) from public, anon;
revoke all on function public.list_my_workspace_entry_requests() from public, anon;

grant execute on function public.lookup_workspace_entry(text) to authenticated;
grant execute on function public.submit_workspace_create_request(uuid, text, text) to authenticated;
grant execute on function public.resolve_workspace_create_request(uuid, boolean, text) to authenticated;
grant execute on function public.create_workspace_invite_code(uuid, uuid, timestamptz, integer) to authenticated;
grant execute on function public.submit_workspace_join_request(uuid, text) to authenticated;
grant execute on function public.resolve_workspace_join_request(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_workspace_entry_request(uuid) to authenticated;
grant execute on function public.list_pending_workspace_create_requests() to authenticated;
grant execute on function public.list_pending_workspace_join_requests(uuid) to authenticated;
grant execute on function public.list_my_workspace_entry_requests() to authenticated;

comment on table public.workspace_entry_requests is
  'Public-entry intent only; a request is never membership and clients have no direct DML.';
comment on table public.workspace_invite_codes is
  'Digest-only owner-issued invite codes; raw codes are returned only at initial creation.';
comment on function public.resolve_workspace_create_request(uuid, boolean, text) is
  'Platform control-plane approval; atomically creates workspace, exact-one owner, request result, and audit.';
comment on function public.resolve_workspace_join_request(uuid, boolean, text) is
  'Protected-owner-only resolution; approval always inserts member/assigned and never owner/admin.';
comment on function public.list_my_workspace_entry_requests() is
  'Requester-owned lifecycle read; 7-day join review deadline converges unresolved attempts and target slug appears only after approved active membership.';

-- CHECKPOINT material-write 2026-07-27 KST
-- 006 now contains the complete DB boundary: exact-one owner from both org and
-- membership changes, platform/workspace plane separation, generic digest-only
-- entry, atomic approvals, replay locks, audit, and client DML revocation.
-- CHECKPOINT enumeration-rework-material 2026-07-27 KST
-- Every join observation now shares a deterministic 7-day requester window.
-- Unresolved actionable and non-actionable attempts converge to the same state
-- at the deadline; owner queues and approval reject expired work.
