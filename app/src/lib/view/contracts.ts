/**
 * 뷰 시스템 타입 (BBE-117, F-2). 저장 형식의 단일 소유자.
 *
 * DB: supabase/migrations/059_tab_views.sql (`tab_views`).
 * BBE-118(필터)은 이 형식의 `TabView`/`ViewFilterMap`을 읽기만 한다 — 새로 정의하지 않는다.
 */

export type ViewKind = "board" | "flat" | "cal";
export type Visibility = "private" | "shared";
export type PersonScope = "none" | "viewer" | "team" | "fixed";

/** 컬럼 key → 선택된 값 목록. 다중선택 칩 필터와 1:1 (D45).
 *  «시도»/«시군구»는 그냥 서로 다른 두 컬럼 key라 이 형식이 특별 취급 없이 그대로 견딘다(260810 개정 ①). */
export interface ViewFilterMap {
  readonly [columnKey: string]: readonly string[];
}

export interface ViewSort {
  readonly columnKey: string;
  readonly direction: "asc" | "desc";
}

/** 시스템 뷰 3종(삭제 불가, 저장되지 않음) — 보드/표/캘린더 전환. */
export interface SystemView {
  readonly system: true;
  readonly kind: ViewKind;
  readonly name: string;
}

export const SYSTEM_VIEWS: readonly SystemView[] = [
  { system: true, kind: "board", name: "보드" },
  { system: true, kind: "flat", name: "표" },
  { system: true, kind: "cal", name: "캘린더" },
];

/** 저장된 뷰 — 도메인 형(camelCase). DB row는 TabViewRow, 변환은 parseTabView. */
export interface TabView {
  readonly system?: false;
  readonly id: string;
  readonly orgId: string;
  readonly boardKey: string;
  readonly ownerId: string | null;
  readonly name: string;
  readonly kind: ViewKind;
  readonly visibility: Visibility;
  readonly personScope: PersonScope;
  readonly personScopeUserId: string | null;
  readonly filters: ViewFilterMap;
  readonly sort: readonly ViewSort[];
  readonly hiddenColumns: readonly string[];
  readonly columnOrder: readonly string[];
  readonly calendarFieldKey: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ResolvedView = SystemView | TabView;

export function isSystemView(view: ResolvedView): view is SystemView {
  return view.system === true;
}

/** `tab_views` row — snake_case, DB 그대로. */
export interface TabViewRow {
  id: string;
  org_id: string;
  board_key: string;
  owner_id: string | null;
  name: string;
  kind: string;
  visibility: string;
  person_scope: string;
  person_scope_user_id: string | null;
  filters_jsonb: unknown;
  sort_jsonb: unknown;
  hidden_columns_jsonb: unknown;
  column_order_jsonb: unknown;
  calendar_field_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewTabViewInput {
  readonly orgId: string;
  readonly boardKey: string;
  readonly ownerId: string;
  readonly name: string;
  readonly kind: ViewKind;
  readonly visibility: Visibility;
  readonly personScope: PersonScope;
  readonly personScopeUserId?: string | null;
  readonly filters: ViewFilterMap;
  readonly sort?: readonly ViewSort[];
  readonly hiddenColumns?: readonly string[];
  readonly columnOrder?: readonly string[];
  readonly calendarFieldKey?: string | null;
}

const VIEW_KINDS: readonly ViewKind[] = ["board", "flat", "cal"];
const VISIBILITIES: readonly Visibility[] = ["private", "shared"];
const PERSON_SCOPES: readonly PersonScope[] = ["none", "viewer", "team", "fixed"];

function isViewKind(v: unknown): v is ViewKind {
  return typeof v === "string" && (VIEW_KINDS as readonly string[]).includes(v);
}
function isVisibility(v: unknown): v is Visibility {
  return typeof v === "string" && (VISIBILITIES as readonly string[]).includes(v);
}
function isPersonScope(v: unknown): v is PersonScope {
  return typeof v === "string" && (PERSON_SCOPES as readonly string[]).includes(v);
}

function parseFilterMap(raw: unknown): ViewFilterMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, readonly string[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const strs = value.filter((v): v is string => typeof v === "string");
    if (strs.length) out[key] = strs;
  }
  return out;
}

function parseSort(raw: unknown): ViewSort[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewSort[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.columnKey !== "string") continue;
    if (rec.direction !== "asc" && rec.direction !== "desc") continue;
    out.push({ columnKey: rec.columnKey, direction: rec.direction });
  }
  return out;
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

/** DB row → 도메인 형. 형식이 깨진 row는 null(호출부가 목록에서 건너뛴다). */
export function parseTabView(row: TabViewRow): TabView | null {
  if (!isViewKind(row.kind) || !isVisibility(row.visibility) || !isPersonScope(row.person_scope)) return null;
  if (row.person_scope === "fixed" && !row.person_scope_user_id) return null;
  if (row.kind === "cal" && !row.calendar_field_key) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    boardKey: row.board_key,
    ownerId: row.owner_id,
    name: row.name,
    kind: row.kind,
    visibility: row.visibility,
    personScope: row.person_scope,
    personScopeUserId: row.person_scope_user_id,
    filters: parseFilterMap(row.filters_jsonb),
    sort: parseSort(row.sort_jsonb),
    hiddenColumns: parseStringArray(row.hidden_columns_jsonb),
    columnOrder: parseStringArray(row.column_order_jsonb),
    calendarFieldKey: row.calendar_field_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseTabViews(rows: readonly TabViewRow[]): TabView[] {
  const out: TabView[] = [];
  for (const row of rows) {
    const v = parseTabView(row);
    if (v) out.push(v);
  }
  return out;
}
