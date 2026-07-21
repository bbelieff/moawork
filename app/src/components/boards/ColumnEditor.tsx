import { FIELD_TYPES } from "@/lib/types";
import type { BoardColumn } from "@/lib/boards/types";
import { addColumnAction, deleteColumnAction } from "@/app/(app)/boards/actions";

/**
 * 컬럼 추가/삭제 (T02b) — 001 field_type 13종 + select/multiselect 선택지.
 * 선택지는 콤마 구분 입력(라벨) → 안정 id 로 저장(라벨 바꿔도 값 유지).
 */
export function ColumnEditor({
  boardId,
  columns,
}: {
  boardId: string;
  columns: BoardColumn[];
}) {
  return (
    <details className="rounded border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
        컬럼 관리 ({columns.length})
      </summary>

      <div className="flex flex-col gap-3 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <form action={addColumnAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="boardId" value={boardId} />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-zinc-500">컬럼 이름</span>
            <input
              name="label"
              required
              maxLength={100}
              placeholder="예: 우선순위"
              className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-zinc-500">타입</span>
            <select
              name="type"
              defaultValue="text"
              className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs">
            <span className="text-zinc-500">선택지 (select·multiselect 전용, 콤마 구분)</span>
            <input
              name="options"
              placeholder="높음, 보통, 낮음"
              className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            컬럼 추가
          </button>
        </form>

        <ul className="flex flex-wrap gap-2">
          {columns.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800"
            >
              <span className="font-medium">{c.label}</span>
              <span className="text-zinc-400">{c.type}</span>
              {c.options_jsonb && (
                <span className="text-zinc-400">
                  ({c.options_jsonb.options.length}개 선택지)
                </span>
              )}
              <form action={deleteColumnAction}>
                <input type="hidden" name="boardId" value={boardId} />
                <input type="hidden" name="columnId" value={c.id} />
                <button
                  type="submit"
                  className="text-zinc-400 hover:text-red-600"
                  aria-label={`${c.label} 컬럼 삭제`}
                >
                  ✕
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
