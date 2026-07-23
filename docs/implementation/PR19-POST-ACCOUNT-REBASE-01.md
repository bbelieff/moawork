# PR19-POST-ACCOUNT-REBASE-01

- 상태: `LOCAL_REBASED_CANDIDATE`
- 병합 상태: `MERGE_HOLD`
- 브랜치: `feat/workspace-bootstrap`
- 작업 폴더: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\moawork-wt-workspace-bootstrap`
- 기준 main: `ade79e753ff4c99eab68b5a36bd8195245a6d57b`
- rebase 전 PR #19 head: `b28a5fa4573e01154943a410b52a74ff11052dc7`
- rebase 직후 로컬 기능 커밋: `60d2c72bb63bf9b69e288749a680319705d6594f`
- 원격 상태: PR #19는 OPEN/Draft이며 원격 head는 rebase 전 SHA 그대로다. 이 작업에서는 push, merge, deploy를 하지 않았다.

## 실제 충돌과 해결

실제 충돌은 `app/src/app/(app)/layout.tsx` 한 파일의 import/통합 문맥뿐이었다.

해결 결과:

- Account C의 `AccountMenu`, `buildAccountViewModel`, 반응형 shell을 보존했다.
- 사이드바 역할/범위는 `account.roleLabel`, `account.scopeLabel`을 사용해 Platform principal 오표시를 막는 fail-closed 계약을 보존했다.
- `/account` canonical redirect, `/settings/account` Safe UI, local-scope signout과 실패 시 fail-closed 동작 및 테스트를 보존했다.
- PR #19의 `getLockedFeaturesForOrg`와 `EntitlementReadError`를 통합했다.
- entitlement 조회 실패 시 모든 대상 기능을 잠그고 오류 안내를 노출하며 데이터 변경을 하지 않는다.

## origin/main 대비 기능 변경 파일

1. `app/src/app/(app)/layout.tsx`
2. `app/src/app/(app)/onboarding/page.tsx`
3. `app/src/app/auth/callback/route.test.ts`
4. `app/src/app/auth/callback/route.ts`
5. `app/src/components/auth/FeatureGate.tsx`
6. `app/src/lib/entitlements.test.ts`
7. `app/src/lib/entitlements.ts`
8. `app/src/lib/workspace/migration.test.ts`
9. `app/src/lib/workspace/service.test.ts`
10. `app/src/lib/workspace/service.ts`
11. `supabase/migrations/006_workspace_bootstrap.sql`

이 영수증 외 기능 diff는 rebase 전 PR #19의 11개 파일 범위를 유지한다.

## 검증 영수증

- PR #19 + Account C 대상 테스트: 8개 파일, 30개 테스트 PASS
- `npm.cmd run lint -w app`: PASS
- `npm.cmd run typecheck -w app`: PASS
- `scripts/check.sh`: PASS
  - app: 45개 파일, 501 PASS, 5 SKIP
  - worker: 3개 파일, 14 PASS
- `npm.cmd run build -w app`: PASS
  - `/account`
  - `/settings/account`
  - `/settings/account/sessions`
  - `/settings/account/privacy`
  - `/auth/signout`
- `git diff --check origin/main...HEAD`: PASS
- 추가된 diff의 금지 credential assignment 패턴: 0건
- Account C UI 경로의 Platform 1~4급, persona, global/all-device logout 회귀 표식: 0건

첫 대상 테스트 시도는 샌드박스가 Vitest/esbuild 설정 경로를 차단해 시작 전에 실패했다. 같은 명령을 허용된 실행 환경에서 재실행하여 위 PASS 결과를 얻었다. 첫 `scripts/check.sh` 시도도 비로그인 Git Bash의 PATH 초기화 부재로 시작 전에 실패했으며, 로그인 Git Bash 환경에서 재실행해 전체 PASS했다.

## 금지사항 및 다음 게이트

- `006_workspace_bootstrap.sql`은 PR 산출물로만 존재하며 이 작업에서 적용하지 않았다.
- Supabase, Production, Vercel, 실데이터를 변경하지 않았다.
- force-push, PR merge, deploy를 하지 않았다.
- 원격 갱신은 T10 candidate PASS 이후에만 `--force-with-lease`로 허용된다.
- 다음 소비자: MWC, T08, T10, T09
- 다음 WORK-ID: `PR19-POST-ACCOUNT-REBASE-VERIFY-01`
- 사용자 실제 승인 및 T10 final-SHA 검수 전 `MERGE_READY`를 주장하지 않는다.
