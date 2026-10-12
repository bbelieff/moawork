import { loadPermGuard } from "@/lib/perm/guard";
import type { Ctx } from "@/lib/types";

/**
 * QA #883 (belie 결정 2026-10-12) — 자기가 맡은 행은 «항목 삭제» 권한이 없어도 휴지통에 넣고 되살릴 수 있다.
 *
 * 본인 담당 직원이 실수로 등록한 리드를 지울 길이 없었다. 휴지통은 되살릴 수 있어 잃는 것이 없다.
 * 조건: 항목 추가·수정 권한이 있고, 그 행의 담당자가 본인이다. 남의 행은 예전처럼 «항목 삭제» 권한이 필요하다.
 * 휴지통에 든 행도 읽어야 해서(되살리기) 담당자만 직접 읽는다. 못 읽으면 false(모르면 닫는다).
 */
export async function canTrashOwnRow(
  ctx: Ctx,
  readAssignee: (itemId: string) => Promise<string | null | undefined>,
  itemId: string,
): Promise<boolean> {
  try {
    const upsert = await loadPermGuard(ctx.org.id, "work.item_upsert");
    if (upsert.kind !== "allowed") return false;
    const assignee = await readAssignee(itemId);
    return typeof assignee === "string" && assignee === ctx.user.id;
  } catch {
    return false;
  }
}
