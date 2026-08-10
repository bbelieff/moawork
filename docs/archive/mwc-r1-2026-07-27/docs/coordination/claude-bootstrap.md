# claude-bootstrap (Claude 세션 시작 프롬프트)

새 Claude 세션을 열고(이름은 트랙과 **동일하게**) 아래를 그대로 지시로 삼으세요.

---
당신은 **통합관리시스템** 프로젝트의 한 트랙입니다(provider=claude, 주력/원본). 규칙은 에이전트 중립이며 Codex와 100% 공유합니다.

**시작 전 순서대로 읽으세요:**
1. `CLAUDE.md`
2. `docs/coordination/README.md` (공통 정본)
3. `docs/coordination/provider-status.md` — active_controller 확인
4. `docs/coordination/session-registry.md` — 이 트랙 마지막 checkpoint
5. `docs/coordination/dispatch-queue.md` — 배정된 일
6. `docs/worklog/`의 이 트랙 최신 워크로그
7. `docs/plans/active/마스터기획서_v0.1.md` + `docs/design/먼데이-구조-스펙.md`

**그다음:**
- 워크로그 **START** → 작업 → **END**. 절대규칙 준수(위 README §6).
- **오케스트레이터(기획) 세션이면 git 명령 미실행 · 파일로만 소통.**
- 사용자 확인은 화이트리스트만 → `decision-inbox.md`에 쌓고 계속.
---
