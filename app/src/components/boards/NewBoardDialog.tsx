import { createBoardAction } from "@/app/(app)/boards/actions";

/**
 * 새 보드 생성 (T02b). <details> 디스클로저 + 서버 액션 폼 — 클라이언트 JS 불필요.
 */
export function NewBoardDialog() {
  return (
    <details className="rounded border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
        + 새 보드
      </summary>
      <form action={createBoardAction} className="flex flex-wrap items-end gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-500">보드 이름</span>
          <input
            name="name"
            required
            maxLength={100}
            placeholder="예: 채용 관리"
            className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-500">아이콘(선택)</span>
          <input
            name="icon"
            maxLength={4}
            placeholder="📋"
            className="w-16 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
          <span className="text-zinc-500">설명(선택)</span>
          <input
            name="description"
            className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          만들기
        </button>
      </form>
      <p className="px-3 pb-3 text-xs text-zinc-500">
        기본 컬럼(상태·담당·마감일)이 함께 생성됩니다. 이후 컬럼을 자유롭게 추가하세요.
      </p>
    </details>
  );
}
