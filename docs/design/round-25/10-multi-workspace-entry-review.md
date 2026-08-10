# MULTI-WORKSPACE-ENTRY-INDEPENDENT-REVIEW-02

## 1. 최종 판정

**FAIL — EXACT CANDIDATE CHANGED DURING REVIEW**

- 사용자 시각 선택: `PENDING`
- 제품 코드·Git·DB·merge·deploy: `HOLD`
- corrected-candidate T10 browser: `NOT_RUN — optional/non-approval instruction`
- hosted Supabase·실제 다중 연결 경쟁·JWT/PostgREST: `NOT_RUN`
- 다음 WORK-ID: `MULTI-WORKSPACE-ENTRY-CANDIDATE-FREEZE-01`

T05가 전달한 exact candidate는 `2840A03E...80B`였고, T10은 그 바이트에서 계약·정적 상태 모델과 격리 PGlite/PostgreSQL lab을 통과시켰다. 그러나 리뷰 문서 작성 직후 같은 경로의 HTML이 bytes/lines 변화 없이 `D3A43A9B...A2A5`로 바뀌었다. 검수 대상이 고정되지 않았으므로 최종 PASS를 부여할 수 없다.

현재 `D3A43A9B...A2A5`도 P0 핵심 정적 재검사에서는 통과했지만, controller가 승인·전달한 exact SHA가 아니다. T01/T05가 최종 바이트를 다시 동결하고 새 SHA를 명시하기 전 사용자 시각 결정으로 넘기지 않는다.

## 2. 입력 무결성

| 입력 | bytes | lines | SHA-256 | 판정 |
|---|---:|---:|---|---|
| `05-multi-workspace-entry-contract.md` | 16,059 | 185 | `B0E44137E7997BC890914515F5535166141E5EF002C440BD1F370CCD314BE031` | 현재 통합 계약 |
| `02-multi-workspace-authz-contract.md` | 43,346 | 595 | `ED27FB7A83D2B21D18109F197EDB444B7D74DAA3A861BA05B6D920EC622F21AF` | expected hash 일치 |
| `MoaWork_Workspace_Entry_4Concepts_v0.1.html` — 전달 후보 | 41,687 | 425 | `2840A03E67A2173EF8DFABE1409B0B2AE87AD9FBB2D33E7A91666AEC8ACE780B` | 전달 시 expected |
| 같은 경로 — 최종 read-back | 41,687 | 425 | `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5` | **MISMATCH / FAIL** |
| `08-multi-workspace-db-lab.md` | 11,209 | 224 | `1042C9C90251534198A8D96483530D407AC53F38D0107EF7EF39A035FFBFF44C` | T08 lab receipt |

HTML은 dispatch의 최초 후보 `F8C4E6E6D49FD13D0339529C9B3DAB51523EF4658745EA70AC4A5DA9EEB551E2`가 아니라 T01 replacement rework의 새 exact candidate다.

## 3. 이전 후보 FAIL 이력

최초 HTML 후보는 T10 실제 브라우저 검수에서 다음 두 P0를 재현해 FAIL이었다.

1. D안이 `one`, `new-owner`, `joiner`에서도 두 Workspace 노드를 공통 fallback으로 표시했다.
2. C안의 Platform operator 화면에 `회사 전환`, `합류 요청`, `새 회사` tenant quick action이 남았고, `회사 전환`을 누르면 실제로 `multiple` 상태와 두 Workspace 행이 열렸다.

이 판정은 old SHA의 회귀 방지 이력으로 유지한다. corrected SHA는 아래처럼 분기를 분리한다.

- D: `one=1`, `multiple=2`, `new-owner=1`, `joiner=1`, `operator=0` Workspace node.
- C operator: `data-operator-only=true`, tenant quickbar와 `switch-scenario` action 0.
- operator 경로는 승인된 지원 요청만 보여주고 tenant 선택·생성·합류 기능이 없음을 명시한다.

## 4. 계약 검수

| 계약 | 독립 확인 | 판정 |
|---|---|---|
| account × Workspace membership | 역할·scope·status가 account 전역이 아니라 membership 축에 있음 | PASS |
| protected Owner exact-one | Owner 1명, `scope=all`, 일반 RPC/direct DML 변경 금지 | PASS |
| Platform/tenant 분리 | Platform operator는 명시 membership 없이 tenant read/write·Owner 합성 0 | PASS |
| create 승인 transaction | Workspace + Owner/all + profile + result + audit 원자 처리, 실패 시 전부 rollback | PASS |
| join 승인 transaction | `member/minimal`만 원자 생성, Owner/Admin payload 주입 금지 | PASS |
| OAuth 0/1/2+ route | 0=`workspace-entry`, 1=유일 Workspace, 2+=picker; 임의 Owner/첫 행 자동 진입 금지 | PASS |
| `last_workspace` | 선택 편의값일 뿐 membership/RLS grant 아님, server 재검증 필요 | PASS |
| digest-only | raw invite/code/session 값을 table·audit·log에 보존하지 않음 | PASS |
| enumeration 0 | generic 이름 검색은 존재·개수·후보·Owner/membership을 동일 응답으로 숨김 | PASS |
| session cutoff | membership 변경·제거·Owner transfer·suspend와 cutoff/audit 원자 연결 | PASS |
| migration DAG | PR20 `007_first_lead`와 P0 `007` 충돌을 선행 해결하고 기존 migration 불변 | PASS |
| PR #19/#20 | Draft/HOLD 상태를 merge·DB 적용·production ready로 승격하지 않음 | PASS |

## 5. HTML 정적·상태 검수 — 부분 PASS

T10은 전달 SHA에서 자체 PowerShell 정적/state harness를 실행했고, drift 발견 뒤 현재 `D3A43A9B...A2A5`에서도 P0 핵심 분기를 다시 확인했다.

- 결과: **24 PASS / 0 FAIL**
- 4개 concept panel과 8개 scenario 존재.
- C operator 전용 branch, quickbar 0, tenant scenario action 0.
- D workspace node cardinality: `0/1/2` 상태별 정확.
- generic enumeration-safe 응답과 exact lookup의 membership 미부여 문구 확인.
- B 신규 Owner 3단계: 회사 이름 → 팀원 초대 → CSV 가져오기.
- joiner는 Owner 온보딩 제외.
- fake 승인·회사 생성·초대 성공을 가장하지 않고 실제 반영 0을 명시.
- dark, `:focus-visible`, `prefers-reduced-motion`, `aria-live/status` 규칙 존재.
- 외부 script 0, 이메일형 PII 0, secret assignment 패턴 0.

drift 뒤 현재 바이트 재검사:

- C operator-only container: 존재.
- C operator tenant transition action: `0`.
- D node: `operator=0 / one=1 / multiple=2 / new-owner=1 / joiner=1`.
- 이메일형 PII: `0`.
- secret assignment: `0`.

기능적 P0 회귀는 보이지 않지만 SHA mismatch 자체가 artifact-integrity gate 실패다.

### 4안 실질 차이

| 안 | 구조·상호작용 차이 | 판정 |
|---|---|---|
| A 빠른 관문 | 만들기/합류 양갈래 선택 카드, 낮은 밀도 | PASS |
| B 안내 경로 | 소속→요청→진입 단계 rail과 Owner 3단계 handoff | PASS |
| C 회사 허브 | 좌측 탐색·quick action·다중 Workspace 고밀도 구조; operator는 별도 shell | PASS |
| D 안전 지도 | account와 Workspace node를 공간적으로 표시하고 상태별 node 수 분리 | PASS |

### 상태 의미

- `zero`, `one`, `multiple`, `pending-create`, `pending-join`, `new-owner`, `joiner`, `operator`가 서로 다른 fixture로 존재한다.
- pending은 membership이 아니며 수정·취소만 제공한다.
- generic 응답은 네 concept에서 같은 단일 생성 함수로 제공된다.
- B Owner onboarding은 joiner에게 노출되지 않는다.
- operator는 tenant Workspace row·진입 CTA를 얻지 않는다.

## 6. 브라우저 증거 경계

- URL: `http://127.0.0.1:4322/MoaWork_Workspace_Entry_4Concepts_v0.1.html`
- T10은 old SHA에서 실제 브라우저로 1280 및 390/320, dark, focus, reduced-motion, console을 검사했고 그 과정에서 위 P0 두 건을 발견했다. 이 old-SHA 결과를 corrected SHA의 브라우저 PASS로 재사용하지 않는다.
- corrected SHA에 대한 T10 browser는 controller 지시에 따라 `NOT_RUN`이다. approval-gated browser에 재진입하거나 가짜 console/viewport 영수증을 만들지 않았다.
- T05 foreman 보강 증거: corrected SHA, 1280/390/320, 8개 상태 모두 horizontal overflow 0, article 4개, dark/focus/reduced-motion, console warn/error 0. 이는 T10 독립 browser PASS가 아니라 corroboration이다.
- 사용자 4안 실화면 선택이 남아 있으므로 corrected prototype 공개에는 충분하지만 제품 merge/deploy gate에는 불충분하다.

비차단 시각 메모: `.hub-link`는 공통 44px 규칙을 `min-height:40px`로 덮는다. 이번 명시 acceptance의 blocker는 아니지만 제품 구현 후보에서는 모바일 터치 영역을 44px 이상으로 정규화한다.

## 7. T08 DB lab 독립 재실행

실행:

```text
cd C:\Users\belie\Desktop\Belief\서울리드프로젝트\labs\multi-workspace-entry
npm.cmd test
```

T10 실제 결과:

- exit: `0`
- tests: `27`
- pass: `27`
- fail: `0`
- skipped: `0`
- cancelled: `0`
- todo: `0`
- duration: `4,842.7078 ms`

통과 범위에는 Owner 0/2 commit 차단, owner direct DML/일반 RPC 공격, Platform tenant read/write 0, create/join idempotency·rollback, digest invite, cross-tenant RLS, append-only audit, session cutoff가 포함된다.

### lab 한계

- PGlite 0.5.4는 PostgreSQL role/grant/RLS/PL/pgSQL/trigger/transaction/constraint 의미론을 실제 실행한다.
- 단일 connection engine이므로 Promise contention은 queued contention일 뿐 **true multi-connection race PASS가 아니다**.
- hosted Supabase: `NOT_CREATED / COST 0`.
- Supabase Auth JWT→GUC, PostgREST/pooler, hosted migration compatibility, production behavior: `NOT_RUN`.
- emulator/local lab 결과를 hosted RLS·Production PASS로 표시하지 않는다.

## 8. 개인정보·비밀값

- HTML 이메일형 PII: `0`
- HTML secret assignment 패턴: `0`
- 실제 사용자·고객 데이터: `0`
- raw invite/session token 기록: `0` 계약 유지
- credential 요청·조회·기록: `0`

## 9. 남은 gate

1. T01/T05가 `2840A03E...80B`를 복원하거나 현재 `D3A43A9B...A2A5`를 새 최종 후보로 명시하고, sole lease 종료와 추가 writer 0을 read-back한다.
2. T10은 새로 고정된 SHA에서 hash/bytes/lines와 P0 핵심 정적 검사를 다시 실행한다.
3. exact integrity PASS 뒤에만 사용자에게 4안을 제시한다: `MULTI-WORKSPACE-ENTRY-USER-DECISION-01`.
4. 그 전 제품 코드·PR·migration·DB·merge·deploy를 계속 HOLD한다.
5. 선택 뒤 별도 `MULTI-WORKSPACE-ENTRY-IMPLEMENT-01`에서 sole writer, migration 번호, live preflight, app tests, disposable hosted/multi-connection DB와 release sequence를 다시 승인받는다.
6. hosted 단계에서는 true two-connection race, JWT/PostgREST mapping, migration apply/read-back, tenant attack suite를 non-skip으로 실행한다.

## 10. 소비

- T05/MWC: exact SHA drift를 해소하고 새 최종 후보를 재발행한다. browser `NOT_RUN`과 hosted/live `NOT_RUN`을 보존한다.
- 사용자: artifact-integrity 재검수 전에는 네 안 선택을 요청하지 않는다.
- 다음 WORK: `MULTI-WORKSPACE-ENTRY-CANDIDATE-FREEZE-01`; 통과 뒤 `MULTI-WORKSPACE-ENTRY-USER-DECISION-01`.
