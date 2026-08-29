import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";

/**
 * #640 — 보고 «예외» 지정을 읽는다. 013 의 member_hierarchy_assignments 다.
 *
 * ★ 이 표는 지금까지 «쓰기 전용» 이었다.
 *   reporting.ts 가 「지금까지 아무도 읽지 않던 쓰기 전용 경로」라고 적어 두었고,
 *   실제로 app/src 어디에도 이 표를 select 하는 코드가 없었다. 여기가 첫 읽기다.
 *   읽기 정책·grant 는 050 → 076 에 이미 있다(재작성됨). 새 마이그레이션이 필요 없다.
 *
 * ★ «예외 0건» 과 «못 읽음» 을 다른 값으로 돌려준다.
 *   빈 Map 을 실패에도 돌려주면 화면이 예외 없는 보고선을 «확인된 사실» 처럼 그린다.
 *   그건 틀린 이름을 단언하는 것이다. 못 읽었으면 null 이고, 화면이 그렇게 말한다.
 */
export async function loadReportingExceptions(
  ctx: Ctx,
  clientFactory: () => Promise<SupabaseClient>,
): Promise<Map<string, string | null> | null> {
  try {
    const client = await clientFactory();
    const { data, error } = await client
      .from("member_hierarchy_assignments")
      .select("member_user_id,reports_to_user_id")
      .eq("org_id", ctx.org.id);
    if (error) return null;

    const out = new Map<string, string | null>();
    for (const row of (data ?? []) as { member_user_id: string; reports_to_user_id: string | null }[]) {
      out.set(row.member_user_id, row.reports_to_user_id);
    }
    return out;
  } catch {
    return null;
  }
}
