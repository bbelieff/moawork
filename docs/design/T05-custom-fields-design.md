# T05 — 커스텀필드 엔진 설계 (core.custom)

> 트랙: **T05 커스터마이징** · 상태: 설계(구현은 T02 파운데이션 머지 후 착수)
> 작성 2026-07-21 · 대상: `field_defs` · `field_values` · `saved_views` (먼데이 컬럼 자유도 재현)
> 근거: `docs/PLAN-v0.2.md` §3 core.custom · `supabase/migrations/001_schema_v1.sql` · T02 산출물(`app/src/lib/crm/*`)

먼데이(monday.com)의 "컬럼을 마음대로 추가/설정"을 **코어 구조는 고정한 채** 재현하는 엔진의 설계다.
조직(org)이 자기 컬럼·선택지·저장뷰를 만들어 쓰고, 새로고침 후에도 유지되게 한다(PLAN §3 완료 판정).

---

## 상태 (2026-07-21 갱신)

- **OQ-1 해소(ADR-0002)**: 정본 = **A안 `001_schema_v1.sql`**. B안 `0002_core_crm.sql` 폐기. → §0 BLOCKER 해소.
- **엔진 구현 완료(자기완결 계층)**: `app/src/lib/custom/` — 아래 §10. check.sh 초록.
- **정합 대기(followup)**: 공유 포트 `@/lib/repo` 넓히기 + API 라우트는 T02 001-모델 재작성 정착 후.

## 0. 스키마 충돌 — 해소됨 ✅ (원 BLOCKER, ADR-0002 로 종결)

> **판정(2026-07-21): A안 001 정본, B안 0002 폐기.** boards/items/board_columns/column_values 는 존재하지 않는 것으로 취급. 아래 표는 판정 배경 기록용으로 보존한다.


설계에 앞서 저장소에 **커스터마이징 레이어를 정의하는 마이그레이션이 두 벌** 있음을 확인했다. 착수 전 조율로 하나를 확정해야 한다.

| | `001_schema_v1.sql` (PLAN v0.2 §5 확정 스키마) | `0002_core_crm.sql` (T02 산출) |
|---|---|---|
| 커스텀 정의 | `field_defs` (entity=company/deal, `field_type` 13종, `options_jsonb`, `module_key`) | `board_columns` (`ColumnType` 6종: text/number/date/status/people/formula) |
| 커스텀 값 | `field_values` (`entity_id`,`field_key`,`value_jsonb`) | `column_values` (`item_id`,`column_id`,`value`) |
| 저장뷰 | `saved_views` (entity 스코프, `filters_jsonb`/`sort_jsonb`/`columns_jsonb`, `shared`, `user_id`) | `saved_views` (board 스코프, `config` jsonb, `is_default`) |
| 도메인 모델 | 정규화 코어(`deals`/`companies`)에 커스텀 컬럼을 **얹음** | 범용 `boards`/`items` 제네릭 모델 |

**충돌 사실:**
1. `saved_views` 테이블이 **두 파일 모두에서 `create table` 됨** (`001:210`, `0002:144`) — 컬럼 정의가 서로 다름. 파일명 사전순 정렬 시 `0002_core_crm` → `001_schema_v1` 순으로 적용되면, 001의 `create table saved_views`(IF NOT EXISTS 없음)가 **중복 생성으로 실패**한다.
2. 필드 타입 체계가 13종(001) vs 6종(0002)으로 불일치. 저장 위치(`field_values` vs `column_values`)도 다름.

**이 설계의 입장:** 착수 지시가 명시적으로 `001_schema_v1.sql`의 `field_defs`/`saved_views`를 가리켰고, PLAN §5가 "DB 스키마 v1 = 001 (확정·검증완료)"라고 못박았으므로 **본 설계는 001을 정본(SSOT)으로 삼는다.** 단, T02가 이미 `0002` 모델 위에 스토어·서비스·API·테스트를 구현해 머지했으므로, 아래 §7에서 **정합(reconciliation) 방안**을 두 가지로 제시하고 코디네이터 판정을 요청한다. **판정 전에는 엔진 구현에 착수하지 않는다.** (경계 존중 — AGENTS 규칙 5)

> 참고: 착수 지시의 "custom_views 테이블"은 실제 스키마에 없다. 001·PLAN §3 모두 테이블명은 **`saved_views`**. 본 설계는 `saved_views`로 표기한다.

---

## 1. 목표와 비목표

**목표(core.custom 스코프):**
- 조직별 커스텀필드 정의(추가/수정/재정렬/보관) — `field_type` 13종 재현.
- 필드 타입별 **선택지(옵션) 관리** — `select`/`multiselect`의 라벨·색·순서, 저장값 안정성.
- 저장뷰(saved view) — 필터/정렬/표시컬럼, 개인/공유, 기본 뷰.
- 업종팩 프리셋 필드(`module_key`) 소비 — 값·라벨 seed는 T09/002가 제공, 본 트랙은 렌더/락 처리.

**비목표(다른 트랙/Phase):**
- 필드 정의의 **DB RLS 정책 본체** → T03 (정책은 001에 이미 존재: `fielddefs_rw`/`fieldvals_rw`/`savedviews_rw`, 런타임 검증은 T03·T10).
- 정책자금 **프리셋 실제 값**(지역/상품/기관 라벨) seed → T09 / `002_seed_policyfund.sql`.
- 먼데이 **formula 수식**(수수료/총매출/D+180·365) → core.crm 정산(`settlements` generated column). core.custom의 필드 타입에는 formula가 **없다**(001 `field_type`에 없음). 커스텀필드는 사용자 입력 값만 다룬다.
- 인증/세션 주입 → T03 (`RequestContext`는 현재 `{orgId,userId}` 스텁, T02와 동일).

---

## 2. 스키마 앵커 (001_schema_v1.sql)

```
field_type ENUM(13):
  text · longtext · number · date · datetime · select · multiselect
  · phone · email · file · person · url · checkbox
field_entity ENUM: company · deal

field_defs(id, org_id, entity, key, label, type,
           options_jsonb, module_key, sort_order,
           UNIQUE(org_id, entity, key))

field_values(org_id, entity_id, field_key, value_jsonb,
             PRIMARY KEY(entity_id, field_key))

saved_views(id, org_id, user_id, entity, name,
            filters_jsonb, sort_jsonb, columns_jsonb, shared)
```

관찰:
- `field_values`는 **엔티티 무관 키/값 저장소** — `entity_id`가 company.id 또는 deal.id. 참조무결성은 앱이 보장(다형 FK 없음).
- `deals.custom jsonb`(001:167)에도 "간이 저장"이 있으나 정본은 `field_values`. **본 엔진은 `field_values`를 정본으로 쓰고, `deals.custom`은 읽기 캐시로만 취급**(동기화는 §5.3).
- `options_jsonb`·`filters_jsonb` 등 스키마가 구조를 강제하지 않으므로 **애플리케이션 레이어가 형태를 규정**해야 한다(아래 §3·§4·§6).

---

## 3. 필드 타입 레지스트리 (엔진의 심장)

각 `field_type`을 하나의 **FieldTypeSpec**으로 규정한다. 검증·정규화·비교·옵션지원 여부를 타입별로 캡슐화해, 값 처리 전반(입력검증·저장·필터·정렬·표시)이 이 레지스트리 한 곳을 참조하게 한다.

```ts
// app/src/lib/custom/field-types.ts (구현 예정)
export interface FieldTypeSpec {
  type: FieldType;
  /** 원시 입력을 검증하고 value_jsonb 저장형으로 정규화. 실패 시 ValidationError. */
  normalize(raw: unknown, def: FieldDef): JsonValue | null;
  /** 빈 값 판정(필터 is_empty / 필수검사용). */
  isEmpty(v: JsonValue | null): boolean;
  /** 필터·정렬용 스칼라 투영(T02 views.ts comparable 규약과 호환). */
  comparable(v: JsonValue | null): number | string;
  /** select/multiselect 만 true. options_jsonb 필요. */
  supportsOptions: boolean;
  /** 이 타입에 허용되는 필터 연산자 집합. */
  operators: readonly FilterOperator[];
}
```

**타입별 정규화·저장형 규약(value_jsonb):**

| type | 저장형(value_jsonb) | 정규화/검증 요지 | 옵션 |
|---|---|---|---|
| text | `string` | trim, 최대 500자 | — |
| longtext | `string` | 최대 20000자 | — |
| number | `number` | 유한수만, `Number()` 강제, NaN 거부 | — |
| date | `"YYYY-MM-DD"` | ISO date 부분만, 유효 달력일 검증 | — |
| datetime | ISO 8601 `string` | `Date` 파싱 가능성 검증, UTC 정규화 | — |
| select | `string`(=option **id**) | 값은 옵션 **id** 저장(라벨 아님) — §4 | ✅ |
| multiselect | `string[]`(=option id 배열) | 중복 제거, 각 id 유효성 | ✅ |
| phone | `string` | 숫자/`+`/`-`/공백 허용, 국내 규칙 느슨히 | — |
| email | `string` | 단순 형식 검증(`x@y.z`) | — |
| file | `{path,name,size,mime}[]` | Storage 경로 참조만(업로드는 core.files) | — |
| person | `string`(=user.id) 또는 `string[]` | user.id가 org 멤버인지(T03 연동 전엔 형식만) | — |
| url | `string` | `http(s)://` 스킴 검증 | — |
| checkbox | `boolean` | 불리언 강제 | — |

원칙:
- **저장값은 "지어내지 않는다"** — 옵션은 id로 저장하고 라벨은 `field_defs.options_jsonb`에서 조인 렌더. 라벨/색을 바꿔도 저장값 불변(먼데이 동작).
- 알 수 없는 타입/키는 **무시**(T02 `setValues`의 관용적 처리와 동일 정신) — 마이그레이션 중 안전.
- `comparable`/`isEmpty`는 **T02 `views.ts` 규약과 호환**되게 맞춰, 저장뷰 엔진(§6)을 T02 것과 공유·재사용한다.

---

## 4. 선택지(옵션) 관리 — `options_jsonb`

`select`/`multiselect` 필드의 옵션을 규정한다. 스키마가 구조를 강제하지 않으므로 형태를 여기서 못박는다.

```ts
interface FieldOption {
  id: string;      // 안정 id(불변). 저장값이 참조.
  label: string;   // 표시 라벨(변경 가능).
  color?: string;  // 먼데이 status 색(선택).
  order: number;   // 표시 순서.
  archived?: boolean; // 보관(신규 선택 불가, 기존 값은 유지).
}
// options_jsonb = { options: FieldOption[] }
```

**연산(서비스 레이어):**
- `addOption(defId, {label,color})` → 새 id 발급, order = 말미.
- `renameOption(defId, optId, label)` / `recolor` / `reorder` — **저장값 무영향**(id 고정이므로).
- `archiveOption(defId, optId)` — 소프트. 신규 선택 목록에서 제외, 기존 `field_values`는 보존.
- `removeOption` — 기본 **금지**(먼데이도 보관 권장). 강제 삭제 시 참조 값 정리 여부를 명시적 옵션으로: `{ purgeValues: true }`이면 해당 id를 참조하는 값에서 제거/치환.
- **고아 값 조회** `findOrphanValues(defId)` — 존재하지 않는 option id를 참조하는 값 진단(lint/T10 검증용).

**id 발급:** 결정적 테스트 위해 `genId` 주입(T02 InMemory 패턴 동일). 라벨 slug가 아닌 **불투명 id**(예: `opt-…`) — 라벨 변경/중복 라벨에 안전.

**프리셋 옵션(`module_key`):** T09/002가 seed한 필드(예: 지역·진행상품)는 `module_key`가 있고, 옵션이 프리셋에서 온다. 이 경우 옵션 편집을 **락**(add만 허용 or 전면 읽기전용 — §7 정책 결정 필요). 본 엔진은 `def.module_key ? locked : editable` 분기만 제공하고 실제 값은 seed 로더가 채운다(지어내지 않음).

---

## 5. field_defs / field_values 생명주기

### 5.1 field_defs
- **create**: `{entity, label, type, options?}` → `key`는 label 기반 slug 자동 파생 + 충돌 시 접미사(`_2`), `UNIQUE(org_id,entity,key)` 준수. `sort_order`=말미.
- **update**: label/type/options/sort_order 패치. **타입 변경은 위험** — 기존 `field_values` 저장형이 바뀜. 정책: 타입 변경 시 (a) 호환 변환 가능하면 마이그레이트, (b) 아니면 거부하고 "새 필드 생성" 유도(MVP 기본 = 거부, 안전 우선).
- **reorder**: `sort_order` 일괄 갱신(뷰 표시 순서).
- **archive/delete**: 소프트 아카이브 우선. 하드 삭제 시 `field_values`의 해당 `field_key` 정리(부모 삭제 = 값 고아 방지).
- **reserved keys**: 코어 컬럼(`title`,`amount`,`stage`,`__stage__` 등)과 충돌 금지 — 예약어 집합으로 차단.

### 5.2 field_values
- **get(entityId)** → `Record<field_key, value>` 맵(렌더용).
- **setValues(entityId, patch)** → 각 키를 해당 `field_def.type` 스펙으로 `normalize` 후 upsert(PK `entity_id`+`field_key`). 알 수 없는 키 무시. `null`이면 값 삭제(빈 셀).
- **batch/prune** — 아이템 삭제 시 값 정리, def 삭제 시 값 정리.
- **org 스코핑**: 모든 접근에 `org_id` 필수(T02와 동일한 앱레이어 테넌시; DB RLS는 T03).

### 5.3 `deals.custom` 캐시 동기화(선택)
001이 `deals.custom jsonb`를 "간이 저장"으로 둔 이유는 딜 목록 조회 시 값 조인을 줄이려는 것. 방침: **정본 = `field_values`**, `deals.custom`은 setValues 시 함께 갱신하는 **비정규 읽기 캐시**로만. 불일치 시 `field_values`가 이긴다. (성능 필요 확인 전엔 캐시 갱신을 껐다 켤 수 있게 플래그화 — 조기 최적화 회피.)

---

## 6. 저장뷰(saved_views) 엔진

T02가 이미 순수 필터/정렬 엔진(`app/src/lib/crm/views.ts`: `applyView`/`matchFilter`/`resolveCellValue`)과 검증기(`validation.ts`: `parseViewConfig`)를 구현했다. **재발명하지 않고 재사용**하되, 001의 `saved_views` 형태에 맞춘 어댑터를 둔다.

**형태 차이 흡수:**
- 001: `filters_jsonb` + `sort_jsonb` + `columns_jsonb`(분리) · `entity` 스코프 · `shared`(bool) · `user_id`.
- T02 `ViewConfig`: `{filters, sorts, visibleColumns}`(합본) · board 스코프 · `isDefault`.
- 어댑터가 001의 3개 jsonb ↔ T02 `ViewConfig` 를 **양방향 매핑**. 필터/정렬 평가는 T02 `applyView`를 그대로 호출(값 투영은 §3 레지스트리의 `comparable`/`isEmpty`로 커스텀필드까지 확장).

**가시성/소유:**
- `shared=false` → 작성자(`user_id`) 개인 뷰. `shared=true` → 조직 공유.
- 목록 조회 = 내 개인 뷰 ∪ 조직 공유 뷰(같은 entity).
- 기본 뷰: 001엔 `is_default` 컬럼이 없다 → (a) `columns_jsonb`/네이밍 규약으로 표기하거나 (b) 별도 설정 테이블. **결정 필요**(§8 OQ-4). MVP는 "이름이 특정한 뷰 1개를 기본으로" 규약으로 시작 가능.

**필터 대상 컬럼:** 코어 컬럼(`title`,`stage` 등) + 커스텀필드 key. `resolveCellValue`가 커스텀 값(`field_values` 조인 맵)을 우선 참조하도록 확장.

---

## 7. 레이어링 — T02 패턴 그대로 (Port + Adapter)

T02가 확립한 구조를 동일하게 따른다(일관성 = 유지보수성).

```
app/src/lib/custom/
  types.ts          FieldDef, FieldOption, FieldValue, CustomView, FieldType(13)
  field-types.ts    FieldTypeSpec 레지스트리(§3) — 순수, 완전 테스트
  options.ts        옵션 연산(§4) — 순수, 완전 테스트
  store.ts          CustomStore 포트 + InMemoryCustomStore(참조구현)
  postgrest.ts      PostgrestCustomStore(운영 어댑터) — T02 postgrest.ts 미러
  views.ts          001 saved_views ↔ ViewConfig 어댑터 (+ T02 views.ts 재사용)
  validation.ts     요청 바디 파서(T02 validation.ts 규약)
  service.ts        유스케이스 오케스트레이션(정규화·옵션락·프루닝)
  index.ts          배럴
```

```ts
export interface CustomStore {
  // field defs
  listDefs(orgId: string, entity: FieldEntity): Promise<FieldDef[]>;
  createDef(orgId, def: NewFieldDef): Promise<FieldDef>;
  updateDef(orgId, defId, patch: FieldDefPatch): Promise<FieldDef | null>;
  reorderDefs(orgId, entity, orderedIds: string[]): Promise<void>;
  deleteDef(orgId, defId): Promise<boolean>;      // + 값 프루닝
  // values
  getValues(orgId, entityId): Promise<Record<string, JsonValue>>;
  setValues(orgId, entityId, patch: Record<string, JsonValue | null>): Promise<void>;
  // views
  listViews(orgId, userId, entity): Promise<CustomView[]>;   // 개인 ∪ 공유
  createView / updateView / deleteView ...
}
```

**API 라우트(Next.js — ⚠️ 코드 전 `node_modules/next/dist/docs/` 확인, app/AGENTS.md):**
- `GET/POST /api/fields?entity=deal` · `PATCH/DELETE /api/fields/[fieldId]` · `POST /api/fields/reorder`
- `POST /api/fields/[fieldId]/options` · `PATCH/DELETE /api/fields/[fieldId]/options/[optId]`
- `GET/PUT /api/entities/[entityId]/values` (또는 core.crm 아이템 엔드포인트에 값 병합)
- `GET/POST /api/custom-views?entity=deal` · `PATCH/DELETE /api/custom-views/[viewId]`

**정합(reconciliation) — §0 충돌 해소안 2택(코디네이터 판정):**
- **안 A (001 정본):** `0002_core_crm.sql`의 `board_columns`/`column_values`/중복 `saved_views`를 걷어내고 001의 `deals`+`field_defs` 모델로 수렴. T02 코드는 field_defs 어댑터로 재타겟. → PLAN §5와 일치하나 T02 재작업 큼.
- **안 B (0002 정본 + core.custom 확장):** T02의 boards/board_columns 모델을 유지하고, core.custom을 그 위의 확장(커스텀 컬럼 = board_columns의 특정 종류, 13타입은 `ColumnType` 확장 + settings)으로 구현. → T02 재사용 크나 PLAN/001과 발산, `field_defs`/`field_values` 미사용.
- 본 설계 문서는 **안 A(001 정본)** 기준으로 상세를 작성했다. 안 B로 확정되면 §2~§6의 테이블 매핑을 board_columns/column_values로 치환(엔진 로직 §3·§4·§6은 대부분 재사용 가능).

---

## 8. 테스트 전략 & 열린 질문

**테스트(순수 우선 — T09/T02 패턴, vitest):**
- `field-types.test.ts` — 13타입 × {정상 정규화, 경계, 거부, isEmpty, comparable}.
- `options.test.ts` — add/rename/reorder/archive 후 **저장값 불변** 성질, 고아 탐지, purge.
- `views.test.ts` — 001 jsonb ↔ ViewConfig 왕복, 커스텀필드 필터/정렬(T02 applyView 재사용 검증).
- `store.test.ts` — InMemory 계약 테스트(org 격리, PK upsert, 프루닝).
- `validation.test.ts` — 요청 파서 경계.
- 게이트: `bash scripts/check.sh` 초록 필수(커밋 전).

**열린 질문(belie/코디네이터 결정 요망):**
- **OQ-1**: §0 스키마 충돌 — 안 A(001) vs 안 B(0002) 중 정본? (구현 착수의 선결 조건)
- **OQ-2**: 필드 **타입 변경** 정책 — MVP 거부(안전) vs 호환 변환 시도?
- **OQ-3**: 프리셋(`module_key`) 필드의 옵션 편집 — 전면 락 vs 조직 추가만 허용?
- **OQ-4**: 저장뷰 **기본 뷰** — 001에 `is_default` 없음. 규약 vs 스키마 추가(신규 마이그레이션)?
- **OQ-5**: `deals.custom` 캐시 — 유지(성능) vs 제거(단순), 동기화 비용 대비 편익?

---

## 9. 착수 순서(안) — OQ-1 확정 후

1. `types.ts` + `field-types.ts` 레지스트리(§3) + 테스트 — **데이터·스키마 무의존 순수 계층부터**(T09가 검증한 접근).
2. `options.ts`(§4) + 테스트.
3. `store.ts` 포트 + InMemory + 계약 테스트.
4. `views.ts` 어댑터(T02 재사용) + 테스트.
5. `validation.ts` + `service.ts`.
6. `postgrest.ts` 운영 어댑터(라이브 DB 통합은 T10과).
7. API 라우트(Next.js 수정판 문서 선확인).
8. RLS 정합은 T03, 프리셋 값은 T09와 `dispatch-queue`로 조율.

> 요약: 스키마 v1(001)의 `field_defs`/`field_values`/`saved_views`를 정본으로, T02가 검증한 **Port+Adapter·순수 뷰엔진·경량 검증기 패턴**을 재사용해 13타입 레지스트리와 옵션 안정성(id 저장)을 핵심으로 하는 커스텀필드 엔진을 얹는다. 착수 전 **§0 스키마 충돌(OQ-1) 해소가 선결**이다.

---

## 10. 구현 현황 (2026-07-21)

**착수 트리거**: OQ-1 해소(ADR-0002, A안 001 정본). 설계 §9 순서대로 자기완결 계층 구현.

**전달물** `app/src/lib/custom/` (순수 TS + vitest, 62 테스트 신규, check.sh 초록):

| 파일 | 내용 |
|---|---|
| `field-types.ts` | 13종 `FieldTypeSpec` 레지스트리(normalize/isEmpty/comparable/operators) + `ValidationError`. 옵션 id 멤버십·달력일·이메일/URL/전화 검증. |
| `options.ts` | 옵션 연산(add/rename/recolor/reorder/archive/unarchive) — **id 불변 보장**, 고아 진단. |
| `views.ts` | 001 saved_views(jsonb) ↔ `ViewConfig` 어댑터 + 순수 필터/정렬 `applyView`(타입-인지 비교). |
| `store.ts` | `CustomStore` 포트 + `InMemoryCustomStore`(org 격리, 값 PK upsert/프루닝, 뷰 개인/공유 가시성). |
| `validation.ts` | 요청 파서 + `deriveKey`/`uniqueKey`(**한국어 라벨 지원**, 예약어·중복 회피). |
| `service.ts` | 오케스트레이션 — key 파생·옵션 id 발급·값 정규화·프리셋(module_key) 편집/삭제 락·뷰 CRUD. |
| `index.ts` | 배럴. |

**착수 중 내린 OQ 결정(구현 반영):**
- **OQ-2(타입 변경)**: MVP는 라벨 변경만 허용, `key`·`type` 불변(안전 우선). 타입 변경 UI 는 "새 필드 생성" 유도.
- **OQ-3(프리셋 옵션)**: `module_key` 필드는 옵션 편집·삭제 **전면 락**(`CustomFieldError`). 프리셋 값 소유 = T09/002.
- **OQ-5(`deals.custom` 캐시)**: 정본 = `field_values`. 캐시 동기화는 미구현(조기 최적화 회피) — 필요 확인 시 service 에 플래그로 추가.
- **OQ-4(기본 뷰)**: 001 에 `is_default` 없음 → 미결. 규약 or 신규 마이그레이션은 belie 결정 대기(현재 개인/공유 구분만 구현).

**정합/후속(followup, T02 001-재작성 정착 후):**
1. **`@/lib/repo` 넓히기** — 현재 `Repo` 는 `listFieldDefs`/`createFieldDef` 스텁만. `CustomStore` 표면(값/뷰/update/reorder/delete)으로 확장하거나 `InMemoryCustomStore` 를 `LocalRepo` 에 위임. (T02 파일이라 지금은 미수정.)
2. **PostgREST 어댑터** — `CustomStore` 의 운영 구현(field_defs/field_values/saved_views 직접 질의). 라이브 DB 통합은 T10.
3. **API 라우트** — §7 목록. `app/AGENTS.md` 지시대로 `node_modules/next/dist/docs/` 확인 후.
4. **RLS** — 정책 본체 T03(001 에 `fielddefs_rw`/`fieldvals_rw`/`savedviews_rw` 존재, 런타임 검증 T03·T10).
5. **뷰 엔진 공용화** — T02 `crm/views.ts` 와 로직 중복 → 정착 후 공유 모듈로 통합 검토.

---

## 11. ADR-0003(임의 보드) 영향 분석 + 정합 순서 (2026-07-21)

**기획2 지시(순환)**: 001 정본 확인 · 구현 착수 가능 · **단 T02 재작성 + 공용계약 안정화 후 정합 순서 준수** · 워킹트리 격리(git worktree) 사용.

### 11.1 정합 게이트 — 현재 미충족 (실측)

`origin/main` = `de69db6` 기준 실측:

| 정합 선행조건 | 상태 |
|---|---|
| T03 파운데이션(`@/lib/types`·`@/lib/repo`·`@/lib/auth`) on main | ❌ 부재 (feat/t03-foundation-org 에만) |
| T02 001-재작성 on main | ❌ 부재 (main 의 `crm/service.ts` 는 재작성 전 boards/items 구버전) |
| `0002_core_crm.sql` 폐기 반영 on main | ❌ 아직 존재 |
| T02 DQ-0012(임의 보드 이전) | ❌ blocked (003 미작성) |

**⇒ 지시대로 정합 보류.** `@/lib/repo` 넓히기·PostgREST 어댑터·API 라우트는 **착수하지 않는다**(§10 followup 유지). 지금 착수하면 소비 대상이 유동적이라 재작업 확정.

**그래서 `domain-types.ts` vendor 를 유지한다** — 파운데이션이 main 에 없으므로, vendor 가 본 모듈이 main 기반에서 단독 컴파일되는 유일한 방법이다. 공용계약 안정화 후 `export * from "@/lib/types"` 재export 로 1줄 정합.

### 11.2 두 겹 구조에서 core.custom 의 위치

ADR-0003: ① 정책자금 파이프라인 = 001 `deals`/`stages`(typed) · ② 사용자 임의 보드 = 003 `boards`/`items`/`board_columns`/`item_values`.

②의 `board_columns`(타입·선택지를 갖는 컬럼)는 **core.custom 과 동일한 커스터마이징 표면**이다. 즉 "먼데이 컬럼 재현"이 001 `field_defs` 와 003 `board_columns` 두 곳에 걸친다.

본 모듈의 재사용성(코드 실측):

| 계층 | 003 재사용 |
|---|---|
| `field-types.ts`(13타입 레지스트리) | ✅ 그대로 — 저장소 무관 |
| `options.ts`(옵션 id 안정성) | ✅ 그대로 — 순수 배열 연산 |
| `views.ts`(`applyView`) | ✅ 그대로 — 행 타입 제네릭 + `CellResolver` 주입 |
| `validation.ts` | ✅ 대부분 |
| `store.ts`/`service.ts` | ⚠️ 001 바인딩 — **003용 어댑터 추가**(재작성 아님) |

**⇒ 003 이 와도 로직은 버려지지 않는다.** 단 003 확정 전 어댑터 작성은 스키마 추측이므로 금지(T02 가 DQ-0011 로 거부한 것과 동일 원칙).

### 11.3 003 스키마 작성 시 T05 입력 (기획 요청 — DQ-0011 반영 요망)

커스터마이징 경계 소유자로서, 003 이 아래를 어기면 이미 겪은 충돌·중복이 재발한다:

1. **저장뷰 구멍 (중요)** — DQ-0011 의 003 산출물 목록에 `saved_views` 가 **없다**. 그런데 001 `saved_views.entity` 는 `field_entity` enum(`company`|`deal`)이라 **보드를 가리킬 수 없다**. 임의 보드의 저장뷰 위치를 003 에서 반드시 정할 것 — (a) 003 에 board-scoped 뷰 테이블 추가 vs (b) `field_entity` 확장. 미정 시 폐기된 `0002` 때와 같은 `saved_views` 중복이 재발한다.
2. **`board_columns` 의 타입·선택지 규약은 001 을 그대로 따를 것** — 타입은 `field_type`(13종), 선택지는 `options_jsonb = {options:[{id,label,color,order,archived}]}`. 다른 규약을 만들면 레지스트리/옵션 엔진이 두 벌이 된다.
3. **`item_values` 는 옵션 라벨이 아니라 옵션 id 를 저장할 것** — 본 엔진의 핵심 불변식(§4). 라벨/순서 변경 시 데이터 파손 방지.

### 11.4 003 확정 — T05 입력 3건 전부 반영됨 ✅ (2026-07-21)

`003_boards_engine.sql`(커밋 `d5e31ba`, `feat/t02-boards-engine`) 실측 결과 §11.3 입력이 모두 수용됐다. **재작업 없음.**

| §11.3 입력 | 003 결과 |
|---|---|
| ① 저장뷰 위치 확정(중복 회피) | **`board_views` 별도 테이블 신설** — 001 `saved_views` 미건드림. 충돌 없음 |
| ② `board_columns` 는 `field_type` 13종 + `options_jsonb` | `type field_type not null` + `options_jsonb jsonb` — **001 enum 그대로 재사용** |
| ③ `item_values` 는 옵션 id 저장 | `(item_id, column_key)` PK + `value_jsonb` — 001 `field_values` 와 **구조 동일** |

**두 표면 매핑(어댑터 설계 확정):**

| core.custom 개념 | 001 (typed: deals/companies) | 003 (임의 보드) |
|---|---|---|
| 컬럼 정의 | `field_defs(org_id, entity, key, type, options_jsonb, module_key, sort_order)` | `board_columns(org_id, board_id, key, type, options_jsonb, sort_order, width)` |
| 값 | `field_values(entity_id, field_key, value_jsonb)` | `item_values(item_id, column_key, value_jsonb)` |
| 저장뷰 | `saved_views(entity, filters_jsonb, sort_jsonb, columns_jsonb, shared, user_id)` | `board_views(board_id, kind, filters_jsonb, sort_jsonb, visible_columns_jsonb, shared, user_id)` |
| 스코프 키 | `entity`(company\|deal) | `board_id` |

⇒ 값·뷰 구조가 1:1이라 **`store.ts` 어댑터는 얕다**(키 이름 매핑 수준). `field-types`/`options`/`views`/`validation` 은 수정 없이 재사용.
차이 2가지만 흡수: (a) 뷰 컬럼 필드명 `columns_jsonb` ↔ `visible_columns_jsonb`, (b) 003 `board_views.kind`(table/kanban) — 001 엔 없는 추가 속성이라 `ViewConfig` 에 선택 필드로 확장.

### 11.5 착수 순서(정합 게이트 통과 후)

머지큐(기획2 판정): ①T03 → ②T02crm → ③T02boards → ④T04 → **⑤T05(본 트랙)**.
T05 는 **마지막**이라 앞 4개가 main 에 랜딩한 뒤 그 위에서 정합한다.

1. 앞 4개 머지 완료 + 공용계약 안정화 확인(= `@/lib/types`·`@/lib/repo` main 랜딩).
2. `feat/t05-custom-fields` 를 최신 main 에 rebase/merge. **SSOT 문서(worklog/registry/queue) 충돌 예상** — 앞 4트랙이 모두 편집하므로 append 병합으로 해소.
3. `domain-types.ts` → `export * from "@/lib/types"` 재export 로 정합(1줄). 중복 정의 제거.
4. `@/lib/repo` 에 `CustomStore` 표면 반영(스텁 `listFieldDefs`/`createFieldDef` 확장) — T02/T03 과 조율.
5. 001 `field_defs` API 라우트(§7) + 003 `board_columns`/`item_values`/`board_views` 어댑터(§11.4 매핑).
6. ~~OQ-4(저장뷰 기본뷰) 결정 반영~~ → **§11.6 에서 해소·구현 완료**.

### 11.6 OQ-4 해소 — 기본 뷰 규약 확정·구현 ✅ (2026-07-21)

**경위**: 1차 판정은 "기본 뷰 = `created_at` ASC"였으나, 실측 결과 **`created_at` 이 001 `saved_views`·003 `board_views` 양쪽 모두 부재**(001 은 다른 8개 테이블에, 003 은 `boards`/`items` 에만 존재 — 두 뷰 테이블만 누락). `id` 는 `gen_random_uuid()`(v4 랜덤)이라 생성순 대용 불가 → 원 판정이 "마이그레이션 없음"과 양립 불가함을 보고. 재판정으로 아래 규약 확정(제안 (C) 채택).

**확정 규약** — `pickDefaultView()` (`app/src/lib/custom/views.ts`):

```
shared = true 우선  →  name ASC  →  id ASC (tie-break)
```

- **마이그레이션 없음**(001·003 불변).
- **`sort_order` 미사용** — 사용자가 뷰를 재정렬해도 기본 뷰가 바뀌지 않도록(판정 의도).
- 이름 비교는 **로케일 비의존 코드유닛 순서** — 기본 뷰 선택은 표시 정렬과 달리 환경(ICU 버전)에 따라 흔들리면 안 되므로 결정성 우선.
- 후보 타입은 `DefaultViewCandidate{id,name,shared}` — 001 `saved_views` 와 003 `board_views` 가 **둘 다 만족(구조적 타이핑)** → **두 표면이 같은 함수 공유**.
- 소비 API: `CustomService.getDefaultView(orgId, userId, entity)`. 뷰가 없으면 `null`(호출부가 "전체 보기" 처리).
- 테스트 7종: 빈 목록 · shared 우선 · name ASC · id tie-break · **입력 순서 무관(결정성)** · **sort_order 무시** · **003 board_views 형태 적용**.

**Phase 후속**: 사용자가 "이 뷰를 기본으로" 지정하는 기능은 후속. 그때 기획이 `created_at` + `is_default` 를 **두 테이블에 동시** 추가(003 개정 또는 004, 기획 단독). 추가되면 **`compareDefaultView()` 한 함수만 교체**하면 되고 호출부는 불변이다.

---

## 12. 정합 실행 결과 (2026-07-21, 머지큐 ⑤ 차례)

`origin/main`(`da7dce0`) 위로 rebase 후 정합 수행. 게이트 초록.

### 12.1 완료

| 항목 | 결과 |
|---|---|
| **rebase** | 4커밋 → 1커밋 squash 후 rebase(충돌 반복 회피). 충돌은 `worklog.md`·`dispatch-queue.yaml` 2건뿐 — **코드 충돌 0**(신규 디렉터리). worklog 는 양측 보존, queue 는 내 최신 항목 채택 + T02 의 `resolved:` 주석 보존. |
| **`@/lib/types` 재export** | `domain-types.ts` 를 vendor → **재export 로 전환**. 형태가 완전히 동일함을 대조 확인 후 교체(모듈 내 import 경로 불변, 9파일 무수정). |
| **`@/lib/repo` 표면 반영** | `Repo` 포트의 커스텀필드 스텁(`listFieldDefs`/`createFieldDef`)을 **전 표면으로 확장** — `getFieldDef`/`updateFieldDef`/`reorderFieldDefs`/`deleteFieldDef`(값 프루닝) · `getFieldValues`/`setFieldValue` · `listSavedViews`(공유∪개인)/`getSavedView`/`createSavedView`/`updateSavedView`/`deleteSavedView`. `FieldDefPatch`·`SavedViewPatch` 입력 타입 추가. `LocalRepo` 에 구현(스토어의 `fieldDefs`/`fieldValues`/`savedViews` 배열은 T03 이 이미 마련해 둔 것 사용 — 스토어 변경 없음). |
| **어댑터/배선** | `RepoCustomStore implements CustomStore`(공용 Repo 위임) + `getCustomService()` 팩토리. 테스트는 기존 `InMemoryCustomStore` 유지 → 운영/테스트 이중 어댑터. |
| **API 라우트** | `/api/fields`(GET·POST) · `/api/fields/[fieldId]`(PATCH·DELETE) · `/api/custom-views`(GET·POST, `?default=1` 기본뷰) · `/api/custom-views/[viewId]`(PATCH·DELETE) · `/api/entities/[entityId]/values`(GET·PUT). 수정판 Next 규약 준수(`params` 는 Promise). |
| **HTTP 헬퍼** | `custom/http.ts` 별도 — T02 `crm/http` 의 `toErrorResponse` 는 **crm 의 ValidationError 만** 400 매핑하므로, core.custom 에러를 넘기면 500 이 된다. 세션은 T03 `@/lib/auth/session` 직접 사용. `CustomFieldError` → 409. |
| **검증 테스트** | `repo-store.test.ts` 6종 — 값 정규화 round-trip(`"42"`→`42`), select 옵션 id 검증, **org 격리**, 정의 삭제 시 값 프루닝, 저장뷰 개인/공유 가시성 + 기본뷰 규약, config 왕복. custom 69 → **75**. |

### 12.2 미착수 — 003 어댑터 (의도적, 결정 필요) ⚠️

**003 어댑터를 만들지 않았다.** 만들면 **3중 구현**이 되기 때문이다.

T02b 가 `app/src/lib/boards/cells.ts` 에 **본 트랙 레지스트리와 동일 성격의 엔진을 병행 구현**해 두었다(해당 파일 주석에 "T05 가 `lib/custom/field-types.ts` 에 동일 성격 레지스트리 보유 … **머지 정착 후 공용화한다(followup)**" 라고 명시). 지금이 그 "머지 정착" 시점이다.

**두 엔진의 의미 차이(실측)** — 같은 데이터에 대해 결과가 다르므로 방치하면 표면별로 동작이 갈린다:

| 입력 | `custom/field-types.ts` (T05) | `boards/cells.ts` (T02b) |
|---|---|---|
| 잘못된 값 일반 | **`ValidationError` throw** (호출자 400) | **조용히 `null` 로 수렴** |
| `number: "abc"` | throw | `null` |
| `date: "2026-02-30"` / `"2026-13-01"` | throw(달력일 검증) | **정규식만 통과 → 그대로 저장** |
| `email`/`url`/`phone` | 형식 검증 | 검증 없음(통과) |
| `select` 미존재 옵션 id | throw(normalize 내 검증) | normalize 통과 + 별도 `validateAgainstOptions()` 를 호출자가 확인해야 함 |
| `multiselect` 빈값 | `null` | `[]` |
| `checkbox` 빈값 | `null` | `false` |
| `number: "1,000"` | throw | `1000`(콤마·₩ 제거) |

또한 T02b `boardsRepo.setValues` 는 **컬럼 타입·옵션 대조 없이 raw 값을 그대로 기록**한다(검증 훅 미연결) → 003 보드에는 지금 잘못된 값이 그대로 들어갈 수 있다.

**제안(코디네이터 판정 요망)** — 어느 쪽 의미를 정본으로 할지가 **제품 결정**이라 단독 진행하지 않았다:
- **(가) 엄격(T05 의미)으로 통일** — `cells.ts` 를 `custom/field-types.ts` 에 위임(공개 API 유지). 잘못된 입력은 400. T02b 테스트 중 관용 동작에 의존하는 케이스는 수정 필요.
- **(나) 관용(T02b 의미) 유지 + 검증만 강화** — 저장은 관용, 대신 `boardsRepo.setValues` 앞단에 옵션/달력일 검증을 붙여 최소 무결성 확보.
- **(다) 두 표면 의미를 의도적으로 분리 유지**(001=엄격, 003=관용) — 이 경우 문서로 명시하고 공용화는 폐기.

권고 **(가)**. 이유: `date` 정규식만 통과시키는 현 003 경로는 달력에 없는 날짜를 저장하며, 이는 T09 정산(D+180/365)·T04 대시보드가 소비할 때 조용히 틀린 결과를 만든다. 다만 T02b 파일 수정이 필요하므로 판정 후 진행한다.

**보류 근거**: 타 트랙의 머지된 모듈을 단독 재작성하지 않는다(AGENTS 규칙 5). 판정 시 `cells.ts` 위임 + 003 검증 훅 연결까지 T05 가 수행 가능.

---

## 13. 기획2 판정 반영 — 비-throw 계약 · 값 정책 · 정본 키맵 (2026-07-21)

### 13.1 엔진 계약: 던지지 않고 결과 반환

```ts
validateValue(type, raw, ctx?) → { ok, normalized, error? }   // 공개 진입점, throw 없음
```
- **던질지 흘릴지는 호출부(정책)가 결정**한다. 엔진은 판단 재료만 준다.
- 기존 `normalize()`(throw)는 엄격 호출부용으로 유지 — 추가만 했고 breaking 없음.

### 13.2 값 정책: 관대 + 인라인 피드백 (기본) / 무결성 필드만 엄격

`CustomService.applyValues()` = **기본 경로**(`PUT /api/entities/[entityId]/values` 가 사용):

| 상황 | 처리 |
|---|---|
| 유효한 값 | 저장 |
| 유효하지 않은 값 | **저장하지 않음** + `errors[key]` 에 사유 → UI 인라인 표시, 기존 값 보존 |
| ⛔ 조용한 `null` 수렴 | **금지**(데이터 유실) — T02b 현행 방식은 기각됨 |
| 정의 없는 key | 무시(마이그레이션 안전) |
| **무결성 필드** | **하드 거부(throw → 400)** |

무결성 필드 = `INTEGRITY_FIELD_KEYS` = `exec_amount`(실행액) · `fee_pct`(수수료%) · `fee_paid_at`(수수료 입금일).
근거: 001 `settlements` 의 generated column(`fee_amount`/`total_revenue`/`d180`/`d365`)이 이 값에 의존 → 틀린 값이 흘러가면 **조용히 잘못된 금액·일자**가 산출된다.

응답은 `{ ok, values, errors }` 이며 `errors` 가 있어도 **200**(인라인 피드백용). 성공 여부는 `ok` 로 판별.

### 13.3 정본 키맵 — 한글 라벨을 조회 key 로 쓰지 않기

`createField({ key })` 로 **정본 key 명시**를 지원한다(생략 시에만 label 에서 파생).
- 명시 key 중복은 **거부** — 조용히 `_2` 접미사를 붙이면 정본 키맵과 어긋나기 때문.
- 정본 키맵: `contract_status` · `biz_type` · `biz_reg_type` · `region` · `agency` · `product` · `progress_status` · `consult_status`.
- 확인 결과 `lib/presets/policyfund.ts` 는 이미 ASCII key(`agency`/`region`/`contract_status`/`exec_amount`/`fee_pct`/`fee_paid_at`)를 명시하고 있어 위반 없음. 본 변경은 **그 경로가 서비스를 타게 될 때도 정본 key 가 보존되도록** 하는 것.
- label 파생(`deriveKey`)은 **사용자가 직접 만든 필드**에만 적용된다(사용자 데이터이지 코드 조회 key 가 아님).

### 13.4 003 통합 — followup (PR 분리)

본 PR 에는 넣지 않았다. 이유: `cells.ts` 위임 + `boardsRepo.setValues` 검증 훅은 **T02b 의 머지된 모듈을 수정**하고 003 보드의 동작을 바꾸므로, 리뷰 단위를 분리하는 편이 안전하다(T02b·T09 가 영향받음).

followup 작업 범위(확정된 방향):
1. `boards/cells.ts` → `custom/field-types.ts` 위임(공개 API 유지, 2·3중 구현 제거).
2. `boardsRepo.setValues` 앞단에 `validateValue` 훅 연결 — 관대 + 인라인 피드백, 무결성 필드만 하드 거부.
3. 003 경로의 `date` 정규식 통과 문제 해소(`"2026-02-30"`·`"2026-13-01"` 저장 방지).
4. 회귀: T02b `cells.test.ts`·`service.test.ts` 중 관용 동작 의존 케이스 조정.
