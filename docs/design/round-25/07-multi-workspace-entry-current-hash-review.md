# Multi-Workspace Entry — exact-current-hash independent review

> WORK-ID: `MULTI-WORKSPACE-ENTRY-CURRENT-HASH-REVIEW-01`
> actual worker: T07 / conflict-free independent reviewer
> foreman: actual T05
> sole write lease: this file only
> review target: `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_Workspace_Entry_4Concepts_v0.1.html`
> exact target: **41,687 bytes / 425 lines / SHA-256 `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5`**
> final verdict: **`PASS — EXACT CURRENT HASH`**
> browser verdict: `PASS — LOCAL HTTP RUNTIME / RESPONSIVE / ACCESSIBILITY SMOKE`
> product state: `HOLD — 사용자 Concept 선택과 후속 승인 전 제품 반영 금지`

## 1. Review identity, scope, and non-approval rule

T07은 이 HTML, T02 계약, T08 DB lab을 작성하지 않았다. 검수 중 제품 코드, Git, DB,
coordination, worklog, ROUND, HTML을 수정하지 않았으며 이 문서만 작성한다.

이번 판정은 위 `D3A43...A2A5` 바이트에만 유효하다. 브라우저 실행에 별도 승인이
필요하면 승인 대기로 멈추지 않고 `NOT_RUN`으로 닫는다. 브라우저 결과는 정적·계약·DB
검증과 분리해 기록한다.

## 2. Frozen inputs

| 입력 | bytes | lines | SHA-256 | 역할 |
|---|---:|---:|---|---|
| current HTML | 41,687 | 425 | `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5` | 이번 판정 대상 |
| T02 AuthZ contract | 43,346 | 595 | `ED27FB7A83D2B21D18109F197EDB444B7D74DAA3A861BA05B6D920EC622F21AF` | tenant/Owner/operator 경계 |
| T08 DB lab receipt | 11,209 | 224 | `1042C9C90251534198A8D96483530D407AC53F38D0107EF7EF39A035FFBFF44C` | 로컬 PostgreSQL/RLS 실행 근거 |
| T05 entry contract | 16,152 | 185 | `316860F5A68DA81D84884B197BD42C8EB962EDF49655D98412F06B290F37CA4A` | 화면·상태 계약 |

Freeze 재측정은 `Get-FileHash -Algorithm SHA256`, byte length, 물리 line count로 했다.
HTML에는 trailing whitespace 0줄, NUL 0개, replacement character 0개이며 외부 script
참조와 하드코딩 이메일/자격증명 할당 패턴은 각각 0건이다. 인라인 JavaScript는
`new Function` 구문 검사에 통과했다.

## 3. Drift provenance and corrected delta contract

### 3.1 보존할 과거 판정

- old candidate: 41,687 bytes / 425 lines / SHA-256
  `2840A03E67A2173EF8DFABE1409B0B2AE87AD9FBB2D33E7A91666AEC8ACE780B`.
- T03의 당시 FAIL은 세 번째 변경이 선언되지 않은 상태에서의 **declaration mismatch
  FAIL**이었다. 보안·상태 회귀 FAIL로 다시 쓰지 않는다.
- T03은 exact-current 보안/상태 15/16, P0 회귀 0, D counts와 C operator action 경계를
  통과시켰고, 유일한 실패는 미신고 세 번째 치환이었다.
- 이후 T05가 아래 세 치환 전부를 명시적으로 delta contract에 포함하고 current
  `D3A43...A2A5`를 freeze했다. 따라서 본 검수는 수정된 3-change 선언을 기준으로 한다.

### 3.2 독립 분류

| # | 위치·분기 | old → current | 독립 분류 | 동작/계약 영향 |
|---:|---|---|---|---|
| 1 | `mapNodes()`, operator branch, HTML line 363 첫 label | `tenant 소속 0곳` → `회사 소속 0곳` | visible copy | 노드 수·분기·이벤트 변화 없음 |
| 2 | `mapNodes()`, operator branch, HTML line 363 second label | `없음 · tenant 진입 0` → `없음 · 회사 진입 0` | visible copy | operator tenant 진입 0 의미를 한국어화, 허용 범위 확대 없음 |
| 3 | `mapNodes()`, fail-closed fallback, HTML line 369 | `tenant 진입 0` → `회사 진입 0` | visible copy | 미확인 상태의 0 진입 fail-closed 동작 유지 |

실제 current 문자열 개수는 `회사 소속 0곳` 1, `없음 · 회사 진입 0` 1이고, old
세 문자열은 모두 0이다. old/current 바이트 차이는 18 bytes, 3 ranges, HTML line
363과 369에 한정된다는 T03 복구 근거와 일치한다.

T04 receipt의 “두 wording types”는 `소속` 표기와 `진입` 표기의 **유형 2개**를 센
표현이다. 실제 substitution site는 **3개**다. 유형 수와 변경 지점 수를 혼동하거나
세 번째 fallback 변경을 숨기지 않는다.

판정: receipt/declaration은 T05 correction으로 해소됐고, format-only 변경은 아니다.
세 변경은 사용자에게 보이는 copy이지만 behavior/authorization/route/data contract는
변경하지 않는다.

## 4. Exact implementation branches

| 함수/영역 | exact current branch | 독립 확인 |
|---|---|---|
| `contentFor()` lines 334–342 | `pending-create`, `pending-join`, `one`, `multiple`, `new-owner`, `joiner`, `operator`, fallback `zero` | 8개 상태가 각각 명시 분기 |
| Concept C lines 354–360 | operator면 `data-operator-only="true"`; 일반 tenant quickbar/CTA/switch를 반환하지 않음 | operator tenant switch/create/join/transition action 0 |
| `mapNodes()` lines 362–369 | operator 0, zero/pending 0, multiple 2, new-owner 1, joiner 1, one 1, fallback 0 | 원래 T10 D 결함 카운트와 일치 |
| event delegation lines 387–420 | scenario/theme/concept 전환과 prototype action을 제한된 data attribute로 처리 | 서버 성공을 만들거나 권한을 부여하는 코드 없음 |

## 5. Static/state matrix — all 8 scenarios × all 4 concepts

정적 harness는 exact hash를 먼저 확인하고 8 scenario × 4 concept = **32/32 route
combinations**를 검사했다. 아래 표의 셀은 각 조합에서 요구되는 정보구조가 존재하며
script 분기가 해당 scenario를 유지한다는 뜻이다. 이 표는 시각 픽셀 판정이 아니다.

| scenario | A: decision-first | B: onboarding | C: workspace shell | D: relationship map |
|---|---|---|---|---|
| `zero` | 생성/참여 선택, 승인 전 성공 아님 | 신규 Owner와 joiner 시작 단계 분리 | active tenant 없는 시작 shell | 회사 진입 0 fallback |
| `one` | 단일 소속 업무 진입 | 재-onboarding 강제 없음 | 단일 Workspace 맥락 | node 1 |
| `multiple` | 선택을 먼저 요구 | 선택 후 흐름 | switch 가능 상태 | node 2 |
| `pending-create` | 요청 상태·수정/취소 | 생성 대기 단계 | membership처럼 취급 안 함 | tenant node 0 |
| `pending-join` | 요청 상태·수정/취소 | join 대기 단계 | membership처럼 취급 안 함 | tenant node 0 |
| `new-owner` | 신규 회사 생성 경로 | Owner 전용 onboarding | 승인 전 tenant 진입 성공 아님 | node 1 only after represented result state |
| `joiner` | 기존 회사 참여 경로 | Owner onboarding과 분리 | minimal 시작 의미 유지 | node 1; Owner 승격 의미 없음 |
| `operator` | control-plane 안내 | tenant onboarding 배제 | operator-only shell | tenant node 0, 회사 진입 0 |

Static harness summary: **58/58 PASS**, 그중 route matrix **32/32 PASS**. 첫 두
보조 실행은 PowerShell→Node pipeline의 문자 인코딩과 절대경로 전달 문제로 실행되지
않았고 제품 실패로 세지 않았다. 경로를 ASCII relative path로 바꾼 최종 harness와
PowerShell Unicode exact-string scan으로 보정했다.

## 6. Original T10 defect matrix and required edge coverage

| 검사항목 | 기대 | current exact result | 판정 |
|---|---:|---:|---|
| D `one` | 1 node | 1 | PASS |
| D `multiple` | 2 nodes | 2 | PASS |
| D `new-owner` | 1 node | 1 | PASS |
| D `joiner` | 1 node | 1 | PASS |
| D `operator` | 0 tenant node | 0 | PASS |
| C operator tenant switch | 0 | 0 | PASS |
| C operator create | 0 | 0 | PASS |
| C operator join | 0 | 0 | PASS |
| C operator tenant transition | 0 | 0 | PASS |
| membership 0/1/2+ | zero/one/multiple로 분리 | explicit branches | PASS |
| pending create modify/cancel | 제공, membership 아님 | present | PASS |
| pending join modify/cancel | 제공, membership 아님 | present | PASS |
| B onboarding | Owner와 joiner 분리 | 3-step structure + distinct branches | PASS |
| joiner exclusion | Owner 권한/자동승격 없음 | no Owner promotion path | PASS |
| operator boundary | control plane만, tenant action 0 | operator-only branch | PASS |
| generic enumeration | 존재·Owner·인원 노출 0 | generic wording, exact lookup access 0 | PASS |
| fake success | 요청/세션/CSV/DB 성공 주장 0 | prototype action only | PASS |

## 7. Contract, privacy, and execution boundaries

### 7.1 T02 contract alignment

- 로그인 identity와 Workspace membership을 분리한다.
- active membership 0/1/2+를 서버 권한판정의 입력으로 삼고, 2+에서 첫 행·Owner를
  자동 선택하지 않는다.
- protected Owner는 Workspace마다 exact one/all이며 일반 membership mutation 대상이
  아니다.
- Platform operator는 tenant membership이 아니고 tenant UI/role/scope를 우회하지 않는다.
- pending create/join은 membership이 아니며 tenant SELECT/WRITE를 열지 않는다.
- exact/generic lookup은 존재·Owner·구성원 수·가입 여부를 불필요하게 열거하지 않는다.
- create 승인은 requester만 Owner로 만들며, join 승인은 `member/minimal`에서 시작한다.
- cookie, slug, last-workspace는 편의값이며 authorization proof가 아니다.

HTML은 이 경계를 설명하는 prototype이며 실제 RLS, session cutoff, 승인 transaction을
구현했다고 주장하지 않는다. 따라서 화면 PASS를 authz 실행 PASS로 확대하지 않는다.

### 7.2 T08 current local lab evidence

`C:\Users\belie\Desktop\Belief\서울리드프로젝트\labs\multi-workspace-entry`에서
`npm.cmd test`를 다시 실행해 **27/27 PASS, fail 0, skip 0**을 확인했다. local PGlite
PostgreSQL/RLS에서 owner exact-one/all, 일반 DML/RPC owner 공격 차단, operator tenant
read/write 0, create/join 중복·취소·거절·재요청·승인·멱등·rollback, cross-tenant,
digest-only, lifecycle, audit, session cutoff, anomaly sweep을 실행했다.

다음은 명시적으로 **NOT_RUN**이다.

- true multi-connection race — engine limitation
- Supabase Auth JWT → GUC/claim mapping
- PostgREST RPC exposure/grants
- hosted Supabase/pooler/migration compatibility
- production DB, real-user behavior, merge, deploy

로컬 lab PASS는 hosted/production PASS가 아니다.

### 7.3 PII, secret, and whitespace scan

| 검사 | 결과 | 판정 |
|---|---:|---|
| 외부 `<script src>` | 0 | PASS |
| 이메일 형태 fixture | 0 | PASS |
| token/password/secret assignment pattern | 0 | PASS |
| trailing spaces/tabs | 0 lines | PASS |
| NUL | 0 | PASS |
| Unicode replacement character | 0 | PASS |
| raw invite/token/customer record | 없음 | PASS |

## 8. Responsive/accessibility browser matrix

| 검사항목 | 1280 | 390 | 320 | 현재 상태 |
|---|---|---|---|---|
| horizontal overflow, all 8 scenarios | 0/8 | 0/8 | 0/8 | PASS, 24/24 |
| concepts A/B/C/D in all-comparison mode | 4/4 visible | 4/4 visible | 4/4 visible | PASS |
| concept filter A/B/C/D/all | runtime 5/5 | runtime 5/5 | runtime 5/5 | PASS; 한 번의 320 실행으로 state machine 확인 |
| light/dark | light→dark 전환 | dark에서 overflow 0 | theme reset 확인 | PASS |
| keyboard focus | select focus-visible | solid 3px outline | CSS 동일 적용 | PASS smoke |
| reduced motion | emulated `reduce` | media query match | transition/animation 0.01ms | PASS |
| console warning/error | 0 | 0 | 0 | PASS |

Local HTTP는 `200`, 41,687 bytes, SHA-256 `D3A43...A2A5`로 disk freeze와 일치했다.
브라우저 runtime 결과:

- 8 scenarios × 3 viewports = **24/24**에서 `scrollWidth === clientWidth`, horizontal
  overflow 0.
- 모든 조합에서 A/B/C/D panel 4개가 render됐고 각 panel rect는 viewport 안에 있었다.
- D workspace node 수는 `zero 0 / one 1 / multiple 2 / pending-create 0 /
  pending-join 0 / new-owner 1 / joiner 1 / operator 0`으로 세 viewport에서 동일했다.
- C operator는 `data-operator-only=1`, tenant `switch-scenario` action 0이었다.
- pending create/join은 각 concept에 modify 1 + cancel 1, 전체 비교에서 각각 4 + 4였다.
- A/B/C/D/all filter는 선택마다 pressed target 1개, visible panel은 target 1개 또는 all
  4개로 runtime 동작했다.
- light→dark에서 `data-theme=dark`, body background 변경, overflow 0; 종료 전 light로
  복원했다.
- keyboard focus가 scenario select에 놓였을 때 solid 3px outline을 확인했다.
- CDP media emulation에서 `prefers-reduced-motion: reduce=true`, scroll behavior `auto`,
  transition/animation duration `0.00001s`; 종료 전 no-preference로 복원했다.
- console warning/error 0.

320 normal viewport screenshot에서 header, headline, principle card, selector와 concept tabs가
읽을 수 있는 정상 폭으로 표시됐다. sticky header가 있는 full-page stitched capture는 backend
stitching 중 header가 반복되고 축소되어 시각 판정에서 제외했으며, normal viewport와 computed
rect/overflow를 근거로 판정했다. 1280 override의 screenshot API는 host physical crop을 반환해
픽셀 캡처 근거로 쓰지 않았고, 1280 DOM viewport `innerWidth=1280`, panel bounds, overflow
수치로 판정했다.

Generic lookup runtime도 A안에서 확인했다. 응답은 회사 존재 여부·개수·이름을 공개하지
않는 동일 envelope였고, 검색 action 뒤에도 “회사가 있든 없든 똑같이 안내”만 발표했다.
membership/tenant access나 성공 상태는 생성하지 않았다.

## 9. CHECKPOINT — NON-BROWSER COMPLETE

- checkpoint time: `2026-07-25 Asia/Seoul`
- exact candidate: `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5`
- freeze: 41,687 bytes / 425 lines
- syntax/static/state: 58/58 PASS; 8×4 routes 32/32 PASS
- T08 local DB/RLS rerun: 27/27 PASS; hosted/multi-connection/JWT/PostgREST NOT_RUN
- corrected three-copy delta: 3/3 declared and present; behavior/contract changes 0
- privacy/secret/whitespace: PASS
- browser: `PASS — local HTTP exact hash, 24/24 viewport-state, 5/5 concept filter`
- last successful step: complete non-browser evidence written to the sole leased artifact
- browser completion: in-app local review; temporary viewport/media/theme state reset; tab finalized
- next step: exact-hash re-freeze and artifact receipt

## 10. Recurrence and release rule

1. 이 verdict는 `D3A43...A2A5`에만 bind한다.
2. 독립검수 뒤 도착한 receipt가 candidate bytes를 바꾸면 이 verdict는 자동 `STALE`이다.
3. 새 bytes는 새 exact-hash 독립검수 없이는 PASS를 상속하지 않는다.
4. late worker는 lease release 뒤 HTML 또는 본 검수 파일에 쓰지 않는다.
5. FAIL이면 HTML writer lease를 임의로 T07이 가져가지 않고 actual T05가 conflict-free
   worker를 다시 지정한다.

## 11. Final disposition

**PASS — exact current D3A43 hash.** 수정된 3-change declaration, 정적/state matrix,
current T02/T08 경계, local HTTP runtime, responsive/accessibility smoke에 P0 회귀가 없다.
이 PASS는 hosted Supabase, true multi-connection, production, merge 또는 deploy PASS가 아니다.
사용자 Concept 선택 전에는 제품 반영, merge, deploy를 진행하지 않는다.

Expected next on final PASS:

- `ROUND-28` unblock
- `MULTI-WORKSPACE-ENTRY-USER-DECISION-01`
- consumer: T05 / T09 / MWC / user
