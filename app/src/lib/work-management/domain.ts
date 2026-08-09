import type { WorkBoardSnapshot, WorkCommand } from "./contracts";

export function canonicalPayload(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalPayload(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function commandKey(command: WorkCommand): string {
  return `${command.orgId}:${command.requestId}:${canonicalPayload({ operation: command.operation, boardId: command.boardId, itemId: command.itemId ?? null, expectedVersion: command.expectedVersion, payload: command.payload })}`;
}

export function visibleItems(snapshot: WorkBoardSnapshot, query: string, status: string, sort: "group" | "due") {
  const needle = query.trim().toLocaleLowerCase("ko-KR");
  return [...snapshot.items]
    .filter((item) => !needle || [item.title, item.companyDisplay ?? "", item.contactDisplay ?? ""].some((v) => v.toLocaleLowerCase("ko-KR").includes(needle)))
    .filter((item) => !status || item.workflowStatus === status)
    .sort((a, b) => sort === "due" ? (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") : a.groupId.localeCompare(b.groupId));
}

export function calendarBuckets(snapshot: WorkBoardSnapshot) {
  const buckets = new Map<string, typeof snapshot.items>();
  for (const item of snapshot.items) { const key = item.dueDate ?? "unscheduled"; buckets.set(key, [...(buckets.get(key) ?? []), item]); }
  return [...buckets.entries()].sort(([a], [b]) => a === "unscheduled" ? 1 : b === "unscheduled" ? -1 : a.localeCompare(b));
}

