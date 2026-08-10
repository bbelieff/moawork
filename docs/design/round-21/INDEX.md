# Round 21 Product Artifact Index

> Hub owner: T09  
> Verification basis: actual files, not chat finals  
> Last refreshed: 2026-07-24 KST — 01/02/03/05/06/07/08 actual files verified  
> Write boundary: this INDEX only

## 판정 규칙

- `VERIFIED_SPEC`: 지정 파일이 실제로 존재하고, 문제·결정 상태·계약·실패/보안·수용조건·다음 소비자·후속 WORK-ID를 확인했다.
- `NO_OUTPUT`: 지정 파일이 없거나 비어 있어 채팅 final이 있더라도 산출물로 인정하지 않는다.
- `BLOCKED_BY_THREAD`: 원 세션이 artifact turn을 시작하지 못해 대체 writer가 필요하다.
- `VISUAL_EXISTS`: 실제 시각 파일은 존재하지만 사용자 승인이나 T10 PASS를 뜻하지 않는다.
- `REVIEW_PENDING`: 현재 대상에 대한 독립 PASS/FAIL 판정이 아직 닫히지 않았다.
- SPEC 완료는 제품 구현·merge·배포 완료가 아니다.

## Artifact → Product → Next Gate

| 트랙 | 실제 산출물 | 실재·내용 판정 | 연결 제품 기능 | 다음 WORK-ID | 사용자 검토 | DEV 상태 | T10 상태 | 허브 상태 |
|---|---|---|---|---|---|---|---|---|
| T01 | [01-first-value-concepts.md](./01-first-value-concepts.md) | 파일 존재. 3분 시작 A/B/C/D, 확정/Draft/Q1~Q5, 상태·복구·권한·수용조건·downstream 확인 | 3분 시작·첫 고객/업무·온보딩 재개 | `FIRST-VALUE-DECISION-01` | `DECISION_GATE / PENDING` | `NOT_AUTHORIZED` | T04 비교 VISUAL 대기 | `VERIFIED_SPEC` |
| T02 | [02-implementation-dag.md](./02-implementation-dag.md) | 파일 존재. 006→007→compatibility app→008+→strict app→009+ DAG, entry/exit/STOP·증거·writer gate 확인 | 작은 조직 기반·P0 AuthZ 구현과 PR/migration 순서 | `IMPLEMENTATION-WRITER-GATE-01` | DAG·maintenance/HOLD 확인 대기 | `BLOCKED — WRITER GATE NOT RUN` | 구현·실DB 1~55 미실행 | `VERIFIED_SPEC` |
| T03 | [03-p0-authz-contract.md](./03-p0-authz-contract.md) | 파일 존재. protected Owner, Platform/Workspace 분리, invite/profile/session/RLS, preflight·release·공격검사 확인 | 회원·초대·Owner·세션·tenant P0 기반 | `P0-AUTHZ-WRITER-GATE-01` | HOLD·release 순서 확인 대기 | DB/RLS writer 미배정 | `PASS — CONTRACT ONLY`; 구현 재검수 필요 | `VERIFIED_SPEC` |
| T05 | [05-daily-action-taxonomy.md](./05-daily-action-taxonomy.md) | 파일 존재. action taxonomy, KST, 권한, stale, dedupe, 결정적 ranking, AC·downstream 확인 | 오늘의 MoaWork 홈·D+180/365 행동 | `TODAY-HOME-DATA-CONTRACT-01` | 우선 행동·stale·역할 노출 확인 대기 | `NOT_STARTED / BLOCKED_BY_DECISION_GATE` | 구현·VISUAL 뒤 검수 | `VERIFIED_SPEC` |
| T06 | [06-small-team-growth.md](./06-small-team-growth.md) | 파일 존재. 원 T06 internal error 뒤 T01 대체 writer가 작성; 초대 lifecycle, 첫 업무, session revoke, 별도 인계 큐, 성장 신호·ACL 금지선 확인 | 초대·팀장 위임·퇴사/휴직·인계·두 번째 팀 | `TEAM-GROWTH-DECISION-01` | `DECISION_GATE / PENDING` | `NOT_AUTHORIZED` | T04 실제 팀 성장 VISUAL 대기 | `VERIFIED_SPEC / RECOVERED_BY_T01` |
| T07 | [07-safe-import-contract.md](./07-safe-import-contract.md) | 파일 존재. CSV/Monday, dry-run, 오류, 중복, 원자성, rollback, tenant, AC·결정 게이트 확인 | 안전한 데이터 가져오기·ImportJob | `IMPORT-DECISION-01` | `ANSWER_REQUIRED` | ImportJob `NOT_STARTED` | 구현·실화면 증거 대기 | `VERIFIED_SPEC` |
| T08 | [08-test-matrix.md](./08-test-matrix.md) | 파일 존재. 1/3/10명 행렬, authz 1~55, traceability, 실DB non-skip·시각 증거·P0 반려 계약 확인 | 네 핵심 여정의 사용자·보안·시각 독립 검수 | `T10-EVIDENCE-EXECUTION-01` | D-01~D-05·실화면 퀴즈 대기 | `WAIT-P / NOT_RUN` | `READY-TO-COLLECT, NOT_READY-TO-PASS`; PASS 0 | `VERIFIED_SPEC` |
| T04 | [MoaWork_Admin_Account_Design_4Concepts_v0.1.html](../../../../brand/MoaWork_Admin_Account_Design_4Concepts_v0.1.html) · [사용자 URL](http://localhost:8765/MoaWork_Admin_Account_Design_4Concepts_v0.1.html) | 실제 HTML 존재, 92,859 bytes; 로컬 URL HTTP 200·동일 길이 확인. T10 독립 PASS 수신 | 관리자·계정·Workspace·지원 접근 VISUAL | 사용자 4안 선택·수정 지시 | `USER_DECISION_GATE` | 제품 코드 `NOT_STARTED` | `PASS — SMALL-ORG-FIRST-01` | `VISUAL_VERIFIED / USER_DECISION_GATE` |
| T10 | [T10-gate-checklist.md](../../coordination/T10-gate-checklist.md) | REVIEW 경로 존재. 추가 권위 final에서 T04 `SMALL-ORG-FIRST-01` 독립 PASS 확인 | 보안·시각·회귀·merge 독립 gate | 사용자 선택 뒤 선택안의 DEV·누적 후보 재검수 | `USER_DECISION_GATE` | writer 아님; 제품 코드 미착수 | VISUAL `PASS`; CODE/DB `NOT_RUN` | `REVIEW_PASS_FOR_VISUAL / PRODUCT_GATE_OPEN_NOT_GRANTED` |

## 검증된 SPEC 핵심 연결

### 3분 시작

- 작은 조직은 대표 단독 시작을 기본으로 하되 팀 초대를 선택적으로 연다.
- A 한 장, B 단계형, C 오늘 홈 내장, D 결과 미리보기의 네 방향은 사용자 결정 전 모두 후보로 유지한다.
- Workspace+Owner와 첫 고객+첫 업무의 원자성, 멱등 재시도, tenant 서버 확정은 모든 안의 공통 경계다.

### P0 권한 기반

- Workspace마다 protected Owner는 commit 시 정확히 1명이고 `scope=all`이다.
- Platform 권한과 Workspace role은 합성하지 않는다.
- invite 소비, membership, Workspace profile, 감사는 원자적으로 처리한다.
- 현재 판정은 계약만 PASS이며, 006·007 선행과 preflight·writer lease·실DB non-skip 검수 전 구현 승인이 아니다.

### 오늘 홈

- 행동은 `work_due`, `follow_up`, `assign_owner`, `decide`, `reconcile_payment`로 제한한다.
- 담당자는 routing, 날짜는 urgency이며 담당됐다는 이유만으로 카드를 생성하지 않는다.
- tenant/capability 필터를 집계 전에 적용하고, KST·stale·dedupe·동률 규칙을 결정적으로 유지한다.
- 현재 없는 일반 기한·승인·입금예정 원천을 추론하지 않는다.

### 안전한 가져오기

- 추천 MVP는 CSV와 Monday CSV 내보내기 + assisted onboarding이다.
- dry-run은 제품 테이블 write 0이며 apply는 preview hash·멱등키·Workspace 권한을 재검증한다.
- 오류 행이 남은 부분 적용, 유사 중복 자동 병합, 담당자 자동 Owner 배정은 기본값으로 채택하지 않는다.
- 사용자 범위 결정 전 migration·API·제품 코드·신규 HTML을 시작하지 않는다.

## 현재 차단과 수집 큐

1. T01·T02·T03·T05·T06·T07·T08의 지정 파일 7개가 모두 존재하며 최소 내용과 다음 소비자를 검증했다.
2. T06은 원세션 `BLOCKED_BY_THREAD`를 유지하되, T01 대체 writer의 실제 파일로 artifact 손실을 복구했다. 중복 writer는 없었다.
3. T02의 08 입력은 `CONNECTED — DRAFT / NOT_RUN`으로 갱신됐고, T08도 02를 후보 SHA·실행순서 입력으로 역참조한다. 연결은 확인됐지만 실행 PASS는 0건이다.
4. T04 HTML은 파일과 HTTP 200 공개를 확인했고 T10 독립 VISUAL PASS를 수신했다. 다음 상태는 merge나 DEV가 아니라 사용자 4안 선택이다.
5. 제품 코드·DB·PR·merge·deploy는 여전히 시작·승인되지 않았다.

## Hub Ingest 판정

| 범위 | 판정 | 근거 |
|---|---|---|
| ROUND-21 SPEC 수집 | `DONE — 7/7 VERIFIED` | 01·02·03·05·06·07·08 실제 파일과 핵심 계약 확인 |
| T04 VISUAL | `PASS / USER_DECISION_GATE` | 실제 HTML, localhost HTTP 200, T10 독립 PASS |
| DEV/CODE/DB | `NOT_STARTED / HOLD` | 사용자 결정, writer gate, worktree/file lease, 실DB non-skip 증거 필요 |
| T10 제품 구현 gate | `NOT_RUN` | 현재 PASS는 T04 VISUAL에 한정 |
