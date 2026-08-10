-- 014_reserve_crm_route_slugs.sql — CRM 라우트 슬러그 예약 동기화 (T02)
--
-- 왜 필요한가:
--   T02 가 top-level 라우트 `/companies`(고객사 목록)와 `/deals/[dealId]`(딜 상세)를 추가했다.
--   워크스페이스 슬러그가 이 두 값을 가져가면 라우트가 가려진다(예: 어떤 조직이 slug='deals'
--   를 잡으면 /deals 가 그 조직 페이지로 해석된다). 라우트 예약 목록에 반드시 넣어야 한다.
--
-- 왜 006/009 를 고쳐놓고 또 이 파일이 있는가:
--   앱 계약 테스트(`workspace-entry/contracts.test.ts`)가 **006 파일 내용**을 단일 출처로
--   비교하기 때문에 006 을 고치지 않으면 게이트가 빨개진다. 하지만 006 은 이미 적용된
--   마이그레이션이라, 파일만 고치면 **이미 배포된 DB 에는 반영되지 않는다**.
--   → 006/009 는 신규 설치용으로 갱신하고, 이 파일이 기존 DB 를 따라잡게 한다.
--   drop + add 패턴은 009 가 이미 쓴 방식과 동일하며 재실행해도 안전(idempotent)하다.
--
-- ⚠ 소유 경계: 이 제약은 workspace-entry 트랙 자산이다. T02 는 자기 라우트 2개를 예약
--   목록에 넣은 것 외에 조건을 바꾸지 않았다(나머지 술어는 006/009 원문 그대로).
--   해당 트랙의 리뷰 필요.

-- ── orgs.slug 형식 제약 ──
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
        'contract', 'dash', 'deals', 'login', 'logout', 'newcust', 'notices',
        'onboarding', 'platform', 'policyfund', 'settings', 'support', 'w',
        'work', 'workspace-entry', 'workspaces', 'www'
      )
    )
  );

-- ── workspace_entry_requests 형태 제약 (009 판을 슬러그만 확장해 재적용) ──
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
        'contract', 'dash', 'deals', 'login', 'logout', 'newcust', 'notices',
        'onboarding', 'platform', 'policyfund', 'settings', 'support', 'w',
        'work', 'workspace-entry', 'workspaces', 'www'
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
