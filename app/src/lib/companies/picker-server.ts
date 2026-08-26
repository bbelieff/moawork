import { AsyncCrmService } from "@/lib/crm/asyncService";
import { SupabaseCrmSource } from "@/lib/repo/supabase/supabaseCrmSource";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type { CompanyPickerRow } from "./search";
import type { Ctx } from "@/lib/types";

/**
 * 「업체 추가」 목록 — 회사 + 그 회사로 이미 진행한 자금 건 수.
 *
 * ★ 「못 읽었다」와 「회사가 없다」를 구분한다.
 *   빈 목록을 돌려주면 화면이 「찾은 업체가 없습니다」 라고 말하고, 사람은 «없구나» 하고
 *   새로 만든다 — 그게 바로 이 화면이 막으려던 중복이다.
 *   처음 판에는 이 주석만 있고 구분이 «구현돼 있지 않았다». 둘 다 빈 배열이었다.
 *   이제 kind 로 갈라서, 못 읽었으면 호출부가 회사 고르기 대신
 *   **원래의 이름 입력칸을 그대로 둔다** — 항목을 아예 못 만드는 것보다 낫다.
 */
export type CompanyPickerLoad =
  | { kind: "ready"; rows: CompanyPickerRow[] }
  | { kind: "unavailable" };

export async function loadCompanyPickerRows(ctx: Ctx): Promise<CompanyPickerLoad> {
  // 로컬 시드에는 Supabase 가 없다. 그때도 «못 읽음» 이다 — 빈 회사 목록이 아니다.
  if (!hasSupabaseEnv()) return { kind: "unavailable" };
  try {
    const client = await createClient();
    const crm = new AsyncCrmService(new SupabaseCrmSource(client));
    const [companies, deals] = await Promise.all([crm.listCompanies(ctx), crm.listDeals(ctx)]);

    const counts = new Map<string, number>();
    for (const deal of deals) {
      if (!deal.company_id) continue;
      counts.set(deal.company_id, (counts.get(deal.company_id) ?? 0) + 1);
    }

    return {
      kind: "ready",
      rows: companies.map((company) => ({ company, dealCount: counts.get(company.id) ?? 0 })),
    };
  } catch {
    return { kind: "unavailable" };
  }
}
