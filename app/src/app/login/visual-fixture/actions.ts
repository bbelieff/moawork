"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const PATH = "/login/visual-fixture";

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
