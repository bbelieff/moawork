import Link from "next/link";
import { applyAs, getSession } from "@/lib/auth/session";
import { getBoardsService } from "@/lib/boards";
import { NewBoardDialog } from "@/components/boards/NewBoardDialog";

/**
 * 보드 목록 (T02b · ADR-0003).
 * 화면 통합: 시스템 보드(정책자금 파이프라인 = 001 deals) + 사용자가 만든 임의 보드(003).
 * 데이터 저장소는 둘로 분리되지만 UX 는 하나의 보드 목록.
 */
export default async function BoardsPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const boards = getBoardsService().listBoards(ctx);

  const system = boards.filter((b) => b.is_system);
  const user = boards.filter((b) => !b.is_system);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">보드</h1>
          <p className="text-sm text-zinc-500">
            시스템 보드와 직접 만든 보드를 한 곳에서. ({ctx.role}/{ctx.scope})
          </p>
        </div>
        <NewBoardDialog />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">시스템 보드</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {system.map((b) => (
            <li key={b.id}>
              {/* 정책자금 파이프라인은 typed 코어(deals) 화면으로 연결 — 회귀 0 */}
              <Link
                href="/"
                className="flex h-full flex-col gap-1 rounded border border-zinc-200 p-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <span className="text-sm font-medium">
                  {b.icon} {b.name}
                </span>
                <span className="text-xs text-zinc-500">{b.description}</span>
                <span className="mt-auto pt-2 text-xs text-zinc-400">
                  시스템 보드 · 정산 수식 포함
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">내 보드</h2>
        {user.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            아직 만든 보드가 없습니다. [+ 새 보드]로 시작하세요.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {user.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/boards/${b.id}`}
                  className="flex h-full flex-col gap-1 rounded border border-zinc-200 p-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <span className="text-sm font-medium">
                    {b.icon} {b.name}
                  </span>
                  <span className="text-xs text-zinc-500">{b.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
