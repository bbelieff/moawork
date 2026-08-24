import Link from "next/link";
import { notFound } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { PermissionUnavailable } from "@/components/perm/PermissionUnavailable";
import { getBoardsService } from "@/lib/boards";
import { NewBoardInline } from "./NewBoardInline";
import { reorderBoardsAction } from "./actions";

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
  const [viewPermission, tabPermission] = await Promise.all([
    loadPermGuard(ctx.org.id, "work.view_tabs"),
    loadPermGuard(ctx.org.id, "structure.tab_manage"),
  ]);
  // 판정 «불능» 은 「없음」이 아니다 — 장애를 404 로 접으면 사용자는 보드가 사라진 줄 안다(BBE-204).
  //   이 화면은 자원에 대해 아무것도 말하지 않으므로 존재 숨김은 그대로 유지된다.
  if (viewPermission.kind === "denied" && viewPermission.reason === "unavailable") {
    return <PermissionUnavailable />;
  }
  // Existence hiding: a denied view permission must not reveal board metadata.
  //   권한 없음은 종전 그대로 404 다. 접근 허용 범위는 한 글자도 넓히지 않는다.
  if (viewPermission.kind !== "allowed") notFound();
  const boards = await getBoardsService().listBoards(ctx);
  const canManageTabs = tabPermission.kind === "allowed";

  const system = boards.filter((b) => b.is_system);
  const user = boards.filter((b) => !b.is_system);

  return (
    <div className="flex flex-col gap-6">
      {/* 원칙 3 — 헤더 1줄. 액션(새 보드)은 우상단 분리형 패널이 아니라 아래 목록 안에 있다. */}
      <div>
        <h1 className="text-xl font-semibold">보드</h1>
        <p className="text-sm text-zinc-500">
          시스템 보드와 직접 만든 보드를 한 곳에서. ({ctx.role}/{ctx.scope})
        </p>
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
        <h2 className="text-sm font-medium text-zinc-500">
          내 보드
          {user.length === 0 && (
            // 원칙 5 — 빈 상태는 인라인 한 줄. 실행 지점은 아래 격자의 [＋ 새 보드] 타일이다.
            <span className="ml-2 font-normal text-zinc-400">
              아직 만든 보드가 없습니다. 오른쪽 타일에서 바로 만드세요.
            </span>
          )}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {user.map((b, index) => {
            const move = (offset: -1 | 1) => {
              const ordered = user.map((board) => board.id);
              const target = index + offset;
              if (target < 0 || target >= ordered.length) return ordered;
              [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
              return ordered;
            };
            return (
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
              {canManageTabs && user.length > 1 ? (
                <div className="mt-1 flex justify-end gap-1" aria-label={`${b.name} 순서 이동`}>
                  {([-1, 1] as const).map((offset) => (
                    <form action={reorderBoardsAction} key={offset}>
                      {move(offset).map((id) => <input key={id} type="hidden" name="boardId" value={id} />)}
                      <input type="hidden" name="requestId" value={crypto.randomUUID()} />
                      <button type="submit" disabled={offset === -1 ? index === 0 : index === user.length - 1} aria-label={`${b.name} ${offset === -1 ? "앞으로" : "뒤로"} 이동`} className="min-h-11 min-w-11 rounded border border-mw-line disabled:opacity-30">
                        {offset === -1 ? "↑" : "↓"}
                      </button>
                    </form>
                  ))}
                </div>
              ) : null}
            </li>
          )})}
          {canManageTabs && <li><NewBoardInline /></li>}
        </ul>
      </section>
    </div>
  );
}
