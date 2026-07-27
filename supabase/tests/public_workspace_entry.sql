-- PUBLIC-WORKSPACE-ENTRY-01 executable disposable-DB attack/contract suite.
-- Run only on an empty disposable database after migrations 0001..006.
-- Synthetic identities use test.invalid and are never production/customer data.
-- CHECKPOINT test-first-write 2026-07-27 KST

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
  returns void language plpgsql as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

-- Synthetic auth and public profiles.
insert into auth.users (id, email, aud, role)
values
  ('10000000-0000-0000-0000-000000000001', 'platform@test.invalid', 'authenticated', 'authenticated'),
  ('10000000-0000-0000-0000-000000000002', 'owner-a@test.invalid', 'authenticated', 'authenticated'),
  ('10000000-0000-0000-0000-000000000003', 'owner-b@test.invalid', 'authenticated', 'authenticated'),
  ('10000000-0000-0000-0000-000000000004', 'joiner@test.invalid', 'authenticated', 'authenticated'),
  ('10000000-0000-0000-0000-000000000005', 'outsider@test.invalid', 'authenticated', 'authenticated'),
  ('10000000-0000-0000-0000-000000000006', 'workspace-admin@test.invalid', 'authenticated', 'authenticated'),
  ('10000000-0000-0000-0000-000000000007', 'enumerator@test.invalid', 'authenticated', 'authenticated');

insert into public.users (id, email, name)
values
  ('10000000-0000-0000-0000-000000000001', 'platform@test.invalid', 'Platform Test'),
  ('10000000-0000-0000-0000-000000000002', 'owner-a@test.invalid', 'Owner A Test'),
  ('10000000-0000-0000-0000-000000000003', 'owner-b@test.invalid', 'Owner B Test'),
  ('10000000-0000-0000-0000-000000000004', 'joiner@test.invalid', 'Joiner Test'),
  ('10000000-0000-0000-0000-000000000005', 'outsider@test.invalid', 'Outsider Test'),
  ('10000000-0000-0000-0000-000000000006', 'workspace-admin@test.invalid', 'Workspace Admin Test'),
  ('10000000-0000-0000-0000-000000000007', 'enumerator@test.invalid', 'Enumerator Test');

insert into public.app_admins (email, role, is_platform)
values ('platform@test.invalid', 'admin', true);

-- UI-bypass validation: name <=80, slug 3..40, and one generic invalid-address
-- error for malformed/reserved addresses.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  public.submit_workspace_create_request(
    '21000000-0000-0000-0000-000000000001', repeat('n', 80), 'abc'
  ) ->> 'accepted' = 'true',
  'name 80 and slug 3 are accepted boundaries'
);
select pg_temp.assert_true(
  public.submit_workspace_create_request(
    '21000000-0000-0000-0000-000000000002', 'Forty Slug', repeat('a', 40)
  ) ->> 'accepted' = 'true',
  'slug 40 is accepted boundary'
);

do $$
declare
  v_reserved text;
begin
  begin
    perform public.submit_workspace_create_request(
      '21000000-0000-0000-0000-000000000003', repeat('n', 81), 'valid-name-check'
    );
    raise exception 'ASSERTION FAILED: name 81 unexpectedly accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'workspace name length invalid' then raise; end if;
  end;

  foreach v_reserved in array array[
    'account', 'admin', 'api', 'auth', 'login', 'logout', 'platform',
    'settings', 'support', 'workspace-entry', 'workspaces', 'www',
    'ab', repeat('z', 41), 'Bad_Slug'
  ] loop
    begin
      perform public.submit_workspace_create_request(
        gen_random_uuid(), 'Invalid Address Test', v_reserved
      );
      raise exception 'ASSERTION FAILED: invalid/reserved address unexpectedly accepted';
    exception when invalid_parameter_value then
      if sqlerrm <> 'workspace address invalid' then raise; end if;
    end;
  end loop;
end;
$$;

-- Two independent create requests.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  public.submit_workspace_create_request(
    '20000000-0000-0000-0000-000000000001', 'Alpha Test', 'alpha-test'
  ) ->> 'accepted' = 'true',
  'create request A accepted'
);
select pg_temp.assert_true(
  public.submit_workspace_create_request(
    '20000000-0000-0000-0000-000000000001', 'Alpha Test', 'alpha-test'
  ) ->> 'accepted' = 'true',
  'create request A exact replay accepted'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.workspace_entry_requests
   where id = '20000000-0000-0000-0000-000000000001'),
  'create request replay creates one row'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select public.submit_workspace_create_request(
  '20000000-0000-0000-0000-000000000002', 'Beta Test', 'beta-test'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select public.resolve_workspace_create_request(
  '20000000-0000-0000-0000-000000000001', true, 'test-approved'
);
select public.resolve_workspace_create_request(
  '20000000-0000-0000-0000-000000000002', true, 'test-approved'
);
set constraints all immediate;
set constraints all deferred;

select pg_temp.assert_true(
  (select count(*) = 2 from public.orgs where slug in ('alpha-test', 'beta-test')),
  'two accounts can own two workspaces'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.orgs organization
    where (select count(*) from public.org_members member
           where member.org_id = organization.id and member.role = 'owner') <> 1
  ),
  'every workspace has exactly one owner'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.org_members
    where user_id = '10000000-0000-0000-0000-000000000001'
  ),
  'Platform Admin gains no tenant membership'
);

-- Platform rejection creates no workspace.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select public.submit_workspace_create_request(
  '20000000-0000-0000-0000-000000000003', 'Rejected Test', 'rejected-test'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select public.resolve_workspace_create_request(
  '20000000-0000-0000-0000-000000000003', false, 'test-rejected'
);
select pg_temp.assert_true(
  not exists (select 1 from public.orgs where slug = 'rejected-test'),
  'rejected create request creates no workspace'
);

-- Known slug and unknown lookup are deliberately indistinguishable publicly.
do $$
declare
  v_known jsonb;
  v_unknown jsonb;
begin
  perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
  v_known := public.lookup_workspace_entry('alpha-test');
  v_unknown := public.lookup_workspace_entry('does-not-exist');
  perform pg_temp.assert_true(v_known = v_unknown and v_known = '{"accepted": true}'::jsonb,
    'lookup is generic and non-enumerating');

  v_known := public.submit_workspace_join_request(
    '30000000-0000-0000-0000-000000000001', 'alpha-test'
  );
  v_unknown := public.submit_workspace_join_request(
    '30000000-0000-0000-0000-000000000099', 'does-not-exist'
  );
  perform pg_temp.assert_true(v_known = v_unknown and v_known = '{"accepted": true}'::jsonb,
    'submit is generic and non-enumerating');
end;
$$;

-- Requester-visible lifecycle is indistinguishable for known and unknown
-- lookups before the fixed seven-day deadline and converges at that deadline.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000007', true);
select public.submit_workspace_join_request(
  '30000000-0000-0000-0000-000000000110', 'alpha-test'
);
select public.submit_workspace_join_request(
  '30000000-0000-0000-0000-000000000111', 'unknown-workspace'
);
select pg_temp.assert_true(
  (select count(*) = 2
   from public.list_my_workspace_entry_requests()
   where request_id in (
     '30000000-0000-0000-0000-000000000110',
     '30000000-0000-0000-0000-000000000111'
   )
     and request_status = 'pending'
     and decision_state = 'pending'
     and resolved_at is null
     and approved_target_slug is null
     and review_deadline > clock_timestamp()),
  'known and unknown are both pending with no target before deadline'
);
select pg_temp.assert_true(
  (select bool_and(review_deadline - created_at = interval '7 days')
   from public.list_my_workspace_entry_requests()
   where request_id in (
     '30000000-0000-0000-0000-000000000110',
     '30000000-0000-0000-0000-000000000111'
   )),
  'known and unknown use the same deterministic seven-day window'
);
select pg_temp.assert_true(
  (select count(distinct jsonb_build_object(
     'status', request_status,
     'decision', decision_state,
     'resolved', resolved_at is not null,
     'target', approved_target_slug is not null
   )) = 1
   from public.list_my_workspace_entry_requests()
   where request_id in (
     '30000000-0000-0000-0000-000000000110',
     '30000000-0000-0000-0000-000000000111'
   )),
  'known and unknown requester-visible shapes match before deadline'
);

-- Only the protected owner sees the actionable item in its private queue; no
-- digest, slug, or unknown attempt is returned by that queue.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  exists (
    select 1 from public.list_pending_workspace_join_requests(
      (select id from public.orgs where slug = 'alpha-test')
    ) where request_id = '30000000-0000-0000-0000-000000000110'
  )
  and not exists (
    select 1 from public.list_pending_workspace_join_requests(
      (select id from public.orgs where slug = 'alpha-test')
    ) where request_id = '30000000-0000-0000-0000-000000000111'
  ),
  'owner queue includes only actionable in-tenant request'
);

-- Move both synthetic attempts to the exact seven-day boundary. The requester
-- read atomically materializes one identical not-approved outcome for both.
with boundary as (select clock_timestamp() as deadline)
update public.workspace_entry_requests request
set created_at = boundary.deadline - interval '7 days',
    review_expires_at = boundary.deadline
from boundary
where request.id in (
  '30000000-0000-0000-0000-000000000110',
  '30000000-0000-0000-0000-000000000111'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000007', true);
select pg_temp.assert_true(
  (select count(*) = 2
   from public.list_my_workspace_entry_requests()
   where request_id in (
     '30000000-0000-0000-0000-000000000110',
     '30000000-0000-0000-0000-000000000111'
   )
     and request_status = 'rejected'
     and decision_state = 'not_approved'
     and resolved_at = review_deadline
     and approved_target_slug is null),
  'known and unknown converge at the exact seven-day deadline'
);
select pg_temp.assert_true(
  (select count(distinct jsonb_build_object(
     'status', request_status,
     'decision', decision_state,
     'resolved_at_deadline', resolved_at = review_deadline,
     'target', approved_target_slug is not null
   )) = 1
   from public.list_my_workspace_entry_requests()
   where request_id in (
     '30000000-0000-0000-0000-000000000110',
     '30000000-0000-0000-0000-000000000111'
   )),
  'known and unknown requester-visible shapes match after deadline'
);

-- A new idempotency key may retry after expiry, but approval at/after its
-- deadline is converted to rejected and cannot create membership.
select public.submit_workspace_join_request(
  '30000000-0000-0000-0000-000000000112', 'alpha-test'
);
with boundary as (select clock_timestamp() as deadline)
update public.workspace_entry_requests request
set created_at = boundary.deadline - interval '7 days',
    review_expires_at = boundary.deadline
from boundary
where request.id = '30000000-0000-0000-0000-000000000112';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  public.resolve_workspace_join_request(
    '30000000-0000-0000-0000-000000000112', true, 'late-approval-attempt'
  ) @> '{"status": "rejected", "expired": true}'::jsonb,
  'late approval is deterministically denied'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.org_members membership
    where membership.user_id = '10000000-0000-0000-0000-000000000007'
  ),
  'late approval creates no membership'
);
select pg_temp.assert_true(
  (select count(*) = 3
   from public.workspace_entry_events event
   where event.request_id in (
     '30000000-0000-0000-0000-000000000110',
     '30000000-0000-0000-0000-000000000111',
     '30000000-0000-0000-0000-000000000112'
   )
     and event.event_type = 'join_request_expired'
     and event.actor_user_id is null
     and event.metadata ->> 'source' = 'deadline'),
  'deadline expiry audit is system-derived and never attributed to viewer or owner'
);

-- Cancellation has the same envelope for known and unknown, and a subsequent
-- new request id is accepted as a generic retry.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000007', true);
select public.submit_workspace_join_request(
  '30000000-0000-0000-0000-000000000113', 'alpha-test'
);
select public.submit_workspace_join_request(
  '30000000-0000-0000-0000-000000000114', 'still-unknown'
);
select pg_temp.assert_true(
  public.cancel_workspace_entry_request('30000000-0000-0000-0000-000000000113')
  = public.cancel_workspace_entry_request('30000000-0000-0000-0000-000000000114'),
  'known and unknown cancellation responses match'
);
select pg_temp.assert_true(
  public.submit_workspace_join_request(
    '30000000-0000-0000-0000-000000000115', 'still-unknown'
  ) = '{"accepted": true}'::jsonb,
  'new idempotency key retries after terminal state'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000007', true);
do $$
begin
  begin
    perform 1 from public.workspace_entry_requests limit 1;
    raise exception 'ASSERTION FAILED: requester direct table read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Slug join: only protected owner may approve, base role/scope are fixed.
do $$
begin
  perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
  begin
    perform public.resolve_workspace_join_request(
      '30000000-0000-0000-0000-000000000001', true, 'cross-tenant-attempt'
    );
    raise exception 'ASSERTION FAILED: cross-tenant owner approval unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

do $$
begin
  perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
  begin
    perform public.resolve_workspace_join_request(
      '30000000-0000-0000-0000-000000000001', true, 'platform-attempt'
    );
    raise exception 'ASSERTION FAILED: Platform Admin tenant approval unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select public.resolve_workspace_join_request(
  '30000000-0000-0000-0000-000000000001', true, 'owner-approved'
);
select pg_temp.assert_true(
  exists (
    select 1 from public.org_members membership
    join public.orgs organization on organization.id = membership.org_id
    where organization.slug = 'alpha-test'
      and membership.user_id = '10000000-0000-0000-0000-000000000004'
      and membership.role = 'member'
      and membership.scope = 'assigned'
  ),
  'join approval creates only member/assigned'
);
select pg_temp.assert_true(
  public.resolve_workspace_join_request(
    '30000000-0000-0000-0000-000000000001', true, 'owner-approved'
  ) ->> 'replayed' = 'true',
  'join approval replay is idempotent'
);
select pg_temp.assert_true(
  (select count(*) = 1
   from public.org_members membership
   join public.orgs organization on organization.id = membership.org_id
   where organization.slug = 'alpha-test'
     and membership.user_id = '10000000-0000-0000-0000-000000000004'),
  'join replay creates no duplicate membership'
);

-- Owner rejection creates no membership.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
select public.submit_workspace_join_request(
  '30000000-0000-0000-0000-000000000002', 'beta-test'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select public.resolve_workspace_join_request(
  '30000000-0000-0000-0000-000000000002', false, 'owner-rejected'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.org_members membership
    join public.orgs organization on organization.id = membership.org_id
    where organization.slug = 'beta-test'
      and membership.user_id = '10000000-0000-0000-0000-000000000005'
  ),
  'rejected join creates no membership'
);

-- Digest-only invite route and one-use consumption.
do $$
declare
  v_org_id uuid;
  v_code text;
  v_result jsonb;
begin
  select id into v_org_id from public.orgs where slug = 'beta-test';
  perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
  v_result := public.create_workspace_invite_code(
    v_org_id, '40000000-0000-0000-0000-000000000001', now() + interval '1 day', 1
  );
  v_code := v_result ->> 'code';
  perform pg_temp.assert_true(v_code is not null, 'raw invite returned once');
  perform pg_temp.assert_true(
    public.create_workspace_invite_code(
      v_org_id, '40000000-0000-0000-0000-000000000001', now() + interval '1 day', 1
    ) ->> 'code' is null,
    'invite replay does not reveal raw code'
  );

  perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
  perform public.submit_workspace_join_request(
    '30000000-0000-0000-0000-000000000003', v_code
  );
  perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
  perform public.resolve_workspace_join_request(
    '30000000-0000-0000-0000-000000000003', true, 'invite-approved'
  );
end;
$$;
select pg_temp.assert_true(
  not exists (
    select 1 from public.workspace_invite_codes
    where use_count <> 1 or use_count > use_limit
  ),
  'invite use is bounded and consumed atomically'
);

-- Requester-owned lifecycle read: no cross-user rows; target slug is revealed
-- only for an approved request backed by the caller's active exact membership.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(
  exists (
    select 1 from public.list_my_workspace_entry_requests()
    where request_id = '30000000-0000-0000-0000-000000000001'
      and request_status = 'approved'
      and decision_state = 'approved'
      and approved_target_slug = 'alpha-test'
  ),
  'approved active target is returned to its requester'
);
select pg_temp.assert_true(
  exists (
    select 1 from public.list_my_workspace_entry_requests()
    where request_id = '20000000-0000-0000-0000-000000000003'
      and request_status = 'rejected'
      and decision_state = 'not_approved'
      and approved_target_slug is null
  ),
  'rejected create reveals no target'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.list_my_workspace_entry_requests()
    where request_id = '20000000-0000-0000-0000-000000000002'
  ),
  'requester RPC returns no cross-user request'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
select pg_temp.assert_true(
  exists (
    select 1 from public.list_my_workspace_entry_requests()
    where request_id = '30000000-0000-0000-0000-000000000002'
      and request_status = 'rejected'
      and approved_target_slug is null
  ),
  'rejected request stays non-enumerating even after another request joins that tenant'
);
select pg_temp.assert_true(
  exists (
    select 1 from public.list_my_workspace_entry_requests()
    where request_id = '30000000-0000-0000-0000-000000000003'
      and request_status = 'approved'
      and approved_target_slug = 'beta-test'
  ),
  'approved invite target is returned only after active membership exists'
);

-- Authenticated direct DML is denied at both privilege and RLS layers.
insert into public.org_members (org_id, user_id, role, scope)
select id, '10000000-0000-0000-0000-000000000006', 'admin', 'all'
from public.orgs where slug = 'alpha-test';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000006', true);
do $$
begin
  begin
    update public.org_members set role = 'member'
    where user_id = '10000000-0000-0000-0000-000000000002';
    raise exception 'ASSERTION FAILED: admin downgraded protected owner';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.org_members
    where user_id = '10000000-0000-0000-0000-000000000002';
    raise exception 'ASSERTION FAILED: admin deleted protected owner';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.org_members set role = 'owner', scope = 'all'
    where user_id = '10000000-0000-0000-0000-000000000006';
    raise exception 'ASSERTION FAILED: admin promoted self to owner';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.org_members set scope = 'assigned'
    where user_id = '10000000-0000-0000-0000-000000000002';
    raise exception 'ASSERTION FAILED: admin changed protected owner scope';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.orgs (name, slug) values ('Bypass Test', 'bypass-test');
    raise exception 'ASSERTION FAILED: direct ownerless org insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.workspace_entry_requests set status = 'approved'
    where id = '20000000-0000-0000-0000-000000000003';
    raise exception 'ASSERTION FAILED: direct request approval unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Membership lifecycle is an authorization boundary, not display metadata.
update public.org_members membership
set status = 'suspended'
from public.orgs organization
where membership.org_id = organization.id
  and organization.slug = 'alpha-test'
  and membership.user_id = '10000000-0000-0000-0000-000000000006';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000006', true);
select pg_temp.assert_true(
  public.is_org_member((select id from public.orgs where slug = 'alpha-test')) is false,
  'suspended membership is not an org member'
);
select pg_temp.assert_true(
  public.org_role((select id from public.orgs where slug = 'alpha-test')) is null
  and public.org_scope((select id from public.orgs where slug = 'alpha-test')) is null,
  'suspended membership resolves no role or scope'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.orgs where slug = 'alpha-test'),
  'suspended membership cannot SELECT tenant workspace'
);
select pg_temp.assert_true(
  not public.shares_workspace_with('10000000-0000-0000-0000-000000000002'),
  'suspended membership is not a shared-workspace peer'
);
select pg_temp.assert_true(
  not public.is_protected_workspace_owner(
    (select id from public.orgs where slug = 'alpha-test')
  ),
  'suspended membership is never a protected owner'
);
reset role;

update public.org_members membership
set status = 'suspended'
from public.orgs organization
where membership.org_id = organization.id
  and organization.slug = 'alpha-test'
  and membership.user_id = '10000000-0000-0000-0000-000000000004';
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(
  exists (
    select 1 from public.list_my_workspace_entry_requests()
    where request_id = '30000000-0000-0000-0000-000000000001'
      and request_status = 'approved'
      and approved_target_slug is null
  ),
  'approved target is hidden when its exact membership becomes inactive'
);
update public.org_members membership
set status = 'active'
from public.orgs organization
where membership.org_id = organization.id
  and organization.slug = 'alpha-test'
  and membership.user_id = '10000000-0000-0000-0000-000000000004';

update public.org_members membership
set status = 'removed'
from public.orgs organization
where membership.org_id = organization.id
  and organization.slug = 'alpha-test'
  and membership.user_id = '10000000-0000-0000-0000-000000000006';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000006', true);
select pg_temp.assert_true(
  public.is_org_member((select id from public.orgs where slug = 'alpha-test')) is false
  and public.org_role((select id from public.orgs where slug = 'alpha-test')) is null
  and public.org_scope((select id from public.orgs where slug = 'alpha-test')) is null,
  'removed membership remains fully unauthorized'
);
reset role;

do $$
begin
  begin
    update public.org_members membership
    set status = 'suspended'
    from public.orgs organization
    where membership.org_id = organization.id
      and organization.slug = 'alpha-test'
      and membership.role = 'owner';
    raise exception 'ASSERTION FAILED: protected owner became inactive';
  exception when check_violation then null;
  end;
  perform pg_temp.assert_true(
    (select bool_and(membership.status = 'active')
     from public.org_members membership
     join public.orgs organization on organization.id = membership.org_id
     where organization.slug = 'alpha-test' and membership.role = 'owner'),
    'protected owner status remains active'
  );
end;
$$;

-- A suspended workspace fails closed even when its owner membership is active.
update public.orgs set status = 'suspended' where slug = 'beta-test';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true(
  (select count(*) = 0 from public.orgs where slug = 'beta-test')
  and public.org_role((select id from public.orgs where slug = 'beta-test')) is null,
  'suspended workspace grants no tenant read or role'
);
reset role;
update public.orgs set status = 'active' where slug = 'beta-test';

-- RLS: owner A cannot enumerate workspace B or a user who shares no workspace.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(
  (select count(*) = 0 from public.orgs where slug = 'beta-test'),
  'cross-tenant workspace read denied'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.users
   where id = '10000000-0000-0000-0000-000000000003'),
  'cross-tenant users_select denied'
);
reset role;

-- Platform Admin remains outside tenant read plane.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true((select count(*) = 0 from public.orgs),
  'Platform Admin cannot read tenant workspaces automatically');
reset role;

-- Service/definer bypasses are still constrained at commit: owner=0 and owner=2.
do $$
begin
  begin
    insert into public.orgs (id, name, slug)
    values ('50000000-0000-0000-0000-000000000001', 'Zero Owner', 'zero-owner');
    set constraints all immediate;
    raise exception 'ASSERTION FAILED: zero-owner workspace unexpectedly survived';
  exception when check_violation then null;
  end;
  set constraints all deferred;
  perform pg_temp.assert_true(
    not exists (select 1 from public.orgs where slug = 'zero-owner'),
    'zero-owner transaction rolled back'
  );
end;
$$;

do $$
declare
  v_org_id uuid := '50000000-0000-0000-0000-000000000002';
begin
  begin
    insert into public.orgs (id, name, slug) values (v_org_id, 'Two Owner', 'two-owner');
    insert into public.org_members (org_id, user_id, role, scope)
    values (v_org_id, '10000000-0000-0000-0000-000000000004', 'owner', 'all');
    insert into public.org_members (org_id, user_id, role, scope)
    values (v_org_id, '10000000-0000-0000-0000-000000000005', 'owner', 'all');
    raise exception 'ASSERTION FAILED: two-owner workspace unexpectedly survived';
  exception when unique_violation then null;
  end;
  perform pg_temp.assert_true(
    not exists (select 1 from public.orgs where slug = 'two-owner'),
    'two-owner transaction rolled back'
  );
end;
$$;

do $$
begin
  begin
    delete from public.org_members membership
    using public.orgs organization
    where membership.org_id = organization.id
      and organization.slug = 'alpha-test'
      and membership.role = 'owner';
    set constraints all immediate;
    raise exception 'ASSERTION FAILED: privileged owner deletion unexpectedly survived';
  exception when check_violation then null;
  end;
  set constraints all deferred;
  perform pg_temp.assert_true(
    (select count(*) = 1
     from public.org_members membership
     join public.orgs organization on organization.id = membership.org_id
     where organization.slug = 'alpha-test' and membership.role = 'owner'),
    'deferred invariant restores protected owner after privileged deletion failure'
  );
end;
$$;

-- Atomic rollback: a failed audit write leaves request pending and creates no org.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
select public.submit_workspace_create_request(
  '20000000-0000-0000-0000-000000000004', 'Rollback Test', 'rollback-test'
);

create or replace function pg_temp.reject_create_resolution_audit()
  returns trigger language plpgsql as $$
begin
  if new.event_type = 'create_request_resolved' then
    raise exception 'synthetic audit failure';
  end if;
  return new;
end;
$$;
create trigger test_reject_create_resolution_audit
  before insert on public.workspace_entry_events
  for each row execute function pg_temp.reject_create_resolution_audit();

do $$
declare
  v_failed boolean := false;
begin
  perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
  begin
    perform public.resolve_workspace_create_request(
      '20000000-0000-0000-0000-000000000004', true, 'must-roll-back'
    );
  exception when raise_exception then
    if sqlerrm <> 'synthetic audit failure' then
      raise;
    end if;
    v_failed := true;
  end;
  perform pg_temp.assert_true(v_failed, 'audit failure aborts approval');
end;
$$;

drop trigger test_reject_create_resolution_audit on public.workspace_entry_events;
select pg_temp.assert_true(
  not exists (select 1 from public.orgs where slug = 'rollback-test'),
  'audit failure rolls back workspace creation'
);
select pg_temp.assert_true(
  (select status = 'pending' from public.workspace_entry_requests
   where id = '20000000-0000-0000-0000-000000000004'),
  'audit failure preserves pending request'
);

select pg_temp.assert_true(
  not exists (
    select 1 from public.workspace_entry_events
    where metadata::text ~* '(password|token|cookie|secret|@)'
  ),
  'audit metadata contains no secret or email-like payload'
);

-- CHECKPOINT test-material 2026-07-27 KST
-- Covers two accounts/two workspaces, exact-one 0/2 denial, direct DML,
-- cross-tenant reads/approval, create/join approve/reject/replay, invite digest,
-- Platform-vs-tenant separation, and audit-coupled atomic rollback.
-- CHECKPOINT enumeration-rework-test-material 2026-07-27 KST
-- Adds exact known-vs-unknown requester state/shape probes before and at the
-- fixed seven-day deadline, system-attributed expiry, late-approval denial,
-- generic cancellation/retry, and authenticated direct-table read denial.

select 'PUBLIC_WORKSPACE_ENTRY_SQL_PASS' as result;
rollback;
