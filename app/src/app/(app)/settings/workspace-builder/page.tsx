import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { BuilderWorkspaceSurface } from "@/components/workspace-builder/BuilderWorkspaceSurface";
import { WorkflowManagementSurface, type WorkflowManagementTab } from "@/components/workspace-builder/WorkflowManagementSurface";
import { loadOwnerWorkspaceOpsSnapshot } from "@/lib/dynamic-workspace/workspace-ops";
import { createRequestBoards } from "@/lib/boards/server";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";

export default async function WorkspaceBuilderPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const ctx = await getSession();
  if (ctx.role !== "owner") redirect("/settings/members");
  const section = (await searchParams).section === "migration" ? "migration" : "workflow";

  let content;
  if (section === "migration") {
    content = <BuilderWorkspaceSurface snapshot={await loadOwnerWorkspaceOpsSnapshot()} />;
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
        <nav aria-label="탭 관리 메뉴" className="flex rounded-md border border-mw-line bg-mw-card p-1 text-sm">
          <Link href="/settings/workspace-builder?section=migration" aria-current={section === "migration" ? "page" : undefined} className={`rounded-lg px-4 py-2 font-semibold ${section === "migration" ? "bg-mw-primary text-mw-on-accent" : "text-mw-sub hover:bg-mw-bg"}`}>마이그레이션</Link>
          <Link href="/settings/workspace-builder?section=workflow" aria-current={section === "workflow" ? "page" : undefined} className={`rounded-lg px-4 py-2 font-semibold ${section === "workflow" ? "bg-mw-primary text-mw-on-accent" : "text-mw-sub hover:bg-mw-bg"}`}>워크플로 관리</Link>
        </nav>
      </header>
      {content}
    </div>
  );
}
