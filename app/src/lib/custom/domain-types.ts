/**
 * 커스텀필드 도메인 타입 (T05) — supabase/migrations/001_schema_v1.sql 의 커스터마이징
 * 테이블(field_defs / field_values / saved_views)과 enum(field_type / field_entity)을 옮긴 것.
 *
 * ⚠️ 정합(followup): 공유 `@/lib/types` 가 동일 정의를 제공한다(001 전사). 그 모듈이
 * main 에 랜딩하면 이 파일을 `export * from "@/lib/types"` 재export 로 바꾸거나 삭제하고
 * import 를 되돌린다. 지금은 타 트랙 인플라이트 모듈에 결합하지 않으려 자기완결로 둔다.
 */

export const FIELD_ENTITIES = ["company", "deal"] as const;
export type FieldEntity = (typeof FIELD_ENTITIES)[number];

export const FIELD_TYPES = [
  "text",
  "longtext",
  "number",
  "date",
  "datetime",
  "select",
  "multiselect",
  "phone",
  "email",
  "file",
  "person",
  "url",
  "checkbox",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** select/multiselect 선택지. 저장값은 이 id 를 참조(라벨 아님). */
export interface FieldOption {
  id: string;
  label: string;
  color?: string;
  order?: number;
  archived?: boolean;
}

export interface FieldDef {
  id: string;
  org_id: string;
  entity: FieldEntity;
  key: string;
  label: string;
  type: FieldType;
  options_jsonb: { options: FieldOption[] } | null;
  module_key: string | null;
  sort_order: number;
}

export interface FieldValue {
  org_id: string;
  entity_id: string;
  field_key: string;
  value_jsonb: unknown;
}

export interface SavedView {
  id: string;
  org_id: string;
  user_id: string | null;
  entity: FieldEntity;
  name: string;
  filters_jsonb: Record<string, unknown>;
  sort_jsonb: unknown[];
  columns_jsonb: unknown[];
  shared: boolean;
}
