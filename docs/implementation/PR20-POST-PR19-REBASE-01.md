# PR20-POST-PR19-REBASE-01

- 상태: `CODE_READY / LOCAL_ONLY`
- 병합 상태: `MERGE_HOLD`
- 브랜치: `feat/first-lead-flow`
- 작업 폴더: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\moawork-wt-first-lead`
- 기준 PR #19 head: `62053ba20dca6b6a9993f2b5cf5f0b1bc4397ef3`
- rebase 전 PR #20 head: `5daad685906851cd1c1677ef7da88a80cb1dce66`
- rebase 후 첫 리드 feature commit: `aa0080c`
- 원격 상태 확인: PR #19와 PR #20은 OPEN/Draft이며, PR #20 baseRefOid는 정확히 `62053ba20dca6b6a9993f2b5cf5f0b1bc4397ef3`이었다.
- 이 작업에서는 push, force-push, merge, deploy, DB/Supabase/Production write를 수행하지 않았다.

## Rebase 방식과 충돌 영수증

rebase 전 ancestry는 `639d629 -> b28a5fa(PR19 구 head) -> 5daad68(PR20 feature)`였다. 새 PR #19 head에는 Account C main과 재작성된 PR19 feature가 이미 포함되므로 구 `b28a5fa`를 다시 재생하지 않았다.

실행 경계:

- 새 base: `62053ba20dca6b6a9993f2b5cf5f0b1bc4397ef3`
- 제외한 구 base commit: `b28a5fa4573e01154943a410b52a74ff11052dc7`
- 재생한 commit: `5daad685906851cd1c1677ef7da88a80cb1dce66` 하나
- 실제 충돌: 0개
- 수동 충돌 해결 파일: 없음
- 자동 병합 후 의미 변경: 없음

정적 검사에서 신규 파일 4개의 EOF 뒤 빈 줄이 `git diff --check`에 검출됐다. 다음 파일에서 EOF 빈 줄만 제거해 feature commit에 포함했으며 로직·테스트 의미는 바꾸지 않았다.

1. `app/src/lib/crm/first-lead-ui.test.ts`
2. `app/src/lib/crm/first-lead.ts`
3. `app/src/lib/repo/supabase/server-source.test.ts`
4. `app/src/lib/repo/supabase/server-source.ts`

## 보존 결정

### PR #19 Workspace bootstrap

- `getLockedFeaturesForOrg`와 `EntitlementReadError` 기반 fail-closed entitlement 처리를 보존했다.
- Workspace bootstrap 서비스, callback, onboarding, FeatureGate 및 관련 테스트를 base 그대로 보존했다.
- `006_workspace_bootstrap.sql`은 수정하지 않았다.

### Account C

- `AccountMenu`와 `buildAccountViewModel`을 보존했다.
- 사이드바는 `account.roleLabel`, `account.scopeLabel`을 계속 사용한다.
- `/account`는 `/settings/account`로 canonical redirect한다.
- 현재 session logout은 `signOut({ scope: "local" })`을 유지한다.
- Platform tier/persona/global logout UI를 추가하지 않았다.

### Migration 순서

- `006_workspace_bootstrap.sql` base/head blob: `3d6f5deb891f10789dc4b636bc7d132c4d38fcd5`로 동일
- `007_first_lead.sql` blob: `42f320d06dd30e4c3cfd2af9bff9a7659ec0ec48`
- 저장소 순서: `005_app_admins.sql -> 006_workspace_bootstrap.sql -> 007_first_lead.sql`
- PR #20 고유 migration diff는 `007_first_lead.sql` 하나뿐이다.
- 006/007 모두 실제 DB에 적용하지 않았다.

## PR #20 고유 변경 파일

1. `app/src/app/(app)/newcust/actions.ts`
2. `app/src/app/(app)/newcust/page.tsx`
3. `app/src/components/crm/NewLeadForm.tsx`
4. `app/src/components/shell/nav-items.ts`
5. `app/src/lib/crm/boardData.test.ts`
6. `app/src/lib/crm/first-lead-ui.test.ts`
7. `app/src/lib/crm/first-lead.test.ts`
8. `app/src/lib/crm/first-lead.ts`
9. `app/src/lib/repo/supabase/server-source.test.ts`
10. `app/src/lib/repo/supabase/server-source.ts`
11. `supabase/migrations/007_first_lead.sql`

이 receipt가 최종 로컬 후보의 열두 번째 변경 파일이다.

## 검증 영수증

- 첫 리드 + Workspace bootstrap + Account C 대상 테스트: 12파일, 54테스트 PASS
- `npm.cmd run lint -w app`: PASS
- `npm.cmd run typecheck -w app`: PASS
- `scripts/check.sh`: PASS
  - app: 48파일, 517 PASS, 기존 RLS 5 SKIP
  - worker: 3파일, 14 PASS
- `npm.cmd run build -w app`: PASS
  - `/newcust`
  - `/account`
  - `/settings/account`
  - `/settings/account/sessions`
  - `/settings/account/privacy`
  - `/auth/signout`
- 금지 credential assignment 패턴: 0건
- 이메일·전화번호·주민번호 형태 PII 패턴: 0건
- PR #20 추가 diff의 `.skip`, `.todo`, `xit`, `xdescribe`: 0건
- `git diff --check`: EOF 형식 수정 후 PASS

## 금지사항과 남은 HOLD

- push/force-push 금지: 아직 원격 PR #20 head는 구 SHA다.
- PR merge 금지
- 006/007 migration 적용 금지
- Supabase/Production/Vercel 배포 금지
- partner/member write 금지
- T10이 최종 로컬 후보의 exact SHA를 독립 검증해 PASS하기 전 MWC는 원격을 갱신하지 않는다.
- 다음 소비자: MWC, T08, T09, T10
- 다음 WORK-ID: `PR20-POST-PR19-REBASE-VERIFY-01`
