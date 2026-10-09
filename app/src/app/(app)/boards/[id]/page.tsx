/* eslint-disable react-hooks/purity -- Async Server Component timing is emitted only to an operational log, never rendered. */
import { WorkspaceLink } from "@/components/shell/WorkspaceLink";
import { scheduleDefaultTabRepair } from "@/lib/workspace-entry/default-tab-repair";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { applyAs, getSession, SESSION_COOKIE } from "@/lib/auth/session";
import { CELL_FLASH_COOKIE, decodeCellFlash } from "@/lib/boards/cellFlash";
import {
  BOARD_ACTION_FLASH_COOKIE,
  decodeBoardActionFlash,
  findBoardActionError,
} from "@/lib/boards/boardActionFlash";
import { NotFoundError } from "@/lib/boards";
import { columnPolicyAllows } from "@/lib/boards/service";
import { createRequestBoards, requireRequestClient } from "@/lib/boards/server";
import { markNoticeItemsReadAtomic } from "@/lib/notices/atomic";
import { after } from "next/server";
import { issueFileToken } from "@/lib/deal/fileSignedUrl";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE, NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import {
  consultationModeForRow,
  parseConsultationView,
  type ConsultationBoardMap,
  type ConsultationBoardRpcClient,
  type ConsultationView,
} from "@/lib/consultation/boardView";
import { loadConsultationBoardView } from "@/lib/consultation/boardViewServer";
import { buildCompanyPickerResult, loadCompanyPickerRows, readCompanyPickerSources } from "@/lib/companies/picker-server";
import { startCompanyWorkFromBoardAction, startCompanyWorkFromNewCompanyAction } from "./company-intake-actions";
import { addBoardLabelOptionAction } from "@/app/(app)/boards/label-option-actions";
import { NewLeadOnboarding } from "@/components/board/NewLeadOnboarding";
import { loadDefaultTabAssignees } from "@/lib/boards/default-tab-assignees";
import { legacyMemberPickerEntries, memberPickerEntries } from "@/lib/boards/member-directory";
import { loadOrgChart } from "@/lib/org/departments";
import { recallBoardSource, rememberBoardSource } from "@/lib/boards/board-source-memo";
import { loadPermGuards } from "@/lib/perm/guard";
import { PermissionUnavailable } from "@/components/perm/PermissionUnavailable";
import { loadPermissionScopedWorkItems } from "@/lib/perm/server";
import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import { BoardHeader } from "@/components/board/BoardHeader";
import { NewLeadIntakeForm } from "@/components/board/NewLeadIntakeForm";
import { BoardTrashPanel } from "@/components/board/BoardTrashPanel";
import { BoardArchivePanel } from "@/components/board/BoardArchivePanel";
import { SavedViewsController } from "@/components/view";
import {
  applySavedPersonScope,
  parseSavedBoardLayout,
  parseSavedStringList,
} from "@/lib/view/board-saved";
import { resolveSavedPersonRuntime } from "@/lib/view/server";
import { isTableGroupColumn } from "@/lib/view/group-by";
import { decodeBoardFilters } from "@/components/board/filters";
import { KanbanViewWorkspace } from "@/components/boards/KanbanViewWorkspace";
import { ColumnEditor } from "@/components/boards/ColumnEditor";
import { deleteBoardAction } from "../actions";
import { BoardTrashImpactNotes, quotedObject } from "@/components/workspace-builder/TabTrashSurface";
import { TabSettingsDialog } from "@/components/board/TabSettingsDialog";
import { TabSettingsGeneral } from "@/components/board/TabSettingsGeneral";
import { TabSettingsStages } from "@/components/board/TabSettingsStages";
import { TabTrashDialog } from "@/components/board/TabTrashDialog";
import { TabChromeProvider, type TabSettingsSection } from "@/components/board/tab-chrome";
import { tabSettingsSubtitles, tabStageNote, tabStageRows } from "@/lib/boards/tab-settings";
import { getBoardColumnOrder } from "../groupLayout";
import { presentNewLeadColumns } from "@/lib/default-tabs/new-lead";
import { applyNoticePerspective, parseNoticePerspective, projectNoticeMetadata } from "@/lib/notices/perspectives";
import { NoticePerspectiveNav } from "@/components/notices/NoticePerspectiveNav";
import { BoardActionErrorProvider } from "@/components/board/BoardActionErrorContext";

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
/** 값이 나중에 정해지는 약속 — 스냅샷이 보드 종류를 알려 주면 다음 읽기를 띄운다(Issue 857). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; group?: string; as?: string; savedView?: string; mwLayout?: string; mwHidden?: string; mwOrder?: string; mwFilters?: string; mwSort?: string; mwText?: string; mwFocus?: string; calendarField?: string; noticeView?: string; consultation?: string }>;
}) {
  const startedAt = performance.now();
  const requestHeaders = await headers();
  const traceId = normalizeTraceId(requestHeaders.get("x-mw-trace-id"));
  const requestStartedAt = normalizeRequestStartedAt(requestHeaders.get(REQUEST_START_HEADER));
  const sessionStartedAt = performance.now();
  const { id } = await params;
  const sp = await searchParams;
  // BBE-214 — 두 판정은 같은 회사 id만 소비하고 서로의 결과에 의존하지 않는다.
  // 둘 다 통과하기 전에는 board metadata를 읽지 않으므로 fail-closed 순서는 유지한다.
  const readGuards = (guardOrgId: string) => Promise.all([
    measurePagePhase(startedAt, () => loadPermGuards(guardOrgId, [
        "work.view_tabs",
        "work.item_upsert",
        "work.item_delete",
        "structure.column_manage",
        "structure.section_manage",
        "danger.bulk_edit_delete",
        "danger.csv_export",
        "structure.tab_manage",
      ])),
    measurePagePhase(startedAt, () => loadPermissionScopedWorkItems(guardOrgId)),
  ]);
  // Issue 857 — 판정은 회사 id 만 있으면 된다. 프록시가 이 요청에서 멤버십을 확인해 심은 회사(mw_org)로
  //   세션 확인과 «같이» 출발시키고, 세션이 고른 회사와 다르면 버리고 세션 회사로 다시 판정한다.
  //   판정은 DB 가 이 사람(auth.uid())으로 하므로 일찍 출발해도 권한이 넓어지지 않는다.
  const presetOrgId = (await cookies()).get(SESSION_COOKIE.org)?.value ?? null;
  const earlyGuards = presetOrgId ? readGuards(presetOrgId) : null;
  earlyGuards?.catch(() => {});
  const ctx = applyAs(await getSession(), sp.as);
  const sessionTiming = phaseTiming(startedAt, sessionStartedAt);
  const [permissionsMeasured, scopedItemsMeasured] = await (
    earlyGuards && presetOrgId === ctx.org.id ? earlyGuards : readGuards(ctx.org.id)
  );
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
  const tabManage = permissions["structure.tab_manage"];
  // Permission and D24 scope are resolved before any board metadata or item read.
  if (!scopedItems.ok) notFound();
  const canEditItems = itemUpsert.kind === "allowed";
  const canDeleteItems = itemDelete.kind === "allowed";
  const canManageColumns = columnManage.kind === "allowed";
  const canManageSections = sectionManage.kind === "allowed";
  const canDeleteBoard = boardDelete.kind === "allowed";
  const canManageSummaries = tabManage.kind === "allowed";
  const { client, repo, service: svc } = await createRequestBoards();
  // Issue 857 — 보드 종류를 몰라도 되는 꼬리 읽기(그룹 컬럼 배치)는 두 판정이 통과한 «뒤»,
  //   스냅샷과 같은 물결로 띄운다. 기본 담당자 목록은 보드 종류를 안 순간(메타데이터) 띄운다 —
  //   신규리드는 조직도를 쓰므로 거기서는 읽지 않는다(구성원 수만큼의 RPC 를 버리지 않게).
  const columnOrderRead = getBoardColumnOrder(repo, ctx, id);
  columnOrderRead.catch(() => {});
  const boardSource = deferred<string | null | undefined>();
  const defaultAssigneesRead = boardSource.promise.then((source) =>
    source === NEW_LEAD_TAB_SOURCE && client ? null : loadDefaultTabAssignees(ctx));
  defaultAssigneesRead.catch(() => {});
  // Issue 857 — 신규리드의 조직도, 계약업체 실무의 회사·건 목록도 보드 종류를 안 순간 띄운다(행 읽기와 같은
  //   물결). 전에는 행을 다 읽은 «뒤» 꼬리에서 한 물결 더 기다렸다. 회사별 건수는 행을 읽은 뒤 센다.
  const orgChartRead = boardSource.promise.then((source) =>
    source === NEW_LEAD_TAB_SOURCE && client ? loadOrgChart(ctx, async () => client) : null);
  orgChartRead.catch(() => {});
  const companyPickerSourcesRead = boardSource.promise.then((source) =>
    source === CONTRACT_WORK_TAB_SOURCE ? readCompanyPickerSources(ctx) : null);
  companyPickerSourcesRead.catch(() => {});

  let snapshot;
  // Issue 857 — 이 보드의 종류를 전에 봤으면(종류는 바뀌지 않는다) 판정을 통과한 지금 꼬리 읽기를 띄운다 —
  //   행 읽기와 같은 물결. 처음이면 메타데이터를 읽은 순간(onDetail) 띄운다. 기억이 틀려도 아래 꼬리에서
  //   이번 메타데이터의 종류로 다시 판단하므로 결과는 같다(lib/boards/board-source-memo.ts).
  const rememberedSource = recallBoardSource(id);
  if (rememberedSource !== undefined) boardSource.resolve(rememberedSource);
  const snapshotStartedOffsetMs = performance.now() - startedAt;
  const snapshotTimings: Record<"metadata" | "items" | "hydrate", PagePhaseTiming> = {
    metadata: { offsetMs: snapshotStartedOffsetMs, durationMs: 0 },
    items: { offsetMs: snapshotStartedOffsetMs, durationMs: 0 },
    hydrate: { offsetMs: snapshotStartedOffsetMs, durationMs: 0 },
  };
  // Permission-order contract: svc.loadPageSnapshot(ctx, id, { includeDeleted/includeArchived: canDeleteItems }) runs only after both guards.
  try {
    snapshot = await svc.loadPageSnapshot(ctx, id, {
      includeDeleted: canDeleteItems,
      includeArchived: canDeleteItems,
      onDetail: (loaded) => {
        rememberBoardSource(id, loaded.board.source);
        boardSource.resolve(loaded.board.source);
      },
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
  // Issue 857 — 사이드바가 기본 탭으로 바로 오면 경유지 점검을 안 거친다. 응답 뒤에 대신 돌린다.
  await scheduleDefaultTabRepair(ctx, board.source);
  const canMoveRows = !board.is_system && canEditItems
    && (ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all");
  const view = sp.view === "kanban" ? "kanban" : sp.view === "flat" ? "flat" : sp.view === "calendar" ? "calendar" : "table";
  const selectColumns = columns.filter(
    (c) => c.type === "select" || c.type === "multiselect",
  );
  const groupBy = sp.group && selectColumns.some((c) => c.key === sp.group) ? sp.group : "";
  // #845 7단계 — 메인 표의 나눠 보기는 사람·목록·상태 칸으로 묶는다(칸반 레인은 위 groupBy 그대로).
  const tableGroupBy = sp.group && columns.some((c) => c.key === sp.group && isTableGroupColumn(c)) ? sp.group : "";
  const noticePerspective = parseNoticePerspective(sp.noticeView);
  const visibleItemIds = new Set(scopedItems.result.itemIds);
  const projectedItems = board.source === NOTICE_TAB_SOURCE
    ? applyNoticePerspective(loadedItems.map(projectNoticeMetadata), noticePerspective, ctx.user.id)
    : loadedItems;
  // 읽음 표시는 «쓰기» 다. 로컬 시드에는 그 저장소가 없어 건너뛴다 —
  // 화면에 표시되는 내용은 달라지지 않는다(BBE-209).
  // Issue 857 — 이 화면은 읽음 상태를 그리지 않으므로 응답을 보낸 «뒤에» 표시한다(글마다 RPC 한 물결을 기다렸다).
  if (board.source === NOTICE_TAB_SOURCE && client) {
    const visibleNoticeIds = projectedItems.filter((item) => visibleItemIds.has(item.id)).map((item) => item.id);
    const markRead = () => markNoticeItemsReadAtomic(ctx, visibleNoticeIds, client);
    try {
      after(async () => {
        try {
          await markRead();
        } catch (error) {
          console.warn("[notice read]", id, error);
        }
      });
    } catch {
      // 요청 밖(시험 등)에서는 미룰 곳이 없어 바로 표시한다.
      await markRead();
    }
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
  /*
   * 담당자 목록 · 그룹별 컬럼 배치 · 계약업체 회사 목록은 저장된 보기(사람 범위)나
   * 상담 단계 결과에 의존하지 않는다. 그래서 그 사슬보다 «먼저» 한 물결로 띄우고
   * 뒤에서 받는다 — 사슬이 도는 동안 같이 돈다(#746). 사슬이 먼저 실패해도
   * 처리되지 않은 거부가 남지 않게 catch 를 붙여 두고, 받을 때 원래 오류가 그대로 난다.
   */
  const independentTailReads = Promise.all([
    (async () => {
      // 담당자 탭·칩에 쓸 표시 이름. items.assigned_to 는 사용자 id 라서 이 맵이 없으면 UUID 가 노출된다.
      const orgChart = board.source === NEW_LEAD_TAB_SOURCE && client
        ? (await orgChartRead) ?? await loadOrgChart(ctx, async () => client)
        : null;
      const defaultTabAssignees = orgChart?.kind === "ready"
        ? []
        : (await defaultAssigneesRead) ?? await loadDefaultTabAssignees(ctx);
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
    columnOrderRead,
      board.source === CONTRACT_WORK_TAB_SOURCE
      // 권한(D24)으로 거른 이 보드의 행을 넘긴다 — 회사별 «이 탭에 이미 N건» 의 근거(#6). 새 왕복 없음.
      ? companyPickerSourcesRead.then((sources) => sources
        ? buildCompanyPickerResult(sources, permissionItems)
        : loadCompanyPickerRows(ctx, { boardItems: permissionItems }))
      : Promise.resolve({ rows: [], error: null, truncated: false }),
  ]);
  independentTailReads.catch(() => {});
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
  const items = applySavedPersonScope(permissionItems, personRuntime.view, ctx.user.id, personColumnKey, personRuntime.memberIds, board.source === NEW_LEAD_TAB_SOURCE);
  const hiddenCount = boardItems.length - permissionItems.length;
  /*
   * 상담 단계 보기(?consultation=remote|inperson) — STEP2·STEP3 탭의 자리다.
   * 같은 리드컨택 정본 보드에서 서버가 한 번에 읽은 mode 로 가른다(행마다 조회 없음).
   * 값 검증에 실패하거나 적재에 실패하면 전체 보기로 남고 안내만 덧붙인다 —
   * 기존 리드컨택 URL·보드 호환을 깨지 않는다.
   */
  const requestedConsultationView = board.source === CONTACT_TAB_SOURCE
    ? parseConsultationView(sp.consultation)
    : null;
  let consultationView: ConsultationView = "all";
  let consultationByItem: ConsultationBoardMap = {};
  let consultationViewNotice: string | null = null;
  if (requestedConsultationView) {
    if (!client) {
      consultationViewNotice = "상담 단계 보기는 연결된 워크스페이스에서만 볼 수 있어 전체를 보여줍니다.";
    } else {
      const boardRpc: ConsultationBoardRpcClient = {
        rpc: async (name, args) => {
          const { data, error } = await requireRequestClient(client, "상담 단계 보기").rpc(name, args);
          return { data, error: error ? { message: error.message, code: error.code ?? "" } : null };
        },
      };
      // F7: 보드 행 ID bounded 후보로만 조회한다. 미조회(null)는 특정 보기에 넣지 않는다(F5).
      const loaded = await loadConsultationBoardView(boardRpc, {
        orgId: ctx.org.id,
        boardId: id,
        visibleItemIds,
        candidateItemIds: items.map((item) => item.id),
      });
      if (loaded.ok) {
        consultationView = requestedConsultationView;
        consultationByItem = loaded.entries;
      } else {
        consultationViewNotice = `상담 단계 보기를 읽지 못해 전체를 보여줍니다. (${loaded.message})`;
      }
    }
  }
  const stageItems = consultationView === "all"
    ? items
    : items.filter((item) => consultationModeForRow(item.id, consultationByItem) === consultationView);
  const canonicalNewLead = board.source === NEW_LEAD_TAB_SOURCE;
  const savedViewColumns = canonicalNewLead ? presentNewLeadColumns(columns) : columns;
  // 주소의 보기 조건(mwFilters) — 칸반·목록·캘린더가 첫 화면부터 같은 조건으로 그린다(#845 6단계).
  const urlFilters = decodeBoardFilters(sp.mwFilters ?? null);
  // 칸반 레인은 권한·상담 단계로만 거른다. 보기 조건은 KanbanViewWorkspace 가 바로 적용한다(applySavedKanbanView).
  const lanes = view === "kanban"
    ? svc.kanbanFromSnapshot(snapshot, groupBy || undefined).map((lane) => ({ ...lane, items: lane.items.filter((item) => visibleItemIds.has(item.id) && (consultationView === "all" || consultationModeForRow(item.id, consultationByItem) === consultationView)) }))
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

  const [assigneeBundle, savedColumnOrder, contractWorkCompanyPicker] = await independentTailReads;
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

  const backLink = (
    <WorkspaceLink
      href="/boards"
      aria-label="보드 목록으로"
      className="shrink-0 rounded-full px-1.5 text-sm text-mw-sub hover:text-mw-fg"
    >
      ←
    </WorkspaceLink>
  );

  // #845 6단계 — 보기 방식(표·칸반·캘린더)·뷰 탭·보기 조건은 모든 보기가 같은 보기 줄(BoardViewBar) 하나로 고른다.
  const savedViewId = personRuntime.view ? (sp.savedView ?? null) : null;
  const calendarAvailable = columns.some((column) => column.type === "date" || column.type === "datetime");
  const groupByOptions = selectColumns.map((column) => ({ key: column.key, label: column.label }));

  /*
   * #845 개선안(2026-10-08 대표 결정) — 옛 「⚙ 보드 설정」 펼침 대신 머리말 오른쪽 위 「탭 설정」 대화상자.
   *   일반(이름·아이콘·설명) = 탭 관리 권한 · 항목(컬럼) = 컬럼 관리 권한 · 단계(그룹) = 그룹 관리 권한.
   *   업무 양식(그룹별 열 묶음 저장)과 「그룹 순서」 칸은 빠졌다 — 순서·이름·추가는 «단계» 칸 한곳에서 한다.
   * 시스템 보드와 권한이 하나도 없는 사람에게는 단추·▾ 설정 항목이 없다.
   */
  const settingsSections: TabSettingsSection[] = board.is_system ? [] : [
    ...(canManageSummaries ? ["general" as const] : []),
    ...(canManageColumns ? ["fields" as const] : []),
    ...(canManageSections ? ["stages" as const] : []),
  ];
  const stageRows = canManageSections ? tabStageRows(board.source, columns, groups, permissionItems) : [];
  const tabSettingsDialog = settingsSections.length > 0 ? (
    <TabSettingsDialog
      subtitles={tabSettingsSubtitles(board.source, columns.length, groups.length)}
      general={canManageSummaries ? (
        <TabSettingsGeneral boardId={id} name={board.name} icon={board.icon} source={board.source} description={board.description} />
      ) : undefined}
      fields={canManageColumns ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-mw-sub">이 탭이 기록하는 정보예요. 여기서 추가하고, 표 머리말 메뉴에서 이름·종류·선택지·순서·숨김을 바꿔요. 숨긴 항목은 여기서 되살려요.</p>
          <ColumnEditor boardId={id} columns={columns} />
        </div>
      ) : undefined}
      stages={canManageSections ? (
        <TabSettingsStages boardId={id} stages={stageRows} note={tabStageNote(board.source)} />
      ) : undefined}
    />
  ) : undefined;

  /* #849 탭 삭제 = 휴지통. 제목 ▾ 「휴지통으로 이동」 이 여는 확인 안에 지울 내용 개수를 보인다 —
     Issue 857: 개수는 확인을 열 때 화면이 따로 읽는다(GET /api/boards/[id]/trash-impact). 보드를 열 때마다 세지 않는다. */
  const tabTrashDialog = !board.is_system && canDeleteBoard ? (
    <TabTrashDialog boardId={id} title={`${quotedObject(board.name)} 휴지통으로 옮길까요?`} deleteAction={deleteBoardAction}>
      <BoardTrashImpactNotes boardId={id} />
    </TabTrashDialog>
  ) : undefined;

  const trashPanel = (
    <BoardTrashPanel boardId={id} items={deletedItems} groups={groups} />
  );

  // 별도 보관 목록 — 휴지통과 독립. 위 loadPageSnapshot 호출문은
  // 권한 순서 계약(boards-ui-gating)이 읽으므로 그대로 두고, 스냅샷이 같은 관문·같은 물결의
  // 보관 읽기로 분리한 archivedItems를 쓴다 (직렬 단계 추가 없음 — BBE-214 유지).
  const archivePanel = (
    <BoardArchivePanel boardId={id} items={snapshot.archivedItems} groups={groups} />
  );

  // 칸반·달력 보기도 같은 「탭 설정」·「휴지통으로 이동」 을 연다 — 열림 상태는 제공자가 든다.
  const alternateViewHeader=(
    <TabChromeProvider settings={tabSettingsDialog} settingsSections={settingsSections} trash={tabTrashDialog}>
    <BoardHeader
      boardId={id}
      icon={board.icon}
      source={board.source}
      name={board.name}
      description={board.description}
      groups={groups}
      readOnly={board.is_system||!canEditItems}
      canEditTitle={!board.is_system&&canManageSummaries}
      backSlot={backLink}
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
    </TabChromeProvider>
  );

  const boardContent = view === "kanban" ? (
    <>
        {alternateViewHeader}
        {/* 보드 이름 아래 — 표와 같은 보기 줄 하나(BBE-214 순서 · #845 6단계). 레인 기준도 그 줄의 「나눠 보기」 로 고른다. */}
        <KanbanViewWorkspace
          boardId={id}
          currentUserId={ctx.user.id}
          lanes={lanes}
          items={stageItems}
          columns={savedViewColumns}
          canonicalNewLead={canonicalNewLead}
          initialFilters={urlFilters}
          groupBy={groupBy}
          groupByOptions={groupByOptions}
          assigneeLabels={assigneeLabels}
          activeViewId={savedViewId}
          calendarAvailable={calendarAvailable}
          loadSavedViews
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
        <SavedViewsController boardId={id} orgId={ctx.org.id} currentUserId={ctx.user.id} teamMemberIds={personRuntime.memberIds} columns={visibleColumns} rows={stageItems} renderMode={view} boardSource={board.source} canEditItems={canEditItems} canBulkEditItems={boardDelete.kind === "allowed"} canDeleteItems={canDeleteItems} canExportItems={permissions["danger.csv_export"].kind === "allowed"} canonicalNewLead={canonicalNewLead} memberOptions={memberDirectory} groups={groups} rowOrderVersion={board.row_order_version??0} canMoveRows={canMoveRows} canManageColumns={canManageColumns} canManageSections={canManageSections} isSystem={board.is_system}
          initialFilters={urlFilters} initialSearch={currentQuery.toString()} savedViewId={savedViewId} loadSavedViews />
    </>
  ) : (
    <BoardWorkspace
      board={board}
      columns={visibleColumns}
      summaryColumns={columns}
      groups={groups}
      rows={stageItems}
      // 계약업체 실무에서만 채워진다 — 다른 보드는 빈 배열이라 «업체 추가» 가 뜨지 않는다.
      contractWorkCompanyPicker={contractWorkCompanyPicker}
      startCompanyWorkAction={startCompanyWorkFromBoardAction}
      startNewCompanyWorkAction={startCompanyWorkFromNewCompanyAction}
      addLabelOptionAction={addBoardLabelOptionAction}
      // 같은 «추가» 를 두 번 눌러도 건이 둘 생기지 않게 하는 열쇠. 서버가 발급한다.
      columnOrder={activeColumnOrder}
      cellFlash={cellFlash}
      assigneeLabels={assigneeLabels}
      memberDirectory={memberDirectory}
      backSlot={backLink}
      groupBy={tableGroupBy}
      loadSavedViews
      calendarAvailable={calendarAvailable}
      tabSettingsSlot={tabSettingsDialog}
      tabSettingsSections={settingsSections}
      tabTrashSlot={tabTrashDialog}
      onboardingSlot={board.source === NEW_LEAD_TAB_SOURCE ? (
        <NewLeadOnboarding />
      ) : undefined}
      canEditItems={canEditItems}
      editLockedColumnKeys={columns.filter((column) => !columnPolicyAllows(ctx, column.edit_policy_jsonb)).map((column) => column.key)}
      canDeleteItems={canDeleteItems}
      canBulkEditItems={boardDelete.kind === "allowed"}
      canExportItems={permissions["danger.csv_export"].kind === "allowed"}
      canManageColumns={canManageColumns}
      canManageSections={canManageSections}
      canManageSummaries={canManageSummaries}
      canMoveRows={canMoveRows}
      savedViewActive={Boolean(personRuntime.view)}
      savedViewId={savedViewId}
      currentUserId={ctx.user.id}
      consultationView={consultationView}
      consultationByItem={consultationByItem}
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
      {consultationViewNotice ? (
        <p className="text-xs text-mw-sub">{consultationViewNotice}</p>
      ) : null}
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
      {/* 상세 패널은 화면 전체를 덮어 위 배너를 가린다 — 같은 사유를 패널 안에서도 읽게 흘린다(#654). */}
      <BoardActionErrorProvider message={boardActionError}>{boardContent}</BoardActionErrorProvider>

      {trashPanel}

      {archivePanel}
    </div>
  );
}
