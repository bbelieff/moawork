# SYNC Round 21 — 완료 자동 회수와 연속 작업 릴레이

> 작성: MoaWork Control(MWC) · 2026-07-24 KST

## 사용자 운영 결정

- T01~T10은 작업을 한 번 배정받고 끝나는 독립 섬이 아니라 하나의 실행 시스템처럼 움직인다.
- 각 세션의 final은 수집 담당이 자동 회수하고, 전체 계획과 선행조건에 맞는 다음 WORK-ID를 즉시 연결한다.
- MWC는 배정과 예외 판단에 집중한 뒤 빠르게 사용자 대화 가능 상태로 돌아온다.
- 단순히 유휴를 없애기 위해 임의 구현하거나 중복 작업을 만들지 않는다. 사용자 결정이나 writer lease가 필요한 곳은 `DECISION_GATE`로 멈춘다.

## 회수 완료

| 세션 | 회수한 결과 | 핵심 결론 |
|---|---|---|
| T01 | `FIRST-VALUE-INTERVIEW-01` | 혼자 시작 기본, 사원 기본·팀장 선택, 첫 고객+첫 업무, 화면 예시만, 건너뛰기 후 재개 |
| T02 | `SMALL-ORG-DEPENDENCY-02` | 실제 구현은 main→PR #19/006→PR #20/007→008+ 순서를 건너뛸 수 없음 |
| T05 | `DAILY-HOME-INTERVIEW-01` | 대표도 내 실무 우선, 결정 항목 최대 3개, 직원 순위·감시 대시보드 배제 |
| T09 | `NEXT-WAVE-COLLECTOR-02` | 다섯 사용자 결정과 3분 시작→오늘→팀 성장→데이터 이전 순서로 통합 |

## 현재 연속 배정

| 세션 | WORK-ID | 역할 | 쓰기 권한 |
|---|---|---|---|
| T01 | `FIRST-VALUE-CONCEPT-AXES-01` | 3분 시작의 구조적으로 다른 네 텍스트 와이어프레임 | READ-ONLY |
| T02 | `IMPLEMENTATION-CHAIN-01` | PR #19→#20→008+ 구현 DAG와 병렬/직렬 경계 | READ-ONLY |
| T03 | `P0-AUTHZ-CONTRACT-02` | Owner·Invite·Profile·Session·tenant P0 계약 | READ-ONLY |
| T04 | `SMALL-ORG-FIRST-01` | 현재 관리자·계정 HTML을 작은 조직 우선 4안으로 교정 | 기존 HTML lease만 |
| T05 | `DAILY-ACTION-TAXONOMY-01` | 오늘 홈의 최소 행동 분류와 데이터 원천 | READ-ONLY |
| T06 | `SMALL-TEAM-GROWTH-01` | 1~10명 초대·역할·업무인계·성장 흐름 | READ-ONLY |
| T07 | `SAFE-IMPORT-CONTRACT-01` | CSV·먼데이 dry-run·검증·취소·되돌리기 | READ-ONLY |
| T08 | `SMALL-ORG-TEST-MATRIX-01` | 네 핵심 흐름의 사용자·보안·시각 검수 행렬 | READ-ONLY |
| T09 | `CONTINUOUS-RELAY-01` | T01~T08 final 회수, 충돌 없는 다음 READ-ONLY 작업 자동 연결 | READ-ONLY 조정 |
| T10 | `SMALL-ORG-FIRST-VERIFY-01` | T04 산출물 독립 검수와 PASS/FAIL | READ-ONLY gate |

## 릴레이 규칙

```text
세션 final
→ T09 실제 회수
→ 전체 DAG·중복·선행조건 확인
→ 안전한 다음 READ-ONLY 작업 즉시 배정
→ 사용자 결정 또는 writer lease 필요 시 DECISION_GATE
→ MWC가 사용자 결정 반영
→ DEV writer 구현
→ T10 독립 검수
→ 로컬 시각 공개·전후 비교·퀴즈
→ 사용자 승인 뒤 PR/merge/deploy
```

## 사용자 결정 게이트

현재 통합된 다음 질문은 아래 다섯 가지다. 답 전에도 구조 탐색·계약·테스트 준비는 진행하지만 HTML 제품 구현과 DB write는 시작하지 않는다.

1. 혼자 시작을 기본으로 하고 같은 화면에서 팀원 초대 영역만 펼칠지.
2. 온보딩 역할을 사원 기본·팀장 선택으로 둘지.
3. 첫 고객과 실제 첫 업무를 원자적으로 함께 만들지.
4. 예시 데이터는 DB에 넣지 않고 화면 힌트로만 쓰며 선택 단계를 나중에 재개할지.
5. 오늘 홈은 조직 통계보다 `내가 지금 할 한 가지`를 우선할지.

## 정본과 변경 범위

- 운영프롬프트 §16.7에 연속 회수·릴레이 규칙을 영구 반영했다.
- 이번 라운드는 조정 문서와 읽기 전용 배정만 변경한다.
- T04가 보유한 현재 HTML 외 제품 코드·DB·PR·merge·배포는 변경하지 않는다.
