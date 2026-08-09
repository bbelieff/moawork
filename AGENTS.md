# AGENTS.md — moawork

이 문서는 `bbelieff/moawork`에서 작업하는 Claude·Codex 에이전트의 저장소 공통 규칙이다.
트랙 상태·controller·writer·file lease의 현재값은 이 문서에 고정하지 않고 최신 coordination 라운드에서 확인한다.

## 1. 정본과 작업 전 확인

- 코드 정본은 GitHub `bbelieff/moawork`다.
- `서울리드프로젝트/모아워크` 등 이름이 비슷한 로컬 폴더는 기획·과거 작업본일 수 있으므로 코드 정본으로 간주하지 않는다.
- 작업 전 `git rev-parse --show-toplevel`, remote, branch, status, worktree와 GitHub `main`·열린 PR을 독립 대조한다.
- 로컬 `main`이나 보고서의 SHA를 최신으로 가정하지 않는다. 확인하지 못한 값은 `unknown` 또는 `미검증`으로 기록한다.
- 다음 순서로 지침을 읽는다: `CLAUDE.md` → `AGENTS.md` → 가장 번호가 큰 `docs/coordination/sync/ROUND-N.md` → **자기 PLAN**(`docs/plans/PLAN-00N.md` 의 담당 WO 카드).
  그 다음은 필요할 때만: 검수자면 `docs/plans/qa-gate.md`, 착수 세션이면 `docs/playbooks/worker-onboarding.md`.
  **진행 상태·과거 이력은 저장소가 아니라 Linear 에서 확인한다.** `docs/archive/**` 는 동결 기록이므로 의무 읽기 대상이 아니다.

## 2. 조정 정본과 역할

- 트랙 상태와 승계 규칙의 정본은 최신 `docs/coordination/sync/ROUND-N.md`다. 새 라운드는 번호를 증가시켜 추가하고 이전 라운드를 덮어쓰지 않는다.
- `session-registry.yaml`, `dispatch-queue.yaml`, `provider-status.yaml`은 SYNC-R1에서 폐기됐다. 과거 문서가 요구하더라도 다시 만들거나 조정 정본으로 사용하지 않는다.
- **진행 기록은 Linear 이슈 코멘트로 남긴다**(START/END). 양식은 결과·파일·게이트·NOT_RUN·소비자를 그대로 유지한다.
  **END 코멘트가 없는 작업에는 다음 배정을 내리지 않는다.** 기존 코멘트를 수정하지 않고 추가만 한다.
  `docs/worklog.md`는 2026-08-05 동결돼 `docs/archive/worklog.md`로 이동했다 — 열람만 하고 새 기록을 추가하지 않는다.
- coordination writer는 동시에 한 명만 둔다. 구현 작업자는 `docs/coordination/**`를 직접 수정하지 않는다.
- 검수 기준의 정본은 `docs/plans/qa-gate.md`다. 판정 **결과**는 이 문서가 아니라 해당 Linear 이슈 코멘트에 수치로 남긴다.
  과거 판정 이력은 `docs/archive/T10-gate-checklist-history.md`에 동결 보존돼 있다.
- **Linear 유실 대비**: 이슈를 정기적으로(월 1회 이상) export 해 보관하고, **규칙·핵심 결정은 최신 ROUND 에도 1줄** 남긴다.
- T01~T10은 역사적 작업·요구사항·검수 식별자로 유지한다. T번호를 에이전트 세션 수나 고정된 Codex 작업자 이름으로 해석하지 않는다.
- Codex 구현이 필요할 때만 범용 `DEV-1`~`DEV-3` 작업을 최소 개수로 만든다. 각 작업에는 관련 T번호, 기준 GitHub `main` SHA, 전용 branch/worktree, feature owner와 file lease를 명시한다.
- T10은 구현 트랙이 아니라 독립 검수·merge gate 역할을 우선한다. 가능한 경우 기능 작성자와 검수자를 분리한다.

## 3. Git·worktree 안전

- 공유 checkout에서 코드 작업하지 않는다. 실제 구현은 최신 `origin/main`에서 만든 전용 worktree에서 수행한다.
- 하나의 파일에는 한 명의 활성 writer만 둔다. 다른 작업자의 미커밋·미추적 파일을 수정·stage·삭제하지 않는다.
- 다른 작업자의 branch를 checkout, rebase, force-push, reset, clean, delete하지 않는다. `wt/` 같은 worktree 컨테이너도 stage·commit하지 않는다.
- `wip/*`는 유실 방지용 보존 브랜치다. 직접 수정하거나 `main`에 병합하지 않으며, 최신 정본 위의 새 feature branch에서 정식 게이트와 PR을 통과한 경우에만 승격한다.
- Supabase 스키마 변경은 새 migration으로만 추가하고 기존 migration은 수정하지 않는다.

## 4. 변경·검수·운영 경계

- 코드 경로(`app/`, `worker/`, `supabase/`, `scripts/`, 루트 설정)는 feature branch + PR + T10 검수를 거친다.
- `docs/coordination/**` 문서는 활성 controller가 단독 관리한다. 커밋 전 `git diff --stat`과 삭제 행을 확인하고 의도하지 않은 축약·삭제가 있으면 중단한다.
- `docs/archive/**`는 동결 기록이다. 수정·추가·삭제하지 않는다(열람 전용).
- 커밋 전 `bash scripts/check.sh`를 통과한다. 필요한 경우 production build, DB/RLS, PR CI와 공개 서비스의 핵심 사용자 흐름까지 독립 검증한다.
- 코드 완료와 운영 완료를 구분한다. OAuth·Supabase·Vercel·외부 API는 환경변수 존재, provider 설정, callback, 실제 브라우저 흐름을 각각 확인한다.
- 사용자 로그인·동의·계정 선택이 필요한 단계는 대신 진행하지 않는다.
- 키·토큰·쿠키·비밀번호·OAuth 코드·연결 문자열·실제 고객 데이터는 출력·문서화·커밋하지 않는다. 설정 여부와 변수명만 기록한다.

## 5. 개발 명령

```bash
npm install
npm run dev
bash scripts/check.sh
```
