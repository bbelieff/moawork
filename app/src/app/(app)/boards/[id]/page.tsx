import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { applyAs, getSession } from "@/lib/auth/session";
import { CELL_FLASH_COOKIE, decodeCellFlash } from "@/lib/boards/cellFlash";
import { getBoardsService, NotFoundError } from "@/lib/boards";
import { getRepo } from "@/lib/repo";
import { loadPermGuard } from "@/lib/perm/guard";
import { loadPermissionScopedWorkItems } from "@/lib/perm/server";
import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import { GenericBoardKanban } from "@/components/boards/GenericBoardKanban";
import { ColumnEditor } from "@/components/boards/ColumnEditor";
import { addGroupAction, deleteBoardAction } from "../actions";
import { getBoardColumnOrder } from "../groupLayout";

/**
 * 범용 보드 화면 (T02b · ADR-0003) — 테이블/칸반 토글.
 * ?view=table|kanban · ?group=<select 컬럼 key>(없으면 board_groups 기준)
 * 시스템 보드(정책자금)는 편집 불가 — 데이터는 001 deals 에 있다.
 *
 * 테이블 뷰는 PLAN-002 WO-2 의 공용 보드 셸(`@/components/board`)이 그린다:
 * 헤더 1줄 + 도구줄 1줄 + 그룹 카드 블록 리스트(ui-guidelines 원칙 2·3·4·5·6·8·9·10).
 * 뒤로가기·뷰 전환은 셸의 **헤더 슬롯**에 넣는다 — 별도 줄을 만들면 원칙 3(헤더 1줄)이 깨진다.
 * 칸반 뷰는 기존 화면을 그대로 둔다(이번 WO 범위 밖).
 */
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; group?: string; as?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const viewTabs = await loadPermGuard(ctx.org.id, "work.view_tabs");
  if (viewTabs.kind !== "allowed") notFound();
  const [scopedItems, itemUpsert, itemDelete, columnManage, sectionManage, boardDelete] = await Promise.all([
    loadPermissionScopedWorkItems(ctx.org.id),
    loadPermGuard(ctx.org.id, "work.item_upsert"),
    loadPermGuard(ctx.org.id, "work.item_delete"),
    loadPermGuard(ctx.org.id, "structure.column_manage"),
    loadPermGuard(ctx.org.id, "structure.section_manage"),
    loadPermGuard(ctx.org.id, "danger.bulk_edit_delete"),
  ]);
  // Permission and D24 scope are resolved before any board metadata or item read.
  if (!scopedItems.ok) notFound();
  const canEditItems = itemUpsert.kind === "allowed";
  const canDeleteItems = itemDelete.kind === "allowed";
  const canManageColumns = columnManage.kind === "allowed";
  const canManageSections = sectionManage.kind === "allowed";
  const canDeleteBoard = boardDelete.kind === "allowed";
  const svc = getBoardsService();

  let detail;
  try {
    detail = await svc.getBoardDetail(ctx, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const { board, columns, groups } = detail;
  const view = sp.view === "kanban" ? "kanban" : "table";
  const selectColumns = columns.filter(
    (c) => c.type === "select" || c.type === "multiselect",
  );
  const groupBy = sp.group && selectColumns.some((c) => c.key === sp.group) ? sp.group : "";
  const visibleItemIds = new Set(scopedItems.result.itemIds);
  const boardItems = await svc.listItems(ctx, id);
  const items = boardItems.filter((item) => visibleItemIds.has(item.id));
  const hiddenCount = boardItems.length - items.length;
  const lanes = view === "kanban"
    ? (await svc.kanban(ctx, id, groupBy || undefined)).map((lane) => ({
        ...lane,
        items: lane.items.filter((item) => visibleItemIds.has(item.id)),
      }))
    : [];

  // 직전 셀 편집에서 저장되지 못한 값의 사유(1회성). 없으면 null.
  const cellFlash = decodeCellFlash((await cookies()).get(CELL_FLASH_COOKIE)?.value);

  // 담당자 탭·칩에 쓸 표시 이름. items.assigned_to 는 사용자 id 라서 이 맵이 없으면 UUID 가 노출된다.
  const assigneeLabels: Record<string, string> = {};
  for (const member of getRepo().listMembers(ctx.org.id)) {
    const label = member.user?.name?.trim() || member.user?.email?.trim();
    if (label) assigneeLabels[member.user_id] = label;
  }

  const qs = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.as) p.set("as", sp.as);
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  const backLink = (
    <Link
      href="/boards"
      aria-label="보드 목록으로"
      className="shrink-0 rounded-full px-1.5 text-sm text-mw-sub hover:text-mw-fg"
    >
      ←
    </Link>
  );

  const viewToggle = (
    <div className="flex shrink-0 items-center rounded-full border border-mw-line p-0.5 text-xs">
      <Link
        href={`/boards/${id}${qs({ view: "table", group: groupBy })}`}
        className={`rounded-full px-2.5 py-1 ${view === "table" ? "bg-mw-tint-blue font-semibold text-mw-record" : "text-mw-sub hover:text-mw-fg"}`}
      >
        테이블
      </Link>
      <Link
        href={`/boards/${id}${qs({ view: "kanban", group: groupBy })}`}
        className={`rounded-full px-2.5 py-1 ${view === "kanban" ? "bg-mw-tint-blue font-semibold text-mw-record" : "text-mw-sub hover:text-mw-fg"}`}
      >
        칸반
      </Link>
    </div>
  );

  /** 구조 편집(컬럼·그룹·삭제) — 상시 노출하면 표 아래가 산만해져 접어 둔다(원칙 2·7). */
  const boardSettings = !board.is_system && (canManageColumns || canManageSections || canDeleteBoard) && (
    <details className="rounded-xl border border-mw-line bg-mw-card">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-mw-sub list-none [&::-webkit-details-marker]:hidden">
        ⚙ 보드 설정 — 컬럼·그룹·삭제
      </summary>
      <div className="flex flex-col gap-3 border-t border-mw-line p-3">
        {canManageColumns && <ColumnEditor boardId={id} columns={columns} />}

        {canManageSections && <form action={addGroupAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="boardId" value={id} />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-mw-sub">새 그룹</span>
            <input
              name="name"
              required
              placeholder="예: 이번 주"
              className="h-9 rounded-lg border border-mw-line bg-mw-card px-2 text-sm text-mw-fg outline-none focus:border-mw-record"
            />
          </label>
          <button
            type="submit"
            className="h-9 rounded-lg border border-mw-line px-3 text-sm text-mw-body hover:bg-mw-bg"
          >
            그룹 추가
          </button>
        </form>}

        {canDeleteBoard && <form action={deleteBoardAction}>
          <input type="hidden" name="boardId" value={id} />
          <button type="submit" className="text-xs text-mw-sub hover:text-mw-error">
            이 보드 삭제
          </button>
        </form>}
      </div>
    </details>
  );

  if (view === "kanban") {
    return (
      <div className="flex w-full flex-col gap-3">
        {hiddenCount > 0 && (
          <p className="text-xs text-mw-sub">권한 밖 {hiddenCount}건 숨김</p>
        )}
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
          {backLink}
          <h1 className="flex shrink-0 items-center gap-1.5 text-base font-semibold text-mw-fg">
            {board.icon && <span aria-hidden="true">{board.icon}</span>}
            <span>{board.name}</span>
          </h1>
          <div className="ml-auto">{viewToggle}</div>
        </div>

        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto text-xs">
          <span className="shrink-0 text-mw-sub">그룹 기준</span>
          <Link
            href={`/boards/${id}${qs({ view: "kanban" })}`}
            className={`shrink-0 rounded-full border px-2.5 py-1 ${groupBy === "" ? "border-mw-record bg-mw-tint-blue text-mw-record" : "border-mw-line text-mw-body"}`}
          >
            그룹
          </Link>
          {selectColumns.map((c) => (
            <Link
              key={c.id}
              href={`/boards/${id}${qs({ view: "kanban", group: c.key })}`}
              className={`shrink-0 rounded-full border px-2.5 py-1 ${groupBy === c.key ? "border-mw-record bg-mw-tint-blue text-mw-record" : "border-mw-line text-mw-body"}`}
            >
              {c.label}
            </Link>
          ))}
        </div>

        <GenericBoardKanban
          boardId={id}
          lanes={lanes}
          groupBy={groupBy}
          readOnly={board.is_system || !canEditItems}
        />

        {boardSettings}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {hiddenCount > 0 && (
        <p className="text-xs text-mw-sub">권한 밖 {hiddenCount}건 숨김</p>
      )}
      <BoardWorkspace
        board={board}
        columns={columns}
        groups={groups}
        rows={items}
        columnOrder={getBoardColumnOrder(ctx.org.id, id)}
        cellFlash={cellFlash}
        assigneeLabels={assigneeLabels}
        backSlot={backLink}
        viewSlot={viewToggle}
        canEditItems={canEditItems}
        canDeleteItems={canDeleteItems}
        canManageColumns={canManageColumns}
      />

      {boardSettings}
    </div>
  );
}
