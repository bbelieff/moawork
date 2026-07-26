# SYNC Round 22 — 산출물 없는 읽기 전용 작업 금지

> 작성: MoaWork Control(MWC) · 2026-07-24 KST

## 사용자 교정

- 세션이 실행된 뒤 채팅 답변만 남고 파일·화면·코드·검수 상태가 바뀌지 않는 작업은 유의미한 완료가 아니다.
- 모든 결과는 허브로 회수돼 제품의 설계, 구현, 검수 또는 사용자 결정에 실제로 사용돼야 한다.
- 결과가 준비되면 자동으로 다음 구현·검수에 들어가거나, 사용자가 볼 수 있는 화면·문서로 검사받아야 한다.

## 원인

ROUND-21에서 안전을 위해 `READ-ONLY`를 반복했지만, 원격·코드 write 금지와 산출물 생성 금지를 구분하지 않았다. 그 결과 T02처럼 원격 상태를 재확인하고도 결과가 채팅에만 남을 수 있는 잘못된 작업 정의가 생겼다.

## 교정 계약

1. `READ-ONLY` 단독 표기를 폐기하고 `REPO_READONLY / HUB_WRITE` 또는 `CODE_WRITE / WORKTREE_LEASE`로 구체화한다.
2. 모든 WORK-ID는 `SPEC / VISUAL / CODE / REVIEW` 중 하나 이상을 산출한다.
3. final은 산출물 경로와 검증, 다음 소비자를 알리는 영수증이며 산출물 자체가 아니다.
4. T09는 실제 파일·URL·PR·판정 존재를 확인하기 전 `DONE`으로 집계하지 않는다.
5. 산출물에 후속 WORK-ID와 소비자가 없으면 `NO_OUTPUT`으로 재작업한다.

## Round 21 허브

- 경로: `docs/design/round-21/`
- 세션별 단일 파일 lease는 해당 디렉터리의 `README.md`가 정본이다.
- 각 SPEC은 문제·결정·계약·실패·보안·테스트·다음 소비자를 포함한다.
- T09는 `INDEX.md`에 `산출물 → 제품 기능 → 다음 행동 → 사용자 검토/merge 상태`를 연결한다.

## 현재 작업 재정의

| 세션 | 기존 작업 | 필수 귀속 산출물 |
|---|---|---|
| T01 | 3분 시작 구조 탐색 | `01-first-value-concepts.md` |
| T02 | 구현 DAG 조사 | `02-implementation-dag.md` |
| T03 | P0 보안 계약 | `03-p0-authz-contract.md` |
| T05 | 오늘 행동 분류 | `05-daily-action-taxonomy.md` |
| T06 | 작은 팀 성장 | `06-small-team-growth.md` |
| T07 | 안전한 import | `07-safe-import-contract.md` |
| T08 | 검수 행렬 | `08-test-matrix.md` |
| T09 | 연속 회수 | `INDEX.md`와 다음 WORK-ID 실제 배정 |

T04는 기존 HTML이라는 VISUAL 산출물을, T10은 PASS/FAIL REVIEW를 이미 가진다.

## 다음 상태

- SPEC은 T09가 실재·내용을 확인한 뒤 T04 디자인 입력, 독립 DEV worktree 구현 입력 또는 T10 검수 입력으로 연결한다.
- 사용자가 봐야 하는 결과는 로컬 HTML이나 간결한 허브 인덱스로 공개한다.
- 코드·DB 변경은 기존 PR/migration 선행조건과 사용자 승인 게이트를 지킨다.
