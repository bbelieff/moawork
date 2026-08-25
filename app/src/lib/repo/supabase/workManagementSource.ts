import type { WorkBoardSnapshot, WorkCommand, WorkCommandResult } from "@/lib/work-management";
import type { WorkManagementPort } from "@/lib/work-management/port";
import { parseWorkCommand, parseCommandResult, WORK_RPC } from "@/lib/work-management";

export interface WorkRpcClient {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

export class WorkManagementUnavailableError extends Error {
  constructor(message = "Work management is not available yet.") { super(message); this.name = "WorkManagementUnavailableError"; }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (row: Record<string, unknown>, keys: readonly string[]) => keys.every((key) => typeof row[key] === "string" && String(row[key]).length > 0);
const safeVersion = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const nullableString = (value: unknown) => value === null || typeof value === "string";
const date = (value: unknown) => { if (value === null) return true; if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [year, month, day] = value.split("-").map(Number); const parsed = new Date(Date.UTC(year, month - 1, day)); return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day; };
const WORKFLOW = ["not_started", "in_progress", "done", "blocked"];
const COLUMN_KIND = ["title", "person", "text", "url", "select", "multiselect", "year", "file", "amount", "email", "phone", "date", "date_range", "longtext", "percent", "virtual", "system_date"];
const VIEW_KIND = ["table", "calendar", "gantt"];

function snapshot(value: unknown, expectedOrgId: string): WorkBoardSnapshot {
  if (!isRecord(value)) throw new WorkManagementUnavailableError("Empty work-management response.");
  const row = value;
  const arrays = ["groups", "columns", "items", "members", "views", "virtualBindings"] as const;
  if (!isRecord(row.board) || !arrays.every((key) => Array.isArray(row[key])) || !arrays.every((key) => (row[key] as unknown[]).every(isRecord))) throw new WorkManagementUnavailableError("Invalid work-management snapshot.");
  if (row.role !== "manager" && row.role !== "viewer" && row.role !== "assignee") throw new WorkManagementUnavailableError("Invalid work-management role.");
  const board = row.board; const groups = row.groups as Record<string, unknown>[]; const columns = row.columns as Record<string, unknown>[]; const items = row.items as Record<string, unknown>[]; const members = row.members as Record<string, unknown>[]; const views = row.views as Record<string, unknown>[]; const bindings = row.virtualBindings as Record<string, unknown>[];
  const validBoard = strings(board, ["id", "orgId", "title", "icon", "templateKey", "baselineFingerprint", "currentFingerprint"]) && safeVersion(board.templateVersion);
  const validGroups = groups.every((group) => strings(group, ["id", "name", "color"]) && safeVersion(group.count));
  const validColumns = columns.every((column) => strings(column, ["key", "label", "kind"]) && COLUMN_KIND.includes(String(column.kind)) && (column.legacyOrder === null || safeVersion(column.legacyOrder)) && (column.sourceAliases === undefined || (Array.isArray(column.sourceAliases) && column.sourceAliases.every((alias) => typeof alias === "string"))) && (column.readOnly === undefined || typeof column.readOnly === "boolean") && (column.system === undefined || typeof column.system === "boolean"));
  // ★ #547 — `groupId` 를 필수 문자열에서 뺐다.
  //   DB 는 `items.group_id` 를 nullable 로 허용하는데 여기서만 «반드시 문자열» 을 요구해서,
  //   그룹 없는 업무 한 건이 생기면 아래 한 줄이 **스냅샷 전체**를 던져 화면이 통째로 사라졌다.
  //   사용자는 그 업무를 지울 UI 조차 못 봐서 DB 를 만지지 않으면 복구가 안 됐다.
  //   이제 null 을 받아들이고 화면이 «미분류» 묶음으로 그린다 — 숨기지도, 죽지도 않는다.
  const validItems = items.every((item) => strings(item, ["id", "boardId", "title", "workflowStatus"]) && nullableString(item.groupId) && item.boardId === board.id && WORKFLOW.includes(String(item.workflowStatus)) && safeVersion(item.version) && safeVersion(item.templateVersion) && date(item.dueDate) && [item.assignedTo, item.companyRef, item.contactRef, item.companyDisplay, item.contactDisplay].every(nullableString) && isRecord(item.values) && Array.isArray(item.updates) && item.updates.every(validUpdate) && Array.isArray(item.activities) && item.activities.every(validActivity) && (item.provenance === null || validProvenance(item.provenance)));
  const validMembers = members.every((member) => strings(member, ["membershipId", "orgId", "userId", "displayName"]) && member.orgId === expectedOrgId && member.active === true);
  const validViews = views.every((view) => strings(view, ["id", "name", "kind"]) && VIEW_KIND.includes(String(view.kind)) && typeof view.shared === "boolean" && typeof view.isDefault === "boolean" && safeVersion(view.version) && isRecord(view.predicate));
  const validBindings = bindings.every((binding) => strings(binding, ["columnKey", "source", "attribute"]) && (binding.source === "company" || binding.source === "contact") && binding.readOnly === true);
  if (!validBoard || !validGroups || !validColumns || !validItems || !validMembers || !validViews || !validBindings || board.orgId !== expectedOrgId || typeof row.filesEnabled !== "boolean") throw new WorkManagementUnavailableError("Invalid tenant-bound work-management snapshot.");
  return { board, groups, columns, items, members, views, virtualBindings: bindings, role: row.role, filesEnabled: row.filesEnabled } as unknown as WorkBoardSnapshot;
}

function validProvenance(value: unknown): boolean { return isRecord(value) && strings(value, ["sourceKind", "sourceRecordId"]) && value.immutable === true; }
function validUpdate(value: unknown): boolean { return isRecord(value) && strings(value, ["id", "body", "createdAt"]); }
function validActivity(value: unknown): boolean { return isRecord(value) && strings(value, ["id", "label", "at"]); }

export class WorkManagementSource implements WorkManagementPort {
  constructor(private readonly client: WorkRpcClient) {}
  async load(orgId: string): Promise<WorkBoardSnapshot> {
    if (!orgId) throw new WorkManagementUnavailableError();
    const { data, error } = await this.client.rpc(WORK_RPC.read, { p_org_id: orgId });
    if (error) throw new WorkManagementUnavailableError("Work-management read RPC is unavailable.");
    return snapshot(data, orgId);
  }
  async execute(input: WorkCommand): Promise<WorkCommandResult> {
    const command = parseWorkCommand(input);
    const { data, error } = await this.client.rpc(WORK_RPC.command, { p_org_id: command.orgId, p_board_id: command.boardId, p_item_id: command.itemId ?? null, p_operation: command.operation, p_expected_version: command.expectedVersion, p_request_id: command.requestId, p_payload: command.payload });
    if (error) throw new WorkManagementUnavailableError("Work-management command failed.");
    return parseCommandResult(data);
  }
}
