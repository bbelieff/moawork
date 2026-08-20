-- moa-migration-guard: logical_key=106_bbe240_reserve_ledger_workspace_slug predecessor=105_bbe240_deals_fee_terms digest=80c31af9e5549d3b7e099e272d71bb94438f8b19e124f8a3a06df5ff3907b1a1 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '106_bbe240_reserve_ledger_workspace_slug',
  p_file_name => '106_bbe240_reserve_ledger_workspace_slug.sql',
  p_file_digest => '80c31af9e5549d3b7e099e272d71bb94438f8b19e124f8a3a06df5ff3907b1a1',
  p_expected_predecessor => '105_bbe240_deals_fee_terms',
  p_executor => 'DC-00',
  p_thread_id => '54ccb210-7be2-4b40-bcea-8cf0d99047ee',
  p_foundation => false
);

-- BBE-240 이 새 최상위 라우트 `/ledger` 를 추가하면서, 021 의 예약어 목록에도 추가한다.
-- 021 자체는 수정하지 않는다 — 같은 제약을 최신 목록으로 drop/재생성만 한다(059 와 동일 패턴).
-- `app/src/lib/workspace-entry/contracts.ts` 의 `RESERVED_WORKSPACE_SLUGS` 와 반드시 같은
-- 목록이어야 한다 — `contracts.test.ts`의 "matches the DB reserved slug contract exactly" 가 강제한다.

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
        '_next', 'account', 'admin', 'api', 'auth', 'boards', 'companies',
        'contract', 'dash', 'deals', 'ledger', 'login', 'logout', 'mode', 'newcust',
        'notices', 'onboarding', 'platform', 'policyfund', 'presets', 'settings',
        'support', 'w', 'work', 'workspace-entry', 'workspaces', 'www'
      )
    )
  );

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
        '_next', 'account', 'admin', 'api', 'auth', 'boards', 'companies',
        'contract', 'dash', 'deals', 'ledger', 'login', 'logout', 'mode', 'newcust',
        'notices', 'onboarding', 'platform', 'policyfund', 'presets', 'settings',
        'support', 'w', 'work', 'workspace-entry', 'workspaces', 'www'
      )
      and lookup_digest is null
      and (review_expires_at is null or review_expires_at = created_at + interval '14 days')
    )
    or (
      kind = 'join'
      and desired_name is null
      and desired_slug is null
      and lookup_digest is not null
      and (review_expires_at is null or review_expires_at = created_at + interval '14 days')
    )
  );
