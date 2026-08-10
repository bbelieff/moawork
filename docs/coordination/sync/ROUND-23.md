# SYNC Round 23 — 과거 답변 전수 수거와 가치 복구

> 작성: MoaWork Control(MWC) · 2026-07-24 KST

## 사용자 결정

- 지나간 답변·선택되지 않은 시안·FAIL 패킷·보류안도 버리지 않고 전수 대조한다.
- 좋은 내용은 현재 제품 허브에 귀속하고 구현·시각 검토·백로그·검수로 연결한다.
- 단순 아카이브가 아니라 현재 제품에서 빠진 가치만 추출한다.

## 범위

- MWC와 T01~T10의 MoaWork thread history
- `docs/coordination/sync/ROUND-1.md`부터 `ROUND-22.md`
- 현재 제품 허브 `docs/design/round-21/`
- 기존 T04 디자인 HTML과 T10 PASS/FAIL 기록

다른 프로젝트와 실제 고객 데이터는 범위 밖이다.

## 실행

1. 각 세션이 자신의 과거 final·중간 패킷·차단 결함을 읽는다.
2. 현재 허브와 대조해 차이가 있는 항목만 전용 salvage 파일에 기록한다.
3. `RECOVER_NOW / EXPERIMENT / BACKLOG / REJECTED_KEEP / DUPLICATE / OBSOLETE`로 분류한다.
4. T09가 실제 파일을 회수하고 중복 제거한 `INDEX.md`를 만든다.
5. T10이 보안 불변식·폐기 정본 부활·허위 현재성 여부를 검수한다.
6. RECOVER_NOW는 기존 SPEC 개정, VISUAL 4안, DEV writer gate 중 하나로 즉시 연결한다.

## 산출물

- 허브: `docs/design/salvage-round-23/`
- 파일 lease와 완료 게이트: 해당 폴더 `README.md`
- coordination writer는 MWC만 유지하며 각 세션은 자신의 salvage 파일만 수정한다.

## 금지

- 옛 답변 전체 복사
- 출처 없는 아이디어 추가
- 폐기 YAML coordination 부활
- 보안상 기각된 권한 경로 복원
- 과거 PR·SHA·배포 상태를 현재 사실로 표시
- 사용자 결정 없이 RECOVER_NOW를 제품 코드에 바로 구현

## 회수 결과

- 실제 비공백 source artifact 10개(T01~T08 중 T06 포함, T10, MWC)와 통합 `INDEX.md`를 생성했다.
- T06은 원 세션 오류 때문에 T09가 history를 직접 읽어 대신 수거했다.
- 회수 결과는 `RECOVER_NOW Top 10`, 별도 후속 5개 묶음, 실험 7개, backlog 7개, 영구 기각 5개 군으로 정규화됐다.
- T10 1차 검수는 동업자 권한 실행/read-back 런북, CRM source-mode fail-closed, deal 이동 audit port, PII 검색 4안 계보 누락으로 FAIL했다.
- T09가 네 누락을 `INDEX.md`에 보완했고 T10 재검수는 PASS했다.
- 취약 권한 경로, 폐기 YAML, 낡은 PR·SHA·provider·deploy 현재성의 부활은 발견되지 않았다.
- 다음 gate는 `T10-GATE-SSOT-REFRESH-01`이며, RECOVER_NOW는 구현 승인이 아니라 다음 SPEC·VISUAL·DEV writer·REVIEW 입력이다.
