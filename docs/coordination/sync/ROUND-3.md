# SYNC Round 3 — MWC 지침 정합화와 OAuth 운영 검증 계속

> 작성: MoaWork Control(MWC) · 2026-07-23 KST
> 트리거: 운영 프롬프트 적용 및 canonical `AGENTS.md`의 폐기 YAML 지침 정합화.

## 컨트롤러

| 항목 | 상태 |
|---|---|
| active_controller | `codex : MoaWork Control(MWC)` |
| claude provider | `exhausted / FROZEN_PROVIDER` |
| codex provider | `active` |
| 동시 활성 컨트롤러 | 1 |

## 최신 대조 결과

- 코드 정본과 원격: `bbelieff/moawork`.
- GitHub `main`: `c1e8ffd89484ab2e45321d4770c1e7a2c5f150e3`(PR #15 병합).
- 열린 PR: 0건.
- 로컬 canonical `main`: `e774a45`로 원격보다 1커밋 뒤. 공유 checkout은 갱신·수정하지 않았다.
- 최신 coordination 정본은 이 `ROUND-3.md`이며, 기존 `ROUND-1.md`와 `ROUND-2.md`는 이력으로 보존한다.

## documentation drift 판정

기존 루트 `AGENTS.md`는 신규 트랙을 폐기된 `session-registry.yaml`에 등록하고 작업을
`dispatch-queue.yaml`로 이동하라고 요구했다. 이는 `CLAUDE.md`, `docs/coordination/README.md`,
`ROUND-1.md` 이후의 Markdown 라운드 정본 규칙과 충돌한다.

조치:

1. 폐기 YAML 등록 지시를 제거하고 다시 만들지 않는다고 명시한다.
2. T01~T10은 역사적 작업·요구사항·검수 식별자로 유지한다.
3. 실제 Codex 구현은 필요할 때만 범용 DEV-1~3 전용 worktree로 배정한다.
4. T10을 독립 검수·merge gate로 유지한다.
5. 저장소 식별, 최신 GitHub 대조, 단일 writer·file lease, `wip/*` 보존 규칙을 루트 지침에 반영한다.
6. 코드 완료와 OAuth·Vercel·Supabase 운영 완료를 분리해 판정한다.

## 이번 작업의 writer와 lease

| 작업 | writer | branch / worktree | file lease |
|---|---|---|---|
| 지침 정합화 | MWC | `docs/mwc-agents-round3` / 독립 문서 worktree | `AGENTS.md`, `docs/worklog.md`, `docs/coordination/sync/ROUND-3.md` |
| 검수 | T10 역할의 MWC 자체 검토 | 동일 branch, 변경 작성 후 별도 diff·게이트 판정 | 판정만 |

별도 DEV 작업은 생성하지 않는다. 변경 파일이 3개뿐인 단일 문서 정합화 작업이며, 병렬화 이익보다
writer 충돌 위험이 크다.

## OAuth 운영 상태

- PR #15는 `main`에 병합됐다.
- Vercel Production/Preview에 필요한 Supabase 공개 환경변수 2종을 설정했고 새 Production 배포가 `Ready`가 됐다.
- 공개 `https://www.moa-work.com/login`에서 Google CTA와 Google 계정 선택 화면 진입까지 확인했다.
- 사용자 계정 선택 이후 callback, 세션 유지, owner·플랫폼 관리자 권한은 사용자 로그인 완료 후 검증 대기다.
- 비밀값은 저장소·coordination 문서에 기록하지 않는다.

## 완료 조건

1. `AGENTS.md`가 최신 ROUND 체계와 충돌하지 않는다.
2. 폐기 YAML을 참조하는 활성 지침이 제거된다.
3. diff에서 무관한 파일 변경·문서 삭제가 없다.
4. `scripts/check.sh`와 PR CI가 통과한다.
5. 정식 PR을 거쳐 `main` 반영 여부를 확인한다.
6. OAuth 최종 운영 판정은 사용자 로그인 완료 후 별도 기록한다.
