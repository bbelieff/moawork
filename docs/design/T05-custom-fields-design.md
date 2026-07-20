# T05 — 커스텀필드 엔진 설계 (core.custom)

> 트랙: **T05 커스터마이징** · 상태: 설계(구현은 T02 파운데이션 머지 후 착수)
> 작성 2026-07-21 · 대상: `field_defs` · `field_values` · `saved_views` (먼데이 컬럼 자유도 재현)
> 근거: `docs/PLAN-v0.2.md` §3 core.custom · `supabase/migrations/001_schema_v1.sql` · T02 산출물(`app/src/lib/crm/*`)

먼데이(monday.com)의 "컬럼을 마음대로 추가/설정"을 **코어 구조는 고정한 채** 재현하는 엔진의 설계다.
조직(org)이 자기 컬럼·선택지·저장뷰를 만들어 쓰고, 새로고침 후에도 유지되게 한다(PLAN §3 완료 판정).

---

## 0. 먼저 — 착수 전 반드시 해소할 스키마 충돌 ⚠️ (BLOCKER)

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
