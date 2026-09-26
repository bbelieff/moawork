import type { BoardGroup, ItemWithValues } from "@/lib/boards/types";
import { RestoreAllArchivedButton, RestoreArchivedButton } from "./ItemArchiveControls";

/**
 * 별도 보관 목록 (153 draft) — 휴지통과 독립.
 * 보관해도 회사 원본·신청·원장은 지우지 않으며, 여기서 복구하면 기존 그룹·값·담당자·정렬이 그대로 돌아온다.
 */
export function BoardArchivePanel({
  boardId,
  items,
  groups,
}: {
  boardId: string;
  items: ItemWithValues[];
  groups: BoardGroup[];
}) {
  if (items.length === 0) return null;
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));

  return (
    <details className="rounded-md border border-mw-line bg-mw-card">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-mw-sub [&::-webkit-details-marker]:hidden">
        보관함 <span className="font-semibold text-mw-body">{items.length}</span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-mw-line p-3">
        <p className="text-xs text-mw-sub">
          휴지통과 별도 보관입니다. 복구하면 기존 그룹·값·담당자·정렬 위치가 그대로 돌아옵니다.
        </p>
        <div className="flex justify-end">
          <RestoreAllArchivedButton boardId={boardId} itemIds={items.map((item) => item.id)} />
        </div>
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-lg border border-mw-line px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-mw-fg">{item.title}</p>
                <p className="text-xs text-mw-sub">
                  {item.group_id ? groupNames.get(item.group_id) ?? "삭제된 그룹" : "그룹 없음"}
                </p>
              </div>
              <RestoreArchivedButton boardId={boardId} itemId={item.id} title={item.title} />
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
