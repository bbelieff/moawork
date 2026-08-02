# SYNC Round 34 — Linear 운영판 루틴과 coordination writer 승계

> 작성: MWC coordination sole writer · 2026-08-03 KST
> 기준 GitHub `main`: `2c126f23550d1031ff486c73cdaae9865cd0c06e`
> 열린 PR: `0` (GitHub connector 재검증)
> 직전 정본: `ROUND-33.md`
> 현재 판정: `COORDINATION_ONLY / LINEAR_CONTROL_PLANE_ACTIVE / PRODUCT_LEASE_NONE`

## 1. writer 승계와 경계

- 사용자가 2026-08-03 KST에 MWC를 coordination sole writer로 명시 승인했다.
- 이 승계는 `docs/coordination/**`와 append-only `docs/worklog.md`의 coordination 기록만 허용한다.
- 제품 코드, migration, hosted DB, 배포, Linear 이슈 상태·담당자·관계 변경 권한을 자동으로 부여하지 않는다.
- 현재 feature owner, implementation reviewer, 제품 file lease는 없다. 번호나 세션 식별자에서 역할을 추론하지 않는다.
- 다른 coordination writer는 동시에 활동하지 않는다. 다음 승계는 새 Round에 명시해야 한다.

## 2. Linear와 GitHub의 정본 경계

- Linear 팀: `Bbelieff` (`4145d122-d0b8-423a-8abe-73443f62b3b4`).
- Linear 프로젝트: `MoaWork · 운영 안정화 및 어드민` (`20e7779b-19d7-42cb-91c6-3b68841b19ca`).
- Linear는 작업 점유, 의존성, 검토, 이정표와 출시 상태의 운영판이다.
- GitHub `main`, PR, CI와 exact SHA는 기술 정본이다. Linear 기록만으로 merge·deploy·live PASS를 주장하지 않는다.

## 3. 모든 세션의 작업 루틴

1. 작업 또는 결함을 발견하면 Linear에서 중복 이슈를 먼저 검색한다.
2. 기존 이슈가 있으면 새 카드를 만들지 않고 그 이슈의 하위 실행 단위로 연결한다. 없으면 지정 프로젝트에 Todo 이슈 후보를 기록한다.
3. 구현 전 이슈 또는 승인된 실행 계약에 다음을 모두 명시한다: `task_id`(Linear ID 포함), base SHA, 전용 branch/worktree, owner, file lease, reviewer, `blocked_by`, acceptance criteria, hosted/auth `NOT_RUN` 경계.
4. 위 필드와 명시적 lease가 없으면 조사·초안만 허용하며 코드·문서·Git·외부 시스템을 변경하지 않는다.
5. 착수 시 Linear의 프로젝트 이정표와 의존성을 읽고 START receipt를 남긴다. 진행 중에는 PR·CI·검증 receipt를 누적한다.
6. Done 승격은 acceptance criteria, GitHub 기술 증거, 독립 검토와 명시된 live 경계를 모두 대조한 뒤에만 한다. `NOT_RUN`은 PASS로 바꾸지 않는다.
7. 선행 카드가 완료되지 않았으면 다음 카드를 임의 착수하지 않는다.
8. Linear 상태·담당자·관계·이정표 생성 또는 변경은 해당 작업 계약이나 사용자 승인 범위에서만 수행한다.

## 4. 현재 운영판과 BBE-5

- 작업목록은 `BBE-5`~`BBE-10`이며 모두 기존 Todo 상태를 보존한다.
- 첫 카드 `BBE-5`를 완료하기 전 `BBE-6`으로 임의 승격하지 않는다.
- `BBE-5` 실제 브라우저 관찰에서 `/mode?next=%2F`의 두 선택 항목은 DOM button으로 존재하지만 class, 배경, 테두리, padding과 pointer cursor가 없어 일반 텍스트처럼 보였다.
- 판정: `BBE-5 MODE CHOICE UI = FAIL / IMPLEMENTATION BLOCKED_NO_LEASE`.
- 제안 실행 단위 `BBE-5-MODE-CHOOSER-UI-FIX-01`은 아직 제품 lease가 아니다. 별도 owner, reviewer, branch/worktree와 file lease 승인 전 구현하지 않는다.
- 실제 Google 로그인, `/mode`, `/platform`, 사용자 workspace 복귀, 일반 사용자 접근 차단, 모바일·콘솔 QA는 완료 증거가 아니라 남은 live QA 범위다.
- hosted migrations `017/020/021/022` 적용 상태와 Production SHA binding은 `NOT_RUN / 미검증`이다.

## 5. next action

- `NEXT_WORK`: BBE-5의 구현 또는 verification 계약을 명시적으로 발행할 때까지 `NONE`.
- 다음 계약은 Linear ID, exact base SHA, 전용 branch/worktree, owner, file lease, reviewer, `blocked_by`, acceptance criteria를 빠짐없이 포함한다.
- 제품 코드, Linear 상태, hosted 환경은 이번 Round에서 변경하지 않았다.
