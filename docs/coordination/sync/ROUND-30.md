# SYNC Round 30 — Workspace Entry B family routing v0.3

> 작성: T09 coordination sole writer · 2026-07-25 KST
> WORK-ID: `WORKSPACE-ENTRY-B-FAMILY-ROUND-30-01`
> 직전 숫자 정본: `ROUND-29.md@D8734E1EFF4795CCE25FC22B8A01F839B59C6EF45DCADF7A6C0EAF412504B973`
> 최종 판정: `PASS_WITH_BROWSER_GAP / USER_VISUAL_SELECTION_READY / PRODUCT_HOLD`

## 1. Round 목적과 엄격한 상태 경계

이번 Round는 B family routing v0.3을 사용자가 B-1~B-4 중에서 선택할 수 있는 prototype 상태로 수렴한다. 이 판정은 prototype 비교에만 충분하다. 제품 코드 구현, DB/migration, Git, PR, merge, deploy 또는 Production 권한을 열지 않는다.

- `PASS_WITH_BROWSER_GAP`: complete browser PASS가 아니다.
- `USER_VISUAL_SELECTION_READY`: 사용자에게 B-1/B-2/B-3/B-4 선택을 받을 수 있다.
- `PRODUCT_HOLD`: 선택 전후 모두 별도 구현·검수·승인 gate가 필요하다.
- Round 29의 R1 FAIL, R2 PASS와 v0.2 역사는 보존한다. v0.3은 해당 역사를 삭제하거나 소급 수정하지 않는다.

## 2. 정확한 현재 후보와 HTTP receipt

| 항목 | 값 |
|---|---|
| HTML | `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_Workspace_Entry_B_Family_4Variants_v0.3.html` |
| bytes | `52,654` |
| text lines | `508` |
| raw LF split lines | `509` |
| SHA-256 | `DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9` |
| user URL | `http://127.0.0.1:48731/MoaWork_Workspace_Entry_B_Family_4Variants_v0.3.html` |

foreman final HTTP recheck은 동일 URL에서 body `52,654 bytes`와 SHA `DE2418DC09477A531C695F58C35D5070DAC16BDE28279331992266352D3E68D9`의 exact match를 확인했다.

## 3. 실제 T artifact receipt

| 역할 | artifact | receipt | SHA-256 | 상태 |
|---|---|---:|---|---|
| routing contract · T02 | `docs/design/round-30/02-workspace-entry-b-routing-contract.md` | `30,418 bytes` | `D009FA7B2867DBF302BD85ED7F48CD438805501FDDEFCAFDBD7FE4E65FDFE6CB` | contract |
| original reviewer checkpoint · T07 | `docs/design/round-30/07-workspace-entry-b-routing-review.md` | `13,116 bytes` | `113981AF83425F40C5FED5BB3F74E071AF7779B46A2201B5016BD5B4EA5BD4F5` | bounded evidence |
| sole replacement recovery · T08 | `docs/design/round-30/08-workspace-entry-b-routing-review-recovery.md` | `5,367 bytes` | `3FA368BC8D60246016231BF908AF894E11C21D177AC062D16117119C29FD3608` | bounded evidence |

실제 작업자 체인은 T02 contract, T01 v0.3 writer, T07 original reviewer, T08 sole replacement reviewer, T09 coordination이다. `INTERNAL_SUBAGENT_ONLY`는 `NONE`이다. T03 dispatch는 controller resolution과 경합해 즉시 superseded됐으며 T03은 `STOP ACK / NO_WRITE / RELEASE`로 종료했고 evidence를 만들지 않았다.

## 4. 검수 증거와 browser gap

### 4.1 T07 exact candidate evidence

- non-browser: `44/44 PASS`
- routing/security/slug/Owner/style/privacy: PASS
- browser rows: responsive light/dark 포함 `264/264`
- overflow: `0`
- controls below 44px: `0`
- B-3 desktop: `22/22`
- mobile collapse: `44/44`
- slug: `4/4`
- Owner: `4/4`
- chooser selection: `4/4`
- keyboard focus: PASS

T07의 completed browser 결과는 final approval stall 이전에 exact candidate에 인과적으로 결속된 완료 evidence다.

### 4.2 T08 bounded recovery evidence

T08은 candidate·contract·T07 hash와 exact HTTP `52,654 / DE2418…E68D9`를 독립 동결했다. T08의 bounded critical browser 호출은 critical state sample, chooser `4`, slug `4`, keyboard/focus evidence를 반환했다.

그러나 T08의 마지막 turn은 approval stall로 완료되지 않았다. 따라서 T08을 final PASS로 부르지 않으며, T08의 미완료 검수를 T07 결과로 대체하거나 확대 해석하지 않는다.

### 4.3 남은 NOT_RUN

다음은 반복된 `waitingOnApproval` 때문에 실행하지 않았다.

- reduced-motion final action: `NOT_RUN`
- console final action: `NOT_RUN`
- final approval action: `NOT_RUN`

이 항목 때문에 전체 판정은 `PASS_WITH_BROWSER_GAP`이다. full browser PASS, final visual approval, 제품 release 준비 완료를 주장하지 않는다.

## 5. reviewer incident provenance와 재발 방지

1. T07이 `WAITING_ON_APPROVAL`이 됐다.
2. controller는 T08 한 명만 replacement reviewer로 지정했다.
3. T08도 `WAITING_ON_APPROVAL`에 도달했다.
4. 추가 worker 교체나 무한 재시도 대신 explicit browser gap으로 downgrade했다.

규칙:

- browser 전 checkpoint를 먼저 materialize한다.
- writer는 browser 대기 전에 lease를 release한다.
- replacement reviewer는 최대 한 명만 지정한다.
- repeated approval stall은 worker cycle이 아니라 명시적 `NOT_RUN`/browser gap으로 기록한다.

## 6. 사업·권한 routing delta

- ordinary active membership이 1개이거나 1개+pending이면 server-verified `0-click /w/{slug}`로 이동한다.
- accepted target과 verified membership이면 두 번째 membership이 있어도 `0-click`이며, workspace 안에서 nonblocking notice를 보여 준다.
- ordinary active membership이 2개 이상이면 chooser를 사용한다. last-used는 hint일 뿐 권한 근거가 아니다.
- operator no membership, inactive, unknown, cross-tenant는 `tenant0` fail-closed다.
- display name은 Korean/free text를 허용한다.
- slug는 English lower ASCII/digit/hyphen, 길이 `3–40`, preview 제공, generic unavailable, 생성 뒤 stable이다.
- Owner B flow는 `name + address → invite → CSV`다.

기존 tenant 격리, Owner 보호, 최소권한, operator tenant action 0의 보안 경계는 유지한다.

## 7. 사용자 선택

사용자는 다음 중 하나를 선택한다.

| 선택지 | 이름 |
|---|---|
| B-1 | Guided Fork |
| B-2 | Guided Split |
| B-3 | One Question at a Time |
| B-4 | Compact Guided Hub |

- 다음 exact WORK-ID: `WORKSPACE-ENTRY-B-FAMILY-USER-DECISION-02`
- 다음 단계는 사용자 선택을 소비하는 별도 plan/implementation gate다.
- 선택이 있어도 제품 구현·DB·migration·merge·deploy 권한은 자동으로 열리지 않는다.

## 8. 명시적 HOLD

다음은 모두 HOLD다.

- product code
- DB와 migration
- Git stage/commit/push
- PR, merge, deploy
- Production write

사용자 variant 선택 뒤에도 exact writer lease, 현재 hash 동결, 구현·테스트·독립 VERIFY, 사용자 실제 화면 승인, release gate를 새로 받아야 한다.

## 9. T09 writer 경계

- 새로 작성: `docs/coordination/sync/ROUND-30.md`
- append-only: `docs/worklog.md`
- byte-for-byte 보존: `docs/coordination/sync/ROUND-29.md`
- 수행하지 않음: HTML·product code·DB·migration·Git stage/commit/push·PR·merge·deploy·Production write

