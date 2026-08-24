import { createBoardAction } from "./actions";

/**
 * 새 보드 생성 — 인라인 타일 (ui-guidelines 원칙 3).
 *
 * 이전 `NewBoardDialog` 는 화면 우상단에 떠 있는 분리형 패널이었다. 원칙 3 이 그 형태를
 * 금지한다("액션은 콘텐츠 흐름 안에 둔다") — 그래서 보드 카드와 같은 격자 안의 타일로 옮겼다.
 * 목록이 비어 있을 때도 이 타일이 그 자리에 있어 빈 상태가 곧 실행 지점이 된다(원칙 5).
 *
 * 서버 컴포넌트 + `<details>` + 서버 액션 — 클라이언트 JS 불필요(기존 방식 유지).
 */
export function NewBoardInline() {
  return (
    <details className="group h-full rounded border border-dashed border-zinc-300 open:border-solid open:border-zinc-400 dark:border-zinc-700 dark:open:border-zinc-500">
      <summary className="flex cursor-pointer select-none items-center gap-2 p-3 text-sm font-medium text-zinc-600 group-open:border-b group-open:border-zinc-200 dark:text-zinc-300 dark:group-open:border-zinc-800">
        <span aria-hidden="true">＋</span>새 보드
      </summary>

      <form action={createBoardAction} className="flex flex-col gap-2 p-3">
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
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

        <div className="flex gap-2">
          <label className="flex w-20 flex-col gap-1 text-xs">
            <span className="text-zinc-500">아이콘</span>
            <input
              name="icon"
              maxLength={4}
              placeholder="📋"
              className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs">
            <span className="text-zinc-500">설명(선택)</span>
            <input
              name="description"
              className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

        <button
          type="submit"
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          만들기
        </button>
        <p className="text-xs text-zinc-500">
          기본 컬럼(상태·담당·마감일)이 함께 생성됩니다.
        </p>
      </form>
    </details>
  );
}
