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
  /**
   * 목록이 상한에 걸려 «전부가 아닐» 때 true.
   *
   * ★ 이걸 안 알리면 이 화면이 막으려던 중복을 오히려 만든다.
   *   목록은 최근 등록 순이라 잘리면 «오래된 회사» 부터 사라진다.
   *   사용자는 못 찾고 「없구나」 하며 새로 만든다 — 그게 정확히 이 기능이 막으려던 것이다.
   *   그래서 조용히 자르지 않고 «일부만 보인다» 고 말한다.
   */
  truncated: boolean;
}>;

/**
 * 한 번에 읽어 올 회사 수의 상한.
 *
 * ★ 왜 상한을 «두는가» — 전에는 없었다. 계약업체 실무 보드를 열 때마다 회사와 자금 건을
 *   통째로 읽어 화면으로 넘겼다. 첫 고객 보드는 8,400행 규모다(AGENTS.md).
 *
 * ★ 왜 «이 숫자인가» — 재서 고른 값이 아니다. 「전부」와 「사람이 훑을 수 있는 양」 사이의
 *   임의의 선이고, 그 사실을 여기 적어 둔다. 중요한 것은 숫자가 아니라 **잘렸을 때 말한다**는
 *   것이다. 조용히 자르는 것이 이 화면의 결함이었다.
 *
 * ★ 진짜 처방은 «서버에서 검색» 이다 — 지금은 전부 받아 화면에서 거른다(초성 검색 때문).
 *   초성을 SQL 로 하려면 생성 컬럼이 필요해서 마이그레이션이 따로 든다. #588 후속으로 남긴다.
 */
export const COMPANY_PICKER_LIMIT = 500;

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
  if (!options.source && !hasSupabaseEnv()) return { rows: [], error: COMPANY_PICKER_READ_ERROR, truncated: false };
  try {
    const crm = options.source ?? new AsyncCrmService(new SupabaseCrmSource(await createClient()));
    const [companies, deals] = await Promise.all([crm.listCompanies(ctx), crm.listDeals(ctx)]);
    // 상한을 «여기서» 자른다. 자른 사실은 숨기지 않는다 — truncated 참조.
    const truncated = companies.length > COMPANY_PICKER_LIMIT;
    const bounded = truncated ? companies.slice(0, COMPANY_PICKER_LIMIT) : companies;
    return { rows: buildCompanyPickerRows(bounded, deals), error: null, truncated };
  } catch (error) {
    console.error("[company picker] failed to load", error);
    return { rows: [], error: COMPANY_PICKER_READ_ERROR, truncated: false };
  }
}
