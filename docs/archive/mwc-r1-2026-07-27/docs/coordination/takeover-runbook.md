# 인수·복귀 런북 — Claude 전체 중단 ↔ Codex 비상관제

> **📄 이 문서는 무엇인가요?**
> - **한 줄 요약**: Claude 사용 한도가 통째로 끝났을 때 Codex가 5분 안에 이어받고, 복귀 시 안전하게 돌려주는 절차.
> - **누가 읽나요**: Codex-Failover-Control, Claude 디스패치, 운영자(belie)
> - **읽고 나면 알 수 있는 것**: 언제/누가/어떻게 지휘권을 넘기고 돌려받는가
> - **관련 문서**: coordination/README, provider-status.yaml, session-registry.yaml, AGENTS.md

## 전제

- 사용 한도는 **제공자 단위**로 소진된다 — Claude가 끝나면 디스패치·Cowork·전 코드 트랙·카페봇 세션이 함께 멈출 수 있다. 트랙별 토큰 상태를 만들지 않는다.
- 그래서 **checkpoint는 평상시에 쌓는다** (한도 종료 후엔 handoff를 쓸 손이 없다). 갱신 시점: 착수/중요 결정/원자 구현 완료/검사 성패/PR 오픈/리뷰 반영/머지 직전·직후/배포/블로커/사용자 결정 대기/세션 종료 전. 기록처: session-registry.yaml + 각 트랙 handoff 파일 + worklog.

## A. Claude 전체 중단 → Codex 인수

**트리거 (사용자 발화)**: "Claude 전체 사용 한도가 끝났어. 현재 진행 중인 Claude 작업을 전부 확인하고 필요한 Codex 트랙을 만들어 이어서 진행해."

**Codex-Failover-Control 절차** (목표: 5분 내 활성 작업 식별):

1. `provider-status.yaml`: `claude.status=exhausted`, `claude.active_controller=null`, `openai.active_controller=CODEX-FAILOVER-CONTROL` (근거 evidence 기록 — 같은 커밋).
2. 읽기 순서(5분 코스): coordination 3파일(README·registry·queue) → worklog 보드 → GitHub Open PR·최신 master → `git worktree list`.
3. **실제 활성 트랙만** 식별 — worktree 이름만 보고 활성으로 판단 금지, registry의 status+checkpoint와 GitHub 실측 대조. 완료·대기 트랙은 인수하지 않는다.
4. 기존 Claude writer를 registry에 `FROZEN_PROVIDER`로 기록 (트랙 상태는 보존).
5. checkpoint ↔ 실제 worktree(staged/unstaged/untracked) 대조. 어긋나면 실측 우선 + 어긋남을 registry에 기록.
6. **Claude worktree는 읽기 전용 보존** — 절대 수정·정리·삭제하지 않는다.
7. 이어받을 작업만 **Codex 전용 worktree**(`wt/codex-<slug>`, AGENTS.md 규약)를 origin/master 또는 해당 PR 브랜치에서 새로 만든다.
8. 트랙별 Codex writer 한 명 지정 → registry `writer_session` 갱신.
9. 인수 사실을 registry + worklog 맨 위에 기록.
10. 이후 작업은 기존 완료 기준 그대로: check.sh → 직렬 머지 → 배포 success + health 200 (CLAUDE.md §6.8).

## B. Claude 복귀

**트리거 (사용자 발화)**: "Claude 사용 한도가 초기화됐어. Codex 작업을 정리하고 Claude가 다시 받을 수 있게 해줘."

**처리 원칙**:

1. **빼앗지 않는다** — Codex가 거의 완료한 작업은 Codex가 마무리(머지·배포 관찰까지). 구현 중이면 원자 checkpoint 후 반환. 조사만 했으면 조사 결과+근거만 반환.
2. Claude 디스패치가 **독립 실측**(GitHub PR·master SHA·배포 상태·worktree)으로 checkpoint를 검증한다. 검증 전 writer 변경 금지.
3. 검증 후 registry에서 트랙별 writer를 Claude 세션으로 갱신 — **제공자 active 전환과 트랙 writer 반환은 별도 사건**으로 각각 기록.
4. `provider-status.yaml`: `claude.status=active`, `claude.active_controller=CLAUDE-DISPATCH`, `openai.active_controller=null` — Codex-Failover-Control은 STANDBY.
5. Codex 전용 worktree는 반환 완료 후에도 참고용 보존(정리는 별도 승인).

## 검증 (분기별 모의훈련 권장)

- 두 컨트롤러 동시 활성 불가 확인 / writer 1명 규칙 / file lease 무겹침 / Open PR↔registry 일치 / stale worktree 오인 없음 / 비밀값 없음 / 웹앱·카페봇 VPS 경로 분리(/opt/salespt-log vs /opt/bots/salespt-cafe-bot).
