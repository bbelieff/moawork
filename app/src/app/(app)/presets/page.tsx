import Link from "next/link";
import { applyAs, getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import { createClient } from "@/lib/supabase/server";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { SectionPresetRepo, type SectionPresetBoardsRepo } from "@/lib/presets/section-presets";
import {
  applySectionPresetAction,
  createTabAction,
  deleteSectionPresetAction,
  deleteTabAction,
  renameTabAction,
  saveSectionPresetAction,
} from "./actions";

export default async function PresetsPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  // ★ BBE-202 — 개발 빌드 + Supabase 없음에서만 로컬 보드로 읽는다(BBE-203 과 같은 규약).
  //   조건을 인라인으로 적어야 경계 검사기(isInsideExplicitDevGuard)가 «운영 그래프 아님» 으로 읽는다.
  //   운영에서는 종전과 한 글자도 다르지 않다 — env 가 없으면 createClient() 가 그대로 던진다.
  //   반환 타입 BoardsRepo 에는 listSectionPresetBoards 가 «선언» 돼 있지 않지만 두 구현
  //   (LocalBoardsRepo:57 · SupabaseBoardsRepo:49) 모두 갖고 있고 toAsyncBoardsRepo 프록시가 그대로 넘긴다.
  //   포트 타입을 넓히는 건 이 카드 범위 밖이라, 좁혀 받되 «정말 있는지» 를 확인하고 받는다.
  let boardsRepo: SectionPresetBoardsRepo;
  if (process.env.NODE_ENV !== "production" && canUseLocalSeedFallback()) {
    const local = await getBoardsRepo();
    if (typeof (local as Partial<SectionPresetBoardsRepo>).listSectionPresetBoards !== "function") {
      throw new Error("로컬 보드 저장소가 listSectionPresetBoards 를 제공하지 않습니다");
    }
    boardsRepo = local as SectionPresetBoardsRepo;
  } else {
    boardsRepo = new SupabaseBoardsRepo(await createClient());
  }
  const presetRepo = new SectionPresetRepo(boardsRepo);
  const [boards, presets, tabPermission, presetPermission] = await Promise.all([
    boardsRepo.listBoards(ctx),
    presetRepo.list(ctx),
    loadPermGuard(ctx.org.id, "structure.tab_manage"),
    loadPermGuard(ctx.org.id, "structure.preset_edit"),
  ]);
  const canManageTabs = tabPermission.kind === "allowed";
  const canEditPresets = presetPermission.kind === "allowed";

  return (
    <main className="flex flex-col gap-6" data-testid="preset-library">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mw-primary">회사 구조 관리</p>
          <h1 className="mt-1 text-xl font-semibold text-mw-fg">탭과 아이템 프리셋</h1>
          <p className="mt-1 text-sm text-mw-sub">
            탭은 회사가 직접 만들고 고치며 마지막 하나까지 지울 수 있어요. 아이템(그룹) 구조는 저장해 다른 탭에서 다시 씁니다.
          </p>
        </div>
        <span className="rounded-full border border-mw-line bg-mw-card px-3 py-1 text-xs text-mw-sub">
          탭 {boards.length} · 아이템 프리셋 {presets.length}
        </span>
      </header>

      <section className="rounded-xl border border-mw-line bg-mw-card p-4" aria-labelledby="tabs-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="tabs-heading" className="font-semibold text-mw-fg">우리 회사 탭</h2>
            <p className="text-sm text-mw-sub">목업 구조는 처음 시작할 때의 기본값이며, 이후 구조는 회사가 소유합니다.</p>
          </div>
          {canManageTabs && (
            <form action={createTabAction} className="flex gap-2">
              <input name="name" required placeholder="새 탭 이름" className="min-w-0 rounded-lg border border-mw-line bg-mw-bg px-3 py-2 text-sm text-mw-fg" />
              <button className="rounded-lg bg-mw-primary px-3 py-2 text-sm font-semibold text-white">+ 탭 만들기</button>
            </form>
          )}
        </div>

        {boards.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-mw-line p-8 text-center" data-testid="zero-tabs">
            <p className="font-medium text-mw-fg">아직 탭이 없어요</p>
            <p className="mt-1 text-sm text-mw-sub">빈 회사도 정상 상태입니다. 위의 + 탭 만들기로 첫 탭을 시작하세요.</p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {boards.map((board) => (
              <li key={board.id} className="rounded-lg border border-mw-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link href={`/boards/${board.id}`} className="font-semibold text-mw-fg underline-offset-4 hover:underline">
                      {board.icon || "▦"} {board.name}
                    </Link>
                    <p className="mt-1 text-xs text-mw-sub">탭을 열어 컬럼·아이템·보기 구조를 수정할 수 있어요.</p>
                  </div>
                  {canManageTabs && (
                    <form action={deleteTabAction}>
                      <input type="hidden" name="boardId" value={board.id} />
                      <button className="text-xs font-medium text-red-600">삭제</button>
                    </form>
                  )}
                </div>
                {canManageTabs && (
                  <form action={renameTabAction} className="mt-3 flex gap-2">
                    <input type="hidden" name="boardId" value={board.id} />
                    <input name="name" defaultValue={board.name} required className="min-w-0 flex-1 rounded border border-mw-line bg-mw-bg px-2 py-1.5 text-sm text-mw-fg" />
                    <button className="rounded border border-mw-line px-2 py-1.5 text-xs text-mw-fg">이름 저장</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-mw-line bg-mw-card p-4" aria-labelledby="presets-heading">
        <h2 id="presets-heading" className="font-semibold text-mw-fg">아이템 프리셋 · 구조 묶음</h2>
        <p className="text-sm text-mw-sub">한 탭의 아이템(그룹)과 컬럼 구조를 저장하고 다른 탭에 재사용합니다. 별도의 ‘설치’ 단계는 없습니다.</p>

        {canEditPresets && boards.length > 0 && (
          <form action={saveSectionPresetAction} className="mt-4 grid gap-2 rounded-lg bg-mw-bg p-3 md:grid-cols-[1fr_1fr_auto]">
            <input name="name" required placeholder="프리셋 이름" className="rounded border border-mw-line bg-mw-card px-3 py-2 text-sm text-mw-fg" />
            <select name="boardId" required className="rounded border border-mw-line bg-mw-card px-3 py-2 text-sm text-mw-fg">
              <option value="">구조를 가져올 탭</option>
              {boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
            </select>
            <button className="rounded bg-mw-primary px-3 py-2 text-sm font-semibold text-white">구조 저장</button>
          </form>
        )}

        {presets.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-mw-line p-6 text-center" data-testid="zero-presets">
            <p className="font-medium text-mw-fg">저장한 아이템 프리셋이 없어요</p>
            <p className="mt-1 text-sm text-mw-sub">업무에 맞게 고친 탭 구조를 저장하면 여기에 모입니다.</p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {presets.map((preset) => (
              <li key={preset.id} className="rounded-lg border border-mw-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div><strong className="text-sm text-mw-fg">{preset.name}</strong><p className="text-xs text-mw-sub">그룹 {preset.groups.length} · 컬럼 {preset.columns.length}</p></div>
                  {canEditPresets && <form action={deleteSectionPresetAction}><input type="hidden" name="presetId" value={preset.id} /><button className="text-xs text-red-600">삭제</button></form>}
                </div>
                {canEditPresets && boards.length > 0 && (
                  <form action={applySectionPresetAction} className="mt-3 flex gap-2">
                    <input type="hidden" name="presetId" value={preset.id} />
                    <select name="boardId" required className="min-w-0 flex-1 rounded border border-mw-line bg-mw-bg px-2 py-1.5 text-sm text-mw-fg">
                      <option value="">재사용할 탭</option>
                      {boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
                    </select>
                    <button className="rounded border border-mw-line px-2 py-1.5 text-xs font-medium text-mw-fg">이 탭에 추가</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
