# Account C Merge Order Amendment

> WORK-ID: `ACCOUNT-C-MERGE-ORDER-ALT-01`  
> 대상: `ACCOUNT-C-INTEGRATION-GATE-01`, `ACCOUNT-C-PRODUCT-CONTRACT-01`  
> 사용자 목표: Account C Safe Slice를 지금 구현·배포  
> release actual: PR #21 head=`4e69ec2`, squash merge=`ade79e7`, Production source=`main@ade79e7`  
> 결론: **A 승인 — Account C를 main에 먼저 merge·배포하고 PR #19를 이후 rebase**  
> merge 상태: **APPROVED / MERGED / PRODUCTION_DEPLOYED**  
> 남은 caveat: **인증 후 Account C DOM의 Production live read-back 미검증 / PR #19 006 gate HOLD**

## 1. 대안 판정

| 대안 | 사용자 가치 | 보안 | 외부 변경 | 판정 |
|---|---|---|---|---|
| A. Account C 먼저 main merge | 지금 계정 진입·읽기·현재 logout 제공 | migration/profile/session/tenant write를 제외하면 현 auth 경계 안에서 검증 가능 | 앱 파일과 자동 Vercel 배포만. DB 변경 0 | **추천** |
| B. #19 head에 stack | 구현은 가능하나 #19 운영 gate까지 사용자 배포 지연 | unverified `006`과 후보 SHA에 종속 | rebase/retarget와 preview 누적 | 기각 — 불필요한 HOLD 전파 |
| C. #19 운영 적용/merge를 계정 prerequisite로 포함 | 가장 늦음 | `006` 실DB·동시성·backfill까지 이번 범위에 들어와 위험과 blast radius 증가 | DB·앱·운영 배포 동시 변경 | 기각 — 계정 Safe Slice에 불필요 |

A는 “full Account C P0가 안전하다”는 뜻이 아니다. 이번 merge는 상단 사용자 menu, `/settings/account`, C 읽기 shell, 마스킹 email, explicit local signout, `/account` compatibility redirect까지만 허용한다. Profile edit, Workspace switch/profile 성공, 다른/모든 기기, 개인정보 export/delete, membership write, Platform tier/persona는 0건이어야 한다.

## 2. route reconcile

- 장기 제품 canonical은 T04 `ACCOUNT-C-PRODUCT-CONTRACT-01`의 `/account`다.
- 이번 T01 Safe Slice actual route는 `/settings/account`다.
- 이번 branch에는 `app/src/app/(app)/account/page.tsx`를 **server redirect only**로 두어 `/account → /settings/account`를 제공한다.
- MWC 승인으로 이 방향은 잠겼다. P0 cutover 전에는 뒤집지 않는다. P0 cutover 때 `/account`가 실제 route tree를 소유할 준비가 끝난 뒤에만 `/settings/account → /account`로 방향을 바꾼다.
- canonical은 사용자·상단 메뉴·제품 계약이 가리키는 권위 URL이고, Safe actual은 이번 한정 구현의 loader 소유 URL이다. `proxy.ts`는 두 경로를 모두 보호하고 현재 `settings/members` 구조와도 충돌하지 않는다.
- 두 URL에 서로 다른 계정 page/data loader를 동시에 두지 않는다. redirect loop, auth bypass, back/refresh를 T10이 검사한다.

## 3. 정확한 file lease

### T01 / `ACCOUNT-C-SAFE-01` 단일 writer

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

T01 actual diff가 이 목록보다 작으면 작은 범위를 유지한다. 새 파일명이 달라질 경우 MWC가 merge 전에 lease를 실제 changed-file list로 한 번 갱신한다. 이 목록 밖의 `session.ts`, callback, `settings/members`, `nav-items.ts`, migration, RLS, Vercel 설정은 수정 금지다.

### PR #19 writer

PR #19의 기존 11파일 lease는 유지하되 `app/src/app/(app)/layout.tsx`의 최종 write는 Account C merge 전까지 중단한다. Account C merge 뒤 새 main으로 rebase한 PR #19 writer가 entitlement 변경만 다시 적용하고 `AccountMenu`·account entry를 보존한다. 두 writer가 같은 시점에 layout을 수정하지 않는다.

## 4. merge·배포 순서

1. MWC가 T01 worktree/branch/base=`639d629`와 위 lease를 동결한다.
2. T01은 Safe Slice를 완료하고 targeted test, `scripts/check.sh`, app build, 1280×720·390×844 light/dark/keyboard를 실행한다.
3. T08은 같은 final candidate SHA에서 regression·accessibility를 실행한다.
4. T10은 T08 증거가 연결된 final Account C SHA에서 code·visual·security와 raw email, Platform tier/persona, profile/member/session P0 성공, 위험 CTA가 0인지 검사한다.
5. 사용자가 실제 화면을 승인하고 MWC가 merge를 승인한 뒤에만 Account C PR을 `main`에 merge한다. 그 전 merge는 HOLD다.
6. Vercel이 main merge SHA를 자동 Production 배포한다. `/account → /settings/account`, current local logout을 public domain에서 read-back한다.
7. 실패가 없으면 Account C merge SHA를 기준선으로 고정한다.
8. PR #19는 그 새 main으로 rebase한다. `layout.tsx`에서 Account menu를 보존하고 entitlement source/error banner를 결합한다.
9. PR #19의 전체 test/build/Preview와 T10 code·visual 회귀를 새 head에서 다시 실행한다.
10. PR #19는 여전히 `006` 운영 적용·실DB gate 전 **merge HOLD**다. rebase 성공이 운영 승인으로 바뀌지 않는다.
11. PR #20은 PR #19의 재작성된 head를 기준으로 다시 rebase하며 기존 `006 → 007` 순서를 유지한다.

## 5. T10 재검수 포인트

- Account C PR: explicit `signOut({ scope: "local" })`, 다른 session 유지 증거, 실패를 성공 redirect로 위장하지 않음.
- route: `/account → /settings/account` 단방향, 인증 우회·loop 0.
- layout: Account menu와 #19 entitlement error banner가 동시에 존재하고 keyboard/focus/reduced-motion 회귀 0.
- privacy: raw email/client props/screenshot/fixture 노출 0.
- authz: Platform role/tier/persona selector 0, membership/profile/session write 0.
- #19 rebase: changed-file list와 base/head를 새로 기록하고 과거 T10 PASS를 재사용하지 않음.

## 6. rollback

### Account C Production 실패

1. 새 destructive reset/force-push를 하지 않는다.
2. MWC 승인 아래 Account C merge commit을 되돌리는 **revert PR/commit**을 main에 만든다.
3. Vercel의 이전 Production instant rollback은 긴급 도메인 복구에만 사용할 수 있으며, Git 정본은 반드시 revert commit으로 맞춘다.
4. rollback 뒤 `main SHA = Production source SHA`, 로그인, 기존 앱 shell, logout을 read-back한다.
5. 실패 증거에 token/cookie/email/env 값은 남기지 않는다.

### PR #19 rebase 회귀

- PR #19를 merge하지 않는다. Account C Production은 유지한다.
- rebase branch에서 layout conflict를 수정하고 새 head로 test/build/T10을 다시 수행한다.
- `006` migration 적용·rollback을 Account C rollback에 묶지 않는다. 두 운영 단위를 분리한다.

## 7. STOP / 상태

### STOP

- T01 Safe Slice에 migration, profile/member write, tenant cutover, session registry, all-device success를 추가
- Account C와 PR #19가 동시에 `layout.tsx`를 수정
- PR #19 과거 head/T10 증거를 rebase 뒤 재사용
- Account C 배포를 위해 `006` 운영 적용을 서두르거나 범위를 확대
- Vercel Preview/local build만으로 Production 완료 주장

| 주체 | 상태 | 다음 행동 |
|---|---|---|
| 사용자 | `APPROVED` | 실제 화면 승인 완료 |
| T01/T05 writer chain | `MERGED / LEASE RELEASED` | PR #21 release receipt 보존 |
| T04 | `PRODUCT CONTRACT READY` | `/settings/account` Safe visual과 `/account` canonical drift 검수 |
| T09 | `PR #19 REBASE INPUT READY` | post-Account main에서 #19/#20 순서 반영 |
| T08 | `PASS` | final candidate SHA regression·accessibility 완료 |
| T10 | `PASS — RELEASE CAVEAT` | PR #19 rebased SHA를 독립 재검수; 인증 후 Production Account DOM은 미검증으로 유지 |
| PR #19 | `MERGE HOLD` | Account merge 뒤 rebase, 이후에도 006 운영 gate 유지 |
| MWC | `PRODUCTION_DEPLOYED` | `main@ade79e7`·Production 결합과 비인증 `/account` auth redirect 확인 |

즉시 다음 WORK-ID는 **`PR19-POST-ACCOUNT-REBASE-01`**이다. PR #19는 `main@ade79e7`로 rebase해 `AccountMenu`를 보존하고 전체 #19 gate를 새 head에서 다시 실행한다. `006` 운영·실DB gate는 계속 HOLD이고 PR #20은 새 #19 head를 따른다.

## 8. release receipt

- PR #21: closed/merged, head=`4e69ec2b7434ba36f261ea1d01b4358ab8e4685c`, squash merge=`ade79e753ff4c99eab68b5a36bd8195245a6d57b`.
- GitHub connector: `main`과 `ade79e7` compare status=`identical`.
- CI: run #88 completed/success; Vercel Preview success.
- Production: deployment `7zcsdMk4N88GxS8pme5AtZNGqyuB`, Ready/Latest/Production/Current, source=`main@ade79e7`, `www.moa-work.com`.
- Public unauthenticated read-back: `/account`는 `/login?next=%2Faccount`로 보호됨.
- Scope caveat: 인증 세션이 없어 post-login Account C DOM은 Production live-proven으로 승격하지 않는다. preview/local actual screen과 exact SHA-to-Production binding까지만 완료 증거다.
