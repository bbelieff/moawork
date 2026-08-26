"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { startCompanyWork, type CompanyStartWorkClient } from "@/lib/companies/start-work";
import { createClient } from "@/lib/supabase/server";

/**
 * 계약업체 실무의 「＋ 업체 추가」 — 고른 회사로 자금 건을 하나 시작한다.
 *
 * ★ 새 RPC 를 만들지 않았다. `start_company_work` 가 이미 그 일을 한다
 *   (회사 상세의 「업무 시작」이 쓰던 것). 같은 일에 두 개의 문을 내면
 *   한쪽만 고쳐질 때 두 화면이 다르게 동작한다.
 *
 * ★ 같은 회사를 «여러 번» 시작할 수 있다.
 *   RPC 의 멱등 열쇠는 `request_id` 지 `company_id` 가 아니다 —
 *   즉 «같은 버튼을 두 번 눌렀을 때» 만 막고, «이 회사로 또 한 건» 은 막지 않는다.
 *   목업이 요구하는 「한 회사에 매출이 여러 번 일어난다」 가 그대로 성립한다.
 */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export type CompanyIntakeActionState = Readonly<{
  ok: boolean | null;
  message: string;
}>;

export async function startCompanyWorkFromBoardAction(
  _previous: CompanyIntakeActionState,
  formData: FormData,
): Promise<CompanyIntakeActionState> {
  const companyId = text(formData, "companyId");
  const requestId = text(formData, "requestId");
  const boardId = text(formData, "boardId");
  if (!companyId || !requestId || !boardId) {
    return { ok: false, message: "업체를 선택한 뒤 다시 시도해 주세요." };
  }

  try {
    const ctx = await getSession();
    const client = await createClient();
    await startCompanyWork(client as unknown as CompanyStartWorkClient, { orgId: ctx.org.id, companyId, requestId });
  } catch (error) {
    // DB 원문은 화면에 노출하지 않고 서버 로그에만 남긴다.
    console.error("[company intake] failed to start work", error);
    return { ok: false, message: "업무를 시작하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }

  // 이 건은 세 화면에 동시에 나타난다 — 보드 · 계약업체 실무 진입 · 업체관리 현황.
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/work");
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
  return { ok: true, message: "업무를 시작했어요." };
}
