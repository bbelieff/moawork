# P0 AuthZ Contract — 작은 조직 Owner·Invite·Profile·Session

> WORK-ID: `P0-AUTHZ-CONTRACT-02`  
> 보완: `REQUIRED AMENDMENT A1` 통합본  
> 기준: ROUND-20·ROUND-21, ACCESS-PARTNER-01 보안 발견  
> T10 판정: `PASS — CONTRACT ONLY`  
> 상태: 설계 계약만 통과. 구현·배포·운영 권한 부여는 승인되지 않음.

## 1. 해결할 문제와 작은 조직 사용자 가치

MoaWork의 초기 고객 화면은 `대표 → 팀장 → 사원`으로 단순하게 유지하되, 데이터베이스와 인증 계층에서는 다음 P0 보안 경계를 약화하지 않는다.

- 존재하는 Workspace마다 protected Owner가 정확히 1명이다.
- Admin은 Owner를 강등·삭제·변경하거나 자신 또는 타인을 Owner로 승격할 수 없다.
- Platform 권한과 Workspace 권한은 서로 다른 plane이다.
- 초대 수락은 멤버십·프로필·감사 기록과 함께 원자적으로 완료된다.
- Global Account, Workspace Profile, Membership Authorization을 분리한다.
- 역할 변경·멤버 제거·Owner 이전·로그아웃 시 기존 세션을 안전하게 폐기한다.
- 로그인한 사용자라는 이유만으로 다른 tenant의 사용자 정보를 볼 수 없다.

이 문서는 migration, RPC, RLS, 앱 cutover, release sequencing과 공격테스트의 최소 계약이다. 실제 SQL·애플리케이션 구현은 별도 writer lease와 T10 구현 재검수가 필요하다.

## 2. 현재 판정과 선행 순서

현행 구현은 다음 이유로 P0 기준을 충족하지 못한다.

- `members_manage FOR ALL` 정책이 Owner 대상 변경과 Owner 승격을 차단하지 않는다.
- `users_select`가 모든 로그인 사용자에게 `public.users` 전역 조회를 허용한다.
- 이메일 기반 플랫폼 관리자 판정이 Workspace role 및 `scope=all`과 합성된다.
- 안전한 invite/pending-membership 경로가 없다.
- Global/Workspace 프로필과 세션 폐기 계약이 없다.
- `audit_logs`에 일반 Workspace member가 직접 INSERT할 수 있다.

확인된 직렬 순서는 다음과 같다.

```text
PR #19 / 006_workspace_bootstrap
→ PR #20 / 007_first_lead
→ compatibility app release
→ maintenance/read-only window
→ 008+ P0 expand 및 DB lockdown
→ strict app cutover
→ 009+ legacy lockdown
→ 실DB non-skip 공격테스트
→ T10 구현 PASS
→ 운영 권한 반영 검토
```

실제 migration 번호는 구현 직전 최신 `main`을 확인해 배정한다. 이 문서는 번호나 writer lease를 점유하지 않는다. 기존 `001`~`007`은 수정하지 않는다.

## 3. 확정 결정

- MVP Workspace protected Owner는 정확히 1명이다.
- Workspace 문맥은 `/w/{workspaceSlug}` 구조를 사용한다.
- 고객 기본 표시는 `대표·팀장·사원`이다.
- Platform 권한은 `1~4급 권한 등급 + 운영·고객지원·보안·결제·플랜 담당영역`으로 표현하며 Workspace role과 분리한다.
- 로그인 이메일은 기본 마스킹한다.
- Global Account와 Workspace Profile을 분리한다.
- 개인 데이터 export와 Workspace 업무자료 export를 분리한다.
- 모든 일반 회원 세션은 절대 30일, 미사용 7일을 기본값으로 한다.
- 모든 기기 로그아웃은 계정 전체와 모든 Workspace에 적용한다.
- Platform support session은 일반 로그인 세션과 별도의 임시 grant이며 tenant 업무데이터 수정권을 주지 않는다.
- P0 구현과 실DB 공격테스트가 끝나기 전 ACCESS-PARTNER-01과 신규 Admin membership 운영 write를 계속 보류한다.

## 4. 미결정·구현 시 확인 항목

다음 항목은 보안 불변식을 바꾸지 않는 범위에서 별도 결정 또는 실측이 필요하다.

- 실제 운영 DB의 org별 Owner 수, Owner scope, 중복·고아 membership 상태
- 운영 identity와 legacy 플랫폼 allowlist의 정확한 매핑
- invite 만료기간, 재발송 횟수, 개인정보 보존·삭제기간
- 탈퇴 취소기간과 법적 보존기간의 최종 정책
- Workspace 삭제·복구의 운영 승인자와 백업 보존기간
- support grant의 세부 TTL과 운영 승인 정족수
- 적용 시점의 최신 migration 번호, feature writer, file lease, maintenance 시간

실제 데이터 이상은 자동 보정하지 않는다. Owner 후보를 추측하거나 임의로 role을 바꾸지 않고 `DECISION_GATE`에서 수동 판정한다.

### 4.1 추천 Draft

다음은 보안 불변식이 아니라 DEV 설계 시 우선 검토할 추천안이다.

- Invite 만료 기본값은 짧게 두고 재발송 시 기존 active invite를 취소한다.
- Owner 이전 뒤 기존 Owner는 즉시 삭제하지 않고 `admin/all`로 남긴 뒤 별도 제거·업무인계 절차를 거친다.
- Workspace 구성원 화면은 로그인 이메일 대신 Workspace 표시명과 역할을 기본 열로 사용한다.
- Compatibility bridge는 정확한 RPC function-not-found에서만 legacy 경로를 사용하고 다른 오류는 모두 fail closed한다.
- 보안 제약 적용 뒤 문제가 발생하면 제약을 되돌리기보다 신규 Workspace·Invite·Membership 쓰기를 일시 중지하고 forward-fix한다.

### 4.2 Read-only Preflight 검사 카탈로그

Preflight 결과는 개별 식별자나 이메일을 출력하지 않고 `정상/비정상 개수`, `존재 여부`, `최대·최소값` 수준으로만 보고한다.

| 영역 | 집계·존재 여부 검사 | 결과 상태 |
|---|---|---|
| Migration | 운영 적용 migration의 최고 번호, 006·007 존재·적용 여부 | 검사 필요 |
| Workspace | 전체 org 수, Owner 0명 org 수, Owner 2명 이상 org 수 | 검사 필요 |
| Owner | `scope!=all` Owner 수, 중복 Owner 제약 위반 가능성 | 검사 필요 |
| Membership | 중복 org/user 수, 고아 org/user FK 수, 비정상 role/scope 수 | 검사 필요 |
| Platform | Legacy allowlist 수, 실제 identity 매핑 수, Platform과 Owner 합성 호출자 존재 | 검사 필요 |
| Invite | 기존 invite table·RPC·token 저장 방식 존재 여부 | 현재 코드상 미구현, 운영 재확인 필요 |
| Profile | OAuth profile upsert 호출자 수, Global/Workspace 필드 충돌 가능성 | 코드상 덮어쓰기 경로 확인, 운영 데이터 검사 필요 |
| Session | 현재/all-device logout 구현, Auth 설정의 absolute/idle 정책, revoke cutoff 저장소 | 현재 계약 미충족, 외부 설정 검사 필요 |
| RLS | `members_manage`, broad `users_select`, direct `audit_insert`, org direct 정책·ACL 존재 | 현행 migration에서 존재 확인 |
| App caller | Direct org/org_members/users DML, `setMemberRole`, Platform role 합성, local fallback 호출 위치 | 코드 정적 검사 필요 |
| PR 호환성 | 006의 Owner-only bootstrap, 007의 membership-only first-lead 검사와 008 교체 지점 | 코드 확인 완료, 적용 상태 검사 필요 |
| 운영 전환 | In-flight onboarding·invite·role mutation 수, maintenance/read-only 전환 가능 여부 | 검사 필요 |

Preflight SQL 또는 운영 조회를 실행할 때도 결과에는 row id, 이메일, token, cookie, 고객 원문을 포함하지 않는다.

### 4.3 Anomaly → 위험 → 금지선 → Decision Gate

| 발견 유형 | 위험 | 자동변환 금지선 | 안전한 변환 후보 | DECISION_GATE |
|---|---|---|---|---|
| Owner 0명 org | 복구 주체 부재 | 최근 로그인·생성자 추정으로 Owner 지정 금지 | 검증된 법적/운영 대표를 별도 확인한 원자 복구 | 대상 Owner 수동 확정 |
| Owner 2명 이상 org | 상호통제·이전 경합 | 임의 1명 유지·나머지 강등 금지 | 양 당사자·운영 기록 확인 후 별도 remediation transaction | 유지 Owner와 이전 역할 확정 |
| Owner scope 불일치 | 보호자 기능 오작동 | 일괄 `all` 자동변경 금지 | 영향 분석 뒤 Owner별 수동 보정 | 실제 의도·업무 영향 확인 |
| 중복 membership | 권한·세션 판정 불일치 | 최신/오래된 row 임의 삭제 금지 | audit·업무 소유권 확인 후 병합 | canonical row 선택 |
| 고아 membership/profile | 개인정보·참조 무결성 문제 | cascade 추정 삭제 금지 | quarantine·보존정책 확인 후 정리 | 보존/삭제 정책 결정 |
| Platform과 Owner 합성 | 전 tenant 권한상승 | Platform flag를 membership으로 자동 backfill 금지 | Platform principal과 명시 Workspace membership 분리 | 각 Workspace membership 필요 여부 |
| Legacy direct caller | 008 뒤 앱 파손 또는 우회 | 권한 오류를 legacy write로 fallback 금지 | Compatibility app→maintenance→strict cutover | 배포창·bridge 승인 |
| Broad users visibility | Cross-tenant 개인정보 노출 | 기존 화면 유지를 위해 broad SELECT 존치 금지 | Self identity+Workspace profile projection | 화면 필수 필드 확정 |
| OAuth/profile 충돌 | 사용자 편집값 덮어쓰기 | 마지막 provider 값을 일괄 정본화 금지 | Identity snapshot과 user-edited profile 분리 | 충돌 필드 보존 기준 |
| Session registry 부재 | 폐기 후 JWT 재사용 | UI 쿠키 삭제만으로 완료 주장 금지 | DB cutoff+Auth revoke+app session registry | 운영 Auth 설정·재인증 UX |
| 006/007 미적용·불일치 | 함수·테이블 의존성 파손 | 008 선적용·기존 migration 수정 금지 | 006→007 검증 후 새 번호 migration | 실제 적용 순서·번호 |
| Owner 제약 적용 실패 | Owner 0/2 상태 허용 | 제약 제거 rollback 금지 | Mutation read-only 전환 후 forward-fix | 복구 작업·재적용 승인 |

## 5. 고객 표시와 내부 권한 매핑

| 고객 표시 | 내부 Workspace role | 보안 의미 |
|---|---|---|
| 대표 | `owner` | protected Owner, 정확히 1명, `scope=all` |
| 팀장 | `admin` | non-owner 하급 멤버만 관리, Owner 관련 권한 없음 |
| 사원 | `member` | 기본 초대 역할, 최소권한 |

- 표시명은 권한 preset이며 DB 제약을 대신하지 않는다.
- 초대 기본값은 `member`다.
- Owner만 `admin`을 지정할 수 있다.
- Admin은 `member` 초대와 허용된 non-owner 관리만 가능하다.
- Workspace Profile의 직책·팀명은 권한 필드가 아니다.
- 프로필의 직책을 `팀장`으로 바꿔도 membership role은 변하지 않는다.
- 고급 hierarchy와 team scope는 후속 기능이어도 Owner 불변식과 tenant RLS는 P0에서 먼저 강제한다.

## 6. P0 불변조건

### O1 — Owner 정확히 1명

DB에 `orgs` row가 존재하면 lifecycle 상태와 관계없이 commit 시 Owner 수가 정확히 1명이어야 한다. hard delete로 org row 자체가 사라진 경우만 검사 대상이 아니다.

### O2 — Owner row 보호

Owner는 항상 `role=owner`, `scope=all`이다. 일반 membership RPC와 직접 DML로 UPDATE 또는 DELETE할 수 없다.

### O3 — Admin 공격 차단

Admin은 Owner 강등·삭제·scope 변경, self/other Owner 승격, Owner invite를 할 수 없다.

### O4 — Owner 이전 단일 경로

Owner 이전은 `transfer_workspace_owner` RPC 한 경로에서 두 membership을 한 transaction으로 교체한다.

### O5 — Platform/Workspace 분리

Platform principal은 Workspace membership이나 Owner를 암시하지 않는다. Platform 등급·담당영역은 tenant RLS를 우회하지 않는다.

### O6 — Invite는 membership이 아님

초대가 생성되거나 메일이 발송된 것만으로 membership을 만들지 않는다.

### O7 — Invite acceptance 원자성

Invite consume, membership, Workspace Profile, audit는 한 transaction에서 모두 성공하거나 모두 실패한다.

### O8 — 프로필 분리

Auth Identity, Global Profile, Workspace Profile, Membership Authorization을 분리하며 OAuth 재로그인이 사용자 편집 프로필을 덮어쓰지 않는다.

### O9 — Tenant user 격리

Global identity를 전역 browse할 수 없다. self 외 구성원 표시는 shared Workspace profile projection만 사용한다.

### O10 — 권한 변경 시 세션 폐기

Role·scope 변경, membership 제거, Owner 이전은 해당 Workspace의 기존 privileged session을 DB에서 즉시 무효화한다.

### O11 — 계정 세션 정책

모든 기기 로그아웃은 계정 전체와 모든 Workspace에 적용한다. 일반 세션은 절대 30일, 미사용 7일이다.

### O12 — 감사 원자성

Privileged RPC의 audit 기록이 실패하면 mutation 전체를 rollback한다.

### O13 — 이중 방어

Privilege와 RLS를 모두 적용하며, direct DML과 RPC 내부 검증 중 하나만 통과해도 작업을 허용하지 않는다. `deny`가 `allow`보다 우선한다.

## 7. 데이터 구조 후보

| 대상 | 최소 필드·책임 |
|---|---|
| `org_members` | 기존 tenant membership. role/scope/status만 보유 |
| `platform_admins` | `user_id`, 1~4급, 상태. Workspace role 없음 |
| `platform_admin_areas` | 운영·고객지원·보안·결제·플랜 담당영역 |
| `workspace_invites` | org, 정규화 이메일, non-owner role/scope, token digest, 만료·수락·취소 상태, request id |
| `account_identities` | provider가 관리하는 로그인 identity와 검증 상태. 서버 쓰기 전용 |
| `global_profiles` | 사용자가 관리하는 공통 이름·아바타 |
| `workspace_member_profiles` | org별 표시명·직책·팀. role/scope 없음 |
| `account_security` | 계정 전체 `sessions_revoked_before` |
| `workspace_session_revocations` | org/user별 세션 cutoff와 reason code |
| `account_sessions` | digest, user, created/last-seen/expires/revoked. raw token 없음 |
| `audit_logs` | privileged RPC 전용 append-only 기록. PII·token·고객 원문 없음 |

## 8. Migration 계약

### 8.1 사전 검사

Migration은 다음 집계 검사 중 하나라도 비정상이면 식별자·PII를 출력하지 않고 중단한다.

- org별 Owner 수가 1이 아닌 Workspace 개수
- Owner인데 `scope!=all`인 row 개수
- 동일 org/user 중복 membership 개수
- 존재하지 않는 org/user를 가리키는 고아 row 개수
- legacy 플랫폼 판정과 Workspace Owner가 합성된 호출자 존재 여부
- broad `users_select`, `members_manage`, direct `audit_insert` 정책 존재 여부

이상 데이터는 자동으로 Owner를 선택하거나 삭제·승격하지 않는다.

### 8.2 Owner 최대 1명과 scope 제약

- `org_members(org_id) WHERE role='owner'` partial unique index로 최대 1명을 강제한다.
- `role<>'owner' OR scope='all'` CHECK를 추가한다.

### 8.3 Commit-time Owner 최소 1명

공통 assertion `assert_workspace_has_exactly_one_owner(p_org_id)`는 org row가 존재할 때 Owner 수가 정확히 1인지 검사한다. 오류에는 org 식별자나 PII를 포함하지 않는다.

두 개의 `DEFERRABLE INITIALLY DEFERRED` constraint trigger가 필수다.

1. `orgs` trigger
   - `AFTER INSERT OR UPDATE`
   - org만 만들고 Owner를 넣지 않은 transaction을 commit 직전에 거부한다.
   - suspend·restore 등 org 상태 전환에도 같은 검사를 적용한다.
2. `org_members` trigger
   - `AFTER INSERT OR UPDATE OR DELETE`
   - `org_id` 변경 시 OLD와 NEW org를 모두 검사한다.
   - Owner 제거, 두 명 생성, org 간 이동을 commit 시 차단한다.

Hard delete cascade에서 org row가 이미 사라졌으면 assertion은 종료한다. Soft-suspended 또는 pending-delete org는 Owner를 유지한다. Restore/import는 org와 Owner를 같은 transaction에 복원해야 한다.

### 8.4 Direct Workspace·Membership DML 차단

P0 migration에서 반드시 다음을 수행한다.

- `orgs_insert`, `orgs_update`, `orgs_delete` direct 정책 제거
- `members_manage` 정책 제거
- `public`, `anon`, `authenticated`의 `orgs` INSERT/UPDATE/DELETE privilege 회수
- `public`, `anon`, `authenticated`의 `org_members` INSERT/UPDATE/DELETE privilege 회수
- `add_org_owner` trigger 함수의 직접 EXECUTE 권한 회수
- `users_select(auth.uid() is not null)` 제거
- 일반 member의 direct `audit_logs` INSERT 제거

Workspace 생성·설정변경·정지·복구·삭제와 membership 변경은 각각 좁은 SECURITY DEFINER RPC 외 경로가 없다.

### 8.5 008+ Expand

- Owner index, CHECK, 양쪽 deferred trigger와 assertion 추가
- platform/invite/profile/session/security 구조 추가
- 좁은 RPC와 새 RLS 추가
- broad 정책과 direct DML privilege 제거
- `007.create_first_lead`의 membership 검사는 새 migration에서 active membership과 non-revoked session 조건으로 강화

### 8.6 009+ Legacy Lockdown

- 앱 cutover 검증 뒤 이메일 기반 `app_admin_role`의 Workspace role 의미 제거
- 이메일 allowlist에서 Owner를 자동 부여하는 경로 제거
- legacy fallback과 compatibility grant/policy/function 제거
- 남은 direct audit·membership·org 우회 경로 제거

## 9. RPC 계약

모든 함수는 `SECURITY DEFINER`, fixed `search_path`, `auth.uid()` 검증, 대상 org·actor·target 재조회, idempotency, 최소 반환값을 사용한다. `public`·`anon` EXECUTE를 회수하고 필요한 `authenticated` 호출자만 허용한다.

### `create_workspace_with_owner`

- Workspace 생성의 유일한 경로다.
- 입력: request id, 이름, slug.
- 한 transaction에서 org, caller의 owner/all membership, Workspace Profile, 생성 request/result, audit를 기록한다.
- Platform 등급·담당영역·이메일 allowlist를 Owner 결정에 사용하지 않는다.
- 내부 commit과 exception swallowing을 금지한다.
- Membership, profile, audit 중 하나라도 실패하면 org row까지 모두 rollback한다.
- 함수 종료 뒤 두 deferred trigger가 Owner 수 1을 다시 검증한다.

### `create_workspace_invite`

- Owner는 `member` 또는 `admin`, Admin은 `member`만 초대할 수 있다.
- Owner role 입력은 type/check/RPC 세 층에서 거부한다.
- 만료, active duplicate, seat, actor ceiling을 검사한다.
- raw token은 한 번만 반환하고 DB에는 digest만 저장한다.
- Audit·로그·오류에 이메일 원문과 token을 기록하지 않는다.

### `accept_workspace_invite`

- 인증된 verified identity만 호출한다.
- Digest로 invite를 `FOR UPDATE` 잠근다.
- 만료·취소·수락완료·이메일 불일치·org 불일치를 거부한다.
- Invite role이 Owner면 변조로 보고 fail closed한다.
- Membership, Workspace Profile, accepted mark, audit를 같은 transaction에서 처리한다.
- 동일 invite의 재호출은 같은 사용자·같은 결과일 때만 idempotent하게 반환한다.

### `revoke_workspace_invite`

- Owner는 자기 org의 모든 non-owner invite를, Admin은 자신이 만든 member invite만 취소할 수 있다.
- 이미 수락한 invite 취소로 membership을 삭제하지 않는다.

### `set_non_owner_membership`

- Owner는 Admin/Member 변경, Admin은 허용된 Member 하급자만 변경할 수 있다.
- Target의 현재 또는 새 role이 Owner면 거부한다.
- Self promotion, peer/higher 관리, Owner 입력을 거부한다.
- 변경, Workspace session cutoff, audit를 원자 처리한다.

### `remove_non_owner_member`

- Owner, self, peer/higher target을 금지한다.
- 필요한 업무 인계 precondition이 충족되지 않으면 fail closed한다.
- Membership 제거, session cutoff, profile 상태, audit를 원자 처리한다.

### `transfer_workspace_owner`

- Caller가 현재 Owner이고 민감 작업 재인증을 통과해야 한다.
- Target은 같은 org의 active non-owner여야 한다.
- Org와 두 membership을 row/advisory lock으로 직렬화한다.
- Target을 `owner/all`, 기존 Owner를 `admin/all`로 한 transaction에서 교체한다.
- 양쪽 session cutoff와 audit를 함께 기록한다.
- Request id로 idempotency를 보장한다.

### Workspace 위험 작업 RPC

- `rename_workspace`: Owner 전용, 허용된 표시 필드만 변경
- `suspend_workspace` / `restore_workspace`: lifecycle 상태와 session cutoff 포함
- `schedule_workspace_deletion` / `cancel_workspace_deletion`: direct hard delete 미노출

### 세션 RPC

- `revoke_current_session`: 현재 app/Auth session만 폐기
- `revoke_all_account_sessions`: 모든 app/Auth refresh session과 모든 Workspace의 계정 cutoff 갱신

## 10. RLS와 Grant 계약

- Platform row의 존재는 tenant table SELECT/WRITE 조건이 아니다.
- `account_identities`와 로그인 이메일은 self 또는 목적 제한 control RPC 외 조회 금지다.
- `global_profiles`는 self write를 기본으로 한다.
- `workspace_member_profiles`는 같은 active Workspace 구성원만 허용된 필드를 읽는다.
- Workspace Profile UPDATE는 self 표시 필드와 Owner/Admin의 허용된 tenant 필드로 제한한다.
- Profile API와 RLS는 role/scope 변경을 허용하지 않는다.
- Invite raw table은 invitee가 직접 조회하지 못한다.
- Session, security, audit table의 raw client DML을 금지한다.
- 모든 tenant policy는 `auth.uid()`, active membership, org id, `session_not_revoked(org_id)`를 함께 검사한다.
- 구성원 목록은 Workspace Profile projection을 사용하며 login email 원문을 기본 열로 노출하지 않는다.
- RLS helper는 caller가 임의 org id로 다른 사용자나 Platform 상태를 열거하지 못해야 한다.

## 11. 앱 Cutover 계약

- OAuth callback은 provider identity만 갱신한다.
- OAuth 최초 로그인에서만 profile 기본값을 만들고, 이후 로그인은 사용자가 편집한 Global/Workspace Profile을 덮어쓰지 않는다.
- Platform grant는 user id 기반 별도 context로 읽는다.
- `role = platformRole ?? membership.role` 및 Platform이면 `scope=all` 패턴을 제거한다.
- Platform principal이라는 이유로 org를 생성하거나 Owner로 자동 승격하지 않는다.
- Session context는 `workspaceRole/workspaceScope`와 `platformGrant`를 별도 필드로 유지한다.
- 멤버 UI와 server action은 direct `setMemberRole` 또는 table DML 대신 전용 RPC만 호출한다.
- Invite raw token은 URL/query/log에 남기지 않고 1회 POST로 제출한다.
- Workspace cookie와 slug는 선택 힌트일 뿐 권한 근거가 아니다. 매 요청에서 DB membership을 검증한다.
- 현재 세션 로그아웃과 모든 기기 로그아웃을 구분한다.

## 11.1 화면·파일·데이터·상태 계약

### 화면 계약

- 고객 기본 화면은 `대표·팀장·사원`과 현재 회사, 내 프로필, 로그인 기기, 현재/모든 기기 로그아웃만 우선 노출한다.
- Admin 화면에는 Owner role 선택·강등·삭제 control을 렌더하지 않는다. DOM에서 숨기기만 하지 않고 server/RPC/DB에서도 거부한다.
- Owner 이전은 일반 역할 select가 아니라 영향 범위, 재인증, 대상 확인, 실패·취소 상태를 가진 별도 위험 작업 화면이다.
- Invite 화면은 `초대 대기`, `만료`, `취소`, `수락 완료`를 membership과 구분해 표시한다.
- 로그인 이메일은 기본 마스킹하고, 구성원 목록은 Workspace Profile을 사용한다.
- Session 화면은 현재 기기와 다른 기기, 현재 로그아웃과 모든 기기 로그아웃의 영향 범위를 명확히 구분한다.
- Platform console은 Workspace 고객 화면과 별도 진입점이며 Platform 등급을 Workspace role처럼 표시하지 않는다.

### 파일 계약

- 기존 `supabase/migrations/001`~`007`을 수정하지 않는다.
- DB 변경은 구현 시 최신 번호로 새 migration 파일에만 추가한다.
- 앱 cutover 대상은 OAuth callback, session context, member action, invite flow, profile flow, logout/session revoke 경로다.
- Local fallback과 test fixture도 strict cutover에서 legacy direct org/membership write가 남지 않도록 정적 검사한다.
- Coordination, worklog, 디자인 HTML과 다른 writer lease는 이 계약 구현 범위가 아니다.

### 데이터 계약

- Auth Identity는 provider 검증정보, Global Profile은 사용자 공통 표시정보, Workspace Profile은 tenant별 표시정보, Membership은 role/scope/status만 가진다.
- Owner cardinality는 UI나 앱 캐시가 아니라 DB constraint와 transaction으로 판정한다.
- Invite raw token은 저장하지 않고 digest만 저장한다.
- Session raw token·cookie·refresh token은 저장하지 않는다.
- Audit payload에는 이메일 원문, token, cookie, 고객 업무 원문을 넣지 않는다.

### 상태 계약

```text
Workspace: provisioning → active → suspended → pending_delete → deleted
Invite: pending → accepted | expired | revoked
Membership: active → suspended | removed
Session: active → revoked | expired
Owner transfer: requested → reauthenticated → committed | cancelled | failed
```

- `provisioning → active` 전환은 Owner exactly-one 검증 뒤에만 가능하다.
- Invite `pending`은 Membership `active`가 아니다.
- Membership `removed`와 role/scope 변경은 기존 Workspace session cutoff를 갱신한다.
- Workspace `suspended`에서도 protected Owner row는 유지한다.
- Owner transfer 실패 시 이전 Owner와 대상의 상태가 모두 원상복구된다.

## 12. 세션 폐기 계약

- Supabase Auth와 app-managed session registry를 모두 확인한다.
- Protected request마다 절대 30일, idle 7일, revoked 상태, account cutoff, Workspace cutoff를 검사한다.
- `session_not_revoked(org_id)`는 JWT/session 발급시각이 cutoff보다 새롭지 않으면 거부한다.
- Claim 부재나 파싱 실패는 fail closed한다.
- Membership 제거, role/scope 변경, Owner 이전, Workspace suspend는 DB cutoff를 mutation과 같은 transaction에 기록한다.
- 외부 Auth revoke가 실패해도 DB cutoff가 기존 JWT의 direct PostgREST 접근을 즉시 차단해야 한다.
- 모든 기기 로그아웃은 계정 전체·모든 Workspace에 적용한다.
- Raw token, cookie, refresh token은 DB·audit·로그에 저장하지 않는다.

## 13. Release Sequencing

### Phase 0 — HOLD

- Partner/Admin/Invite/Lifecycle 운영 write를 보류한다.
- Current app/DB 상태를 read-back하고 in-flight onboarding을 0으로 만든다.

### Phase 1 — Compatibility App

- 008 전 앱에 `create_workspace_with_owner` RPC 우선 호출 경로를 추가한다.
- 함수가 정확히 `존재하지 않음`인 경우에만 기존 생성 경로를 사용하는 일시 bridge를 허용한다.
- 권한거부, constraint, audit, network 오류에는 fallback하지 않고 fail closed한다.
- Bridge 자체도 별도 PR과 T10 검수를 거친다.

### Phase 2 — Maintenance/Read-only Window에서 008+

- 신규 Workspace 생성 endpoint를 잠시 maintenance 또는 read-only로 전환한다.
- RPC, 양쪽 deferred trigger, org/membership direct DML revoke를 하나의 migration transaction으로 적용한다.
- Commit 직후 direct org DML 거부와 Workspace 생성 성공·rollback을 smoke한다.
- 확인 뒤 onboarding write를 재개한다.
- 008 적용 뒤 direct org INSERT fallback은 존재할 수 없다.

### Phase 3 — Strict App Cutover

- Legacy direct insert fallback을 제거한다.
- Platform grant에서 Owner/org를 자동 생성하는 경로를 제거한다.
- 008이 없는 환경은 명시적 provisioning error로 fail closed한다.

### Phase 4 — 009+ Lockdown

- Legacy 이메일 role 합성, allowlist fallback, 호환 grant와 정책을 제거한다.
- 전체 실DB 공격테스트가 non-skip PASS한 뒤에만 P0 완료를 검토한다.

Bridge를 사용하지 않는 경우 008과 strict app을 하나의 maintenance window에서 직렬 적용한다. 008을 먼저 적용해 기존 앱을 깨뜨리거나, 앱을 먼저 배포해 기존 DB에서 깨뜨리는 순서는 금지한다.

## 14. Rollback과 Forward-fix 경계

- Owner 제약, tenant RLS, direct DML revoke를 완화하는 rollback은 금지한다.
- 장애 시 신규 Workspace·Invite·Membership mutation을 maintenance/read-only로 전환한다.
- App/API 오류는 이전 취약 정책 복원이 아니라 forward-fix를 우선한다.
- 외부 Auth revoke 실패 시 DB cutoff를 유지하고 재시도 queue와 보안 경보를 사용한다.
- 008 적용 뒤 앱 미배포 상태를 정상 운영 상태로 간주하지 않는다.
- 009 전까지 Partner write HOLD를 유지하며 부분 적용을 P0 완료로 표시하지 않는다.
- Owner preflight anomaly는 migration을 중단하고 수동 remediation 결정으로 보낸다.

## 15. 공격·경계 테스트 1~55

하나라도 성공해서는 안 되는 공격이 성공하거나 필수 실DB 검사가 skip되면 전체 FAIL이다.

### Owner와 Admin

1. Admin direct UPDATE로 Owner를 Admin/Member로 변경할 수 없다.
2. Admin direct DELETE로 Owner를 삭제할 수 없다.
3. Admin은 self/other를 Owner로 INSERT 또는 UPDATE할 수 없다.
4. Admin은 Owner scope를 변경할 수 없다.
5. Owner도 일반 membership RPC로 self 강등·삭제할 수 없다.
6. Owner 2명과 Owner 0명 상태는 모두 commit되지 않는다.
7. 두 동시 Owner transfer 중 정확히 하나만 성공하고 Owner 수는 1이다.
8. Transfer 중 오류가 나면 old/new role이 모두 원상태다.
9. 모든 authenticated direct `org_members` INSERT/UPDATE/DELETE가 거부된다.
10. Forged UI/server action도 DB에서 동일하게 거부된다.

### Platform/Workspace 분리

11. Platform-only 사용자의 tenant table SELECT는 0이고 write는 거부된다.
12. Platform grade/area가 Workspace role/scope를 바꾸지 않는다.
13. Platform 사용자가 명시적 Workspace membership을 가지면 그 membership 범위만 적용된다.
14. Platform status만으로 org 생성 또는 Owner 자동부여가 발생하지 않는다.
15. Legacy 이메일 RPC로 타인의 Platform 여부나 role을 열거할 수 없다.

### Invite

16. 만료·취소·이메일 불일치·미검증 identity·token replay가 거부된다.
17. 같은 token을 동시에 수락해도 membership과 accepted event가 각각 1개다.
18. Membership INSERT가 실패하면 invite는 소비되지 않는다.
19. Admin의 Admin/Owner invite가 거부되고 Owner invite는 모든 경로에서 거부된다.
20. Raw token이 DB, audit, log, error, URL에 남지 않는다.
21. Org A invite로 Org B membership을 만들 수 없다.

### Profile과 Tenant

22. Org A 사용자가 Org B identity/profile을 조회할 수 없다.
23. `public.users`와 account identity 전역 enumeration이 불가능하다.
24. Shared Workspace directory에는 허용된 profile field만 보이고 login email 원문은 보이지 않는다.
25. OAuth 재로그인이 편집된 Global/Workspace Profile을 덮어쓰지 않는다.
26. Profile update payload에 role/scope가 포함되면 명시적으로 실패한다.
27. Cross-tenant profile UPDATE/UPSERT가 거부된다.

### Session

28. 현재 로그아웃 뒤 현재 session만 거부되고 다른 device는 유지된다.
29. 모든 기기 로그아웃 뒤 모든 device와 모든 Workspace가 거부된다.
30. 절대 30일과 idle 7일의 경계 직전·직후가 정확히 판정된다.
31. Role/scope 변경, remove, Owner transfer 직후 기존 JWT direct PostgREST가 거부된다.
32. 폐기된 refresh token으로 재발급할 수 없고 외부 revoke 장애에도 DB cutoff가 접근을 차단한다.
33. Org cookie/slug 변조로 다른 tenant에 접근할 수 없다.

### RLS와 Audit

34. `members_manage`와 broad `users_select` 정책이 존재하지 않는다.
35. User/profile/invite/session/audit 신규 table에 모두 RLS가 활성화되어 있다.
36. SECURITY DEFINER 함수가 fixed search path와 caller/auth/org/target 검사를 가지며 public/anon EXECUTE가 회수되어 있다.
37. Direct audit INSERT/UPDATE/DELETE가 거부된다.
38. Privileged mutation마다 audit이 정확히 1개이며 audit 실패 시 mutation은 0이다.
39. 기존 RLS harness의 credential 미주입 skip을 PASS로 계산하지 않는다.
40. App/service/RLS가 허용하는 집합이 동일하며 느슨한 레이어가 없다.

### A1 — Workspace 생성과 Exact-one 우회

41. Authenticated PostgREST direct org INSERT가 privilege와 policy에서 거부되고 org row는 0이다.
42. Authenticated direct org UPDATE/DELETE가 거부된다.
43. SECURITY DEFINER가 아닌 임의 client 경로로 org를 생성할 수 없다.
44. `create_workspace_with_owner` 정상 호출 결과는 org 1, Owner 1, Owner scope=all, profile 1, audit 1이다.
45. RPC 내부 Owner membership INSERT가 실패하면 org/profile/audit가 모두 0이다.
46. RPC 내부 audit INSERT가 실패하면 org/Owner/profile이 모두 0이다.
47. Org만 INSERT하는 test-only privileged transaction은 deferred org trigger 때문에 commit되지 않는다.
48. Owner 없는 org restore/import transaction은 commit되지 않는다.
49. Org와 Owner를 같은 transaction에 restore하면 Owner 수 1로 commit된다.
50. Owner DELETE 뒤 대체 Owner를 넣지 않으면 deferred membership trigger가 commit을 거부한다.
51. 기존 Owner를 내리고 새 Owner를 올리는 transfer transaction은 Owner 수 1로 commit된다.
52. `org_id` 변경으로 OLD org가 Owner 0명이 되면 OLD org 검사로 commit이 거부된다.
53. 008 직후 bridge 앱 Workspace 생성은 RPC로 성공하고 direct fallback 호출은 0이다.
54. 008 미적용 bridge 환경에서도 정확한 function-not-found 외 오류에는 fallback하지 않는다.
55. Strict app release 뒤 legacy direct insert 코드·호출·test fixture가 0이다.

## 16. T10 증거 요구사항

- 기존 `001`~`007` 변경 0
- Migration 파일 정렬과 실제 적용 순서
- PII, seed, raw token, cookie, service credential diff 0
- Owner partial unique, scope CHECK, orgs/org_members deferred trigger 모두 존재
- Org와 membership direct DML의 privilege·policy 양쪽 차단
- Platform role이 `org_role`, `org_scope`, Workspace session role을 덮지 않는 코드 증거
- Invite Owner 값의 type/check/RPC 3층 차단
- Auth Identity, Global Profile, Workspace Profile, Membership Authorization의 writer 분리
- Current/all-device logout과 role-change revoke의 실DB 증거
- App check, production build, 두 tenant fixture, 동시성 테스트, 실DB 공격테스트 모두 non-skip
- 운영 read-back은 집계·존재 여부만 보고하며 실제 이메일·식별자·고객 데이터를 출력하지 않음

## 17. HOLD와 완료 기준

다음 조건이 모두 충족되기 전에는 ACCESS-PARTNER-01, 신규 Admin membership, Invite, Owner 이전, Workspace lifecycle 운영 write를 실행하지 않는다.

1. 최신 main에서 migration 번호와 writer lease 재확인
2. 006·007 선행 적용과 검증
3. Compatibility app 검수
4. Maintenance/read-only window 승인
5. 008+ migration 적용과 smoke
6. Strict app cutover와 009+ lockdown
7. 공격테스트 1~55 실DB non-skip PASS
8. T10 구현 재검수 PASS
9. 필요한 운영 작업에 대한 별도 사용자 승인

부분 PASS는 없다. Contract PASS는 구현·배포·운영 write 승인이 아니다.

## 18. 다음 소비자

- **T02**: `006 → 007 → compatibility app → maintenance 008+ → strict app → 009+ → 실DB gate` 구현 readiness와 serial DAG의 입력으로 사용한다.
- **T08**: 공격·경계 테스트 1~55를 작은 조직 통합 테스트 행렬에 반영한다.
- **T10**: Migration/RPC/RLS/App/Release/실DB 다섯 층 구현 게이트와 non-skip 증거 기준으로 사용한다.
- **T06**: 팀 성장 흐름에서 invite와 non-owner membership RPC만 사용한다.
- **T09/MWC**: Writer lease, migration 번호, maintenance window, 운영 HOLD를 다음 wave에서 관리한다.

### 즉시 다음 WORK-ID

`P0-AUTHZ-WRITER-GATE-01`

목적은 구현을 즉시 시작하는 것이 아니라 다음 항목을 충족한 뒤 DEV DB/RLS writer를 안전하게 여는 것이다.

1. 최신 main과 006·007 적용상태 확인
2. 집계형 preflight 실행 승인과 결과 판정
3. 실제 migration 번호와 단독 writer lease 배정
4. Compatibility app과 maintenance/read-only window 순서 확정
5. T10 구현 검수자와 non-skip 실DB fixture 준비

## 18.1 사용자·DEV·T10 상태

| 주체 | 현재 상태 | 다음 조건 |
|---|---|---|
| 사용자 검토 | `PENDING` | 이 제품 정본과 HOLD·release 순서 확인 |
| DEV DB/RLS writer | `NOT ASSIGNED / BLOCKED` | `P0-AUTHZ-WRITER-GATE-01`에서 번호·lease·preflight·maintenance 승인 |
| T10 계약 검수 | `PASS — CONTRACT ONLY` | 구현 diff, migration, app cutover, 실DB 1~55 재검수 필요 |
| 운영 권한 반영 | `HOLD` | T10 구현 PASS와 별도 운영 승인 전 write 금지 |

## 19. Blindspot Pass

- 전체: 작은 조직 화면을 단순화해도 보안 경계는 DB에서 독립적으로 강제되어야 한다.
- 부분: Owner cardinality, org/membership direct DML, invite race, profile overwrite, Platform role 합성, stale session, user enumeration을 각각 닫는다.
- 전체 재검증: `팀장` UX가 Owner 관리권으로 확장되거나 Platform 운영권이 tenant 권한으로 합성되면 전체 원칙이 무너진다. 내부 Platform 등급을 고객 첫 화면에 노출할 필요는 없다.
- 지금: P0 migration·RPC·RLS·cutover·release·공격테스트 계약.
- 실험: 고객 표시명, 도움말, masked directory UX.
- 백로그: Team-scoped hierarchy, SCIM/SSO, 고급 support access.
- 기각: Platform Admin 자동 Owner, generic RPC의 Owner 수정, invite 즉시 membership, login email 전역 directory, profile payload role 변경, client cookie 기반 권한.
