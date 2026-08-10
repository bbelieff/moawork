# Round 21 · 구현 DAG와 Writer Gate

> WORK-ID: `IMPLEMENTATION-DAG-01`  
> 산출물: SPEC  
> 상태: `MATERIALIZED / IMPLEMENTATION HOLD`  
> 작성 기준일: 2026-07-24 KST  
> Repository: `bbelieff/moawork`  
> 다음 WORK-ID: `IMPLEMENTATION-WRITER-GATE-01`

이 문서는 ROUND-21의 구현 의존성 조사, readiness checklist, P0 authz delta를 실제 DEV worktree 배정과 PR 순서로 연결하는 실행 정본이다. 채팅 보고는 이 문서를 대체하지 않는다.

---

## 1. 해결할 문제와 작은 조직 사용자 가치

MoaWork의 첫 고객은 `대표(보호된 Owner) → 팀장 → 사원`으로 시작하는 작은 조직이다. 대표가 로그인한 뒤 회사, 첫 고객, 첫 업무를 만들고 매일 오늘 화면으로 돌아오는 경로가 끊기지 않아야 한다. 동시에 단순한 화면 뒤에서 다음 보안 불변식은 처음부터 DB에서 강제되어야 한다.

- Workspace마다 commit 시 protected Owner가 정확히 1명이다.
- Platform 권한은 Workspace role/scope를 만들거나 덮어쓰지 않는다.
- 초대, membership 변경, 프로필, 세션 폐기, 감사는 tenant 경계 안에서 원자적으로 처리한다.
- 기존 JWT, 직접 table DML, 이메일 allowlist, client cookie를 통한 우회가 없어야 한다.
- 실DB/RLS 검사가 skip되면 완료가 아니다.

사용자 가치는 기술 migration 자체가 아니라 다음 연속 흐름이다.

```text
Google 로그인
→ 내 Workspace 준비
→ 첫 고객과 첫 업무 생성
→ 새로고침·재로그인 후에도 유지
→ 팀원을 안전하게 초대
→ 오늘의 MoaWork에서 각자 허용된 행동만 확인
```

이 흐름을 안전하게 열기 위한 직렬 구현 순서는 아래와 같다.

```text
main@639d629
→ PR #19 / 006
→ PR #20 / 007
→ Compatibility App
→ Maintenance Window / 008+ Expand
→ Strict App Cutover
→ 009+ Legacy Lockdown
→ 실DB 55개 공격·경계 검사
→ T10 구현 PASS
```

---

## 2. 입력 정본과 연결 상태

| 입력 | 역할 | 연결 상태 |
|---|---|---|
| [`README.md`](./README.md) | Round 21 파일 lease와 산출물 계약 | `CONNECTED` |
| [`03-p0-authz-contract.md`](./03-p0-authz-contract.md) | Owner·Platform/Workspace·Invite·Profile·Session·RLS·release 계약 | `CONNECTED` |
| [`08-test-matrix.md`](./08-test-matrix.md) | 시나리오→fixture→UI/API/DB→증거→T10 판정 추적 | `CONNECTED — DRAFT / NOT_RUN` — 2026-07-24 KST 존재·비공백 및 T03 A1 41~55 연결 확인 |
| GitHub `main`·PR #19·PR #20 | 실제 base/head·변경 파일·미검증 근거 | `CONNECTED` — 2026-07-24 KST 재조회 |

`03-p0-authz-contract.md`의 T10 판정은 `PASS — CONTRACT ONLY`다. 구현·migration·배포·운영 write 승인이 아니다. `08-test-matrix.md`는 현재 `Draft / NOT_RUN / PASS 0건`이며 T03 A1 41~55를 흡수했다. 따라서 테스트 계약 연결 대기는 해소됐지만, DEV 구현·fixture·실DB 실행과 T10 독립 판정 전에는 READY 또는 PASS로 표시할 수 없다.

---

## 3. 실제 원격 근거

2026-07-24 KST GitHub connector로 재확인한 값이다. 로컬 브랜치명이나 과거 보고서를 최신값으로 사용하지 않았다.

| 대상 | Base | Head | 원격 상태 | 확인된 사실 |
|---|---|---|---|---|
| `main` | — | [`639d629`](https://github.com/bbelieff/moawork/commit/639d629e9c09bba63415a96d0d7d46c653fb24ac) | default branch | migration `001`~`005`; 006/007 미포함 |
| [PR #19](https://github.com/bbelieff/moawork/pull/19) | `main@639d629` | `b28a5fa4573e01154943a410b52a74ff11052dc7` | Draft/Open, mergeable | `006_workspace_bootstrap.sql`; 11파일; 실제 Supabase 적용 미검증 |
| [PR #20](https://github.com/bbelieff/moawork/pull/20) | `feat/workspace-bootstrap@b28a5fa` | `5daad685906851cd1c1677ef7da88a80cb1dce66` | Draft/Open, mergeable | #19 위 stacked; `007_first_lead.sql`; 11파일; 실DB/RLS·동시성 미검증 |
| [PR #18](https://github.com/bbelieff/moawork/pull/18) | `main@639d629` | `a50000b` | Draft/Open, mergeable | 로그인 시각 레인; migration/auth session 변경 없음 |

### PR #19 변경 파일

```text
app/src/app/(app)/layout.tsx
app/src/app/(app)/onboarding/page.tsx
app/src/app/auth/callback/route.ts
app/src/app/auth/callback/route.test.ts
app/src/components/auth/FeatureGate.tsx
app/src/lib/entitlements.ts
app/src/lib/entitlements.test.ts
app/src/lib/workspace/service.ts
app/src/lib/workspace/service.test.ts
app/src/lib/workspace/migration.test.ts
supabase/migrations/006_workspace_bootstrap.sql
```

### PR #20 변경 파일

```text
app/src/app/(app)/newcust/actions.ts
app/src/app/(app)/newcust/page.tsx
app/src/components/crm/NewLeadForm.tsx
app/src/components/shell/nav-items.ts
app/src/lib/crm/boardData.test.ts
app/src/lib/crm/first-lead-ui.test.ts
app/src/lib/crm/first-lead.test.ts
app/src/lib/crm/first-lead.ts
app/src/lib/repo/supabase/server-source.test.ts
app/src/lib/repo/supabase/server-source.ts
supabase/migrations/007_first_lead.sql
```

PR 본문의 로컬 gate와 build 결과는 후보 증거다. 실제 Supabase 적용, RLS, 동시성, 새로고침, 배포 SHA가 없으므로 다음 노드로 자동 승격하지 않는다.

---

## 4. 확정 결정 / 추천 Draft / 미결정

### 4.1 확정 결정

- 구현 순서는 `006 → 007 → compatibility app → maintenance 008+ → strict app → 009+ → 실DB/T10`이다.
- Workspace마다 commit 시 Owner는 정확히 1명이고 Owner scope는 `all`이다.
- Workspace 생성은 최종적으로 `create_workspace_with_owner` RPC 단일 경로다.
- authenticated client의 direct `orgs`·`org_members` DML은 P0에서 제거한다.
- Owner 변경은 generic membership RPC가 아니라 `transfer_workspace_owner`만 사용한다.
- Platform principal과 Workspace membership은 별도 plane이다.
- Invite 수락은 invite 소비, membership, Workspace Profile, audit를 한 transaction으로 처리한다.
- OAuth identity, Global Profile, Workspace Profile, Membership Authorization을 분리한다.
- role/membership 변경과 Workspace 정지는 같은 transaction에서 session cutoff를 기록한다.
- 일반 세션은 절대 30일·미사용 7일이며 모든 기기 로그아웃은 계정 전체·모든 Workspace에 적용한다.
- 기존 migration `001`~`007`은 수정하지 않고 새 migration만 추가한다.
- 실DB 공격·경계 검사 1~55 중 skip이 있으면 PASS가 아니다.
- Partner/Admin/Invite/Owner 이전/Workspace lifecycle 운영 write는 전체 P0 PASS 전 HOLD다.

### 4.2 추천 Draft — Writer Gate에서 확정

- 신규 migration 이름은 `008_p0_authz_expand.sql`, `009_p0_authz_legacy_lockdown.sql`을 후보로 둔다. 실제 번호는 최신 main과 다른 lease를 재확인한 뒤 고정한다.
- Compatibility App은 신규 RPC를 우선 호출하고, DB가 정확히 `function not found`를 반환할 때만 기존 생성 경로를 사용하는 일시 bridge로 둔다.
- 008 적용은 신규 Workspace 생성·Invite·Membership mutation을 maintenance/read-only로 닫은 짧은 window에서 수행한다.
- 008 이후 strict app을 배포하고, legacy 호출 0건을 확인한 뒤 009 lockdown을 적용한다.
- DB 제약·RLS·direct DML revoke 장애는 취약 정책으로 rollback하지 않고 mutation HOLD와 forward-fix를 기본으로 한다.

### 4.3 미결정 / Writer Gate 입력

- 기존 PR #19/#20 writer가 계속 소유하는지, 별도 DEV가 인계받는지
- main 자동 배포 여부와 DB-before-app 순서를 보장할 배포 제어 방식
- Compatibility App, 008, Strict App, 009를 몇 개 PR로 나눌지
- 008/009 실제 migration 번호와 각 파일 lease
- maintenance window 승인자, DB operator, app deploy owner
- preflight에서 Owner 0명·복수 Owner·owner scope 이상이 발견될 때의 수동 remediation 결정
- Supabase/PostgREST의 정확한 missing-function 오류 allowlist
- `08-test-matrix.md`의 최종 scenario ID와 증거 owner

미결정은 추천안을 코드로 조용히 고정하지 않는다.

---

## 5. 구현 DAG

### N0 — 기준선 고정

**Entry**

- GitHub `main`과 열린 PR을 다시 조회한다.
- branch/worktree/status와 기존 writer를 확인한다.
- PR #19·#20의 base/head와 변경 파일을 이 문서의 값과 대조한다.

**Exit**

- 기준선 SHA, 기존 PR owner, 배포 방식, DB operator가 Writer Gate packet에 기록된다.
- 기존 writer의 branch를 임의 checkout/rebase하지 않는다.

**STOP**

- main이 `639d629`에서 바뀌었는데 이 문서를 그대로 실행하려는 경우
- PR base/head 또는 changed-file 목록이 바뀐 경우
- 외국/공유 worktree의 미커밋 변경을 건드려야 하는 경우

---

### N1 — PR #19 / 006 Workspace Bootstrap

**계약**

`bootstrap_workspace(p_org_id)`는 authenticated Owner만 실행한다. 조직 단위 advisory lock 아래 entitlement backfill과 기본 pipeline·6개 stage를 멱등 생성한다.

**Entry**

- `base=main@639d629`, `head=b28a5fa` 재확인
- 변경범위 동결과 최종 diff/checksum
- 통제 Supabase 환경, synthetic Owner/member fixture, 사전 snapshot/복구 계획
- 앱 자동 배포 여부 확인

**필수 테스트·증거**

- Owner 호출 성공, admin/member 거부
- 반복·동시 호출 후 pipeline/stage/entitlement 중복 0
- manual/addon/trial entitlement 보존
- 기존 조직 backfill 전후 집계
- OAuth→onboarding→조직명 저장→새로고침→재로그인
- migration SHA, DB before/after counts, app deploy SHA

**Exit**

- 006이 `001`~`005` 뒤에 적용된다.
- 실DB 검증 뒤 해당 app이 배포되고 T10이 current SHA 후보를 판정한다.
- #20 재기반에 사용할 새 main SHA가 고정된다.

**STOP**

- 006보다 app을 먼저 배포하려는 경우
- owner/member 경계가 반대이거나 DB 오류가 기능 OFF로 가장되는 경우
- backfill이 비-plan entitlement를 덮는 경우
- RLS test skip을 PASS로 계산하는 경우

---

### N2 — PR #20 / 007 First Lead

**계약**

`create_first_lead(p_org_id, p_request_id, p_company_name, p_deal_title)`는 authenticated active member를 재검증하고 회사+marketing-stage 딜을 한 transaction에서 생성한다. 동일 `org_id + request_id`는 같은 결과를 반환한다.

**Entry**

- N1 Exit 완료
- PR #20을 새 main에 rebase/retarget하고 base/head 재고정
- 재기반본 `scripts/check.sh`, production build, targeted test 재실행
- 007 적용 전 006 존재 확인

**필수 테스트·증거**

- active member 성공, 비회원·타 Workspace ID 주입 거부
- 같은 request ID의 반복·동시 제출 결과 company 1·deal 1
- company만 남거나 deal만 남는 부분 상태 0
- assigned user와 marketing stage 정합
- 새로고침·재로그인 뒤 동일 결과 유지
- request-scoped SSR client가 JWT/RLS를 사용하는 증거

**Exit**

- 007이 006 뒤에 적용된다.
- first-lead app이 배포되고 실제 RLS·동시성·영속성 검증이 완료된다.
- Compatibility App의 base SHA가 새 main으로 고정된다.

**STOP**

- #19가 main에 없는데 #20을 직접 merge/deploy하는 경우
- 007을 006보다 먼저 적용하는 경우
- 동시 제출로 중복 또는 불완전 결과가 생기는 경우
- 새로고침 뒤 Local fallback 데이터만 보이는 경우

---

### N3 — Compatibility App

**목적**

008이 direct org DML을 회수하기 전에 현재 OAuth/onboarding 앱이 새 `create_workspace_with_owner` RPC를 사용할 준비를 한다. DB와 앱 어느 쪽을 먼저 바꿔도 깨지는 구간을 bridge로 제거한다.

**후보 파일 surface**

```text
app/src/app/auth/callback/route.ts
app/src/app/auth/callback/route.test.ts
app/src/lib/workspace/service.ts
app/src/lib/workspace/service.test.ts
app/src/lib/workspace/migration.test.ts
```

실제 changed files는 Writer Gate에서 code search로 확정한다.

**Entry**

- N2 Exit 완료
- T03 계약 정본과 existing caller inventory 연결
- 전용 DEV worktree/branch/file lease
- missing-function 오류의 정확한 Supabase/PostgREST 표현을 fixture로 고정

**앱 계약**

- RPC 우선 호출
- 정확한 function-not-found에만 legacy fallback
- 권한, constraint, audit, network, timeout 오류에는 fallback 금지
- fallback 사용 여부는 개인정보 없이 측정 가능
- 운영 기능 성공처럼 가장하지 않고 명시적 provisioning 오류 제공

**필수 테스트**

- RPC 존재 환경: RPC 1회, direct INSERT 0
- RPC 미존재 환경: 허용된 missing-function 오류에서만 legacy 1회
- permission/constraint/audit/network 오류: fallback 0, fail closed
- duplicate callback과 새로고침 멱등
- 기존 #19/#20 회귀

**Exit**

- Compatibility App이 T10 후보 판정을 받고 배포된다.
- 008 직전 RPC 미존재 환경과 008 직후 RPC 존재 환경에서 모두 정의된 동작을 한다.

**STOP**

- 모든 RPC 오류에 legacy fallback하는 경우
- direct INSERT 호출을 찾지 못한 채 caller inventory 완료를 주장하는 경우
- compatibility bridge를 영구 경로로 설계하는 경우

---

### N4 — Maintenance Window / 008+ Expand

**후보 migration**

```text
supabase/migrations/008_p0_authz_expand.sql
```

기존 `001`~`007` 수정은 금지한다. 실제 번호는 Writer Gate에서 최신 main과 다른 migration lease를 확인한 뒤 확정한다.

**Entry**

- N3 Exit 완료
- aggregate/existence-only preflight 완료
- Owner 0명·복수 Owner·owner scope 이상·중복/고아 membership이 모두 0이거나 수동 remediation 승인
- direct org/membership DML caller 목록 확정
- maintenance/read-only window와 DB operator 승인
- rollback/forward-fix·앱 복귀 계획

**데이터·권한 계약**

- Owner partial unique index: 최대 1명
- `role<>'owner' OR scope='all'` CHECK
- `orgs`와 `org_members` 양쪽의 `DEFERRABLE INITIALLY DEFERRED` exact-one enforcement
- org insert/restore와 OLD/NEW org membership 이동까지 commit 시 검사
- Platform, Invite, Global/Workspace Profile, Session, Security, Audit 구조 추가
- 좁은 SECURITY DEFINER RPC와 fixed `search_path`
- direct org/org_members DML privilege·policy 회수
- broad `users_select`, `members_manage`, direct audit mutation 제거
- `007.create_first_lead` membership 검사를 active membership/non-revoked session으로 강화

**필수 RPC surface**

```text
create_workspace_with_owner
create_workspace_invite
accept_workspace_invite
revoke_workspace_invite
set_non_owner_membership
remove_non_owner_member
transfer_workspace_owner
rename_workspace
suspend_workspace / restore_workspace
schedule_workspace_deletion / cancel_workspace_deletion
revoke_current_session
revoke_all_account_sessions
```

**필수 테스트·증거**

- T03 공격·경계 1~54 중 008/bridge 적용분 non-skip
- direct authenticated org/org_members DML 거부
- 정상 create RPC 결과 org 1, Owner 1/all, profile 1, audit 1
- Owner/profile/audit 중 하나 실패 시 전체 0
- org-only insert/restore commit 거부
- 같은 transaction의 org+Owner restore 성공
- Owner transfer 후 정확히 1명
- tenant A/B RLS와 session cutoff
- maintenance 중 mutation endpoint가 실제로 닫혔다는 증거

**Exit**

- migration transaction commit 직후 smoke가 통과한다.
- direct legacy fallback 호출은 0이고 Compatibility App은 RPC로 Workspace를 생성한다.
- maintenance 해제 여부를 T10/운영 owner가 판정한다.
- 008만으로 P0 완료를 주장하지 않는다.

**STOP**

- preflight anomaly를 자동으로 승격·삭제·병합하려는 경우
- exact-one enforcement가 `org_members` 변화에만 걸리는 경우
- 기존 앱이 direct INSERT만 사용 중인데 008을 적용하려는 경우
- direct DML revoke를 완화하는 rollback을 준비하는 경우
- migration 일부만 적용된 상태에서 mutation을 재개하는 경우

---

### N5 — Strict App Cutover

**후보 파일 surface**

```text
app/src/lib/auth/session.ts
app/src/app/auth/callback/route.ts
app/src/app/auth/signout/route.ts
app/src/app/(app)/settings/members/**
app/src/lib/workspace/**
app/src/lib/memberships/**
app/src/lib/invites/**
app/src/lib/profiles/**
app/src/lib/sessions/**
```

존재하지 않는 후보 경로를 미리 만들지 않는다. Writer Gate의 code search와 T03 계약으로 실제 lease를 고정한다.

**Entry**

- N4 Exit 완료
- 008 RPC/RLS와 app 호출 계약 1:1 대조
- strict app DEV worktree/branch/file lease
- 008 환경에서 이전 app과 strict app의 rollback compatibility 확인

**화면·상태 계약**

- 고객 기본 UI에는 대표·팀장·사원만 표시한다.
- Platform 등급·지원 접근은 Workspace 역할처럼 표시하지 않는다.
- 현재 Workspace, role, profile, 로그인 기기, 현재/모든 기기 로그아웃을 찾을 수 있다.
- onboarding maintenance는 명시적 일시중지와 재시도 안내를 제공한다.
- provisioning 오류를 빈 Workspace나 성공 화면으로 가장하지 않는다.
- 초대는 `대기/만료/취소/수락` 상태를 표시하되 raw token은 노출하지 않는다.

**앱 계약**

- `platformRole ?? membership.role`과 Platform 기반 `scope=all` 제거
- Workspace role/scope와 Platform grant를 별도 context로 유지
- OAuth callback은 identity만 갱신하고 편집된 profile을 덮지 않음
- Workspace cookie/slug는 선택 힌트이며 매 요청 DB membership 재검증
- membership/profile/invite/session 변경은 전용 RPC만 호출
- Compatibility direct INSERT fallback 제거
- 008 미적용 환경은 명시적 fail closed

**필수 테스트**

- Platform-only 사용자의 tenant 데이터 0/거부
- 명시적 Workspace membership이 있을 때 그 범위만 적용
- 재로그인 후 Global/Workspace Profile 보존
- invite 동시수락·replay·취소·만료
- membership 변경 직후 기존 JWT/direct PostgREST 거부
- current logout과 all-device logout 분리
- Compatibility fallback 호출 0
- #19/#20 첫 가치 흐름 회귀

**Exit**

- strict app이 배포되고 legacy direct DML 코드·호출이 0이다.
- 새 app SHA에서 login→workspace→first lead→refresh→invite/session smoke가 통과한다.
- 009가 제거할 legacy 표면 목록이 확정된다.

**STOP**

- strict app을 008 없는 환경에 배포하려는 경우
- Platform grant가 Workspace role/scope를 계속 덮는 경우
- UI 숨김만으로 권한을 검증하는 경우
- 세션 revoke가 외부 Auth 성공에만 의존하고 DB cutoff가 없는 경우

---

### N6 — 009+ Legacy Lockdown

**후보 migration**

```text
supabase/migrations/009_p0_authz_legacy_lockdown.sql
```

**Entry**

- N5 Exit 완료
- legacy 호출 0건을 코드 search·runtime metric으로 확인
- 009 writer/DB operator/file lease와 forward-fix 계획
- T08/T10 최종 공격 fixture 준비

**계약**

- 이메일 기반 `app_admin_role`의 Workspace role 의미 제거
- 이메일 allowlist Owner 자동부여 경로 제거
- compatibility grant/policy/function과 legacy fallback 제거
- 남은 direct org/membership/audit 우회 제거
- broad users/member policy 잔존 0

**필수 테스트**

- T03 test 55: strict app 뒤 legacy direct insert 코드·호출·fixture 0
- authenticated direct org INSERT/UPDATE/DELETE 거부
- Platform-only → Workspace role 합성 0
- email/identity enumeration 거부
- strict app 전체 smoke와 rollback 불변식

**Exit**

- 009 적용 뒤 strict app만 정상 동작한다.
- legacy grant/policy/function 잔존 0을 DB catalog로 증명한다.
- T10 실DB 공격 gate로 승격한다.

**STOP**

- strict app이 legacy 표면을 아직 호출하는 경우
- 장애 대응으로 broad policy 또는 direct DML을 복구하려는 경우
- 009 일부만 적용하고 운영 mutation을 재개하는 경우

---

### N7 — 실DB / T08 / T10 Gate

**Entry**

- N6 Exit 완료
- [`08-test-matrix.md`](./08-test-matrix.md)가 존재하고 비어 있지 않음
- T03 공격·경계 1~55가 T08 scenario/fixture/evidence owner에 연결됨
- T08 기능군 `S01~S10`, `H01~H12`, `T01~T13`, `I01~I16`과 A1 `41~55`가 final candidate SHA의 실행 manifest에 고정됨
- 최종 app/migration SHA, synthetic tenant A/B, Owner/Admin/Member fixture 고정
- 비밀값과 실제 고객 데이터 없는 증거 수집 계획

**필수 수용조건**

- `scripts/check.sh`, production build, targeted tests 모두 PASS
- 실제 적용 순서와 migration catalog 증거
- Owner exact-one, direct DML, Platform/Workspace, Invite, Profile, Session, RLS, Audit 1~55 non-skip PASS
- cross-tenant는 대상 데이터가 실제 존재함을 먼저 증명하고 타 tenant에서 0/거부를 확인
- 동시성은 실제 반복/동시 요청과 최종 row/event 수를 확인
- 새로고침·재로그인·오래된 탭·기존 JWT·refresh 경계 확인
- 화면 전후·오류·maintenance·재시도·권한 없음 상태 증거
- evidence SHA와 최종 candidate SHA 일치

**Exit**

- T10 구현 재검수 PASS
- `BLOCKED`, `NOT_RUN`, skip 0
- 사용자 검토와 필요한 운영 승인 완료
- 그 전까지 Partner/Admin/Invite/Owner 이전/Workspace lifecycle 운영 write HOLD 유지

**STOP**

- 단위테스트나 스크린숏을 실DB/RLS 증거로 대체하는 경우
- fixture가 없는데 0행을 tenant 격리 PASS로 간주하는 경우
- rebase/merge 후 예전 SHA 증거를 재사용하는 경우
- 개인정보·토큰·쿠키가 증거에 포함된 경우

---

## 6. 화면·파일·데이터·상태 계약 요약

### 화면 계약

| 화면/상태 | 최소 계약 |
|---|---|
| 로그인·OAuth | identity만 갱신; Platform과 Workspace 권한 합성 금지 |
| Workspace 준비 | RPC 기반 생성; maintenance·provisioning 오류를 명시적으로 표시 |
| 첫 고객·첫 업무 | 회사+딜 원자 생성; 중복 제출 0; 새로고침 영속 |
| 멤버·초대 | 대표/팀장/사원 표시; Owner 공격 차단; token 비노출 |
| 프로필 | Global/Workspace 편집 경계; role/scope payload 거부 |
| 세션 | 현재 기기/모든 기기 로그아웃 구분; cutoff 뒤 stale session 거부 |
| 오늘 홈 | 실제 source만 사용; 권한 밖 후보·집계 0; 임시 금액을 실적으로 표시 금지 |

### 파일 계약

- PR #19·#20 기존 branch와 files는 기존 writer 확인 없이 수정하지 않는다.
- Compatibility App, 008, Strict App, 009는 서로 다른 rollback 단위로 lease를 분리하되 공용 파일 중복 lease는 금지한다.
- Supabase는 새 migration만 추가하며 `001`~`007` 변경 0을 T10이 확인한다.
- 이 허브에서 T02 writer는 이 파일만 수정한다.

### 데이터 계약

```text
Workspace 1 ── exactly 1 protected Owner
Account Identity 1 ── 1 Global Profile
User N ── N Workspace Membership
Membership 1 ── 1 Workspace Profile
Invite ── atomic accept ── Membership + Workspace Profile + Audit
Role/Scope mutation ── Session Cutoff + Audit in same transaction
Platform Grant ── no implicit Workspace Membership
```

### release 상태 계약

```text
HOLD
→ PR19_CANDIDATE
→ PR19_LIVE_VERIFIED
→ PR20_REBASED
→ PR20_LIVE_VERIFIED
→ COMPAT_APP_DEPLOYED
→ MAINTENANCE_008_APPLIED
→ STRICT_APP_DEPLOYED
→ LEGACY_009_LOCKED
→ LIVE_ATTACKS_55_PASS
→ T10_IMPLEMENTATION_PASS
```

어떤 상태도 중간 단계의 성공을 전체 P0 완료로 표시하지 않는다.

---

## 7. 실패·복구·보안·권한 경계

### 공통 STOP

- base/head 또는 migration 번호가 문서와 달라짐
- existing writer/lease 불명확
- 007을 006보다 먼저 적용
- DB보다 대응 app을 먼저 배포해 호출 계약이 깨짐
- Owner 0/복수 anomaly를 자동 보정
- direct DML 또는 broad RLS를 임시 편의로 유지
- cross-tenant·Owner 공격·invite replay 중 하나라도 성공
- 실DB skip을 PASS로 집계
- 증거 SHA와 candidate SHA 불일치

### 복구 원칙

- app 문제는 이전 검증 app 또는 forward-fix를 사용하되 DB 보안 제약을 완화하지 않는다.
- DB P0 장애는 mutation을 maintenance/read-only로 전환하고 자동 down migration을 실행하지 않는다.
- Owner constraint, tenant RLS, direct DML revoke를 되돌리는 복구는 금지한다.
- 외부 Auth revoke 장애에도 DB cutoff는 유지한다.
- 008·009 anomaly는 개인정보 없는 집계만 보고하고 수동 DECISION_GATE로 보낸다.
- import/restore도 Workspace와 Owner를 같은 transaction에 만들지 못하면 commit하지 않는다.

### 권한 우선순위

```text
tenant 격리
> protected Owner
> deny 우선과 최소권한
> 원자적 감사·세션 폐기
> 위임 자유도
> 단순 UX
```

---

## 8. 테스트·수용조건과 증거 포맷

각 DEV/DB/T10 packet은 최소한 다음 필드를 가진다.

```text
WORK-ID
contract revision
base SHA / head SHA
migration filename + commit SHA
changed-file list
environment alias
synthetic fixture version
before aggregate counts
execution command
positive assertion
negative assertion
API/RPC result
after aggregate counts
duplicate/event count
refresh/relogin/stale-session result
deployment SHA
rollback/forward-fix rehearsal
redaction check
evidence owner
T10 reviewer
executed_at
result: PASS | FAIL | BLOCKED | NOT_RUN
```

허위 PASS 방지:

- 버튼 미노출은 서버 권한 증거가 아니다.
- 빈 목록은 fixture 부재·오류·격리 성공을 구분하지 못한다.
- API 403은 DB RLS 직접 검사를 대체하지 않는다.
- mock DB는 실DB 제약·동시성 증거가 아니다.
- 한 번 성공은 멱등성 증거가 아니다.
- 로그아웃 화면 전환은 stale JWT 차단 증거가 아니다.
- `08-test-matrix.md`의 필수 scenario가 `BLOCKED/NOT_RUN`이면 전체 READY가 아니다.

---

## 9. 병렬 가능 작업과 직렬 Writer 작업

### 병렬 가능한 REPO_READONLY / HUB_WRITE

- T08 테스트 행렬 materialize 및 T03 test 1~55 연결
- Compatibility App caller inventory
- 008 aggregate-only preflight query 설계
- synthetic tenant/role/동시성 fixture 설계
- maintenance·deploy·rollback runbook 초안
- T10 evidence template 준비
- 홈·팀·import 목업과 계약 정제

### 반드시 직렬인 CODE_WRITE / WORKTREE_LEASE

```text
PR #19/006
→ PR #20 rebase/007
→ Compatibility App
→ 008 Expand
→ Strict App
→ 009 Lockdown
→ final cumulative T10 gate
```

동일 app/auth/workspace 파일을 Compatibility App과 Strict App writer가 동시에 수정하지 않는다. 선행 PR이 main에 들어가고 새 base SHA가 고정된 뒤 다음 DEV worktree를 연다.

---

## 10. 즉시 다음 WORK-ID — IMPLEMENTATION-WRITER-GATE-01

### 목표

이 문서의 미결정을 해소하고 실제 DEV worktree와 PR 단위를 열되, 기존 PR writer와 migration lease를 침범하지 않는다.

### 필수 입력

- 이 문서
- [`03-p0-authz-contract.md`](./03-p0-authz-contract.md)
- [`08-test-matrix.md`](./08-test-matrix.md) — 없으면 T10 evidence lane은 `BLOCKED`
- 최신 GitHub main·PR #18/#19/#20
- current worktree/branch/status/lease 목록
- 배포 자동화와 DB operator 상태

### 출력

1. 기존 PR #19/#20 owner 확인 또는 명시적 인계
2. 각 노드의 DEV worktree·branch·feature owner·file lease
3. 실제 migration 번호와 PR 분할
4. 배포·maintenance·DB operator·rollback owner
5. T08 scenario/evidence owner 연결
6. `READY / BLOCKED / DECISION_GATE` 판정

### Writer Gate 개방 조건

- `03`과 `08` 산출물이 모두 존재하고 비어 있지 않다.
- PR #19/#20 base/head와 writer가 확인된다.
- 006/007 실DB 환경과 운영 순서가 준비된다.
- Compatibility App과 Strict App file lease가 겹치지 않는다.
- 008/009 migration 번호와 단일 writer가 고정된다.
- T10이 증거 계획을 검수할 수 있다.

개방 조건이 하나라도 없으면 DEV를 바쁘게 보이기 위해 만들지 않고 `BLOCKED`로 남긴다.

---

## 11. 사용자 검토 / DEV / T10 상태

| 구분 | 현재 상태 | 다음 행동 |
|---|---|---|
| 사용자 검토 | `PENDING` | DAG·maintenance/HOLD·순서 확인; 구현·운영 write 별도 승인 |
| DEV | `BLOCKED — WRITER GATE NOT RUN` | `IMPLEMENTATION-WRITER-GATE-01`에서 owner/worktree/lease 확정 |
| PR #19 | `DRAFT CANDIDATE / LIVE DB NOT VERIFIED` | 006 실DB gate와 deploy 순서 확정 |
| PR #20 | `STACKED DRAFT / WAIT PR #19` | #19 후 새 main rebase와 007 gate |
| T03 | `CONTRACT PASS ONLY` | 구현·실DB 1~55·T10 재검수 필요 |
| T08 | `CONNECTED — DRAFT / NOT_RUN / PASS 0` | `T10-EVIDENCE-EXECUTION-01`에서 후보 SHA·fixture·실DB 환경별 행을 실행하고 증거 manifest 제출 |
| T10 | `IMPLEMENTATION NOT RUN` | final cumulative SHA에서 non-skip 증거 판정 |
| 운영 Partner/Admin write | `HOLD` | P0 전체 PASS와 별도 사용자 승인까지 금지 |

---

## 12. 다음 소비자

- **MWC/T09**: `IMPLEMENTATION-WRITER-GATE-01`을 실제 배정하고 산출물·owner·lease 존재를 확인한다.
- **DEV writer**: 이 문서를 branch/worktree/PR 순서와 entry/exit/stop 계약으로 사용한다.
- **T03**: migration/RPC/RLS/App 계약 drift를 검수한다.
- **T08**: test 1~55와 작은 조직 시나리오를 증거 추적표로 연결한다.
- **T10**: 각 노드의 candidate SHA와 final cumulative SHA에서 독립 PASS/FAIL을 판정한다.
- **사용자**: maintenance/HOLD와 실제 구현 순서를 검토하고 운영 write를 별도 승인한다.

이 문서가 존재하는 것만으로 DEV 또는 운영 write가 승인되지는 않는다. 다음 제품 변화는 `IMPLEMENTATION-WRITER-GATE-01`의 실제 worktree·branch·lease 산출물이다.
