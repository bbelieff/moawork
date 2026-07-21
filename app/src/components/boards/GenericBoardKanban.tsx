import type { ItemWithValues } from "@/lib/boards/types";
import { moveItemAction } from "@/app/(app)/boards/actions";

/**
 * 범용 보드 칸반 (T02b) — 레인 = board_groups 또는 select 컬럼 옵션.
 * 이동은 레인 선택 폼(서버 액션). dnd-kit 드래그는 후속 증분 —
 * 데이터 경로(moveItemAction)는 동일하므로 드래그 핸들러만 얹으면 된다.
 */
export interface KanbanLane {
  key: string;
  label: string;
  color: string | null;
  items: ItemWithValues[];
}

export function GenericBoardKanban({
  boardId,
  lanes,
  groupBy,
  readOnly = false,
}: {
  boardId: string;
  lanes: KanbanLane[];
  /** select 컬럼 key 로 그룹핑 중이면 그 key, 아니면 빈 문자열(=board_groups). */
  groupBy: string;
  readOnly?: boolean;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {lanes.map((lane) => (
        <section
          key={lane.key || "__none__"}
          className="flex w-64 shrink-0 flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <header className="flex items-center gap-2 px-1">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: lane.color ?? "#c4c4c4" }}
              aria-hidden
            />
            <h3 className="text-sm font-medium">{lane.label}</h3>
            <span className="ml-auto text-xs text-zinc-400">{lane.items.length}</span>
          </header>

          <ul className="flex flex-col gap-2">
            {lane.items.map((it) => (
              <li
                key={it.id}
                className="rounded border border-zinc-200 bg-white p-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <p className="font-medium">{it.title}</p>
                {it.assigned_to && (
                  <p className="mt-1 text-xs text-zinc-500">
                    담당 {it.assigned_to.slice(0, 8)}
                  </p>
                )}
                {!readOnly && lanes.length > 1 && (
                  <form action={moveItemAction} className="mt-2 flex items-center gap-1">
                    <input type="hidden" name="boardId" value={boardId} />
                    <input type="hidden" name="itemId" value={it.id} />
                    <input type="hidden" name="groupBy" value={groupBy} />
                    <select
                      name="lane"
                      defaultValue={lane.key}
                      className="flex-1 rounded border border-zinc-300 px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      aria-label="레인 이동"
                    >
                      {lanes.map((l) => (
                        <option key={l.key || "__none__"} value={l.key}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      이동
                    </button>
                  </form>
                )}
              </li>
            ))}
            {lane.items.length === 0 && (
              <li className="rounded border border-dashed border-zinc-300 p-3 text-center text-xs text-zinc-400 dark:border-zinc-700">
                비어 있음
              </li>
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
