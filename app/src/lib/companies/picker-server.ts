import { AsyncCrmService } from "@/lib/crm/asyncService";
import { SupabaseCrmSource } from "@/lib/repo/supabase/supabaseCrmSource";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type { CompanyPickerRow } from "./search";
import type { Company, Ctx, Deal } from "@/lib/types";

export type CompanyPickerLoadResult = Readonly<{
  rows: CompanyPickerRow[];
  /** null이면 정상적으로 읽은 결과(0건 포함), 문자열이면 목록을 신뢰하면 안 된다. */
  error: string | null;
}>;

const COMPANY_PICKER_READ_ERROR = "업체 목록을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.";

export interface CompanyPickerSource {
  listCompanies(ctx: Ctx): Promise<Company[]>;
  listDeals(ctx: Ctx): Promise<Deal[]>;
}

export function buildCompanyPickerRows(
  companies: readonly Company[],
  deals: readonly Deal[],
): CompanyPickerRow[] {
  const counts = new Map<string, number>();
  for (const deal of deals) {
    if (!deal.company_id) continue;
    counts.set(deal.company_id, (counts.get(deal.company_id) ?? 0) + 1);
  }

  return companies.map((company) => ({
    company: {
      id: company.id,
      name: company.name,
      biz_type: company.biz_type,
      region: company.region,
      owner_name: company.owner_name,
      phone: company.phone,
      email: company.email,
      homepage: company.homepage,
    },
    dealCount: counts.get(company.id) ?? 0,
  }));
}

/**
 * 「업체 추가」 목록 — 회사 + 그 회사로 이미 진행한 자금 건 수.
 *
 * ★ 실패를 «회사 없음» 으로 위장하지 않는다.
 *   빈 목록을 돌려주면 화면이 「찾은 업체가 없습니다」 라고 말하고, 사람은 «없구나» 하고
 *   새로 만든다 — 그게 바로 이 화면이 막으려던 중복이다. 정상 0건과 읽기 실패를
 *   `error`로 구분해 호출부가 등록 안내를 숨기고 재시도를 안내하게 한다.
 */
export async function loadCompanyPickerRows(
  ctx: Ctx,
  options: { source?: CompanyPickerSource } = {},
): Promise<CompanyPickerLoadResult> {
  if (!options.source && !hasSupabaseEnv()) return { rows: [], error: COMPANY_PICKER_READ_ERROR };
  try {
    const crm = options.source ?? new AsyncCrmService(new SupabaseCrmSource(await createClient()));
    const [companies, deals] = await Promise.all([crm.listCompanies(ctx), crm.listDeals(ctx)]);
    return { rows: buildCompanyPickerRows(companies, deals), error: null };
  } catch (error) {
    console.error("[company picker] failed to load", error);
    return { rows: [], error: COMPANY_PICKER_READ_ERROR };
  }
}
