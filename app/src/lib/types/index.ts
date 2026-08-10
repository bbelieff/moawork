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

// ── 정산 (기둥③⑤) — 001 settlements. 먼데이 회계/업무관리 수식 재현 ──
// 소유: T09(정산 업무 로직) · 소비: T04(대시보드) · 포트 정의: T03(파운데이션).
// fee_amount/total_revenue/d180/d365 는 001 에서 **generated column** 이다 →
// 앱에서는 **읽기 전용**(쓰기 입력은 NewSettlement 의 base 컬럼만). LocalRepo 는 동일 식을 재현한다.
export interface Settlement {
  id: string;
  org_id: string;
  deal_id: string | null;
  // base (쓰기 가능)
  down_payment: number; // 계약금
  down_paid_at: string | null;
  exec_amount: number; // 실행액
  fee_pct: number; // 수수료(정수 퍼센트, 3 = 3%)
  fee_paid_at: string | null; // 수수료 입금일
  // derived (읽기 전용 — DB generated)
  fee_amount: number; // round(exec_amount × fee_pct / 100)
  total_revenue: number; // down_payment + fee_amount
  d180: string | null; // fee_paid_at + 180일
  d365: string | null; // fee_paid_at + 365일
  created_at: string;
}

// ── 세션 컨텍스트 — 인증/인가의 런타임 단위(현재 조직 + 역할 + 범위) ──
export interface Ctx {
  user: User;
  org: Org;
  role: MemberRole;
  scope: MemberScope;
  /**
   * 플랫폼 관리자(전 조직 관리) 여부 — 005_app_admins.sql / app_admin_role().
   * 조직 내 role 과는 별개의 축이다. 관리자 전용 UI 노출에만 쓰고,
   * 데이터 격리(RLS·scope)를 우회하는 용도로 쓰지 않는다.
   * 선택 필드 — 미설정은 false 로 취급.
   */
  isPlatformAdmin?: boolean;
}
