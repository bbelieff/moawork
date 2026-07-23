# SYNC Round 2 — Codex 비상관제 인수

> 작성: Codex-Failover-Control 2026-07-23 09:15 KST
> 트리거: belie가 Claude 주간 사용량 소진을 확인하고 "인수해서 진행해"라고 명시 승인.

## 컨트롤러

| 항목 | 상태 |
|---|---|
| active_controller | `codex : CODEX-FAILOVER-CONTROL` |
| claude provider | `exhausted / FROZEN_PROVIDER` |
| codex provider | `active` |
| 동시 활성 컨트롤러 | 1 |

Claude 작업트리와 `wip/*` 브랜치는 읽기 전용으로 보존한다. Claude 복귀 전까지 writer를 되돌리지 않는다.

## 인수 전 실측

- GitHub main: `613cc67ea7df6ded6c22be7db4c0f315b9741a24`
- 열린 PR: 0건
- 기존 머지큐: 8 PR 전량 머지, 마지막 기록상 main 스모크 `PASS=20 / FAIL=0 / SKIP=0`
- 인수 대상 보존 브랜치: `origin/wip/t03-oauth`
- 보존 브랜치 상태: OAuth 플러밍 10파일, main 머지 금지, 선언되지 않은 의존성으로 타입체크 실패 기록
- 기존 기획 작업본 `서울리드프로젝트/모아워크`: 원격·커밋 없는 별도 작업본이므로 코드 writer로 사용하지 않음
- canonical 클론: `서울리드프로젝트/moawork-canonical`

## 활성 트랙

| 트랙 | provider / writer | 상태 | 작업 | 브랜치·worktree | file lease |
|---|---|---|---|---|---|
| T03 | codex / `Codex-T03-OAuth` | `takeover_in_progress` | B1b 구글 OAuth 완성 | `feat/codex-t03-oauth` / `wt/codex-t03-oauth` | `app/package*.json`, `app/src/app/(auth)/**`, `app/src/app/auth/**`, `app/src/lib/auth/**`, `app/src/lib/supabase/**`, `app/src/proxy.ts`, 관련 테스트 |
| T10 | codex / `Codex-Failover-Control` | `verify_after_t03` | 정적검사·check·프로덕션 build·OAuth 라이브 판정 | 검증만 | `docs/coordination/T10-gate-checklist.md`(판정 시) |

T02·T04·T05는 이전 라운드 상태를 보존하되 이번 인수에서 새 작업을 배정하지 않는다. T01·T06·T07·T09는 휴면, T08은 미생성 상태를 유지한다.

## 수용 기준

1. 구글 로그인 CTA가 Supabase OAuth로 연결된다.
2. `/auth/callback`에서 코드를 세션으로 교환하고 안전한 내부 경로로 리다이렉트한다.
3. 최초 로그인 시 조직 멤버십과 `app_admin_role()` 기반 플랫폼 관리자 권한을 배선한다.
4. 프로덕션에서 dev-session 로그인과 역할 토글이 노출되지 않는다.
5. 비밀값은 커밋하지 않고 환경변수 이름만 사용한다.
6. `scripts/check.sh`와 프로덕션 빌드가 통과한다.
7. 정식 PR·T10 판정·main 머지·배포 확인 후 종료한다.

## 수정 금지

- `origin/wip/t03-oauth` 직접 수정·강제푸시·머지
- 기존 Claude worktree 정리·삭제
- 스키마 001~005 수정
- T02 보드, T05 커스텀필드, T09 정산 영역 변경
- 실제 키·토큰·비밀번호·연결문자열 기록

