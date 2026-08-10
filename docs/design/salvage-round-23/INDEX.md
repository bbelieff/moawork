# Round 23 Historical Salvage Hub

> WORK-ID: `HISTORICAL-SALVAGE-COLLECTOR-01`  
> 기준: `docs/coordination/sync/ROUND-23.md`, 이 폴더의 `README.md`, 실제 생성된 `T01`~`T08`·`T10`·`MWC` salvage 파일  
> 목적: 과거 결론을 부활시키는 문서가 아니라, 현재 Round 21 제품 정본에 아직 없는 가치만 회수하는 인덱스다.  
> 상태 주의: 아래 `RECOVER_NOW`는 설계·계약·증거 준비 우선순위다. 코드·DB·운영 write 승인이나 구현 완료를 뜻하지 않는다.

## 1. 전체 판정

- 실제 산출물 `T01`, `T02`, `T03`, `T04`, `T05`, `T06`, `T07`, `T08`, `T10`, `MWC`가 모두 존재하고 비어 있지 않다.
- 현재 제품 정본과 충돌하지 않는 회수 후보를 10개 실행 묶음으로 정규화했다. 같은 빈틈을 설명하는 여러 트랙 항목은 하나의 WORK-ID 아래 수용조건으로 합쳤다.
- 가장 먼저 닫아야 할 공백은 **낡은 T10 gate 경로 충돌**, **특권 지원 접근·개인정보 경계**, **회원·좌석·플랜 entitlement**, **증거 manifest 무결성**이다.
- `docs/coordination/T10-gate-checklist.md`는 현재 권위 있는 검수 정본으로 사용하지 않는다. Round 21 INDEX의 그 경로 참조는 `T10-GATE-SSOT-REFRESH-01`에서 교체 대상이며, 이 salvage 작업은 허용 범위 밖 파일을 수정하지 않았다.
- 과거 branch·PR·SHA·배포·provider 상태, retired YAML registry/queue, broad directory, 이메일 allowlist 자동 Owner, 상시 support membership, impersonation, 일반 RPC를 통한 Owner 변경은 현재 사실이나 구현 후보로 승격하지 않는다.

## 2. 실제 artifact inventory

| 산출물 | 핵심 회수 영역 | 파일 상태 | 현재 소비 상태 |
|---|---|---|---|
| `T01.md` | 접근 요청 복구, workspace 전환, CRM 다음 행동 | 존재·비공백 | Top 10 #4·#5·#6 |
| `T02.md` | async CRM port, CRM 원자 루프, route/stage 결정, provenance | 존재·비공백 | Top 10 #6·#7·#9 |
| `T03.md` | 지원 접근, client session 폐기, PII directory guard | 존재·비공백 | Top 10 #3·#5 |
| `T04.md` | role lens, 위험 행동 UX, session 문맥 카피, brand semantic | 존재·비공백 | Top 10 #3·#5의 시각 수용조건 |
| `T05.md` | 지원 진단, validation feedback, event boundary, safe export | 존재·비공백 | 후속 RECOVER_NOW 묶음 |
| `T06.md` | lifecycle timeline, member event 알림, 위임·계층 성장 | 존재·비공백 | Top 10 #4 및 실험/백로그 |
| `T07.md` | import 경쟁·fencing·rollback CAS·감사·권한 cutoff·SLO | 존재·비공백 | Top 10 #8 |
| `T08.md` | evidence manifest, 멱등성·privacy·support·접근성 증거 | 존재·비공백 | Top 10 #2·#3·#10 |
| `T10.md` | gate SSOT 충돌, 권한 공격검사, 번들·consumer·artifact 회귀 | 존재·비공백 | Top 10 #1·#2·#3·#9 |
| `MWC.md` | entitlement, live OAuth, settlement parity, storage 격리 | 존재·비공백 | Top 10 #4·#10 |

## 3. RECOVER_NOW Top 10

우선순위는 tenant 격리 → Owner 보호 → 최소권한 → 소규모 조직 첫 가치 → 구현을 여는 의존성 순으로 정했다.

| 순위 | 정규화한 회수 항목·출처 | 현재 삽입 위치 | 다음 소비자·WORK-ID | 게이트 상태 |
|---:|---|---|---|---|
| 1 | **검수 정본 경로 교체** — T10-R2. 낡은 T10 checklist가 현재 review 경로로 보이는 충돌 제거 | Round 21 hub의 T10 review 참조와 향후 gate manifest | MWC/HUB writer + T10 · `T10-GATE-SSOT-APPLY-01` | `SPEC_READY / CONTROLLER_APPLY_NOT_RUN`; 제품 DEV는 HOLD |
| 2 | **증거 manifest v2와 artifact 무결성** — T08-R1, T10-R5, T02-S05. 파일 존재만이 아니라 source SHA/path, 명령·결과, 삭제·충돌표식, contract/implementation pass를 구분 | `08-test-matrix.md` traceability/evidence manifest | T08 evidence owner + T10 · `T10-EVIDENCE-MANIFEST-V2-01` | `DRAFT_COMPLETE / EXECUTION_NOT_RUN / T10_REVIEW_REQUIRED` |
| 3 | **특권 지원 접근·개인정보 방어 묶음** — T03-S02·S04, T10-R1, T08 privacy/support evidence, T04 role lens. 플랫폼 1~4급은 작은 조직 기본 UX에서 숨기고 workspace 권한과 분리 | `03-p0-authz-contract.md` Platform/Workspace·support·PII 절, `08-test-matrix.md` 공격행 | Security/Authz owner + T10 · `PRIVILEGED-ACCESS-PRIVACY-GATE-01` | 세부 TTL·재인증 임계값 `DECISION_GATE`; DEV HOLD |
| 4 | **회원·좌석·플랜 entitlement 계약** — MWC-S01, T05-B1, T01 plan-limit, T06 lifecycle. pending·inactive·guest·겸직·복수 workspace seat와 보안상 무료 기능을 고정 | 신규 회원/요금 entitlement SPEC, 팀 성장 UX | Product/정산 owner + T10 · `MEMBER-ENTITLEMENT-SPEC-01` | 과금·좌석 정책 `DECISION_GATE`; 보안 기능 paywall 금지 |
| 5 | **안전한 workspace/session 전환과 폐기** — T01-R2, T03-S03, T04-S03. URL은 권한 근거가 아니며 전환·로그아웃 뒤 cache/context/back-history 재노출을 막음 | `03-p0-authz-contract.md` session/app, `08-test-matrix.md` browser 시나리오 | Session/App owner + T10 · `WORKSPACE-SESSION-CONTEXT-SAFETY-01` | SPEC 우선; DEV writer 미배정 |
| 6 | **CRM 핵심 작업의 복구 가능한 원자 루프** — T01-R1·R3, T02-S03·S04. 접근 요청 뒤 원업무 복귀, detail→stage move→activity, undo/history, route/stage 의미를 함께 닫음 | 신규 `09-crm-operational-loop.md` 후보와 `08-test-matrix.md` | CRM SPEC owner + 사용자 · `CRM-OPERATIONAL-LOOP-DECISION-01` | route/stage 및 복구 UX `DECISION_GATE` |
| 7 | **async CRM source/adapter 경계** — T02-S01·S02. 동기 LocalRepo와 비동기 원격 source를 혼합하지 않고 소비자·signature·compat 기간·제거 조건을 명시한다. 원격 환경 누락·오류를 fake/local source의 조용한 성공으로 대체하지 않는다 | `02-implementation-dag.md` file/data contract, `08-test-matrix.md` | CRM contract writer + T10 · `CRM-ASYNC-PORT-CONTRACT-01` | 계약 선행; DEV BLOCKED |
| 8 | **안전 import 동시성 묶음** — T07-R01·R02·R03·R05·R06. cross-batch 재검증, worker fencing, rollback CAS, 감사 fail-closed, commit 직전 권한 cutoff | `07-safe-import-contract.md` apply/rollback/ImportJob, `08-test-matrix.md` | Import/DB/Auth owners + T10 · `IMPORT-CONCURRENCY-SAFETY-PACK-01` | 단일 writer lease 필요; 운영 write HOLD |
| 9 | **client/server 및 누적 consumer 회귀** — T10-R3·R4, T02 provenance. server-only 모듈의 client graph 유입과 부분 patch로 기존 consumer 계약이 깨지는 일을 차단 | build/typecheck/import-graph 및 cross-module regression gate | DEV build owner + T10 · `CROSS-BOUNDARY-CONSUMER-REGRESSION-01` | 코드 lease 전 SPEC; 구현 증거 필수 |
| 10 | **live 통합 증거 pack** — MWC-S02·S03·S04와 T08 증거 구조. Google OAuth 왕복, settlement 공식·기산일 parity, storage tenant 격리를 실환경에서 각각 증명 | release evidence manifest와 실DB/스토리지 검증 묶음 | Auth/Settlement/Storage DEV + T10 · `LIVE-INTEGRATION-EVIDENCE-PACK-01` | 자격·환경·운영 승인 필요; 비밀값 기록 금지 |

### Top 10에 흡수된 원래 WORK-ID

- #2는 `ARTIFACT-INTEGRITY-GATE-01`, `PR-PROVENANCE-EVIDENCE-01`, `T10-IDEMPOTENCY-EVIDENCE-01`을 하위 검사항목으로 보존한다.
- #3은 `SUPPORT-ACCESS-CONTRACT-01`, `PII-DIRECTORY-GUARD-01`, `PLATFORM-SUPPORT-AUTHZ-TEST-01`, `ACCOUNT-PRIVACY-EVIDENCE-MATRIX-01`, `ROLE-LENS-VISUAL-HARNESS-01`을 흡수한다.
- #5는 `WORKSPACE-CONTEXT-SWITCH-01`, `SESSION-CLIENT-REVOCATION-01`, `SESSION-CONTEXT-COPY-01`, `DANGER-ACTION-UX-CONTRACT-01`을 수용조건으로 유지한다.
- #6은 `ACCESS-REQUEST-RECOVERY-01`, `LEAD-NEXT-ACTION-RECOVERY-01`, `CRM-DETAIL-MOVE-CONTRACT-01`, `CRM-STAGE-ROUTE-DECISION-01`, `MOVE-DEAL-AUDIT-PORT-01`을 한 사용자 여정으로 묶는다.
- #7은 `CRM-SOURCE-MODE-CONTRACT-01`의 환경별 mode·health evidence·실패 UI·fallback 금지 검사를 하위 계약으로 보존한다.
- #8은 원래 T07의 `IMPORT-CROSS-BATCH-CONCURRENCY-01`, `IMPORT-JOB-FENCING-01`, `IMPORT-ROLLBACK-CAS-01`, `IMPORT-AUDIT-FAIL-CLOSED-01`, `IMPORT-AUTHORITY-CUTOFF-01`을 잃지 않는다.
- #9는 `CLIENT-SERVER-BOUNDARY-TEST-01`, `CROSS-MODULE-CONTRACT-REGRESSION-01`을 하나의 release 전 회귀 묶음으로 실행한다.
- #10은 `LIVE-OAUTH-E2E-VERIFY-01`, `SETTLEMENT-PARITY-VERIFY-01`, `STORAGE-TENANT-VERIFY-01`을 독립 PASS/FAIL 행으로 남긴다.

## 4. Top 10 밖의 회수 후보

Top 10 밖이라는 이유로 폐기하지 않는다. 아래는 선행 gate가 닫힌 뒤 원 출처의 WORK-ID로 소비한다.

| 묶음 | 포함 후보 | 다음 WORK-ID·상태 |
|---|---|---|
| P0 이후 동업자 권한 활성화 | 정확한 workspace·보호 Owner 사전 확인, 좁은 권한 RPC, role/scope·platform=false·Owner 불변·중복/cross-tenant 0·감사·재로그인 read-back | `ACCESS-PARTNER-POST-P0-RUNBOOK-01` · 실DB 공격검사와 T10 PASS 및 운영 승인 전 실행 금지 |
| 작은 조직 운영 오류 | 지원 진단 envelope, custom validation feedback | `SMALL-ORG-SUPPORT-DIAGNOSTICS-01`, `CUSTOM-VALIDATION-FEEDBACK-01` · SPEC writer 필요 |
| event·알림 경계 | 활동/감사/시스템/자동화 event 분리, member lifecycle→outbox | `OPERATIONS-EVENT-BOUNDARY-01` → `MEMBER-NOTIFY-EVENT-MAP-01` · vendor 독립 계약 |
| 안전 export | tenant/capability, snapshot, CSV formula 무해화 | `SAFE-EXPORT-CONTRACT-01` · import 계약 이후 |
| import 운영·성과 | source/import 일자 분리, stuck·retry storm SLO | `IMPORT-METRIC-ATTRIBUTION-01`, `IMPORT-OPS-SLO-ALERTS-01` · 정책/임계값 결정 필요 |
| 위험 UX·브랜드 공통선 | 영향→가역성→확인→결과, 정본 의미색·타이포·곡률 | `BRAND-SEMANTIC-VISUAL-CONTRACT-01` · VISUAL/T10 검수 전용 |

## 5. EXPERIMENT

| 실험 | 검증할 질문 | 다음 WORK-ID |
|---|---|---|
| 알림 inbox | 작은 조직이 별도 inbox를 매일 쓰는가 | `NOTIFICATION-INBOX-EXPERIMENT-01` |
| 자동화 복구/제한 preset | 자유 builder 없이도 오류 복구와 반복 작업 가치가 있는가 | `AUTOMATION-RECOVERY-EXPERIMENT-01`, `SMALL-AUTOMATION-PRESETS-01` |
| 대량 초대 preview | 좌석·권한·실패행 사전 확인이 실제 초대 오류를 줄이는가 | `BULK-INVITE-PREVIEW-EXPERIMENT-01` |
| 알림 vendor 재검증 | 현재 provider·비용·개인정보 경계가 적합한가 | `NOTIFY-VENDOR-REVALIDATE-01` |
| board automation 재검증 | 과거 RQ-0009의 schema/11그룹/SSOT가 현재 존재하는가 | `BOARD-AUTOMATION-CURRENT-REVALIDATE-01` |
| privacy/auth entry 4안 | 보안 바닥선을 고정한 채 exact search·reveal·복사/내보내기와 auth entry의 이해도 차이가 있는가 | `PII-SEARCH-UX-4A-01`, `ACCOUNT-PRIVACY-VISUAL-4UP-01`, `AUTH-ENTRY-VISUAL-REGRESSION-01` |
| import 용량 | 추측 threshold 대신 실제 fixture로 chunk/queue 기준을 정할 수 있는가 | `IMPORT-CAPACITY-EXPERIMENT-01` |

실험은 기능 승인이나 release 근거가 아니다. 실제 계정·고객 정보·비밀값을 fixture에 넣지 않는다.

## 6. BACKLOG

1. `CAPABILITY-DELEGATION-P1-01` — scope·TTL·ceiling이 있는 위임.
2. `ORG-HIERARCHY-P1-01` — C-level·사용자 정의 계층은 대표·팀장·사원 기본 흐름 뒤에 연다.
3. `WORKSPACE-RECOVERY-CENTER-01` 및 `ACCOUNT-RETENTION-POLICY-01` — 보존·법적 정책 결정 뒤 진행.
4. `PARTIAL-PATCH-PRESERVATION-01` — 현재 #9의 최소 회귀 gate가 자리 잡은 뒤 일반화.
5. `LOGIN-VISUAL-REGRESSION-CATALOG-01` — 핵심 auth/session 구현 증거 이후.
6. `IMPORT-MAPPING-PROFILE-01`, `IMPORT-DERIVED-REBUILD-01`, `PERF-HISTORY-IMPORT-GATE-01` — 안전 import 기본 계약 이후.
7. 외부 collaborator·workspace exit·support incident runbook — membership/entitlement 계약 이후.

## 7. REJECTED_KEEP · DUPLICATE · OBSOLETE

### REJECTED_KEEP

- Platform Admin을 routine Owner 승인자로 사용하거나 workspace 데이터 권한으로 연결하지 않는다.
- 이메일 allowlist로 Platform Admin/Workspace Owner를 자동 부여하지 않는다.
- broad user directory, impersonation, 영구 support membership, 일반 RPC의 Owner 변경, editable audit를 구현하지 않는다.
- 자유 조합 자동화 builder, native/offline 동기화, AI 자동 결정, 제품 내 실시간 chat, 고급 조직계층 기본 노출은 현재 기본 제품으로 승격하지 않는다.
- import 원본의 비정상 formula·URL·숨은 열을 그대로 실행·노출하지 않는다.

### DUPLICATE

중복 항목은 현재 정본 또는 위 Top 10에 흡수했다. 핵심 중복 군은 small-org first, daily action taxonomy, safe import 기본 계약, P0 authz exact-one/tenant/RLS, visual T10 gate, auth 결정, artifact-required 규칙, membership 기본 lifecycle이다. 원문을 다시 복사해 별도 정본을 만들지 않는다.

### OBSOLETE

과거 PR·branch·SHA·worktree·provider·배포·일시적 blocker·standby/current-state 문장은 현재성 근거로 사용하지 않는다. 실제 구현 착수 시 최신 main, writer lease, 환경, DB schema, 배포 상태를 다시 측정한다.

### 중복 제거 통계

- 실제 비공백 source artifact: **10개** (`T01`·`T02`·`T03`·`T04`·`T05`·`T06`·`T07`·`T08`·`T10`·`MWC`).
- 실행 우선 RECOVER_NOW: **10개 정규화 묶음**.
- 별도 후속 RECOVER_NOW: **6개 묶음**.
- 실험: **7개 묶음**.
- backlog: **7개 묶음**.
- 영구 기각선: **5개 군**.
- 중복: **8개 군**.
- obsolete: **1개 상태정보 군**. 개별 source의 작성자 집계는 각 파일을 따른다.

## 8. 실행 DAG와 downstream packet

```text
SALVAGE-INTEGRITY-VERIFY-01
  ├─ T10-GATE-SSOT-REFRESH-01
  ├─ T10-EVIDENCE-MANIFEST-V2-01
  │    ├─ PRIVILEGED-ACCESS-PRIVACY-GATE-01
  │    ├─ WORKSPACE-SESSION-CONTEXT-SAFETY-01
  │    ├─ IMPORT-CONCURRENCY-SAFETY-PACK-01
  │    └─ CROSS-BOUNDARY-CONSUMER-REGRESSION-01
  ├─ MEMBER-ENTITLEMENT-SPEC-01 ──> member lifecycle/notification/export
  ├─ CRM-OPERATIONAL-LOOP-DECISION-01 ──> CRM-ASYNC-PORT-CONTRACT-01
  └─ LIVE-INTEGRATION-EVIDENCE-PACK-01  (환경·운영 승인 뒤)
```

| 대상 | 전달 내용 | 상태 |
|---|---|---|
| 사용자/MWC | #3 지원 접근 임계값, #4 과금·좌석, #6 route/stage·복구 UX 선택 | `DECISION_GATE` |
| SPEC/HUB writer | #1~#8 계약과 삽입 위치; 단일 file lease 발급 전 write 금지 | `NOT_ASSIGNED` |
| DEV | 제품 코드·DB·RLS·실환경 구현은 이 문서로 승인되지 않음 | `HOLD` |
| T04 VISUAL | role lens, 위험 행동, session copy, brand semantic은 합성 fixture로만 검토 | `LEASE_REQUIRED` |
| T08 | `evidence-manifest-v2.md` REVIEW SPEC materialize 완료; 실행 package와 실제 evidence는 아직 없음 | `DRAFT_COMPLETE / EXECUTION_NOT_RUN` |
| T10 | salvage 무결성 재검수 PASS; `T10-gate-ssot-refresh.md` 교체 SPEC materialize 완료 | `SPEC_READY / CONTROLLER_APPLY_NOT_RUN` |
| MWC controller apply | 새 `10-t10-gate.md`·append-only verdict history 생성, hub 링크 전환, 구문서 `SUPERSEDED / HISTORY ONLY` 표식을 한 lease/batch로 적용한 뒤 T10 독립 검수 | `T10-GATE-SSOT-APPLY-01 / APPLY_GATE_READY` |

## 9. 무결성 체크

- [x] 지정 source artifact의 실제 존재와 비공백을 확인했다.
- [x] 출처가 확인되지 않은 후보는 넣지 않았다.
- [x] 과거 상태를 현재 구현·배포 완료로 표현하지 않았다.
- [x] contract PASS와 implementation/release PASS를 분리했다.
- [x] 개인정보·계정·토큰·비밀값을 기록하지 않았다.
- [x] coordination/WORKLOG/ROUND, 제품 코드, HTML, DB, Git을 수정하지 않았다.
- [x] T10 `SALVAGE-INTEGRITY-VERIFY-01` 독립 재검수 `PASS`.
- [x] `T10-gate-ssot-refresh.md` 존재·비공백: 26,784 bytes / 392 lines.
- [x] `evidence-manifest-v2.md` 존재·비공백: 32,009 bytes / 622 lines.
- [ ] MWC `T10-GATE-SSOT-APPLY-01` 실행과 적용 후 T10 독립 검수.
- [ ] Evidence Manifest v2 실행 package·non-skip evidence·T10 판정.

## 10. Downstream materialization receipt

| Artifact | 실제 경로 | artifact 상태 | 다음 gate |
|---|---|---|---|
| T10 gate SSOT refresh | `docs/design/salvage-round-23/T10-gate-ssot-refresh.md` | `SPEC_READY`; 26,784 bytes / 392 lines | MWC/HUB writer가 `T10-GATE-SSOT-APPLY-01` 수행 후 T10 독립 검수. 이 SPEC만으로 coordination·제품·merge·deploy write 승인 아님 |
| Evidence Manifest v2 | `docs/design/salvage-round-23/evidence-manifest-v2.md` | `DRAFT_COMPLETE`; 32,009 bytes / 622 lines | T10 REVIEW → 실행 owner/lease/후보/환경 고정 → 실제 evidence package 생성. 현재 `EXECUTION_NOT_RUN` |

### MWC controller apply gate

`T10-GATE-SSOT-APPLY-01`은 실행 준비 상태지만 아직 적용되지 않았다. MWC는 단일 writer lease에서 새 gate SSOT와 append-only verdict history를 만들고, hub의 review 링크 전환과 구 checklist의 `SUPERSEDED / HISTORY ONLY` 표식을 한 batch로 처리해야 한다. 적용 뒤 T10이 취약 권한·고정 PR/SHA·retired coordination 규칙이 실행 규칙으로 남지 않았는지 독립 검수하기 전에는 완료로 표시하지 않는다.
