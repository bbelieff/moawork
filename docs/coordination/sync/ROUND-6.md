# SYNC Round 6 — 첫 가치 루프 PR-1 Workspace Bootstrap

> 작성: MoaWork Control(MWC) · 2026-07-23 KST
> 트리거: 사용자 `다음 계속 기획과 개발 해보자`
> 상세 근거: `docs/worklog.md`의 `첫 가치 루프 PR-1 Workspace Bootstrap`

## 1. controller·provider·GitHub

| 항목 | 상태 |
|---|---|
| active_controller | `codex : MoaWork Control(MWC)` |
| Claude provider | `exhausted / FROZEN_PROVIDER` |
| coordination writer | `MWC` 단독 |
| GitHub main | `639d629` |
| 열린 PR | Draft PR `#18` 로그인 A안, Draft PR `#19` Workspace Bootstrap |
| PR-1 code branch | `feat/workspace-bootstrap` |
| PR-1 code commit | `b28a5fa` |
| PR-1 GitHub | `#19`, mergeable, all checks PASS |
| Production 반영 | 미실행 |

## 2. 제품 우선순위

첫 가치 루프를 다음 순서로 닫는다.

1. PR-1: workspace bootstrap·entitlement·운영 onboarding.
2. PR-2: 요청별 인증 Supabase source·첫 업체/딜·`/newcust` 지속.
3. PR-3: 홈 대시보드 Supabase 실집계.

기획 정본: `brand/MoaWork_Workspace_Bootstrap_Plan_v1.0.md`.

## 3. PR-1 writer·lease

| 구분 | 값 |
|---|---|
| WORK-ID | `MW-WORKSPACE-BOOTSTRAP-20260723` |
| 관련 트랙 | T03 Auth/Org + T02 CRM foundation |
| base | `639d629` |
| branch | `feat/workspace-bootstrap` |
| worktree | `moawork-wt-workspace-bootstrap` |
| 구현 commit | `b28a5fa` |
| 변경 | 11 files, +922/-38 |
| code lease | 구현·재수정 종료 |
| T10 | `PASS / MERGE CANDIDATE` |

PR #18의 login UI 4파일과 겹치지 않는다. 기존 001~005 migration은 수정하지 않았다.

## 4. 구현 계약

- owner-only `bootstrap_workspace(uuid)`와 조직별 advisory lock.
- 현재 plan entitlement backfill·조건부 갱신. manual/addon/trial 보존.
- 기본 pipeline 1개와 6 stage kind 멱등 생성.
- 신규 owner는 bootstrap 뒤 onboarding, 기존 owner도 self-heal, member-only는 비호출.
- Supabase onboarding은 실제 조직명 영속, Local fallback 유지.
- layout/FeatureGate는 Supabase entitlement를 읽고 오류를 잠김으로 가장하지 않는다.

## 5. T10 이력

1차 `FAIL / RETURN TO DEV`:

1. 다중 membership owner bootstrap 누락.
2. 기존 plan-source entitlement stale 상태 보존.

수정 후 재판정 `PASS / MERGE CANDIDATE`.

비차단 P2: bootstrap 성공 뒤 rename 실패 시 기본 구조가 먼저 남을 수 있으나 멱등 재시도로 복구된다. 단일 원자 RPC는 후속 후보다.

## 6. 검증

| 검증 | 결과 |
|---|---|
| `git diff --check` | PASS |
| 신규 대상 테스트 | 4 files / 15 PASS |
| 반려 수정 회귀 | 2 files / 8 PASS |
| app 전체 | 41 files, 487 PASS / 5 RLS skip |
| worker 전체 | 3 files, 14 PASS |
| Next production build | PASS, 22 static pages |
| 민감값 scan | 0건 |

환경 사건:

- sandbox npm cache EPERM → 허용 경로 `npm ci --ignore-scripts` PASS.
- Windows PATH bash 없음 → Git Bash 절대경로로 full gate PASS.
- 기존 npm audit 8건은 범위 밖이라 force fix하지 않음.

## 7. 운영 게이트

현재 원격 상태:

- Draft PR [#19](https://github.com/bbelieff/moawork/pull/19), head/base `b28a5fa` / `639d629`.
- GitHub CI PASS(57초), GitGuardian PASS, Vercel Preview Ready, Preview Comments PASS.
- main merge와 Production은 미실행.

필수 순서:

1. code branch를 Draft PR로 게시하고 CI/Preview를 확인한다.
2. merge 전 최신 main 위에서 재검증한다.
3. Production DB에 006 migration을 먼저 적용한다.
4. 실DB owner 허용/member 거부/반복·동시 호출/backfill을 확인한다.
5. 그 뒤 앱을 배포한다.
6. 실제 Google OAuth→onboarding→조직명 저장→재로그인을 확인한다.

앱을 migration보다 먼저 배포하지 않는다. rollback은 우선 앱만 이전 버전으로 되돌리고 006 additive 데이터를 보존한다.

## 8. Claude 복귀 HANDOFF

Claude 복귀 시:

1. 이 ROUND-6 → 최신 WORKLOG PR-1 항목 → commit `b28a5fa` diff 순서로 읽는다.
2. GitHub main, PR #18, `feat/workspace-bootstrap` 원격/PR 여부를 live 재대조한다.
3. PR-1의 migration-before-app 게이트를 보존한다.
4. 미실행 실DB·Production 항목을 완료로 간주하지 않는다.
5. controller 승계를 새 ROUND에 기록한 뒤 MWC를 STANDBY로 전환한다.
