import { FIELD_TYPES } from "@/lib/types";
import type { BoardColumn } from "@/lib/boards/types";
import { addColumnAction, deleteColumnAction } from "@/app/(app)/boards/actions";
import { COLUMN_DELETE_CONFIRM } from "@/lib/boards/validation";

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
              {/* 삭제는 확인을 거친다 — 무엇이 사라지는지 먼저 말한다(BBE-177).
                  details/summary 라서 JS 없이 동작하고 서버 컴포넌트 그대로 쓸 수 있다.
                  진짜 관문은 아래 hidden confirm 이다 — 서버가 그것을 검사한다. */}
              <details className="relative">
                <summary
                  className="cursor-pointer list-none text-zinc-400 hover:text-red-600"
                  aria-label={`${c.label} 컬럼 삭제`}
                >
                  ✕
                </summary>
                <div className="absolute right-0 z-10 mt-1 w-64 rounded border border-zinc-200 bg-white p-3 text-left shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">
                    「{c.label}」 컬럼을 삭제할까요?
                  </p>
                  <p className="mt-1 text-zinc-500">
                    표에서 이 열이 사라집니다. 이미 입력한 값 자체는 지워지지 않습니다.
                  </p>
                  <form action={deleteColumnAction} className="mt-2">
                    <input type="hidden" name="boardId" value={boardId} />
                    <input type="hidden" name="columnId" value={c.id} />
                    <input type="hidden" name="confirm" value={COLUMN_DELETE_CONFIRM} />
                    <button
                      type="submit"
                      className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-700"
                    >
                      삭제
                    </button>
                  </form>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
