# BBE-8 — hosted migration·환경 적용 인벤토리와 수용 검증

> 성격: **조사·조회 전용**. 이 세션은 스키마 변경·migration 적용·`db push`·데이터 수정을 하지 않았다.
> owner: code session(claude) · reviewer: MWC · blocked_by: 없음
> base `origin/main` = `0816d2a9c819d21fbf5d0d1e15abf58a2efa32c9` (실측: `git fetch --prune` 후 `git rev-parse origin/main`)
> branch `claude/bbe-8-hosted-inventory` · 전용 worktree
> file lease: 이 파일 1개 + `docs/worklog.md` START/END append (계약 명시)
> 작성 2026-08-04 KST

---

## 0. 한 줄 결론

`/platform` 계열은 **`is_platform_admin()` 단독**으로 문을 열고 **폴백이 없다**. `017`이 hosted에 미적용이면
그 함수는 `006` 정의(`role = 'admin'` 요구) 그대로이고, `005`가 예약한 유일한 관리자는 `role='owner'`라
**항상 false**다. 그러면 `requirePlatformAccess` → `/?error=platform` → `(app)/page.tsx`의 `getSession()` →
소속 0 → **`/login?error=membership`**. MWC 관측 증상과 코드 경로가 **정확히 일치**한다.
단, "017이 실제로 미적용인가"는 hosted 자격증명이 없어 **`NOT_RUN`** 이다. §6 명령으로 belie가 확정해야 한다.

---

## 1. `supabase/migrations` 전수 목록 (30개 · `origin/main@0816d2a` 기준)

| # | 파일 | 목적(1줄) | 도입 커밋 |
| --- | --- | --- | --- |
| 0001 | `0001_init.sql` | 골격 + 스키마 버전 메타만 | `119307e` |
| 001 | `001_schema_v1.sql` | 코어 스키마 v1 (orgs/users/org_members/CRM) + RLS 33정책 | `eafbf8d` |
| 002 | `002_seed_policyfund.sql` | 정책자금 업종팩 프리셋(board_columns) 시드 | `eafbf8d` |
| 003 | `003_boards_engine.sql` | 사용자 임의 보드 생성 엔진(ADR-0003), 001 위 additive | `d5e31ba` |
| 004 | `004_gaps_and_leadin.sql` | 실측 갭 G1·G2·G6·G7·G8 + D15 리드 자동수집 | `5a3ffd5` |
| 005 | `005_app_admins.sql` | 플랫폼 관리자 allowlist 테이블 + `app_admin_role(email)`. **belie를 `role='owner'`로 예약** | `5a3ffd5` |
| 006 | `006_public_workspace_entry.sql` | 공개 워크스페이스 진입(요청/승인) RPC·RLS 일괄. **`is_platform_admin()` 최초 정의** | `351a530` |
| 007 | `007_public_workspace_entry_helper_acl.sql` | 006 헬퍼의 anon EXECUTE 회수(hosted forward-fix) | `915730d` |
| 008 | `008_workspace_entry_self_route_state.sql` | `workspace_entry_self_route_state()` — self 전용 라우팅 상태 | `421c586` |
| 009 | `009_workspace_entry_request_lifecycle.sql` | 진입 요청 생명주기(제출·취소·목록·집계) | `3228e93` |
| 010 | `010_functional_workspace_ops.sql` | 워크스페이스 운영 기반(builder/import/automation 테이블) | `6a27ba2` |
| 011 | `011_member_account_ops.sql` | 계정·멤버 운영 RPC(`save_member_account_profile` 등) | `ea9e8df` |
| 012 | `012_workspace_ops_read_list.sql` | owner 스코프 읽기 계약 + `workspace_ops_read_require_owner()` | `6e892a2` |
| 013 | `013_member_hierarchy_authz.sql` | 멤버 계층 권한(`set_workspace_member_hierarchy_role_scope` 등) | `38e0991` |
| 014a | `014_platform_metrics_daily.sql` | 플랫폼 제품지표 야간 배치 스냅샷 | `f85178a` |
| 014b | `014_reserve_crm_route_slugs.sql` | CRM 라우트 슬러그 예약 동기화 | `9320ffd` |
| 015 | `015_fix_org_helper_session_deadlock.sql` | **BUG-0004** — 조직 격리 헬퍼 4종이 상시 false를 반환하던 데드락 해제 | `dc0bdc5` |
| 016a | `016_entry_request_dedup.sql` | 진입 요청 중복 차단(C0-2) | `31dd84e` |
| 016b | `016_platform_console_metrics_alignment.sql` | 플랫폼 콘솔 지표 정합(`platform_console_metrics_daily`) | `3c2fa71` |
| **017** | `017_fix_is_platform_admin_role_axis.sql` | **`is_platform_admin()`에서 `role='admin'` 조건 제거 → `is_platform` 단독 판정** | `31dd84e` |
| **018** | `018_platform_admin_direct_create.sql` | 플랫폼 관리자의 회사 생성은 승인 절차 없이 즉시(orgs+owner 멤버십) | `31dd84e` |
| 019 | `019_notifications.sql` | mod.notify 인앱 알림(`read_at` ≠ `resolved_at`) | `a7ca729` |
| **020** | `020_release_rings.sql` | 릴리스 링 제어면(`workspace_release_profiles`·`feature_release_controls`·`resolve_workspace_release_selector`·`list_reviewed_internal_demo_release_options`) | `60982b7` |
| **021** | `021_reserve_mode_workspace_slug.sql` | `/mode`를 org slug로 못 쓰게 `orgs`·`workspace_entry_requests`에 예약 제약 추가 | `60982b7` |
| **022** | `022_admin_mode_workspace_persistence.sql` | 관리자 모드 워크스페이스 선택 영속화(`admin_mode_workspace_selections` + 감사 + get/set RPC) | `7e80547` |
| **023** | `023_platform_demo_workspace_bootstrap.sql` | `platform_ensure_selected_demo_workspace()` — 검토된 데모 워크스페이스 보드 부트스트랩 | `9f7a120` |
| **024** | `024_workspace_ops_read_owner_alignment.sql` | `workspace_ops_read_require_owner()`를 canonical owner 헬퍼에 정렬(012 정의 교체) | `c016285` |
| 025 | `025_platform_demo_crm_admin_boundary.sql` | 선택된 데모의 플랫폼 관리자 CRM 면(`platform_get_selected_demo_crm`·`..._import_..._csv`) | `7addaf5` |
| 030 | `030_workspace_entry_create_deadline_repair.sql` | 회사 생성 요청 생명주기 복구(`submit_workspace_create_request` 재정의 + `workspace_entry_requests` 컬럼 추가) | `0816d2a` |

### 1-1. 번호 위생 관찰 (조사 결과, 조치 안 함)

- **번호 중복 3쌍**: `014` 2개(`platform_metrics_daily` / `reserve_crm_route_slugs`), `016` 2개.
  문자열 정렬 적용 시 `014_platform_metrics_daily` → `014_reserve_crm_route_slugs`,
  `016_entry_request_dedup` → `016_platform_console_metrics_alignment` 순서가 된다.
  현재 두 쌍 모두 서로 독립 객체라 순서 의존성은 없다.
- **`0001` vs `001` 혼재**: 문자열 정렬로 `0001_init` → `001_schema_v1` 순이 되어 의도와 일치한다.
- **번호 점프 `025 → 030`**: `026~029`는 존재하지 않는다. 누락이 아니라 예약 후 미사용으로 보인다.
- `submit_workspace_create_request`는 `006 → 009 → 018 → 030` 순으로 **4번 재정의**된다.
  **적용 순서가 뒤바뀌면 최신 정의가 옛 정의로 덮인다.** 이 체인은 순서 민감도가 가장 높다.

---

## 2. hosted DB 적용 이력 실측 — **`NOT_RUN`**

### 2-1. 왜 실행하지 못했나 (실측 근거)

| 확인 항목 | 결과 |
| --- | --- |
| `supabase` CLI (PATH) | **없음** |
| `npx supabase` | 로컬 미설치 (설치 프롬프트에서 중단) |
| `psql` (PATH) | **없음** |
| `supabase/config.toml` | **없음** (프로젝트 link 안 됨) |
| `supabase/.temp`, `.supabase` | **없음** |
| `.env` 실값 파일 | **없음** — 레포 전체에서 `.env.example`, `worker/.env.example` **2개만** 존재 |
| `vercel` CLI | **없음** |
| `gh` CLI | **있음 · `bbelieff` 인증됨** (→ §4에서 사용) |

`supabase migration list --linked`도, 읽기 SQL 조회도 **자격증명이 없어 실행 불가**.
따라서 **hosted 적용 여부를 주장하지 않는다**. 판정값은 전부 `NOT_RUN`이다.

### 2-2. 문서에서 확인되는 hosted 적용 기록 (간접 증거 · 실측 아님)

| migration | 문서상 hosted 상태 | 근거 |
| --- | --- | --- |
| `006` | **적용됨** — "Production migration `006`이 atomically applied" | `docs/worklog.md:1488` |
| `007` | **적용됨** — anon `0/3`, authenticated `3/3` 재확인, PR #24 머지 | `docs/worklog.md:1489` |
| `017`·`018` | **미적용(파킹)** — "실 Supabase에 적용돼야 효력이 있고, 로컬에 크리덴셜이 없어 SQL 실행 검증은 못 했다" | `docs/worklog.md:293-295` |
| `017`·`020`·`021`·`022` | **`NOT_RUN / 미검증`** (최신 정본 라운드가 명시) | `docs/coordination/sync/ROUND-34.md:43` |
| `008`~`016`, `019`, `023`~`025`, `030` | **기록 없음** | 전수 grep 결과 hosted 적용 선언 0건 |

> ⚠️ 이 표는 **문서 진술**이지 DB 실측이 아니다. `006`·`007` 외에는 어떤 migration도
> "적용됨"으로 판정할 근거가 이 세션에 없다. `006`·`007`조차 이후 롤백/재생성 여부는 미확인이다.

---

## 3. 적용/미적용 대조표 + 미적용 → 실증상 매핑

**전제**: hosted 상태가 `NOT_RUN`이므로 아래 "증상" 열은 **"해당 migration이 미적용이라면 나타날 증상"** 이다.
앱이 실제로 호출하는 RPC를 코드에서 실측해 역매핑했다.

| migration | 앱이 의존하는 객체 | 미적용 시 실증상 | 심각도 |
| --- | --- | --- | --- |
| **017** | `is_platform_admin()` | **`/platform/*` 전면 차단.** `loadPlatformActor`가 이 RPC 단독 판정 → false → `/?error=platform` → `(app)` `getSession()` → 소속 0 → **`/login?error=membership`** | **P0** |
| **018** | `submit_workspace_create_request` (관리자 자동승인 분기) | 관리자가 회사를 만들어도 승인 대기에 머묾 | P1 |
| **030** | `submit_workspace_create_request` (재정의) + `workspace_entry_requests` 신규 컬럼 | 회사 생성 요청 생명주기 회귀(PR #91이 고친 결함 잔존). **컬럼 부재 시 RPC 오류 가능** | P1 |
| **020** | `list_reviewed_internal_demo_release_options` | `/platform/demo`의 데모 후보 목록이 **RPC 오류 → 빈 상태**. BBE-6이 고친 "단일 데모 선택" 화면 자체가 뜨지 않음 | P1 |
| **021** | `orgs`·`workspace_entry_requests` slug 예약 제약 | `/mode`를 org slug로 선점 가능 → 정적 라우트와 충돌 | P2 |
| **022** | `get_my_admin_mode_workspace_selection`, `platform_set_admin_mode_workspace_selection` | 관리자 모드 워크스페이스 선택이 **저장되지 않음**(새로고침마다 초기화) | P1 |
| **023** | `platform_ensure_selected_demo_workspace` | 데모 워크스페이스 보드 부트스트랩 실패 → 데모 진입해도 보드 없음 | P1 |
| **024** | `workspace_ops_read_require_owner` (012 정의 교체) | 워크스페이스 운영 읽기가 옛 owner 가드로 남아 `015` 이후와 불일치 | P2 |
| **025** | `platform_get_selected_demo_crm`, `platform_import_selected_demo_crm_csv` | 데모 CRM 조회·CSV 임포트 실패 | P2 |
| 013 | `bind_workspace_lower_member_permission`, `set_workspace_member_hierarchy_role_scope` | 멤버 계층 권한 변경 불가 | P2 |
| 011 | `save_member_account_profile` | 계정 프로필 저장 실패 | P2 |
| 016b | `platform_console_metrics_daily` | 플랫폼 콘솔 지표 빈 값 | P3 |
| 014a | `upsert_platform_metrics_daily` | 야간 배치 크론 실패 | P3 |

### 3-1. **017 ↔ MWC 관측 증상: 코드로 검증된 인과 사슬**

```
로그인 성공 (auth.users 행 존재 · 인증은 됨)
  └─ /platform 요청
     └─ PlatformConsolePage → requirePlatformAccess()          [app/src/components/platform/PlatformConsolePage.tsx:20]
        └─ loadPlatformActor() → supabase.rpc("is_platform_admin")   [app/src/lib/platform/actor.ts:41]
           │  ※ 이 경로에는 app_admin_role 폴백이 없다 — is_platform_admin() 단독
           └─ 006 정의: is_platform AND role = 'admin'          [006_public_workspace_entry.sql]
              └─ 005 시드: belie = role 'owner'                 [005_app_admins.sql:27]
                 └─ 조건 불일치 → FALSE (항상)
                    └─ resolvePlatformActor → {denied, not_platform}
                       └─ requirePlatformAccess → redirect("/?error=platform")   [guard.ts:25]
                          └─ "/" = (app)/page.tsx → getSession()
                             └─ getSupabaseSession: org_members 조회 → 소속 0 → null   [session.ts:75]
                                └─ redirect("/login?error=membership")            [session.ts:140]
```

**"인증됐지만 관리자 미인식, `/platform` → `/login?error=membership`"** 이라는 관측이
이 사슬 하나로 남김없이 설명된다. 다른 가설이 필요 없다.

### 3-2. 반증 검토 — 017만으로 단정하지 못하는 이유 2가지

1. **`/workspace-entry`에는 폴백이 있다.** `readWorkspaceEntryContext`는 `is_platform_admin()`이 false면
   `app_admin_role(email)`로 한 번 더 본다(`server.ts:196-213`, 주석이 017 미적용 상황을 명시).
   → **017이 미적용이어도 `/workspace-entry`에서는 관리자로 인식된다.**
   `/platform`만 막히고 `/workspace-entry`는 열린다면 017 단독 원인이 강하게 지지된다.
   **둘 다 막힌다면 017 외 요인(005 시드 부재 / `app_admins` 행 없음 / 함수 EXECUTE 권한)** 을 봐야 한다.
2. **`is_platform_admin()` RPC가 오류를 내도 같은 화면이 나온다.** `resolvePlatformActor`는
   `error` 또는 non-boolean이면 `unavailable`을 반환하고(`actor.ts:21-23`), 이것도 `/?error=platform`으로 간다.
   즉 **함수 부재·권한 부재**도 "미적용"과 동일한 증상을 만든다. 구분하려면 §6 Q1을 실행해야 한다.
3. **소속 0은 독립 결함일 수 있다.** 위 사슬의 마지막 단계는 `org_members` 행 부재다.
   017을 적용해 `/platform`이 열려도 **`(app)` 일반 화면은 여전히 `/login?error=membership`** 이다.
   → **017 적용은 `/platform` 복구의 필요조건이지, `(app)` 진입의 충분조건이 아니다.**

---

## 4. Production 배포 SHA 확인 — **실측 완료 (RUN)**

`gh` CLI가 인증돼 있어 GitHub Deployments API로 실측했다.

| 항목 | 실측값 |
| --- | --- |
| Production deployment id | `5725403660` |
| **배포 SHA** | **`0816d2a9c819d21fbf5d0d1e15abf58a2efa32c9`** (`0816d2a`) |
| state | `success` |
| 생성 시각 | `2026-08-03T11:31:27Z` |
| environment_url | `https://moawork-cgiuqnggl-beliefkimkim-5976s-projects.vercel.app` |

**→ Production 배포 SHA = `origin/main` HEAD = `0816d2a`. 코드는 최신이다.**

직전 Production 배포 이력(참고): `e937330`(09:29Z) → `3475853`(09:20Z) → `eecaed0`(09:02Z) → `9e6fb8b`(08:47Z).

재현 명령:

```bash
gh api "repos/bbelieff/moawork/deployments?per_page=10" --jq '.[] | select(.environment=="Production") | "\(.id) \(.sha) \(.created_at)"'
```

### 4-1. 부분 `NOT_RUN`

- **`www.moa-work.com` alias ↔ `0816d2a` 바인딩**: `vercel` CLI 부재로 **`NOT_RUN`**.
  위 값은 GitHub이 기록한 deployment이지 canonical 도메인이 가리키는 배포라는 증거는 아니다.
- **앱 내 버전 표기로 교차확인**: `/platform/demo`가 `VERCEL_GIT_COMMIT_SHA.slice(0,7)`를 렌더한다
  (`app/src/app/platform/demo/page.tsx`). 그러나 **그 페이지 자체가 `requirePlatformAccess`로 막혀 있어**
  P0가 해소되기 전에는 이 경로로 확인할 수 없다. 순환 의존이다.
- **공개 무인증 버전 엔드포인트 없음**: `app/src/app/api/**` 전수 조사 결과 health/version 라우트가 없다.
  → 권고: 무인증 `GET /api/version`(SHA 7자리만 반환) 추가를 별도 카드로. 이번 계약 범위 아님.

---

## 5. MWC 추가 조회 4건 — 현재 상태

| # | 질의 | 상태 | 이 세션이 확정한 것 / 남은 것 |
| --- | --- | --- | --- |
| Q1 | **017 적용 여부** | **`NOT_RUN`** | 소스에 017 존재·내용 확정, `/platform`이 이 함수 단독 의존임을 코드로 확정. hosted 함수 본문 실측만 남음 → §6 Q1 |
| Q2 | **테스트1 `workspace_requests`** | **`NOT_RUN`** | 정확한 테이블명은 `public.workspace_entry_requests`(006 생성, 021·030이 컬럼 추가). hosted 행 존재·집계 조회 필요 → §6 Q2 |
| Q3 | **오너 배정** | **`NOT_RUN`** | `org_members(role='owner', status)` 행 유무가 §3-1 사슬의 마지막 분기점. → §6 Q3 |
| Q4 | **`app_admin_role()` 판정값** | **`NOT_RUN`** | 함수는 005에 존재(`security definer`, role 필터 없음). 시드값은 소스상 `'owner'`. hosted 실제 반환값 확인 필요 → §6 Q4 |

> Q2~Q4는 전부 hosted row/함수 조회라 자격증명 없이는 불가하다.
> 안전 경계 준수: 아래 명령은 **집계·존재 확인·함수 경유**만 쓰고 `app_admins`를 직접 select 하지 않는다.

---

## 6. belie 터미널용 조회 명령 (읽기 전용)

Supabase 대시보드 → **SQL Editor**에 그대로 붙여넣는다.
**전부 `select` 뿐이다. `insert`/`update`/`delete`/`create`/`alter`가 없다.**

### Q1 — 017 적용 여부 (핵심 · 가장 먼저)

```sql
-- 'APPLIED_017' 이면 017 적용됨 / 'NOT_APPLIED_006' 이면 미적용 / 'MISSING' 이면 함수 자체가 없음
select coalesce(
  (select case
     when pg_get_functiondef(p.oid) like '%role = ''admin''%' then 'NOT_APPLIED_006'
     else 'APPLIED_017'
   end
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_platform_admin'),
  'MISSING'
) as is_platform_admin_state;
```

```sql
-- 함수 EXECUTE 권한도 함께 본다 (권한 부재도 같은 증상을 만든다 — §3-2)
select p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_platform_admin','app_admin_role','submit_workspace_create_request');
```

### Q1-b — 다른 migration 적용 여부 일괄 (객체 존재로 역판정)

```sql
select '018 direct-create' as migration,
       (select count(*) > 0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='submit_workspace_create_request'
          and pg_get_functiondef(p.oid) like '%platform_admin_direct_create%') as applied
union all select '020 release rings',
       to_regclass('public.workspace_release_profiles') is not null
union all select '021 mode slug reserve',
       (select count(*) > 0 from pg_constraint c join pg_class t on t.oid=c.conrelid
        where t.relname='orgs' and pg_get_constraintdef(c.oid) ilike '%mode%')
union all select '022 admin-mode persistence',
       to_regclass('public.admin_mode_workspace_selections') is not null
union all select '023 demo bootstrap',
       (select count(*) > 0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='platform_ensure_selected_demo_workspace')
union all select '024 ops-read owner align',
       (select count(*) > 0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='workspace_ops_read_require_owner')
union all select '025 demo CRM boundary',
       to_regclass('public.platform_demo_crm_imports') is not null
union all select '030 create-deadline repair',
       (select count(*) > 0 from information_schema.columns
        where table_schema='public' and table_name='workspace_entry_requests'
          and column_name in ('create_deadline_at','deadline_at'))
order by 1;
```

> `030`은 컬럼명 후보 2개로 조회한다. 둘 다 false면 아래로 실제 컬럼 목록을 확인한다.
> ```sql
> select column_name, data_type from information_schema.columns
> where table_schema='public' and table_name='workspace_entry_requests' order by ordinal_position;
> ```

### Q2 — 테스트1 진입 요청 (집계만)

```sql
select status, count(*) as cnt
from public.workspace_entry_requests
group by status
order by status;
```

```sql
-- '테스트1' 이라는 이름의 요청/조직이 존재하는지 (존재 여부만, 원문 노출 최소화)
select
  (select count(*) from public.workspace_entry_requests where requested_name = '테스트1') as request_rows,
  (select count(*) from public.orgs                     where name          = '테스트1') as org_rows;
```

> `requested_name` 컬럼이 없다는 오류가 나면 위 `information_schema` 조회로 실제 컬럼명을 먼저 확인한다.

### Q3 — 오너 배정 (집계만)

```sql
select
  (select count(*) from public.orgs)                                   as orgs_total,
  (select count(*) from public.org_members)                            as members_total,
  (select count(*) from public.org_members where role = 'owner')       as owner_rows,
  (select count(*) from public.orgs o
     where not exists (select 1 from public.org_members m
                       where m.org_id = o.id and m.role = 'owner'))    as orgs_without_owner;
```

```sql
-- belie 계정에 소속이 있는가 (org 이름·id 노출 없이 개수만)
select count(*) as belie_membership_count
from public.org_members m
join auth.users u on u.id = m.user_id
where lower(u.email) = 'beliefkimkim@gmail.com';
```

### Q4 — `app_admin_role()` 판정값 (함수 경유 · `app_admins` 직접 select 안 함)

```sql
select public.app_admin_role('beliefkimkim@gmail.com') as app_admin_role_value;
```

기대값: `'owner'`.
- `'owner'` → 005 시드 정상. **017 미적용이면 `/platform`은 막히고 `/workspace-entry`는 폴백으로 열린다**(§3-2 ①).
- `null` → **005 자체가 미적용이거나 행이 없다.** 이 경우 017을 적용해도 `/platform`은 열리지 않는다. 근인이 달라진다.
- 오류 → 함수 부재 = 005 미적용.

### Q5 — (선택) 관리자 세션에서의 실판정

belie 계정으로 로그인한 브라우저 세션에서만 유효하므로 SQL Editor(서비스 롤)로는 재현되지 않는다.
`is_platform_admin()`은 `auth.uid()`에 묶여 있어 **SQL Editor에서 호출하면 항상 false/null**이다.
→ **SQL Editor로 `select is_platform_admin();` 을 실행해 판정하지 말 것.** Q1의 함수 정의 검사로 대체한다.

---

## 7. 권고 — 적용 필요 목록·순서·리스크

> **이 계약은 적용을 실행하지 않는다.** 아래는 별도 계약을 발행하기 위한 제안이다.

### 7-1. 전제

Q1/Q1-b 결과가 나오기 전에는 **어떤 migration도 "적용 필요"로 확정할 수 없다.**
아래 순서는 "Q1-b에서 미적용으로 판명된 것만" 골라 적용한다는 조건부 권고다.

### 7-2. 권고 적용 순서

| 순 | migration | 이유 | 선행 |
| --- | --- | --- | --- |
| 1 | **017** | P0 해소. 함수 1개 `create or replace`, 테이블·RLS 무변경으로 **가장 안전하고 효과가 가장 크다** | 005·006 적용됨 |
| 2 | 018 | 관리자 직접 생성. `submit_workspace_create_request` 재정의 | 006·009 |
| 3 | 020 | `/platform/demo` 후보 목록 RPC | 006 |
| 4 | 021 | slug 예약 제약. **기존 데이터에 `/mode` slug가 있으면 제약 추가가 실패**한다 | 006 |
| 5 | 022 | 관리자 모드 선택 영속화 | 020 |
| 6 | 023 | 데모 보드 부트스트랩 | 022 |
| 7 | 024 | ops-read owner 정렬 | 012·015 |
| 8 | 025 | 데모 CRM 면 | 023 |
| 9 | **030** | **반드시 018 뒤.** `submit_workspace_create_request`의 최신 정의 | 018 |

> 015(BUG-0004 헬퍼 데드락 해제)가 미적용이면 **이 목록 전체에 앞선다.**
> 019·013·011·016b가 015 위의 `is_org_member()`/`org_scope()`에 얹혀 있어, 015 없이 적용하면
> 헬퍼가 상시 false라 정상 코드가 빈 값으로 보인다(과거 기록 `docs/worklog.md:560-562`).

### 7-3. 리스크

| 리스크 | 내용 | 완화 |
| --- | --- | --- |
| **순서 역전** | `submit_workspace_create_request` 4중 재정의(006→009→018→030). 순서가 틀리면 최신 정의가 옛 정의로 덮이고 **회귀가 조용히 부활**한다 | 적용 후 `pg_get_functiondef`로 최종 본문 검증 |
| **021 제약 실패** | 기존 `orgs`에 `/mode` 계열 slug가 있으면 `alter table ... add constraint`가 실패 | 적용 전 slug 사전 조회 |
| **030 컬럼 추가** | `workspace_entry_requests`에 컬럼 추가. 대형 테이블이면 락 | 행 수 사전 확인, 유지보수 창 |
| **번호 중복** | `014`·`016` 각 2개. CLI가 순서를 재해석할 수 있음 | 적용 전 `supabase migration list --linked` 로 원장 실측 |
| **롤백 경로 부재** | 다수 migration에 down 스크립트가 없다 | 적용 전 **복구 가능한 백업/스냅샷 필수** |
| **소속 0 미해소** | 017만 적용하면 `/platform`은 열려도 `(app)`은 계속 `/login?error=membership` | Q3 결과에 따라 별도 카드 |

### 7-4. 최소 조치 제안

**017 단독 적용**이 위험 대비 효과가 압도적이다(함수 1개 `create or replace`, 시그니처·권한·`security definer`·`search_path` 모두 006 그대로, 멱등).
Q1이 `NOT_APPLIED_006`으로 나오면 **017만 먼저 적용하고 `/platform` 복구를 재관측**한 뒤 나머지를 별도 계약으로 분리할 것을 권고한다.

---

## 8. 이 세션의 `NOT_RUN` 목록

| 항목 | 사유 |
| --- | --- |
| hosted migration 원장(`supabase migration list --linked`) | CLI·자격증명 부재 |
| 017/018/020/021/022/023/024/025/030 hosted 적용 여부 | 위와 같음 |
| `workspace_entry_requests` 행 조회(테스트1) | 위와 같음 |
| `org_members` 오너 배정 조회 | 위와 같음 |
| `app_admin_role()` hosted 반환값 | 위와 같음 |
| `www.moa-work.com` alias ↔ 배포 SHA 바인딩 | `vercel` CLI 부재 |
| 실제 브라우저 로그인 재현 | 사용자 인증 단계는 대행하지 않음 |
| `/platform/demo` 버전 표기 교차확인 | P0로 페이지 자체 도달 불가(순환 의존) |

## 9. 이 세션이 변경하지 않은 것

- 제품 코드 `app/`·`worker/`·`supabase/`·`scripts/`·루트 설정: **변경 0**
- hosted DB·migration·RLS·데이터: **변경 0** (조회조차 실행 못 함)
- Linear 상태·담당자·관계: **변경 0**
- 병렬 레인(BBE-6 구현 세션)의 브랜치·worktree·파일: **미접촉**
- 비밀값·연결 문자열·토큰: **출력·기록 0** (도구 존재 여부만 "있다/없다"로 기록)
