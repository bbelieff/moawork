import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { formatCell } from "@/lib/boards/cells";
import {
  addItemAction,
  deleteItemAction,
  renameItemAction,
  setCellAction,
} from "@/app/(app)/boards/actions";

/**
 * 범용 보드 테이블 (T02b) — 컬럼=board_columns, 셀=item_values 인라인 편집.
 * 클라이언트 JS 없이 셀 단위 서버 액션 폼으로 편집한다(새로고침 후에도 유지).
 */

const INPUT =
  "w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-zinc-300 focus:border-zinc-400 focus:outline-none dark:hover:border-zinc-700";

/** 컬럼 타입별 편집 입력. 각 셀이 독립 폼 → Enter 로 저장. */
function CellField({
  boardId,
  item,
  column,
}: {
  boardId: string;
  item: ItemWithValues;
  column: BoardColumn;
}) {
  const value = item.values[column.key] ?? null;
  const options = column.options_jsonb?.options ?? [];

  return (
    <form action={setCellAction} className="flex items-center gap-1">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="columnKey" value={column.key} />

      {column.type === "checkbox" ? (
        <>
          <input type="hidden" name="kind" value="checkbox" />
          <input
            type="checkbox"
            name="value"
            defaultChecked={value === true}
            className="h-4 w-4"
          />
          <button type="submit" className="text-xs text-zinc-400 hover:text-zinc-700">
            저장
          </button>
        </>
      ) : column.type === "select" ? (
        <>
          <select
            name="value"
            defaultValue={typeof value === "string" ? value : ""}
            className={INPUT}
          >
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="submit" className="text-xs text-zinc-400 hover:text-zinc-700">
            ↵
          </button>
        </>
      ) : column.type === "multiselect" ? (
        <>
          <select
            name="value"
            multiple
            defaultValue={Array.isArray(value) ? value : []}
            className={`${INPUT} h-16`}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="submit" className="text-xs text-zinc-400 hover:text-zinc-700">
            ↵
          </button>
        </>
      ) : (
        <input
          type={
            column.type === "number"
              ? "number"
              : column.type === "date"
                ? "date"
                : column.type === "datetime"
                  ? "datetime-local"
                  : column.type === "email"
                    ? "email"
                    : column.type === "url"
                      ? "url"
                      : "text"
          }
          name="value"
          defaultValue={value === null ? "" : String(value)}
          placeholder={formatCell(column.type, value, options) || "—"}
          className={INPUT}
        />
      )}
    </form>
  );
}

export function GenericBoardTable({
  boardId,
  columns,
  items,
  groups,
  readOnly = false,
}: {
  boardId: string;
  columns: BoardColumn[];
  items: ItemWithValues[];
  groups: { id: string; name: string }[];
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium">항목</th>
              {columns.map((c) => (
                <th key={c.id} className="px-3 py-2 text-left font-medium">
                  <span>{c.label}</span>
                  <span className="ml-1 text-xs font-normal text-zinc-400">{c.type}</span>
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium">담당</th>
              {!readOnly && <th className="w-10 px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 3}
                  className="px-3 py-6 text-center text-sm text-zinc-500"
                >
                  아직 아이템이 없습니다. 아래에서 추가하세요.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-3 py-1.5">
                    {readOnly ? (
                      it.title
                    ) : (
                      <form action={renameItemAction}>
                        <input type="hidden" name="boardId" value={boardId} />
                        <input type="hidden" name="itemId" value={it.id} />
                        <input name="title" defaultValue={it.title} className={INPUT} />
                      </form>
                    )}
                  </td>
                  {columns.map((c) => (
                    <td key={c.id} className="px-3 py-1.5">
                      {readOnly ? (
                        formatCell(c.type, it.values[c.key] ?? null, c.options_jsonb?.options)
                      ) : (
                        <CellField boardId={boardId} item={it} column={c} />
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-xs text-zinc-500">
                    {it.assigned_to ? it.assigned_to.slice(0, 8) : "—"}
                  </td>
                  {!readOnly && (
                    <td className="px-2 py-1.5">
                      <form action={deleteItemAction}>
                        <input type="hidden" name="boardId" value={boardId} />
                        <input type="hidden" name="itemId" value={it.id} />
                        <button
                          type="submit"
                          className="text-xs text-zinc-400 hover:text-red-600"
                          aria-label="아이템 삭제"
                        >
                          ✕
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <form action={addItemAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="boardId" value={boardId} />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-zinc-500">새 아이템</span>
            <input
              name="title"
              required
              placeholder="할 일 제목"
              className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          {groups.length > 0 && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-zinc-500">그룹</span>
              <select
                name="groupId"
                className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">미지정</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="submit"
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            추가
          </button>
        </form>
      )}
    </div>
  );
}
