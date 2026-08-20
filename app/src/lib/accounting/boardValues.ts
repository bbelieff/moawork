/**
 * 정산 리포트의 «보드 쪽» 값 — 진행기관 · 상품명칭 · 세부명칭.
 *
 * 이 셋은 원장(deal_ledger_entries)에 없다. 계약업체 실무 보드의 셀(item_values)에 있고,
 * 딜과는 `items.deal_id`(087_new_lead_canonical.sql:14) 로 이어진다.
 *
 * ★ 이 모듈은 **절대 throw 하지 않는다.** 리포트의 본문은 원장이고 이 셋은 «장식» 이다.
 * 여기서 던지면 YearlyLedgerReadError 로 승격되어 «상품명 하나 없다»는 이유로 원장 화면
 * 전체가 「원장을 불러오지 못했어요」 로 바뀐다(ledger/page.tsx). 그래서 어떤 실패든
 * 빈 Map 으로 수렴시키고, 화면은 그 칸만 빈 채로 그린다.
 *
 * 빈 칸이 되는 «정상» 경로들 — 어느 것도 오류가 아니다:
 *  · 회사가 계약업체 실무 탭 자체를 지웠다(D77 이 허용한다) → boards 0행.
 *  · 그 딜이 업무관리로 이동한 적이 없다(099 트리거 미발화) 또는 행이 휴지통에 있다
 *    (084_board_item_trash.sql) → items 에 짝이 없다.
 *  · RLS 비대칭 — 원장은 `deals.assigned_to`(035:28-50), 셀 값은 `items.assigned_to`
 *    (061_board_rls_visibility.sql:162-183) 로 갈린다. 099:94-102 는 투영 «시점» 에만
 *    복사하므로 이후 담당자 변경은 따라가지 않는다. assignee 범위 멤버는 원장 줄은 보되
 *    상품명은 못 볼 수 있다 → 빈 칸. (덜 보여주는 쪽으로 닫히므로 안전하다.)
 *  ⇒ 그래서 **빈 칸 ≠ 「데이터 없음」** 이다. 「데이터 없음」 같은 단정 문구를 넣지 마라.
 *
 * 컬럼을 회사가 **이름만 바꾼 경우**(068:135 rename_column)는 key 가 그대로라 값이 계속
 * 나온다 — key 를 얼려둔 결정의 대가다. 컬럼을 **지운 경우**는 `board_columns` 행만 사라지고
 * `item_values` 는 남으므로(boardsRepo.deleteColumn, BBE-177) 여기서는 **계속 보인다**.
 * 의도된 선택이다: 지난 리포트를 다시 뽑아도 같은 수가 나온다.
 */

import { createClient } from "@/lib/supabase/server";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import type { Ctx } from "@/lib/types";

/**
 * 읽는 key 셋. **라벨이 아니라 key 다.**
 * `fund_name` → 「상품명칭」, `product` → 「세부명칭」 (2026-08-20 라벨 재편, key 는 동결).
 */
export const LEDGER_BOARD_VALUE_KEYS = ["institution", "fund_name", "product"] as const;

export interface ContractWorkDealValues {
  institution: string | null;
  fundName: string | null;
  productName: string | null;
}

export const EMPTY_CONTRACT_WORK_VALUES: ContractWorkDealValues = {
  institution: null,
  fundName: null,
  productName: null,
};

/** jsonb 문자열만 값으로 인정한다 — 098:142-147 의 `#>> '{}'` 와 같은 뜻. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 딜 id → 보드 값. 셋 다 **평평한 조회 3번**이다.
 *
 * ⚠ PostgREST 임베드(`items(...)`, `item_values(...)`)를 일부러 안 쓴다. `items` 는
 * `boards` 로 가는 FK 가 둘(003:50 단일 + 087:20-21 복합), `item_values` → `items` 도
 * 둘(003:66 + 087:30-31)이라 관계가 모호해 PGRST201 로 실패한다. 이 저장소에 그 문법을
 * 굴린 전례가 없다(boardsRepo 는 전부 평평한 조회다).
 */
export async function loadContractWorkDealValues(ctx: Ctx): Promise<Map<string, ContractWorkDealValues>> {
  const empty = new Map<string, ContractWorkDealValues>();
  try {
    const client = await createClient();

    // ① 보드. 0행(탭을 지웠다)이거나 2행 이상(충돌)이면 더 캐지 않는다.
    const boards = await client
      .from("boards")
      .select("id")
      .eq("org_id", ctx.org.id)
      .eq("source", CONTRACT_WORK_TAB_SOURCE);
    if (boards.error || !Array.isArray(boards.data) || boards.data.length !== 1) return empty;
    const boardId = (boards.data[0] as { id?: unknown }).id;
    if (typeof boardId !== "string" || boardId.length === 0) return empty;

    // ② 살아 있는 행 중 딜에 붙은 것. items_active_deal_projection_uq(087:33-35) 덕분에
    //    딜 하나에 살아 있는 행은 최대 하나라서 Map 이 덮어써질 걱정이 없다.
    const items = await client
      .from("items")
      .select("id,deal_id")
      .eq("org_id", ctx.org.id)
      .eq("board_id", boardId)
      .is("deleted_at", null)
      .not("deal_id", "is", null);
    if (items.error || !Array.isArray(items.data)) return empty;

    const dealByItem = new Map<string, string>();
    for (const raw of items.data as { id?: unknown; deal_id?: unknown }[]) {
      if (typeof raw.id === "string" && typeof raw.deal_id === "string") dealByItem.set(raw.id, raw.deal_id);
    }
    if (dealByItem.size === 0) return empty;

    // ③ 셀 값. item_id 목록으로 걸지 않고 column_key 로 거른 뒤 메모리에서 교집합을 잡는다 —
    //    행 많은 조직에서 `in(item_id, [...])` 는 요청 URL 을 터뜨린다. 남는 행은 무해하다.
    const values = await client
      .from("item_values")
      .select("item_id,column_key,value_jsonb")
      .eq("org_id", ctx.org.id)
      .in("column_key", [...LEDGER_BOARD_VALUE_KEYS]);
    if (values.error || !Array.isArray(values.data)) return empty;

    const byDeal = new Map<string, ContractWorkDealValues>();
    for (const raw of values.data as { item_id?: unknown; column_key?: unknown; value_jsonb?: unknown }[]) {
      if (typeof raw.item_id !== "string") continue;
      const dealId = dealByItem.get(raw.item_id);
      if (!dealId) continue;
      const current = byDeal.get(dealId) ?? { ...EMPTY_CONTRACT_WORK_VALUES };
      const value = text(raw.value_jsonb);
      if (raw.column_key === "institution") current.institution = value;
      else if (raw.column_key === "fund_name") current.fundName = value;
      else if (raw.column_key === "product") current.productName = value;
      byDeal.set(dealId, current);
    }
    return byDeal;
  } catch {
    return empty;
  }
}
