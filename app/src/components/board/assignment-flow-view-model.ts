export type AssignmentFlowMember = Readonly<{
  id: string;
  label: string;
  avatarUrl?: string | null;
  title?: string | null;
  active?: boolean;
}>;

export type AssignmentHistoryEntry = Readonly<{
  id: string;
  member: AssignmentFlowMember;
  sequence: number;
  assignedAt?: string | null;
  unassignedAt?: string | null;
}>;

export type PendingHandoff = Readonly<{
  id: string;
  member: AssignmentFlowMember;
  scheduledFor?: string | null;
}>;

export type AssignmentFollower = Readonly<{
  id: string;
  member: AssignmentFlowMember;
}>;

export function orderAssignmentHistory(
  history: readonly AssignmentHistoryEntry[],
): AssignmentHistoryEntry[] {
  return [...history].sort((left, right) => {
    if (left.sequence !== right.sequence) return left.sequence - right.sequence;
    return left.id.localeCompare(right.id);
  });
}

export function formatAssignmentMoment(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
