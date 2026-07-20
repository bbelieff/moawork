// 도메인 타입 (수동 정의) — supabase/migrations/001_schema_v1.sql 을 앱 타입으로 옮긴 것.
// Supabase 연결 전(로컬 우선) 단계의 단일 진실 소스. 연결 후에는 `supabase gen types`
// 산출물로 대체/정합한다. T02/T04 등 소비 트랙은 이 타입을 참조한다.

// ── enum (001: member_role / member_scope / field_type / field_entity / stage_kind) ──
export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_SCOPES = ["all", "assigned"] as const;
export type MemberScope = (typeof MEMBER_SCOPES)[number];

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

export const STAGE_KINDS = [
  "marketing",
  "meeting",
  "contract",
  "work",
  "settle",
  "post",
] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

// ── 조직 / 사용자 (기둥④) ──
export interface Org {
  id: string;
  name: string;
  plan_tier: string;
  created_at: string;
}

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: MemberRole;
  scope: MemberScope;
  created_at: string;
}

// ── 엔타이틀먼트 (봉인/해제) ──
export type EntitlementSource = "plan" | "addon" | "trial" | "manual";
export interface OrgEntitlement {
  org_id: string;
  feature_key: string;
  enabled: boolean;
  limit_value: number | null;
  source: EntitlementSource;
  expires_at: string | null;
}

// ── CRM 코어 (기둥①②) ──
export interface Company {
  id: string;
  org_id: string;
  name: string;
  biz_type: string | null;
  region: string | null;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  revenue: number | null;
  founded_on: string | null;
  homepage: string | null;
  assigned_to: string | null;
  created_at: string;
}

export interface Pipeline {
  id: string;
  org_id: string;
  name: string;
}

export interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  kind: StageKind;
}

export interface Deal {
  id: string;
  org_id: string;
  company_id: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
  assigned_to: string | null;
  title: string;
  amount: number | null;
  status_note: string | null;
  applied_on: string | null;
  custom: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  org_id: string;
  deal_id: string | null;
  type: string;
  content: string | null;
  actor: string | null;
  at: string;
}

// ── 커스터마이징 (기둥①) ──
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

// ── 세션 컨텍스트 — 인증/인가의 런타임 단위(현재 조직 + 역할 + 범위) ──
export interface Ctx {
  user: User;
  org: Org;
  role: MemberRole;
  scope: MemberScope;
}
