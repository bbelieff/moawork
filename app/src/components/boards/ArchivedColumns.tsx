import { getSession } from "@/lib/auth/session";
import { createRequestBoards } from "@/lib/boards/server";
import { restoreColumnAction } from "@/app/(app)/boards/column-restore-actions";

export async function ArchivedColumns({ boardId }: { boardId: string }) {
  const ctx = await getSession();
  const { service } = await createRequestBoards();
  const columns = await service.listArchivedColumns(ctx, boardId);
  if (columns.length === 0) return null;

  return (
    <section aria-labelledby="archived-columns-title" className="rounded border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <h3 id="archived-columns-title" className="text-xs font-semibold">보관된 컬럼</h3>
      <p className="mt-1 text-xs text-zinc-500">
        원본을 복구하면 이전 값이 다시 보입니다. 같은 이름으로 새 컬럼을 만들면 빈 컬럼으로 시작합니다.
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {columns.map((column) => (
          <li key={column.id} className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800">
            <span>{column.label}</span>
            <form action={restoreColumnAction.bind(null, boardId)}>
              <input type="hidden" name="columnId" value={column.id} />
              <button type="submit" className="font-medium text-mw-primary hover:underline">원본 복구</button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
