"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";
import { ensurePracticeWorkspace, evaluatePracticeQuests } from "@/lib/onboarding/server";

function revalidate(formData: FormData): void {
  const path = formData.get("path");
  if (typeof path === "string" && path !== "") {
    revalidatePath(path);
  }
}

/** 연습 회사를 확보한다(없으면 생성) — 진입 버튼이 호출한다. */
export async function startPracticeAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const result = await ensurePracticeWorkspace(ctx.user);
  if (!result.ok) {
    revalidate(formData);
    return;
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE.org, result.orgId, { path: "/" });
  redirect("/onboarding/practice");
}

/** 지금 연습 회사 상태로 퀘스트를 다시 판정한다 — «했다고 체크» 가 아니라 실제 상태를 다시 본다. */
export async function refreshQuestsAction(formData: FormData): Promise<void> {
  const orgId = formData.get("orgId");
  if (typeof orgId !== "string" || orgId === "") return;
  const ctx = await getSession();
  await evaluatePracticeQuests(orgId, ctx.user);
  revalidate(formData);
}
