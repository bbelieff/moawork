"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getCrmService } from "@/lib/crm";
import { canReassign } from "@/lib/dash/drilldown";
import { listOrgMemberOptions } from "@/lib/deal/members";
import { shouldRetryCaseTaskMutation } from "@/lib/repo/supabase/source";

type MutationResult = "completed" | "postponed" | "reassigned" | "retryable_unknown" | "failed";

type TaskRetryState =
  | { dealId: string; kind: "complete"; requestId: string }
  | { dealId: string; kind: "postpone"; dueDate: string; requestId: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function safeReturnTo(value: string): string {
  return value === "/dash/tasks" || value.startsWith("/dash/tasks?")
    ? value
    : "/dash/tasks";
}

function withResult(returnTo: string, result: MutationResult, retry?: TaskRetryState): string {
  const url = new URL(safeReturnTo(returnTo), "https://moa-work.local");
  for (const key of ["retryDealId", "retryKind", "retryRequestId", "retryDueDate"]) {
    url.searchParams.delete(key);
  }
  url.searchParams.set("result", result);
  if (retry) {
    url.searchParams.set("retryDealId", retry.dealId);
    url.searchParams.set("retryKind", retry.kind);
    url.searchParams.set("retryRequestId", retry.requestId);
    if (retry.kind === "postpone") url.searchParams.set("retryDueDate", retry.dueDate);
  }
  return `${url.pathname}${url.search}`;
}

export async function completeTodayTaskAction(formData: FormData): Promise<void> {
  const dealId = text(formData, "dealId");
  const returnTo = safeReturnTo(text(formData, "returnTo"));
  const requestId = text(formData, "requestId");
  let result: MutationResult = "failed";
  let retry: TaskRetryState | undefined;
  try {
    if (!requestId) throw new Error("requestId required");
    const ctx = await getSession();
    await getCrmService().mutateCaseTask(ctx, dealId, {
      kind: "complete",
      requestId,
    });
    result = "completed";
  } catch (error) {
    if (requestId && shouldRetryCaseTaskMutation(error)) {
      result = "retryable_unknown";
      retry = { dealId, kind: "complete", requestId };
    }
  }
  revalidatePath("/dash/tasks");
  redirect(withResult(returnTo, result, retry));
}

export async function postponeTodayTaskAction(formData: FormData): Promise<void> {
  const dealId = text(formData, "dealId");
  const dueDate = text(formData, "dueDate");
  const retryDueDate = text(formData, "retryDueDate");
  const returnTo = safeReturnTo(text(formData, "returnTo"));
  const submittedRequestId = text(formData, "requestId");
  const requestId = retryDueDate && retryDueDate !== dueDate
    ? crypto.randomUUID()
    : submittedRequestId;
  let result: MutationResult = "failed";
  let retry: TaskRetryState | undefined;
  try {
    if (!requestId || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("invalid input");
    const ctx = await getSession();
    await getCrmService().mutateCaseTask(ctx, dealId, {
      kind: "postpone",
      dueDate,
      requestId,
    });
    result = "postponed";
  } catch (error) {
    if (requestId && /^\d{4}-\d{2}-\d{2}$/u.test(dueDate) && shouldRetryCaseTaskMutation(error)) {
      result = "retryable_unknown";
      retry = { dealId, kind: "postpone", dueDate, requestId };
    }
  }
  revalidatePath("/dash/tasks");
  redirect(withResult(returnTo, result, retry));
}

export async function reassignTodayTaskAction(formData: FormData): Promise<void> {
  const dealId = text(formData, "dealId");
  const assignee = text(formData, "assignee");
  const returnTo = safeReturnTo(text(formData, "returnTo"));
  let result: MutationResult = "failed";
  try {
    const ctx = await getSession();
    if (!canReassign(ctx)) throw new Error("forbidden");
    const crm = getCrmService();
    const before = await crm.getDeal(ctx, dealId);
    const members = await listOrgMemberOptions(ctx);
    const nameOf = (id: string | null) => id ? (members.find((member) => member.id === id)?.name ?? null) : null;
    await crm.reassignDeal(ctx, dealId, assignee || null, {
      fromName: nameOf(before.assigned_to),
      toName: nameOf(assignee || null),
    });
    result = "reassigned";
  } catch {
    result = "failed";
  }
  revalidatePath("/dash/tasks");
  redirect(withResult(returnTo, result));
}
