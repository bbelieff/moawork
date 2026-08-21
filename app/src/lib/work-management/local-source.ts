import { randomUUID } from "node:crypto";
import type { Ctx } from "@/lib/types";
import { isManager } from "@/lib/auth/roles";
import { parseWorkCommand } from "./rpc-contract";
import { currentStructureFingerprint, WORK_TEMPLATE } from "./template";
import type { WorkBoardSnapshot, WorkCommand, WorkCommandResult, WorkColumnContract, WorkItemSnapshot } from "./contracts";
import type { WorkManagementPort } from "./port";

type LocalState = { snapshot: WorkBoardSnapshot; requests: Map<string, WorkCommandResult> };
const globalState = globalThis as unknown as { __moaworkLocalWork?: Map<string, LocalState> };
const states = () => (globalState.__moaworkLocalWork ??= new Map());
const clone = <T>(value: T): T => structuredClone(value);
const roleFor = (ctx: Ctx): WorkBoardSnapshot["role"] => isManager(ctx.role) ? "manager" : "assignee";

function seed(ctx: Ctx): LocalState {
  const boardId = `local-work:${ctx.org.id}`;
  const groups = WORK_TEMPLATE.groups.map((name, index) => ({ id: `${boardId}:group:${index}`, name, color: ["#64748b", "#2563eb", "#16a34a"][index], count: 0 }));
  const columns = clone([...WORK_TEMPLATE.columns]) as WorkColumnContract[];
  return {
    snapshot: {
      board: { id: boardId, orgId: ctx.org.id, title: "계약업체 실무", icon: "🔁", templateKey: WORK_TEMPLATE.key, templateVersion: WORK_TEMPLATE.version, baselineFingerprint: WORK_TEMPLATE.baselineFingerprint, currentFingerprint: currentStructureFingerprint(columns) },
      groups, columns, items: [],
      members: [{ membershipId: `local-member:${ctx.org.id}:${ctx.user.id}`, orgId: ctx.org.id, userId: ctx.user.id, displayName: ctx.user.name ?? "로컬 사용자", active: true }],
      views: WORK_TEMPLATE.views.map((view, index) => ({ id: `${boardId}:view:${index}`, name: view.name, kind: view.kind, shared: true, isDefault: view.isDefault, version: 1, predicate: {} })),
      virtualBindings: [], role: roleFor(ctx), filesEnabled: false,
    },
    requests: new Map(),
  };
}

function stateFor(ctx: Ctx): LocalState {
  let state = states().get(ctx.org.id);
  if (!state) { state = seed(ctx); states().set(ctx.org.id, state); }
  return state;
}

export class LocalWorkManagementSource implements WorkManagementPort {
  constructor(private readonly ctx: Ctx) {}
  async load(orgId: string): Promise<WorkBoardSnapshot> {
    if (orgId !== this.ctx.org.id) throw new Error("Local work source denied cross-org read.");
    const snapshot = clone(stateFor(this.ctx).snapshot);
    // Data is shared per org, authorization is never cached with that data.
    snapshot.role = roleFor(this.ctx);
    if (!snapshot.members.some((member) => member.userId === this.ctx.user.id)) {
      (snapshot.members as Array<WorkBoardSnapshot["members"][number]>).push({ membershipId: `local-member:${this.ctx.org.id}:${this.ctx.user.id}`, orgId: this.ctx.org.id, userId: this.ctx.user.id, displayName: this.ctx.user.name ?? "로컬 사용자", active: true });
    }
    return snapshot;
  }
  async execute(input: WorkCommand): Promise<WorkCommandResult> {
    const command = parseWorkCommand(input);
    if (command.orgId !== this.ctx.org.id) throw new Error("Local work source denied cross-org write.");
    const state = stateFor(this.ctx); const snapshot = state.snapshot;
    if (command.boardId !== snapshot.board.id) throw new Error("Local work board does not belong to this org.");
    const prior = state.requests.get(command.requestId);
    if (prior) return { ...prior, replayed: true };
    const currentRole = roleFor(this.ctx);
    if (currentRole === "viewer") throw new Error("Work command permission denied.");
    const managerOnly = new Set(["create_group", "rename_group", "delete_group", "reorder_group", "create_column", "rename_column", "delete_column", "reorder_column", "delete_item"]);
    if (managerOnly.has(command.operation) && currentRole !== "manager") throw new Error("Work command permission denied.");
    const item = command.itemId ? snapshot.items.find((row) => row.id === command.itemId) : undefined;
    if (command.itemId && !item) throw new Error("Work item not found.");
    if (item && item.version !== command.expectedVersion) throw new Error("Work item changed. Refresh and retry.");
    const groups = snapshot.groups as Array<WorkBoardSnapshot["groups"][number]>;
    const columns = snapshot.columns as WorkColumnContract[];
    const items = snapshot.items as WorkItemSnapshot[];
    const views = snapshot.views as Array<WorkBoardSnapshot["views"][number]>;
    let version = item?.version ?? 0;
    switch (command.operation) {
      case "set_field": if (command.payload.field === "title") item!.title = String(command.payload.value ?? ""); else if (command.payload.field === "assigned_to") item!.assignedTo = command.payload.value ? String(command.payload.value) : null; else if (command.payload.field === "workflow_status") item!.workflowStatus = command.payload.value as WorkItemSnapshot["workflowStatus"]; else (item!.values as Record<string, unknown>)[command.payload.field] = command.payload.value; version = ++item!.version; break;
      case "set_due_date": item!.dueDate = command.payload.due_date; version = ++item!.version; break;
      case "append_update": (item!.updates as Array<WorkItemSnapshot["updates"][number]>).push({ id: randomUUID(), body: command.payload.body, createdAt: new Date().toISOString() }); version = ++item!.version; break;
      case "create_group": groups.push({ id: randomUUID(), name: command.payload.name, color: "#64748b", count: 0 }); break;
      case "rename_group": { const row = groups.find((x) => x.id === command.payload.group_id); if (!row) throw new Error("Work group not found."); row.name = command.payload.name; break; }
      case "delete_group": { if (items.some((x) => x.groupId === command.payload.group_id)) throw new Error("Move group items before deleting it."); const i = groups.findIndex((x) => x.id === command.payload.group_id); if (i < 0) throw new Error("Work group not found."); groups.splice(i, 1); break; }
      case "reorder_group": reorder(groups, command.payload.group_id, command.payload.position); break;
      case "create_column": columns.push({ key: uniqueKey(columns, command.payload.name), label: command.payload.name, kind: command.payload.kind, legacyOrder: null }); snapshot.board.currentFingerprint = currentStructureFingerprint(columns); break;
      case "rename_column": { const row = columns.find((x) => x.key === command.payload.column_key); if (!row) throw new Error("Work column not found."); row.label = command.payload.name; snapshot.board.currentFingerprint = currentStructureFingerprint(columns); break; }
      case "delete_column": { const i = columns.findIndex((x) => x.key === command.payload.column_key && !x.system); if (i < 0) throw new Error("Work column not found."); columns.splice(i, 1); snapshot.board.currentFingerprint = currentStructureFingerprint(columns); break; }
      case "reorder_column": reorder(columns, command.payload.column_key, command.payload.position, (x) => x.key); snapshot.board.currentFingerprint = currentStructureFingerprint(columns); break;
      case "create_item": { const group = command.payload.group_id ? groups.find((x) => x.id === command.payload.group_id) : groups[0]; if (!group) throw new Error("Work group not found."); items.push({ id: randomUUID(), boardId: snapshot.board.id, groupId: group.id, title: command.payload.name, assignedTo: this.ctx.user.id, workflowStatus: "not_started", dueDate: null, version: 1, templateVersion: WORK_TEMPLATE.version, companyRef: null, contactRef: null, companyDisplay: null, contactDisplay: null, provenance: null, values: {}, updates: [], activities: [] }); group.count += 1; version = 1; break; }
      case "delete_item": { const i = items.findIndex((x) => x.id === item!.id); items.splice(i, 1); const group = groups.find((x) => x.id === item!.groupId); if (group) group.count -= 1; version = item!.version + 1; break; }
      case "move_item": { const group = groups.find((x) => x.id === command.payload.group_id); if (!group) throw new Error("Work group not found."); const old = groups.find((x) => x.id === item!.groupId); if (old) old.count -= 1; group.count += 1; item!.groupId = group.id; version = ++item!.version; break; }
      case "save_personal_view": views.push({ id: randomUUID(), name: command.payload.name, kind: command.payload.kind, shared: false, isDefault: false, version: 1, predicate: clone(command.payload.predicate) }); break;
    }
    const result = { accepted: true, replayed: false, version } as const;
    state.requests.set(command.requestId, result); return result;
  }
}

function reorder<T>(rows: T[], id: string, position: number, key: (row: T) => string = (row) => String((row as { id: string }).id)) { const from = rows.findIndex((row) => key(row) === id); if (from < 0) throw new Error("Work structure row not found."); const [row] = rows.splice(from, 1); rows.splice(Math.min(position, rows.length), 0, row); }
function uniqueKey(columns: readonly WorkColumnContract[], label: string) { const base = label.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "column"; let key = base, i = 2; while (columns.some((row) => row.key === key)) key = `${base}_${i++}`; return key; }

export function resetLocalWorkManagementForTest(): void { states().clear(); }
