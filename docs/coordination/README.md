# coordination — 트랙 조율 SSOT

여러 작업 세션(트랙)이 병렬로 moawork 를 만들 때 서로의 상태를 공유하기 위한 단일 진실 소스(SSOT).
사람이 읽고 트랙이 갱신한다. 커밋 시 항상 최신 상태를 유지한다.

## 파일

| 파일 | 역할 |
| --- | --- |
| `session-registry.yaml` | 활성/보류 트랙(세션) 목록 — 누가 무엇을 맡는지 |
| `provider-status.yaml` | 외부 연동/실행 주체(Supabase·먼데이·VPS 등) 상태 |
| `dispatch-queue.yaml` | 트랙 간 작업 분배 큐 (대기 / 진행 / 완료) |

## 규칙

- 각 파일 상단의 `updated` 날짜를 변경 시 갱신한다.
- 비밀값(키·토큰·비밀번호)은 이 문서들에 절대 기록하지 않는다.
- 트랙을 새로 시작하면 `session-registry.yaml` 에 등록하고, 맡은 일을 `dispatch-queue.yaml` 로 옮긴다.
- 상세 진행 내역은 [`../worklog.md`](../worklog.md) 에 append-only 로 남긴다.
