# lib.automation.lock — 이중 잠금 게이트 (BBE-105)

D36(결정대장) — 조건이 미충족이면 이관을 막고 사유를 보여준다. D66 — 회사가 이 게이트를
끌 수 있고, 끌 때 사유를 받아 감사 로그에 남긴다.

## 구성

| 파일 | 내용 | 상태 |
| --- | --- | --- |
| `types.ts` | 공유 타입 — `LockCondition`·`LockGateResult`·`LockToggleAudit` | ✅ |
| `evaluate.ts` | 게이트 실행기(순수 함수) — 조건 AND 판정 + D66 우회 표시 | ✅ (+test) |
| `toggle.ts` | 스위치 변경 판정(순수 함수) — 끌 때 사유 필수 | ✅ (+test) |
| `contact-handoff.ts` | D36 구체 사례 — 리드컨택 `직인 완료` 가드 조건 빌더 | ✅ (+test) |

## 스코프 경계 (착수 시 실측 — 2026-08-10)

이 모듈은 **의도적으로** N-조건 자동화 조건절 엔진을 다시 만들지 않는다.

- **BBE-104(A-1)** 가 그 엔진(`조건 N개 AND`, DB 스키마 포함)의 정본이다. 착수 시점
  BBE-104 는 In Progress였고 `lib/policyfund/automation.ts` 실측 결과 AND 조건 지원은
  0건이었다 — 지금 병행 구현하면 BBE-104 완료 시 두 소스가 충돌한다.
- 대신 이 모듈은 **"조건이 이미 평가된 값(`LockCondition[]`)"만 받는 좁은 인터페이스**로
  존재한다. BBE-104 가 조건 평가를 내면, 그 결과를 이 모양으로 매핑하는 어댑터 하나만
  추가하면 된다 — `evaluateLockGate` 자체는 손댈 필요가 없다.
- `contact-handoff.ts` 는 D36 의 정확한 문구·라벨을 목업(`UI목업_워크스페이스_최종_v6.html`
  의 `showBlock`/`approveSeal`)과 대조해 고정한 것이다. BBE-104 가 들어오면 이 파일의
  역할은 "그 엔진의 출력 → `LockCondition[]`" 매퍼로 좁아진다.

## D66 영속화는 이 카드 리스 밖

`decideLockToggle` 은 순수 판정만 한다. 실제 저장(회사별 on/off·감사이력 테이블)은
새 마이그레이션이 필요하고, 이 카드의 리스(`app/src/lib/automation/lock/**`,
`app/src/components/automation-presets/lock/**`)에는 `supabase/migrations/**` 가 없다.
번호를 추측해 미리 만들지 않는다(최신 034, 절대금지 #2). 후속 카드에서 결정한다.

## 보드 연결도 이 카드 리스 밖

목업의 "리드컨택 → 업무이동" 화면이 아직 `app/src` 에 없다(컨택 파이프라인 미머지).
`LockBlockedDialog`/`LockToggleSettingsRow` 는 콜백 기반으로 독립 완성돼 있어, 그 보드가
머지되면 `onNavigateToCondition`·`onSubmit` 을 연결하기만 하면 된다.
