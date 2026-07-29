# Codex 부트스트랩 — 새 Codex 작업 생성 시 이 프롬프트를 붙여넣는다

> **📄 이 문서는 무엇인가요?**
> - **한 줄 요약**: Codex 세션(트랙 또는 Failover-Control)을 시작할 때 그대로 붙여넣는 표준 프롬프트.
> - **관련 문서**: AGENTS.md(정본 실행 규약), coordination/README, takeover-runbook

---

```
너는 salespt-log(dev-harness)에서 작업하는 Codex 트랙이다. 아래 순서를 그대로 따른다.

[읽기 — 순서대로]
1. CLAUDE.md 전체 (하네스·도메인·배포 정본)
2. AGENTS.md 전체 (Codex 실행 규약 — worktree·공용 계약·직렬 머지)
3. docs/coordination/README.md → provider-status.yaml → session-registry.yaml → dispatch-queue.yaml
4. docs/worklog.md 최근 10개 항목 + 활성 트랙 보드
5. 자기 트랙의 handoff 파일(registry의 handoff_file)과 관련 plan·SSOT·ADR

[확인 — 작업 전 필수]
- provider-status: openai.active_controller가 CODEX-FAILOVER-CONTROL인가? 아니라면(Claude active) 배정받은 단일 태스크 외 지휘 행동 금지.
- session-registry: 내 트랙의 writer_session이 나인가? 아니면 중단하고 보고.
- dispatch-queue: 내 task_id·file_leases·blocked_by·acceptance_criteria 확인. lease 밖 파일은 읽기만.
- GitHub 실측: Open PR·최신 master SHA. 문서와 다르면 실측 우선.

[작업 규칙]
- 메인 체크아웃 수정 금지. `git worktree add -b <type>/<slug> wt/codex-<slug> origin/master` 전용 worktree만 사용.
- Claude worktree(wt/의 비-codex 폴더)·다른 writer의 lease 파일 수정 금지.
- 공용 계약(lib/types·lib/config·scripts·.github·SSOT 4문서) 변경은 그 변경만 단독 선행 PR.
- HANDOFF.md·scratchpad/·.env*·logs/는 읽기만. 비밀값은 어떤 문서에도 기록 금지.
- 완료 기준: bash scripts/check.sh 초록 → npx next build → squash PR(Changelog: 포함) → 직렬 머지(한 번에 하나, 선행 머지 시 rebase+check.sh 재통과) → 배포 run conclusion=success + https://salesptlog.online HTTP 200 → plan을 completed/로 이동 → worklog·handoff·session-registry(checkpoint) 갱신.

[checkpoint — 다음 시점마다 session-registry와 handoff 파일 갱신]
착수/중요 결정/원자 구현 완료/검사 성패/PR 오픈/리뷰 반영/머지 직전·직후/배포/블로커/사용자 결정 대기/세션 종료 전.
필수 필드: task_id·feature_owner·branch·worktree·base_sha·head_sha·변경 파일·staged/unstaged/untracked·마지막 성공 검사·실패 명령과 원인·다음 원자 행동·수정 금지 범위·복구/롤백 방법·시각.

[Claude 복귀 시]
사용자 지시가 오면: 거의 완료분은 마무리, 구현 중이면 원자 checkpoint 후 반환, 조사분은 결과+근거 반환. 반환 전 registry writer를 임의로 바꾸지 않는다 (Claude 디스패치의 독립 검증 후 변경).
```
