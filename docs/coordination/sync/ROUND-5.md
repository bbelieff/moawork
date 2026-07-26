# SYNC Round 5 — 로그인 A안 구현·검수·PR 인계

> 작성: MoaWork Control(MWC) · 2026-07-23 KST
> 트리거: 사용자 로그인 A안 확정 및 실제 서비스 구현 지시
> 상세 이력: `docs/worklog.md`의 `로그인 A안 구현·독립 검수·Draft PR 인계`

## 1. 현재 컨트롤러와 provider

| 항목 | 상태 |
|---|---|
| active_controller | `codex : MoaWork Control(MWC)` |
| Claude provider | `exhausted / FROZEN_PROVIDER` |
| coordination writer | `MWC` 단독 |
| GitHub main | `639d629` |
| 열린 구현 PR | Draft PR `#18` |
| Production 반영 | 미실행 |

## 2. 확정 제품 결정

- 로그인 방향: `A · Open Workspace`.
- 데스크톱: 브랜드 스토리 / 로그인 약 `62:38`.
- 핵심 문구: `흐름은 단단하게, 방식은 자유롭게.`
- CTA·약관·보안 안내는 첫 viewport 안에 노출한다.
- 모바일·태블릿은 로그인 패널을 먼저 노출한다.
- 디자인 정본: 기획 워크스페이스 `brand/MoaWork_Login_Mockup_v0.1.html` A안.

## 3. 구현·writer·file lease

| 구분 | 값 |
|---|---|
| WORK-ID | `MW-LOGIN-A-20260723` |
| 관련 트랙 | `T03 Auth UI` 후속 |
| 구현 branch | `feat/login-a-workspace` |
| 구현 worktree | `moawork-wt-login-a` |
| 기준 SHA | `639d629` |
| 구현 commit | `9d79290` |
| T10 worktree | `moawork-wt-login-a-t10` detached |
| 코드 file lease | 종료·해제 |
| coordination lease | MWC 단독 활성 |

coordination 기록 branch는 `docs/login-a-handoff-round5`이며, 변경 범위는 `docs/worklog.md`와 이 `ROUND-5.md` 두 파일이다.

수정 범위는 로그인 UI 4파일이다. OAuth callback, session, Supabase, proxy, migration, worker는 변경하지 않았다.

## 4. 배분 결과와 운영 사건

- DEV 프롬프트와 T10 프롬프트를 별도 정본으로 작성해 배분했다.
- DEV 세션 3개가 모두 지침 확인 뒤 실제 쓰기 단계에서 지연되어 MWC가 writer를 회수했다.
- 회수 전 모든 DEV를 중단하고 clean worktree를 확인해 중복 writer와 부분 diff를 방지했다.
- 독립 T10은 별도 worktree에서 수행해 `PASS / MERGE CANDIDATE`를 판정했다.
- 이후 병렬화는 파일이 겹치지 않는 조사·구현·검증에 적용하고, 동일 파일 writer·공통 계약·병합은 직렬화한다.

## 5. 검증 근거

| 검증 | 결과 |
|---|---|
| `git diff --check` | PASS |
| `scripts/check.sh` | PASS |
| app tests | `472 passed / 5 skipped` |
| worker tests | `14 passed` |
| app production build | PASS |
| 1440×900 | 62:38, scroll 없음 |
| 1366×768 | CTA·약관·보안 안내 첫 viewport |
| 390×844 | 로그인 우선, 가로 overflow 없음 |
| error 상태 | alert + CTA 동시 노출 |
| T10 | `PASS / MERGE CANDIDATE` |
| coordination branch check | PASS — app 472/5 skipped, worker 14 |

## 6. PR·CI·배포

- Draft PR: [#18](https://github.com/bbelieff/moawork/pull/18)
- head/base: `9d79290` / `639d629`
- GitHub CI: PASS
- GitGuardian: PASS
- Vercel Preview: PASS / Ready
- main merge: 미실행
- Vercel Production: 미실행
- 실제 Google OAuth account chooser→callback→세션 지속: 미검증

## 7. 다음 게이트

1. 사용자에게 PR #18 병합 승인을 받는다.
2. 병합 직전 head/base·mergeability·필수 체크를 다시 확인한다.
3. 병합 후 main SHA와 Vercel Production 배포 SHA를 대조한다.
4. 공개 `/login`의 데스크톱·모바일·다크 렌더를 확인한다.
5. 사용자가 직접 Google 계정을 선택한 뒤 callback, `/` 진입, 새로고침 세션 지속을 검증한다.
6. 검증 결과를 새 WORKLOG 항목과 다음 `ROUND-N`에 기록한다.

## 8. Claude 복귀 HANDOFF

Claude가 복귀하면 다음 순서로 인수한다.

1. 이 `ROUND-5.md`를 최신 coordination 정본으로 읽는다.
2. `docs/worklog.md`의 로그인 A안 상세 항목을 읽는다.
3. GitHub `main`, Draft PR #18, 필수 체크, Vercel 상태를 live 재대조한다.
4. 사용자 병합 승인 여부를 확인한다.
5. 승인 전에는 PR을 병합하거나 Production을 변경하지 않는다.
6. 인수 확인 뒤 controller를 Claude로 전환하는 새 ROUND를 추가하고 MWC를 STANDBY로 전환한다.

## 9. 기록 규칙

- 이후 모든 의미 있는 작업은 배경, 기준 SHA, branch/worktree, writer/lease, 배분 프롬프트, 변경 파일, 명령과 결과, 실패·재시도, PR·CI·배포, 미검증, 다음 사용자 액션을 WORKLOG에 상세 기록한다.
- 요약만 남겨 Claude가 다시 조사하게 만들지 않는다.
- 비밀값·OAuth code·token·cookie·고객 데이터는 기록하지 않는다.
