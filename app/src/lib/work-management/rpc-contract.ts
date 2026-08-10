import { WORK_COLUMNS } from "./template";
import type { WorkCommand, WorkCommandResult } from "./contracts";

export const WORK_RPC = { read: "read_work_management_board", command: "execute_work_management_command" } as const;
export const WORK_OPERATIONS = ["set_field", "set_due_date", "append_update", "create_group", "rename_group", "delete_group", "reorder_group", "create_column", "rename_column", "delete_column", "reorder_column", "create_item", "delete_item", "save_personal_view", "move_item"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLUMN_KINDS = ["person", "text", "url", "select", "multiselect", "year", "amount", "email", "phone", "date", "date_range", "longtext", "percent"] as const;
const VIEW_KINDS = ["table", "calendar", "gantt"] as const;
const MUTABLE_FIELDS = WORK_COLUMNS.filter((column) => !column.readOnly && !column.system && column.kind !== "file").map((column) => column.key);

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid work command payload.");
  return value as Record<string, unknown>;
};
const exact = (row: Record<string, unknown>, keys: readonly string[]) => {
  if (Object.keys(row).some((key) => !keys.includes(key))) throw new Error("Unexpected work command payload field.");
  if (keys.some((key) => !(key in row))) throw new Error("Missing work command payload field.");
};
const bounded = (value: unknown, name: string, max = 500): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${name}.`);
  return value.trim();
};

export function parseWorkCommand(value: unknown): WorkCommand {
  const row = object(value); const payload = object(row.payload);
  exact(row, ["operation", "orgId", "boardId", "expectedVersion", "requestId", "payload", ...(row.itemId === undefined ? [] : ["itemId"])]);
  const operation = bounded(row.operation, "operation", 40); const orgId = bounded(row.orgId, "orgId", 128); const boardId = bounded(row.boardId, "boardId", 128);
  const requestId = bounded(row.requestId, "requestId", 36); const expectedVersion = row.expectedVersion;
  if (!UUID.test(requestId) || typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("Invalid command identity or version.");
  const itemId = row.itemId === undefined ? undefined : bounded(row.itemId, "itemId", 128);
  const base = { operation, orgId, boardId, itemId, expectedVersion, requestId };
  const requiresItem = () => { if (!itemId) throw new Error("This operation requires an item."); return itemId; };
  const forbidsItem = () => { if (itemId) throw new Error("This operation does not accept an item."); };
  switch (operation) {
    case "set_field": { exact(payload, ["field", "value"]); const field = bounded(payload.field, "field", 80); if (!MUTABLE_FIELDS.includes(field)) throw new Error("Field is not mutable."); return { ...base, operation, itemId: requiresItem(), payload: { field, value: boundedValue(payload.value) } }; }
    case "set_due_date": exact(payload, ["due_date"]); if (payload.due_date !== null && (typeof payload.due_date !== "string" || !validDate(payload.due_date))) throw new Error("Invalid due date."); return { ...base, operation, itemId: requiresItem(), payload: { due_date: payload.due_date as string | null } };
    case "append_update": exact(payload, ["body"]); return { ...base, operation, itemId: requiresItem(), payload: { body: bounded(payload.body, "update", 10000) } };
    case "create_group": forbidsItem(); exact(payload, ["name"]); return { ...base, operation, payload: { name: bounded(payload.name, "group name", 120) } };
    case "rename_group": forbidsItem(); exact(payload, ["group_id", "name"]); return { ...base, operation, payload: { group_id: bounded(payload.group_id, "group", 128), name: bounded(payload.name, "group name", 120) } };
    case "delete_group": forbidsItem(); exact(payload, ["group_id"]); return { ...base, operation, payload: { group_id: bounded(payload.group_id, "group", 128) } };
    case "reorder_group": forbidsItem(); exact(payload, ["group_id", "position"]); return { ...base, operation, payload: { group_id: bounded(payload.group_id, "group", 128), position: nonnegative(payload.position) } };
    case "create_column": forbidsItem(); exact(payload, ["name", "kind"]); return { ...base, operation, payload: { name: bounded(payload.name, "column name", 120), kind: oneOf(payload.kind, COLUMN_KINDS, "column kind") } };
    case "rename_column": forbidsItem(); exact(payload, ["column_key", "name"]); return { ...base, operation, payload: { column_key: bounded(payload.column_key, "column", 80), name: bounded(payload.name, "column name", 120) } };
    case "delete_column": forbidsItem(); exact(payload, ["column_key"]); return { ...base, operation, payload: { column_key: bounded(payload.column_key, "column", 80) } };
    case "reorder_column": forbidsItem(); exact(payload, ["column_key", "position"]); return { ...base, operation, payload: { column_key: bounded(payload.column_key, "column", 80), position: nonnegative(payload.position) } };
    case "create_item": forbidsItem(); exact(payload, ["name", ...(payload.group_id === undefined ? [] : ["group_id"])]); return { ...base, operation, payload: { name: bounded(payload.name, "item name", 500), ...(payload.group_id === undefined ? {} : { group_id: bounded(payload.group_id, "group", 128) }) } };
    case "delete_item": exact(payload, []); return { ...base, operation, itemId: requiresItem(), payload: {} };
    case "move_item": exact(payload, ["group_id", ...(payload.position === undefined ? [] : ["position"])]); return { ...base, operation, itemId: requiresItem(), payload: { group_id: bounded(payload.group_id, "group", 128), ...(payload.position === undefined ? {} : { position: nonnegative(payload.position) }) } };
    case "save_personal_view": { forbidsItem(); exact(payload, ["name", "kind", "predicate", "shared"]); if (payload.shared !== false) throw new Error("Personal views cannot be shared."); const predicate = object(payload.predicate); if (JSON.stringify(predicate).length > 4000) throw new Error("View predicate is too large."); return { ...base, operation, payload: { name: bounded(payload.name, "view name", 120), kind: oneOf(payload.kind, VIEW_KINDS, "view kind"), predicate, shared: false } }; }
    default: throw new Error("Unsupported work command.");
  }
}

function nonnegative(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid position."); return value; }
function validDate(value: string): boolean { if (!DATE.test(value)) return false; const [year, month, day] = value.split("-").map(Number); const date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day; }
function boundedValue(value: unknown): string | number | boolean | null | string[] { if (value === null || typeof value === "boolean") return value; if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && value.length <= 10000) return value; if (Array.isArray(value) && value.length <= 100 && value.every((entry) => typeof entry === "string" && entry.length <= 500)) return value; throw new Error("Invalid field value."); }
function oneOf<T extends string>(value: unknown, values: readonly T[], name: string): T { if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`Invalid ${name}.`); return value as T; }
export function assertCommand(command: WorkCommand): void { parseWorkCommand(command); }

export function parseCommandResult(value: unknown): WorkCommandResult {
  const row = object(value);
  if (row.accepted !== true || typeof row.replayed !== "boolean" || typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 0) throw new Error("Invalid work command response.");
  return { accepted: true, replayed: row.replayed, version: row.version };
}
