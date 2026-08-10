# session-registry (세션 레지스트리)

> **세션은 소모품, 트랙이 정체성.** 같은 이름의 세션을 Claude/Codex 양쪽에서 열 수 있다. 각 트랙의 **마지막 checkpoint**를 상시 기록(한도 종료는 예고 없이 온다).
> checkpoint 시점: 착수·결정·구현·검사·PR·머지 전후·배포·블로커·종료 전.

> **⚑ 2026-07-22 기획 세션 통합(belie 지시):** 기획1(오케스트레이터)+기획2(기획-Cowork) → **단일 `기획(통합)` 세션**으로 합침. 기획 정본도 `마스터기획서_v1.0.md` 하나로 병합. 앞으로 기획 계열 writer는 1개만 활성. (아래 통합행이 정본, 구 2행은 이력으로 취소선 보존)

| 세션명(트랙) | provider | 상태 | 브랜치/worktree | 마지막 checkpoint | 워크로그 |
|---|---|---|---|---|---|
| **기획(통합) = OWNER 허브** | claude | active | — (문서만·사용자 유일창구) | 2026-07-22: 기획1+2 병합→v1.0, 구글 OAuth, **돌랑 허브앤스포크 운영모델 v1 채택** | `docs/worklog.md`(정본) |
| **사업기획 분석 허브** (구 기획2 재활용) | claude/서브에이전트 | 신설·대기 | — (`docs/analysis/*`만) | 2026-07-22: 「사업기획 분석」 도메인 허브로 재활용 결정(운영모델 v1 §3) | `docs/analysis/`(예정) |
| ~~기획(오케스트레이터)~~ | ~~claude~~ | **merged→기획(통합)** | — | (이력) 2026-07-21: PLAN-v0.2+001 스키마+track-prompts 4종 | `worklog/2026-07-21_기획.md` |
| ~~기획-Cowork(belie 메인채팅)~~ | ~~claude~~ | **merged→기획(통합)** | — | (이력) 2026-07-21: 로컬 백엔드 코어 lib/** 구현·검증, D15 반영, 사건감사 | `worklog/2026-07-21_cowork-local-backend.md` |
| track-01 | codex | ready_for_handoff (Day-0 기반; 구 'track-07' 재귀속) | `chore/day0-harness` / 초기 저장소 checkout | 2026-07-21 02:18: check·pre-commit PASS, 원격 unknown | `worklog/2026-07-21_track-07.md` (구 파일명) |
| track-02 | — | 미개시 | — | — | — |
| track-03 | — | 미개시 | — | — | — |
| track-04 | — | 미개시 | — | — | — |
| track-05 | — | 미개시 | — | — | — |
| track-06 | — | 미개시 | — | — | — |
| track-07 | — | 미개시 | — | mod.perf 성과·인센티브 (Day-0 기반작업은 T01로 이관) | — |
| track-08 | — | 미개시 | — | — | — |
| track-09 | — | 미개시 | — | — | — |
| track-10(게이트키퍼) | — | 미개시 | — | — | — |

## 기록 규칙
- 트랙을 열면 이 표의 해당 행을 갱신(provider·상태·checkpoint·워크로그 경로).
- 인수 시 **provider만 바꾸고 이력은 남긴다**(누가 언제 인수했는지 한 줄).
