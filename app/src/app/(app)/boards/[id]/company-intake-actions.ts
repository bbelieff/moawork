"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { startCompanyWork, type CompanyStartWorkClient } from "@/lib/companies/start-work";
import {
  describeIntakeFailure,
  type CompanyIntakeResult,
} from "@/lib/companies/intake-result";
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
 *   즉 «같은 버튼을 두 번 눌렀을 때» 만 막고, 「이 회사로 또 한 건」은 막지 않는다.
 *   목업이 요구하는 「한 회사에 매출이 여러 번 일어난다」가 그대로 성립한다.
 *
 * ★ 실패를 삼키지 않는다. 결과를 «값» 으로 돌려준다.
 *   전에는 catch 후 void 였고, 화면에는 아무 일도 일어나지 않았다. 그러면 사용자는
 *   또 누른다 — 그리고 또 아무 일도 안 일어난다. 무엇이 잘못됐는지는
 *   `lib/companies/intake-result.ts` 가 사람 말로 옮긴다.
 */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function startCompanyWorkFromBoardAction(
  _prev: CompanyIntakeResult,
  formData: FormData,
): Promise<CompanyIntakeResult> {
  // stamp 는 «제출이 일어났다» 는 사실만 나른다. 화면이 이걸 key 로 써서
  // 멱등 열쇠 입력칸을 새로 만든다 — 쓴 열쇠를 다음 선택이 물려받지 않게.
  const stamp = Date.now();
  const ctx = await getSession();
  const companyId = text(formData, "companyId");
  const requestId = text(formData, "requestId");
  if (!companyId || !requestId) {
    return { error: "어느 업체인지 확인하지 못했습니다. 목록을 다시 열어 주세요.", stamp };
  }

  try {
    const client = await createClient();
    await startCompanyWork(client as unknown as CompanyStartWorkClient, {
      orgId: ctx.org.id,
      companyId,
      requestId,
    });
  } catch (cause) {
    return { error: describeIntakeFailure(cause), stamp };
  }

  // 이 건은 세 화면에 동시에 나타난다 — 보드 · 계약업체 실무 진입 · 업체관리 현황.
  revalidatePath("/work");
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
  return { error: null, stamp };
}
