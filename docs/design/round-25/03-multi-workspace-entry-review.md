# MULTI-WORKSPACE-ENTRY-INDEPENDENT-REVIEW-03

## 0. 검수 신원·범위

- WORK-ID: `MULTI-WORKSPACE-ENTRY-INDEPENDENT-REVIEW-03`
- 실제 검수 worker: `T03`
- 배정자/소비자: 실제 `T05` foreman / MWC / 사용자 / T09
- 전용 파일 lease: `docs/design/round-25/03-multi-workspace-entry-review.md`
- 작성 경계: 이 파일만 작성. 제품 코드, Git, DB, coordination, worklog, ROUND 및 다른 설계 파일은 변경하지 않는다.
- 독립성: T03은 이 검수 대상인 T02 계약, T01 HTML, T08 DB lab의 작성자가 아니다. 이전 T03 작업은 별도의 라우팅 지침 인벤토리였다.
- 검수 기준 시각: `2026-07-25T01:14:29+09:00`

## 1. Provenance와 기존 FAIL 보존

이 검수는 T10의 기존 FAIL을 지우거나 덮어쓰지 않는다.

1. T10 최초 독립 검수는 다음 P0 두 건을 찾아 `FAIL`로 판정했다.
   - Concept D의 일부 상태가 실제 workspace 수와 무관한 공통 2-workspace fallback을 보여 `one`, `new-owner`, `joiner`에서 노드 수가 잘못됐다.
   - Concept C의 platform operator 상태에 tenant workspace 전환·생성·가입 quick action이 남아 platform/tenant 경계를 위반했다.
2. T01이 동일 최종 HTML에서 두 결함을 수정했다.
3. T10은 수정 해시 재검수 과정에서 도구 승인 차단 상태가 됐다. 이는 기존 FAIL의 철회나 수정본 PASS를 의미하지 않는다.
4. Controller가 T03을 독립 대체 검수자로 명시 배정했다.
5. 따라서 현재 문서는 `T10 original FAIL → corrected artifact → controller-authorized T03 replacement review`의 계보를 갖는다.

## 2. 고정 입력 영수증

| 입력 | bytes | content lines | SHA-256 | 결과 |
|---|---:|---:|---|---|
| `02-multi-workspace-authz-contract.md` | 43,346 | 596 | `ED27FB7A83D2B21D18109F197EDB444B7D74DAA3A861BA05B6D920EC622F21AF` | 기대 해시 일치 |
| `brand/MoaWork_Workspace_Entry_4Concepts_v0.1.html` | 41,687 | 425 | `2840A03E67A2173EF8DFABE1409B0B2AE87AD9FBB2D33E7A91666AEC8ACE780B` | 기대 bytes/lines/hash 모두 일치 |
| `08-multi-workspace-db-lab.md` | 11,209 | 225 | `1042C9C90251534198A8D96483530D407AC53F38D0107EF7EF39A035FFBFF44C` | 기대 해시 일치 |
| `05-multi-workspace-entry-contract.md` | 15,340 | 184 | `8DCBBF669C94D7855373BE34625ABCC5386FFC47CA36FCBF4E431955E1E288BC` | 검수 시점 스냅숏 |
| `05-multi-workspace-entry-checkpoint.md` | 9,037 | 107 | `90B30C0DA7D4EF034500929343E6333980EE09413BDE7EB18E3BF2B5F2C55DC6` | 검수 시점 스냅숏 |

T08 lab manifest도 다음과 같이 고정해 대체 파일이나 부분 lab을 검수하지 않도록 했다.

| lab 파일 | bytes | SHA-256 |
|---|---:|---|
| `README.md` | 2,882 | `AFBC3A5D6D54EEDFE851CC4244706F17647832AF4849064ED715CB664D4BCAAD` |
| `package.json` | 235 | `B995EAB6970A33BF6B8F6C3C403B2E3B1216353122C5BE62477811C02EEE96F1` |
| `package-lock.json` | 604 | `254F74C305F176E9AF397A148B8EBEE439BD472481080B5C5C8A3027371E5C05` |
| `schema.sql` | 26,675 | `EB36EB1138678B1464C319E2CB3D954A62B65D1AAAB3766CB83FAE4A7BF207C7` |
| `test/workspace-entry.test.mjs` | 22,250 | `D37FC655B462B363D4E78B0E58E2D71344160BD864502CDFE130E4A74CA058B9` |

## 3. 브라우저 전 필수 정적·상태 검수

### 3.1 정적/상태 하네스

- 결과: `25/25 PASS`, `FAIL 0`
- 수정 대상인 최종 HTML의 exact hash를 먼저 검증한 뒤 같은 바이트를 파싱했다.
- 검수한 상태: `zero`, `one`, `multiple`, `new-owner`, `pending-create`, `pending-join`, `joiner`, `operator`
- 검수한 콘셉트: A, B, C, D 총 4개

핵심 결과:

| 항목 | 기대 | 실측 | 결과 |
|---|---|---|---|
| D / one | workspace node 1 | 1 | PASS |
| D / multiple | workspace node 2 | 2 | PASS |
| D / new-owner | workspace node 1 | 1 | PASS |
| D / joiner | workspace node 1 | 1 | PASS |
| D / operator | workspace node 0 | 0 | PASS |
| C / operator | tenant switch/create/join action 0 | 0 | PASS |
| C / operator | tenant transition 없음 | operator-only container, quickbar 없음 | PASS |

추가 상태·의미 검수:

- 0/1/2+ workspace 분기가 각각 존재하고 다른 상태로 수렴하지 않는다.
- `pending-create`, `pending-join`은 각각 변경 가능한 pending panel로 라우팅되며 수정·취소 동작이 노출된다.
- B의 새 Owner onboarding은 3단계 흐름을 갖는다.
- joiner 상태에는 Owner onboarding이 노출되지 않는다.
- generic 검색은 workspace 열거 결과를 노출하지 않는다.
- exact lookup/digest match는 존재 확인 또는 요청 연결 의미일 뿐 membership/access 부여 성공으로 표현되지 않는다.
- 가짜 승인, 가짜 회사 생성 성공, 가짜 CSV write는 0건이다.
- light/dark 규칙과 toggle, `:focus-visible`, `prefers-reduced-motion` 처리가 존재한다.
- platform operator 자동 tenant 진입을 암시하는 copy는 0건이다.

### 3.2 T08 DB lab 실행

실행 명령:

```text
npm.cmd test
```

실행 위치:

```text
C:\Users\belie\Desktop\Belief\서울리드프로젝트\labs\multi-workspace-entry
```

결과:

- tests: 27
- pass: 27
- fail: 0
- skipped: 0
- cancelled: 0
- todo: 0

포함된 P0 경계:

- owner 0명/2명 commit 거부와 owner `scope=all`
- direct owner DML 및 generic member RPC를 통한 Owner 강등·삭제·승격 공격 거부
- platform operator의 tenant read/write 0
- workspace create/join 요청의 생성·수정·취소·중복·경합 형태
- digest-only invite/lookup 의미
- RLS tenant 경계와 session cutoff
- 최종 anomaly sweep

### 3.3 계약·데이터·무결성 검사

- 결과: `20/20 PASS`, `FAIL 0`
- account×workspace가 기본 데이터 축이다.
- workspace마다 protected Owner가 commit 시 정확히 1명이고 `scope=all`이다.
- Platform Admin control-plane과 workspace tenant-plane은 분리된다.
- 일반 가입은 `member` 및 최소 scope 기본값이며 Owner/관리 권한을 암묵 부여하지 않는다.
- `last_workspace`는 편의 힌트일 뿐 접근 권한의 근거가 아니다.
- 권한 변경과 session cutoff의 연결이 계약에 존재한다.
- PR19, PR20, migration 007은 근거 없는 적용 완료로 승격되지 않고 HOLD/충돌 선행해결 상태로 유지된다.
- email 형태 PII scan: 0
- secret assignment 형태 scan: 0

## 4. 비브라우저 독립 판정

**STATIC/NON-BROWSER VERDICT: PASS**

T10이 발견했던 두 P0는 고정된 최종 HTML에서 재현되지 않는다. 정적 상태 모델, 계약 의미, DB 공격 lab, 입력 무결성 및 개인정보/비밀 스캔은 모두 통과했다.

**OVERALL VERDICT: PENDING NON-APPROVAL BROWSER MATRIX**

이 시점에는 브라우저 실행 전 체크포인트이므로 전체 PASS를 아직 선언하지 않는다. 다음 단계에서 같은 HTML 해시에 대해 1280/390/320, light/dark, keyboard/focus, reduced-motion, overflow 및 console을 비승인 로컬 browser runtime으로 검수한다. 승인 요청이 필요한 별도 브라우저는 선택 사항이며 실행하지 않아도 전체 gate를 붙잡지 않는다.

## 5. 정직성 경계와 HOLD

- hosted Supabase: `NOT_CREATED`, 비용 `0`
- true multi-connection: `NOT_RUN`
- JWT→GUC: `NOT_RUN`
- PostgREST/pooler: `NOT_RUN`
- hosted migration: `NOT_RUN`
- production: `NOT_RUN`
- 현재 lab PASS는 위 운영 환경 검증을 대체하지 않는다.
- 제품 merge/deploy: `HOLD`
- 사용자 4안 시각 결정: `HOLD`
- migration 007 충돌/적용 상태: `HOLD`

## 6. CHECKPOINT — BROWSER-BEFORE

- timestamp: `2026-07-25T01:14:29+09:00`
- last successful step: exact-input verification + static/state `25/25` + DB lab `27/27, skip 0` + contract/integrity/privacy `20/20`
- checkpoint verdict: `STATIC PASS / OVERALL PENDING BROWSER`
- next step: non-approval local browser matrix
- approval-gated browser: `NOT_ATTEMPTED`
- writes outside sole lease: `0`

## 7. 비승인 로컬 브라우저 실측

검수 대상은 입력 영수증에 고정된 동일 HTML SHA-256이다. 로컬 read-only HTTP로 제공하고 Codex in-app browser의 viewport override와 제한된 Playwright API를 사용했다. T05의 브라우저 결과는 이 절의 독립 증거로 사용하지 않았다.

### 7.1 성공한 독립 검사

| 검사 | 범위 | 결과 |
|---|---|---|
| 실제 렌더링·접근성 트리 | 로컬 HTTP, 4개 article과 상태/조작 컨트롤 | PASS |
| 반응형 상태 행렬 | 1280×900, 390×844, 320×700 × 8상태 | `24/24 PASS` |
| 수평 overflow | 위 24개 조합의 document/body 및 보이는 element bounds | `0` |
| 4안 단독 전환 | A/B/C/D × 1280/320 | `8/8 PASS` |
| 테마 전환 | 1280/390/320에서 light→dark→light | `3/3 PASS` |
| 테마 전환 후 overflow | 위 3개 폭의 dark/light | `0` |
| 실제 focus 스타일 | 테마 버튼 focus에서 computed outline | `solid 3px`, PASS |

반응형 실측 세부:

- 1280 override에서 scrollbar 제외 client/scroll/body width는 모두 `1265/1265/1265`
- 390 override에서는 `375/375/375`
- 320 override에서는 `305/305/305`
- 각 8상태에서 전체 비교 시 보이는 concept panel은 4개였고 viewport 밖으로 벗어난 보이는 element는 0개였다.
- A/B/C/D 단독 전환 시 `aria-pressed=true`인 버튼과 유일하게 보이는 `data-panel` 값이 일치했다.
- light/dark 전환 후 `data-theme`, 토글 label, overflow가 모두 일치했다.

### 7.2 브라우저 caveat와 NOT_RUN

- keyboard 실제 key activation/traversal: `NOT_RUN`
  - native `button`, `select`, `input`과 `:focus-visible` 계약 및 실제 focus outline은 확인했다.
  - 이 browser runtime의 keypress 전달이 활성 element를 이동·활성화하지 않아 실제 Tab/Enter 경로를 완료 증거로 채택하지 않았다.
  - 도구 한계를 제품 FAIL로 변환하지 않으며, 후속 사용자 시각 결정/실브라우저 smoke에서 재확인한다.
- `prefers-reduced-motion` 실제 emulation: `NOT_RUN`
  - 정적 CSS 계약은 3.1에서 확인했으나 emulation 측정은 완료 증거가 되지 못했다.
- console log/error 수집: `NOT_RUN`
- 승인-gated 별도 browser: `NOT_RUN`이며 gate를 보유하지 않는다.
- screenshot/사용자 시각 승인: `NOT_RUN`; 사용자의 4안 선택 gate가 별도로 남는다.

## 8. 최종 독립 판정

**FINAL VERDICT: PASS**

판정 근거는 T03이 독립 실행한 다음 비브라우저 증거가 중심이다.

- exact input/hash: 일치
- static/state: `25/25 PASS`
- DB lab: `27/27 PASS`, skip `0`
- contract/integrity/privacy: `20/20 PASS`
- T10 원 P0 재검증:
  - D nodes `one=1`, `multiple=2`, `new-owner=1`, `joiner=1`, `operator=0`
  - C operator tenant switch/create/join `0`, tenant transition `0`
- 추가 독립 browser corroboration:
  - responsive states `24/24`
  - concept switching `8/8`
  - light/dark `3/3`
  - horizontal overflow `0`

이 PASS는 계약·정적 산출물·로컬 lab에 대한 검수 PASS다. 다음을 승인하지 않는다.

- product merge/deploy: `HOLD`
- production readiness: `NOT_RUN`
- hosted Supabase/migration: `NOT_CREATED / NOT_RUN`
- true multi-connection, JWT→GUC, PostgREST/pooler: `NOT_RUN`
- PR19/PR20 및 migration 007: 기존 HOLD 유지
- 사용자 시각 결정: `HOLD`

## 9. 결과 패킷

- WORK-ID: `MULTI-WORKSPACE-ENTRY-INDEPENDENT-REVIEW-03`
- provenance: `T10 original FAIL → approval stall → controller-authorized T03 transfer → T03 PASS`
- consumer: `T05 / MWC / user / T09`
- defect/rework lease: 없음
- product write: `0`
- Git/DB/deploy write: `0`
- sole leased artifact 외 write: `0`
- NEXT_WORK: `MULTI-WORKSPACE-ENTRY-USER-DECISION-01`
- release condition: T05 FOREMAN_REVIEW 후 사용자 4안 시각 결정으로 이동
