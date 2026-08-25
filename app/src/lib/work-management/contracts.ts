export const WORK_TEMPLATE_KEY = "work-management" as const;
export const WORK_TEMPLATE_VERSION = 1 as const;

export type WorkViewKind = "table" | "calendar" | "gantt";
export type WorkRole = "manager" | "viewer" | "assignee";
export type WorkWorkflowStatus = "not_started" | "in_progress" | "done" | "blocked";

export type WorkColumnKind =
  | "title" | "person" | "text" | "url" | "select" | "multiselect"
  | "year" | "file" | "amount" | "email" | "phone" | "date"
  | "date_range" | "longtext" | "percent" | "virtual" | "system_date";

export interface WorkColumnContract {
  key: string;
  label: string;
  kind: WorkColumnKind;
  legacyOrder: number | null;
  sourceAliases?: readonly string[];
  readOnly?: boolean;
  system?: boolean;
}

export interface WorkGroup { id: string; name: string; color: string; count: number }
export interface WorkMember { membershipId: string; orgId: string; userId: string; displayName: string; active: true }
export interface WorkProvenance { sourceKind: string; sourceRecordId: string; immutable: true }
export interface WorkVirtualBinding { columnKey: string; source: "company" | "contact"; attribute: string; readOnly: true }
export interface WorkSavedView { id: string; name: string; kind: WorkViewKind; shared: boolean; isDefault: boolean; version: number; predicate: Readonly<Record<string, unknown>> }
export interface WorkUpdateEntry { id: string; body: string; createdAt: string }
export interface WorkActivity { id: string; label: string; at: string }

export interface WorkItemSnapshot {
  id: string;
  boardId: string;
  /**
   * ★ #547 — null 을 허용한다. DB(`items.group_id`)가 원래 nullable 인데
   *   읽는 쪽만 «반드시 문자열» 로 잡고 있어서, 그룹 없는 업무 한 건이 생기면
   *   스냅샷 전체가 거부돼 **화면이 통째로 사라졌다.** 쓰기와 읽기의 계약이 어긋나 있었다.
   *   그룹 없는 업무는 화면에서 «미분류» 묶음에 그린다 — 숨기지 않는다.
   */
  groupId: string | null;
  title: string;
  assignedTo: string | null;
  workflowStatus: WorkWorkflowStatus;
  dueDate: string | null;
  version: number;
  templateVersion: number;
  companyRef: string | null;
  contactRef: string | null;
  companyDisplay: string | null;
  contactDisplay: string | null;
  provenance: WorkProvenance | null;
  values: Readonly<Record<string, unknown>>;
  updates: readonly WorkUpdateEntry[];
  activities: readonly WorkActivity[];
}

export interface WorkBoardSnapshot {
  board: { id: string; orgId: string; title: string; icon: string; templateKey: string; templateVersion: number; baselineFingerprint: string; currentFingerprint: string };
  groups: readonly WorkGroup[];
  columns: readonly WorkColumnContract[];
  items: readonly WorkItemSnapshot[];
  members: readonly WorkMember[];
  views: readonly WorkSavedView[];
  virtualBindings: readonly WorkVirtualBinding[];
  role: WorkRole;
  filesEnabled: boolean;
}

interface WorkCommandBase<TOperation extends string, TPayload> {
  operation: TOperation;
  orgId: string;
  boardId: string;
  itemId?: string;
  expectedVersion: number;
  requestId: string;
  payload: TPayload;
}

export type WorkCommand =
  | (WorkCommandBase<"set_field", { field: string; value: unknown }> & { itemId: string })
  | (WorkCommandBase<"set_due_date", { due_date: string | null }> & { itemId: string })
  | (WorkCommandBase<"append_update", { body: string }> & { itemId: string })
  | WorkCommandBase<"create_group", { name: string }>
  | WorkCommandBase<"rename_group", { group_id: string; name: string }>
  | WorkCommandBase<"delete_group", { group_id: string }>
  | WorkCommandBase<"reorder_group", { group_id: string; position: number }>
  | WorkCommandBase<"create_column", { name: string; kind: WorkColumnKind }>
  | WorkCommandBase<"rename_column", { column_key: string; name: string }>
  | WorkCommandBase<"delete_column", { column_key: string }>
  | WorkCommandBase<"reorder_column", { column_key: string; position: number }>
  | WorkCommandBase<"create_item", { name: string; group_id?: string }>
  | (WorkCommandBase<"delete_item", Record<string, never>> & { itemId: string })
  | (WorkCommandBase<"move_item", { group_id: string; position?: number }> & { itemId: string })
  | WorkCommandBase<"save_personal_view", { name: string; kind: WorkViewKind; predicate: Record<string, unknown>; shared: false }>;

export interface WorkCommandResult { accepted: boolean; replayed: boolean; version: number }

export const ASSIGNEE_MUTABLE_FIELDS = [
  "title", "workflow_status", "due_date", "group_id", "institution", "product",
  "visit_application_date", "review_period", "inspection_date", "guidance",
  "reapply_date", "d180", "d365", "link", "update_entry",
] as const;

export function canManageStructure(role: WorkRole): boolean { return role === "manager"; }
export function canMutateField(role: WorkRole, field: string): boolean {
  return role === "manager" || (role === "assignee" && (ASSIGNEE_MUTABLE_FIELDS as readonly string[]).includes(field));
}
