import Link from "next/link";
import { cookies } from "next/headers";
import { applyAs, getSession } from "@/lib/auth/session";
import { isManager } from "@/lib/auth/roles";
import { loadPermGuard } from "@/lib/perm/guard";
import { getBoardsService } from "@/lib/boards";
import { SEOUL_STRUCTURE_PACK } from "@/lib/structure-packs";
import { NewBoardInline } from "./NewBoardInline";
import { InstallPackButton } from "./InstallPackButton";
import { PACK_INSTALL_FLASH_COOKIE, decodePackInstallFlash } from "./installFlash";

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
  const [tabPermission, presetPermission] = await Promise.all([
    loadPermGuard(ctx.org.id, "structure.tab_manage"),
    loadPermGuard(ctx.org.id, "structure.preset_edit"),
  ]);
  const canManageTabs = tabPermission.kind === "allowed";
  const canEditPresets = presetPermission.kind === "allowed";

  const system = boards.filter((b) => b.is_system);
  const user = boards.filter((b) => !b.is_system);

  // 구조 팩(모아프리셋-정책자금1) 설치 여부 — 3보드 이름이 전부 있어야 설치된 것으로 본다.
  const packInstalled = SEOUL_STRUCTURE_PACK.boards.every((packBoard) =>
    boards.some((b) => b.name === packBoard.name),
  );
  const canInstall = isManager(ctx.role) && canEditPresets;
  const installFlash = decodePackInstallFlash(
    (await cookies()).get(PACK_INSTALL_FLASH_COOKIE)?.value,
  );

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
          {canInstall && !packInstalled && <InstallPackButton flash={installFlash} />}
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
          {canManageTabs && <li><NewBoardInline /></li>}
        </ul>
      </section>
    </div>
  );
}
