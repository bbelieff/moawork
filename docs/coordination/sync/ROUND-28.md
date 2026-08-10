# SYNC Round 28 — multi-workspace entry exact-current-hash review

> 작성: T09 coordination sole writer · 2026-07-25 KST
> WORK-ID: `MULTI-WORKSPACE-ENTRY-ROUND-28-01`
> 직전 숫자 정본: `ROUND-27.md@499935927324A71BE82F8BE73117178B379F3724ADE2C2700D48B5E26C9C608D`
> 최종 판정: `PASS_EXACT_CURRENT_HASH / USER_VISUAL_SELECTION_PENDING / PRODUCT_HOLD`

## 1. 이번 Round의 목적

Round 26의 multi-workspace entry prototype 이후 도착한 독립 browser 증거와 late candidate mutation을 append-only로 수렴한다. Round 27은 `ROUTING-ANTI-CONFUSION-01`의 숫자 정본이므로 byte-for-byte 보존하고, 충돌을 피한 새 Round 28에 현재 후보·검수·HOLD를 기록한다.

- 사용자는 A/B/C/D prototype을 비교해 진입 기본안을 선택할 수 있다.
- 이 PASS는 정확한 현재 HTML hash에 묶인 prototype 검수다.
- 제품 코드, PR, migration, DB, merge, deploy 또는 Production 준비 완료를 뜻하지 않는다.

## 2. 정확한 현재 후보

| 항목 | 값 |
|---|---|
| HTML | `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_Workspace_Entry_4Concepts_v0.1.html` |
| bytes | `41,687` |
| physical lines | `425` |
| SHA-256 | `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5` |
| 사용자 URL | `http://127.0.0.1:4322/MoaWork_Workspace_Entry_4Concepts_v0.1.html` |
| 선택 상태 | `USER_VISUAL_SELECTION_PENDING` |

HTML은 검수 입력일 뿐 이번 T09 작업의 write 대상이 아니다. T09는 HTML·제품 코드·Git·DB를 수정하지 않았다.

## 3. late mutation과 판정 provenance

1. 이전 독립 PASS는 HTML SHA `2840A03E67A2173EF8DFABE1409B0B2AE87AD9FBB2D33E7A91666AEC8ACE780B`에만 유효했다.
2. T04의 late write로 후보가 SHA `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5`로 바뀌었고, 이전 PASS는 즉시 `STALE`이 됐다.
3. 실제 의미 delta는 `mapNodes()` 안의 표시 문구 세 곳이다. 총 `18 bytes / 3 ranges`, line 363과 369에서 `tenant`가 `회사`로 바뀌었다.
   - operator 소속 수: `tenant 소속 0곳` → `회사 소속 0곳`
   - operator 진입 수: `없음 · tenant 진입 0` → `없음 · 회사 진입 0`
   - fail-closed fallback: `tenant 진입 0` → `회사 진입 0`
4. T04 receipt는 두 변경만 선언했다. T03은 선언되지 않은 세 번째 치환을 발견해 변경 범위 불일치로 정확히 `FAIL`을 반환했다. 당시 current-hash P0 regression은 0이었다.
5. T05는 세 치환 모두를 교정된 Koreanization delta 계약으로 명시 수용하고 동일 HTML을 재작업 없이 동결했다.
6. controller가 충돌 없는 실제 T07을 새 독립 reviewer로 선택했고, T07은 정확한 현재 SHA에 대해 `PASS`를 반환했다.
7. T03의 declaration-mismatch FAIL은 폐기하지 않고 정당한 검수 이력으로 유지한다. 이후 T07 PASS는 수정된 3-change 계약과 정확한 현재 hash에만 유효하다.

## 4. 실제 artifact receipt

| 역할 | artifact | bytes / lines | SHA-256 | 판정 |
|---|---|---:|---|---|
| current-hash 독립 검수 · T07 | `docs/design/round-25/07-multi-workspace-entry-current-hash-review.md` | `15,257 bytes`; line count는 도구별 상이 | `CA0B65AD6504CA482D605CAB7D9F2C1CB59173176AD6A4642AF72251E910616B` | `PASS` |
| 통합 계약 · T05 | `docs/design/round-25/05-multi-workspace-entry-contract.md` | `16,769 bytes / 188 physical lines` | `6EBA36D65D401313D9C308E611614EF07C215EFA82B24F32AF15B1208A08F85C` | current contract |
| 통합 checkpoint · T05 | `docs/design/round-25/05-multi-workspace-entry-checkpoint.md` | `14,611 bytes / 167 physical lines` | `2A0562AA2612C5F535C989E189F82C41AF4513AB70A121FD43C18317D57621BA` | current checkpoint |
| delta FAIL · T03 | `docs/design/round-25/03-multi-workspace-entry-review-delta.md` | `6,237 bytes`; line count 미고정 | `5D39BE37E319FF4D4B68CF297EF367CA4B8010876F9AEAE3560D91CD60EFA13F` | historical `FAIL`, 원인 교정됨 |

T07 artifact와 T03 delta artifact의 physical line count는 bytes/hash를 권위값으로 사용한다. 검증 도구별 line-count 차이를 임의로 하나의 숫자로 꾸미지 않는다.

## 5. exact-current 독립 검수 결과

T07 `MULTI-WORKSPACE-ENTRY-CURRENT-HASH-REVIEW-01`은 current SHA를 시작과 종료 시점에 동결·재확인했다.

| 검수 축 | 결과 |
|---|---|
| 정적·상태 계약 | `58/58 PASS` |
| 8 scenarios × 4 routes | `32/32 PASS` |
| browser 1280/390/320 × 8 scenarios | `24/24 PASS`, horizontal overflow `0` |
| Concept runtime | `5/5 PASS` |
| 원래 T10 P0 · D node 수 | `one=1 / multiple=2 / new-owner=1 / joiner=1 / operator=0` |
| 원래 T10 P0 · C operator tenant action | switch/create/join/transition `0` |
| generic enumeration | `0` |
| fake success | `0` |
| light/dark · focus · reduced-motion | `PASS` |
| browser console error | `0` |
| DB lab | `27/27 PASS`, skip `0` |

320px 캡처에서 일시적으로 보인 과도한 줄바꿈 징후는 DOM/computed width와 viewport runtime을 재측정해 실제 horizontal overflow 결함이 아님을 분리 확인했다. 숫자상 overflow만 보고 성급히 PASS하지 않고 화면·runtime을 함께 검증했다.

## 6. 제품 결정 계약

유지되는 결정은 다음과 같다.

- Google 로그인은 열어 둔다.
- active membership `0 → /workspace-entry`, `1 → 유일 Workspace`, `2+ → /workspaces`.
- `last_workspace`는 편의값일 뿐 권한 근거가 아니다.
- role/scope/status는 account×Workspace membership에 속한다.
- Platform 권한과 tenant membership은 분리한다.
- Platform create 승인 결과 requester는 해당 Workspace의 sole protected Owner가 된다.
- 기존 Workspace join 승인은 protected Owner가 처리하며 결과는 member/minimal이다.
- protected Owner exact-one을 유지한다.
- 신규 Owner 온보딩은 B의 `회사 → 팀원 초대 → CSV` 흐름을 사용한다.

사용자 선택 추천은 바뀌지 않는다.

- A: 기본 진입
- C: membership 2+ switcher
- B: 신규 Owner 온보딩에서만 사용
- D: 고급 도움말

## 7. DB·운영 증거 경계

`MW-DB-LAB-PGLITE-20260725-V1`의 로컬 disposable DB lab은 `27/27 PASS`, skip 0이다. 다음 항목은 실행하지 않았다.

- Hosted Supabase: `NOT_CREATED`, 비용 `0`
- true multi-connection: `NOT_RUN`
- JWT→GUC: `NOT_RUN`
- PostgREST/pooler: `NOT_RUN`
- hosted migration: `NOT_RUN`
- Production: `NOT_RUN`

로컬 lab PASS를 실 DB·실 연결·Production 증거로 승격하지 않는다.

## 8. 명시적 HOLD

다음 write와 운영 단계는 모두 HOLD다.

- 제품 코드 구현
- PR #19 / PR #20 merge
- migration 007 및 기타 migration 적용
- Supabase·Production DB write
- partner/member write
- 새 PR·merge·deploy·Production release

PR #19의 Owner 자동 선택·Platform 자동 생성 충돌과 PR #20의 자동 첫 고객/업무·migration 007 충돌은 해소된 것으로 간주하지 않는다. 사용자 prototype 선택 뒤에도 별도 구현 gate, migration 번호·DB 검증, 새 PR/CI, 독립 검수, 사용자 실제 화면 승인, merge/deploy 승인이 필요하다.

## 9. 재발 방지 규칙

- 독립 검수 뒤 후보 bytes가 한 번이라도 바뀌면 기존 verdict는 자동으로 `STALE`이다.
- late worker는 lease release 뒤 같은 후보에 추가 write하지 않는다.
- 새 후보는 bytes/hash를 다시 동결하고 exact-hash 독립 검수를 통과해야 coordination PASS로 승격할 수 있다.
- receipt의 변경 개수·범위가 실제 byte delta와 다르면 기능 회귀가 없어도 provenance FAIL로 기록한다.
- writer는 approval-gated browser 전에 bytes/hash를 freeze하고 lease를 release한다.
- reviewer는 optional browser 전에 완전한 non-browser checkpoint를 materialize한다.
- `waitingOnApproval`은 sole gate 또는 sole writer lease를 계속 보유하는 근거가 아니다.

## 10. 다음 소비

- 상태: `PASS_EXACT_CURRENT_HASH / USER_VISUAL_SELECTION_PENDING / PRODUCT_HOLD`
- 사용자 결정: A/B/C/D
- 다음 exact WORK-ID: `MULTI-WORKSPACE-ENTRY-USER-DECISION-01`
- 사용자 선택 뒤 다음 gate: `MULTI-WORKSPACE-ENTRY-IMPLEMENT-01`

Round 28은 prototype 선택을 여는 coordination 정본이다. 구현·DB·merge·deploy 권한을 열지 않는다.

## 11. T09 writer 경계

- 새로 작성한 coordination 정본: `docs/coordination/sync/ROUND-28.md`
- append한 handoff: `docs/worklog.md`
- byte-for-byte 보존: `docs/coordination/sync/ROUND-27.md`
- 수행하지 않음: 제품 코드·HTML·Git stage/commit/reset/clean/push·DB·migration·PR·merge·deploy·Production write

