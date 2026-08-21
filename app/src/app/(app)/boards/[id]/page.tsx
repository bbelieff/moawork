import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { applyAs, getSession } from "@/lib/auth/session";
import { CELL_FLASH_COOKIE, decodeCellFlash } from "@/lib/boards/cellFlash";
import {
  BOARD_ACTION_FLASH_COOKIE,
  decodeBoardActionFlash,
  findBoardActionError,
} from "@/lib/boards/boardActionFlash";
import { NotFoundError } from "@/lib/boards";
import { createRequestBoards, requireRequestClient } from "@/lib/boards/server";
import { markNoticeItemsReadAtomic } from "@/lib/notices/atomic";
import { issueFileToken } from "@/lib/deal/fileSignedUrl";
import { NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";
import { loadDefaultTabAssignees } from "@/lib/boards/default-tab-assignees";
import { loadPermGuards } from "@/lib/perm/guard";
import { PermissionUnavailable } from "@/components/perm/PermissionUnavailable";
import { loadPermissionScopedWorkItems } from "@/lib/perm/server";
import { type SectionPresetRecord } from "@/lib/presets/section-presets";
import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import { BoardTrashPanel } from "@/components/board/BoardTrashPanel";
import { SavedViewsController } from "@/components/view";
import { applySavedKanbanView, applySavedPersonScope, boardViewSwitchUrl, parseSavedBoardLayout, parseSavedStringList } from "@/lib/view/board-saved";
import { resolveSavedPersonRuntime } from "@/lib/view/server";
import { decodeBoardFilters } from "@/components/board/filters";
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
  searchParams: Promise<{ view?: string; group?: string; as?: string; savedView?: string; mwLayout?: string; mwHidden?: string; mwOrder?: string; mwFilters?: string; mwSort?: string; mwText?: string; mwFocus?: string; calendarField?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const permissions = await loadPermGuards(ctx.org.id, [
    "work.view_tabs",
    "work.item_upsert",
    "work.item_delete",
    "structure.column_manage",
    "structure.section_manage",
    "danger.bulk_edit_delete",
    "structure.preset_edit",
  ]);
  const viewTabs = permissions["work.view_tabs"];
  // 판정 «불능» 은 「없음」이 아니다(BBE-204). 권한 없음만 404 로 남긴다 — 존재 숨김 유지.
  if (viewTabs.kind === "denied" && viewTabs.reason === "unavailable") {
    return <PermissionUnavailable />;
  }
  if (viewTabs.kind !== "allowed") notFound();
  const scopedItems = await loadPermissionScopedWorkItems(ctx.org.id);
  const itemUpsert = permissions["work.item_upsert"];
  const itemDelete = permissions["work.item_delete"];
  const columnManage = permissions["structure.column_manage"];
  const sectionManage = permissions["structure.section_manage"];
  const boardDelete = permissions["danger.bulk_edit_delete"];
  const presetEdit = permissions["structure.preset_edit"];
  // Permission and D24 scope are resolved before any board metadata or item read.
  if (!scopedItems.ok) notFound();
  const canEditItems = itemUpsert.kind === "allowed";
  const canDeleteItems = itemDelete.kind === "allowed";
  const canManageColumns = columnManage.kind === "allowed";
  const canManageSections = sectionManage.kind === "allowed";
  const canDeleteBoard = boardDelete.kind === "allowed";
  const canEditPresets = presetEdit.kind === "allowed";
  const { client, repo, service: svc } = await createRequestBoards();

  let detail;
  try {
    detail = await svc.getBoardDetail(ctx, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const { board, columns, groups } = detail;
  const view = sp.view === "kanban" ? "kanban" : sp.view === "flat" ? "flat" : sp.view === "calendar" ? "calendar" : "table";
  const selectColumns = columns.filter(
    (c) => c.type === "select" || c.type === "multiselect",
  );
  const groupBy = sp.group && selectColumns.some((c) => c.key === sp.group) ? sp.group : "";
  const visibleItemIds = new Set(scopedItems.result.itemIds);
  const loadedItems = await svc.listItems(ctx, id);
  const deletedItems = !board.is_system && canDeleteItems
    ? await svc.listDeletedItems(ctx, id)
    : [];
  // 읽음 표시는 «쓰기» 다. 로컬 시드에는 그 저장소가 없어 건너뛴다 —
  // 화면에 표시되는 내용은 달라지지 않는다(BBE-209).
  if (board.source === NOTICE_TAB_SOURCE && client) {
    const visibleNoticeIds = loadedItems.filter((item) => visibleItemIds.has(item.id)).map((item) => item.id);
    await markNoticeItemsReadAtomic(ctx, visibleNoticeIds, client);
  }
  const boardItems = board.source === NOTICE_TAB_SOURCE
    ? loadedItems.map((item) => {
        const fileId = item.values.official_pdf;
        if (typeof fileId !== "string" || !fileId) return item;
        const token = issueFileToken(item.id, fileId);
        return { ...item, values: { ...item.values, official_pdf: `/api/boards/items/${item.id}/files/${fileId}?token=${encodeURIComponent(token)}` } };
      })
    : loadedItems;
  const permissionItems = boardItems.filter((item) => visibleItemIds.has(item.id));
  // ★ 사람 범위(personScope)는 «보이는 항목을 좁히는» 규칙이다.
  //   로컬에서 그 조회를 건너뛰면 좁힘이 사라져 «더 많이 보이는» fail-OPEN 이 된다.
  //   그래서 저장된 보기로 들어온 경우에는 화면을 열지 않는다 — 모르면 닫는다(BBE-207 D24 와 같은 판단).
  if (!client && sp.savedView) {
    return (
      <section className="rounded-xl border border-mw-line bg-mw-card p-5" role="status" aria-labelledby="saved-view-unavailable">
        <h1 id="saved-view-unavailable" className="text-lg font-semibold text-mw-fg">
          저장된 보기는 연결된 워크스페이스가 필요합니다
        </h1>
        <p className="mt-2 text-sm text-mw-sub">
          이 보기는 «담당자 범위» 규칙을 함께 적용합니다. 그 규칙을 확인할 수 없어 화면을 열지 않았습니다.
        </p>
      </section>
    );
  }
  const personRuntime = await resolveSavedPersonRuntime(
    ctx.org.id, id, client ? (sp.savedView ?? null) : null, ctx.user.id,
    async (orgId, boardId, viewId) => {
      // 위 분기에서 savedView 가 있으면 client 가 반드시 있다. 그래도 단정하지 않고 확인한다.
      const { data, error } = await requireRequestClient(client, "저장된 보기 조회").from("tab_views").select("person_scope,person_scope_user_id")
        .eq("org_id", orgId).eq("board_id", boardId).eq("id", viewId).maybeSingle();
      if (error) throw error;
      return data ? { personScope: data.person_scope, personScopeUserId: data.person_scope_user_id } : null;
    },
    async (orgId) => {
      const { data, error } = await requireRequestClient(client, "구성원 조회").from("org_members").select("user_id").eq("org_id", orgId).eq("status", "active");
      if (error) throw error;
      return (data ?? []).map((member) => member.user_id);
    },
    async (orgId, userId) => {
      const { data, error } = await requireRequestClient(client, "담당자 팀 조회").rpc("get_member_account_profile", { p_org_id: orgId, p_target_user_id: userId });
      if (error) throw error;
      return data && typeof data === "object" && !Array.isArray(data) && typeof data.team_key === "string" ? data.team_key : null;
    },
  );
  const personColumnKey = columns.find((column) => column.type === "person")?.key ?? null;
  const items = applySavedPersonScope(permissionItems, personRuntime.view, ctx.user.id, personColumnKey, personRuntime.memberIds);
  const hiddenCount = boardItems.length - permissionItems.length;
  const lanes = view === "kanban"
    ? applySavedKanbanView(
        (await svc.kanban(ctx, id, groupBy || undefined)).map((lane) => ({ ...lane, items: lane.items.filter((item) => visibleItemIds.has(item.id)) })),
        items, columns, decodeBoardFilters(sp.mwFilters ?? null),
      )
    : [];

  // 직전 셀 편집에서 저장되지 못한 값의 사유(1회성). 없으면 null.
  const jar = await cookies();
  const cellFlash = decodeCellFlash(jar.get(CELL_FLASH_COOKIE)?.value);
  // 직전 «항목 추가» 실패의 사유(1회성). 없으면 null.
  // 이게 없으면 실패가 전면 오류 화면으로 튄다 — 그게 BBE-201 의 본체였다.
  const boardActionError = findBoardActionError(
    decodeBoardActionFlash(jar.get(BOARD_ACTION_FLASH_COOKIE)?.value),
    id,
  );

  // 담당자 탭·칩에 쓸 표시 이름. items.assigned_to 는 사용자 id 라서 이 맵이 없으면 UUID 가 노출된다.
  const assigneeLabels = Object.fromEntries(
    (await loadDefaultTabAssignees(ctx)).map((member) => [member.userId, member.displayName]),
  );
  /*
   * 그룹 메뉴의 «다른 프리셋 적용» 목록 — 이 PR 에서는 «비운다» (BBE-174 / BBE-223).
   *
   * ★ 여기서 라이브러리를 읽으면 보드 렌더마다 boards → board_groups → board_columns 가
   *   꼬리에 붙어 BBE-214 예산(직렬 13)을 넘긴다. 실측 15, 그리고 「세 읽기가 한 물결」도 깨진다.
   *   예산을 올리는 것은 처치가 아니다 — 갓 세운 가드를 첫 손님이 무력화한다.
   *   목록은 «그룹 메뉴를 열 때» 만 필요하므로 렌더에서 읽지 않는 것이 옳다(BBE-223).
   *   저장·미리보기는 이 PR 로 동작하고, 「다른 프리셋 적용」 목록만 그 카드에서 잇는다.
   */
  const presets: SectionPresetRecord[] = [];
  const savedColumnOrder = await getBoardColumnOrder(repo, ctx, id);
  const activeColumnOrder = Object.fromEntries(
    Object.entries(parseSavedBoardLayout(sp.mwLayout) ?? savedColumnOrder).map(([groupId, keys]) => [groupId, [...keys]]),
  );
  const hiddenColumnKeys = new Set(parseSavedStringList(sp.mwHidden));
  const visibleColumns = columns.filter((column) => !hiddenColumnKeys.has(column.key));

  const currentQuery = new URLSearchParams(
    Object.entries(sp).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const switchView = (nextView: "table" | "kanban" | "calendar", nextGroup?: string) =>
    boardViewSwitchUrl(nextView, `https://app.local/boards/${id}?${currentQuery}`, nextGroup);

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
        href={switchView("table", groupBy)}
        className={`rounded-full px-2.5 py-1 ${view === "table" ? "bg-mw-tint-blue font-semibold text-mw-record" : "text-mw-sub hover:text-mw-fg"}`}
      >
        테이블
      </Link>
      <Link
        href={switchView("kanban", groupBy)}
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

  const trashPanel = (
    <BoardTrashPanel boardId={id} items={deletedItems} groups={groups} />
  );

  const boardContent = view === "kanban" ? (
    <>
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
          {backLink}
          <h1 className="flex shrink-0 items-center gap-1.5 text-base font-semibold text-mw-fg">
            {board.icon && <span aria-hidden="true">{board.icon}</span>}
            <span>{board.name}</span>
          </h1>
          <div className="ml-auto">{viewToggle}</div>
        </div>
        {/* 보드 이름 아래 — 목업 head() 순서(이름 → 보기). 테이블 뷰와 같은 위계다(BBE-214). */}
        <SavedViewsController boardId={id} orgId={ctx.org.id} currentUserId={ctx.user.id} teamMemberIds={personRuntime.memberIds} layout={activeColumnOrder} columns={visibleColumns} rows={items} canEditItems={canEditItems} />

        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto text-xs">
          <span className="shrink-0 text-mw-sub">그룹 기준</span>
          <Link
            href={switchView("kanban", "")}
            className={`shrink-0 rounded-full border px-2.5 py-1 ${groupBy === "" ? "border-mw-record bg-mw-tint-blue text-mw-record" : "border-mw-line text-mw-body"}`}
          >
            그룹
          </Link>
          {selectColumns.map((c) => (
            <Link
              key={c.id}
              href={switchView("kanban", c.key)}
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
    </>
  ) : view === "flat" || view === "calendar" ? (
    <>
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
          {backLink}
          <h1 className="text-base font-semibold text-mw-fg">{board.icon ? <span aria-hidden="true">{board.icon}</span> : null} {board.name}</h1>
        </div>
        <SavedViewsController boardId={id} orgId={ctx.org.id} currentUserId={ctx.user.id} teamMemberIds={personRuntime.memberIds} layout={activeColumnOrder} columns={visibleColumns} rows={items} renderMode={view} canEditItems={canEditItems} />
    </>
  ) : (
    <BoardWorkspace
      board={board}
      columns={visibleColumns}
      groups={groups}
      rows={items}
      columnOrder={activeColumnOrder}
      cellFlash={cellFlash}
      assigneeLabels={assigneeLabels}
      backSlot={backLink}
      viewSlot={viewToggle}
      savedViewsSlot={
        <SavedViewsController boardId={id} orgId={ctx.org.id} currentUserId={ctx.user.id} teamMemberIds={personRuntime.memberIds} layout={activeColumnOrder} columns={visibleColumns} rows={items} canEditItems={canEditItems} />
      }
      canEditItems={canEditItems}
      canDeleteItems={canDeleteItems}
      canManageColumns={canManageColumns}
      canEditPresets={canEditPresets}
      presets={presets}
      currentUserId={ctx.user.id}
    />
  );

  return (
    <div className="flex w-full flex-col gap-3">
      {hiddenCount > 0 && (
        <p className="text-xs text-mw-sub">권한 밖 {hiddenCount}건 숨김</p>
      )}
      {/* 항목 추가 실패는 «화면 안에서» 말한다. 전면 오류 화면으로 덮으면
          사용자는 무엇이 왜 안 됐는지 모르고 입력하던 것도 잃는다(BBE-201). */}
      {boardActionError ? (
        <p
          role="alert"
          data-testid="board-action-error"
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--mw-error)", color: "var(--mw-fg)", background: "var(--mw-card)" }}
        >
          {boardActionError}
        </p>
      ) : null}
      {/* 뷰별 내용은 이 공통 셸 안에만 들어간다. 새 뷰도 오류 배너를 자동 상속한다(BBE-212). */}
      {boardContent}

      {trashPanel}
      {boardSettings}
    </div>
  );
}
