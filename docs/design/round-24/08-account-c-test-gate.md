# Account C Safe Slice — 실행 테스트 게이트

> WORK-ID: `ACCOUNT-C-TEST-GATE-01`  
> Artifact type: `REVIEW SPEC + APPEND-ONLY EXECUTION LOG`  
> 대상 worktree: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\moawork-wt-account-c`  
> branch/base: `agent/account-c-screen` / `639d629e9c09bba63415a96d0d7d46c653fb24ac`  
> final commit: `4e69ec2b7434ba36f261ea1d01b4358ab8e4685c`  
> 현재 상태: `T08 PASS / USER_VISUAL_APPROVAL_HOLD`  
> 제품 코드 수정: T08 금지  
> 다음 controller: MWC  
> 독립 판정 소비자: T10  
> merge DAG 소비자: T09

## 1. 권위와 Safe Slice 범위

이 문서는 Account C 후보가 생기는 즉시 명령·파일·예상 증거를 연결해 실행하는 **실행 가능한 테스트 게이트**다. 준비 문서만으로 DONE이나 PASS를 주장하지 않는다.

입력 우선순위는 다음과 같다.

1. `02-account-c-merge-order-amendment.md`와 MWC collector의 확정 delta
2. `02-account-c-integration-gate.md`
3. `04-account-c-product-contract.md`
4. T01 `docs/implementation/ACCOUNT-C-IMPLEMENT-01.md`

T04의 장기 canonical은 `/account`지만 이번 Safe Slice의 실제 화면은 `/settings/account`다. amendment에 따라 이번 후보는 **`/account → /settings/account` server redirect** 한 방향만 허용한다. P0 cutover 전 방향을 바꾸거나 양쪽에 별도 loader/UI를 두지 않는다.

이번 PASS 범위:

- 상단 `AccountMenu`
- 인증된 실제 `Ctx`의 본인 이름·현재 Workspace·membership 기반 표시
- server에서 마스킹한 로그인 이메일
- C 벤토 읽기 화면 `/settings/account`
- `/account → /settings/account` redirect
- 명시적 local-scope 현재 브라우저 로그아웃
- light/dark, 390px, keyboard, reduced-motion

이번 PASS에 포함하지 않는 것:

- profile/member/tenant write
- Workspace switch 성공
- session registry와 다른/모든 기기 로그아웃 성공
- 개인정보 export/delete 성공
- Platform grade·지원 단계·persona selector
- migration·RLS·실DB P0 완료
- merge·Preview·Production 완료

## 2. 판정 어휘

| 상태 | 의미 |
|---|---|
| `PASS` | 고정 candidate SHA에서 명령·화면·증거를 실제 확인하고 T10이 승인 가능 |
| `FAIL` | 기대 계약 위반 또는 명령 실패 |
| `BLOCKED` | 코드·환경·결정·다른 branch 선행조건이 없어 실행 불가 |
| `NOT_RUN` | 실행 가능한 범위지만 아직 실행하지 않음 |

파일 존재, 정적 소스 확인, 단위테스트, build, 시각검수는 서로 다른 증거다. 하나의 PASS가 다른 층위를 대체하지 않는다.

## 3. P0·기능 gate 행렬

| Gate ID | 요구사항 | 실행 계층 | PASS 조건 | P0 반려 |
|---|---|---|---|---|
| AC-R01 | `/account → /settings/account` 단방향 redirect | source/unit/HTTP | server redirect, loop 0, query 기반 auth 우회 0, `/account` 별도 UI/loader 0 | 반대 방향·loop·두 화면 |
| AC-A01 | `/account`, `/settings/account` 인증보호 | Server Component/HTTP | 미인증 요청은 login 경계로 이동하고 C 화면·Ctx metadata 0 | 미인증 200 또는 데이터 노출 |
| AC-C01 | actual `Ctx`만 표시 | source/unit/render | `getSession()`의 본인 name/org/membership만 view model로 전달; sample production 값 0 | client fixture·가짜 팀/세션 성공 |
| AC-P01 | raw email client 비노출 | source/unit/render | server에서 `maskLoginEmail`; client prop·DOM·screenshot·fixture에 원문 0 | raw email이 client boundary/DOM에 등장 |
| AC-P02 | Platform grade 비노출 | source/unit/render | `isPlatformAdmin`이면 membership label 추정 없이 fail-closed; 1~4급·tier·persona 0 | Platform role을 대표/팀장/사원으로 표시 |
| AC-S01 | local-scope signout | route unit/source | `signOut({ scope: "local" })` 정확히 1회, 성공 시 current browser cookie 정리와 login redirect | 기본/global signout 사용 |
| AC-S02 | signout 오류 fail-closed | route unit/HTTP | auth signout error이면 성공 redirect·cookie 삭제·성공 문구 금지; non-success 결과와 재시도 가능 | 실패를 signed-out 성공으로 위장 |
| AC-V01 | light/dark | browser | 동일 candidate/fixture에서 두 theme, 대비·토큰·첫 paint·console error 0 | theme별 핵심 CTA/문구 소실 |
| AC-V02 | 390×844 mobile | browser | 1열 C 벤토, 가로 overflow 0, 44px target, 메뉴·logout dialog 접근 | 가로 잘림·CTA/취소 접근 불가 |
| AC-K01 | keyboard | browser | 메뉴 open→첫 항목 focus, Arrow/Home/End, Escape→trigger focus, dialog cancel→trigger focus | focus 유실·keyboard trap |
| AC-M01 | reduced-motion | source/browser | media query 존재, menu/dialog/skeleton animation·transition 최소화, 기능 손실 0 | motion 강제 또는 내용 소실 |
| AC-L19 | #19 layout rebase 회귀 | git/source/unit/build/browser | Account C merge 뒤 #19 새 head에서 `AccountMenu`와 entitlement/error banner 공존, 새 SHA 전체 재실행 | 과거 #19/Account PASS 재사용 또는 menu 소실 |

## 4. 코드 파일별 검수 계약

| 코드 파일 | 확인할 계약 | 필수 증거 |
|---|---|---|
| `app/src/app/(app)/account/page.tsx` | `redirect("/settings/account")`만 소유; 별도 loader/UI 없음 | source hash, redirect unit/static assertion, unauth/auth HTTP location |
| `app/src/app/(app)/settings/account/page.tsx` | `getSession()`으로 auth guard와 실제 Ctx 확보; `buildAccountViewModel(ctx)` 사용 | source hash, render/contract test, unauth HTTP |
| `app/src/app/(app)/layout.tsx` | 실제 session에서 이름·Workspace만 `AccountMenu`에 전달; raw email/Platform grade prop 0 | diff, static assertion, render/visual |
| `app/src/components/account/AccountMenu.tsx` | 이름 있는 메뉴, 실제 account link, focus/Escape/Arrow/Home/End | source test 또는 browser keyboard trace |
| `app/src/components/account/AccountHub.tsx` | C 벤토 읽기 요약; 없는 session/privacy/team 성공을 만들지 않음 | DOM contract test, screenshot |
| `app/src/components/account/CurrentSessionLogout.tsx` | 현재 브라우저 영향 문구, dialog focus return, `/auth/signout` POST | DOM/source test, keyboard visual |
| `app/src/components/account/account.module.css` | semantic token만, 390 1열, 44px target, reduced-motion | forbidden literal scan, screenshot, computed overflow |
| `app/src/lib/account/presentation.ts` | email mask, membership label, actual Ctx view model, Platform fail-closed | unit test stdout |
| `app/src/app/auth/signout/route.ts` | explicit local signout, 성공/실패 분기, 실패 시 cookie 유지 | route unit test stdout |

금지 파일·경로가 changed list에 있으면 STOP한다: migration, RLS, `session.ts`, callback, `settings/members`, `nav-items.ts`, Vercel 설정. Amendment의 lease 밖 파일은 MWC 재승인 전 PASS할 수 없다.

## 5. 테스트 파일별 필수 assertion

### 5.1 `app/src/lib/account/presentation.test.ts`

- 정상·한 글자·null·invalid 이메일 masking
- 결과에 fixture raw email 전체 문자열 미포함
- owner/admin/member → 대표/팀장/사원 변환은 `isPlatformAdmin=false`일 때만
- `isPlatformAdmin=true`이면 `확인 중`, `canManageCompany=false`, 안전 확인 문구
- name null/공백, avatar initial, 긴 Unicode 이름
- Workspace name과 scope는 입력 `Ctx`에서만 생성; sample production 상수 0

### 5.2 `app/src/lib/auth/account-ui.test.ts`

- `/account` source는 `/settings/account` redirect만 갖고 별도 UI·loader 없음
- `/settings/account` source는 `getSession()`과 `buildAccountViewModel(ctx)` 사용
- `layout.tsx`→`AccountMenu` client props에 email·role·scope·platform grade가 없음
- account client files에 raw email fixture, `Platform 1~4`, persona selector, all-device/export/delete success CTA 0
- `AccountHub`의 안전 준비 문구와 local signout만 존재
- 신규 JSX/CSS hex literal 0; semantic `--mw-*` token 사용
- reduced-motion media query와 390px mobile rule 존재

### 5.3 `app/src/app/auth/signout/route.test.ts`

- Supabase env true일 때 `signOut({ scope: "local" })` 정확히 1회
- 성공 시 303과 기대 login location, current dev cookie 3종 삭제
- Supabase env false에서도 local dev cookie 정리의 기존 계약 보존
- signOut error이면 성공 redirect 금지, cookie delete 0, non-success response
- thrown error도 성공으로 삼키지 않고 fail-closed
- token/cookie 실제 값이 test output에 없음

### 5.4 route/auth test 보강 판단

위 세 파일만으로 AC-R01·AC-A01의 실제 redirect/auth 경계가 증명되지 않으면 T01에 다음 중 최소 patch를 요청한다.

- `app/src/lib/auth/account-ui.test.ts`에 route source-contract assertions 추가, 또는
- lease 갱신 후 `app/src/app/(app)/account/page.test.ts`와 `settings/account/page.test.ts` 추가

T08은 T01 product/test 파일을 직접 추가하지 않는다.

## 6. 실행 명령과 expected evidence

모든 명령은 T01 worktree에서 실행하고 command, exit code, candidate HEAD, 파일 hash/size를 이 문서 실행 로그에 기록한다. 비밀값과 실제 계정 정보는 출력하지 않는다.

### GIT-01 — branch/base/lease

```powershell
git -c safe.directory=<account-c-worktree> status --short --branch
git -c safe.directory=<account-c-worktree> rev-parse HEAD
git -c safe.directory=<account-c-worktree> diff --name-status 639d629...HEAD
git -c safe.directory=<account-c-worktree> diff --check
```

Expected evidence:

- branch `agent/account-c-screen`
- base lineage `639d629...`
- unmerged/conflict marker 0
- changed files가 amendment lease 안에 있음
- 다른 writer의 untracked `docs/implementation` 보존

### SRC-01 — redirect·auth·privacy·scope 정적 검사

```powershell
rg -n "redirect|getSession|buildAccountViewModel|signOut|scope|email|isPlatformAdmin|Platform|1~4|persona|모든 기기|내 데이터 내려받기|탈퇴" app/src/app app/src/components/account app/src/lib/account
rg -n "#[0-9a-fA-F]{3,8}" app/src/components/account app/src/lib/account
rg -n "^(<<<<<<<|=======|>>>>>>>)" app/src/app app/src/components/account app/src/lib/account
```

Expected evidence:

- redirect 방향과 local scope positive hit
- client prop/raw email·Platform grade·위험 success CTA forbidden hit 0
- 신규 hex literal·실제 conflict marker 0
- hit 전체는 file:line과 candidate SHA로 보존하되 실제 이메일/비밀값 출력 금지

### UT-01 — presentation

```powershell
npm.cmd run test -w app -- src/lib/account/presentation.test.ts
```

Expected evidence: 대상 test file 발견, skip 0, fail 0, exit 0, case count와 duration.

### UT-02 — account UI contract

```powershell
npm.cmd run test -w app -- src/lib/auth/account-ui.test.ts
```

Expected evidence: redirect/auth/client-boundary/forbidden UI/semantic token assertions 전부 non-skip PASS.

### UT-03 — signout route

```powershell
npm.cmd run test -w app -- src/app/auth/signout/route.test.ts
```

Expected evidence: local scope success와 error/thrown fail-closed가 별도 case로 PASS.

### APP-01 — 정적·전체 회귀

```powershell
npm.cmd run lint -w app
npm.cmd run typecheck -w app
npm.cmd run build -w app
```

```bash
bash scripts/check.sh
```

Expected evidence: 각 명령 exit 0, test skip 0, Next route table에 `/account`, `/settings/account`, `/auth/signout`, client/server boundary 오류 0. 로컬 Node version을 기록하고 CI Node 22/Vercel Node 24 증거는 별도 환경 gate로 유지한다.

### HTTP-01 — 실제 route/auth

```powershell
npm.cmd run dev -w app
```

별도 client에서 redirect를 자동 추적하지 않고 `/account`, `/settings/account`의 status/location을 확인한다.

Expected evidence:

- 미인증 `/account`: login auth boundary를 우회하지 않음
- 인증 `/account`: `/settings/account` 단방향 redirect
- 인증 `/settings/account`: C 화면 200
- redirect loop 0, back/refresh 동일
- 응답 HTML에 raw email·Platform grade 0

### VIS-01 — local browser

- URL: `/settings/account`, `/account`
- viewport: `1280×720`, `390×844`
- theme: light/dark
- input: keyboard only, reduced-motion enabled/disabled
- fixture: 합성 local Ctx alias; 실제 사용자 데이터 금지

Expected evidence:

- 동일 candidate/fixture의 before-after 또는 baseline/candidate screenshot hash·size
- 390px document horizontal overflow 0
- menu first focus, Arrow/Home/End, Escape focus return
- logout dialog cancel 후 trigger focus return
- reduced-motion에서 animation/transition 억제, 기능 동일
- console/runtime error 0
- raw email·Platform grade·all-device/profile/privacy 성공 CTA 0

### L19-01 — #19 rebase 후 회귀

선행조건: Account C가 사용자·T10 승인을 거쳐 main에 merge되고 PR #19가 그 새 main으로 rebase된 별도 candidate가 존재.

```powershell
git diff --name-status <account-c-merge-sha>...<rebased-19-head>
git diff --check <account-c-merge-sha>...<rebased-19-head>
npm.cmd run test -w app -- src/lib/auth/account-ui.test.ts
npm.cmd run lint -w app
npm.cmd run typecheck -w app
npm.cmd run build -w app
```

Expected evidence:

- 새 base/head SHA와 과거 evidence invalidation 기록
- `layout.tsx`에 `AccountMenu`와 #19 entitlement/error 상태가 함께 존재
- `/account → /settings/account`, auth, privacy, keyboard/reduced-motion 회귀 0
- #19의 `006` 운영 HOLD는 유지; rebase PASS를 실DB/merge PASS로 승격하지 않음

## 7. 시각 증거 영수증

각 조합은 다음 필드를 가진다.

```text
candidate_sha
url
auth_state
fixture_alias/version
theme
viewport
reduced_motion
keyboard_sequence
before_artifact: path + sha256 + size
after_artifact: path + sha256 + size
console_result
horizontal_overflow_px
forbidden_text_scan
result: PASS | FAIL | BLOCKED | NOT_RUN
```

스크린샷만으로 auth·privacy·signout PASS를 주지 않는다. 실제 화면에는 합성 이름/회사만 사용하며 이메일 원문·token·cookie를 캡처하지 않는다.

## 8. P0 STOP

다음 중 하나면 후속 T10·사용자 화면·merge relay를 중단한다.

- `/settings/account → /account` 또는 양방향 redirect
- 미인증 C 화면 200, redirect loop, auth metadata 노출
- client component props/DOM/screenshot의 raw email
- Platform role/grade/tier/persona를 Workspace 역할로 표시
- `signOut()` 기본/global 호출을 현재 기기 로그아웃으로 표시
- signout 실패 뒤 cookie 삭제·login success redirect
- 가짜 team/session/privacy/export/delete success
- amendment lease 밖 product file 변경
- 390px overflow, keyboard focus 유실, reduced-motion 무시
- #19 rebase 뒤 `AccountMenu` 소실 또는 과거 evidence 재사용
- 실제 개인정보·비밀값이 테스트·로그·artifact에 포함

## 9. 현재 준비·실행 상태

| 항목 | 상태 | 최초 실측 |
|---|---|---|
| T01 branch/base | `PASS` | `agent/account-c-screen`, HEAD/base `639d629...` |
| T04/T02/amendment/collector 입력 | `PASS` | Round-24 실제 파일 존재·비공백, route delta 확인 |
| presentation source/test | `PASS` | UT-01 6/6 non-skip PASS; Platform 합성 fail-closed 포함 |
| account components/CSS | `PASS` | AccountHub 3/3; client prop 금지어·hex·conflict marker scan 0 |
| `/account`, `/settings/account` routes | `PASS` | 인증 후보 `/account → /settings/account`; 미인증은 `/login?error=membership`; loop 0 |
| `account-ui.test.ts` | `PASS_WITH_SCOPE_NOTE` | 1/1 non-skip; sidebar가 raw Ctx가 아니라 fail-closed presentation을 쓰는지 고정. redirect/client prop은 browser·source 증거로 별도 검수 |
| signout route 변경/test | `PASS` | 4/4 non-skip; local scope, 반환 오류·throw 모두 cookie 삭제 없이 원 화면 오류 |
| layout integration | `PASS` | `{account.roleLabel} · {account.scopeLabel}` 사용 및 raw `ctx.role/scope` 직접 변환 부재 |
| visual/browser | `PASS` | final SHA runtime에서 light/dark, 390 요청 viewport, overflow 0, keyboard·dialog focus, CDP reduced-motion actual PASS |
| #19 rebase regression | `BLOCKED` | Account C merge·#19 rebase 전 |
| T08 final-SHA verdict | `PASS` | commit·tree·clean worktree·명령·runtime·artifact를 byte-bind. merge의 의도적 잔여 gate는 사용자 실제 화면 승인뿐 |
| T10 소비 | `RELAY_READY / NONBLOCKING` | 추가 browser approval 요청 없이 이 증거를 소비; live logout submit은 승인 경계상 `NOT_RUN` |

## 10. 실행 로그 — append only

이하에는 T08이 실제로 실행한 read-only 명령과 결과만 시간순으로 append한다. 코드가 추가될 때마다 candidate working-tree state와 hash/size를 다시 고정한다. 실행하지 않은 항목을 PASS로 표시하지 않는다.

### RUN-000 — 2026-07-24 KST / gate materialization

- branch: `agent/account-c-screen`
- HEAD: `639d629e9c09bba63415a96d0d7d46c653fb24ac`
- worktree 상태: T01 소유 untracked `docs/implementation/`, `app/src/components/account/`, `app/src/lib/account/` 존재
- 제품 코드 변경: T08 0
- 판정: `PARTIAL_READY`; UT-01부터 실행 가능, route/signout/layout/visual은 후속 코드 대기

### RUN-001 — 2026-07-24 KST / UT-01 presentation

- command: `npm.cmd run test -w app -- src/lib/account/presentation.test.ts`
- 1차 sandbox 실행: exit 1 — Vitest/esbuild가 설정 경로를 읽지 못한 실행환경 차단. 제품 test failure로 계산하지 않되 숨기지 않음.
- 동일 명령 escalated 재실행: exit 0
- result: test file 1 passed, tests 6 passed, skip 0, duration 5.79s
- source: `presentation.ts` 2,844 bytes, SHA-256 `121803333A41C36EDBCE2A8B79A8B9A104011938E002A27EACF659CC36AA8751`
- test: `presentation.test.ts` 2,228 bytes, SHA-256 `FDA1D525C7B2A36123B2C81B1CA192878FE3C1CB883629A23C15563BE436A422`
- 확인: member role 표시, email masking, null/invalid fallback, Platform 합성 시 `확인 중`·관리 불가
- 판정: `PASS` — 현재 working-tree bytes 기준이며 파일 변경 시 무효화

### RUN-002 — 2026-07-24 KST / UT-03 local signout

- command: `npm.cmd run test -w app -- src/app/auth/signout/route.test.ts`
- result: exit 0, test file 1 passed, tests 3 passed, skip 0, duration 3.60s
- source: `route.ts` 1,176 bytes, SHA-256 `D0718D7E6434139116037AF990F1A02A8B170C8B70E5059EE3BDF4F794091762`
- test: `route.test.ts` 2,534 bytes, SHA-256 `E05CC86CBE7265695D72A1558498B4E78C5920366CC1B85309E72C1E988C78CC`
- 확인: `signOut({ scope: "local" })`, 성공 303+signed-out location, 오류 시 원 화면 `error=signout`·cookie delete 0, dev cookie 정리
- gap: `createClient/signOut` throw case의 명시 assertion은 없음. final candidate에서도 빠지면 exact patch request 대상.
- 판정: `PASS_WITH_GAP`; local/error-return 계약 PASS, thrown-error 증거 `NOT_RUN`

### RUN-003 — 2026-07-24 KST / AccountHub render contract

- 발견 파일: `app/src/components/account/AccountHub.test.tsx`
- command: `npm.cmd run test -w app -- src/components/account/AccountHub.test.tsx`
- result: exit 0, test file 1 passed, tests 2 passed, skip 0, duration 6.01s
- 확인: C 핵심 섹션, masked synthetic email, raw fixture email 비노출, 1급·지원 모드·모든 기기 로그아웃 비노출, 대표만 점진적 관리 설명
- source scan: 신규 account component/lib의 hex literal 0, 실제 conflict marker 0
- 주의: static render PASS는 actual `Ctx` loader·auth·client-boundary·browser PASS를 대체하지 않음
- 판정: `PASS` — 현재 bytes 기준; route/layout 연결 전 전체 gate는 `PARTIAL_READY`

### RUN-004 — 2026-07-24 KST / 통합 정적·빌드 게이트

- candidate: branch `agent/account-c-screen`, HEAD `639d629e9c09bba63415a96d0d7d46c653fb24ac` 위 T01 working-tree candidate
- targeted command: `npm.cmd run test -w app -- src/lib/account/presentation.test.ts src/components/account/AccountHub.test.tsx src/app/auth/signout/route.test.ts`
- 최초 targeted result: 3 files, 11/11 PASS, skip 0. 이후 보강된 candidate는 full check에서 presentation 6, AccountHub 3, signout 4, account-ui 1 모두 PASS.
- `npm.cmd run lint -w app`: exit 0
- `npm.cmd run typecheck -w app`: exit 0
- `npm.cmd run build -w app`: exit 0; route table에서 `/account`, `/settings/account`, `/settings/account/sessions`, `/settings/account/privacy`, `/auth/signout` 확인
- `scripts/check.sh` 1차: exit 1 — 호출한 Git Bash의 PATH에 `dirname`/`bash`가 없어 시작 전 환경 실패. 제품 실패로 오인하지 않고 기록.
- PATH에 Git `usr/bin`·`bin`을 명시한 동일 스크립트 재실행: exit 0, `✅ check 통과`; app 42 files, 486 PASS/5 skip, worker 3 files, 14 PASS. 기존 `rls-penetration` 5 skip은 Account C PASS 근거로 사용하지 않음.
- source scan: `AccountMenu.tsx`, `CurrentSessionLogout.tsx` client 경계에서 `email`, raw `ctx.role/scope`, Platform grade/tier prop 0; 신규 account 범위 hex literal 0; conflict marker 0.
- 최신 핵심 bytes:
  - `AccountHub.tsx` 4,546 bytes, SHA-256 `08AC80BAB7D703821A8CA9890B2B3A020DE8ACC0520DB6C9AEA0D65A3E191A79`
  - `AccountHub.test.tsx` 1,993 bytes, SHA-256 `F991F5BC3229B8E94DA93DAA69E15BD9EDFAA72F914565ED1CA7407404816C9E`
  - `(app)/layout.tsx` 4,683 bytes, SHA-256 `5A80CDB63836F3A8C1BEC7B6A63460C8B18606EEC37958DBA0D5C416E1288359`
  - `account-ui.test.ts` 554 bytes, SHA-256 `80E0DCE9BDDEFD30E95382DA1428001811F67BF730165DAF346EADB068C6C618`
  - `auth/signout/route.test.ts` 3,334 bytes, SHA-256 `9D225A7DE30AB15542ED1855118F820821BD01F94DDBE9D0C793CDAACFDB2517`
- 판정: `PASS` — 정적·단위·repo check·build 계층만. working-tree bytes가 바뀌면 무효화.

### RUN-005 — 2026-07-24 KST / local browser auth·route·privacy·visual

- 환경: local Next dev server `http://localhost:3000`, 합성 local Owner fixture. 실제 사용자 데이터·token·cookie 값은 읽거나 기록하지 않음.
- 미인증 최초 `/account`: 최종 `/login?error=membership`; C 본문 0. 판정 `PASS`.
- 인증 fixture `/account`: 최종 `/settings/account`, `내 계정과 팀` heading 1, redirect loop 0. 판정 `PASS`.
- 중간 candidate에서 `AccountHub`에 `links`가 전달되지 않아 `links.sessions` TypeError/error boundary를 한 차례 실측하고 즉시 `RUNTIME FAIL / MERGE HOLD` 및 exact patch를 T01에 전달함.
- 후속 candidate에서 `links?: AccountHubLinks`, 기본값 `{}`와 무-links 회귀 테스트가 추가된 뒤 reload: error heading 0, C heading 1. 과거 실패 증거를 삭제하지 않되 현재 bytes로 재검증해 회복을 입증.
- DOM privacy: masked email 있음, raw email pattern 0, Platform Admin/플랫폼 관리자/1~4급 token 0, 다운로드·탈퇴·모든 기기 로그아웃 성공 token 0.
- `/settings/account/sessions`, `/settings/account/privacy`: 보호/준비 상태 있음, 가짜 성공 상태 0.
- 390 요청 viewport의 CSS client width 375에서 document overflow 0. 브라우저 UI가 차감한 실제 CSS viewport를 증거에 함께 기록함.
- 최신 dark screenshot: 18,424 bytes, SHA-256 `8481F3224BBCAF592EAA20FE3809A0976BD6576B58EF37D3686C8306A7D79761`; theme `dark`, overflow 0.
- 최신 light screenshot: 18,511 bytes, SHA-256 `8FFFE24CF2809BEAA9BCEE633CDDACE1B332490049A221026055346F353C2D7B`; theme `light`, overflow 0.
- keyboard: menu open→`내 계정`, ArrowDown→`회사와 팀`, End→`이 기기에서 로그아웃`, Home→`내 계정`, Escape→trigger `aria-expanded=false`; 모두 PASS.
- logout dialog: open 시 `계속 사용하기` focus, 취소 후 `이 기기에서 로그아웃` trigger로 focus return; PASS. 실제 로그아웃 제출은 수행하지 않음.
- reduced-motion: `account.module.css`의 `@media (prefers-reduced-motion: reduce)` 아래 menu/dialog/skeleton animation none·transition 0.001ms 확인. 현재 browser capability는 viewport/visibility만 제공하고 OS preference는 reduce=false라 실제 reduce emulation 결과는 `NOT_RUN`; 이 항목은 T10 수동 Chrome/지원 러너 증거 전 최종 PASS 금지.
- 판정: `PASS_WITH_GAP`; 실행 가능한 local C slice는 통과, reduced-motion actual과 #19 rebase는 미실행.

### RUN-006 — exact patch request와 잔여 차단

- T01에 전달·반영 확인: `AccountHub` links optional+default와 무-links render test, layout의 `account.roleLabel/scopeLabel`, signout throw fail-closed test, `account-ui.test.ts`.
- 추가 제품 코드 수정: T08 0.
- Account C merge 판단: T10 독립 검수와 reduced-motion 실제 증거 전 `HOLD`.
- L19-01: Account C merge SHA와 rebased #19 head가 아직 없어 `BLOCKED`; 과거 layout 증거 재사용 금지.

### RUN-007 — 2026-07-24 KST / final commit `4e69ec2` byte-bind rerun

#### Candidate identity

- branch: `agent/account-c-screen`
- base: `639d629e9c09bba63415a96d0d7d46c653fb24ac`
- commit: `4e69ec2b7434ba36f261ea1d01b4358ab8e4685c`
- tree: `f119f228fbfddc51315251bea13fa2eacce51afa`
- delta: 20 files, 1,510 insertions, 27 deletions
- `git -c core.excludesFile=C:/tmp/codex-nonexistent-gitignore status --porcelain=v1 --untracked-files=all`: exit 0, output 0 — clean
- T08 제품 코드 변경 0; commit/push/merge/deploy 0

#### Final-byte commands

- targeted: `npm.cmd run test -w app -- src/lib/account/presentation.test.ts src/components/account/AccountHub.test.tsx src/lib/auth/account-ui.test.ts src/app/auth/signout/route.test.ts`
  - exit 0, 4 files, 14/14 PASS, skip 0, duration 8.87s
  - presentation 6, AccountHub 3, account-ui 1, signout 4
- `npm.cmd run lint -w app`: exit 0
- `npm.cmd run typecheck -w app`: exit 0
- `npm.cmd run build -w app`: exit 0; Account C 5개 route가 production route table에 존재
- repo standard `scripts/check.sh`: PATH에 Git `usr/bin`·`bin`을 명시해 exit 0, `✅ check 통과`
  - app 42 files, 486 PASS/5 baseline RLS skip
  - worker 3 files, 14 PASS
  - baseline RLS skip 5는 Account C PASS 근거로 사용하지 않음

#### Final-byte anchors

- `(app)/account/page.tsx`: 129 bytes, SHA-256 `E0E8C586D7228323ECF566E912598A6418C17C5C908312F4E7D73F23EC6F6DF7`
- `(app)/layout.tsx`: 4,683 bytes, SHA-256 `5A80CDB63836F3A8C1BEC7B6A63460C8B18606EEC37958DBA0D5C416E1288359`
- `(app)/settings/account/page.tsx`: 1,742 bytes, SHA-256 `B6F15D982CC29893CC7E7B8B3930B5E85F80ECA44FAB6AA5F1BB957099F6D8FA`
- `AccountHub.tsx`: 4,546 bytes, SHA-256 `08AC80BAB7D703821A8CA9890B2B3A020DE8ACC0520DB6C9AEA0D65A3E191A79`
- `AccountHub.test.tsx`: 1,993 bytes, SHA-256 `F991F5BC3229B8E94DA93DAA69E15BD9EDFAA72F914565ED1CA7407404816C9E`
- `account-ui.test.ts`: 554 bytes, SHA-256 `80E0DCE9BDDEFD30E95382DA1428001811F67BF730165DAF346EADB068C6C618`
- `auth/signout/route.ts`: 1,296 bytes, SHA-256 `B6ED6EE23A27725D745486FBE395D8FC902496D9E3803BFC8106C1FFFBFEA36B`
- `auth/signout/route.test.ts`: 3,334 bytes, SHA-256 `9D225A7DE30AB15542ED1855118F820821BD01F94DDBE9D0C793CDAACFDB2517`
- `account.module.css`: 6,750 bytes, SHA-256 `B9A5F020E2F972025EA52CB93B0C91F4F8821F1027A9818DC5B5F0D444EB39C3`

#### Final-SHA runtime — `http://localhost:3037`

- cookie 없는 HTTP probe:
  - `/account`: 307 → `/login?error=membership`
  - `/settings/account`: 307 → `/login?error=membership`
  - 판정: auth protection PASS
- 합성 local Owner fixture가 있는 browser:
  - `/account` 최종 URL `/settings/account`, heading 1, redirect loop 0
  - sidebar `대표 · 회사 업무 전체`; raw `ctx.role/scope` 직접 표시가 아닌 account presentation 결과
  - masked email 있음, raw email pattern 0, Platform Admin/플랫폼 관리자/1~4급 0, 가짜 완료 token 0
  - sessions/privacy route는 보호·준비 상태, 가짜 성공 0
  - console warn/error 0
- 390 요청 viewport: 실제 CSS client width 375, horizontal overflow 0
- dark: background `rgb(17, 18, 22)`, overflow 0, screenshot 43,552 bytes, SHA-256 `D8794CC7462109F93C02861F63FD5FFBEE9B9BE1D22D8CA04CAC176BCF19D67D`
- light: background `rgb(247, 248, 250)`, overflow 0, screenshot 42,391 bytes, SHA-256 `C6617E79EB938D5583FA30C7DFFEEBDF15E680B42027A37E8F0E1907ABD85CDE`
- keyboard: open→`내 계정`, ArrowDown→`회사와 팀`, End→`이 기기에서 로그아웃`, Home→`내 계정`, Escape→trigger `aria-expanded=false`
- logout dialog: open focus `계속 사용하기`, 취소 뒤 trigger로 focus return
- reduced-motion actual:
  - CDP로 `prefers-reduced-motion: reduce`를 임시 적용하고 `matchMedia(...).matches=true` 확인
  - menu와 dialog 모두 `animation-name:none`, `animation-duration:0s`, `transition-duration:0.000001s`, `scroll-behavior:auto`
  - 검수 후 media override 제거(`matches=false`)와 viewport reset 완료
- 실제 logout 제출: `NOT_RUN / approval-required nonblocking gap`. final route test가 `scope:"local"`, 성공 redirect, 반환 오류·throw에서 cookie 미삭제/오류 redirect를 4/4로 보장한다. 다른 세션 유지 여부를 live-proven으로 주장하지 않는다.

#### Final verdict

- `T08 PASS — ACCOUNT-C-SAFE-01`
- 중간 working-tree RUN-000~006의 FAIL·gap은 삭제하지 않고 이 final-SHA rerun이 supersede한다.
- Account C 자체의 추가 기술 차단 0. merge는 사용자 실제 화면 명시 승인까지 `HOLD`.
- L19-01은 Account C merge 뒤 #19 rebase candidate에 대한 downstream gate이므로 현재 Account C PASS를 막지 않으며, 별도 새 SHA 증거 전에는 계속 `BLOCKED`.

## 11. Relay packet

| 소비자 | 전달 내용 | 현재 상태 |
|---|---|---|
| MWC | final commit/tree/clean, 명령·runtime·reduced-motion actual, 사용자 승인만 남은 상태 | `T08 PASS / USER_VISUAL_APPROVAL_HOLD` |
| T10 | final byte anchors, 명령·non-skip, auth·redirect·privacy·visual·console bundle; 추가 browser approval 금지 | `CONSUME_READY / NONBLOCKING` |
| T09 | Account C→#19 rebase의 L19-01 새 SHA 회귀 조건 | `DAG_INPUT_READY` |

다음 자동 전환:

```text
UT-01 PASS
  -> route/signout/layout files READY
  -> UT-02 + UT-03 + SRC-01
  -> APP-01
  -> HTTP-01 + VIS-01
  -> T10 independent review
  -> user actual-screen approval
  -> merge/production (T08 비범위)
  -> #19 rebase
  -> L19-01 fresh evidence
```

이 문서는 final commit에 바인딩된 T08 수용 증거이며 merge·deploy 자체의 완료 증거는 아니다. commit bytes가 바뀌면 RUN-007은 즉시 무효화한다.
