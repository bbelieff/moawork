/* eslint-disable react-hooks/purity -- Async Server Component timing is emitted only to an operational log, never rendered. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
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
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE, NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { loadCompanyPickerRows } from "@/lib/companies/picker-server";
import { startCompanyWorkFromBoardAction } from "./company-intake-actions";
import { NewLeadOnboarding } from "@/components/board/NewLeadOnboarding";
import { loadDefaultTabAssignees } from "@/lib/boards/default-tab-assignees";
import { legacyMemberPickerEntries, memberPickerEntries } from "@/lib/boards/member-directory";
import { loadOrgChart } from "@/lib/org/departments";
import { loadPermGuards } from "@/lib/perm/guard";
import { PermissionUnavailable } from "@/components/perm/PermissionUnavailable";
import { loadPermissionScopedWorkItems } from "@/lib/perm/server";
import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import { BoardHeader } from "@/components/board/BoardHeader";
import { BoardInlineTitleEditor } from "@/components/board/BoardInlineTitleEditor";
import { NewLeadIntakeForm } from "@/components/board/NewLeadIntakeForm";
import { renameColumnTitleAction } from "@/app/(app)/boards/title-actions";
import { reorderColumnsAction } from "@/app/(app)/boards/actions";
import { BoardTrashPanel } from "@/components/board/BoardTrashPanel";
import { SavedViewsController } from "@/components/view";
import {
  applySavedKanbanView,
  applySavedPersonScope,
  boardViewSwitchUrl,
  NEW_LEAD_SAVED_FILTER_PROJECTION,
  parseSavedBoardLayout,
  parseSavedStringList,
  presentNewLeadSavedFilters,
} from "@/lib/view/board-saved";
import { resolveSavedPersonRuntime } from "@/lib/view/server";
import { decodeBoardFilters } from "@/components/board/filters";
import { GenericBoardKanban } from "@/components/boards/GenericBoardKanban";
import { ColumnEditor } from "@/components/boards/ColumnEditor";
import { GroupPresetMenu } from "@/components/board/GroupPresetMenu";
import { groupPresetName } from "@/lib/presets/group-preset";
import { addGroupAction, deleteBoardAction } from "../actions";
import { getBoardColumnOrder } from "../groupLayout";
import { presentNewLeadColumns } from "@/lib/default-tabs/new-lead";
import { applyNoticePerspective, parseNoticePerspective, projectNoticeMetadata } from "@/lib/notices/perspectives";
import { NoticePerspectiveNav } from "@/components/notices/NoticePerspectiveNav";

type PagePhaseTiming = { offsetMs: number; durationMs: number };

const TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REQUEST_START_HEADER = "x-mw-request-start-ms";
const REQUEST_START_PATTERN = /^\d+(?:\.\d+)?$/u;

function normalizeTraceId(raw: string | null): string | null {
  return raw && TRACE_ID_PATTERN.test(raw) ? raw.toLowerCase() : null;
}

function normalizeRequestStartedAt(raw: string | null): number | null {
  if (!raw || !REQUEST_START_PATTERN.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function phaseTiming(overallStartedAt: number, phaseStartedAt: number): PagePhaseTiming {
  const finishedAt = performance.now();
  const finiteNonnegative = (value: number) => Number.isFinite(value) && value >= 0 ? value : 0;
  return {
    offsetMs: finiteNonnegative(phaseStartedAt - overallStartedAt),
    durationMs: finiteNonnegative(finishedAt - phaseStartedAt),
  };
}

function roundedMs(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

async function measurePagePhase<T>(
  overallStartedAt: number,
  task: () => Promise<T>,
): Promise<{ value: T; timing: PagePhaseTiming }> {
  const phaseStartedAt = performance.now();
  const value = await task();
  return { value, timing: phaseTiming(overallStartedAt, phaseStartedAt) };
}

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
  searchParams: Promise<{ view?: string; group?: string; as?: string; savedView?: string; mwLayout?: string; mwHidden?: string; mwOrder?: string; mwFilters?: string; mwSort?: string; mwText?: string; mwFocus?: string; calendarField?: string; noticeView?: string }>;
}) {
  const startedAt = performance.now();
  const requestHeaders = await headers();
  const traceId = normalizeTraceId(requestHeaders.get("x-mw-trace-id"));
  const requestStartedAt = normalizeRequestStartedAt(requestHeaders.get(REQUEST_START_HEADER));
  const sessionStartedAt = performance.now();
  const { id } = await params;
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const sessionTiming = phaseTiming(startedAt, sessionStartedAt);
  // BBE-214 — 두 판정은 같은 ctx만 소비하고 서로의 결과에 의존하지 않는다.
  // 둘 다 통과하기 전에는 board metadata를 읽지 않으므로 fail-closed 순서는 유지한다.
  const [permissionsMeasured, scopedItemsMeasured] = await Promise.all([
    measurePagePhase(startedAt, () => loadPermGuards(ctx.org.id, [
        "work.view_tabs",
        "work.item_upsert",
        "work.item_delete",
        "structure.column_manage",
        "structure.section_manage",
        "danger.bulk_edit_delete",
        "structure.preset_edit",
        "structure.tab_manage",
      ])),
    measurePagePhase(startedAt, () => loadPermissionScopedWorkItems(ctx.org.id)),
  ]);
  const permissions = permissionsMeasured.value;
  const scopedItems = scopedItemsMeasured.value;
  const viewTabs = permissions["work.view_tabs"];
  // 판정 «불능» 은 「없음」이 아니다(BBE-204). 권한 없음만 404 로 남긴다 — 존재 숨김 유지.
  if (viewTabs.kind === "denied" && viewTabs.reason === "unavailable") {
    return <PermissionUnavailable />;
  }
  if (viewTabs.kind !== "allowed") notFound();
  const itemUpsert = permissions["work.item_upsert"];
  const itemDelete = permissions["work.item_delete"];
  const columnManage = permissions["structure.column_manage"];
  const sectionManage = permissions["structure.section_manage"];
  const boardDelete = permissions["danger.bulk_edit_delete"];
  const presetEdit = permissions["structure.preset_edit"];
  const tabManage = permissions["structure.tab_manage"];
  // Permission and D24 scope are resolved before any board metadata or item read.
  if (!scopedItems.ok) notFound();
  const canEditItems = itemUpsert.kind === "allowed";
  const canDeleteItems = itemDelete.kind === "allowed";
  const canManageColumns = columnManage.kind === "allowed";
  const canManageSections = sectionManage.kind === "allowed";
  const canDeleteBoard = boardDelete.kind === "allowed";
  const canEditPresets = presetEdit.kind === "allowed";
  const canManageSummaries = tabManage.kind === "allowed";
  const { client, repo, service: svc } = await createRequestBoards();

  let snapshot;
  const snapshotStartedOffsetMs = performance.now() - startedAt;
  const snapshotTimings: Record<"metadata" | "items" | "hydrate", PagePhaseTiming> = {
    metadata: { offsetMs: snapshotStartedOffsetMs, durationMs: 0 },
    items: { offsetMs: snapshotStartedOffsetMs, durationMs: 0 },
    hydrate: { offsetMs: snapshotStartedOffsetMs, durationMs: 0 },
  };
  // Permission-order contract: svc.loadPageSnapshot(ctx, id, { includeDeleted: canDeleteItems }) runs only after both guards.
  try {
    snapshot = await svc.loadPageSnapshot(ctx, id, {
      includeDeleted: canDeleteItems,
      onTiming: ({ phase, offsetMs, durationMs }) => {
        snapshotTimings[phase] = {
          offsetMs: Math.max(0, snapshotStartedOffsetMs + offsetMs),
          durationMs: Math.max(0, durationMs),
        };
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const postSnapshotTailStartedAt = performance.now();

  const { detail, items: loadedItems, deletedItems } = snapshot;
  const { board, columns, groups } = detail;
  const canMoveRows = !board.is_system && canEditItems
    && (ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all");
  const view = sp.view === "kanban" ? "kanban" : sp.view === "flat" ? "flat" : sp.view === "calendar" ? "calendar" : "table";
  const selectColumns = columns.filter(
    (c) => c.type === "select" || c.type === "multiselect",
  );
  const groupBy = sp.group && selectColumns.some((c) => c.key === sp.group) ? sp.group : "";
  const noticePerspective = parseNoticePerspective(sp.noticeView);
  const visibleItemIds = new Set(scopedItems.result.itemIds);
  const projectedItems = board.source === NOTICE_TAB_SOURCE
    ? applyNoticePerspective(loadedItems.map(projectNoticeMetadata), noticePerspective, ctx.user.id)
    : loadedItems;
  // 읽음 표시는 «쓰기» 다. 로컬 시드에는 그 저장소가 없어 건너뛴다 —
  // 화면에 표시되는 내용은 달라지지 않는다(BBE-209).
  if (board.source === NOTICE_TAB_SOURCE && client) {
    const visibleNoticeIds = projectedItems.filter((item) => visibleItemIds.has(item.id)).map((item) => item.id);
    await markNoticeItemsReadAtomic(ctx, visibleNoticeIds, client);
  }

  /*
   * 계약업체 실무의 「＋ 업체 추가」가 쓸 회사 목록.
   *
   * 이 보드에서만 읽는다 — 다른 보드에 왕복을 더하지 않는다(BBE-214 예산).
   * 목업이 이 화면의 규칙을 못박아 뒀다: 「이미 있는 업체를 고르면 저장된 정보가 그대로
   * 채워집니다 — 같은 회사를 두 번 적지 않게」. 그래서 회사부터 고르게 하고,
   * 이미 진행 이력이 있는 회사도 «다시» 고를 수 있게 건수를 같이 보여준다
   * (한 회사에 자금 건이 여러 번 생기는 것이 정상이다).
   */
  const contractWorkCompanyPicker = board.source === CONTRACT_WORK_TAB_SOURCE
    ? await loadCompanyPickerRows(ctx)
    : { rows: [], error: null, truncated: false };
  const boardItems = board.source === NOTICE_TAB_SOURCE
    ? projectedItems.map((item) => {
        const fileId = item.values.official_pdf;
        if (typeof fileId !== "string" || !fileId) return item;
        const token = issueFileToken(item.id, fileId);
        return { ...item, values: { ...item.values, official_pdf: `/api/boards/items/${item.id}/files/${fileId}?token=${encodeURIComponent(token)}` } };
      })
    : projectedItems;
  const permissionItems = boardItems.filter((item) => visibleItemIds.has(item.id));
  // ★ 사람 범위(personScope)는 «보이는 항목을 좁히는» 규칙이다.
  //   로컬에서 그 조회를 건너뛰면 좁힘이 사라져 «더 많이 보이는» fail-OPEN 이 된다.
  //   그래서 저장된 보기로 들어온 경우에는 화면을 열지 않는다 — 모르면 닫는다(BBE-207 D24 와 같은 판단).
  if (!client && sp.savedView) {
    return (
      <section className="rounded-md border border-mw-line bg-mw-card p-5" role="status" aria-labelledby="saved-view-unavailable">
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
  const canonicalNewLead = board.source === NEW_LEAD_TAB_SOURCE;
  const savedViewColumns = canonicalNewLead ? presentNewLeadColumns(columns) : columns;
  const savedViewFilters = canonicalNewLead
    ? presentNewLeadSavedFilters(decodeBoardFilters(sp.mwFilters ?? null))
    : decodeBoardFilters(sp.mwFilters ?? null);
  const lanes = view === "kanban"
    ? applySavedKanbanView(
        svc.kanbanFromSnapshot(snapshot, groupBy || undefined).map((lane) => ({ ...lane, items: lane.items.filter((item) => visibleItemIds.has(item.id)) })),
        items, savedViewColumns, savedViewFilters,
        canonicalNewLead ? NEW_LEAD_SAVED_FILTER_PROJECTION : undefined,
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

  // 담당자 목록과 그룹별 컬럼 배치는 서로의 결과에 의존하지 않는다.
  // 둘 다 snapshot/permission 관문 뒤에서 시작하되 같은 왕복 물결에 실어 tail 을 줄인다.
  const [assigneeBundle, savedColumnOrder] = await Promise.all([
    (async () => {
      // 담당자 탭·칩에 쓸 표시 이름. items.assigned_to 는 사용자 id 라서 이 맵이 없으면 UUID 가 노출된다.
      const orgChart = board.source === NEW_LEAD_TAB_SOURCE && client
        ? await loadOrgChart(ctx, async () => client)
        : null;
      const defaultTabAssignees = orgChart?.kind === "ready"
        ? []
        : await loadDefaultTabAssignees(ctx);
      return {
        assigneeLabels: Object.fromEntries(
          orgChart?.kind === "ready"
            ? orgChart.members.map((member) => [member.userId, member.displayName])
            : defaultTabAssignees.map((member) => [member.userId, member.displayName]),
        ),
        memberDirectory: orgChart?.kind === "ready"
          ? memberPickerEntries(orgChart)
          : legacyMemberPickerEntries(defaultTabAssignees),
      };
    })(),
    getBoardColumnOrder(repo, ctx, id),
  ]);
  const { assigneeLabels, memberDirectory } = assigneeBundle;
  /*
   * 그룹 메뉴의 «다른 프리셋 적용» 목록 — 이 PR 에서는 «비운다» (BBE-174 / BBE-223).
   *
   * ★ 여기서 라이브러리를 읽으면 보드 렌더마다 boards → board_groups → board_columns 가
   *   꼬리에 붙어 BBE-214 예산(직렬 13)을 넘긴다. 실측 15, 그리고 「세 읽기가 한 물결」도 깨진다.
   *   예산을 올리는 것은 처치가 아니다 — 갓 세운 가드를 첫 손님이 무력화한다.
   *   목록은 «그룹 메뉴를 열 때» 만 필요하므로 렌더에서 읽지 않는 것이 옳다(BBE-223).
   *   저장·미리보기는 이 PR 로 동작하고, 「다른 프리셋 적용」 목록만 그 카드에서 잇는다.
   */
  const activeColumnOrder = Object.fromEntries(
    Object.entries(parseSavedBoardLayout(sp.mwLayout) ?? savedColumnOrder).map(([groupId, keys]) => [groupId, [...keys]]),
  );
  const hiddenColumnKeys = new Set(parseSavedStringList(sp.mwHidden));
  const visibleColumns = columns.filter((column) => !hiddenColumnKeys.has(column.key));
  const postSnapshotTailTiming = phaseTiming(startedAt, postSnapshotTailStartedAt);
  const projectionStartedAt = performance.now();

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

  const workflowHelp = board.source === NEW_LEAD_TAB_SOURCE
    ? {
        title: "상담 단계와 리드컨택 이동",
        gate: "컨택 이동",
        description: "상담 상황을 바꾸면 행이 맞는 그룹으로 이동합니다. 다음 탭으로 넘길 때는 표 맨 오른쪽에 고정된 «진행현황»을 사용합니다.",
      }
    : board.source === CONTACT_TAB_SOURCE
      ? {
          title: "리드컨택에서 업무관리로 넘기기",
          gate: "업무이동",
          description: "표 맨 오른쪽에 고정된 «업무이동»을 «업무관리 이동»으로 바꾸면 이름 아래에 이동 실행 버튼이 나타납니다. 필수 정보를 확인한 뒤 그 버튼으로 업무관리 탭에 넘깁니다.",
        }
      : null;

  /** 실무 목적별 보드 설정 — 기록 항목/업무 양식/그룹 순서/위험 구역. */
  const boardSettings = !board.is_system && (canManageColumns || canManageSections || canDeleteBoard) && (
    <details id="board-settings" className="rounded-md border border-mw-line bg-mw-card">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-mw-sub list-none [&::-webkit-details-marker]:hidden">
        ⚙ 보드 설정
      </summary>
      <div className="flex flex-col gap-3 border-t border-mw-line p-3">
        {workflowHelp ? <section className="rounded-md border border-mw-primary/30 bg-mw-tint-blue p-3" aria-labelledby="workflow-settings-heading">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="workflow-settings-heading" className="font-semibold text-mw-fg">업무 흐름 · {workflowHelp.title}</h2>
              <p className="mt-1 max-w-4xl text-xs leading-5 text-mw-body">{workflowHelp.description}</p>
            </div>
            <span className="shrink-0 rounded-full border border-mw-primary/30 bg-mw-card px-2.5 py-1 text-xs font-semibold text-mw-record">
              오른쪽 고정 · {workflowHelp.gate}
            </span>
          </div>
          <p className="mt-2 text-[0.68rem] text-mw-sub">이 관문은 가로로 스크롤해도 오른쪽에 남습니다. 항목을 삭제하거나 새 컬럼을 만드는 기능과는 별개입니다.</p>
        </section> : null}
        {canManageColumns && <section className="rounded-md border border-mw-line p-3" aria-labelledby="record-fields-heading">
          <h2 id="record-fields-heading" className="font-semibold text-mw-fg">기록 항목(컬럼)</h2>
          <p className="mb-3 text-xs text-mw-sub">이 보드가 기록하는 정보입니다. 추가하고, 각 머리말 메뉴에서 이름·타입·선택지·순서·숨김을 바꾸며 숨긴 항목은 여기서 복구합니다.</p>
          <ColumnEditor boardId={id} columns={columns} />
        </section>}
        {(canManageColumns || canEditPresets) && <section id="board-work-forms" className="rounded-md border border-mw-line p-3" aria-labelledby="work-form-heading">
          <h2 id="work-form-heading" className="font-semibold text-mw-fg">업무 양식</h2>
          <p className="mb-3 text-xs text-mw-sub">각 업무 단계의 현재 기록 항목 묶음을 저장해 회사에서 재사용합니다. 적용 전 추가·유지 항목과 값 보존을 미리 확인합니다.</p>
          <div className="flex flex-wrap gap-2">
            {groups.map((group) => {
              const order = activeColumnOrder[group.id];
              const rank = new Map((order ?? []).map((key, index) => [key, index]));
              const formColumns = [...columns].sort((a, b) => (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER) || a.sort_order - b.sort_order);
              return <GroupPresetMenu key={group.id} boardId={id} groupKey={group.id} savable presetName={groupPresetName(board.name, group.name)} columns={formColumns} order={order} canEditPresets={canEditPresets} canManageColumns={canManageColumns} />;
            })}
          </div>
        </section>}

        {canManageSections && <section className="rounded-md border border-mw-line p-3" aria-labelledby="group-order-heading">
          <h2 id="group-order-heading" className="font-semibold text-mw-fg">그룹 순서</h2>
          <p className="mb-3 text-xs text-mw-sub">그룹은 상담·업무 단계입니다. 표의 그룹 머리말을 끌거나 ↑↓ 버튼으로 옮기면 즉시 회사 보드에 저장됩니다.</p>
          <form action={addGroupAction} className="flex flex-wrap items-end gap-2">
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
            새 업무 단계 추가
          </button>
          </form>
        </section>}

        {canDeleteBoard && <section className="rounded-md border border-mw-error/40 p-3" aria-labelledby="danger-heading">
          <h2 id="danger-heading" className="font-semibold text-mw-error">위험 구역</h2>
          <p className="mb-2 text-xs text-mw-sub">보드 전체를 삭제합니다. 기록 항목 숨김이나 그룹 순서 변경과는 별개입니다.</p>
          <form action={deleteBoardAction}>
          <input type="hidden" name="boardId" value={id} />
          <button type="submit" className="text-xs text-mw-sub hover:text-mw-error">
            이 보드 삭제
          </button>
          </form>
        </section>}
      </div>
    </details>
  );

  const trashPanel = (
    <BoardTrashPanel boardId={id} items={deletedItems} groups={groups} />
  );

  const alternateViewHeader=(
    <BoardHeader
      boardId={id}
      icon={board.icon}
      name={board.name}
      description={board.description}
      people={[]}
      selected={[]}
      groups={groups}
      readOnly={board.is_system||!canEditItems}
      canEditTitle={!board.is_system&&canManageSummaries}
      backSlot={backLink}
      viewSlot={viewToggle}
      addItemSlot={board.source===NEW_LEAD_TAB_SOURCE&&groups[0]?(
        <NewLeadIntakeForm
          variant="header"
          boardId={id}
          groupId={groups[0].id}
          groups={groups.map((group)=>({id:group.id,name:group.name}))}
          members={memberDirectory}
          currentUserId={ctx.user.id}
        />
      ):undefined}
    />
  );

  const boardContent = view === "kanban" ? (
    <>
        {alternateViewHeader}
        {/* 보드 이름 아래 — 목업 head() 순서(이름 → 보기). 테이블 뷰와 같은 위계다(BBE-214). */}
        <SavedViewsController boardId={id} orgId={ctx.org.id} currentUserId={ctx.user.id} teamMemberIds={personRuntime.memberIds} layout={activeColumnOrder} columns={visibleColumns} rows={items} canEditItems={canEditItems} canonicalNewLead={canonicalNewLead} memberOptions={memberDirectory} groups={groups} rowOrderVersion={board.row_order_version??0} canMoveRows={canMoveRows} canManageColumns={canManageColumns} canManageSections={canManageSections} isSystem={board.is_system} />
        {boardSettings}

        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto text-xs">
          <span className="shrink-0 text-mw-sub">그룹 기준</span>
          <Link
            href={switchView("kanban", "")}
            className={`shrink-0 rounded-full border px-2.5 py-1 ${groupBy === "" ? "border-mw-record bg-mw-tint-blue text-mw-record" : "border-mw-line text-mw-body"}`}
          >
            그룹
          </Link>
          {selectColumns.map((c) => (
            <span key={c.id} className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 ${groupBy===c.key?"border-mw-record bg-mw-tint-blue text-mw-record":"border-mw-line text-mw-body"}`}>
              {!board.is_system&&canManageColumns?<BoardInlineTitleEditor name={c.label} label="컬럼 이름" onSave={renameColumnTitleAction.bind(null,id,c.id)}/>:c.label}
              <Link href={switchView("kanban",c.key)} aria-label={`${c.label} 기준 칸반 보기`} className="text-[0.65rem] text-mw-sub">보기</Link>
              {!board.is_system&&canManageColumns?<span className="sr-only focus-within:not-sr-only">{([-1,1] as const).map((delta)=>{const ordered=columns.map((column)=>column.id);const from=ordered.indexOf(c.id);const to=Math.max(0,Math.min(ordered.length-1,from+delta));if(from!==to){const [moved]=ordered.splice(from,1);ordered.splice(to,0,moved);}return <form key={delta} action={reorderColumnsAction} className="inline"><input type="hidden" name="boardId" value={id}/><input type="hidden" name="columnIds" value={JSON.stringify(ordered)}/><button type="submit" disabled={from===to} aria-label={`${c.label} ${delta<0?"왼쪽":"오른쪽"}으로 이동`}>{delta<0?"←":"→"}</button></form>;})}</span>:null}
            </span>
          ))}
        </div>

        <GenericBoardKanban
          boardId={id}
          lanes={lanes}
          groupBy={groupBy}
          readOnly={board.is_system || !canEditItems}
          rowOrderVersion={board.row_order_version ?? 0}
          canMoveRows={canMoveRows}
          canManageSections={canManageSections}
          isSystem={board.is_system}
        />
    </>
  ) : view === "flat" || view === "calendar" ? (
    <>
        {alternateViewHeader}
        <SavedViewsController boardId={id} orgId={ctx.org.id} currentUserId={ctx.user.id} teamMemberIds={personRuntime.memberIds} layout={activeColumnOrder} columns={visibleColumns} rows={items} renderMode={view} canEditItems={canEditItems} canonicalNewLead={canonicalNewLead} memberOptions={memberDirectory} groups={groups} rowOrderVersion={board.row_order_version??0} canMoveRows={canMoveRows} canManageColumns={canManageColumns} canManageSections={canManageSections} isSystem={board.is_system} />
        {boardSettings}
    </>
  ) : (
    <BoardWorkspace
      board={board}
      columns={visibleColumns}
      summaryColumns={columns}
      groups={groups}
      rows={items}
      // 계약업체 실무에서만 채워진다 — 다른 보드는 빈 배열이라 «업체 추가» 가 뜨지 않는다.
      contractWorkCompanyPicker={contractWorkCompanyPicker}
      startCompanyWorkAction={startCompanyWorkFromBoardAction}
      // 같은 «추가» 를 두 번 눌러도 건이 둘 생기지 않게 하는 열쇠. 서버가 발급한다.
      columnOrder={activeColumnOrder}
      cellFlash={cellFlash}
      assigneeLabels={assigneeLabels}
      memberDirectory={memberDirectory}
      backSlot={backLink}
      viewSlot={viewToggle}
      savedViewsSlot={
        <SavedViewsController boardId={id} orgId={ctx.org.id} currentUserId={ctx.user.id} teamMemberIds={personRuntime.memberIds} layout={activeColumnOrder} columns={visibleColumns} rows={items} canEditItems={canEditItems} canonicalNewLead={canonicalNewLead} memberOptions={memberDirectory} groups={groups} rowOrderVersion={board.row_order_version??0} canMoveRows={canMoveRows} canManageColumns={canManageColumns} canManageSections={canManageSections} isSystem={board.is_system} />
      }
      settingsSlot={boardSettings}
      onboardingSlot={board.source === NEW_LEAD_TAB_SOURCE ? (
        <NewLeadOnboarding />
      ) : undefined}
      canEditItems={canEditItems}
      canDeleteItems={canDeleteItems}
      canManageColumns={canManageColumns}
      canManageSections={canManageSections}
      canManageSummaries={canManageSummaries}
      canMoveRows={canMoveRows}
      savedViewActive={Boolean(personRuntime.view)}
      savedViewId={personRuntime.view ? (sp.savedView ?? null) : null}
      currentUserId={ctx.user.id}
    />
  );

  const projectionTiming = phaseTiming(startedAt, projectionStartedAt);
  const preReturnStartedAt = performance.now();
  const preReturnTiming = phaseTiming(startedAt, preReturnStartedAt);

  if (process.env.NODE_ENV === "production") {
    const timings = {
      session: sessionTiming,
      permission_guard: permissionsMeasured.timing,
      scoped_items_guard: scopedItemsMeasured.timing,
      snapshot_metadata: snapshotTimings.metadata,
      snapshot_items: snapshotTimings.items,
      snapshot_hydrate: snapshotTimings.hydrate,
      post_snapshot_tail_reads: postSnapshotTailTiming,
      projection: projectionTiming,
      pre_return: preReturnTiming,
    };
    const requestElapsedAtPreReturn = requestStartedAt === null
      ? null
      : performance.now() - requestStartedAt;
    console.info(JSON.stringify({
      event: "mw.performance",
      route: "board_detail",
      outcome: "ready",
      ...(traceId ? { trace_id: traceId } : {}),
      ...(requestElapsedAtPreReturn !== null && Number.isFinite(requestElapsedAtPreReturn) && requestElapsedAtPreReturn >= 0
        ? { request_elapsed_at_pre_return_ms: roundedMs(requestElapsedAtPreReturn) }
        : {}),
      total_ms: roundedMs(performance.now() - startedAt),
      phase_ms: Object.fromEntries(
        Object.entries(timings).map(([phase, timing]) => [phase, roundedMs(timing.durationMs)]),
      ),
      phase_offset_ms: Object.fromEntries(
        Object.entries(timings).map(([phase, timing]) => [phase, roundedMs(timing.offsetMs)]),
      ),
    }));
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {board.source === NOTICE_TAB_SOURCE ? (
        <NoticePerspectiveNav
          baseHref={`/boards/${encodeURIComponent(id)}`}
          active={noticePerspective}
          as={sp.as}
        />
      ) : null}
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
    </div>
  );
}
