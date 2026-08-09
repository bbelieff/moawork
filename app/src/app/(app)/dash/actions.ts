"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getCrmService } from "@/lib/crm";
import {
  canReassign,
  DASH_TASK_KEYS,
} from "@/lib/dash/drilldown";

type MutationResult = "completed" | "postponed" | "reassigned" | "partial" | "failed";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function safeReturnTo(value: string): string {
  return value === "/dash/tasks" || value.startsWith("/dash/tasks?")
    ? value
    : "/dash/tasks";
}

function withResult(returnTo: string, result: MutationResult): string {
  const url = new URL(safeReturnTo(returnTo), "https://moa-work.local");
  url.searchParams.set("result", result);
  return `${url.pathname}${url.search}`;
}

async function recordMutation(
  dealId: string,
  content: string,
): Promise<boolean> {
  try {
    const ctx = await getSession();
    await getCrmService().createActivity(ctx, dealId, { type: "status", content });
    return true;
  } catch {
    return false;
  }
}

export async function completeTodayTaskAction(formData: FormData): Promise<void> {
  const dealId = text(formData, "dealId");
  const returnTo = safeReturnTo(text(formData, "returnTo"));
  let result: MutationResult = "failed";
  try {
    const ctx = await getSession();
    await getCrmService().getDeal(ctx, dealId);
    await getCrmService().updateDeal(ctx, dealId, {
      custom: {
        [DASH_TASK_KEYS.status]: "done",
        [DASH_TASK_KEYS.completedAt]: new Date().toISOString(),
      },
    });
    result = (await recordMutation(dealId, "오늘 할 일을 완료했어요"))
      ? "completed"
      : "partial";
  } catch {
    result = "failed";
  }
  revalidatePath("/dash/tasks");
  redirect(withResult(returnTo, result));
}

export async function postponeTodayTaskAction(formData: FormData): Promise<void> {
  const dealId = text(formData, "dealId");
  const dueDate = text(formData, "dueDate");
  const returnTo = safeReturnTo(text(formData, "returnTo"));
  let result: MutationResult = "failed";
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("invalid date");
    const ctx = await getSession();
    await getCrmService().getDeal(ctx, dealId);
    await getCrmService().updateDeal(ctx, dealId, {
      custom: {
        [DASH_TASK_KEYS.dueDate]: dueDate,
        [DASH_TASK_KEYS.status]: null,
        [DASH_TASK_KEYS.completedAt]: null,
      },
    });
    result = (await recordMutation(dealId, `오늘 할 일을 ${dueDate}로 연기했어요`))
      ? "postponed"
      : "partial";
  } catch {
    result = "failed";
  }
  revalidatePath("/dash/tasks");
  redirect(withResult(returnTo, result));
}

export async function reassignTodayTaskAction(formData: FormData): Promise<void> {
  const dealId = text(formData, "dealId");
  const assignee = text(formData, "assignee");
  const returnTo = safeReturnTo(text(formData, "returnTo"));
  let result: MutationResult = "failed";
  try {
    const ctx = await getSession();
    if (!canReassign(ctx)) throw new Error("forbidden");
    await getCrmService().getDeal(ctx, dealId);
    await getCrmService().updateDeal(ctx, dealId, {
      assigned_to: assignee || null,
    });
    result = (await recordMutation(dealId, "오늘 할 일 담당자를 바꿨어요"))
      ? "reassigned"
      : "partial";
  } catch {
    result = "failed";
  }
  revalidatePath("/dash/tasks");
  redirect(withResult(returnTo, result));
}
