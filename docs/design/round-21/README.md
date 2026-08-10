# Round 21 Product Artifact Hub

이 디렉터리는 ROUND-21의 조사 결과를 채팅에서 제품 산출물로 귀속시키는 허브다.

## 완료 계약

각 세션은 지정된 파일 하나만 수정한다. final은 파일 경로와 핵심 변경, 검증 결과, 다음 소비자를 알리는 영수증으로만 사용한다.

| 세션 | 파일 lease | 산출물 유형 | 다음 소비자 |
|---|---|---|---|
| T01 | `01-first-value-concepts.md` | SPEC | T04 디자인 writer·사용자 역인터뷰 |
| T02 | `02-implementation-dag.md` | SPEC | DEV worktree 배정·PR/migration 순서 |
| T03 | `03-p0-authz-contract.md` | SPEC | DEV DB/RLS 구현·T10 공격 검수 |
| T05 | `05-daily-action-taxonomy.md` | SPEC | 오늘 홈 디자인·데이터 구현 |
| T06 | `06-small-team-growth.md` | SPEC | 팀 관리 4안·Invite 구현 |
| T07 | `07-safe-import-contract.md` | SPEC | Import 4안·ImportJob 구현 |
| T08 | `08-test-matrix.md` | REVIEW SPEC | T10 수용조건·시각 게이트 |
| T09 | `INDEX.md` | 허브 인덱스 | MWC·사용자·Claude 복귀 |

T04의 `VISUAL` 산출물은 기존 브랜드 HTML lease에 남고, T10은 독립 `REVIEW`를 담당한다.

## 모든 SPEC의 최소 내용

- 해결할 문제와 작은 조직의 사용자 가치
- 확정 결정, 추천 Draft, 미결정의 분리
- 화면·파일·데이터·상태 계약
- 실패·복구·보안·권한 경계
- 테스트와 수용조건
- 다음 소비자와 즉시 이어질 WORK-ID

조사 메모만 있고 다음 제품 행동을 열지 못하면 `NO_OUTPUT`이다.
