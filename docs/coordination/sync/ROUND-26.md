# SYNC Round 26 — 멀티 Workspace 진입 4안 및 격리 DB Lab

> 작성: T09 coordination collector · 2026-07-25 KST
> WORK-ID: `MULTI-WORKSPACE-ENTRY-ROUND-26-01`
> 최종 판정: `PASS_WITH_BROWSER_GAP / USER_VISUAL_SELECTION_PENDING`
> 범위: prototype 사용자 시각 선택에는 충분하지만 제품 구현·merge·deploy 승인에는 부족하다.

## 1. 이번 Round의 정본 범위

- Round 25 이후 `MULTI-WORKSPACE-ENTRY-LAB-01`의 실제 작업원 산출물, 승인-stall 복구, 독립 checkpoint와 남은 운영 gap을 하나의 새 coordination 정본으로 수렴한다.
- 이 문서는 Round 25와 기존 artifact를 덮어쓰지 않는다. 각 PASS·FAIL·`NOT_RUN`·`BLOCKED_BY_TOOL_APPROVAL` 이력을 그대로 연결한다.
- T09 writer 범위는 이 신규 `ROUND-26.md`와 `docs/worklog.md` 끝 append뿐이다.
- 제품 코드, 브랜드 HTML, lab, Git stage/commit/push, PR, migration, DB, merge, deploy, Production, partner/member write는 수행하지 않는다.
- 채팅 final은 완료 근거가 아니다. 아래 상태는 실제 파일과 고정된 receipts를 대조한 결과다.

## 2. 전체 결론

사용자는 Google 계정으로 인증할 수 있지만 tenant 권한은 각 Workspace의 active membership에서만 얻는다. active membership이 0개인 사용자는 권한 오류로 되돌리지 않고 안전한 생성·합류 진입점으로 안내한다. 한 개면 해당 Workspace로, 두 개 이상이면 사용자가 선택하는 `/workspaces`로 보낸다. Platform 운영 권한은 tenant membership이 아니며, `last_workspace`도 접근 권한의 근거가 아니다.

이 계약은 정적·상태 검증, PGlite 격리 DB lab, controller가 수용한 독립 non-browser checkpoint까지 통과했다. 최종 HTML은 원래 T10이 발견한 두 결함을 수정했다. 다만 T03의 선택적 독립 브라우저 단계는 approval-stall로 `NOT_RUN`이므로 판정은 `PASS_WITH_BROWSER_GAP`이다. T05의 실제 브라우저 corroboration은 사용자에게 prototype을 보여줄 근거지만 독립 브라우저 PASS나 제품 release 증거로 승격하지 않는다.

## 3. 고정된 제품·권한 결정

### 3.1 로그인 후 진입

| active membership | 서버 결정 | 사용자 화면 | 금지 |
|---:|---|---|---|
| 0 | `/workspace-entry` | 회사 만들기 신청, 기존 회사 합류 신청, 자기 pending 확인·수정·취소 | `permission denied`, 자동 Workspace/Owner 생성, tenant 데이터 조회 |
| 1 | 유일한 active Workspace | 해당 Workspace home, switcher 진입 유지 | cookie나 stale preference만 신뢰 |
| 2+ | `/workspaces` | 사용자가 Workspace 선택 | 첫 행·Owner 행 자동 선택 |

- Google 로그인은 특정 회사 도메인에 닫지 않는다.
- `last_workspace`는 편의값이다. 삭제·정지·membership 회수 또는 다른 계정의 값이면 폐기하고 안전한 선택 흐름으로 돌아간다.
- role·scope·status는 account가 아니라 `account × workspace membership`에 속한다.
- pending create/join/invite는 membership이 아니며 tenant 권한을 만들지 않는다.

### 3.2 생성·합류·Owner

- Platform create 승인 transaction은 Workspace와 requester의 유일한 `owner/all/active` membership, profile, result, audit를 함께 만들거나 전부 rollback한다.
- Platform 승인자는 requester만 Owner로 만들며 자신에게 tenant membership이나 tenant 데이터 접근권을 자동 부여받지 않는다.
- 기존 Workspace의 join 승인은 현재 protected Owner가 처리한다. 승인 기본값은 `member/minimal`이며 payload로 Admin·Owner 승격을 주입할 수 없다.
- Workspace마다 protected Owner는 정확히 한 명이고 Owner scope는 `all`이다.
- Owner direct DML·일반 membership mutation으로 owner 0명 또는 2명을 만들 수 없다. Owner 변경은 재인증·잠금·session cutoff·audit가 있는 별도 transaction이 필요하다.
- Platform control plane과 tenant membership/RLS는 분리한다. Platform role은 Workspace role·scope·Owner를 합성하지 않는다.

### 3.3 신규 Owner와 기존 joiner

- 신규 Owner의 고정 온보딩은 B 흐름: `회사 → 팀원 초대 → CSV 가져오기`다.
- 기존 Workspace에 합류한 member는 회사 생성과 Owner 온보딩을 반복하지 않는다.
- 첫 진입 4안의 사용자 선택과 신규 Owner B 온보딩 결정은 다른 축이다. 첫 진입 기본 구조를 B로 자동 확정하지 않는다.

## 4. 실제 작업원 provenance

| 작업원 | threadId | WORK-ID | 실제 상태 | 권위 산출물·증거 |
|---|---|---|---|---|
| T02 | `019f7fe5-46ea-7c00-b298-6dc690516250` | `MULTI-WORKSPACE-AUTHZ-CONTRACT-01` | `PASS / RELEASE` | [`02-multi-workspace-authz-contract.md`](../../design/round-25/02-multi-workspace-authz-contract.md) |
| T04 | `019f7fe5-da4e-79f3-9027-a488c90eaf08` | `MULTI-WORKSPACE-ENTRY-UX-4CONCEPTS-01` | original materialization 뒤 `BLOCKED_BY_TOOL_APPROVAL` | 원본 보정 SHA `F8C4E6E6...51E2`; P0 rework completion은 주장하지 않음 |
| T08 | `019f8055-62e4-7e63-8767-2da2d66ef3ad` | `MULTI-WORKSPACE-DB-LAB-01` | `PASS / RELEASE` | [`08-multi-workspace-db-lab.md`](../../design/round-25/08-multi-workspace-db-lab.md), 27/27 skip 0 |
| T10 | `019f8056-311c-7402-81cd-247526ca457c` | `MULTI-WORKSPACE-ENTRY-INDEPENDENT-REVIEW-01/02` | original `FAIL`, corrected rerun `BLOCKED_BY_TOOL_APPROVAL` | D one/two-node, C operator tenant action 결함 발견; FAIL 이력 보존 |
| T01 | `019f7fe4-f9ca-76a2-b6ad-5dca321f546e` | `MULTI-WORKSPACE-ENTRY-UX-P0-REWORK-02` | `PASS / OWNED FINAL`, worker browser `NOT_RUN` | corrected HTML, whole-file static/state 20/20 |
| T03 | `019f7fe5-9278-7f61-9d4a-698fcd476303` | `MULTI-WORKSPACE-ENTRY-INDEPENDENT-REVIEW-03` | controller-accepted checkpoint PASS / browser `NOT_RUN` | [`03-multi-workspace-entry-review.md`](../../design/round-25/03-multi-workspace-entry-review.md) |
| T05 | `019f7fe6-0310-7713-9ad6-0c76bbceebf3` | `MULTI-WORKSPACE-ENTRY-LAB-01` | integrated `PASS_WITH_BROWSER_GAP` | contract·checkpoint와 browser/DB corroboration |

### 4.1 writer/reviewer transfer 이력

1. T04가 원본 HTML을 materialize했지만 approval-gated browser 상태에서 writer lease를 장시간 보유했다.
2. T10은 원본 SHA에서 D안 one-membership이 두 노드를 보이는 문제와 C안 Platform Operator에게 tenant switch/join/create action이 노출되는 문제를 찾아 `FAIL`로 판정했다.
3. controller가 T04 재작업을 지시했으나 approval-stall이 해소되지 않았다.
4. revoke 직전 T01의 좁은 임시 patch가 materialize된 사실을 숨기지 않는다. controller는 이후 기존 임시 작업과 구분되는 T01 fresh replacement lease를 명시적으로 승인했다.
5. T01 owned final은 전체 파일을 다시 읽고 static/state 20/20을 통과했다.
6. T10 corrected-hash rerun도 approval-stall로 끝나 controller가 review gate만 T03에 명시적으로 transfer했다.
7. T03은 browser call 전에 non-browser checkpoint를 고정했고 controller는 선택지 A로 그 checkpoint를 수용했다. 선택적 browser는 `BLOCKED_BY_TOOL_APPROVAL / NOT_RUN`이며 final browser receipt를 꾸미지 않는다.
8. 실제 T01~T10 작업원을 subagent로 대체하지 않았다. subagent 결과를 실제 T 작업원 산출물로 표기한 항목은 없다.
9. `No subagents substituted actual T workers.`

## 5. 실제 artifact receipts

| artifact | bytes / lines | SHA-256 | 의미 |
|---|---:|---|---|
| [`MoaWork_Workspace_Entry_4Concepts_v0.1.html`](../../../../brand/MoaWork_Workspace_Entry_4Concepts_v0.1.html) | 41,687 / 425 | `2840A03E67A2173EF8DFABE1409B0B2AE87AD9FBB2D33E7A91666AEC8ACE780B` | T01 owned corrected final |
| [`02-multi-workspace-authz-contract.md`](../../design/round-25/02-multi-workspace-authz-contract.md) | 43,346 / 595 | `ED27FB7A83D2B21D18109F197EDB444B7D74DAA3A861BA05B6D920EC622F21AF` | T02 contract PASS/RELEASE |
| [`08-multi-workspace-db-lab.md`](../../design/round-25/08-multi-workspace-db-lab.md) | 11,209 / 224 | `1042C9C90251534198A8D96483530D407AC53F38D0107EF7EF39A035FFBFF44C` | T08 DB lab PASS/RELEASE |
| [`03-multi-workspace-entry-review.md`](../../design/round-25/03-multi-workspace-entry-review.md) | 7,846 / 155 | `A75DCD9273B01073E67B6AA43413ECD3ACC06068CAEFF85742E8F51DF4E3FE92` | T03 checkpoint; controller accepted, browser NOT_RUN |
| [`05-multi-workspace-entry-contract.md`](../../design/round-25/05-multi-workspace-entry-contract.md) | 16,059 / 185 | `B0E44137E7997BC890914515F5535166141E5EF002C440BD1F370CCD314BE031` | T05 integrated contract |
| [`05-multi-workspace-entry-checkpoint.md`](../../design/round-25/05-multi-workspace-entry-checkpoint.md) | 10,022 / 122 | `EF0FEA1D431204283C881CFE8BB55B9E0DED953B4226442E880EB6AC12A3ED88` | T05 provenance/checkpoint |

- 이 Round 작성 시 HTML URL `http://127.0.0.1:4322/MoaWork_Workspace_Entry_4Concepts_v0.1.html`은 HTTP 200, 응답 41,687 bytes로 재확인했다.
- receipts는 이번 수렴 시점 입력 snapshot이다. T09 hub 해시 변화만을 이유로 upstream에 cosmetic rewrite를 요구하지 않는다.
- T03 artifact를 `FINAL BROWSER PASS`로 부르지 않는다. 위 7,846-byte receipt는 controller가 수용한 checkpoint의 실제 파일 receipt다.

## 6. HTML 결함 교정과 브라우저 corroboration

### 6.1 원래 FAIL과 최종 교정

- 원본 D안은 one/new-owner/joiner 상태가 multiple fallback을 공유해 one-membership에서도 Workspace node 2개를 그렸다.
- 원본 C안은 Platform Operator 상태에서 tenant switch/join/create quick action을 노출했다.
- corrected final은 D node count를 `one=1`, `multiple=2`, `new-owner=1`, `joiner=1`, `operator=0`으로 고정했다.
- corrected final은 C operator tenant action을 0으로 만들고 operator-only 설명만 남겼다.
- 이 교정은 T10의 원래 FAIL을 삭제하지 않는다. 결함 발견과 승인-stall 이력이 재발 방지 근거다.

### 6.2 T05 실제 브라우저 corroboration

- URL: `http://127.0.0.1:4322/MoaWork_Workspace_Entry_4Concepts_v0.1.html`.
- 1280 / 390 / 320 × 8개 상태에서 가로 overflow 0.
- D: one 1 / multiple 2 / new-owner 1 / joiner 1 / operator 0.
- C: Platform Operator tenant transition action 0.
- light/dark, focus-visible, reduced-motion rule, pending 수정, generic 동일 응답, 신규 Owner B, joiner Owner 안내 제외를 확인했다.
- browser console warning/error 0.
- 이 증거는 foreman corroboration이다. T03 독립 browser가 `NOT_RUN`이므로 `PASS_WITH_BROWSER_GAP`을 유지한다.

## 7. 격리 DB Lab 결과와 한계

- Lab ID: `MW-DB-LAB-PGLITE-20260725-V1`.
- T08 actual: 27/27 PASS, failed 0, skipped 0.
- T05 독립 재실행: 27/27 PASS, exit 0.
- 실제 검증 범위: role/grant, RLS, PL/pgSQL, deferred constraint trigger, transaction rollback, unique/idempotency, session cutoff, audit rollback.
- owner 0/2, owner direct DML·일반 RPC, Platform tenant bypass, cross-tenant 승인, join payload Owner/Admin 주입, digest invite 공격을 차단했다.
- create 승인 결과는 requester sole owner/all이고 Platform 승인자 membership은 0이다.
- join 승인 결과는 고정 `member/minimal`이고 재실행은 idempotent하다.
- Hosted Supabase는 `NOT_CREATED`, 비용 0이다. 안전한 credential/tool과 무료 생성 경로가 없어 만들지 않았다.
- PGlite는 single-connection engine이다. queued contention을 true multi-connection race PASS로 승격하지 않는다.

### 명시적 NOT_RUN

- true multi-connection race
- Supabase Auth JWT → GUC/claim mapping
- PostgREST RPC exposure/grants
- pooler 경유 동시성
- hosted migration compatibility
- Production DB·실사용자 동작

## 8. PR #19/#20와 운영 HOLD

- PR #19는 복수 membership에서 Owner를 우선 자동 선택하거나 Platform 판정으로 Workspace를 자동 생성하는 경로가 새 계약과 충돌한다.
- PR #20은 자동 첫 고객·첫 업무 흐름 및 migration `007` 번호 충돌이 있다.
- PR #19/#20의 과거 CI/Preview green은 새 AuthZ 계약, 새 base, live DB 또는 Production PASS가 아니다.
- 새 계약은 기존 PR을 자동 rebase·merge하거나 migration을 적용할 권한이 아니다.
- 현재 제품 코드, PR #19/#20, Production DB, migration, merge, deploy, partner/member write는 모두 `HOLD`다.

## 9. 재발 방지 규칙

### writer

- sole writer는 bytes/hash를 freeze하고 lease를 release하기 전 approval-gated browser 단계에 들어가지 않는다.
- browser 승인이 필요하면 writer 산출물과 정적 checkpoint를 먼저 materialize하고 read-only verifier로 넘긴다.
- `waitingOnApproval`이 bounded wait를 넘기면 `BLOCKED_BY_TOOL_APPROVAL`로 기록한다. 임의 writer transfer는 금지하며 controller의 명시 receipt가 있어야 한다.

### reviewer

- reviewer는 optional browser 전에 완전한 non-browser 판정/checkpoint를 쓴다.
- approval-stall이 sole review gate를 무기한 점유하지 않게 한다.
- browser `NOT_RUN`을 PASS로 꾸미지 않고, foreman corroboration과 independent verdict를 구분한다.
- 원래 FAIL은 corrected candidate가 생겨도 보존한다.

## 10. 사용자 선택 gate

### 네 가지 보기

| 안 | 기본 성격 | 권장 사용처 |
|---|---|---|
| A 빠른 관문 | 만들기/합류를 즉시 고르는 두 카드 | 소속 0개의 기본 진입, 작은 조직 |
| B 안내 경로 | 한 화면 한 결정의 단계형 안내 | 승인된 신규 Owner 온보딩: 회사 → 초대 → CSV |
| C 회사 허브 | Workspace·요청·계정을 한 허브에서 전환 | active membership 2개 이상의 switcher |
| D 안전 지도 | 계정과 Workspace 관계를 시각적으로 설명 | 고급 도움말·복잡 조직의 권한 교육 |

### 추천과 질문

- 추천: **A를 소속 0개의 기본 진입으로 사용하고, C는 2개 이상 Workspace switcher에 적용하며, B는 이미 확정된 신규 Owner 온보딩에만 사용한다. D는 고급 도움말로 둔다.**
- 사용자 질문: 소속 0개인 첫 진입의 기본 구조를 A/B/C/D 중 무엇으로 할 것인가?
- 현재 exact WORK-ID: `MULTI-WORKSPACE-ENTRY-USER-DECISION-01`.
- 현재 상태: `PASS_WITH_BROWSER_GAP / USER_VISUAL_SELECTION_PENDING / PRODUCT_HOLD`.

사용자 선택은 prototype 방향 승인이다. 선택만으로 제품 구현·DB write·merge·deploy 권한이 열리지 않는다.

## 11. 선택 후 별도 구현 gate

사용자 선택 뒤에만 `MULTI-WORKSPACE-ENTRY-IMPLEMENT-01`을 별도 검토한다. 최소 진입 조건은 다음과 같다.

1. current main과 PR #19/#20의 exact base/head 및 migration apply state 재고정
2. migration 번호 충돌 해소와 단일 DB/RLS writer·worktree·lease
3. disposable hosted 또는 실제 multi-connection PostgreSQL 공격 fixture
4. JWT→GUC, PostgREST grant, pooler, hosted migration 검증
5. 선택 UI의 제품 구현·테스트·독립 T10 검수
6. 새 PR/CI/Preview와 사용자 실제 화면 승인
7. 별도 merge·Production·운영 승인

이 조건 전에는 기존 PR을 수정하거나 Production에 적용하지 않는다.

## 12. Blindspot Pass

- Owner 장기 부재·사망·법적 이전, Workspace 폐업·복구, Owner transfer ceremonial flow는 별도 계약이 필요하다.
- 회사 검색 abuse, invite 전달 채널, 다중 pending 알림, 보존·삭제 정책을 기본 진입 구현에 암묵적으로 포함하지 않는다.
- 작은 조직 UX를 단순하게 만들더라도 권한 근거를 cookie, 이메일 도메인, Platform role 또는 `last_workspace`로 추정하지 않는다.
- 여러 Workspace 성장 경로를 열더라도 active membership 2+에서 자동 선택하지 않는다.
- B 신규 Owner 온보딩과 workspace-entry 기본 시각 구조를 혼동하지 않는다.

## 13. Coordination 종료 상태

- T09는 실제 artifact와 receipts를 수집해 이 Round를 materialize했다.
- final verdict: `PASS_WITH_BROWSER_GAP / USER_VISUAL_SELECTION_PENDING`.
- sufficient: prototype을 사용자에게 보여주고 A/B/C/D 방향을 묻는다.
- insufficient: 제품 구현, PR/merge, DB migration, deploy, Production release.
- 다음 exact WORK-ID: `MULTI-WORKSPACE-ENTRY-USER-DECISION-01`.
- 현재 checkout의 기존 tracked/untracked dirty 상태를 보존했다. stage/reset/clean/delete/rename/commit/push를 수행하지 않았다.
