# ACCOUNT-C-IMPLEMENT-01 — DEV-2=T05 작업 소유권

- 상태: `IN_PROGRESS / DEV-2_TAKEOVER / VISUAL_APPROVAL_HOLD`
- 기준: `origin/main@639d629e9c09bba63415a96d0d7d46c653fb24ac`
- branch: `agent/account-c-screen`
- worktree: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\moawork-wt-account-c`
- 제품 입력: `ACCOUNT-C-PRODUCT-CONTRACT-01`
- 통합 입력: `ACCOUNT-C-INTEGRATION-GATE-01`
- 디자인 입력: `brand/MoaWork_Admin_Account_Design_4Concepts_v0.1.html`의 C `내 계정과 팀`

## writer takeover

- 2026-07-24 KST: MWC가 T01의 장시간 stuck fileChange 뒤 기존 writer lease를 회수하고 `DEV-2=T05`에 단독 이전했다.
- T01 task는 회수 메시지 수신 뒤 `idle`로 전환됐고, 추가 쓰기·활성 검증 프로세스·커밋이 없다고 종료 보고했다.
- 기존 materialized 파일은 재작성하지 않고 아래 actual 19개 변경 파일을 인수한다.

## 단일 writer와 파일 lease

DEV-2=T05는 이 worktree 안에서 아래 파일만 소유한다.

- `docs/implementation/ACCOUNT-C-IMPLEMENT-01.md`
- `app/src/components/account/**`
- `app/src/lib/account/**`
- `app/src/app/auth/signout/route.ts`
- `app/src/app/auth/signout/route.test.ts`
- `app/src/app/(app)/account/page.tsx` — canonical server redirect only
- `app/src/app/(app)/settings/account/**` — Safe Slice 실제 화면과 정직한 unavailable 상태
- `app/src/app/(app)/layout.tsx`의 `AccountMenu` 연결부
- 접근성 보완이 필요한 경우 `app/src/app/globals.css`의 focus/reduced-motion 규칙

`app/src/components/shell/nav-items.ts`, `docs/coordination/**`, `docs/worklog.md`, DB migration, 기존 멤버 관리 화면은 수정하지 않는다.

### 인수 시 actual 변경 파일 19개

- `app/src/app/(app)/layout.tsx`
- `app/src/app/(app)/account/page.tsx`
- `app/src/app/(app)/settings/account/page.tsx`
- `app/src/app/(app)/settings/account/loading.tsx`
- `app/src/app/(app)/settings/account/error.tsx`
- `app/src/app/(app)/settings/account/sessions/page.tsx`
- `app/src/app/(app)/settings/account/privacy/page.tsx`
- `app/src/app/auth/signout/route.ts`
- `app/src/app/auth/signout/route.test.ts`
- `app/src/components/account/AccountHub.tsx`
- `app/src/components/account/AccountHub.test.tsx`
- `app/src/components/account/AccountMenu.tsx`
- `app/src/components/account/AccountNav.tsx`
- `app/src/components/account/AccountState.tsx`
- `app/src/components/account/CurrentSessionLogout.tsx`
- `app/src/components/account/account.module.css`
- `app/src/lib/account/presentation.ts`
- `app/src/lib/account/presentation.test.ts`
- `docs/implementation/ACCOUNT-C-IMPLEMENT-01.md`

T08 early defect를 수용한다. Safe Slice에서 실제로 작동하는 계정 요약과 현재 기기 로그아웃만 행동 가능하다. 세션 목록·개인정보·Workspace write 등 미래 기능은 링크가 아닌 disabled/status UI로 표시하며 존재하지 않거나 P0가 막힌 route로 보내는 CTA는 0건이어야 한다.

## 구현 범위

현재 slice는 실제 `getSession()`이 제공하는 자기 사용자, 현재 Workspace, membership 표시와 현재 브라우저 로그아웃만 사용한다. 이메일은 서버에서 마스킹한 값만 UI에 전달한다. 팀·직책·다른 기기·모든 기기 로그아웃·개인정보 write·회사 관리 write는 서버/DB/RLS 계약이 없어 성공 상태를 만들지 않는다. Platform 1~4급, 지원 모드, 권한 계산식은 계정 UI에 넣지 않는다.

현재 `Ctx`가 Platform role을 membership role 위에 합성할 수 있으므로 `isPlatformAdmin=true`인 경우 계정 화면에서 대표·팀장·사원을 추정해 표시하지 않는다. P0 strict-app 계약 전에는 `회사 역할을 안전하게 확인하는 기능을 준비하고 있어요.`로 fail closed한다.

## route·integration 결정

- 결정: `ACCOUNT-C-MERGE-ORDER-ALT-01`의 대안 A.
- `/account`는 canonical 진입점이며 서버에서 `/settings/account` Safe route로 redirect한다. P0 cutover 전 방향을 바꾸지 않는다.
- 이번 변경은 current `main@639d629`에서 완성한다. T08 회귀·접근성 → T10 final SHA → 사용자 실화면 승인 전에는 merge하지 않는다.
- Account C가 먼저 merge된 뒤 PR #19가 새 main으로 rebase하고 `AccountMenu`를 보존한 상태에서 전체 gate를 다시 실행한다. PR #20은 그 새 #19 head를 따른다.
- PR #19의 migration·Workspace bootstrap 계약은 이번 branch로 가져오지 않는다.

## 수용·검증

- 전체 한글, 실제 세션 데이터, sample production 데이터 0건
- MoaWork semantic token만 사용하고 JSX/CSS에 새 hex literal 0건
- light/dark, 1280/390/320, keyboard, screen reader, reduced-motion
- 표시 변환·UI 계약·signout local scope 대상 테스트
- lint, typecheck, 대상 테스트, `scripts/check.sh`, production build
- T10 실화면·권한 검수와 사용자 승인 전 push/PR/merge/deploy 금지
