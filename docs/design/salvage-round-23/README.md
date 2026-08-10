# Round 23 Historical Answer Salvage

MoaWork MWC·T01~T10의 과거 답변, 보류안, FAIL 패킷, 선택되지 않은 디자인에서 현재 제품에 아직 흡수되지 않은 가치를 회수한다.

## 원칙

- 과거 답변을 그대로 복사하지 않는다. 현재 `ROUND-22`와 `docs/design/round-21/`을 먼저 읽고 차이만 남긴다.
- 모든 회수 항목은 출처 thread/turn 또는 WORK-ID/ROUND, 현재 공백, 회수 가치, 충돌, 삽입 대상, 다음 WORK-ID를 가진다.
- 비밀값·PII·실제 고객 데이터는 옮기지 않는다.
- 폐기된 YAML coordination, Platform Admin 자동 Owner, broad users_select, 일반 RPC의 Owner 변경 등 현재 불변식과 충돌하는 안은 되살리지 않고 `REJECTED_KEEP`로 이유만 보존한다.

## 분류

| 상태 | 의미 |
|---|---|
| `RECOVER_NOW` | 현재 SPEC/VISUAL/CODE/REVIEW에 바로 흡수할 가치가 있음 |
| `EXPERIMENT` | 작은 검증이나 4안 비교가 먼저 필요 |
| `BACKLOG` | 가치가 있으나 현재 선행조건·우선순위 뒤 |
| `REJECTED_KEEP` | 다시 제안하지 않도록 기각 이유를 보존 |
| `DUPLICATE` | 현재 허브에 이미 완전히 반영됨 |
| `OBSOLETE` | 사실·구조·브랜치가 낡아 재사용 불가 |

## 파일 lease

| 소유 | 파일 |
|---|---|
| T01 | `T01.md` |
| T02 | `T02.md` |
| T03 | `T03.md` |
| T04 | `T04.md` |
| T05 | `T05.md` |
| T07 | `T07.md` |
| T08 | `T08.md` |
| T10 | `T10.md` |
| T09 | `T06.md`, `MWC.md`, `INDEX.md` |

T06은 현재 세션 오류 상태라 T09가 thread history를 읽어 대신 수거한다. T09는 실제 파일을 읽고 중복 제거한 뒤 `INDEX.md`에 `회수 항목 → 현재 제품 삽입 위치 → 다음 소비자 → 상태`를 연결한다.

## 완료 게이트

- 출처 없는 아이디어는 회수하지 않는다.
- 현재 허브와 차이가 없는 항목은 `DUPLICATE`다.
- 삽입 위치나 다음 소비자가 없으면 `NO_OUTPUT`이다.
- 사용자가 볼 변화가 필요한 항목은 VISUAL 후보로, 코드 변경이 필요한 항목은 DEV writer gate로, 안전 문제는 T10 검수 입력으로 연결한다.
