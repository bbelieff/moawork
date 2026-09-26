-- moa-migration-guard: logical_key=151_reserve_join_workspace_slug predecessor=150_invite_links_hardening digest=1f7686818e3db0898d115bc3d785457d1e493175f5c30eed0d96e2cd0ee63988 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '151_reserve_join_workspace_slug',
  p_file_name => '151_reserve_join_workspace_slug.sql',
  p_file_digest => '1f7686818e3db0898d115bc3d785457d1e493175f5c30eed0d96e2cd0ee63988',
  p_expected_predecessor => '150_invite_links_hardening',
  p_executor => 'DC-00',
  p_thread_id => '54ccb210-7be2-4b40-bcea-8cf0d99047ee',
  p_foundation => false
);

-- #722 가 새 최상위 라우트 `/join/<토큰>` 을 추가하면서, 021 의 예약어 목록에도 `join` 을 더한다.
--
-- ★ 왜 필요한가 — 이걸 안 하면 회사 주소를 `join` 으로 만들 수 있다.
--   그러면 그 회사의 주소와 초대 링크 화면이 «같은 자리» 를 놓고 싸운다.
--   화면이 이기든 회사가 이기든, 둘 중 하나는 영영 못 열린다.
--
-- 021 자체는 수정하지 않는다 — 같은 제약을 최신 목록으로 drop/재생성만 한다(059·106 과 같은 패턴).
-- `app/src/lib/workspace-entry/contracts.ts` 의 `RESERVED_WORKSPACE_SLUGS` 와 반드시 같은
-- 목록이어야 한다 — `contracts.test.ts` 의 "matches the DB reserved slug contract exactly" 가 강제한다.
--
-- ★ 이미 `join` 을 쓰는 회사가 있으면 이 마이그레이션이 CHECK 위반으로 죽는다.
--   그게 맞는 동작이다 — 조용히 통과시키면 그 회사가 자기 주소를 잃는다.
--   적용 전에 확인한다:  select count(*) from public.orgs where slug = 'join';

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
        'contract', 'dash', 'deals', 'join', 'ledger', 'login', 'logout', 'mode', 'newcust',
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
        'contract', 'dash', 'deals', 'join', 'ledger', 'login', 'logout', 'mode', 'newcust',
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
