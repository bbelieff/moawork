import type { DealChecklistState } from "./types";

export interface ChecklistMutationIntent {
  key: string;
  requestId: string;
  expectedVersion: number;
  previous: DealChecklistState;
  next: DealChecklistState;
}

export type ChecklistMutationFailure = "retryable" | "terminal";

export function isTerminalChecklistError(message: string): boolean {
  return /conflict|mismatch|permission|권한|버전|case unavailable|schema invalid|input required/i.test(message);
}

export function beginChecklistMutation(
  current: ChecklistMutationIntent | null,
  pending: boolean,
  candidate: ChecklistMutationIntent,
): ChecklistMutationIntent | null {
  if (pending) return null;
  if (current && current.key !== candidate.key) return null;
  return current ?? candidate;
}

export function settleChecklistMutation(
  current: ChecklistMutationIntent | null,
  requestId: string,
): { applies: boolean; next: ChecklistMutationIntent | null } {
  if (current?.requestId !== requestId) return { applies: false, next: current };
  return { applies: true, next: null };
}

export function failChecklistMutation(
  current: ChecklistMutationIntent | null,
  requestId: string,
  failure: ChecklistMutationFailure,
): ChecklistMutationIntent | null {
  if (current?.requestId !== requestId) return current;
  return failure === "terminal" ? null : current;
}
