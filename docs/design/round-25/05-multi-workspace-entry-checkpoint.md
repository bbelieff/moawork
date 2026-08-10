# MULTI-WORKSPACE-ENTRY-LAB-01 — T05 checkpoint

> owner: 실제 T05 작업반장  
> 시작: 2026-07-25 KST  
> 형식: systemError 복구용 append-only 단계 기록  
> 운영 경계: 제품 Git/PR/Production DB/merge/deploy HOLD, coordination·WORKLOG는 T09 sole writer

## CP-01 — 사용자 결정과 실제 dispatch

### 사용자 결정 정본

- Google 인증은 모든 계정에 열고, active membership 0이면 permission denied가 아니라 `/workspace-entry`로 보낸다.
- 생성 신청은 플랫폼 관리자 승인 뒤 원자적으로 Workspace와 유일 owner를 만든다.
- 입장 신청은 해당 Workspace owner가 승인하며 기본값은 `member`·최소 scope다.
- 역할은 account가 아니라 account×workspace membership에 속한다.
- Workspace별 protected owner는 정확히 1명이며 owner scope는 `all`이다.
- Platform 운영 권한은 tenant membership을 암시하거나 RLS를 우회하지 않는다.
- active membership 1개는 직접 진입, 2개 이상은 `/workspaces`에서 선택한다. `last_workspace`는 편의값일 뿐 권한 근거가 아니다.
- 신규 owner 온보딩은 B: 회사 이름 → 팀원 초대 → CSV 가져오기. 기존 joiner는 이 흐름을 거치지 않는다.
- 격리된 임시 DB lab은 승인됐다. 비용·유료 선택만 `DECISION_GATE`로 남기고 무료/local 검증은 계속한다.

### 실제 T 작업원 dispatch receipt

| 실제 작업원 | threadId | dispatch 전 상태 | WORK-ID | sole lease | consumer / NEXT_WORK | send receipt |
|---|---|---|---|---|---|---|
| T02 | `019f7fe5-46ea-7c00-b298-6dc690516250` | `notLoaded`(비활성) | `MULTI-WORKSPACE-AUTHZ-CONTRACT-01` | `docs/design/round-25/02-multi-workspace-authz-contract.md` | T05·T08·T10 / `MULTI-WORKSPACE-DB-LAB-01` | `threadId` 반환 확인 |
| T04 | `019f7fe5-da4e-79f3-9027-a488c90eaf08` | `notLoaded`(비활성) | `MULTI-WORKSPACE-ENTRY-UX-4CONCEPTS-01` | `brand/MoaWork_Workspace_Entry_4Concepts_v0.1.html` | T05·T10·사용자 / `MULTI-WORKSPACE-ENTRY-USER-DECISION-01` | `threadId` 반환 및 T04 ACK 확인 |
| T08 | `019f8055-62e4-7e63-8767-2da2d66ef3ad` | `notLoaded`(비활성) | `MULTI-WORKSPACE-DB-LAB-01` | `labs/multi-workspace-entry/**`, `docs/design/round-25/08-multi-workspace-db-lab.md` | T05·T10 / `MULTI-WORKSPACE-RLS-EXECUTION-01` | `threadId` 반환 확인 |

### 제외·검수 규칙

- T03·T06·T07은 `ROUTING-ANTI-CONFUSION-01` 복구 중이므로 dispatch하지 않았다.
- T05는 T 작업원을 대체하는 subagent를 사용하지 않았다.
- T10은 위 세 산출물이 materialize된 뒤 별도 실제 thread로 독립검수한다.
- FAIL은 같은 실제 T 작업원에게 재작업하고, PASS만 통합·다음 WORK로 넘긴다.

### 시작 기준선

- 최신 coordination 정본: `docs/coordination/sync/ROUND-25.md`.
- 기존 기준선: Production 로그인은 성공하지만 membership 없는 사용자는 `/login?error=membership`로 차단된다.
- PR #19는 Round-25 기록상 Draft/remote green이나 migration 006 live DB 증거 부재로 merge HOLD다.
- PR #20은 자동 첫 고객·업무 계약 충돌로 T10 FAIL/HOLD다.
- 기존 P0 local 후보·정적 테스트를 disposable DB 전체 non-skip 공격 증거로 승격하지 않는다.

## CP-02 — materialized / independent review dispatched

- T02 `MULTI-WORKSPACE-AUTHZ-CONTRACT-01`: PASS/RELEASE.
  - file: `docs/design/round-25/02-multi-workspace-authz-contract.md`
  - bytes: 43,346
  - SHA-256: `ED27FB7A83D2B21D18109F197EDB444B7D74DAA3A861BA05B6D920EC622F21AF`
  - confirmed: account×Workspace membership, protected Owner exact-one, Platform/tenant separation, approval transactions, 0/1/2+ routing, enumeration/rate-limit, session cutoff, PR #19/#20 and migration `007` conflicts.
- T04 `MULTI-WORKSPACE-ENTRY-UX-4CONCEPTS-01`: materialized; worker browser turn remained approval-waiting, so T05 performed the browser matrix before T10.
  - file: `C:/Users/belie/Desktop/Belief/서울리드프로젝트/brand/MoaWork_Workspace_Entry_4Concepts_v0.1.html`
  - bytes/lines: 39,699 / 416
  - SHA-256: `F8C4E6E6D49FD13D0339529C9B3DAB51523EF4658745EA70AC4A5DA9EEB551E2`
  - T05 browser: `http://127.0.0.1:4322/MoaWork_Workspace_Entry_4Concepts_v0.1.html`; 1280/390/320 overflow 0; 4 concepts; light/dark; generic enumeration disclosure 0; pending modify; B onboarding; joiner skip; operator tenant-entry CTA 0; console errors 0.
- T08 `MULTI-WORKSPACE-DB-LAB-01`: materialized, final packet pending.
  - lab: `C:/Users/belie/Desktop/Belief/서울리드프로젝트/labs/multi-workspace-entry`
  - T05 rerun: `npm.cmd test`, exit 0, 27 passed / 0 failed / 0 skipped.
  - hosted Supabase: `NOT_CREATED`, 비용 0. 안전한 인증·무료 생성 경로가 없었음.
  - limitation: PGlite single connection; true multi-connection race is not proven and remains `NOT_RUN`.
- T10 `MULTI-WORKSPACE-ENTRY-INDEPENDENT-REVIEW-01`: actual dispatch receipt `019f8056-311c-7402-81cd-247526ca457c`; review lease `docs/design/round-25/10-multi-workspace-entry-review.md`.
- Product Git/PR/Production DB/merge/deploy: HOLD.

## CP-03 — T10 FAIL / targeted rework

- T10 independent verdict against HTML SHA-256 `F8C4E6E6...51E2`: `FAIL` fixed without waiting for another browser click.
  1. D rendered two workspace nodes for the one-membership state because one/new-owner/joiner shared the multi-workspace fallback.
  2. C rendered tenant switch/join/create quick actions for the Platform Operator state, allowing the prototype to switch into a tenant scenario without membership evidence.
- T04 browser turn was approval-waiting. MWC directed the same T04 lease to own the rework. A brief T01 transfer was revoked; one narrow two-function patch had already materialized before revoke.
- Current candidate before T04 final ownership receipt:
  - bytes: 41,687
  - SHA-256: `2840A03E67A2173EF8DFABE1409B0B2AE87AD9FBB2D33E7A91666AEC8ACE780B`
  - T05 non-approval browser/state rerun at 320px:
    - D workspace node counts: one 1, multiple 2, new-owner 1, joiner 1, operator 0.
    - C operator tenant switch/create/join actions: 0; operator-only container: 1.
    - overflow: 0 for all checked states; console errors: 0.
- PASS remains forbidden until T04 returns the owned corrected exact hash and the same T10 receives that hash for independent rerun.

## CP-04 — controller-authorized approval-stall fallback

- T04 status: `BLOCKED_BY_TOOL_APPROVAL`. 마지막 완료 산출물은 원본 보정 HTML 39,699 bytes / 416 lines / SHA-256 `F8C4E6E6...51E2`이며 P0 재작업 완료로 주장하지 않는다.
- provenance: original T04 artifact → temporary T01 narrow patch → T04 unable to resume because `waitingOnApproval` → controller-authorized T01 lease transfer → T01 fresh whole-file validation in progress.
- T01 replacement actual thread: `019f7fe4-f9ca-76a2-b6ad-5dca321f546e`.
- T01 fresh WORK-ID: `MULTI-WORKSPACE-ENTRY-UX-P0-REWORK-02`; starting candidate 41,687 bytes / 425 lines / SHA-256 `2840A03E67A2173EF8DFABE1409B0B2AE87AD9FBB2D33E7A91666AEC8ACE780B`.
- recurrence prevention:
  1. writer lease 보유 T 작업원은 approval-gated browser call에 진입하지 않는다.
  2. browser 승인이 필요하면 먼저 파일 bytes/hash를 freeze/checkpoint하고 writer lease를 release한다.
  3. browser phase는 별도 read-only verifier로 수행한다.
  4. bounded wait를 넘긴 `waitingOnApproval`은 `BLOCKED_BY_TOOL_APPROVAL`로 기록하고, foreman/controller 명시 receipt 뒤에만 lease를 transfer한다.
- next: T01 owned final exact hash → same T10 `MULTI-WORKSPACE-ENTRY-INDEPENDENT-REVIEW-02`.

## CP-05 — corrected owner receipt / reviewer transfer

- T01 replacement owned final: `PASS / browser NOT_RUN`.
  - file: `brand/MoaWork_Workspace_Entry_4Concepts_v0.1.html`
  - bytes/lines: 41,687 / 425
  - SHA-256: `2840A03E67A2173EF8DFABE1409B0B2AE87AD9FBB2D33E7A91666AEC8ACE780B`
  - whole-file read + static/state harness: 20/20 PASS.
- T05 corrected-candidate browser rerun: 1280/390/320 × 8 scenarios, overflow 0; 4 concepts; D node counts `one=1, multiple=2, new-owner=1, joiner=1, operator=0`; C operator-only container 1 and tenant transition actions 0; dark/focus-visible/reduced-motion present; console errors 0.
- T10 corrected-hash rerun status: `BLOCKED_BY_TOOL_APPROVAL`; original FAIL evidence is retained and history is not altered.
- Controller-authorized replacement reviewer: actual T03 thread `019f7fe5-9278-7f61-9d4a-698fcd476303`, previously unrelated routing-instruction inventory only.
- T03 WORK-ID: `MULTI-WORKSPACE-ENTRY-INDEPENDENT-REVIEW-03`.
- T03 sole review lease: `docs/design/round-25/03-multi-workspace-entry-review.md`.
- provenance: T10 original FAIL + approval stall → controller-authorized dynamic reviewer transfer → T03 final independent verdict pending.
- recurrence prevention for reviewers: approval-gated browser work begins only after a complete non-browser verdict/checkpoint is written; `waitingOnApproval` never retains the sole review gate indefinitely.

## CP-06 — controller final review decision

- T03 independent checkpoint accepted by controller as PASS for the exact fixed inputs:
  - static/state: 25/25 PASS;
  - DB lab: 27/27 PASS, skip 0;
  - contract/integrity/privacy: 20/20 PASS;
  - original T10 P0 defects: fixed;
  - hosted/multi-connection limitations: preserved.
- T03 approval-gated browser: `NOT_RUN`; T03 file is not edited and a final receipt is not fabricated.
- T05 foreman browser corroboration only: 1280/390/320 × all states overflow 0; dark/focus-visible/reduced-motion present; console errors 0.
- final verdict: `PASS_WITH_BROWSER_GAP / USER_VISUAL_SELECTION_PENDING`.
- sufficient: show the local prototype and ask the user to choose the entry direction.
- insufficient: product code merge, PR merge, Production DB migration, deploy.
- T10 original FAIL, T04/T10/T03 approval-stall histories remain preserved.
- next: T09 append-only ROUND/worklog receipt, then `MULTI-WORKSPACE-ENTRY-USER-DECISION-01`.

## CP-07 — late T03 final browser evidence

- T03 completed after CP-06 and returned `FINAL VERDICT: PASS` for the same exact inputs.
- final review artifact: `docs/design/round-25/03-multi-workspace-entry-review.md`.
  - bytes: 11,675
  - SHA-256: `2E1B8BA603E6B642D2C9F7E00FB863341B76DDF9F5752E53BB0D4B459F3976C2`
- independent results:
  - static/state 25/25 PASS;
  - DB lab 27/27 PASS, skip 0;
  - contract/integrity/privacy 20/20 PASS;
  - original T10 P0s fixed;
  - responsive states 24/24, concept switching 8/8, light/dark 3/3, overflow 0.
- T03 did not use T05 browser evidence as independent proof.
- remaining runtime limitations: keyboard key activation/traversal, reduced-motion emulation and console collection `NOT_RUN`; native controls, focus-visible contract and actual solid 3px focus confirmed.
- revised verdict: `PASS / USER_VISUAL_SELECTION_PENDING`.
- unchanged HOLD: hosted Supabase, true multi-connection, JWT→GUC, PostgREST/pooler, hosted migration, Production, PR #19/#20, migration 007, product merge/deploy.
- T10 original FAIL and all approval-stall provenance remain preserved.

## CP-08 — late candidate drift / automatic stale verdict

- after T03 final PASS on SHA `2840A03E...80B`, T04 resumed and wrote the HTML again.
- current frozen candidate: 41,687 bytes / 425 lines / SHA-256 `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5`; local HTTP 200.
- semantic diff reconstructed from the T01 fileChange artifact and current source is inside `mapNodes()` only:
  1. operator `tenant 소속 0곳` → `회사 소속 0곳`;
  2. operator `없음 · tenant 진입 0` → `없음 · 회사 진입 0`;
  3. fail-closed fallback `tenant 진입 0` → `회사 진입 0`.
- classification pending independent review: visible copy/terminology change, not format-only. No structural or event-handler change is evident from the reconstructed diff, but prior PASS is automatically `STALE` because the exact hash changed.
- T04 receipt called this “2 wording changes”; source history shows 3 text-node substitutions using 2 wording patterns. This count discrepancy is preserved.
- T09 correctly stopped: ROUND-28 absent, worklog not appended, ROUND-27 unchanged.
- T03 cannot consume another task because of approval state. Controller dynamically selected conflict-free actual T07, thread `019f8055-3d2a-7f11-a5a9-5bfa7b36da1c`.
- T07 WORK-ID: `MULTI-WORKSPACE-ENTRY-CURRENT-HASH-REVIEW-01`; sole lease `docs/design/round-25/07-multi-workspace-entry-current-hash-review.md`.
- recurrence rule: any worker receipt that mutates a candidate after an independent verdict automatically makes that verdict `STALE`; the candidate remains HOLD until a new exact-current-hash independent review. A late worker must not write after its lease is released.

## CP-09 — exact-current independent PASS / ROUND-28 unblock

- T03 delta verdict is preserved as `FAIL — DECLARED DELTA MISMATCH`: current-hash security/state was 15/16 with P0 regression 0, and the sole failure was the then-undeclared third Koreanization at the fail-closed fallback.
- T05 corrected the delta contract to all three `mapNodes()` text substitutions and froze the same HTML without rework.
- actual independent reviewer T07 completed `MULTI-WORKSPACE-ENTRY-CURRENT-HASH-REVIEW-01` against exact SHA-256 `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5`.
- T07 result: `FINAL PASS`; static/state 58/58, 8 scenarios × 4 concepts 32/32, browser 1280/390/320 × 8 scenarios 24/24 with overflow 0, Concept runtime 5/5, operator tenant action 0, generic enumeration/fake success 0, light/dark/focus/reduced-motion/console PASS, DB lab 27/27.
- T07 artifact: `docs/design/round-25/07-multi-workspace-entry-current-hash-review.md`, 15,257 bytes, SHA-256 `CA0B65AD6504CA482D605CAB7D9F2C1CB59173176AD6A4642AF72251E910616B`. Physical-line reporting differs by counting method; bytes/hash are authoritative.
- remaining `NOT_RUN`: hosted Supabase creation, true multi-connection race, JWT→GUC, PostgREST/pooler, hosted migration compatibility, production behavior.
- final design verdict: `PASS_EXACT_CURRENT_HASH / USER_VISUAL_SELECTION_PENDING`; product code, PR #19/#20, migration 007, Production DB, merge and deploy remain HOLD.
- T09 may now materialize new `ROUND-28.md` and append-only worklog receipt while preserving unrelated `ROUND-27.md` byte-for-byte.
- recurrence rule confirmed: any late candidate mutation after independent review automatically invalidates the prior verdict as `STALE`; exact-current review is required before coordination PASS.
