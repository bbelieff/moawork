# Account C Safe Slice 독립 검수 게이트

> WORK-ID: `ACCOUNT-C-REVIEW-GATE-01`  
> 사용자 결정: C `내 계정과 팀`, Safe Slice 선구현  
> 상태: **CONTRACT READY ONLY / IMPLEMENTATION·VISUAL·SECURITY NOT RUN / MERGE·RELEASE HOLD**  
> 검수 대상 worktree: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\moawork-wt-account-c`  
> 제품 코드 writer: T01 / `ACCOUNT-C-IMPLEMENT-01`  
> 독립 reviewer: T10  
> 다음 소비자: MWC, T09 collector, 사용자 actual visual approval  
> 금지: T10의 제품 코드 수정, 사용자 실제 시각 승인 전 `MERGE_READY`, local/Preview를 Production PASS로 승격

## 1. 입력 정본과 우선순위

이 검수표는 다음 실제 artifact를 읽고 정규화했다.

1. `docs/coordination/sync/ROUND-24.md`
2. `docs/design/round-24/04-account-c-product-contract.md` — T04 제품·시각 계약
3. `docs/design/round-24/02-account-c-integration-gate.md` — T02 코드·배포 경계
4. `docs/design/round-24/02-account-c-merge-order-amendment.md` — MWC가 승인한 A안과 최종 route/file lease
5. `docs/design/round-24/account-c-collector.md` — T09 수집·relay 상태

문구가 충돌하면 최신 사용자 결정과 MWC 승인 amendment·collector가 우선한다. 따라서 이번 Safe Slice의 route 계약은 다음으로 고정한다.

- 장기 제품 canonical은 `/account`다.
- 이번 Safe Slice의 실제 C 화면은 `/settings/account`다.
- 이번 후보에서 `/account`는 `/settings/account`로 보내는 **server redirect only**다.
- 두 URL에 독립 page/data loader를 두지 않는다.
- 방향 반전(`/settings/account → /account`)은 `ACCOUNT-C-P0-02` 이후 별도 cutover다.

## 2. 검수 범위와 금지 범위

### 2.1 이번 Safe Slice에 허용되는 기능

- 앱 상단의 이름 있는 `AccountMenu`
- `/settings/account`의 C 벤토형 read-only 계정 요약
- 자기 context에서 읽은 이름·avatar/initial·현재 Workspace·고객용 역할 문구
- server에서 마스킹한 로그인 이메일
- 직책·팀 backend가 없을 때 정확한 empty/blocked 문구
- `POST /auth/signout`의 명시적 local scope 현재 세션 로그아웃
- `/account → /settings/account` 단방향 server redirect
- loading/empty/error/denied/blocked 표현과 라이트·다크·모바일·키보드 접근성

### 2.2 이번 후보에서 0건이어야 하는 기능·노출

- migration, RLS, DB schema 변경
- Global/Workspace Profile edit 또는 write
- Workspace 전환·tenant profile 성공 화면
- 다른 기기 목록, session registry, 모든 기기 로그아웃 성공
- 개인정보 reveal/export/delete, 탈퇴·Workspace 나가기
- member role/scope 변경, invite, Owner 이전·강등·삭제
- `/settings/members`의 LocalRepo write나 raw email table 재사용
- Platform role/tier, 1~4급, 담당영역, support mode, persona/role selector
- raw `owner/admin/member`, `all/assigned`를 사용자 계정 카드의 권한처럼 노출
- raw email을 client props, DOM, screenshot, fixture, log에 전달
- 위험 CTA를 disabled mock이나 가짜 성공으로 노출

## 3. 판정 층과 허용 상태

| 층 | 현재 | PASS 최소조건 | 다른 층으로 승격 금지 |
|---|---|---|---|
| Contract | `READY` | T04/T02/amendment/T09 artifact와 본 검수표 연결 | 구현·화면·보안 실행 PASS 아님 |
| Implementation | `NOT_RUN` | exact candidate changed files, diff, targeted test, full check, production build | Visual·Security·Merge·Release 아님 |
| Visual | `NOT_RUN` | 실제 후보의 desktop+390, light/dark, keyboard, console, hidden sequence | 서버·DB 보안 PASS 아님 |
| Security | `NOT_RUN` | local signout scope, PII·Platform·위험 CTA 0, redirect auth/loop, 금지 write 0 | Merge·Release 아님 |
| Merge | `HOLD` | Implementation+Visual+Security PASS, final ref 일치, 사용자 actual visual 명시 승인 | 실제 merge 수행 아님 |
| Release | `BLOCKED` | main merge ref와 Production ref 일치, 공개 URL·local signout read-back | 제품 전체 P0 완료 아님 |

허용 결과 어휘는 `PASS | FAIL | BLOCKED | NOT_RUN | N/A`다. 지금 이 문서가 허용하는 긍정 판정은 **`PASS — CONTRACT READY ONLY`**뿐이다.

다음 표현은 금지한다.

- `MERGE_READY` before user actual visual approval
- `PASS` without layer qualifier
- 테스트 파일 존재를 test PASS로 표시
- local/Preview PASS를 Production PASS로 표시
- 브랜치가 dirty하거나 candidate ref가 바뀐 뒤 과거 증거 재사용

## 4. Candidate 고정과 changed-files 검수

### 4.1 예상 lease

```text
app/src/app/(app)/layout.tsx
app/src/app/(app)/settings/account/page.tsx
app/src/app/(app)/account/page.tsx
app/src/components/account/AccountMenu.tsx
app/src/components/account/AccountOverview.tsx
app/src/components/account/AccountState.tsx
app/src/lib/account/presentation.ts
app/src/lib/account/presentation.test.ts
app/src/lib/auth/account-ui.test.ts
app/src/app/auth/signout/route.ts
app/src/app/auth/signout/route.test.ts
```

실제 diff가 더 작으면 작은 범위를 유지한다. 이 목록 밖 파일은 MWC의 사전 lease 갱신이 없으면 FAIL이다. 특히 다음 파일은 이번 후보에서 변경 0이어야 한다.

```text
app/src/lib/auth/session.ts
app/src/app/auth/callback/route.ts
app/src/app/(app)/settings/members/page.tsx
app/src/components/shell/nav-items.ts
supabase/migrations/**
```

### 4.2 후보 고정 영수증

실행검수 시작 전에 다음을 기록한다.

| 필드 | 요구값 |
|---|---|
| branch | 실제 T01 branch |
| base ref | 실제 merge-base와 기준 main ref |
| candidate ref | commit SHA 또는 명시된 dirty candidate snapshot |
| changed files | `git diff --name-status`와 untracked 포함 전체 목록 |
| diff stat | 추가·삭제량 |
| dirty state | 검수 시작·종료 각각 기록 |
| lease delta | 예상 lease 밖 0, 아니면 MWC 승인 artifact |
| secrets/PII | 실제 값 출력 없이 0건 |

commit 전 dirty 후보를 검수할 수는 있지만 그 판정은 `IMPLEMENTATION WORKTREE CANDIDATE ONLY`다. commit SHA가 생기거나 diff가 바뀌면 merge 판정 전에 전체 정적·브라우저 검수를 다시 실행한다.

## 5. Implementation Gate

### 5.1 diff review

- `/settings/account`만 C 화면과 loader를 소유한다.
- `/account/page.tsx`는 server redirect 외 JSX·loader·client state가 없다.
- redirect destination은 내부 고정 경로이며 user input·query로 외부 URL을 만들지 않는다.
- `AccountMenu`는 raw email이나 Platform 값을 client prop으로 받지 않는다.
- email masking은 render 전에 server/pure presentation 경계에서 적용된다.
- 역할 문구는 실제 membership 값의 고객용 번역이며 직책·팀을 합성하지 않는다.
- 팀·직책이 없을 때 가짜 값 대신 empty/blocked state를 표시한다.
- signout route는 `signOut({ scope: "local" })`을 명시한다.
- signout 실패를 성공 redirect로 위장하지 않는다.
- 기존 dev-cookie 제거는 유지하되 모든 기기가 끊겼다고 말하지 않는다.
- account code에 임의 hex·새 palette·외부 font가 없다.
- server-only import가 client graph에 들어가지 않는다.

### 5.2 실행 명령

실제 package scripts와 파일 존재를 먼저 확인한 뒤 다음을 실행한다.

```powershell
npm.cmd run test -w app -- src/lib/account/presentation.test.ts src/lib/auth/account-ui.test.ts src/app/auth/signout/route.test.ts
npm.cmd run lint -w app
npm.cmd run typecheck -w app
npm.cmd run build -w app
```

통합 gate는 저장소의 `scripts/check.sh`를 사용한다. 각 명령의 명령문·exit code·test pass/fail/skip count·Node version을 기록한다. 필수 test skip, build 미실행, 일부 명령 실패는 전체 Implementation FAIL이다.

### 5.3 Implementation 판정표

| ID | 검사 | 기대 결과 | 현재 |
|---|---|---|---|
| I-01 | changed files/lease | 예상 목록 안, 승인 없는 추가 0 | NOT_RUN |
| I-02 | route ownership | `/settings/account` UI 1개, `/account` redirect only | NOT_RUN |
| I-03 | targeted tests | 관련 test 전부 PASS, skip 0 | NOT_RUN |
| I-04 | lint/typecheck | exit 0 | NOT_RUN |
| I-05 | full check | exit 0 | NOT_RUN |
| I-06 | production build | exit 0, client/server boundary 오류 0 | NOT_RUN |
| I-07 | forbidden feature diff | migration/profile/member/session registry/privacy write 0 | NOT_RUN |
| I-08 | candidate integrity | 시작·종료 candidate 동일 또는 변경 뒤 재실행 | NOT_RUN |

## 6. Visual·Browser Gate

### 6.1 검수 환경

- primary URL: `http://localhost:<actual-port>/settings/account`
- redirect input: `http://localhost:<actual-port>/account`
- desktop: `1280×720`
- mobile: `390×844`
- theme: light, dark 각각
- 실제 고객 데이터가 아닌 합성 fixture만 사용
- 검수 중 console error/warn과 failed request를 별도 기록

### 6.2 실제 화면 검사항목

| ID | 시나리오 | 기대 결과 | 현재 |
|---|---|---|---|
| V-01 | Desktop light | 첫 viewport에서 이름·현재 회사·역할·내 정보·현재 로그아웃 위치 이해 | NOT_RUN |
| V-02 | Desktop dark | 정보 위계·대비·토큰 유지, 임의 palette·깨진 표면 0 | NOT_RUN |
| V-03 | 390px light | 1열 reflow, horizontal overflow 0, 핵심 CTA 가림 0 | NOT_RUN |
| V-04 | 390px dark | light와 같은 정보·행동, clipped text·색상 전용 상태 0 | NOT_RUN |
| V-05 | 긴 이름/Workspace·팀 없음 | overflow 방지, 가짜 팀 값 대신 정확한 empty state | NOT_RUN |
| V-06 | keyboard | 메뉴 열기, Tab, Enter/Space, Escape, focus return 정상 | NOT_RUN |
| V-07 | focus/accessibility | accessible name, `aria-expanded`, heading 순서, focus-visible | NOT_RUN |
| V-08 | reduced motion | 정보 소실 없이 즉시 전환, 자동 장식 motion 0 | NOT_RUN |
| V-09 | console/runtime | error/warn 0, hydration·route 오류 0 | NOT_RUN |
| V-10 | hidden sequence | menu→계정→redirect/back/refresh→signout pending/error/cancel/success | NOT_RUN |

### 6.3 사용자 승인 gate

T10은 실제 구현 화면과 같은 상태의 데스크톱·모바일 라이트/다크 증거, `/account` redirect 뒤 화면, 숨은 다음 시퀀스를 MWC에 전달한다. MWC는 사용자에게 2~4개 이해 확인 질문을 제시한다.

1. 현재 회사와 내 역할은 어디에서 확인되나요?
2. `이 기기에서 로그아웃`하면 다른 기기도 로그아웃된다고 느껴지나요?
3. `/account`와 `/settings/account`가 서로 다른 계정 화면처럼 보이나요?
4. 이 화면에서 수정·모든 기기 로그아웃·개인정보 기능이 이미 된다고 오해할 요소가 있나요?

사용자 actual visual 명시 승인 record가 없으면 Visual PASS여도 Merge는 HOLD다.

## 7. Security Gate

### 7.1 current-session signout local scope

| ID | 검사 | 기대 결과 | 현재 |
|---|---|---|---|
| S-01 | 정적 route 검사 | `signOut({ scope: "local" })` 명시 | NOT_RUN |
| S-02 | route unit test | client 호출 인자 local, dev cookie 삭제, redirect 계약 PASS | NOT_RUN |
| S-03 | 실패 주입 | signout 실패를 성공으로 표시하거나 정상 완료 redirect하지 않음 | NOT_RUN |
| S-04 | 브라우저 현재 세션 | 로그아웃 뒤 현재 브라우저 보호 route 접근 거부·로그인 이동 | NOT_RUN |
| S-05 | 다른 session 유지 | 합성된 별도 session은 유지됨을 증명하거나 증거 없으면 BLOCKED | NOT_RUN |
| S-06 | 문구 정합 | `이 기기` 범위만 말하고 `모든 기기` 성공 주장 0 | NOT_RUN |

브라우저 하나만 로그아웃한 사실은 다른 session 유지 증거가 아니다. 별도 합성 session을 안전하게 만들 수 없으면 S-05는 `BLOCKED`이며 local-scope 전체 Security PASS를 선언하지 않는다.

### 7.2 PII·Platform·위험 기능 비노출

| ID | 검사 | 기대 결과 | 현재 |
|---|---|---|---|
| S-07 | raw email | client props·DOM·fixture·screenshot·console에 원문 0 | NOT_RUN |
| S-08 | email mask | local-part/domain 경계가 계약대로 마스킹, 짧은/이상값 안전 | NOT_RUN |
| S-09 | Platform | role/tier/1~4급/담당영역/support/persona DOM·copy·data attr 0 | NOT_RUN |
| S-10 | 위험 CTA | 모든 기기, profile edit, Workspace switch, export/delete, member/Owner write CTA 0 | NOT_RUN |
| S-11 | forbidden data path | callback/session/members/nav/migration 변경 0 | NOT_RUN |
| S-12 | server authorization | account는 기존 보호 layout/proxy 경계를 우회하지 않음 | NOT_RUN |

### 7.3 `/account` redirect

| ID | 검사 | 기대 결과 | 현재 |
|---|---|---|---|
| R-01 | authenticated GET `/account` | `/settings/account` 단방향 server redirect | NOT_RUN |
| R-02 | unauthenticated GET | 기존 auth guard를 우회하지 않고 login flow로 감 | NOT_RUN |
| R-03 | loop | `/settings/account`가 다시 `/account`로 보내지 않아 loop 0 | NOT_RUN |
| R-04 | back/refresh | 반복 redirect·깨진 history·중복 loader 0 | NOT_RUN |
| R-05 | external redirect | query/slug 입력으로 외부 redirect 불가 | NOT_RUN |

## 8. Merge Gate

`MERGE_READY`는 다음이 모두 충족된 뒤에만 가능하다.

1. final candidate commit SHA와 모든 evidence SHA가 같다.
2. I-01~I-08 필수행 PASS.
3. V-01~V-10 필수행 PASS.
4. S-01~S-12와 R-01~R-05 필수행 PASS. BLOCKED/NOT_RUN 0.
5. 예상 밖 changed file·migration·비밀값·PII 0.
6. GitHub CI와 exact Preview build PASS.
7. T10 최종 판정 PASS.
8. 사용자가 실제 구현 화면을 보고 명시 승인했다.
9. MWC가 merge를 별도 승인했다.

T10 PASS는 merge 실행 권한이 아니다. T10은 commit/push/PR/merge/deploy를 수행하지 않는다.

## 9. Release Gate

Release는 merge 뒤 별도 판정한다.

| ID | 검사 | 기대 결과 | 현재 |
|---|---|---|---|
| L-01 | main ref | merge SHA와 GitHub main 일치 | BLOCKED |
| L-02 | Vercel source | Production Current/Ready source가 main merge SHA와 일치 | BLOCKED |
| L-03 | public auth guard | `/account`, `/settings/account` 미인증 접근이 login으로 보호 | BLOCKED |
| L-04 | public account UI | 합성 test account로 C 화면·menu·responsive/theme 정상 | BLOCKED |
| L-05 | public local signout | 현재 session만 종료, 다른 session 유지 증거 | BLOCKED |
| L-06 | forbidden production UI | all-device/profile/privacy/member/Platform 노출 0 | BLOCKED |
| L-07 | logs/console | runtime 오류 0, secret/PII 기록 0 | BLOCKED |

별도 수동 Production deploy는 하지 않는다. 배포 로그 성공만으로 Release PASS를 선언하지 않고 공개 route와 핵심 여정을 직접 read-back한다.

## 10. 실행 트리거와 relay

### 10.1 코드 후보 감지

T10은 T01 worktree에서 다음이 보이면 실행검수를 시작한다.

- account route/component/presentation/signout 변경이 실제 파일로 존재
- changed-file list를 읽을 수 있음
- 개발 서버 또는 실행 가능한 package scripts가 준비됨

부분 코드만 존재하면 diff·금지 범위 정적 검사를 먼저 하고 `IMPLEMENTATION INCOMPLETE / NOT_RUN`을 유지한다. route/layout/signout이 준비되면 targeted test→full check/build→browser 순서로 이어간다.

### 10.2 T10 결과 packet

MWC와 T09에 다음만 릴레이한다.

```text
WORK-ID: ACCOUNT-C-REVIEW-GATE-01
candidate_ref / base_ref
changed_files / lease_delta
Contract / Implementation / Visual / Security / Merge / Release verdict
test/check/build counts and exit codes
browser matrix: D-L / D-D / M-L / M-D / keyboard / console
current-session signout: static / unit / browser / other-session evidence
PII / Platform / risky CTA counts
/account redirect: auth / unauth / loop / back-refresh
blocking findings with reproduction and expected result
user actual visual approval: PRESENT | ABSENT
next owner / next WORK-ID
```

FAIL이면 T01에 재현 절차와 기대값을 전달하고 제품 코드는 직접 고치지 않는다. PASS여도 사용자 actual visual 승인이 없으면 `MERGE HOLD`를 유지한다.

## 11. 최초 상태 영수증

| 항목 | 현재 상태 |
|---|---|
| Contract | `PASS — CONTRACT READY ONLY` |
| T01 worktree 최초 read-back | branch `agent/account-c-screen`, base/head `639d629`; account component/lib 일부 untracked 감지 |
| route/layout/signout 후보 | 최초 read-back 시 아직 확인되지 않아 `NOT_RUN` |
| Implementation | `NOT_RUN` |
| Visual | `NOT_RUN` |
| Security | `NOT_RUN` |
| User actual visual approval | `ABSENT` |
| Merge | `HOLD` |
| Release | `BLOCKED` |

## 16. 현재 권위 상태

체크포인트 1~3과 아래의 과거 `BLOCKED` 표는 실행 이력 보존용이다. 현재 candidate 판정은 **§15만 권위가 있다**.

- final SHA: `4e69ec2b7434ba36f261ea1d01b4358ab8e4685c`
- Contract / Implementation / Visual / Security: `PASS`
- live logout submit: `NOT_RUN — NONBLOCKING`, 다른 session 유지 live-proven 주장 없음
- Merge: `HOLD — 사용자 actual visual 명시 승인 대기`
- Release: `BLOCKED — 미머지·미배포`

## 18. T08 RUN-007 교차소비 영수증

T08 final evidence artifact를 실제 파일에서 읽고 §15 판정과 교차검증했다.

- artifact: `docs/design/round-24/08-account-c-test-gate.md`
- artifact SHA-256: `2FF0CB13E11EE2B437FF79881A56FF57C75336519BABF0ACA04B9DA904E51D75`
- candidate commit: `4e69ec2b7434ba36f261ea1d01b4358ab8e4685c`
- candidate tree: `f119f228fbfddc51315251bea13fa2eacce51afa`
- T10 독립 read-back: HEAD와 tree 일치, porcelain output 0으로 clean.
- RUN-007의 targeted 14/14, lint/typecheck/build/check, auth/redirect/privacy/Platform fail-closed, sessions/privacy blocked, console 0, light/dark/390/keyboard, reduced-motion actual이 §15 증거와 충돌 없이 일치했다.
- baseline RLS 5 skip은 양쪽 모두 Account C PASS 근거에서 제외했다.
- live logout submit은 `NOT_RUN — NONBLOCKING`; `scope:"local"`과 성공/오류/throw 4/4 계약으로만 판정하며 다른 session 유지 live-proven 주장은 하지 않는다.

결론은 변하지 않는다: **Account C 기술 gate PASS, 사용자 actual visual 명시 승인이 유일한 merge gate**다.

## 15. 최종 SHA 실행 판정 — ACCOUNT-C-REVIEW-EXECUTION-01

> 실행일: 2026-07-24 KST  
> candidate: `4e69ec2b7434ba36f261ea1d01b4358ab8e4685c`  
> base: `639d629e9c09bba63415a96d0d7d46c653fb24ac`  
> 최종 판정: `PASS — IMPLEMENTATION/VISUAL/SECURITY / MERGE HOLD — USER VISUAL APPROVAL ABSENT`

### 15.1 Git·범위·artifact integrity

- branch `agent/account-c-screen`, clean, `origin/main`보다 1 commit ahead.
- 정확히 20파일, 1,510 insertions/27 deletions, `diff --check` clean.
- migration/RLS/session.ts/callback/settings-members/nav-items/Vercel 등 금지 경로 변경 0.
- client raw-email token 0, Platform grade/persona token 0, 가짜 모든-기기 성공 0, secret assignment 0, conflict marker 0.
- T08 RUN-004 핵심 hash 5건을 final commit에서 독립 재계산해 byte-for-byte 일치:
  - `AccountHub.tsx` 4,546 bytes / `08AC80...91A79`
  - `AccountHub.test.tsx` 1,993 bytes / `F991F5...16C9E`
  - `(app)/layout.tsx` 4,683 bytes / `5A80CD...38359`
  - `account-ui.test.ts` 554 bytes / `80E0DC...C618`
  - `auth/signout/route.test.ts` 3,334 bytes / `9D225A...2517`

### 15.2 Implementation evidence

| Gate | 독립 결과 |
|---|---|
| targeted | 4 files / 14 tests PASS / skip 0 |
| lint | PASS |
| typecheck | PASS |
| app full test | 42 files / 486 PASS / 기존 RLS 5 skip |
| worker full test | 3 files / 14 PASS / skip 0 |
| production build | Next 16.2.10 compile·TypeScript 완료, 새 BUILD_ID와 account/signout route manifest 확인 |
| Next error contract | 설치된 16.2.10 `ErrorInfo`와 `ErrorBoundaryHandler`가 `reset`과 `unstable_retry`를 모두 전달함을 확인; blocker 아님 |

기존 RLS 5 skip은 Account C 또는 Security PASS의 근거로 소비하지 않았다.

### 15.3 Redirect·auth

- 인증 브라우저에서 canonical `/account` 진입 후 최종 URL은 `/settings/account`; C 화면 1개, loop 0.
- 무인증 fresh HTTP에서 `/account`와 `/settings/account` 모두 `307 → /login?error=membership`; C 본문 노출 0.
- `/account`는 redirect 전용이며 별도 loader/UI 없음.

### 15.4 Visual·interaction

| 조합 | 결과 |
|---|---|
| desktop 1280×720 light | PASS, overflow 0, masked email, Account C hierarchy 정상 |
| desktop 1280×720 dark | PASS, overflow 0, body bg `rgb(17,18,22)`, 핵심 내용 유지 |
| mobile 390×844 light | PASS, 1열, overflow 0, profile menu·4개 tab 접근 가능 |
| mobile 390×844 dark | PASS, 1열, overflow 0, 역할·회사·masked email 가독 |
| menu keyboard | open 시 첫 항목 focus; ArrowDown→회사와 팀, End→로그아웃, Home→내 계정, Escape→trigger focus·collapsed |
| logout dialog | open 시 `계속 사용하기` focus, 영향 문구 명확, cancel 후 trigger focus return |
| reduced-motion actual | CDP `prefers-reduced-motion: reduce` 실제 match=true; menu/dialog transition `0.001ms`, 기능·heading 유지 |
| console | warn/error 0 |

화면 DOM·screenshot에서 raw email 0, Platform 관리자/운영자·1~4급·permission formula 0, 개인정보/탈퇴/모든 기기 성공 표시 0. “완료된 것처럼 표시하지 않아요”는 안전 경계 설명이며 성공 CTA가 아니다.

### 15.5 Current-session logout 경계

- final SHA source/test에서 `signOut({ scope: "local" })` 정확히 1회.
- 성공: 303 signed-out login redirect와 현재 dev cookie 정리.
- auth 반환 오류와 throw: 성공 redirect·cookie delete 0, 동일-origin account 오류 경로로 fail-closed.
- 확인 dialog는 “이 브라우저의 로그인만 끝나며 다른 기기는 유지”라고 명시한다.
- MWC browser approval resolution에 따라 실제 제출 클릭은 `NOT_RUN — APPROVAL-REQUIRED / NONBLOCKING SAFE-SLICE GAP`이다.
- 다른 독립 session 유지는 `scope:"local"` 구조·단위 계약만 확인했으며 live-proven으로 주장하지 않는다.

### 15.6 층별 verdict

| 층 | 최종 판정 |
|---|---|
| Contract | `PASS` |
| Implementation | `PASS` |
| Visual | `PASS` |
| Security | `PASS — LIVE LOGOUT SUBMIT GAP RECORDED` |
| Merge | `HOLD — USER ACTUAL VISUAL APPROVAL ABSENT` |
| Release | `BLOCKED — NOT MERGED/DEPLOYED` |

T10은 이 commit을 코드·로컬 실행 관점에서 승인한다. 그러나 `MERGE_READY`는 아직 아니다. 사용자에게 아래 실제 화면 packet을 보여 명시 승인을 받아야 한다.

### 15.7 사용자 actual-screen review packet

- 유지된 로컬 화면: `http://localhost:3037/settings/account`
- 확인 포인트:
  1. 첫 10초 안에 현재 회사, 내 역할, 내 정보와 profile menu 위치가 이해되는가.
  2. 상단 `내 정보 / 회사와 팀 / 로그인 기기 / 개인정보` 구분이 직관적인가.
  3. 준비 중 기능이 성공하는 것처럼 보이지 않고 현재 가능한 `이 기기에서 로그아웃`과 구분되는가.
  4. C의 탭·벤토 계정 중심 구조와 light/dark 표현을 최종 제품 방향으로 승인하는가.
- 숨은 다음 sequence: profile menu keyboard 이동, sessions/privacy blocked 안내, current-session 영향 dialog, Platform 합성 시 `회사 역할 확인 중` fail-closed.
- 사용자 명시 승인 전 push/PR/merge/deploy 금지. 승인 뒤 다음 WORK-ID는 `ACCOUNT-C-MERGE-RELEASE-01`이며 T10 범위 밖이다.

다음 WORK-ID는 코드 후보 생성 뒤 **`ACCOUNT-C-REVIEW-EXECUTION-01`**이다.

## 12. 실행 체크포인트 1 — 부분 후보

> 시각: 2026-07-24 KST  
> 판정: `IMPLEMENTATION INCOMPLETE / VISUAL·SECURITY FULL GATE NOT RUN / MERGE HOLD`

T01 worktree에서 account presentation·component와 signout route/test 일부가 실제 파일로 생성돼 즉시 제한 검수를 수행했다.

### 확인된 파일 범위

- `app/src/components/account/**`
- `app/src/lib/account/**`
- `app/src/app/auth/signout/route.ts`
- `app/src/app/auth/signout/route.test.ts`
- `docs/implementation/ACCOUNT-C-IMPLEMENT-01.md`

최초·재확인 시 `/settings/account`, `/account`, `(app)/layout.tsx` 후보는 아직 확인되지 않았다. 따라서 route ownership, 상단 연결, redirect, 실제 화면 검수는 실행하지 않았다.

### 제한 검수 결과

| 항목 | 결과 |
|---|---|
| presentation/AccountHub/signout targeted test | 3파일, 11 tests PASS, skip 0 |
| local signout 정적 계약 | `signOut({ scope: "local" })` 확인 |
| signout 실패 처리 | 오류 시 성공 login redirect·dev cookie 삭제를 하지 않는 test 확인 |
| 마스킹 | 합성 `.invalid` 입력으로 server/presentation 변환 test PASS; 실제 PII 사용 0 |
| AccountMenu client props | display name·initial·Workspace만, raw email prop 없음 |
| Platform 방어 | `isPlatformAdmin`에서 대표/팀장/사원 추정 대신 `확인 중`, 회사 관리 false |
| 금지 기능 | all-device/profile/privacy/member write 구현은 현재 생성 파일에서 발견되지 않음 |

첫 test 실행은 Windows sandbox가 Vitest config 경로를 읽지 못해 startup error로 종료됐다. 동일 명령을 허용된 실행 범위에서 재실행해 3파일 11 tests PASS를 얻었다. 이는 코드 FAIL이 아니라 실행환경 접근 실패와 재실행 결과를 구분한 기록이다.

### 중단 상태

T01은 route·layout 통합 패치가 진행 중인 동안 MWC의 writer lease 회수 지시를 받았다. 현재 호출이 끝난 뒤 추가 수정·테스트·commit 없이 인수 영수증만 남길 예정이라고 보고했다. 최종 changed-files와 route/layout 적용 결과가 고정되기 전에는 full check/build/browser를 시작하지 않는다.

| 층 | 체크포인트 판정 |
|---|---|
| Contract | `PASS — CONTRACT READY ONLY` |
| Implementation | `INCOMPLETE / TARGETED TEST PARTIAL PASS / OVERALL NOT_RUN` |
| Visual | `NOT_RUN — ROUTE/LOCAL URL ABSENT` |
| Security | `PARTIAL STATIC PASS / BROWSER·OTHER-SESSION·REDIRECT NOT_RUN` |
| User actual visual approval | `ABSENT` |
| Merge | `HOLD` |
| Release | `BLOCKED` |

재개 조건은 MWC의 새 writer 배정, 최종 candidate ref·changed-files 고정, `/settings/account` actual route와 `/account` redirect, layout 연결, 실행 가능한 local URL이다. 재개 WORK-ID는 **`ACCOUNT-C-REVIEW-EXECUTION-01`**을 유지한다.

## 13. 실행 체크포인트 2 — DEV-2 재진입 HOLD

> 시각: 2026-07-24 KST  
> 판정: `RUNTIME FAIL / PRE-DEV2 EVIDENCE PROVISIONAL / FINAL-SHA RERUN REQUIRED / MERGE HOLD`

T01 lease 회수 뒤 DEV-2=T05가 같은 worktree의 sole writer로 지정됐다. MWC의 재진입 지시에 따라 아래 결과는 최종 판정에 재사용하지 않고 결함 수집과 재발 방지 입력으로만 보존한다.

### 잠정 정적·빌드 증거

| 항목 | 잠정 결과 | 최종 후보 처리 |
|---|---|---|
| targeted test | 3파일 11 tests PASS, skip 0 | DEV-2 commit에서 재실행 |
| lint | PASS | DEV-2 commit에서 재실행 |
| typecheck | PASS | DEV-2 commit에서 재실행 |
| `scripts/check.sh` | app 483 PASS/5 SKIP, worker 14 PASS | DEV-2 commit에서 재실행; 기존 RLS skip은 이 slice Security PASS 근거로 소비 금지 |
| production build | PASS, account 4개 route 수집 확인 | 런타임 PASS가 아니므로 DEV-2 commit에서 재실행 |
| dirty candidate | route/layout/component/signout 포함 19개 변경 파일 | final changed-files와 commit SHA로 대체 |

### 실행 결함과 필수 교정

1. T08 실제 로컬 브라우저에서 인증 후 `/settings/account`가 error boundary로 진입했다.
   - 재현: account page가 `<AccountHub account={account} />`로 렌더하지만 `AccountHub`가 필수 `links`의 `links.sessions`를 읽음.
   - 실제 오류: `TypeError: Cannot read properties of undefined (reading 'sessions')`.
   - 기대값: `links` 없이도 C shell이 throw하지 않고 blocked 안내와 현재 세션 로그아웃만 렌더한다.
   - 회귀 테스트: `AccountHub`를 `links` 없이 render하는 사례가 필수다.
2. desktop sidebar가 `roleLabel(ctx.role)`·`scopeLabel(ctx.scope)`를 직접 렌더해 Platform principal을 대표/팀장으로 오표시할 수 있다.
   - 기대값: `buildAccountViewModel()`의 fail-closed `account.roleLabel`·`account.scopeLabel`만 사용한다.
   - 회귀 테스트: layout source에 raw `ctx.role/scope` 표시가 없음을 고정한다.
3. signout throw 경로는 성공 redirect·cookie 삭제가 없어야 하며 별도 회귀 테스트가 필요하다.
4. `error.tsx`의 재시도 callback 계약은 Next error boundary의 실제 runtime prop과 일치하는지 최종 후보에서 확인한다.

### 브라우저 재진입 조건

- 현재 인앱 브라우저는 `http://localhost:3000` 사용을 명시적으로 거부했다. 같은 결과를 얻기 위한 우회·다른 브라우저 표면·raw CDP는 사용하지 않았다.
- DEV-2 `CODE_READY` relay에는 local commit SHA, 고정 changed-files, 종료된 writer 상태, 실행 가능한 최종 local URL이 포함돼야 한다.
- 그 뒤 D-L/D-D/M-L/M-D, keyboard, console, `/account` redirect, 현재 세션 logout을 모두 새로 실행한다.
- current-session local scope는 정적·unit·browser와 별개로 **다른 독립 session 유지 증거**까지 있어야 Security PASS다.

| 층 | 체크포인트 판정 |
|---|---|
| Contract | `PASS — CONTRACT READY ONLY` |
| Implementation | `FAIL — RUNTIME ERROR / DEV-2 PATCH PENDING` |
| Visual | `BLOCKED — FINAL URL AND COMMIT PENDING` |
| Security | `BLOCKED — PLATFORM MISLABEL + FINAL BROWSER/OTHER-SESSION EVIDENCE PENDING` |
| User actual visual approval | `ABSENT` |
| Merge | `HOLD` |
| Release | `BLOCKED` |

DEV-2의 local commit SHA와 `CODE_READY`가 오면 모든 changed-files·test·check·build·browser 근거를 폐기 후 재수집한다. 그 전에는 최종 PASS, `MERGE_READY`, `RELEASE_READY`를 선언하지 않는다.

## 14. 실행 체크포인트 3 — writer 비정상 종료

> 시각: 2026-07-24 KST  
> 판정: `CODE_NOT_FROZEN / WRITER RECOVERY REQUIRED / MERGE HOLD`

DEV-2는 targeted 4파일 14 tests, lint, typecheck, 전체 check(app 486 pass/기존 RLS 5 skip, worker 14 pass), production build를 통과했다고 보고했다. 다만 commit 직전 EOF 여분 빈 줄을 정리하는 `fileChange` 뒤 DEV-2 task가 system error로 종료했고, MWC task도 이어 system error로 종료했다.

T10 read-only read-back 결과:

- branch: `agent/account-c-screen`
- HEAD: `639d629e9c09bba63415a96d0d7d46c653fb24ac` 그대로
- staged: 승인 범위 20파일
- staged와 working-tree bytes가 다른 `AM` 7파일:
  - `app/src/app/(app)/settings/account/error.tsx`
  - `app/src/app/(app)/settings/account/loading.tsx`
  - `app/src/components/account/AccountMenu.tsx`
  - `app/src/components/account/AccountNav.tsx`
  - `app/src/components/account/AccountState.tsx`
  - `app/src/components/account/CurrentSessionLogout.tsx`
  - `app/src/components/account/account.module.css`
- local commit SHA: 없음
- `CODE_READY`: 없음

따라서 staged diff도 working-tree도 고정 후보로 취급할 수 없다. T08의 working-tree hash와 이전 T10 실행 결과는 참고만 가능하며 최종 후보 근거로 승격하지 않는다. 다음 controller는 sole writer를 복구해 최종 bytes 재-stage, `diff --check`, 필요한 byte-bound 재검증, local commit, `CODE_READY`를 완료해야 한다. T10은 제품 파일의 stage·commit을 대신하지 않는다.

| 층 | 현재 판정 |
|---|---|
| Contract | `PASS — CONTRACT READY ONLY` |
| Implementation | `BLOCKED — NO FROZEN COMMIT / 7 AM FILES` |
| Visual | `BLOCKED — FINAL COMMIT + APPROVED URL ABSENT` |
| Security | `BLOCKED — FINAL BYTE REVIEW + REDUCED-MOTION ACTUAL + OTHER-SESSION EVIDENCE ABSENT` |
| Merge | `HOLD` |
| Release | `BLOCKED` |

## 17. 최종 권위 포인터

§13~14는 과거 실행 이력이다. **현재 권위 판정은 §15**이며 candidate는 `4e69ec2b7434ba36f261ea1d01b4358ab8e4685c`다.

- Contract / Implementation / Visual / Security: `PASS`
- live logout submit: `NOT_RUN — NONBLOCKING`; 다른 session 유지 live-proven 주장 없음
- Merge: `HOLD — 사용자 actual visual 명시 승인 대기`
- Release: `BLOCKED — 미머지·미배포`

## 19. 사용자 승인·merge·Production 최종 상태

> WORK-ID: `ACCOUNT-C-MERGE-RELEASE-01`  
> 시각: 2026-07-24 KST  
> 판정: `APPROVED / MERGED / PRODUCTION_DEPLOYED`

§15의 기술 PASS 뒤 사용자가 **“승인, 머지 배포해”**라고 실제 화면을 명시 승인했다. 이후 controller 실행 결과를 T10이 GitHub와 공개 endpoint에서 읽기 전용으로 재확인했다.

### GitHub·CI·Preview

- PR: `https://github.com/bbelieff/moawork/pull/21`
- source head: `4e69ec2b7434ba36f261ea1d01b4358ab8e4685c`
- PR state: closed + merged
- squash/main commit: `ade79e753ff4c99eab68b5a36bd8195245a6d57b`
- GitHub CI run #88: completed/success
- `gh pr checks 21`: GitGuardian PASS, Vercel PASS(`Deployment has completed`), Vercel Preview Comments PASS, lint+typecheck+test PASS.

### Production·공개 read-back

- controller receipt: Vercel deployment `7zcsdMk4N88GxS8pme5AtZNGqyuB`, `Ready / Latest / Production / Current`, source `main@ade79e7`, domain `www.moa-work.com`.
- T10 독립 공개 probe: `https://www.moa-work.com/account` → `HTTP 307`, `Server: Vercel`, `Location: /login?next=%2Faccount`.
- 따라서 공개 auth boundary와 domain serving은 PASS다.
- 이 브라우저에는 인증된 Production session이 없으므로 post-login Account C Production DOM은 live-proven으로 주장하지 않는다. exact main-SHA↔Production controller binding, Preview/local 실제 화면, 공개 auth guard만 확인했다.

### 최종 층별 verdict

| 층 | 최종 상태 |
|---|---|
| Contract | `PASS` |
| Implementation | `PASS` |
| Visual | `PASS — USER APPROVED` |
| Security | `PASS — LIVE LOGOUT SUBMIT GAP RECORDED` |
| Merge | `PASS — PR #21 SQUASH MERGED` |
| Release | `PASS — PRODUCTION CURRENT + PUBLIC AUTH BOUNDARY` |

남은 caveat와 downstream:

- 인증 후 Production Account C DOM: `NOT_LIVE_PROVEN`, 완료를 거짓 주장하지 않음.
- PR #19는 `ade79e7` 위로 rebase하고 `AccountMenu`를 보존한 새 SHA에서 L19-01을 다시 실행해야 한다.
- #19의 migration `006`과 live DB gate는 계속 HOLD이며 Account C release PASS가 이를 해제하지 않는다.

이 §19가 본 문서의 **최종 권위 상태**이며 §13~18의 HOLD/BLOCKED 표는 실행 이력으로만 읽는다.
