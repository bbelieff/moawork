# 서류 체크리스트 (BBE-110)

정책자금 상품마다 필요 서류가 다르다(벤처인증=사업계획서·기술설명서 / 소진공=매출자료·신분증 …).
딜 하위 체크리스트 + 완료율 표시, 상품 선택 시 회사 공용 기본 프리셋을 제안한다.

Linear: BBE-110 · 근거: `docs/design/블루프린트대조_온보딩설계_v1.md` §3-5 · 결정: D58(업종→상품 후보).

## 구성

| 파일 | 내용 |
| --- | --- |
| `types.ts` | `ChecklistItem`(딜별, checked 있음) · `ChecklistPresetItem`(상품별, checked 없음) · `ProductChecklistPreset` · `DealChecklistState` · `ChecklistCompletion` |
| `engine.ts` | 순수 계산부 — apply/toggle/add/remove/completionOf/toPresetItems. `completionOf` 가 완료율의 **유일한** 계산 지점(표의 셀·상세 패널이 공유) |
| `store.ts` | globalThis 인메모리 저장소, org 스코프(`boards/groupLayout.ts` 와 같은 idiom) |
| `service.ts` | `ChecklistService` — engine+store 결합, 상품 적용·프리셋 저장 등 실제 동작 |
| `actions.ts` | "use server" — 클라이언트에서 부르는 진입점. 배럴(`index.ts`)에서 제외(서버 전용) |
| `products.ts` | `CHECKLIST_PRODUCT_CATEGORY` — v6 목업 "진행 상품" 7종(dump-mockup.mjs 실측) |

## 경계

- 001 deals 의 `custom`(JSONB) 이나 T05 커스텀필드 엔진(13종 FieldType)에 얹지 않는다 —
  체크리스트는 "딜마다 자유 추가/삭제 + 상품별 기본값"이 필요한데 13종 어디에도 맞지 않고,
  커스텀필드 엔진을 억지로 확장하면 2중 구현 금지 규약에 걸린다.
- "진행 상품"은 `./products`(v6 목업 "계약업체 실무" 탭 실측 7종)를 참조키로 쓴다.
  `@/lib/policyfund/presets` 의 `product`(59종, 002 시드의 구 먼데이 스크레이핑 원본)와는
  세대가 다르다 — 섞지 않았다. 목업이 바뀌면 `node docs/design/dump-mockup.mjs work` 로
  재실측한다.
- 딜 상세 페이지(`app/(app)/deals/[dealId]`) 연결은 이번 카드 리스 밖 — `components/policyfund/
  ChecklistPanel`·`ChecklistCompletionCell` 이 각각 상세·표에 바로 얹을 수 있는 완결형이다.
  BBE-47 이 `/newcust` 연결을 WO-7 로 미룬 것과 같은 패턴.

## 완료율 단일 소스 규약(수용 기준 2)

`ChecklistPanel`(상세)과 `ChecklistCompletionCell`(표의 셀) 은 각자 계산하지 않고 둘 다
`completionOf(items)` 하나만 부른다. 두 화면이 같은 항목을 보는 한 항상 같은 값을 그린다 —
계산식이 두 군데로 복제되면 반올림·분모 처리가 갈라져도 아무도 못 알아채는 사고가 나기 쉽다.
