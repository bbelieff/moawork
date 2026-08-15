import type { Board } from "@/lib/boards/types";
import type { BoardsRepo } from "@/lib/boards/store";
import { calculateFields } from "@/lib/boards/calculations";
import { NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";
import type { Ctx } from "@/lib/types";

export const NOTICE_READER_VALUE_KEY = "__notice_reader_ids";

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Persist a deduplicated reader identity and refresh BBE-153's read_count.
 * The internal EAV key deliberately has no board column, so the product still
 * exposes exactly the mockup's ten columns while retaining the reader set.
 */
export async function markNoticeBoardRead(ctx: Ctx, board: Board, repo: BoardsRepo): Promise<void> {
  if (board.source !== NOTICE_TAB_SOURCE) return;
  const items = await repo.listItems(ctx, board.id);
  const values = await repo.listValues(ctx, items.map((item) => item.id));
  for (const item of items) {
    const own = values.filter((value) => value.item_id === item.id);
    const targets = ids(own.find((value) => value.column_key === "audience")?.value_jsonb);
    if (!targets.includes(ctx.user.id)) continue;
    const readers = new Set(ids(own.find((value) => value.column_key === NOTICE_READER_VALUE_KEY)?.value_jsonb));
    readers.add(ctx.user.id);
    const readerIds = [...readers];
    await repo.setValues(ctx, item.id, {
      [NOTICE_READER_VALUE_KEY]: readerIds,
      read_count: calculateFields({ targetIds: targets, readerIds }).values.read_count,
    });
  }
}
