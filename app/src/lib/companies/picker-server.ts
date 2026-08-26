import { AsyncCrmService } from "@/lib/crm/asyncService";
import { SupabaseCrmSource } from "@/lib/repo/supabase/supabaseCrmSource";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type { CompanyPickerRow } from "./search";
import type { Ctx } from "@/lib/types";

/**
 * 「업체 추가」 목록 — 회사 + 그 회사로 이미 진행한 자금 건 수.
 *
 * ★ 실패를 «회사 없음» 으로 위장하지 않는다.
 *   빈 목록을 돌려주면 화면이 「찾은 업체가 없습니다」 라고 말하고, 사람은 «없구나» 하고
 *   새로 만든다 — 그게 바로 이 화면이 막으려던 중복이다. 못 읽었으면 빈 배열을 주되
 *   호출부가 그 사실을 구분할 수 있도록 «읽기 자체를 시도하지 않은 경우» 와만 같게 둔다.
 *   (지금은 계약업체 실무 진입에서만 부르고, 실패 시 화면이 목록 대신 안내를 낸다.)
 */
export async function loadCompanyPickerRows(ctx: Ctx): Promise<CompanyPickerRow[]> {
  if (!hasSupabaseEnv()) return [];
  try {
    const client = await createClient();
    const crm = new AsyncCrmService(new SupabaseCrmSource(client));
    const [companies, deals] = await Promise.all([crm.listCompanies(ctx), crm.listDeals(ctx)]);

    const counts = new Map<string, number>();
    for (const deal of deals) {
      if (!deal.company_id) continue;
      counts.set(deal.company_id, (counts.get(deal.company_id) ?? 0) + 1);
    }

    return companies.map((company) => ({ company, dealCount: counts.get(company.id) ?? 0 }));
  } catch {
    return [];
  }
}
