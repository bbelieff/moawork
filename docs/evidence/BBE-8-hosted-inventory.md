# BBE-8 — hosted migration·환경 적용 인벤토리와 수용 검증

> 성격: **조사·조회 전용**. 이 계약은 스키마 변경·migration 적용·`db push`·데이터 수정을 하지 않았다.
> owner: code session(claude) · reviewer: 독립 검수 · blocked_by: 없음
> base `origin/main` = `f4f5a12b719ba4237f2d71726e4804cc28d3ce75` (실측: `git fetch` 후 `git rev-parse origin/main`)
> branch `claude/bbe-8-hosted-inventory` · 전용 worktree
> file lease: 이 파일 1개 + `docs/worklog.md` START/END append (계약 명시)
> 작성 2026-08-04 KST · **갱신 2026-08-09 KST(CT04) — hosted 조회 회신 반영, §0·§2·§3·§4·§5·§7·§8 재판정**

### 갱신 이력

| 일자 | 기준 SHA | 변경 |
| --- | --- | --- |
| 2026-08-04 | `0816d2a` | 최초 작성. hosted 상태 전부 `NOT_RUN`, 017 미적용을 P0 최유력 가설로 제시 |
| **2026-08-09** | **`f4f5a12`** | **belie hosted 조회 회신 도착 → Q1·Q4·EXECUTE `RUN`. 017 미적용 가설 기각.** Production SHA 재실측, 코드 좌표 재실측(#98 반영) |

---

## 0. 한 줄 결론 (2026-08-09 재판정)

**017은 hosted에 적용돼 있다(`APPLIED_017`).** `app_admin_role('beliefkimkim@gmail.com')` = **`'owner'`**,
`is_platform_admin()`의 `authenticated` EXECUTE = **true**. 따라서 2026-08-04 문서가 P0 최유력으로 제시했던
**"017 미적용 → `/platform` 전면 차단" 가설은 기각**한다. §3-1의 인과 사슬은 첫 분기에서 끊긴다.

증상별로 남은 후보는 다음과 같다. **기각된 것은 "017 미적용" 하나뿐이며 `/platform` 쪽 후보는 아직 남아 있다.**

| 증상 | 살아 있는 후보 | 확정 질의 |
| --- | --- | --- |
| `(app)` → `/login?error=membership` | **`org_members` 소속 0**(§3-2 ③) — 이 증상의 **유일한** 설명 | §6 Q3 `NOT_RUN` |
| `/platform` 차단이 계속될 경우 | ⓐ `app_admins.is_platform = false` ⓑ `is_platform_admin()` RPC 실행 오류 | §6 Q6 · 브라우저 재관측 `NOT_RUN` |

부수 확정 1 — **hosted 장부(`supabase_migrations.schema_migrations`)에는 `025`·`030` 2건만 기록돼 있다.**
그런데 017은 실제로 적용돼 있다. → **장부는 적용 상태의 정본이 아니다.** 그 외 migration은 장부 밖에서
수동 적용됐다. 적용 여부 판정은 반드시 **객체 존재·함수 본문 검사**(§6 Q1/Q1-b)로 해야 하며,
`supabase migration list --linked` 결과를 미적용 근거로 쓰면 안 된다.

부수 확정 2 — 017이 적용된 이상 `app/src/lib/workspace-entry/server.ts:196-213`의 `app_admin_role` 폴백은
**작성자가 예고한 대로 no-op 상태**다. 주석 202행이 이미 "017 적용 후에는 위 판정이 곧바로 true 라
이 블록은 자연히 no-op 이 된다"고 적어 두었다 — **틀린 주석이 아니라 조건이 충족된 주석**이다. 조치 불필요.

다만 부작용 하나는 기록해 둔다: 이 폴백은 `app_admin_role`이 non-null이기만 하면 승격하므로,
**`is_platform = false`인 경우(§6 Q6)에도 `/workspace-entry`는 열린다.** 즉 Q6가 `false`로 판명되면
`/platform`은 막히고 `/workspace-entry`는 열리는 **비대칭**이 나타나며, 이는 폴백이 그 축을 가리기 때문이다.
진단 시 이 비대칭을 "017 미적용 징후"로 오독하지 않아야 한다.

---

## 1. `supabase/migrations` 전수 목록 (**29개** · `origin/main@f4f5a12` 기준)

> **정정(2026-08-09)**: 2026-08-04 판은 이 절을 "30개"로 적었으나 아래 표의 행 수도 29이고
> `git ls-tree --name-only origin/main supabase/migrations/ | wc -l` 실측도 **29**다. 29로 정정한다.
> `0816d2a → f4f5a12` 구간에 `supabase/migrations/` 변경은 **0건**이므로 목록 자체는 그대로 유효하다
> (`git diff --stat 0816d2a f4f5a12 -- supabase/migrations/` = 빈 출력).

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

## 2. hosted DB 적용 이력 — **부분 `RUN` (2026-08-09 회신 반영)**

### 2-0. 2026-08-09 확정 사실 (belie hosted 조회 회신)

**출처**: belie가 Supabase SQL Editor에서 §6 조회를 실행한 결과를 총괄/디스패치 경유로 회신.
**이 세션이 직접 DB에 접속해 재측정한 값이 아니다**(자격증명 없음 — §2-1 그대로). 전달된 값을 그대로 기록한다.

| 항목 | 회신값 | 대응 질의 | 판정 |
| --- | --- | --- | --- |
| `is_platform_admin()` 정의 상태 | **`APPLIED_017`** | §6 Q1 | **017 적용됨** |
| `has_function_privilege('authenticated', 'is_platform_admin', 'EXECUTE')` | **`true`** | §6 Q1 2번째 | 권한 부재 가설 기각 |
| `app_admin_role('beliefkimkim@gmail.com')` | **`'owner'`** | §6 Q4 | `app_admins` 행 존재 · 005 시드 정상 |
| hosted migration 장부 기록 | **`025`·`030` 2건뿐** | §6 **Q1-c** | 장부 ≠ 적용 상태 (아래) |

#### 이 4건이 뒤집는 것

1. **017 미적용 가설 기각.** 2026-08-04 판 §0·§3의 P0 판정은 무효다. `/platform` 차단을 017로 설명할 수 없다.
2. **권한 부재 가설(§3-2 ②) 기각.** `authenticated`가 EXECUTE 가능하므로 "함수 권한 부재 → `unavailable`" 경로는 닫힌다.
3. **005 미적용 가설 기각.** `app_admin_role`이 `'owner'`를 반환하므로 함수도 행도 존재한다.
4. **장부 신뢰성 기각.** 017은 장부에 없는데 적용돼 있다. → **`schema_migrations`에 없다는 사실은 미적용의 근거가 아니다.**
   `025`·`030`만 CLI 경로로 적용됐고 나머지는 장부 밖 수동 적용이다. 판정은 객체 실물 검사로만 한다.

#### 남은 잔여 갭 (정직 기록)

- `app_admin_role()`은 **`role` 컬럼만** 반환한다(005 정의: `select role from app_admins where email = lower(p_email)`).
  017의 판정축은 **`is_platform` 컬럼**이다. 즉 `'owner'` 회신은 **행 존재**를 증명하지만
  **`is_platform = true`를 직접 증명하지는 않는다.** 005 시드가 `is_platform = true`로 넣고
  `on conflict do update set ... is_platform = excluded.is_platform` 이므로 정상 경로라면 true지만, 실측은 아니다.
  → 확정하려면 §6 Q6(신규)을 실행한다.
- `is_platform_admin()`은 `auth.uid()`에 묶여 있어 SQL Editor에서는 판정 불가다(§6 Q5). 실판정은 브라우저 세션에서만 나온다.

### 2-1. 2026-08-04 시점에 왜 실행하지 못했나 (실측 근거 · 이 세션도 동일)

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
2026-08-09 CT04 세션도 동일 환경이라 **직접 재측정은 여전히 불가**하다.
§2-0의 값은 belie가 실행한 결과를 전달받은 것이고, 그 외 항목은 계속 `NOT_RUN`이다.

### 2-2. 문서에서 확인되는 hosted 적용 기록 (간접 증거 · 실측 아님)

| migration | 문서상 hosted 상태 | 근거 |
| --- | --- | --- |
| `006` | **적용됨** — "Production migration `006`이 atomically applied" | `worklog.md@0816d2a:1488` |
| `007` | **적용됨** — anon `0/3`, authenticated `3/3` 재확인, PR #24 머지 | `worklog.md@0816d2a:1489` |
| `017`·`018` | 문서상 **미적용(파킹)** — "실 Supabase에 적용돼야 효력이 있고, 로컬에 크리덴셜이 없어 SQL 실행 검증은 못 했다" | `worklog.md@0816d2a:293-295` |
| `017`·`020`·`021`·`022` | 문서상 **`NOT_RUN / 미검증`** | `docs/coordination/sync/ROUND-34.md:43` |
| `008`~`016`, `019`, `023`~`025`, `030` | **기록 없음** | 전수 grep 결과 hosted 적용 선언 0건 |

> 위 `worklog.md` 줄번호는 **`0816d2a` 시점 기준으로 고정**한다. worklog는 append-only이고 최신 항목을 위에 붙이므로
> 커밋마다 줄번호가 밀린다(이 갱신도 68행을 앞에 추가했다). 조회는 `git show 0816d2a:docs/worklog.md`로 한다.

> ⚠️ 이 표는 **문서 진술**이지 DB 실측이 아니다.
>
> **2026-08-09 반증**: §2-0 회신값에서 `017`은 **적용돼 있다**. 위 두 행("미적용 파킹", "`NOT_RUN`")은
> **DB 조회 회신에 의해 무효**다. 문서 진술과 실물이 갈린 첫 사례이며, 이 표 전체를 적용 상태의 근거로 쓰면 안 된다는
> 뜻이다. `006`·`007`의 "적용됨"도 같은 성격의 문서 진술이므로 실물 재확인 전에는 확정으로 취급하지 않는다.
>
> 마찬가지로 **hosted 장부에 `025`·`030`만 있다는 사실도 나머지를 미적용으로 만들지 않는다**(§2-0 4번).
> 적용 판정의 정본은 §6 Q1/Q1-b의 **객체·함수 본문 실물 검사** 하나뿐이다.

---

## 3. 적용/미적용 대조표 + 미적용 → 실증상 매핑

**전제**: `017`을 제외한 hosted 상태는 여전히 `NOT_RUN`이므로 아래 "증상" 열은
**"해당 migration이 미적용이라면 나타날 증상"** 이다. 앱이 실제로 호출하는 RPC를 코드에서 실측해 역매핑했다.

| migration | 앱이 의존하는 객체 | 미적용 시 실증상 | 심각도 |
| --- | --- | --- | --- |
| ~~**017**~~ | `is_platform_admin()` | ~~`/platform/*` 전면 차단~~ → **2026-08-09 `APPLIED_017` 회신으로 해소.** 이 행은 더 이상 미해결 결함이 아니다 | ~~P0~~ → **해소** |
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

### 3-1. **017 인과 사슬 — 2026-08-09 기각** (코드 좌표는 `origin/main@f4f5a12` 재실측)

2026-08-04 판이 세운 사슬은 다음이었다. **첫 분기에서 끊긴다.**

```
로그인 성공 (auth.users 행 존재 · 인증은 됨)
  └─ /platform 요청
     └─ PlatformConsolePage → requirePlatformAccess()
        └─ loadPlatformActor() → supabase.rpc("is_platform_admin")   [app/src/lib/platform/actor.ts:57]
           │  ※ 이 경로에는 app_admin_role 폴백이 없다 — is_platform_admin() 단독
           └─ ✖ 가정: 006 정의(is_platform AND role='admin')가 살아 있다
              └─ ✖ 회신 반증: Q1 = APPLIED_017 → role 조건은 이미 제거됐다
                                017 정의는 `platform_admin.is_platform is true` 단독 판정
                                [017_fix_is_platform_admin_role_axis.sql]
```

**따라서 `is_platform_admin()`은 `app_admins` 행의 `is_platform = true` 하나로 판정한다.**
`app_admin_role` = `'owner'` → 행 존재 확정. `is_platform` 컬럼값만 미확정(§2-0 잔여 갭, §6 Q6).
**정상 시드라면 이 함수는 belie 세션에서 `true`를 반환해야 하고, `/platform`은 열려야 한다.**

#### 지금도 유효한 부분 — `(app)` 경로

`/platform`이 열리는지와 무관하게, `(app)` 일반 화면은 별도 사슬이다.

```
"/" = (app)/page.tsx → getSession()
  └─ org_members 조회 (user_id = auth.uid())        [app/src/lib/auth/session.ts:62-70]
     └─ 행 0 → chooseSessionMembership → null       [session.ts:71-75]
        └─ getSession: ctx 없음 → redirect("/login?error=membership")   [session.ts:138-141]
```

**이 사슬은 017과 무관하게 성립한다.** `/login?error=membership` 관측의 유일한 남은 설명이며,
`org_members` 행 유무(§6 Q3)가 확정 분기점이다. **Q3는 `NOT_RUN`.**

#### #98 이후 리다이렉트 경로가 갈라졌다 (진단 정밀도 향상)

2026-08-04 판은 실패 경로를 `/?error=platform` 하나로 적었다. `#98`(`0e938e3`) 이후 두 갈래다:

| 조건 | 리다이렉트 | 좌표 |
| --- | --- | --- |
| RPC가 `false` 반환 (권한 거부) | `/?error=platform-forbidden` | `app/src/lib/platform/guard.ts:19` |
| RPC 오류 또는 non-boolean (서비스 장애) | `/?error=platform-unavailable` | `guard.ts:18` |
| 미인증 | `/login?next=...` | `guard.ts:29` |

→ **이제 URL만 보고 "권한 거부"와 "함수 장애"를 구분할 수 있다.** §3-2 ②가 요구하던 구분이
코드 레벨에서 해결됐다. 재관측 시 `platform-forbidden`이면 `is_platform` 축, `platform-unavailable`이면
RPC 실행 실패를 본다.

### 3-2. 반증 검토 — 2026-08-09 상태

2026-08-04 판이 세운 반증 3건의 현재 상태다. **③만 살아남았다.**

1. ~~**`/workspace-entry` 폴백로 017을 진단한다**~~ — **무효화**. `readWorkspaceEntryContext`는
   `is_platform_admin()`이 false면 `app_admin_role(email)`로 한 번 더 본다
   (`app/src/lib/workspace-entry/server.ts:196-213`). 017이 적용된 지금 이 블록은 주석 202행의 예고대로 no-op이며,
   **`/platform` vs `/workspace-entry` 대조는 더 이상 017 진단에 쓸 수 없다.**
   더 나아가 이 폴백은 `is_platform = false`인 경우에도 `/workspace-entry`를 열어 그 축을 **가린다**(§0 부수 확정 2).
2. **RPC 오류·권한 부재가 같은 화면을 만든다** — **절반만 해소**.
   ⓐ **권한 부재는 기각.** `has_function_privilege('authenticated', ..., 'EXECUTE')` = `true`(§2-0).
   ⓑ **RPC 오류는 여전히 살아 있다.** `resolvePlatformActor`는 `error` 또는 non-boolean이면 `unavailable`을
      반환한다(`app/src/lib/platform/actor.ts:33`). `#98`이 한 일은 이 경로를 `/?error=platform-unavailable`로
      **구분 가능하게** 만든 것이지 **원인을 배제한 것이 아니다**. 구분은 진단 능력이고 기각은 증거다 — 둘은 다르다.
      실제 배제는 §7-2 5단계(브라우저 재관측)가 필요하며 그것은 `NOT_RUN`이다.
3. ✅ **소속 0은 독립 결함이다.** `(app)` 사슬의 마지막 단계는 `org_members` 행 부재다.
   `/platform`이 열려도 **`(app)` 일반 화면은 여전히 `/login?error=membership`** 이다.
   → 017과 무관하게 성립하며, **`/login?error=membership` 관측의 현재 유일한 설명**이다.
   확정 분기점은 §6 Q3(`NOT_RUN`)이다.

> **재판정 요약 (증상별로 분리해서 읽어야 한다)**
>
> | 증상 | 살아 있는 후보 | 확정 질의 |
> | --- | --- | --- |
> | `(app)` → `/login?error=membership` | **`org_members` 소속 0** — **이 증상의 유일한 설명** | §6 Q3 `NOT_RUN` |
> | `/platform` 차단이 계속될 경우 | ⓐ `app_admins.is_platform = false` ⓑ `is_platform_admin()` RPC 실행 오류 | §6 Q6 · 브라우저 재관측 `NOT_RUN` |
>
> 기각된 것은 **"017 미적용"** 하나이고, `/platform` 쪽 후보 2개는 남아 있다.
> `(app)` 증상의 해법은 migration 적용이 아니라 **소속 행 생성**(또는 018 관리자 직접 생성 경로)이다 — **데이터 문제**다.

---

## 4. Production 배포 SHA 확인 — **실측 완료 (RUN)**

`gh` CLI가 인증돼 있어 GitHub Deployments API로 실측했다.

#### 2026-08-09 재실측 (현재값)

| 항목 | 실측값 |
| --- | --- |
| Production deployment id | `5817138319` |
| **배포 SHA** | **`f4f5a12b719ba4237f2d71726e4804cc28d3ce75`** (`f4f5a12`) |
| state | `success` |
| 생성 시각 | `2026-08-09T08:54:32Z` (status `2026-08-09T08:54:33Z`) |
| environment_url | `https://moawork-3wr9k3f74-beliefkimkim-5976s-projects.vercel.app` |

**→ Production 배포 SHA = `origin/main` HEAD = `f4f5a12`. 코드는 최신이다.**

직전 Production 배포 이력: `0e938e3`(03:23Z) → `64c3dc7`(03:13Z) → `cc3144a`(02:55Z) → `cf1055d`(01:16Z).

#### 2026-08-04 시점값 (이력 보존)

| 항목 | 당시 실측값 |
| --- | --- |
| Production deployment id | `5725403660` |
| 배포 SHA | `0816d2a9c819d21fbf5d0d1e15abf58a2efa32c9` |
| state | `success` · `2026-08-03T11:31:27Z` |

당시에도 `배포 SHA == origin/main HEAD`였다. 두 시점 모두 **배포 지연은 관측되지 않는다.**

재현 명령:

```bash
gh api "repos/bbelieff/moawork/deployments?per_page=10" --jq '.[] | select(.environment=="Production") | "\(.id) \(.sha) \(.created_at)"'
```

### 4-1. 부분 `NOT_RUN`

- **`www.moa-work.com` alias ↔ `0816d2a` 바인딩**: `vercel` CLI 부재로 **`NOT_RUN`**.
  위 값은 GitHub이 기록한 deployment이지 canonical 도메인이 가리키는 배포라는 증거는 아니다.
- **앱 내 버전 표기로 교차확인**: `/platform/demo`가 `VERCEL_GIT_COMMIT_SHA.slice(0,7)`를 렌더한다
  (`app/src/app/platform/demo/page.tsx`). 2026-08-04 판은 "P0(017 미적용)로 페이지 도달 불가 → 순환 의존"이라 적었으나,
  **017 적용이 확인된 지금 이 순환은 풀렸을 가능성이 높다.** belie 세션에서 `/platform/demo`에 도달하면
  표기 SHA가 `f4f5a12`인지 대조해 alias 바인딩까지 한 번에 확정할 수 있다. 실행은 브라우저 세션이 필요해 `NOT_RUN`.
- **공개 무인증 버전 엔드포인트 없음**: `app/src/app/api/**` 전수 조사 결과 health/version 라우트가 없다.
  → 권고: 무인증 `GET /api/version`(SHA 7자리만 반환) 추가를 별도 카드로. 이번 계약 범위 아님.

---

## 5. MWC 추가 조회 4건 — 현재 상태

| # | 질의 | 상태 | 확정값 / 남은 것 |
| --- | --- | --- | --- |
| Q1 | **017 적용 여부** | **`RELAYED` ✅** | **`APPLIED_017`**. + `authenticated` EXECUTE `true`. 017 미적용 가설 기각(§2-0) |
| Q2 | **테스트1 `workspace_requests`** | **`NOT_RUN`** | 정확한 테이블명은 `public.workspace_entry_requests`(006 생성, 021·030이 컬럼 추가). hosted 행 존재·집계 조회 필요 → §6 Q2 |
| Q3 | **오너 배정** | **`NOT_RUN`** ⚠️ | **현재 유일하게 살아 있는 P0 후보**(§3-2 ③). `org_members` 행 유무가 `/login?error=membership`의 분기점 → §6 Q3. **다음 조치의 최우선 항목** |
| Q4 | **`app_admin_role()` 판정값** | **`RELAYED` ✅** | **`'owner'`**. `app_admins` 행 존재·005 시드 정상 확정 |
| Q1-b | 나머지 migration 적용 여부 | **`NOT_RUN`** | 장부에 `025`·`030`만 있으나 장부는 정본이 아님(§2-0 4번). 객체 실물 검사 필요 → §6 Q1-b |
| Q1-c | hosted 장부 기록 범위 | **`RELAYED`** ✅ | **`025`·`030` 2건뿐**. 017은 장부에 없는데 적용됨 → **장부는 적용 상태의 정본이 아니다** |
| **Q6** | **`app_admins.is_platform` 값** | **`NOT_RUN`** (신규) | Q4는 `role`만 반환해 017의 판정축인 `is_platform`을 증명하지 못함 → §6 Q6 |

> Q2·Q3·Q1-b·Q6는 hosted row/객체 조회라 자격증명 없이는 불가하다.
> 안전 경계 준수: 아래 명령은 **집계·존재 확인·함수 경유**만 쓰고 `app_admins`를 직접 select 하지 않는다.

---

## 6. belie 터미널용 조회 명령 (읽기 전용)

Supabase 대시보드 → **SQL Editor**에 그대로 붙여넣는다.
**전부 `select` 뿐이다. `insert`/`update`/`delete`/`create`/`alter`가 없다.**

> **진행 상태(2026-08-09)**: Q1 ✅ 회신 완료 · Q4 ✅ 회신 완료 · **Q2·Q3·Q1-b·Q6 미회신**.
> 다음 회차에서는 **Q3를 가장 먼저** 실행한다(§7-2). 아래 Q1·Q4는 회신값과 함께 이력으로 남긴다.

### Q1 — 017 적용 여부 — **✅ 회신 `APPLIED_017` / EXECUTE `true`**

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

> **탐지 한계**: 위 판정은 `role = 'admin'` 문자열 유무에 의존한다. `006`의 실제 본문이
> `and platform_admin.role = 'admin'`이라 알려진 두 정의(006/017) 사이에서는 정확하지만,
> **손으로 편집된 제3의 변형은 `APPLIED_017`로 오분류**될 수 있다. 정밀 확인이 필요하면
> `select pg_get_functiondef(oid) ...` 로 본문 전체를 읽는다.

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

### Q1-c — hosted migration 장부 기록 범위 — **✅ 회신 `025`·`030` 2건뿐**

§2-0의 장부 결론이 근거하는 질의다. 2026-08-04 판에는 이 질의가 없었고 회신값만 도착했으므로,
재현 가능하도록 여기에 명시해 둔다.

```sql
select version
from supabase_migrations.schema_migrations
order by version;
```

**회신값 = `025`, `030` 2건.** 그런데 Q1은 `APPLIED_017`이다.
→ **장부에 없다는 사실은 미적용의 근거가 아니다.** 나머지는 장부 밖에서 수동 적용됐다.
적용 판정은 Q1/Q1-b의 **객체 실물 검사**로만 한다.

> 스키마·테이블명이 다르면(`supabase_migrations.schema_migrations` 부재) 아래로 확인한다.
> ```sql
> select table_schema, table_name from information_schema.tables
> where table_name ilike '%migration%' order by 1,2;
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

### Q4 — `app_admin_role()` 판정값 — **✅ 회신 `'owner'`** (함수 경유 · `app_admins` 직접 select 안 함)

```sql
select public.app_admin_role('beliefkimkim@gmail.com') as app_admin_role_value;
```

**회신값 = `'owner'`** (기대값과 일치). → 005 시드 정상, `app_admins` 행 존재 확정.
017도 적용됐으므로(Q1) `/platform`은 **열려야 정상**이다. 남은 미확정은 `is_platform` 컬럼값뿐 → Q6.

### Q6 — `app_admins.is_platform` 값 (신규 · 017의 실제 판정축)

017의 `is_platform_admin()`은 `role`이 아니라 **`is_platform` 컬럼**으로 판정한다.
Q4의 `app_admin_role()`은 `role`만 반환하므로 이 축을 증명하지 못한다(§2-0 잔여 갭).
`app_admins`를 직접 select 하지 않기 위해 **`exists` 집계 한 건**만 확인한다.

```sql
-- true 면 017 판정축 충족 → belie 세션에서 is_platform_admin() 이 true 여야 한다
select exists (
  select 1 from public.app_admins
  where email = lower('beliefkimkim@gmail.com') and is_platform is true
) as belie_is_platform;
```

- `true` → 017 + 시드 + 권한 3박자 모두 정상. `/platform` 차단이 계속되면 **DB가 아니라 세션·앱 계층**을 본다.
- `false` → `is_platform` 축이 꺼져 있다. **017이 이미 적용돼 있어도 `/platform`은 막힌다. 이 경우가 새 근인**이다.
  조치는 migration이 아니라 `app_admins` 행의 `is_platform` 갱신이다(별도 계약).

> RLS로 `app_admins` 직접 조회는 막혀 있다(005). 위 쿼리는 **service role인 SQL Editor에서만** 동작하며
> 반환값은 boolean 1개뿐이라 관리자 이메일 목록이 노출되지 않는다(F1 준수 취지 유지).

### Q5 — (선택) 관리자 세션에서의 실판정

belie 계정으로 로그인한 브라우저 세션에서만 유효하므로 SQL Editor(서비스 롤)로는 재현되지 않는다.
`is_platform_admin()`은 `auth.uid()`에 묶여 있어 **SQL Editor에서 호출하면 항상 false/null**이다.
→ **SQL Editor로 `select is_platform_admin();` 을 실행해 판정하지 말 것.** Q1의 함수 정의 검사로 대체한다.

---

## 7. 권고 — 적용 필요 목록·순서·리스크

> **이 계약은 적용을 실행하지 않는다.** 아래는 별도 계약을 발행하기 위한 제안이다.

### 7-1. 전제 (2026-08-09 갱신)

Q1-b 결과가 나오기 전에는 **어떤 migration도 "적용 필요"로 확정할 수 없다.**
아래 순서는 "Q1-b에서 미적용으로 판명된 것만" 골라 적용한다는 조건부 권고다.

**`017`은 적용 대상에서 제외한다** — 이미 적용됐다(§2-0). 2026-08-04 판의 §7-4
"017 단독 선적용" 권고는 **철회**한다.

### 7-2. 다음 조치 순서 (조사 관점 · 최우선)

migration 적용보다 **먼저** 해야 할 조회가 있다. 순서는 다음과 같다.

| 순 | 조치 | 이유 |
| --- | --- | --- |
| **1** | **§6 Q3 실행** (`org_members` 소속 집계) | 살아남은 유일한 P0 후보. `/login?error=membership`의 확정 분기점 |
| **2** | **§6 Q6 실행** (`is_platform` 값) | 017 판정축의 마지막 미확정 칸. `/platform` 실차단 여부를 가른다 |
| 3 | §6 Q1-b 실행 | 018·020~025·030 실적용 여부. 장부가 정본이 아니므로 객체 실물 검사로만 |
| 4 | §6 Q2 실행 | 테스트1 진입 요청 상태 |
| 5 | belie 브라우저에서 `/platform` 재관측 | `platform-forbidden` / `platform-unavailable` / 정상 렌더를 URL로 구분(§3-1) |

### 7-3. 조건부 migration 적용 순서 (Q1-b가 미적용으로 판명한 것만)

| 순 | migration | 이유 | 선행 |
| --- | --- | --- | --- |
| ~~1~~ | ~~**017**~~ | **적용됨 — 대상 제외** | — |
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

### 7-4. 리스크

| 리스크 | 내용 | 완화 |
| --- | --- | --- |
| **순서 역전** | `submit_workspace_create_request` 4중 재정의(006→009→018→030). 순서가 틀리면 최신 정의가 옛 정의로 덮이고 **회귀가 조용히 부활**한다 | 적용 후 `pg_get_functiondef`로 최종 본문 검증 |
| **021 제약 실패** | 기존 `orgs`에 `/mode` 계열 slug가 있으면 `alter table ... add constraint`가 실패 | 적용 전 slug 사전 조회 |
| **030 컬럼 추가** | `workspace_entry_requests`에 컬럼 추가. 대형 테이블이면 락 | 행 수 사전 확인, 유지보수 창 |
| **번호 중복** | `014`·`016` 각 2개. CLI가 순서를 재해석할 수 있음 | 적용 전 §6 Q1-b로 **객체 실물** 확인. ~~`supabase migration list --linked`~~ 는 완화책이 될 수 없다 — 장부에 `025`·`030`만 있는데 017은 적용돼 있다(§2-0 4번) |
| **롤백 경로 부재** | 다수 migration에 down 스크립트가 없다 | 적용 전 **복구 가능한 백업/스냅샷 필수** |
| **소속 0 미해소** | 017이 적용된 지금도 `(app)`은 `/login?error=membership`일 수 있다. **현재 유일한 P0 후보** | Q3 결과에 따라 별도 카드 |
| **장부 오독** | `schema_migrations`에 `025`·`030`만 있어 나머지를 미적용으로 오판 → **이미 적용된 것을 재적용** | 적용 전 반드시 Q1-b 객체 실물 검사 |

### 7-5. 별도 카드 권고 (이 계약의 리스 밖)

| 후보 | 내용 | 근거 |
| --- | --- | --- |
| 소속 복구 | belie 계정 `org_members` 행 부재 시 소속 생성 경로 확정 | §3-2 ③ · Q3 결과 선행 |
| `is_platform` 복구 | Q6가 `false`면 `app_admins.is_platform` 갱신. **migration이 아니라 데이터 조치** | §6 Q6 결과 선행 |
| 무인증 버전 엔드포인트 | `GET /api/version`(SHA 7자리만) 신설 — alias↔배포 SHA 교차확인의 순환 의존 제거 | §4-1 |
| 장부 정합 | `025`·`030` 외 수동 적용분을 `schema_migrations`에 소급 기록할지 정책 결정 | §2-0 4번 |

> 위 4건은 **제안일 뿐 이 계약에서 실행하지 않았다.** 각각 별도 owner·lease·reviewer가 필요하다.

---

## 8. `NOT_RUN` 목록 (2026-08-09 현재)

### 8-1. 해소됨 (`NOT_RUN` → `RUN`)

**`RELAYED`와 `MEASURED`를 구분한다.** `RELAYED`는 belie가 실행하고 이 세션이 전달받은 값이며,
이 세션이 재현하지 못한다. `NOT_RUN`이 아니라는 뜻일 뿐 `PASS`가 아니다.

| 항목 | 확정값 | 등급 | 출처 |
| --- | --- | --- | --- |
| `017` hosted 적용 여부 | **`APPLIED_017`** | `RELAYED` | belie SQL Editor 회신 (§6 Q1) |
| `is_platform_admin()` `authenticated` EXECUTE | **`true`** | `RELAYED` | 위와 같음 (§6 Q1) |
| `app_admin_role('beliefkimkim@gmail.com')` | **`'owner'`** | `RELAYED` | 위와 같음 (§6 Q4) |
| hosted migration 장부 기록 범위 | **`025`·`030` 2건뿐** | `RELAYED` | 위와 같음 (§6 Q1-c) |
| Production 배포 SHA | **`f4f5a12`** (= `origin/main`) | **`MEASURED`** | `gh` deployments API — 이 세션 직접 실행 |
| migration 전수 개수 | **29** | **`MEASURED`** | `git ls-tree origin/main` — 이 세션 직접 실행 |
| §3·§4 코드 좌표 | 본문 기재 | **`MEASURED`** | `git show origin/main:<경로>` — 이 세션 직접 실행 |

### 8-2. 여전히 `NOT_RUN`

| 항목 | 사유 |
| --- | --- |
| `018`/`020`~`025`/`030` hosted 적용 여부 (Q1-b) | CLI·자격증명 부재. **장부에 없다는 것은 근거가 아니다**(§2-0 4번) |
| `app_admins.is_platform` 값 (Q6) | 위와 같음. Q4는 `role`만 반환 |
| `workspace_entry_requests` 행 조회(테스트1, Q2) | 위와 같음 |
| **`org_members` 오너·소속 조회 (Q3)** | 위와 같음. **현재 유일한 P0 후보 — 최우선** |
| `www.moa-work.com` alias ↔ 배포 SHA 바인딩 | `vercel` CLI 부재 |
| 실제 브라우저 로그인 재현 | 사용자 인증 단계는 대행하지 않음 |
| `/platform/demo` 버전 표기 교차확인 | 브라우저 세션 필요(017 해소로 순환 의존은 풀렸을 가능성 높음) |

> `NOT_RUN`은 PASS로 승격하지 않는다. 위 항목은 belie 회신 또는 별도 계약 전까지 미확정이다.

## 9. 이 계약이 변경하지 않은 것

- 제품 코드 `app/`·`worker/`·`supabase/`·`scripts/`·루트 설정: **변경 0**
- hosted DB·migration·RLS·데이터: **변경 0** (이 세션도 접속 자체 불가)
- Linear 상태·담당자·관계: **변경 0** (Linear MCP 미인증 — §10)
- 다른 레인의 브랜치·worktree·파일: **미접촉**. `codex/*` 자산 **무접촉**
- 비밀값·연결 문자열·토큰: **출력·기록 0** (도구 존재 여부만 "있다/없다"로 기록)
- 리스 밖 파일: **변경 0**. 이 계약이 만진 파일은 이 문서 + `docs/worklog.md` append 2개뿐

---

## 10. 이 갱신의 검증 경계

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| §2-0의 4개 값 | **전달받은 값** | 이 세션이 DB에 접속해 재측정하지 않았다. belie 실행 → 총괄/디스패치 경유 회신 |
| §1 migration 목록·개수 | **직접 실측** | `git ls-tree origin/main` = 29개 |
| §3·§4 코드 좌표 | **직접 실측** | `git show origin/main:<경로>` · `origin/main@f4f5a12` |
| §4 Production 배포 SHA | **직접 실측** | `gh api repos/bbelieff/moawork/deployments` |
| Linear `BBE-8` 상태 도장 | **미수행** | Linear MCP 미인증 + 비대화형 세션이라 OAuth 불가. 초안은 PR 본문·END 보고에 첨부 |
