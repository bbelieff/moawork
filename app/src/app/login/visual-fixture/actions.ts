"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";

const PATH = "/login/visual-fixture";

/**
 * 계약업체 실무 시험 화면(tab=work)의 「업체 추가」 — 합성 화면이라 아무것도 만들지 않는다.
 * 패널의 열기·닫기·포커스·배치만 확인하는 용도다.
 */
export async function visualStartCompanyWorkAction(): Promise<CompanyIntakeActionState> {
  return { ok: false, outcome: "rejected", message: "시험 화면이라 저장하지 않아요." };
}

export async function visualSetCellAction(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId") ?? "");
  const value = String(formData.get("value") ?? "");
  const tab = boardId.includes("contact") ? "contact" : "new";
  const jar = await cookies();

  if (tab === "contact" && value === "업무관리 이동") {
    jar.set(`visual-workflow-${tab}-draft`, value, { httpOnly: true, sameSite: "lax", path: PATH });
    jar.set(`visual-workflow-${tab}-error`, "필수 조건을 확인하세요 · 입력 보존", { httpOnly: true, sameSite: "lax", path: PATH });
  } else {
    jar.set(`visual-workflow-${tab}-saved`, value, { httpOnly: true, sameSite: "lax", path: PATH });
    jar.delete(`visual-workflow-${tab}-draft`);
    jar.delete(`visual-workflow-${tab}-error`);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?tab=${tab}`);
}
