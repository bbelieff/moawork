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
 * 한 번에 화면으로 넘기는 회사 수의 상한.
 *
 * ★ 왜 1000 인가 — «PostgREST 기본 max-rows» 와 같은 값이다. 이것이 핵심이다.
 *
 *   처음엔 500 으로 두었다가 검수에서 잡혔다. 500 은 DB 상한보다 «낮아서»,
 *   회사 501~1000 곳인 조직은 **원래 전부 보이던 구간인데 이 코드가 새로 잘랐다.**
 *   고치려던 병(조용히 잘림)을 안 앓던 조직에게 옮긴 셈이다.
 *   게다가 잘리는 쪽은 오래된 회사인데(created_at desc), 그게 곧 거래 이력이
 *   가장 많은 회사라 rankCompanies 의 「이력 있는 회사를 위로」와 정반대로 자른다.
 *
 *   그래서 규칙을 뒤집었다 — **우리 상한을 DB 상한보다 낮게 두지 않는다.**
 *   1000 이하에서는 이 코드가 아무것도 자르지 않는다. 동작이 전과 같다.
 *
 * ★ 비교가 `>=` 인 이유 — 정확히 상한만큼 받았을 때 «딱 1000곳인지» 와
 *   «잘려서 1000곳인지» 를 구분할 수 없다. 구분이 안 되면 «모른다» 고 말한다.
 *   1000곳인 조직이 경고를 한 번 더 보는 쪽이, 잘린 조직이 못 보는 쪽보다 낫다.
 *
 * ★ 아직 못 잡는 것 — 프로젝트 설정의 max-rows 가 1000 «보다 낮으면» 이 판정은
 *   못 알아챈다(DB 가 500 을 주면 500 >= 1000 이 거짓이다). 그걸 확실히 알려면
 *   개수를 따로 세는 질의(count)가 필요하다. #588 후속으로 남긴다.
 *
 * ★ 진짜 처방은 여전히 «서버에서 검색» 이다 — 지금은 초성 검색 때문에 전부 받아
 *   화면에서 거른다. 초성을 SQL 로 하려면 생성 컬럼이 필요해 마이그레이션이 든다.
 */
export const COMPANY_PICKER_LIMIT = 1000;

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
    // `>=` 다: 정확히 상한만큼 받으면 잘렸는지 알 수 없으므로 «모른다» 쪽으로 말한다.
    const truncated = companies.length >= COMPANY_PICKER_LIMIT;
    const bounded = truncated ? companies.slice(0, COMPANY_PICKER_LIMIT) : companies;
    return { rows: buildCompanyPickerRows(bounded, deals), error: null, truncated };
  } catch (error) {
    console.error("[company picker] failed to load", error);
    return { rows: [], error: COMPANY_PICKER_READ_ERROR, truncated: false };
  }
}
