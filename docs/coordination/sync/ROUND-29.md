# SYNC Round 29 — Workspace Entry B family sibling variants

> 작성: T09 coordination sole writer · 2026-07-25 KST
> WORK-ID: `WORKSPACE-ENTRY-B-FAMILY-ROUND-29-01`
> 직전 숫자 정본: `ROUND-28.md@3E5CDA9017A4BB741E5D629E057EA3727CA21CF8F3D7C46EB0FB2718C7D05BD5`
> 최종 판정: `PASS_EXACT_CURRENT_HASH / USER_VARIANT_SELECTION_PENDING / PRODUCT_HOLD`

## 1. 사용자 교정과 이번 Round의 목적

사용자가 2단계 디자인 규칙을 교정했다. 첫 단계에서 B를 선택한 뒤 만드는 다음 네 안은 새로운 A/B/C/D 디자인 언어가 아니다. 선택된 B의 DNA를 고정한 상태에서 같은 문제를 다르게 푸는 sibling variants다.

- exploration 단계: 서로 다른 디자인 언어를 비교한다.
- refinement 단계: 선택된 언어의 핵심 DNA를 잠그고 그 안에서 형제 변형을 비교한다.
- 이번 B family 네 안은 refinement다.
- 이전 A/C/D 언어의 재도입이나 새 4개 언어 탐색으로 해석하지 않는다.

## 2. 기준 디자인과 보조 근거

| 역할 | 파일 | bytes / lines | SHA-256 |
|---|---|---:|---|
| 선택된 Primary B | `brand/MoaWork_Onboarding_Company_Invite_CSV_4Concepts_v0.1.html` | `47,563 bytes / 182 lines` | `1672B6E00CBF3C2ABAFEF660C9B5C511B5CCF44F707BA93042B166C4733D3B02` |
| migration B 보조 근거 | `brand/MoaWork_First_Value_Onboarding_B_Migration_v0.2.html` | `45,465 bytes / 539 lines` | `62F4BF4EE5E276FA2C9086DC6B397BF8A58728B40DE3E26081B0168A4A016621` |
| 교정된 상태·보안 근거 | `brand/MoaWork_Workspace_Entry_4Concepts_v0.1.html` | `41,687 bytes / 425 lines` | `D3A43A9BA5AD363E9213A719CE0FA3476086908ADD1F2F2BEFDD5334B4B0A2A5` |

Primary B에서 이어받는 DNA는 한 번에 하나의 결정을 돕는 guided conversation, 회사 만들기와 기존 회사 합류의 명확한 분기, 작은 조직이 설명 없이 시작할 수 있는 문장과 정보 위계다. migration B는 데이터 이전을 first value로 보는 안전한 진행·검토·적용 경계를 보조한다. 상태·보안 근거는 operator tenant action 0과 기존 membership·권한 경계를 유지하는 기준이다.

## 3. 실제 T routing과 artifact receipt

공식 routing에는 실제 영속 T session만 사용했다. T03·T04·T10은 이번 작업에서 제외했으며, 공식 작업을 내부 subagent로 대체하지 않았다.

| 단계 | 실제 T / threadId | artifact·변경 | 판정 |
|---|---|---|---|
| style contract | T02 / `019f7fe5-46ea-7c00-b298-6dc690516250` | `docs/design/round-29/02-workspace-entry-b-style-contract.md` | `PASS / RELEASE` |
| common process rule | T08 / `019f8055-62e4-7e63-8767-2da2d66ef3ad` | 공통 운영 프롬프트 §16.3.1 | `PASS / RELEASE` |
| HTML writer + bounded rework | T01 / `019f7fe4-f9ca-76a2-b6ad-5dca321f546e` | `brand/MoaWork_Workspace_Entry_B_Family_4Variants_v0.2.html` | `PASS / RELEASE` |
| exact review R1/R2 | T07 / `019f8055-3d2a-7f11-a5a9-5bfa7b36da1c` | R1 FAIL 보존, R2 PASS | `PASS / RELEASE` |
| foreman checkpoint | T05 / `019f7fe6-0310-7713-9ad6-0c76bbceebf3` | `docs/design/round-29/05-workspace-entry-b-family-checkpoint.md` | current checkpoint |
| official internal subagent | `NONE` | `INTERNAL_SUBAGENT_ONLY NONE` | PASS |

### 3.1 T02 style contract

- artifact: `docs/design/round-29/02-workspace-entry-b-style-contract.md`
- receipt: `29,672 bytes / 554 lines`
- SHA-256: `31BD7C10CDE2227B18C5948870B17894D52F4BADC30E21B68771F81FC878CE4D`
- verdict: `STYLE CONTRACT PASS / RELEASE`

계약은 B DNA의 고정 요소, sibling variant가 달라질 수 있는 축, 상태·보안·반응형·접근성 경계를 분리한다.

### 3.2 T08 common process rule

- 파일: `C:\Users\belie\Desktop\Belief\클로드\prompts\moawork-collaboration\01-MoaWork-Control-운영프롬프트.txt`
- post receipt: `44,882 bytes / 522 lines`
- post SHA-256: `643A83EF58FCE90D8F646F9D3C448A12B2F127DB65AB4D980B3851F7B71A4B48`
- pre SHA prefix/suffix: `A8FAF96C...1794`
- 변경: §16.3.1의 `DESIGN_STAGE EXPLORATION`과 `REFINEMENT` 구분만 삽입
- routing guard: unchanged
- verdict: `PASS / RELEASE`

T05는 removal-in-memory 방식으로 삽입 구간을 제거한 결과가 exact pre-hash와 일치함을 재구성했다. 이번 T09는 공통 프롬프트를 읽기 전용으로 대조했으며 수정하지 않았다.

### 3.3 T01 final HTML

- 파일: `brand/MoaWork_Workspace_Entry_B_Family_4Variants_v0.2.html`
- receipt: `53,996 bytes / 713 lines`
- SHA-256: `CCF67019AFDF8E7D7E8250AE2F05A2D784E760121F35B94EBEC038ABA668F300`
- verdict: `NEW HTML + BOUNDED REWORK PASS / RELEASE`
- 사용자 URL: `http://127.0.0.1:4323/MoaWork_Workspace_Entry_B_Family_4Variants_v0.2.html`
- exact-hash server session: `66536`

R2 PASS 뒤 동일 hash를 다시 확인했다. in-app browser deliverable은 정확한 이 후보를 열어 둔 상태다.

### 3.4 T07 R1 FAIL과 R2 PASS

R1은 폐기하지 않고 결함 발견 이력으로 유지한다.

- R1 artifact: `docs/design/round-29/07-workspace-entry-b-family-review.md`
- R1 receipt: `21,391 bytes / 337 lines`
- R1 SHA-256: `1FE0662087207E0922545486448554E33E318CAB813B4EDF566594BF3F92527E`
- R1 defect 1: first-fold B identity `0/12`
- R1 defect 2: B-3 desktop summary hidden `8/8`
- R1 verdict: exact `FAIL`

T01의 bounded rework 뒤 T07이 새 exact candidate를 검수했다.

- R2 artifact: `docs/design/round-29/07-workspace-entry-b-family-review-r2.md`
- R2 receipt: `17,429 bytes / 296 lines`
- R2 SHA-256: `DD436E2F47C060F62A9E360336F35B72E6B6D3009B3C53C520EE50A9ABB6A714`
- R2 verdict: exact `PASS`

### 3.5 T05 checkpoint

- artifact: `docs/design/round-29/05-workspace-entry-b-family-checkpoint.md`
- receipt: `9,027 bytes / 188 lines`
- SHA-256: `B24AA2B3BDBCB9F777352A1F314ADED785845412ED7F2FD85838D441B197B437`

## 4. 최종 R2 증거

| 검수 축 | 결과 |
|---|---|
| non-browser renderer | `32/32 PASS` |
| generic | `4/4 PASS` |
| non-browser aggregate | `38/38 PASS` |
| browser matrix | `96/96 PASS` |
| first-fold B identity | `12/12 PASS`, B primitives `3–4` |
| B-3 desktop summary | `8/8 PASS`, width `489.203px` |
| B-3 mobile disclosure | `2/2 PASS` |
| overflow / core escape | `0/96` |
| controls below 44px | `0/96` |
| dark | `12/12 PASS` |
| browser generic | `4/4 PASS` |
| keyboard / arrow / focus | PASS |
| Owner progression / back | PASS |
| reduced motion | PASS |
| console | PASS |
| old A/C/D leakage | `0` |
| operator tenant action | `0` |

공통 B style DNA는 유지됐고 네 sibling variant는 서로 구별된다. 이전 보안·상태 경계도 유지된다. browser 검수 뒤 final HTML hash는 바뀌지 않았다.

## 5. 사용자가 선택할 네 sibling variants

| Variant | 이름 | 핵심 차이 |
|---|---|---|
| B-1 | Guided Fork | 만들기와 합류를 한 화면의 guided conversation에서 함께 보여 준다. |
| B-2 | Guided Split | 만들기와 합류를 분리된 두 guided path로 제시한다. |
| B-3 | One Question at a Time | 한 번에 질문 하나만 보여 주고 다음 단계로 전개한다. |
| B-4 | Compact Guided Hub | B DNA를 유지하면서 더 압축된 허브형 진입을 제공한다. |

T05 추천은 B-1이다. 작은 조직의 첫 진입에서 만들기와 합류가 동시에 보이면서도 하나의 guided conversation을 유지하기 때문이다. mobile-first 사용자가 우선이면 B-3가 두 번째 선택이다.

## 6. 상태와 HOLD

- 최종 상태: `PASS_EXACT_CURRENT_HASH / USER_VARIANT_SELECTION_PENDING / PRODUCT_HOLD`
- prototype은 사용자 B-1/B-2/B-3/B-4 선택에 사용할 수 있다.
- 제품 구현·merge·deploy 승인은 아니다.
- 제품 코드 구현: HOLD
- PR·merge: HOLD
- DB·migration·Production write: HOLD
- deploy: HOLD

사용자 선택 전에는 제품 구현을 시작하지 않는다. 선택 뒤에도 별도 구현 계획, 정확한 writer lease, 독립 검수, 사용자 실제 화면 승인, merge와 deploy gate가 필요하다.

## 7. stale-hash 규칙

- R2 PASS는 HTML SHA `CCF67019AFDF8E7D7E8250AE2F05A2D784E760121F35B94EBEC038ABA668F300`에만 유효하다.
- 이후 HTML byte가 하나라도 바뀌면 이 PASS는 자동으로 `STALE`이다.
- 변경 후보는 새 exact-hash 독립 검수를 통과하기 전 coordination PASS로 승격할 수 없다.
- late worker는 release 뒤 같은 lease로 추가 write하지 않는다.
- R1 FAIL은 결함 발견 이력으로 보존하고 R2 PASS로 소급 삭제하지 않는다.

## 8. 다음 소비

- 다음 exact WORK-ID: `WORKSPACE-ENTRY-B-FAMILY-USER-DECISION-01`
- 사용자 결정: B-1 / B-2 / B-3 / B-4
- 추천: B-1
- mobile-first 대안: B-3

## 9. T09 writer 경계

- 새로 작성: `docs/coordination/sync/ROUND-29.md`
- append-only: `docs/worklog.md`
- byte-for-byte 보존: `docs/coordination/sync/ROUND-28.md`
- 읽기 전용으로만 대조: design artifacts, brand HTML, common prompt
- 수행하지 않음: design·HTML·common prompt·제품 코드·Git stage/commit/reset/clean/push·DB·migration·PR·merge·deploy·Production write

