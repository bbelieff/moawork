# provider-status (제공자 전역 상태)

> 한도는 **제공자 단위**로 소진된다. 트랙별 토큰 상태를 만들지 않는다(플레이북 §4). **active_controller는 항상 1명.**

| 항목 | 값 | 갱신 |
|---|---|---|
| 주력(원본) provider | **claude** | 2026-07-20 |
| 인수(백업) provider | **codex** | 2026-07-20 |
| **active_controller** | **claude : 기획(오케스트레이터)** | 2026-07-20 |
| claude 한도 상태 | 정상 | (세션마다 갱신) |
| codex 한도 상태 | 대기(미개시) | |

## 규칙
- 두 지휘자 동시 활성 금지. 인수 시 이 표의 active_controller를 **먼저** 바꾸고 시작.
- Claude 한도 임박/소진 → `takeover-runbook.md`대로 Codex 인수, 이 표 즉시 갱신.
- 복귀 시에도 갱신 — "지금 누가 운전대인지"가 한 줄로 늘 명확해야 한다.
