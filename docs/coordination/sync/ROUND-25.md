# SYNC Round 25 — `3분 시작` 온보딩 복구

> 작성: T09 coordination collector · 2026-07-24 KST
> 사용자 결정: 기존 `3분 시작` 온보딩을 **되살린다**.
> 정본 규칙: 이 문서는 Round 24 이후 상태를 append-only 새 라운드로 기록한다. Round 24와 기존 산출물을 덮어쓰거나 다시 여는 문서가 아니다.

## 1. 복구 결정과 범위

- `FIRST-VALUE-DECISION-01`을 다시 활성화한다.
- sole owner는 **T01**이다. 사용자 Q1~Q5와 A/B/C/D 구조 선호 또는 조합을 확정 입력으로 정규화한다.
- 이번 coordination write 범위는 `docs/coordination/sync/ROUND-25.md` 신규 작성과 `docs/worklog.md` 끝 append뿐이다.
- 제품 코드, HTML, Git 원격, PR, migration, Supabase/DB, Vercel/Production, partner/member write는 수행하지 않는다.
- T01의 실제 resume artifact receipt가 도착하면 이 파일의 해당 상태와 링크만 의미 있게 갱신한다. T09 hub가 upstream을 흡수해 생기는 크기·해시 변화만으로 재귀 갱신하지 않는다.

## 2. 왜 중단됐고 무엇을 복구하는가

- Round 21의 [`01-first-value-concepts.md`](../../design/round-21/01-first-value-concepts.md)에 `3분 시작` 4안, Draft D1~D5, 사용자 미결정 Q1~Q5, 권한·오류·복구·수용조건이 이미 materialize돼 있다.
- 중단 원인은 산출물 유실이나 구현 실패가 아니다. `FIRST-VALUE-DECISION-01`이 사용자 답변 대기 상태인 동안 Account C 구현·승인·Production과 PR #19/#20 stack 재정렬이 우선 실행됐다.
- 사용자 답이 없었으므로 T04 HTML lease, T10 시각 검수, 제품 구현 권한이 열리지 않았다. 이 금지선이 그대로 보존된 것이 정상 중단 상태다.
- 이번 복구는 기존 SPEC을 되살리고 사용자 결정 단계부터 다시 연결한다. 이미 끝난 Account C나 remote-green PR을 재작업하지 않는다.

## 3. 현재 상태

| owner | WORK-ID | 상태 | 실제 입력·산출물 | 다음 전환 | HOLD |
|---|---|---|---|---|---|
| T01 | `FIRST-VALUE-DECISION-01` | `ACTIVE / USER_DECISION_PENDING / RESUME_ARTIFACT_VERIFIED` | [`01-first-value-concepts.md`](../../design/round-21/01-first-value-concepts.md) RESUME §15, 31,178 bytes / 596 lines / SHA `4CF86B...2317` | 사용자 Q1~Q5·구조 선호 답변을 확정 packet으로 materialize | T01을 다른 작업으로 재배정 금지 |
| T04 | `FIRST-VALUE-VISUAL-4A-01` | `WAITING_FOR_USER_ANSWER` | HTML 없음, file lease 미개방 | 사용자 답변 뒤 단일 HTML lease로 서로 다른 4안 제작 | 답변 전 HTML write 금지 |
| T10 | First Value visual gate | `WAITING_FOR_HTML` | 검수할 HTML·로컬 URL 없음 | T04 HTML 뒤 시각·접근성·권한·상태 시퀀스 독립 검수 | HTML 전 PASS 주장 금지 |
| DEV | implementation planning | `HOLD / NOT_AUTHORIZED` | selected visual 없음; P0 auth integration gate 미충족 | 사용자 시각 승인 뒤 전용 worktree·lease·구현 plan 검토 | 제품 코드 구현 금지 |
| T09 | Round 25 coordination | `ACTIVE COLLECTOR / SOLE COORD WRITER` | 이 ROUND와 worklog append | T01 actual receipt 수집·의미 상태 갱신 | coordination 외 write 금지 |

## 4. 인과 DAG

```text
USER ANSWER
  Q1~Q5 + A/B/C/D 구조 선호 또는 조합
        |
        v
T01 FIRST-VALUE-DECISION-01
  답변 정규화 + RESUME artifact receipt
        |
        v
T04 FIRST-VALUE-VISUAL-4A-01
  서로 다른 4안의 단일 로컬 HTML + 핵심 상태 시퀀스
        |
        v
T10 VISUAL GATE
  시각·접근성·권한·오류/빈 상태·숨은 다음 시퀀스 검수
        |
        v
USER ACTUAL VISUAL APPROVAL
  전후 비교 + 이해 확인 퀴즈 + 명시 승인
        |
        v
DEV IMPLEMENTATION PLAN
  selected visual + P0 auth integration gate + writer/worktree/lease
```

한 단계의 PASS는 다음 단계를 자동 승인하지 않는다. 사용자 답변은 HTML 승인이 아니고, HTML PASS는 제품 구현 승인이나 merge 승인도 아니다.

## 5. 공통 운영프롬프트 §16 적용

- 사용자 답변 전에는 read-only 조사와 대안 정리만 가능하다.
- T04의 4안은 이름·색만 다른 변형이 아니라 레이아웃, 탐색, 밀도, 시각 은유, 상호작용 중 둘 이상이 실질적으로 달라야 한다.
- 한 로컬 HTML에서 네 안을 비교하고, 로딩·빈 상태·권한 없음·오류·취소/되돌리기·다음 화면을 체험 또는 설명한다.
- T10은 HTML과 동일 상태의 실제 증거를 독립 검수한다.
- 사용자에게 실제 화면, 전후 비교, 숨은 다음 시퀀스와 2~4개 이해 확인 질문을 보여준 뒤 명시 승인을 받는다.
- 사용자 시각 승인과 P0 auth integration gate 전에는 제품 구현·merge·Production을 시작하지 않는다.

## 6. Ownership lock

- `FIRST-VALUE-DECISION-01`의 sole owner는 T01이다.
- 사용자 답변 packet과 RESUME artifact를 닫기 전 T01을 PR, DB, Account C, PR #19/#20 또는 다른 설계·구현 작업으로 재배정하지 않는다.
- T04는 사용자 답변 전 writer가 아니며 HTML lease도 없다.
- T10은 reviewer이며 HTML이나 제품 코드를 작성하지 않는다.
- T09만 coordination writer다. 다른 트랙은 `docs/coordination/**`와 `docs/worklog.md`를 수정하지 않는다.

## 7. 보존 상태 — 다시 열지 않음

| 기존 결과 | 보존 상태 | 이번 복구의 의미 |
|---|---|---|
| Account C | PR #21 squash merge, `main@ade79e7`, Vercel Production·공개 auth boundary 확인 | `MERGED / PRODUCTION_DEPLOYED`; 재오픈하지 않음 |
| PR #19 | remote head `62053ba`, CI #90·Vercel green, Draft | `REMOTE_GREEN / MERGE_HOLD`; migration 006·live DB·merge 미승인 |
| PR #20 | base `62053ba`, remote head `dc2cae7`, CI #91·Vercel Preview green, Draft | `REMOTE_GREEN / MERGE_HOLD / NOT_PRODUCTION_READY`; migration 007·DB·merge 미승인 |
| P0 AuthZ | `P0-AUTHZ-WRITER-GATE-01` | `DECISION_PENDING`; First Value 제품 구현의 auth integration 선행 gate |

Account C Production과 PR #19/#20 remote-green 증거는 복구의 안전한 기준선이다. `3분 시작`을 되살린다는 이유로 이 branch, migration 또는 Production 상태를 수정하지 않는다.

## 8. Dirty checkout 보존 영수증

- coordination checkout: `moawork-wt-login-handoff`
- branch: `docs/login-a-handoff-round5`
- HEAD: `40c6b69f5867f183e77a319d844220db2cd98c2d`
- 작업 전 이미 `docs/worklog.md`가 수정 상태였고, Round 16~24와 `docs/design/round-21`, `round-24`, `salvage-round-23`가 미추적 상태였다.
- 기존 dirty 파일을 stage, commit, reset, clean, delete, rename하지 않았다. 허용된 두 파일 외에는 쓰지 않는다.

## 9. 다음 packet과 완료 조건

- 현재 exact WORK-ID: **`FIRST-VALUE-DECISION-01`**.
- 사용자에게 필요한 입력: Q1~Q5 권장 Draft의 채택·수정과 A/B/C/D 구조 선호 또는 조합.
- T01 resume artifact receipt는 검증됐지만 사용자 답변이 없으므로 `FIRST-VALUE-DECISION-01` 완료를 주장하지 않는다.
- 후속에는 경로·상태·의미 변경만 이 Round에 연결한다. hash-only 연쇄 갱신은 하지 않는다.
- 다음 exact WORK-ID는 사용자 답변이 닫힌 뒤 **`FIRST-VALUE-VISUAL-4A-01`**이다.

## 10. Blindspot Pass

- 첫 가치 시간을 줄이려다 실제 tenant·membership이 없는 사용자를 가짜 회사로 통과시키지 않는다.
- 작은 조직 기본값은 대표·팀장·사원만으로 이해돼야 하며 Platform/Admin 고급 구조를 전면에 노출하지 않는다.
- 초대 건너뛰기, 중단 후 복구, 데이터 없음, 권한 없음, 세션 만료, 제출 실패, 중복 제출을 시각 시퀀스에서 다룬다.
- `3분`은 마케팅 문구가 아니라 실제 완주 측정 기준이어야 한다. 시작·성공 이벤트와 실패/이탈 기준은 구현 plan에서 정의한다.
- visual 선택이 P0 tenant/Owner/session 안전 계약을 우회하지 않도록 selected flow와 auth integration gate를 함께 묶는다.

## 11. T01 actual resume artifact receipt

- 파일: [`docs/design/round-21/01-first-value-concepts.md`](../../design/round-21/01-first-value-concepts.md)
- RESUME 시작: 488행, 기존 본문 뒤 append-only.
- 전체: 31,178 bytes / UTF-8 / 596 lines.
- SHA-256: `4CF86B20338F23E4B5FCDA090D813F7A8E63ADB17BF273A91CBB43331BF72317`.
- 기존 prefix: 24,633 bytes / SHA-256 `70DB489CD4378A6E523B4D181B4DED70EC1A944D3CD4417B2941C6A426E68570`; T01 사전 hash와 일치해 원문 불변을 확인했다.
- 추가 구간 secret/PII·trailing whitespace: 0건.
- 현재 기본값은 확정 결정이 아니라 사용자 확인 대기다: 혼자 시작 기본·팀 초대 선택, 사원 기본·팀장 선택, 첫 고객과 첫 업무 함께 생성, 예시는 화면에만 표시, Workspace 생성 후 건너뛰고 오늘 홈에서 재개.
- 다음 상태는 그대로 `USER_DECISION_PENDING`이다. 사용자 답변 전 T04 HTML lease와 DEV 구현 권한은 열리지 않는다.

## 12. 사용자 답변 수집 — 권장 기본값 수락

> 사용자 원문: `그대로`

사용자는 T01 RESUME packet의 권장 기본값 다섯 가지를 변경 없이 수락했다.

1. 혼자 시작을 기본으로 하고 팀 초대는 선택한다.
2. 초대 역할은 사원을 기본으로 하고 팀장을 선택할 수 있다.
3. 첫 고객과 첫 업무를 함께 생성한다.
4. 예시 데이터는 화면에만 표시하고 DB에는 저장하지 않는다.
5. Workspace 생성 뒤 초대·첫 고객을 건너뛸 수 있고 오늘 홈에서 재개한다.

### 상태 전환

| owner | WORK-ID/gate | 최신 상태 | 다음 조건 |
|---|---|---|---|
| T01 | `FIRST-VALUE-DECISION-01` | `USER_APPROVED_DEFAULTS / CLOSING_RECEIPT_PENDING_T01` | 사용자 수락을 확정 계약·downstream packet으로 append하고 actual receipt 제출 |
| T04 | `FIRST-VALUE-VISUAL-4A-01` | `READY_AFTER_T01_PACKET` | T01 closing receipt 뒤 별도 single-HTML file lease 발급 |
| T10 | First Value visual gate | `WAITING_FOR_HTML` | T04 actual HTML·로컬 URL·상태 시퀀스 수신 |
| DEV | implementation | `HOLD / NOT_AUTHORIZED` | T10 visual PASS + 사용자 actual visual 승인 + P0 auth integration gate |

- 이 사용자 답변은 권장 기본값 계약의 승인이지 T04 HTML, 제품 코드, DB, merge 또는 deploy 승인으로 확대하지 않는다.
- T01 actual decision receipt가 도착하면 이 Round 뒤에 파일 경로·bytes/lines·SHA-256과 의미 상태만 연결한다.
- T01 closing receipt 전 `FIRST-VALUE-DECISION-01`을 완전 종료하거나 T04 writer lease를 활성화하지 않는다.
- Account C Production과 PR #19/#20 remote-green/HOLD 상태는 그대로 보존한다.

## 13. T01 결정 종료 영수증 및 T04 시각화 착수

- 실제 결정 산출물: [`docs/design/round-21/01-first-value-concepts.md`](../../design/round-21/01-first-value-concepts.md)
- 결정 종료 블록: 598행부터 `DECISION CLOSED / 2026-07-24`.
- 최종 영수증: 37,144 bytes / UTF-8 / 709 lines / SHA-256 `2DCC6E61589AFCAD09E5DFF97AFD9C2562C555B2AA2433752BC20D5CB460E8AC`.
- append-only 검증: 직전 31,178-byte prefix SHA-256이 `4CF86B20338F23E4B5FCDA090D813F7A8E63ADB17BF273A91CBB43331BF72317`로 직전 전체 영수증과 일치한다.
- `FIRST-VALUE-DECISION-01`: `COMPLETE / USER_APPROVED_DEFAULTS`.
- T01: `DECISION OWNER COMPLETE / DOWNSTREAM READY`; 다른 작업으로 재배정하지 않는 기존 ownership lock은 이 결정 packet 종료까지 충족됐다.
- T04: `FIRST-VALUE-VISUAL-4A-01 = ACTIVE / SOLE_WRITER`; 단일 lease 대상은 `brand/MoaWork_First_Value_Onboarding_4Concepts_v0.1.html`이다.
- T10: `WAITING_FOR_HTML`; T04의 실제 파일 존재·비공백·정확한 영수증을 받은 뒤에만 visual/accessibility/contract gate를 시작한다.
- DEV: `HOLD_BEHIND_P0_AUTHZ_GATE`; T10 visual PASS와 사용자 실제 화면 승인 전 제품 구현 권한은 열리지 않는다.
- 현재 exact WORK-ID는 **`FIRST-VALUE-VISUAL-4A-01`**이다. 다음 인과 연결은 실제 T04 HTML의 경로·bytes/lines·SHA-256과 T10 수신 상태만 기록하며 hash-only 순환 갱신은 하지 않는다.
- Account C Production과 PR #19/#20 remote-green/Draft/HOLD는 보존하며 제품 코드·Git·DB·deploy를 수정하지 않는다.

## 14. T04 HTML 완료 및 T10 독립 PASS — 사용자 시각 선택 대기

- T04 actual HTML: [`MoaWork_First_Value_Onboarding_4Concepts_v0.1.html`](../../../../../brand/MoaWork_First_Value_Onboarding_4Concepts_v0.1.html)
- HTML 영수증: 64,570 bytes / 710 lines / SHA-256 `6FAD81807BE9F97931C09B0E453F3735EB1C88979995E1549182FD24D7617D60`.
- 사용자 비교 URL: `http://127.0.0.1:4318/MoaWork_First_Value_Onboarding_4Concepts_v0.1.html`; 독립 수집 시 HTTP 200과 응답 64,570 bytes를 확인했다.
- T04: `FIRST-VALUE-VISUAL-4A-01 = COMPLETE`; A 카드 자유순서·부분복구, B 선형 체크포인트, C 오늘 홈 비선형 재개, D 설정·결과 미리보기와 작업 로그 복구의 서로 다른 네 구조를 실제 단일 HTML로 materialize했다.
- T10 review artifact: [`docs/design/round-25/10-first-value-visual-4a-review.md`](../../design/round-25/10-first-value-visual-4a-review.md)
- review 영수증: 9,252 bytes / 195 lines / SHA-256 `1712C7E5370E1C01A71A4C5147B9B86FBA0B42353F7C831A2E20BEC8FEEBA63A`.
- T10: `FIRST-VALUE-VISUAL-4A-REVIEW-01 = PASS`; exact HTML SHA 일치, required fixes 0.
- 독립 검수 범위: A/B/C/D 구조 차이, 팀장·사원에서 Owner 흐름·도구 0, 1280/390/320 overflow 0, 일반 터치 control 44px 이상, light/dark, focus-visible, ARIA/live, reduced-motion 실제 적용, console warn/error 0, PII·secret·Platform 고급권한·가짜 저장 0.
- 현재 상태: **`USER_VISUAL_SELECTION_PENDING`**. 사용자가 비교 화면에서 A/B/C/D 중 하나를 명시적으로 선택하기 전 최종안 확정, 제품 구현 계획, 제품 코드 write 또는 merge를 시작하지 않는다.
- DEV: `HOLD_BEHIND_USER_VISUAL_SELECTION_AND_P0_AUTHZ_GATE`.
- 다음 exact gate: **`FIRST-VALUE-USER-VISUAL-SELECTION-01`**. 선택 뒤에만 DEV implementation plan을 작성하며, P0 auth integration gate는 별도로 유지한다.
- Account C Production과 PR #19/#20 remote-green/Draft/HOLD는 재개방하지 않았다. 이 checkpoint는 HTML·review 실제 영수증과 의미 상태만 연결하며 hash recursion을 만들지 않는다.

### 경로 정정 영수증

- 위 HTML 항목의 권위 경로는 `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_First_Value_Onboarding_4Concepts_v0.1.html`이며, 이 문서 기준 상대 링크는 [`../../../../brand/MoaWork_First_Value_Onboarding_4Concepts_v0.1.html`](../../../../brand/MoaWork_First_Value_Onboarding_4Concepts_v0.1.html)이다. 앞선 표시 링크보다 이 경로를 우선한다.

## 15. 사용자 B 선택 및 migration-first 정정

- 사용자 실화면 선택은 **B**로 확정됐다.
- 동시에 사용자는 기존의 빈 조직 전제를 명시적으로 정정했다. 고객사가 0에서 시작한다고 가정하지 않으며, Monday 등 기존 도구의 고객·진행 업무 데이터를 안전하게 옮겨 바로 이어서 쓰는 과정이 first value다.
- 기존 `FVD-03`·`FVD-05`의 `첫 고객 + 첫 업무 자동 생성` 승인 해석은 **`SUPERSEDED_BY_USER_CORRECTION`**이다. 이력은 삭제하지 않되 새 설계나 구현 근거로 재사용하지 않는다.
- 임의의 기본 업무명·`첫 연락하기`·자동 고객/업무 저장은 금지한다. 기존 업무명은 import 원본만 사용하고, 새 업무는 사용자가 나중에 직접 만든다.
- 새 B 흐름: `1. 회사 만들기 → 2. 시작 방법 선택 → 3. 안전한 가져오기 handoff 또는 오늘 홈`.
- 시작 방법은 `Monday에서 내보낸 CSV(추천)`, `일반 CSV 중심 가져오기(엑셀은 CSV로 저장 안내)`, `빈 화면에서 시작`이다. Monday OAuth/API 직접 연결이나 XLSX 직접 지원 완료를 약속하지 않는다.
- 가져오기는 적용 전 write 0인 dry-run·미리보기·필드 매핑·중복/오류/미지정 요약과 Owner final apply·rollback 경계를 유지한다. 팀 초대는 후속 checklist이며 onboarding blocker가 아니다.

### 병렬 개정 상태

| owner | WORK-ID | 상태 | 단일 산출물/다음 조건 |
|---|---|---|---|
| T01 | `FIRST-VALUE-B-SELECTION-01` | `AMENDMENT_ACTIVE / SOLE_SPEC_WRITER` | `docs/design/round-21/01-first-value-concepts.md` 끝에 append-only correction; 실제 receipt 전 완료 처리 금지 |
| T04 | `FIRST-VALUE-B-MIGRATION-VISUAL-02` | `ACTIVE / SOLE_HTML_WRITER` | `C:\Users\belie\Desktop\Belief\서울리드프로젝트\brand\MoaWork_First_Value_Onboarding_B_Migration_v0.2.html`; 실제 파일·HTTP·receipt 전 완료 처리 금지 |
| T10 | B migration visual review | `WAITING_FOR_V0.2_HTML` | exact v0.2 SHA를 받은 뒤 독립 재검수 |
| DEV | implementation/merge | `HOLD` | T01 amendment + T04 v0.2 + T10 PASS + 사용자 최종 시각 승인 + P0 auth integration gate |

- 현재 통합 상태는 **`FIRST-VALUE-B-MIGRATION-REVISION_ACTIVE`**다.
- 기존 v0.1 4안 HTML과 T10 PASS는 사용자가 B를 선택한 당시의 선택 이력으로 보존한다. 이 PASS를 migration 중심 v0.2의 PASS 또는 `USER_FINAL_VISUAL_APPROVAL`로 승격하지 않는다.
- 다음 수집 순서는 T01 actual amendment receipt와 T04 actual v0.2 receipt를 각각 고정한 뒤, exact HTML SHA를 T10 `FIRST-VALUE-B-MIGRATION-VISUAL-REVIEW-02`로 전달하는 것이다.
- 제품 코드·Git·DB·deploy·P0 ops·merge는 HOLD다. Account C Production과 PR #19/#20 remote-green/Draft/HOLD도 재개방하지 않는다.

## 16. B migration 개정 완료 및 사용자 최종 시각 승인 대기

### T01 amendment actual

- 산출물: [`docs/design/round-21/01-first-value-concepts.md`](../../design/round-21/01-first-value-concepts.md)
- 영수증: 47,089 bytes / 877 lines / SHA-256 `8BA3E9B9A0D23053C173331AAC13E30511A85FA90BD5449A3316F714D6525F39`.
- amendment는 711행부터 append됐고, 기존 37,144-byte prefix hash 일치로 append-only가 확인됐다.
- 상태: `FIRST-VALUE-B-SELECTION-01 = COMPLETE / USER_CORRECTION_MATERIALIZED`.
- `FVD-03`·`FVD-05 = SUPERSEDED_BY_USER_CORRECTION`; Monday CSV 우선 safe-import와 빈 시작 분기, 팀 초대 후속화, 자동 고객/업무 생성 금지가 새 정본이다.

### T04 v0.2 actual과 수정 이력

- 실제 HTML: [`MoaWork_First_Value_Onboarding_B_Migration_v0.2.html`](../../../../brand/MoaWork_First_Value_Onboarding_B_Migration_v0.2.html)
- 사용자 URL: `http://127.0.0.1:4319/MoaWork_First_Value_Onboarding_B_Migration_v0.2.html`; 독립 재확인 시 HTTP 200 / 43,502 bytes.
- 초기 후보 `EEB18A24E47EB9AF28BA65779CE1F9DF8190E5B0CEBCF2BED9ADAE861DF832E1`은 `FAIL_HISTORY`: Owner 최종 적용과 batch rollback 후속 경계 고지가 빠져 있었다.
- T04가 같은 v0.2 파일에 최소 수정해 `여기서는 미리보기까지만`, `실제 적용과 되돌리기는 데이터 가져오기 화면에서 대표가 최종 확인` 경계를 노출했다.
- 최종 영수증: 43,502 bytes / 523 lines / SHA-256 `9EA2E7C664463A092F0762E408A30C07DE716723431AEFE5DE6D0E00BCBF6F80`.
- 적용 실행 버튼 0건, `가져오기 설정 계속하기` handoff CTA만 유지했다.
- 상태: `FIRST-VALUE-B-MIGRATION-VISUAL-02 = COMPLETE`.

### T10 review-02

- 검수 문서: [`docs/design/round-25/10-first-value-b-migration-visual-review.md`](../../design/round-25/10-first-value-b-migration-visual-review.md)
- 영수증: 5,644 bytes / T10 content-line convention 81 lines / SHA-256 `AD426804E04A8DDC4230A921CEF953908C4604B06E1A8886B3CBCB20AF1442AC`.
- 독립 파일 재검산은 같은 bytes/SHA를 확인했다. raw LF 기반 physical count는 83이며, 판정 의미에는 차이가 없다.
- 판정: `FIRST-VALUE-B-MIGRATION-VISUAL-REVIEW-02 = PASS — VISUAL/INTERACTION PROTOTYPE ONLY`.
- 새 SHA에서 누락 고지 노출, 적용 실행 버튼 0, continue CTA만 존재, 1280/390/320·light/dark·focus·reduced-motion·console·PII/secret/Platform UI 경계를 통과했다.

### 최종 상태와 gate

- 현재 통합 상태: **`FIRST-VALUE-B-MIGRATION-USER-FINAL-APPROVAL_PENDING`**.
- T10 PASS는 HTML 시각·상호작용 목업에만 한정된다. 사용자가 최종 SHA 화면을 직접 보고 B migration 개정안을 명시적으로 승인하기 전 제품 구현·merge를 시작하지 않는다.
- 다음 exact gate: **`FIRST-VALUE-B-MIGRATION-USER-FINAL-VISUAL-APPROVAL-01`**.
- DEV·제품 코드·Git·DB·migration·merge·deploy·P0 ops는 `HOLD`다. Account C Production과 PR #19/#20 remote-green/Draft/HOLD는 재개방하지 않는다.

## 17. 로그인 화면 즉시 최신화 완료

- 사용자 지시 `로그인 화면 빨리 최신화`를 별도 실행 승인으로 받아, Preview에만 남아 있던 PR #18 로그인 디자인을 최신 Production까지 종결했다.
- PR #18은 기존 기능 head를 `main@ade79e753ff4c99eab68b5a36bd8195245a6d57b` 위로 재정렬했고, 최종 head는 `137fd7fbf3c30a9784fb102008ec155bf3c08bac`다.
- final head 검증은 lint·typecheck·production build PASS, app **493 PASS / 기존 RLS 5 SKIP**, worker **14 PASS**였다. 기존 5 SKIP은 실DB 자격증명 없는 RLS 묶음이며 로그인 변경의 PASS 근거에 포함하지 않았다.
- T10이 exact head와 실제 Vercel Preview를 독립 확인해 desktop/mobile, light/dark, 키보드·focus, reduced-motion, console, OAuth CTA 및 Account C 회귀를 `PASS`로 판정했다.
- 사용자 즉시 실행 지시에 따라 PR #18을 병합했다. merge commit은 `b79e63a5a22c636538fe99b13e56c4b16295d58d`다.
- 병합 후 GitHub Actions CI run [`30066564973`](https://github.com/bbelieff/moawork/actions/runs/30066564973)은 push event, exact merge SHA에서 `completed / success`다.
- Vercel Production deployment `EQCMET3Ys8dxZHbmMUBNxsRTdPuz`는 exact merge SHA에서 `Deployment has completed / success`다.
- 공개 `https://www.moa-work.com/login`을 다시 읽어 기존 작은 중앙 로그인 박스가 아니라 새 분할 레이아웃·브랜드 문구·로그인 패널 DOM과 실제 visual이 표시되는 것을 확인했다. 따라서 `LOGIN-A-PRODUCTION-REFRESH = MERGED / DEPLOYED / PUBLIC_READBACK_PASS`로 닫는다.
- Account C Production과 PR #19/#20 Draft/HOLD, 006/007·P0 AuthZ 운영 gate는 로그인 병합으로 자동 개방하지 않는다.

## 18. 온보딩 순서 변경과 v0.2 보완 검수

- 사용자 확정 순서는 **`회사 이름 정하기 → 팀원 초대하기 → CSV 가져오기`**다. 이전 `회사 → 시작 방법 선택 → CSV` 배열과 `팀 초대는 후속 checklist` 해석은 `SUPERSEDED_BY_USER_ORDER`다.
- T04는 같은 [`MoaWork_First_Value_Onboarding_B_Migration_v0.2.html`](../../../../brand/MoaWork_First_Value_Onboarding_B_Migration_v0.2.html)을 새 순서로 수정했다.
- 첫 독립 검수는 두 건을 `FAIL`로 반려했다.
  1. 왼쪽 단계 rail에서 아직 완료하지 않은 다음 단계를 눌러 회사·팀원 순서를 우회할 수 있었다.
  2. 실제 저장된 checkpoint가 없는 첫 진입에서도 `중단한 곳에서 보기`가 CSV 단계로 곧장 이동할 수 있었다.
- 보완본은 `maxUnlockedStep`보다 뒤 단계 rail을 차단하고, resume을 기본 disabled로 두며 실제 재개 상태에서만 명시적으로 활성화했다. 취소·오류 시에도 회사와 팀원 단계의 보존 상태와 데이터 write 0을 안내한다.
- 최종 HTML 영수증은 **45,465 bytes / 539 lines / SHA-256 `62F4BF4EE5E276FA2C9086DC6B397BF8A58728B40DE3E26081B0168A4A016621`**다.
- 보완 후 T10은 순서 우회 0, 허위 resume 0, desktop/390/320, light/dark, 키보드·focus, reduced-motion, console과 write 0 경계를 재검증해 `PASS — VISUAL/INTERACTION PROTOTYPE ONLY`로 판정했다.
- 이 PASS는 새 사용자 순서와 HTML 목업을 승인 가능한 상태로 만든 것이며, 제품 onboarding route·DB·초대·CSV apply 구현 또는 merge/deploy 승인은 아니다.

## 19. CSV migration sidecar와 제품 통합 gate

- 별도 sidecar `C:\Users\belie\Desktop\Belief\서울리드프로젝트\csv-migration-lab`이 제품 repo 밖에 생성됐다. 제품 repo·DB·PR #19/#20·coordination 파일을 수정하지 않은 독립 dry-run 실험면이다.
- 산출물은 `docs/architecture.md`, `src/import-engine.mjs`, `index.html`, `src/app.mjs`, fixture와 `tests/import-engine.test.mjs`다. 로컬 검증 URL은 `http://127.0.0.1:4321/`이다.
- parser/mapping/dry-run 테스트를 현재 환경에서 다시 실행해 **7/7 PASS / fail 0 / skip 0**을 확인했다. 고객사 fixture는 total 3 / ready 1 / warning 1 / error 1, 진행 업무 fixture는 total 3 / warning 2 / error 1, 실제 products/DB write는 0건이다.
- `CSV-MIGRATION-SIDEPROJECT-01 = PASS_WITH_INTEGRATION_GATES`. CSV 파싱, 한 batch 한 target, 명시적 매핑·정규화, 오류·중복·미연결 격리와 임시 데이터시트는 동작한다.
- 제품 통합 핵심 blocker는 아직 서버/DB의 `ImportJob`·`ImportRow`, tenant/Owner 재확인, idempotent apply, audit, batch rollback·충돌 처리, 파일 보관·암호화·보존기간, 대용량·인코딩·fuzz 검증이 없다는 점이다. Monday OAuth/API 및 XLSX 직접 지원도 범위 밖이다.
- 제품 연결은 전용 additive migration/RLS writer lease, T02 매핑·중복·연결 정책, T08 parser·대용량·접근성 회귀, T10 tenant/Owner 공격검사, 사용자 실제 화면 승인 뒤에만 개방한다. 새 온보딩의 세 번째 단계는 당분간 이 sidecar의 dry-run 계약을 소비하고 실제 apply는 차단한다.
- 이번 coordination sole-writer는 이 `ROUND-25.md`와 `docs/worklog.md`에만 append했다. 기존 dirty/untracked 상태를 보존했고, 제품 코드·HTML·Git stage/commit/push·DB·migration·PR·deploy write는 수행하지 않았다.

## 20. 로그인 후 타 사용자 진입·PR #19/#20·P0 AuthZ·CSV hardening 수집

### Production 로그인 뒤 타 사용자가 진입하지 못하는 이유

- 현재 Production 기준 `main`은 `b79e63a5a22c636538fe99b13e56c4b16295d58d`다.
- 일반 사용자의 Google OAuth와 사용자 프로필 갱신은 성공한다. 그러나 해당 사용자에게 연결된 `org_members` 행이 없고, 안전한 초대 생성·수락 경로도 아직 제품화되지 않아 callback이 `/login?error=membership`로 차단한다.
- 이 문제는 로그인 UI나 Google OAuth 실패가 아니라 **Workspace membership provisioning 부재**다. 이메일 allowlist 확대 또는 직접 membership 삽입은 현행 owner/admin 권한 취약 경로를 우회하므로 해결책으로 사용하지 않는다.

### PR #19 — 최신 main rebase와 원격 검증

- PR #19 로컬 rebase chain은 `main@b79e63a` 위 후보 `564fc6b666a23948f33f27cf7ced4f8d55e1ab8f`와 검증 영수증 보정 commit을 거쳐 최종 원격 head `631976bde23632fc6cf4722951dec2832066da82`가 됐다. `631976b`의 parent는 `564fc6b`다.
- PR #19는 [Draft/Open/MERGEABLE](https://github.com/bbelieff/moawork/pull/19)이며 GitHub CI run [`30068754941`](https://github.com/bbelieff/moawork/actions/runs/30068754941), GitGuardian, Vercel Preview, Vercel Preview Comments가 모두 PASS다.
- migration `006`의 live DB 적용·비적용 상태와 non-skip smoke/공격 증거가 없다. 따라서 원격 green은 `MERGE_READY` 또는 `PRODUCTION_READY`가 아니며 PR #19는 **MERGE HOLD**다.

### P0 AuthZ writer gate

- read-only preflight는 완료했지만 Production Supabase의 migration ledger, owner cardinality, membership anomaly, 실제 policy/ACL을 읽을 권한이 없어 `P0-AUTHZ-WRITER-GATE-01 = NOT OPEN`이다.
- 다음 exact WORK-ID는 **`P0-AUTHZ-LIVE-PREFLIGHT-01`**이다. 사용자가 승인한 Production Supabase read-only 접근으로 식별자·이메일·토큰을 출력하지 않는 aggregate-only 검사를 먼저 수행해야 한다.
- 필요한 집계는 실제 migration ledger/digest, owner 0명 또는 2명 이상 Workspace 수, owner scope mismatch, duplicate/orphan/invalid membership, 위험 policy/table grant, legacy Platform→Workspace 권한 합성, in-flight onboarding/member write다. anomaly가 하나라도 있으면 자동 보정하지 않고 abort·remediation gate로 전환한다.

### CSV migration sidecar hardening

- 기존 한 batch 한 target, write 0 dry-run 계약에 column count mismatch 격리와 silent truncation 금지를 추가했다. 원본 cell과 예상 밖 값을 보존하며 5 MiB, 데이터 10,000행, 100열, cell당 10,000자 제한을 엔진과 UI 양쪽에서 fail closed로 적용한다.
- 인코딩은 자동 추측하지 않는다. 기본 UTF-8과 사용자가 명시적으로 선택하는 CP949/EUC-KR 경로만 제공하며 잘못된 인코딩·지원하지 않는 byte는 preview를 비우고 실행을 차단한다.
- 현재 engine 테스트는 **15/15 PASS**다. 독립 판정은 `PASS_WITH_NONBLOCKING_BROWSER_GAP`: 실제 OS file chooser를 통한 wrong-encoding 전환은 브라우저의 local file 권한 제약으로 `NOT_RUN`이며, sidecar 폴더가 Git 저장소가 아니어서 exact commit/diff provenance가 없다.

### PR #20 — 기술 green이나 제품 계약 충돌로 원격 write HOLD

- 로컬 후보는 base `564fc6b666a23948f33f27cf7ced4f8d55e1ab8f`, head `95a87bf7f517d284cd107bc568603df5c0c49afd`다. targeted 8 files/39 PASS, app 524 PASS + 기존 RLS 5 SKIP, worker 14 PASS, lint·typecheck·build·diff 검사 PASS다.
- T10 최종 판정은 **FAIL / HOLD**다. 첫째, 구현 영수증이 이전 base/head를 기록해 현재 후보와 일치하지 않는다. 둘째, 최신 사용자 결정은 자동 첫 고객·첫 업무 생성을 `SUPERSEDED_BY_USER_CORRECTION`으로 폐기했지만 PR #20은 아직 고객과 업무를 함께 만들고 빈 업무명에 `${회사명} 업무`를 자동 부여한다.
- 로컬 기술 green을 제품 계약 PASS로 승격하지 않는다. 새 head는 push하지 않았고 원격 PR #20은 기존 `dc2cae7` Draft/HOLD 상태를 유지한다. 자동 첫 업무 계약을 폐기·재설계하기 전 원격 갱신·merge·007 적용·deploy를 금지한다.

### 통합 상태와 다음 결정

- PR #19: `REMOTE GREEN / DRAFT / MERGE HOLD_BEHIND_006_LIVE_DB_EVIDENCE`.
- P0 AuthZ: `READ_ONLY_PREFLIGHT_COMPLETE / WRITER_GATE_NOT_OPEN`.
- CSV sidecar: `15/15 PASS / PASS_WITH_NONBLOCKING_BROWSER_AND_PROVENANCE_GAPS / PRODUCT_WRITE_0`.
- PR #20: `LOCAL_TECHNICAL_GREEN / T10_FAIL_PRODUCT_CONTRACT / REMOTE_UNCHANGED_DRAFT_HOLD`.
- 다음 사용자 결정은 Production Supabase aggregate-only read preflight 승인과, 최신 migration-first 원칙에 따라 PR #20의 자동 첫 업무 흐름을 폐기·재설계할지 여부다.
- 이번 coordination write는 이 문서와 `docs/worklog.md`에만 append했다. 제품 코드·Git stage/commit/push·DB·migration·merge·deploy write는 수행하지 않았다.

## 21. Production Supabase aggregate-only preflight와 구현 착수

### 운영 집계 증거

- 2026-07-24 승인된 Production Supabase read-only 프리플라이트를 수행했다. 첫 migration registry 조회는 대상 테이블이 존재하지 않아 read-only 실패했고, 식별자·이메일·토큰은 수집하지 않았다. 이어서 실행한 aggregate-only 조회는 정확히 1행을 반환했다.
- Workspace 집계는 `org_count=1`, `owner_zero=0`, `owner_multiple=0`, `owner_scope_mismatch=0`, `duplicate_membership_pairs=0`이다. 현재 표본에서 owner 정확히 1명 불변식과 중복 membership 이상은 발견되지 않았다.
- 현행 권한 경계 집계는 `app_admin_role_exists=true`, `org_write_policy_count=3`, `risky_direct_grants_count=24`, `users_select_policy_count=1`, `members_manage_policy_count=1`이다. 이는 광범위 정책과 직접 grant가 아직 운영 DB에 남아 있음을 뜻하며, 안전한 초대·멤버십 경로를 우회해 직접 membership을 넣을 근거가 아니다.
- migration 적용 집계는 `migration_registry_table_exists=false`, `bootstrap_workspace_006_function_exists=false`, `create_first_lead_007_function_exists=false`다. 따라서 006·007의 운영 적용을 주장하지 않으며 PR #19/#20과 운영 migration은 계속 HOLD한다.

### 다음 실행 상태

- `P0-AUTHZ-LIVE-PREFLIGHT-01 = AGGREGATE_READ_COMPLETE`. owner cardinality anomaly는 0이지만 광범위 policy/grant와 legacy `app_admin_role` 경로가 확인되어 operational writer gate는 열지 않았다.
- 로컬 P0 구현은 새 독립 worktree/branch `agent/p0-authz-invite`에서 `ACTIVE`다. 초대·수락·membership 보호 구현과 테스트를 제품/운영 적용 전 후보로 만든다.
- 사용자에게 보여줄 visual 4A 비교 작업도 `ACTIVE`다. 실제 제품 merge 전에 네 시안 HTML, 독립 검수, 사용자 시각 승인 게이트를 적용한다.
- 운영 DB write, migration 적용, partner membership 직접 삽입, PR merge, Production deploy는 `HOLD`. 로컬 구현과 목업은 운영 권한 부여나 배포 승인이 아니다.
- 이번 append는 집계 증거와 상태 전환만 기록했다. 기존 dirty/untracked 상태를 보존했고 제품 코드·Git stage/commit/push·DB·migration·merge·deploy write는 수행하지 않았다.

## 22. 온보딩 4A 최종 검수와 P0 후보 재판정

### 회사 이름 → 팀원 초대 → CSV 가져오기 4A

- 최종 비교 파일은 [`MoaWork_Onboarding_Company_Invite_CSV_4Concepts_v0.1.html`](../../../../brand/MoaWork_Onboarding_Company_Invite_CSV_4Concepts_v0.1.html)이며, 47,563 bytes / SHA-256 `1672B6E00CBF3C2ABAFEF660C9B5C511B5CCF44F707BA93042B166C4733D3B02`다.
- 사용자 비교 URL은 `http://127.0.0.1:4322/MoaWork_Onboarding_Company_Invite_CSV_4Concepts_v0.1.html`이다. 이 coordination 기록 시점에는 로컬 서버가 종료되어 URL 재조회는 되지 않았으며, 파일 영수증을 정본으로 보존한다.
- 첫 T10 검수는 접근성 누락과 남아 있던 영문 문구 때문에 `FAIL`이었다. 해당 항목을 수정한 최종 파일은 독립 재검수에서 `PASS / USER_VISUAL_SELECTION_READY`를 받았다.
- reduced-motion은 수정 전 검증 이력은 있으나 최종 수정본에서의 실제 브라우저 재에뮬레이션이 `NOT_RUN`이다. 정적 규칙 보존으로 확인되어 비차단 gap으로 남기되, 사용자 선택 뒤 제품 구현 검수에서 다시 실행한다.

### P0 AuthZ 로컬 후보와 T10 반려

- 로컬 후보는 commit `821433e99004bceca758ad21ca3eac439e9a7e38`, tree `3881ec9afb0708ef1163bab14498b5f28db2a41f`이며, 정적 계약 테스트 32건은 PASS했다.
- 그러나 T10 최종 판정은 `FAIL / NO OPERATIONAL ADVANCE`다. `create_workspace_with_owner`, profile/session 계약, 일반 member 관리와 owner transfer, migration 번호 정합, enum/type guard, 실제 DB 공격테스트 1~55 non-skip 증거가 모두 충족되지 않았다.
- 정적 32 PASS를 운영 준비 완료로 승격하지 않는다. 후보는 로컬에만 두고 Production DB 적용, 원격 push, PR merge, deploy를 계속 HOLD한다.

### migration 순서와 호환 앱 단계

- 운영 집계에서 006·007 함수가 적용되지 않았고, 사용자는 자동 첫 고객·첫 업무 생성을 폐기했다. 따라서 PR #20의 `007_first_lead`는 `SUPERSEDED_BY_USER_CORRECTION / REMOTE HOLD`로 유지한다.
- 006 뒤의 다음 로컬 migration 후보는 `007_p0_authz_expand.sql`로 정렬한다. 기존 PR #20의 first-lead 007을 운영 순서에 끼워 넣지 않는다.
- 호환 앱 단계는 별도 worktree `moawork-wt-p0-compat-app`에서 `ACTIVE`다. 이는 DB migration 전후의 안전한 cutover 후보를 만드는 로컬 단계이며, 운영 적용 승인이 아니다.
- 현재 통합 상태는 `ONBOARDING_4A_USER_VISUAL_SELECTION_READY / P0_AUTHZ_T10_FAIL / COMPAT_APP_ACTIVE / OPS_HOLD`다. 운영 DB write, migration 적용, 원격 push, merge, Production deploy는 모두 HOLD다.
- 이번 writer는 `ROUND-25.md`와 `docs/worklog.md`에만 append했다. 기존 dirty/untracked 상태를 보존했고 제품 코드·Git·DB·deploy write는 수행하지 않았다.

## 23. P0 session integration 최종 후보와 운영 차단점

### 로컬 후보 영수증

- AuthZ DB 교정 후보는 commit `dcb39f3a5f236cab82dd96f64b76515f183ecca3`, tree `57488e778cbf20f4dc206b2cd9842513336ada54`다. 정적 계약 테스트 85건은 PASS했으며, T10 판정 범위는 앱 계층과 disposable 검증에 한정된 PASS다. Production DB 적용 또는 운영 공격검증 PASS로 승격하지 않는다.
- compatibility app 최종 후보는 commit `a07b531fe676824ee7be28e00972d5ebe1c4d89e`, tree `142b2449afbde095f64b55cc76e11cc1abc4eafc`다. T10은 `PASS / INTEGRATION_READY`로 판정했으며, DB migration보다 먼저 배포되어야 하는 호환 단계다.
- 통합 branch/worktree는 `agent/p0-session-integration` / `moawork-wt-p0-session-integration`이다. 최종 commit은 `112a5ad78c49b31bcaf1b8d5d4e26ccee314b5ec`, tree는 `6bbc5be08af62e75bcd4135321ddf10d7b10cd39`, merge-base는 PR #19 후보 `631976bde23632fc6cf4722951dec2832066da82`이며 worktree는 clean이다.
- 통합 후보 검증은 targeted 26 PASS, app 525 PASS와 기존 RLS 5 SKIP, worker 14 PASS, lint·typecheck·production build·정적 85건·session 계약 PASS다. T10의 최종 범위도 app/disposable DB에만 한정된 PASS이며, 운영 DB 증거를 대신하지 않는다.

### 반드시 지켜야 할 순서와 현재 미완료 기능

- compatibility app을 migration보다 먼저 적용해야 한다. session registry 강제 이후 기존 로그인 세션은 새 registry row가 없으므로 재로그인이 필요하다.
- Owner provider 재인증 route는 아직 없다. owner transfer나 고위험 owner mutation은 이 경로가 구현되고 검증될 때까지 HOLD다.
- 초대 링크 발송/전달과 invite accept 제품 UI가 아직 없다. DB 계약과 로컬 후보가 있어도 다른 사용자는 초대를 받아 membership을 완성할 수 없으므로 Production 로그인 진입 문제는 아직 해결되지 않았다.
- disposable DB에서의 실제 RLS·동시성 공격테스트와 계약 항목 전체의 non-skip 실행은 `NOT_RUN`이다. 기존 app RLS 5 SKIP도 P0 완료 증거로 계산하지 않는다.
- 원격 push, PR 갱신·merge, Production DB migration/write, 배포, partner/member 직접 반영은 모두 `HOLD`다. 다음 진입 조건은 disposable DB 전체 검증, T10 독립 재판정, 사용자 운영 승인이다.

### 시각 선택 게이트

- 온보딩 4A 비교본은 T10 `PASS / USER_VISUAL_SELECTION_READY`다. 사용자는 `http://127.0.0.1:4322/MoaWork_Onboarding_Company_Invite_CSV_4Concepts_v0.1.html`에서 A/B/C/D 중 실제 방향을 선택해야 한다.
- 현재 통합 상태는 `P0_SESSION_INTEGRATION_LOCAL_PASS_SCOPED / DISPOSABLE_DB_ATTACKS_NOT_RUN / INVITE_ACCEPT_UI_MISSING / USER_VISUAL_SELECTION_PENDING / OPS_HOLD`다.
- 이번 coordination writer는 이 문서와 `docs/worklog.md`에만 append했다. 기존 dirty/untracked 상태를 보존했고 제품 코드·Git·DB·migration·remote·merge·deploy write는 수행하지 않았다.
