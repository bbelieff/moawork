# PR #19 post-Account 재베이스 독립 검수 게이트

> WORK-ID: `PR19-POST-ACCOUNT-REBASE-VERIFY-01`  
> 상위 WORK-ID: `PR19-POST-ACCOUNT-REBASE-01`  
> 상태: **CONTRACT READY / CODE_READY WAIT / EXECUTION NOT_RUN / FORCE-PUSH·006·LIVE DB·MERGE HOLD**  
> 기준 main: `ade79e753ff4c99eab68b5a36bd8195245a6d57b`  
> 재베이스 전 PR #19 head: `b28a5fa4573e01154943a410b52a74ff11052dc7`  
> 검수 worktree: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\moawork-wt-workspace-bootstrap`  
> 제품 코드 sole writer: T01  
> 독립 reviewer: T10  
> 다음 소비자: T09 collector, MWC, T02  
> T10 금지: 제품 코드 수정, commit/push/force-push, migration 적용, DB write, merge, deploy

## 1. 목적과 판정 경계

PR #19의 기존 Workspace bootstrap 변경을 Account C가 배포된 `main@ade79e7` 위로 다시 올렸을 때 다음 두 목적을 동시에 만족하는지 새 local SHA에서 검증한다.

1. PR #19의 Workspace bootstrap·entitlement·callback 변경과 `006_workspace_bootstrap.sql`이 유실되거나 변형되지 않는다.
2. 배포된 Account C의 `AccountMenu`, `/account → /settings/account`, 계정 presentation, 현재 세션 전용 logout과 fail-closed 동작이 유실되거나 약화되지 않는다.

이번 검수의 PASS는 **local rebased candidate에 대한 독립 구현·회귀 PASS**다. 다음을 뜻하지 않는다.

- force-push 수행 또는 승인
- PR #19 merge 승인
- `006` migration 운영 적용 승인
- DEV DB·실DB·RLS PASS
- PR #20 rebase 완료
- Production release PASS

## 2. 입력 정본

우선순위는 최신 사용자/MWC 결정, 아래 Round 24 artifact, 실제 Git bytes 순이다.

1. `docs/coordination/sync/ROUND-24.md`
2. `docs/design/round-24/02-account-c-merge-order-amendment.md`
3. `docs/design/round-24/account-c-collector.md`
4. `docs/design/round-24/10-account-c-review-gate.md` §19 최종 권위
5. 재베이스 전 PR #19 `b28a5fa`와 기준 main `ade79e7`
6. T01이 전달할 final local candidate SHA와 clean worktree

과거 Account C 테스트·화면 PASS는 기대 동작을 정하는 참조일 뿐 새 후보의 PASS 증거로 재사용하지 않는다.

## 3. 사전 실측 스냅샷

### 3.1 재베이스 전 PR #19 고유 변경

`639d629e9c09bba63415a96d0d7d46c653fb24ac..b28a5fa4573e01154943a410b52a74ff11052dc7`의 변경은 11파일, 922 additions / 38 deletions다.

```text
M app/src/app/(app)/layout.tsx
M app/src/app/(app)/onboarding/page.tsx
M app/src/app/auth/callback/route.test.ts
M app/src/app/auth/callback/route.ts
M app/src/components/auth/FeatureGate.tsx
A app/src/lib/entitlements.test.ts
M app/src/lib/entitlements.ts
A app/src/lib/workspace/migration.test.ts
A app/src/lib/workspace/service.test.ts
A app/src/lib/workspace/service.ts
A supabase/migrations/006_workspace_bootstrap.sql
```

재베이스 후 최종 diff는 위 PR #19 의도와 Account C 기준선을 함께 보존해야 한다. 단순 파일 수 일치는 PASS가 아니다.

### 3.2 알려진 충돌 표면

재베이스 전 head를 새 main과 직접 비교하면 Account C 파일들이 삭제로 보인다. 이는 옛 base에서 갈라진 브랜치라는 증거이며 최종 후보에서 허용되지 않는다.

- 직접 충돌·결합 대상: `app/src/app/(app)/layout.tsx`, `app/src/app/auth/signout/route.ts`
- Account C 보존 대상: `/account`, `/settings/account/**`, `components/account/**`, `lib/account/**`, `lib/auth/account-ui.test.ts`, signout test
- PR #19 보존 대상: onboarding, callback, FeatureGate, entitlements, workspace service/tests, migration 006

### 3.3 불변 baseline

- 재베이스 전 migration 006 blob: `3d6f5deb891f10789dc4b636bc7d132c4d38fcd5`
- `ade79e7`의 Account C 비충돌 파일은 원칙적으로 동일 blob이어야 한다.
- `layout.tsx`와 signout route/test는 의미상 결합이 필요할 수 있으므로 blob 동일성 대신 아래 행위 계약으로 판정한다.

## 4. CODE_READY 입장 조건

다음 영수증이 모두 오기 전 실행 판정은 `NOT_RUN`이다.

| 항목 | 필수 증거 |
|---|---|
| branch/worktree | `feat/workspace-bootstrap`, 지정 clean worktree |
| base | merge-base가 `ade79e753ff4c99eab68b5a36bd8195245a6d57b` |
| candidate | 새 local commit 전체 SHA |
| history | `ade79e7`이 candidate의 ancestor이고 PR #19 고유 commit이 유실되지 않음 |
| state | `git status --short` 0건 |
| diff | `ade79e7..candidate` name-status/stat 제공 |
| writer | T01 write 종료와 sole-writer 해제 여부 명시 |
| push | 아직 force-push 0건 |

base/head/working bytes가 바뀌면 이전 실행 증거를 폐기하고 처음부터 재실행한다.

## 5. Contract / Implementation / Visual / Security / Merge / Release

| 층 | 현재 | PASS 최소조건 | 금지된 승격 |
|---|---|---|---|
| Contract | `READY` | 이 문서와 Round 24 artifact 연결 | 코드·DB PASS 아님 |
| Implementation | `NOT_RUN` | conflict diff, migration unchanged, targeted/full check/build, clean final SHA | Visual·Security PASS 아님 |
| Visual | `NOT_RUN` | 실제 후보의 desktop+390, light/dark, keyboard/focus, reduced-motion, console | merge 승인 아님 |
| Security | `NOT_RUN` | auth redirect, PII/Platform/위험 CTA 0, local logout fail-closed, secret scan | 006·실DB PASS 아님 |
| Merge | `HOLD` | 이 검수 PASS 뒤에도 별도 006/live DB gate와 MWC 승인 필요 | force-push나 merge 수행 아님 |
| Release | `BLOCKED` | 이번 작업 범위 밖 | local/Preview로 승격 금지 |

허용 결과 어휘는 `PASS | FAIL | BLOCKED | NOT_RUN | N/A`다. 현재 전체 판정은 **`PASS — CONTRACT READY ONLY`**다.

## 6. Conflict diff와 변경 범위 검수

final candidate 고정 후 다음을 기록한다.

```text
git status --short
git rev-parse HEAD
git merge-base ade79e753ff4c99eab68b5a36bd8195245a6d57b HEAD
git diff --name-status ade79e753ff4c99eab68b5a36bd8195245a6d57b..HEAD
git diff --stat ade79e753ff4c99eab68b5a36bd8195245a6d57b..HEAD
git diff --check ade79e753ff4c99eab68b5a36bd8195245a6d57b..HEAD
```

필수 판정:

- unmerged marker와 conflict marker 0건
- Account C 파일 삭제 0건
- PR #19의 11파일 의도 누락 0건
- 예상 밖 migration/RLS/Vercel/package dependency 변경 0건
- callback·layout·signout 결합 diff가 각 계약을 동시에 보존
- generated/vendor/build artifact 0건
- diff check whitespace error 0건

### 6.1 layout 결합 계약

- `AccountMenu`가 실제 layout에 남아 있고 이름 있는 계정 진입점이 유지된다.
- PR #19 entitlement source와 error banner가 유지된다.
- entitlement 오류를 조용한 fake/local 성공으로 바꾸지 않는다.
- Platform grant를 Workspace role/scope로 합성하지 않는다.
- raw role/scope를 고객용 역할 문구로 직접 노출하지 않는다.

### 6.2 signout 결합 계약

- `signOut({ scope: "local" })`이 명시돼 있다.
- 성공 때만 앱 쿠키를 지우고 로그인 화면으로 이동한다.
- Supabase가 error를 반환하거나 throw하면 쿠키를 지우지 않고 오류 redirect한다.
- Workspace bootstrap/callback 변경이 현재 세션 전용 의미를 account-wide/all-device로 넓히지 않는다.
- 다른 세션 유지가 구조상 보장돼도 live-proven으로 과장하지 않는다.

## 7. Account C 보존 검수

### 7.1 파일·route

- `app/src/app/(app)/account/page.tsx` 존재, server redirect only
- `/account → /settings/account` 단방향, loop 0
- `/settings/account`, `/privacy`, `/sessions`의 안전한 read/blocked 화면 존재
- `AccountHub`, `AccountMenu`, `AccountNav`, `AccountState`, `CurrentSessionLogout`, CSS, presentation과 테스트 존재
- 두 route에 서로 다른 account loader/data source 중복 0

### 7.2 보안·표현

- client/DOM/test fixture에 raw login email 0; 서버 마스킹 결과만 표시
- Platform 1~4급, 담당영역, 지원 모드, persona selector 0
- profile/member/session/privacy write 성공 또는 위험 CTA 0
- links가 없거나 권한을 확인할 수 없으면 fail-closed
- 고객 표시 역할은 presentation layer를 통하고 내부 role/scope 원문을 직접 노출하지 않음

## 8. PR #19 기능·migration 검수

### 8.1 targeted tests

최소 다음 묶음을 candidate bytes에서 non-skip으로 실행한다.

```text
app/src/lib/entitlements.test.ts
app/src/lib/workspace/migration.test.ts
app/src/lib/workspace/service.test.ts
app/src/app/auth/callback/route.test.ts
app/src/lib/auth/account-ui.test.ts
app/src/components/account/AccountHub.test.tsx
app/src/lib/account/presentation.test.ts
app/src/app/auth/signout/route.test.ts
```

각 파일의 test 수와 PASS 수를 기록한다. 파일 부재, skip, 빈 suite는 FAIL이다.

### 8.2 full repository gate

- root lint PASS
- root typecheck PASS
- `scripts/check.sh` app·worker PASS
- production build PASS
- 기존 RLS harness의 credential 미주입 skip은 Account C/PR #19 PASS 증거에서 제외
- 새 skip·todo·only 0건

### 8.3 migration 006 불변성

- final candidate의 `supabase/migrations/006_workspace_bootstrap.sql` blob이 `3d6f5deb891f10789dc4b636bc7d132c4d38fcd5`와 동일
- 기존 001~005 migration 수정 0
- 007+ 추가·수정 0
- migration 실행 0, DEV/live DB write 0
- 정적 테스트가 migration 존재·RPC 권한·동시성·entitlement source 계약을 non-skip으로 검증

migration blob이 달라지면 사유와 별도 계약 승인 없이는 FAIL이다. 재베이스 conflict 해결을 이유로 SQL을 조용히 바꾸지 않는다.

## 9. 브라우저 실행 검수

T01이 제공한 final-SHA local server URL만 사용한다. 과거 3037 화면이나 screenshot은 재사용하지 않는다.

### 9.1 route·auth

- 인증 상태 `/account → /settings/account` 1회 redirect, 최종 200
- 비인증 `/account`와 `/settings/account`는 로그인 경계로 redirect
- 로그인 경계의 `next`/error 차이가 현재 앱 계약과 일치하고 auth bypass 0
- refresh/back에서 loop·중복 loader·hydration error 0

### 9.2 화면·접근성

- desktop 1280 light/dark
- viewport 390 light/dark, horizontal overflow 0
- AccountMenu 이름·역할·워크스페이스와 진입점 확인
- keyboard open, first focus, Arrow/Home/End/Escape, focus return
- logout dialog focus/cancel return
- actual `prefers-reduced-motion: reduce`에서 menu/dialog motion 축소
- console error/warn 0
- entitlement 정상·오류 표시는 Account C를 덮거나 제거하지 않음

### 9.3 logout 증거 경계

live logout click이 별도 승인 경계라면 `NOT_RUN`으로 남기고 final-SHA route test에 묶는다. 이것만으로 다른 세션 유지의 live proof를 주장하지 않는다. 단, local scope와 error/throw no-cookie-delete 테스트는 모두 PASS해야 한다.

## 10. Secret·PII·금지 변경 scan

실제 값은 출력하지 않고 hit count와 파일명만 기록한다.

- `.env*`, credential, token, cookie, service-role key 신규 diff 0
- raw email literal/fixture/client prop 신규 diff 0
- migration seed에 실제 사용자·조직 식별자 0
- debug log에 session/provider payload 0
- retired coordination YAML 부활 0
- Platform allowlist→Workspace Owner 자동 합성 0
- broad `users_select`, direct 일반 membership Owner 변경, impersonation, 영구 support membership 부활 0

## 11. 필수 acceptance matrix

| ID | 검수 | PASS 기준 |
|---|---|---|
| R19-01 | candidate identity | clean final SHA, merge-base=`ade79e7`, force-push 0 |
| R19-02 | conflict resolution | unmerged/conflict marker 0, Account C 삭제 0 |
| R19-03 | AccountMenu | layout에 유지되고 keyboard/focus PASS |
| R19-04 | entitlement | PR #19 source/error banner 보존, fake/local fallback 0 |
| R19-05 | routes | `/account → /settings/account`, auth bypass/loop 0 |
| R19-06 | presentation | customer label fail-closed, raw role/scope·Platform 노출 0 |
| R19-07 | signout | local scope, success/error/throw 계약 non-skip PASS |
| R19-08 | migration | 006 blob 동일, 001~005/007+ 변경 0, DB 실행 0 |
| R19-09 | targeted | PR #19+Account C 8개 suite non-skip PASS |
| R19-10 | full gate | lint/typecheck/check/build PASS, 새 skip 0 |
| R19-11 | visual | 1280/390 light/dark, keyboard, reduced-motion, console PASS |
| R19-12 | privacy/security | secret·PII·위험 CTA·취약 권한 부활 0 |
| R19-13 | state boundary | force-push·006·live DB·merge·deploy 0 |

하나라도 FAIL/skip이면 전체 실행 판정은 FAIL이다. 부분 PASS로 force-push를 허용하지 않는다.

## 12. 실행 영수증 템플릿

CODE_READY 후 아래를 실제 값으로 채운다.

| 필드 | 결과 |
|---|---|
| branch | `WAITING` |
| base | `ade79e753ff4c99eab68b5a36bd8195245a6d57b` |
| candidate SHA/tree | `WAITING` |
| start/end clean | `NOT_RUN` |
| changed files/stat | `NOT_RUN` |
| conflict diff | `NOT_RUN` |
| migration blob | expected `3d6f5deb891f10789dc4b636bc7d132c4d38fcd5`; actual `NOT_RUN` |
| targeted suites | `NOT_RUN` |
| lint/typecheck/check/build | `NOT_RUN` |
| browser | `NOT_RUN` |
| secret/PII scan | `NOT_RUN` |
| force-push/DB/merge | `0 / 0 / 0` at preparation checkpoint |

## 13. 현재 판정과 relay

### 판정

- Contract: **PASS — READY**
- Implementation: **NOT_RUN — CODE_READY WAIT**
- Visual: **NOT_RUN**
- Security: **NOT_RUN**
- Merge: **HOLD**
- Release: **BLOCKED / OUT OF SCOPE**
- Overall: **PASS — CONTRACT READY ONLY**

### CODE_READY 후 relay

1. T10은 final local SHA를 직접 고정하고 §6~10을 새로 실행한다.
2. PASS/FAIL과 재현 근거를 T09 collector와 MWC에 전달한다.
3. PASS여도 force-push·006·실DB·merge 승인으로 확대하지 않는다.
4. T02는 T10 candidate PASS와 새 PR #19 head 영수증 뒤에만 PR #20 DAG를 갱신한다.
5. 다음 gate는 `PR19-POST-ACCOUNT-REBASE-VERIFY-01` 실행 판정이며, 운영 DB gate는 별도 HOLD다.

## 14. FINAL LOCAL SHA 실행 판정 — 최종 권위

> 실행 시각: 2026-07-24 KST  
> 이 절은 §5, §9, §12, §13의 준비 상태를 실제 실행 결과로 대체하는 최종 권위다.  
> T09 CODE_READY relay가 요구한 범위는 conflict diff, Account C 보존, PR #19 targeted/full check/build, migration 불변, secret scan이다. 브라우저 재실행은 이번 **force-push 전 rebase gate**의 필수 입력이 아니므로 수행하지 않았고 화면 PASS로 주장하지 않는다.

### 14.1 후보 고정

| 필드 | 실제 결과 |
|---|---|
| worktree | `C:\Users\belie\Desktop\Belief\서울리드프로젝트\moawork-wt-workspace-bootstrap` |
| branch | `feat/workspace-bootstrap` |
| base / merge-base | `ade79e753ff4c99eab68b5a36bd8195245a6d57b` |
| rebased feature commit | `60d2c72bb63bf9b69e288749a680319705d6594f` |
| final candidate | `62053ba20dca6b6a9993f2b5cf5f0b1bc4397ef3` |
| tree | `affce710db85af2691eee173a1051666c7c40135` |
| parent | `60d2c72bb63bf9b69e288749a680319705d6594f` |
| start/end state | clean / clean |
| writer receipt | 3,518 bytes / 68 lines / SHA-256 `50DF52A17BFBF8812FD905D2E6F84C5FC5826FDAB23C9E8ABD9ED8C8D6D3E3D2` |
| external write | force-push 0 / migration 적용 0 / DB write 0 / merge 0 / deploy 0 |

### 14.2 diff·conflict 판정

- `ade79e7..62053ba`: 제품 11파일 + 구현 영수증 1파일, 990 additions / 38 deletions.
- PR #19의 재베이스 전 11개 제품 변경 범위가 그대로 존재한다.
- 실제 conflict는 `app/src/app/(app)/layout.tsx` 한 곳이었고 최종 unmerged/conflict marker는 0건이다.
- `git diff --check` PASS.
- Account C route/component/presentation/signout 파일 삭제 0건.
- package lock, `.env`, Vercel 설정, retired coordination YAML, 기존 migration 001~005, migration 007+ 변경 0건.

### 14.3 Account C 보존 판정

- `layout.tsx`에 `AccountMenu`, `buildAccountViewModel`, 고객용 `roleLabel/scopeLabel`이 유지됐다.
- PR #19의 `getLockedFeaturesForOrg`와 `EntitlementReadError`가 결합됐다.
- entitlement 조회 오류는 모든 대상 기능을 잠그고 오류 안내를 노출하며 데이터 변경을 성공처럼 표시하지 않는다.
- `/account`, `/settings/account/**`, `components/account/**`, `lib/account/**`, `lib/auth/account-ui.test.ts`, signout route/test는 `ade79e7` 기준선과 byte 동일하다.
- `/account`는 `/settings/account`로 보내는 server redirect only다.
- signout은 `scope: "local"`을 유지하고, 반환 error/throw 때 쿠키를 지우지 않는다.
- Platform 1~4급/persona/global·all-device logout 표식은 Account C 경로에서 0건이다.
- 실제 이메일은 client에 전달되지 않는다. 정적 검색의 이메일 literal 두 건은 callback test의 합성 `example.com` fixture이며 PII가 아니다. Account C test fixture는 `.invalid`만 사용한다.

### 14.4 migration·보안 정적 판정

- candidate migration 006 blob: `3d6f5deb891f10789dc4b636bc7d132c4d38fcd5`.
- 재베이스 전 PR #19 migration 006 blob과 정확히 동일하다.
- 추가 diff의 credential/secret assignment hit 0건.
- 새 `.skip`, `.only`, `.todo` hit 0건.
- migration은 파일로만 존재하며 실행하지 않았다.

기존 P0 경계는 별도 HOLD다. callback의 email 기반 `app_admin_role`과 Platform 사용자 org/Owner 자동 생성 경로는 이번 재베이스에서 새로 해결하지 않았으며, 이 gate가 이를 안전하다고 승인하지 않는다. `P0-AUTHZ-CONTRACT-02`의 strict cutover·legacy lockdown·실DB 공격검사 전에는 PR #19 merge, migration 006 적용, partner/admin 운영 write를 계속 금지한다.

### 14.5 독립 실행 증거

| 검사 | 결과 |
|---|---|
| targeted 8 suites | **PASS — 8/8 files, 30/30 tests, skip 0** |
| app lint | **PASS** |
| app typecheck | **PASS** |
| `scripts/check.sh` | **PASS — app 45 files / 501 PASS / 기존 RLS 5 skip, worker 3 files / 14 PASS** |
| production build | **PASS — Next.js 16.2.10** |
| route manifest | `/account`, `/settings/account`, `/settings/account/privacy`, `/settings/account/sessions`, `/auth/signout`, `/onboarding` 존재 |
| final clean/read-back | **PASS — HEAD `62053ba`, worktree clean** |

첫 targeted와 첫 full-check 시도는 샌드박스가 Vitest/esbuild config 경로를 읽지 못해 test 시작 전에 실패했다. 동일 명령을 허용된 실행환경에서 재실행해 위 non-skip PASS를 얻었다. 첫 build는 샌드박스 네트워크가 Google Fonts를 차단해 compile 전에 실패했고, 네트워크 허용 환경에서 동일 명령을 재실행해 production build를 완료했다. 이 환경 실패를 제품 실패나 최초 PASS로 숨기지 않는다.

기존 RLS 5 skip은 credential 미주입 baseline이며 PR #19·Account C PASS 증거에서 제외했다.

### 14.6 최종 verdict

| 층 | 판정 | 근거·경계 |
|---|---|---|
| Contract | **PASS** | Round 24와 T09 CODE_READY 범위 일치 |
| Implementation | **PASS** | final SHA diff, targeted/full check, build PASS |
| Account C preservation | **PASS** | byte 동일 파일 + layout 의미 결합 + signout 보존 |
| Security — rebase scope | **PASS** | secret 0, PII 0, local logout·fail-closed 보존 |
| Visual | **N/A / NOT_RUN** | 이번 force-push 전 gate 입력 아님; 화면 live PASS 주장 없음 |
| Force-push gate | **PASS** | T10 candidate PASS 조건 충족; 실제 push는 T01/MWC 권한 |
| Merge | **HOLD** | 006·DEV/실DB·P0 gate와 별도 MWC 승인 필요 |
| Release | **BLOCKED / OUT OF SCOPE** | merge·deploy 0 |

**Overall: PASS — FINAL LOCAL REBASE CANDIDATE `62053ba`**

이 PASS는 T01이 정확한 remote head를 확인한 뒤 `--force-with-lease`로 PR #19를 갱신할 수 있는 rebase 후보 판정까지만 해제한다. migration 006, live DB, PR merge, deploy, partner/admin write는 계속 HOLD다. T09/MWC는 candidate SHA와 remote 갱신 SHA가 일치하는지 별도 read-back해야 하며, T02는 그 뒤에만 PR #20의 새 base DAG를 갱신한다.
