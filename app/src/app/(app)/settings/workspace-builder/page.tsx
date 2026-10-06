import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { BuilderWorkspaceSurface } from "@/components/workspace-builder/BuilderWorkspaceSurface";
import { WorkflowManagementSurface, type WorkflowManagementTab } from "@/components/workspace-builder/WorkflowManagementSurface";
import { TabTrashSurface, type TabTrashParams } from "@/components/workspace-builder/TabTrashSurface";
import { loadOwnerWorkspaceOpsSnapshot } from "@/lib/dynamic-workspace/workspace-ops";
import { createRequestBoards } from "@/lib/boards/server";
import { BOARD_ITEM_FILES_BUCKET } from "@/lib/notices/official-file";
import type { Ctx } from "@/lib/types";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { DEFAULT_TABS } from "@/lib/default-tabs/install";

const SECTIONS = [
  { key: "migration", label: "마이그레이션" },
  { key: "workflow", label: "워크플로 관리" },
  { key: "tabs", label: "탭 목록·휴지통" },
] as const;
type Section = (typeof SECTIONS)[number]["key"];

type BoardsRuntime = Awaited<ReturnType<typeof createRequestBoards>>;

/**
 * 완전 삭제된 탭의 저장소 파일을 지운다(최선 노력). remove 가 성공하면 이번 묶음은 모두 끝난 것
 * — 큐 경로는 169 정책으로 보이고 지울 수 있으니, 돌아오지 않은 경로는 원래 없던 파일
 * (올리다 만 예약 등)이다. 그래서 묶음 전체를 큐에서 뺀다. 실패하면 그대로 두고 다음에 다시 시도한다.
 */
async function drainBoardStoragePurgeQueue(ctx: Ctx, { client, repo }: BoardsRuntime): Promise<void> {
  if (!client) return;
  try {
    const paths = await repo.listStoragePurgeQueue(ctx, 100);
    if (paths.length === 0) return;
    const { error } = await client.storage.from(BOARD_ITEM_FILES_BUCKET).remove(paths);
    if (error) throw error;
    await repo.ackStoragePurge(ctx, paths);
  } catch (error) {
    console.warn("[tab trash] storage purge skipped", error);
  }
}

async function loadTabTrash(ctx: Ctx) {
  const runtime = await createRequestBoards();
  const { service } = runtime;
  // 7일 지난 휴지통 탭은 여기서도 지운다(예약 작업이 없어도 지워지게). 실패해도 화면은 그린다.
  await service.purgeExpiredBoards(ctx).catch((error: unknown) => {
    console.warn("[tab trash] expired purge skipped", error);
  });
  const [, boards, trashedBoards, dismissals] = await Promise.all([
    drainBoardStoragePurgeQueue(ctx, runtime),
    service.listBoards(ctx),
    service.listTrashedBoards(ctx),
    service.listDefaultTabDismissals(ctx),
  ]);
  return {
    activeBoards: boards.filter((board) => !board.deleted_at),
    trashedBoards,
    dismissals,
    defaultTabs: DEFAULT_TABS.map((tab) => ({ source: tab.source, name: tab.name })),
    now: new Date(),
  };
}

export default async function WorkspaceBuilderPage({ searchParams }: { searchParams: Promise<{ section?: string } & TabTrashParams> }) {
  const ctx = await getSession();
  if (ctx.role !== "owner") redirect("/settings/members");
  const params = await searchParams;
  const section: Section = params.section === "migration" || params.section === "tabs" ? params.section : "workflow";

  let content;
  if (section === "migration") {
    content = <BuilderWorkspaceSurface snapshot={await loadOwnerWorkspaceOpsSnapshot()} />;
  } else if (section === "tabs") {
    const trash = await loadTabTrash(ctx);
    content = <TabTrashSurface {...trash} params={params} />;
  } else {
    const { service } = await createRequestBoards();
    const boards = await service.listBoards(ctx);
    const definitions = [
      { key: "new-lead" as const, order: 1, source: NEW_LEAD_TAB_SOURCE, name: "신규리드 관리", description: "처음 들어온 회사를 상담 단계로 분류", href: "/newcust", transition: "리드컨택 관리로 넘기기", transitionKind: "move" as const },
      { key: "contact" as const, order: 2, source: CONTACT_TAB_SOURCE, name: "리드컨택 관리", description: "담당자가 계약 전 상담과 직인을 진행", href: "/contract", transition: "계약업체 실무로 넘기기", transitionKind: "move" as const },
      { key: "work" as const, order: 3, source: CONTRACT_WORK_TAB_SOURCE, name: "계약업체 실무", description: "계약 후 기관·상품별 실무를 진행", href: "/work", transition: "업체관리 현황에 자동 반영", transitionKind: "projection" as const },
    ];
    const details = await Promise.all(definitions.map(async (definition) => {
      const board = boards.find((candidate) => candidate.source === definition.source);
      const detail = board ? await service.getBoardDetail(ctx, board.id) : null;
      return {
        ...definition,
        boardId: board?.id ?? null,
        groups: (detail?.groups ?? []).sort((left, right) => left.sort_order - right.sort_order).map((group) => ({ id: group.id, name: group.name, color: group.color })),
      } satisfies WorkflowManagementTab;
    }));
    const tabs: WorkflowManagementTab[] = [...details, {
      key: "companies",
      order: 4,
      name: "업체관리 현황",
      description: "회사별 진행 결과를 한곳에서 확인",
      href: "/companies",
      boardId: null,
      groups: [],
      transition: "완료",
      transitionKind: "complete",
    }];
    content = <WorkflowManagementSurface tabs={tabs} />;
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-mw-line pb-3">
        <div>
          <p className="text-xs font-semibold text-mw-record">설정</p>
          <h1 className="text-xl font-bold tracking-tight text-mw-fg">탭 관리</h1>
        </div>
        <nav aria-label="탭 관리 메뉴" className="flex max-w-full overflow-x-auto rounded-md border border-mw-line bg-mw-card p-1 text-sm">
          {SECTIONS.map((item) => (
            <Link
              key={item.key}
              href={`/settings/workspace-builder?section=${item.key}`}
              aria-current={section === item.key ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 font-semibold sm:px-4 ${section === item.key ? "bg-mw-primary text-mw-on-accent" : "text-mw-sub hover:bg-mw-bg"}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {content}
    </div>
  );
}
