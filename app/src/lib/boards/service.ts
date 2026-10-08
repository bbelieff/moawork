/**
 * 임의 보드 서비스 (T02b · ADR-0003).
 * 포트(BoardsRepo) 위에서 보드/컬럼/아이템/셀 오케스트레이션.
 *
 * 두 갈래 구분:
 *  - 시스템 보드(is_system, source='core.crm.pipeline') = 정책자금 파이프라인.
 *    데이터는 001 deals/stages 에 있고 여기선 **메타만** 다룬다 → 컬럼/아이템 편집 금지.
 *  - 사용자 보드 = 003 boards/items EAV. 자유롭게 컬럼·행 추가/편집.
 */

import type { Ctx, FieldOption } from "@/lib/types";
import { createRequestBoardsRepo } from "./request-repo";
import type {
  BoardPatch,
  BoardsRepo,
  ColumnPatch,
  ItemPatch,
  RowMoveRequest,
  RowMoveReceipt,
  NewBoard,
  NewColumn,
  NewGroup,
  NewItem,
  NewView,
  ViewPatch,
} from "./store";
import type {
  Board,
  BoardColumn,
  BoardDetail,
  BoardItem,
  BoardTrashImpact,
  BoardView,
  CellValue,
  DefaultTabDismissal,
  ItemWithValues,
} from "./types";
import { compareCells, isEmptyCell, validateCell } from "./cells";
import { planStageBackSync, resolveMoveTarget } from "./moveRules";
import {
  classifyRowMoveFailure,
  ROW_MOVE_FAILURE_MESSAGES,
  ROW_MOVE_VALUE_ONLY_NOTICE,
  UserFacingActionError,
} from "./boardActionFlash";
import {
  countLiveRowsByGroup,
  groupLinkedStageColumnKey,
  isGroupLinkedStageColumn,
  LINKED_STAGE_EDIT_MESSAGE,
  linkedStageSyncNeedsLiveRowCounts,
  planLinkedStageSync,
} from "./stage-link";
import { isIntegrityField } from "@/lib/custom/field-types";
import { isSourceEditable } from "@/lib/field/source";
import { isSectionPresetSource } from "@/lib/presets/section-presets";
import { pickDefaultView } from "@/lib/custom/views";
import { resolveBoardDetailLayout, resolveDetailLayout } from "./detail-layout";
import { parseBoardSummarySettingsRequest, type BoardSummarySettingsReceipt } from "./summary-settings";

export class NotFoundError extends Error {
  constructor(message = "찾을 수 없습니다") {
    super(message);
    this.name = "NotFoundError";
  }
}
export class BoardRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardRuleError";
  }
}

/** 저장되지 않은 셀 1건의 사유 — 화면에 인라인으로 표시한다. */
export interface CellError {
  key: string;
  label: string;
  message: string;
}

/**
 * 되돌리기 스냅샷 — 편집 직전 상태. 그대로 `undoCells()` 에 넘기면 원복된다.
 * 값 자체를 재검증해 이동 규칙을 다시 태우는 방식(재기입)이 아니라, 이전 group_id 를
 * **명시적으로 복원**한다 — 재기입 방식은 "이동 규칙이 없던 값"(예: 빈 값)에서
 * "규칙 있는 값"으로 바뀐 편집을 되돌릴 때 원래 그룹을 못 찾는 결함이 있다.
 */
export interface CellEditUndo {
  /** 이번 호출에서 실제로 저장된 키들의 **편집 전** 값. */
  values: Record<string, CellValue>;
  /** 편집 전 group_id(이동이 없었어도 항상 채운다 — 복원은 그냥 대입이라 안전하다). */
  group_id: string | null;
}

/** 셀 편집 결과 — 통과분은 저장됐고, 실패분은 errors 로 보고된다. */
export interface SetCellsResult {
  item: ItemWithValues;
  /** 저장되지 «않은» 칸과 그 사유. 비어 있으면 요청한 값은 전부 저장됐다. */
  errors: CellError[];
  /**
   * 저장은 «됐지만» 알릴 것(예: 옮길 그룹이 없어 값만 저장하고 행은 그대로 둠).
   * 실패가 아니다 — errors 에 섞으면 `errors.length > 0` 을 실패로 읽는 호출부가
   * 이미 커밋된 저장을 실패로 표시한다(BBE-183·193·201 과 같은 결함). 그래서 따로 싣는다.
   */
  notices: CellError[];
  /** 저장된 값이 하나도 없으면(전부 실패) null. */
  undo: CellEditUndo | null;
}

/** strict 쌍원자 저장의 실제 커밋 범위 — touch 실패처럼 값은 반영됐는데 후처리가 실패한 경우를 꾸미지 않기 위함. */
export type StrictCellCommit = "none" | "partial" | "all" | "unknown";

export interface SetCellsStrictResult extends SetCellsResult {
  /**
   * 이번 호출로 실제로 반영된 범위. `none` 일 때만 "저장하지 않음"이라 말한다.
   * `unknown` 은 쓰기 자체는 성공했으나 최종 재조회가 안 돼 반영을 확인하지 못한
   * 경우다 — 저장 거부(none/partial)와 post-commit 확인불가를 구분한다.
   */
  committed: StrictCellCommit;
  /** 커밋 범위가 `all` 이 아니거나 쓰기 후 확인에 실패했을 때의 설명. */
  commitDetail: string | null;
}

/** 보드 화면 한 번을 그리는 데 필요한 읽기 스냅샷. */
export interface BoardPageSnapshot {
  detail: BoardDetail;
  items: ItemWithValues[];
  deletedItems: ItemWithValues[];
  /** 153-draft 별도 보관 (휴지통과 독립). includeArchived가 거짓이면 빈 배열. */
  archivedItems: ItemWithValues[];
}

export type BoardPageSnapshotTimingPhase = "metadata" | "items" | "hydrate";

export interface BoardPageSnapshotTiming {
  phase: BoardPageSnapshotTimingPhase;
  offsetMs: number;
  durationMs: number;
}

export interface KanbanLane {
  key: string;
  label: string;
  color: string | null;
  items: ItemWithValues[];
}

/** 행을 다른 그룹으로 옮길 수 있는 사람 — move_board_row_atomic 의 관문과 같다(owner/admin 또는 scope=all). */
function canMoveRows(ctx: Ctx): boolean {
  return ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all";
}

/**
 * 컬럼의 편집·보기 제한(`edit_policy_jsonb`·`view_policy_jsonb`)이 이 사용자에게 열려 있는가.
 *
 * DB `board_column_policy_allows`(089) 와 같은 규칙이다 — 빈 정책(없음·`{}`)이면 허용하고,
 * `roles`·`scopes`·`userIds` 는 «있는 키만» 모두 맞아야 한다(roles∋role, scopes∋scope, userIds∋user.id).
 * 키는 있는데 배열이 아니면 닫힌 쪽(false)으로 본다. 이 판정은 «값을 같이 쓸 수 있는가» 에만 쓰므로,
 * 닫혀도 행 이동 자체는 값 없이 그대로 진행된다.
 */
export function columnPolicyAllows(ctx: Ctx, policy: Readonly<Record<string, unknown>> | null | undefined): boolean {
  if (!policy || Object.keys(policy).length === 0) return true;
  const matches = (key: string, actual: string): boolean => {
    if (!Object.prototype.hasOwnProperty.call(policy, key)) return true;
    const allowed = policy[key];
    return Array.isArray(allowed) && allowed.includes(actual);
  };
  return matches("roles", ctx.role) && matches("scopes", ctx.scope) && matches("userIds", ctx.user.id);
}

/** 패치에서 이동 규칙이 정하는 최종 목적지 — 패치 순서상 나중 키가 이긴다. */
function ruleMoveTarget(
  columns: readonly BoardColumn[],
  values: Record<string, CellValue>,
): { target: string; key: string } | null {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  let decided: { target: string; key: string } | null = null;
  for (const [key, value] of Object.entries(values)) {
    const column = byKey.get(key);
    if (!column) continue;
    const resolved = resolveMoveTarget(column, value);
    if (resolved !== null) decided = { target: resolved, key };
  }
  return decided;
}

/** 아는 행 이동 실패는 사람 말로 바꾸고, 모르는 실패는 원래 예외 그대로 다시 던진다. */
function toRowMoveError(error: unknown): unknown {
  const failure = classifyRowMoveFailure(error);
  return failure ? new UserFacingActionError(ROW_MOVE_FAILURE_MESSAGES[failure]) : error;
}

/** 새 보드에 기본 제공되는 컬럼(빈 보드가 바로 쓸 수 있도록). */
export const DEFAULT_NEW_BOARD_COLUMNS: NewColumn[] = [
  {
    key: "status",
    label: "상태",
    type: "select",
    options: [
      { id: "opt-todo", label: "대기", color: "#c4c4c4", order: 0 },
      { id: "opt-doing", label: "진행중", color: "#fdab3d", order: 1 },
      { id: "opt-done", label: "완료", color: "#00c875", order: 2 },
    ],
  },
  { key: "owner", label: "담당", type: "person" },
  { key: "due", label: "마감일", type: "date" },
];

export class BoardsService {
  private readonly repo: Promise<BoardsRepo>;
  constructor(repo?: BoardsRepo) { this.repo = repo ? Promise.resolve(repo) : createRequestBoardsRepo(); }

  // ── 보드 ──
  async listBoards(ctx: Ctx): Promise<Board[]> {
    return (await this.repo).listBoards(ctx);
  }

  // BBE-214 — 세 읽기는 서로를 «입력으로 쓰지 않는다». 줄 세우면 왕복 지연이 3배로 쌓인다.
  // 실측(page.roundtrips.test.tsx): 이 메서드가 한 화면에서 3번 불리므로 직렬 3단계 × 3 = 9단계였다.
  // 병렬로 바꿔도 관측되는 동작은 같다 — 보드가 없으면 여전히 NotFoundError 를 던진다.
  // (없는 보드에도 columns·groups 질의가 나가지만 org 범위 안의 빈 결과라 부작용이 없다.)
  async getBoardDetail(ctx: Ctx, boardId: string): Promise<BoardDetail> {
    const repo = await this.repo;
    const [board, columns, groups] = await Promise.all([
      repo.getBoard(ctx, boardId),
      repo.listColumns(ctx, boardId),
      repo.listGroups(ctx, boardId),
    ]);
    if (!board) throw new NotFoundError("보드를 찾을 수 없습니다");
    return { board, columns, groups };
  }

  /**
   * 사용자 보드 생성 — 기본 컬럼 2~3개를 함께 프로비저닝.
   * 169 부터는 RPC 가 사용자 탭에 기본 아이템·열을 같이 만든다. 열이 비어 있을 때만 채운다(로컬·옛 RPC).
   */
  async createBoard(ctx: Ctx, input: NewBoard, requestId = crypto.randomUUID()): Promise<BoardDetail> {
    const repo = await this.repo;
    const board = await repo.createBoard(ctx, input, requestId);
    const existingColumns = await repo.listColumns(ctx, board.id);
    if (existingColumns.length === 0) {
      for (const col of DEFAULT_NEW_BOARD_COLUMNS) {
        await repo.createColumn(ctx, board.id, col);
      }
    }
    return this.getBoardDetail(ctx, board.id);
  }

  async updateBoard(ctx: Ctx, boardId: string, patch: BoardPatch): Promise<Board> {
    const board = await this.requireEditableBoard(ctx, boardId);
    const updated = await (await this.repo).updateBoard(ctx, board.id, patch);
    if (!updated) throw new NotFoundError("보드를 찾을 수 없습니다");
    return updated;
  }

  async applyBoardSummarySettings(ctx: Ctx, boardId: string, request: unknown): Promise<BoardSummarySettingsReceipt> {
    const board = await this.requireEditableBoard(ctx, boardId);
    const parsed = parseBoardSummarySettingsRequest(request);
    return (await this.repo).applyBoardSummarySettings(ctx, board.id, parsed);
  }

  async reorderBoards(ctx: Ctx, boardIds: readonly string[], requestId: string): Promise<Board[]> {
    if (!requestId || new Set(boardIds).size !== boardIds.length) throw new BoardRuleError("보드 순서를 다시 확인해 주세요");
    const boards = await this.listBoards(ctx);
    const editableIds = boards.filter((board) => !board.is_system).map((board) => board.id).sort();
    const suppliedIds = [...boardIds].sort();
    if (editableIds.length !== suppliedIds.length || editableIds.some((id, index) => id !== suppliedIds[index])) {
      throw new NotFoundError("보드 순서를 저장할 대상을 찾을 수 없습니다");
    }
    return (await this.repo).reorderBoards(ctx, boardIds, requestId);
  }

  /** #849 — 탭 삭제 = 휴지통(7일 안에 그대로 복구). 이름은 기존 호출부를 위해 남긴다. */
  async deleteBoard(ctx: Ctx, boardId: string): Promise<void> {
    await this.trashBoard(ctx, boardId);
  }

  // ── 탭 휴지통 (#849) ── 권한(danger.bulk_edit_delete)은 액션과 RPC 가 본다.
  async trashBoard(ctx: Ctx, boardId: string): Promise<Board> {
    const repo = await this.repo;
    if (!await repo.getBoard(ctx, boardId)) {
      // 두 번 눌렀거나 다른 창에서 이미 지웠다 — 휴지통에 있으면 그대로 성공으로 본다.
      const trashed = (await repo.listTrashedBoards(ctx)).find((candidate) => candidate.id === boardId);
      if (trashed) return trashed;
    }
    const board = await this.requireEditableBoard(ctx, boardId);
    if (isSectionPresetSource(board.source)) {
      throw new BoardRuleError("아이템 프리셋은 프리셋 화면에서 지워 주세요");
    }
    return repo.trashBoard(ctx, board.id);
  }

  async listTrashedBoards(ctx: Ctx): Promise<Board[]> {
    return (await this.repo).listTrashedBoards(ctx);
  }

  async restoreBoard(ctx: Ctx, boardId: string): Promise<Board> {
    const board = await this.requireTrashedBoard(ctx, boardId);
    return (await this.repo).restoreBoard(ctx, board.id);
  }

  /** 휴지통 탭만 지금 완전히 지운다. 정리할 저장소 파일 수를 돌려준다. */
  async purgeBoard(ctx: Ctx, boardId: string): Promise<number> {
    const board = await this.requireTrashedBoard(ctx, boardId);
    return (await this.repo).purgeBoard(ctx, board.id);
  }

  async purgeExpiredBoards(ctx: Ctx): Promise<number> {
    return (await this.repo).purgeExpiredBoards(ctx);
  }

  /** 휴지통에 보내기 전 확인 창에 보여 줄 개수. */
  async readBoardTrashImpact(ctx: Ctx, boardId: string): Promise<BoardTrashImpact> {
    const board = await this.requireEditableBoard(ctx, boardId);
    return (await this.repo).readBoardTrashImpact(ctx, board.id);
  }

  async listDefaultTabDismissals(ctx: Ctx): Promise<DefaultTabDismissal[]> {
    return (await this.repo).listDefaultTabDismissals(ctx);
  }

  /** «기본 탭 다시 설치» 전 단계 — 지운 기록만 지운다. 빈 탭은 기본 탭 설치 경로가 만든다. */
  async clearDefaultTabDismissal(ctx: Ctx, source: string): Promise<boolean> {
    if (!source.startsWith("core.default-tab/")) throw new BoardRuleError("기본 탭만 다시 설치할 수 있어요");
    return (await this.repo).clearDefaultTabDismissal(ctx, source);
  }

  /** 휴지통 탭은 getBoard 에 안 보인다 — 휴지통 목록에서 찾는다. */
  private async requireTrashedBoard(ctx: Ctx, boardId: string): Promise<Board> {
    const board = (await (await this.repo).listTrashedBoards(ctx)).find((candidate) => candidate.id === boardId);
    if (!board) throw new NotFoundError("휴지통에서 탭을 찾을 수 없습니다. 새로고침 후 다시 확인해 주세요");
    return board;
  }

  // ── 컬럼 ──
  async addColumn(ctx: Ctx, boardId: string, input: NewColumn): Promise<BoardColumn> {
    await this.requireEditableBoard(ctx, boardId);
    return (await this.repo).createColumn(ctx, boardId, input);
  }

  // BBE-196 — requireEditableBoard 는 «boardId 를 편집할 수 있는가» 만 본다.
  // columnId 가 «그 boardId 소속인가» 는 별개 질문이라, 편집 가능한 보드 아무거나 하나만
  // 있으면 그것을 통행증 삼아 다른 보드의 컬럼을 지울 수 있었다(실증됨). 삭제 전에
  // 반드시 소속을 확인한다. repo 층에도 org+board+column 조건을 넘겨 두 층이 같은
  // 소유권 경계를 지키게 한다 — 어느 한쪽만 우회돼도 다른 쪽이 삭제를 막는다.
  private async requireColumnInBoard(ctx: Ctx, boardId: string, columnId: string): Promise<BoardColumn> {
    const columns = await (await this.repo).listColumns(ctx, boardId);
    const column = columns.find((c) => c.id === columnId);
    if (!column) throw new NotFoundError("컬럼을 찾을 수 없습니다");
    return column;
  }

  async updateColumn(ctx: Ctx, boardId: string, columnId: string, patch: ColumnPatch): Promise<BoardColumn> {
    const board = await this.requireEditableBoard(ctx, boardId);
    const column = await this.requireColumnInBoard(ctx, boardId, columnId);
    // 2026-10-06(#845) — 그룹과 연결된 단계 칸의 선택지·이동 규칙은 그룹이 정한다. 손으로 고치면
    //   다음 동기화가 되돌리거나 «단계 = 그룹» 이 깨진다. 이름·순서는 그룹(띠)에서 바꾼다.
    if ((patch.options !== undefined || patch.moveRule !== undefined) && isGroupLinkedStageColumn(board.source, column)) {
      throw new UserFacingActionError(LINKED_STAGE_EDIT_MESSAGE);
    }
    const col = await (await this.repo).updateColumn(ctx, columnId, patch);
    if (!col) throw new NotFoundError("컬럼을 찾을 수 없습니다");
    return col;
  }

  async reorderColumns(ctx: Ctx, boardId: string, columnIds: readonly string[]): Promise<BoardColumn[]> {
    await this.requireEditableBoard(ctx, boardId);
    return (await this.repo).reorderColumns(ctx, boardId, columnIds);
  }

  async deleteColumn(ctx: Ctx, boardId: string, columnId: string): Promise<void> {
    await this.requireEditableBoard(ctx, boardId);
    await this.requireColumnInBoard(ctx, boardId, columnId);
    if (!await (await this.repo).deleteColumn(ctx, boardId, columnId)) throw new NotFoundError("컬럼을 찾을 수 없습니다");
  }

  async listArchivedColumns(ctx: Ctx, boardId: string): Promise<BoardColumn[]> {
    await this.requireEditableBoard(ctx, boardId);
    return (await this.repo).listArchivedColumns(ctx, boardId);
  }

  async restoreColumn(ctx: Ctx, boardId: string, columnId: string): Promise<BoardColumn> {
    await this.requireEditableBoard(ctx, boardId);
    const restored = await (await this.repo).restoreColumn(ctx, boardId, columnId);
    if (!restored) throw new NotFoundError("복구할 컬럼을 찾을 수 없습니다");
    return restored;
  }

  // ── 그룹 ──
  // 2026-10-06(#845) — 그룹을 더하거나·이름을 바꾸거나·순서를 바꾸면 연결된 단계 칸(계약업체 실무
  //   진행현황)도 함께 맞춘다(syncLinkedStage). 모든 그룹 쓰기 경로(보드 화면·띠 제목 편집·워크스페이스
  //   빌더·섹션 프리셋 적용)가 이 세 메서드를 지난다.
  async addGroup(ctx: Ctx, boardId: string, input: NewGroup) {
    const board = await this.requireEditableBoard(ctx, boardId);
    const group = await (await this.repo).createGroup(ctx, boardId, input);
    await this.syncLinkedStage(ctx, board);
    return group;
  }

  async reorderGroups(ctx: Ctx, boardId: string, groupIds: readonly string[]) {
    const board = await this.requireEditableBoard(ctx, boardId);
    if (groupIds.length === 0 || new Set(groupIds).size !== groupIds.length) {
      throw new BoardRuleError("그룹 순서가 올바르지 않습니다");
    }
    const groups = await (await this.repo).reorderGroups(ctx, boardId, groupIds);
    await this.syncLinkedStage(ctx, board);
    return groups;
  }

  async renameGroup(ctx: Ctx, boardId: string, groupId: string, name: string) {
    const board = await this.requireEditableBoard(ctx, boardId);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) throw new BoardRuleError("그룹 이름은 1~100자로 입력해 주세요");
    const group = await (await this.repo).updateGroup(ctx, boardId, groupId, { name: trimmed });
    if (!group) throw new NotFoundError("그룹을 찾을 수 없습니다");
    await this.syncLinkedStage(ctx, board);
    return group;
  }

  /**
   * 그룹 ↔ 단계 연결(#845) — 단계 라벨 = 그룹 이름, 단계 순서 = 그룹 순서, 새 그룹엔 새 단계.
   * 선택지 id 는 그대로라 저장된 값(`item_values`)은 계속 유효하다. 바뀔 것이 없으면 쓰지 않는다.
   *
   * 빈 설치기 복제를 가리려고 행 수가 필요하면, 전체 행을 볼 수 있는 사람일 때만 읽는다 — 담당 범위
   * 사용자는 RLS 로 일부 행만 보여 «비었다» 를 잘못 판단할 수 있다. 그때는 «증거» 로만 판단한다.
   *
   * 그룹 쓰기는 이미 커밋됐다. 동기화가 실패해도 그 성공을 실패로 바꾸지 않는다(BBE-183·193·201) —
   * 기록만 남기고, 다음 그룹 변경이나 owner/admin 진입 repair(readDefaultTabBoardDrift)가 다시 맞춘다.
   */
  private async syncLinkedStage(ctx: Ctx, board: Board): Promise<void> {
    if (!groupLinkedStageColumnKey(board.source)) return;
    try {
      const repo = await this.repo;
      const [columns, groups] = await Promise.all([repo.listColumns(ctx, board.id), repo.listGroups(ctx, board.id)]);
      const liveRowCounts = canMoveRows(ctx) && linkedStageSyncNeedsLiveRowCounts(board.source, columns, groups)
        ? countLiveRowsByGroup(await repo.listItems(ctx, board.id))
        : undefined;
      const patch = planLinkedStageSync(board.source, columns, groups, liveRowCounts);
      if (patch) await repo.updateColumn(ctx, patch.columnId, { options: patch.options, moveRule: patch.moveRule });
    } catch (error) {
      console.error("[board stage sync]", board.id, error);
    }
  }

  // ── 아이템 + 셀 ──
  // BBE-214 — 보드 메타(컬럼)와 아이템 목록은 서로 독립이다. 같이 발행한다.
  // 보드가 없으면 getBoardDetail 이 거부하므로 NotFoundError 는 그대로 나간다.
  async listItems(ctx: Ctx, boardId: string): Promise<ItemWithValues[]> {
    const [detail, items] = await Promise.all([
      this.getBoardDetail(ctx, boardId),
      this.repo.then((repo) => repo.listItems(ctx, boardId)),
    ]);
    // 153-draft 별도 보관 행은 활성 목록에서 뺀다 (읽기는 한 번, 분리는 메모리에서 — BBE-214 왕복 예산 유지).
    return this.compose(ctx, items.filter((item) => !item.archived_at), detail);
  }

  async listDeletedItems(ctx: Ctx, boardId: string): Promise<ItemWithValues[]> {
    const [detail, items] = await Promise.all([
      this.getBoardDetail(ctx, boardId),
      this.repo.then((repo) => repo.listDeletedItems(ctx, boardId)),
    ]);
    return this.compose(ctx, items, detail);
  }

  /**
   * 보관 목록 — 휴지통과 같은 가시성 등급의 권한 뒤에 같은 읽기 파동으로 읽힌다.
   * 보통 목록·검색·칸반·집계는 listItems(보관 제외)를 쓰므로 보관 행이 새지 않는다.
   */
  async listArchivedItems(ctx: Ctx, boardId: string): Promise<ItemWithValues[]> {
    const [detail, items] = await Promise.all([
      this.getBoardDetail(ctx, boardId),
      this.repo.then((repo) => repo.listArchivedItems(ctx, boardId)),
    ]);
    return this.compose(ctx, items, detail);
  }

  /** 보관 행은 복구 전에는 보통 수정·이동·삭제 경로에서 거부한다. */
  private async requireActiveItem(ctx: Ctx, itemId: string): Promise<void> {
    const archived = await (await this.repo).getArchivedItem(ctx, itemId);
    if (archived) {
      throw new BoardRuleError("보관된 항목입니다. 보관 목록에서 복구한 뒤 수정할 수 있습니다.");
    }
  }

  /**
   * 보드 화면용 일관 스냅샷.
   *
   * 메타데이터는 한 번만 읽고, 활성/보관/휴지통 행은 같은 물결에서 가져온 뒤 셀 값도
   * 한 번만 수화한다 (직렬 단계는 metadata→items→hydrate 그대로 — BBE-214 유지).
   * 휴지통·보관 권한이 없으면 해당 query와 그 값 ID를 아예 발행하지 않는다.
   * 시스템 보드는 기존 화면 계약대로 휴지통·보관을 읽지 않는다.
   */
  async loadPageSnapshot(
    ctx: Ctx,
    boardId: string,
    options: {
      includeDeleted?: boolean;
      includeArchived?: boolean;
      onTiming?: (timing: BoardPageSnapshotTiming) => void;
    } = {},
  ): Promise<BoardPageSnapshot> {
    const startedAt = performance.now();
    const measure = (
      phase: BoardPageSnapshotTimingPhase,
      phaseStartedAt: number,
    ) => {
      if (!options.onTiming) return;
      const finishedAt = performance.now();
      const finiteNonnegative = (value: number) => Number.isFinite(value) && value >= 0 ? value : 0;
      options.onTiming({
        phase,
        offsetMs: finiteNonnegative(phaseStartedAt - startedAt),
        durationMs: finiteNonnegative(finishedAt - phaseStartedAt),
      });
    };

    const metadataStartedAt = performance.now();
    const repo = await this.repo;
    // 보관 목록은 휴지통과 같은 가시성 등급(work.item_delete)으로 같은 스냅샷에서 분리한다.
    // 명시 옵션이 없으면 includeDeleted를 따른다 — 호출문(권한 순서 계약)을 바꾸지 않고도
    // 보관 패널이 휴지통과 같은 관문 뒤에 같은 왕복으로 읽힌다.
    const wantsDeleted = options.includeDeleted === true;
    const wantsArchived = (options.includeArchived ?? options.includeDeleted) === true;
    const itemsStartedAt = metadataStartedAt;
    // Issue 857 — 보드 정보와 행 목록은 서로 기다리지 않는다(한 물결: metadata ‖ items → hydrate).
    //   행 읽기는 RLS·org 범위 그대로라, 보드를 못 찾으면 아래에서 NotFound 로 끝나고 읽은 행은 버린다.
    //   시스템 보드는 휴지통·보관 행을 쓰지 않으므로 같이 읽었더라도 버린다.
    const [detail, visibleItems, deletedCandidates, archivedCandidates] = await Promise.all([
      this.getBoardDetail(ctx, boardId).then((loaded) => {
        measure("metadata", metadataStartedAt);
        return loaded;
      }),
      repo.listItems(ctx, boardId),
      wantsDeleted ? repo.listDeletedItems(ctx, boardId) : Promise.resolve([]),
      wantsArchived ? repo.listArchivedItems(ctx, boardId) : Promise.resolve([]),
    ]);
    measure("items", itemsStartedAt);
    const deletedItems = wantsDeleted && !detail.board.is_system ? deletedCandidates : [];
    const archivedOnly = wantsArchived && !detail.board.is_system ? archivedCandidates : [];

    // 방어 분리: 보관 권한이 없으면 보관 행의 값 ID를 발행하지 않는다.
    const activeItems = visibleItems.filter((item) => !item.archived_at);
    const archivedItems = [...archivedOnly, ...visibleItems.filter((item) => Boolean(item.archived_at))];

    const activeIds = new Set(activeItems.map((item) => item.id));
    if (deletedItems.some((item) => activeIds.has(item.id))) {
      throw new BoardRuleError("활성 항목과 휴지통 항목의 범위가 겹칩니다");
    }

    const hydrateStartedAt = performance.now();
    const hydrated = await this.compose(
      ctx,
      [...activeItems, ...deletedItems, ...archivedItems],
      detail,
    );
    measure("hydrate", hydrateStartedAt);
    return {
      detail,
      items: hydrated.slice(0, activeItems.length),
      deletedItems: hydrated.slice(activeItems.length, activeItems.length + deletedItems.length),
      archivedItems: hydrated.slice(activeItems.length + deletedItems.length),
    };
  }

  async getItem(ctx: Ctx, boardId: string, itemId: string): Promise<ItemWithValues> {
    const detail = await this.getBoardDetail(ctx, boardId);
    const item = await (await this.repo).getItem(ctx, itemId);
    if (!item || item.board_id !== boardId)
      throw new NotFoundError("아이템을 찾을 수 없습니다");
    return (await this.compose(ctx, [item], detail))[0];
  }

  async createItem(ctx: Ctx, boardId: string, input: NewItem): Promise<ItemWithValues> {
    const detail = await this.requireEditableBoardDetail(ctx, boardId);
    // 생성은 **인라인 피드백 지면이 없다**(고칠 셀이 화면에 아직 없음).
    // 따라서 통과분만 조용히 싣지 않고 **거부한다** — 값을 말없이 버리는 것은
    // 관대 정책이 막으려던 데이터 유실 그 자체다. (편집은 setCells 가 errors 로 돌려준다.)
    let values: Record<string, CellValue> | undefined;
    if (input.values) {
      const res = this.validateValues(detail.columns, input.values);
      if (res.errors.length > 0) {
        throw new BoardRuleError(res.errors.map((e) => `${e.label}: ${e.message}`).join(", "));
      }
      values = res.values;
    }
    const item = await (await this.repo).createItem(ctx, boardId, { ...input, values });
    return (await this.compose(ctx, [item], detail))[0];
  }

  async updateItem(ctx: Ctx, boardId: string, itemId: string, patch: ItemPatch): Promise<ItemWithValues> {
    await this.requireEditableBoard(ctx, boardId);
    await this.requireActiveItem(ctx, itemId);
    const item = await (await this.repo).updateItem(ctx, itemId, patch);
    if (!item) throw new NotFoundError("아이템을 찾을 수 없습니다");
    return this.getItem(ctx, boardId, itemId);
  }

  /**
   * 행 이동(드래그·행별 그룹 이동·일괄 그룹 이동·키보드) — 한 경로.
   *
   * 2026-10-06 — 계약업체 실무에서 행을 다른 그룹으로 옮기면 «진행상황» 도 그 그룹의 대표 단계로
   * 맞춘다(그룹 → 단계 역동기화). 값과 위치는 기존 `set_board_item_values_with_atomic_move`
   * 한 트랜잭션으로 같이 쓴다 — 같은 requestId·expectedVersion·beforeItemId 의미 그대로다.
   * 무엇을 쓸지는 `planStageBackSync` 가 «지금 상태» 만 보고 결정적으로 정하므로,
   * 응답이 유실돼 같은 requestId 로 다시 보내도 같은 요청이 되어 receipt 가 재생된다.
   */
  async moveRowAtomic(ctx: Ctx, boardId: string, request: RowMoveRequest): Promise<RowMoveReceipt> {
    if (!canMoveRows(ctx)) {
      throw new BoardRuleError("전체 행을 볼 수 있는 사용자만 행 순서를 바꿀 수 있습니다");
    }
    const board = await this.requireEditableBoard(ctx, boardId);
    await this.requireActiveItem(ctx, request.itemId);
    const repo = await this.repo;
    const values = await this.planRowMoveStage(ctx, board, request);
    return values
      ? repo.setValuesAndMoveAtomic(ctx, boardId, { ...request, values })
      : repo.moveRowAtomic(ctx, boardId, request);
  }

  /** 행 이동에 실어 보낼 단계 값 — 역동기화 대상 보드·칸이 아니거나 바꿀 것이 없으면 null. */
  private async planRowMoveStage(
    ctx: Ctx,
    board: Board,
    request: RowMoveRequest,
  ): Promise<Record<string, CellValue> | null> {
    const stageKey = groupLinkedStageColumnKey(board.source);
    if (!stageKey || request.targetGroupId === null) return null;
    const repo = await this.repo;
    const [columns, groups, item, values, maySend] = await Promise.all([
      repo.listColumns(ctx, board.id),
      repo.listGroups(ctx, board.id),
      repo.getItem(ctx, request.itemId),
      repo.listValues(ctx, [request.itemId]),
      this.stageWriteMaySend(ctx, board.id, stageKey),
    ]);
    // 2026-10-06(#845 검토 P2) — 이 칸에 켜진 발송 규칙이 있으면(041 enqueue_message_transition) 값을 쓰는 순간
    //   고객에게 문자·알림톡이 큐잉될 수 있다. 드래그는 «값을 고른» 동작이 아니므로 그때는 위치만 옮긴다
    //   (167 이월이 같은 이유로 활성 규칙이 있으면 암묵적 상태 쓰기를 멈춘 선례). 규칙을 못 읽어도 같다.
    if (maySend) return null;
    const column = columns.find((candidate) => candidate.key === stageKey);
    // 행이 없거나 다른 보드 것이면 판단하지 않는다 — 이동 RPC 가 그 이유로 거부한다.
    if (!column || !item || item.board_id !== board.id) return null;
    const current = values.find((value) => value.item_id === request.itemId && value.column_key === stageKey);
    // 값을 실을 수 있는지는 RPC(`issue602_board_cell_value_is_valid` → `board_column_value_editable`)와
    // 같은 기준으로 «여기서» 정한다. 회사가 단계 칸을 «관리자만 편집/보기» 로 묶어 두었으면 값을
    // 싣는 순간 이동 전체가 거부되므로(같은 그룹 재정렬 포함), 그때는 값 없이 위치만 옮긴다.
    // 보기 제한이면 현재 값을 못 읽어 «보지 못한 값» 을 덮어쓰게 되므로 역시 싣지 않는다.
    // 거부를 받고 순수 이동으로 다시 보내는 방식은 같은 requestId 의 재생 결정성을 깨므로 쓰지 않는다.
    const editable = isSourceEditable(column.source)
      && columnPolicyAllows(ctx, column.edit_policy_jsonb)
      && columnPolicyAllows(ctx, column.view_policy_jsonb);
    const stage = planStageBackSync({
      column,
      editable,
      groups,
      currentValue: current?.value_jsonb ?? null,
      sourceGroupId: item.group_id,
      targetGroupId: request.targetGroupId,
    });
    return stage === null ? null : { [stageKey]: stage };
  }

  /**
   * 이 단계 칸에 값을 쓰면 발송이 생길 수 있는가 — 켜진 `messaging_trigger_rules` 가 있거나, 읽지 못했으면 true.
   * 읽기는 요청 클라이언트(RLS: 조직 구성원 읽기)로 한다. 모르면 «보낼 수 있다» 쪽으로 닫는다.
   */
  private async stageWriteMaySend(ctx: Ctx, boardId: string, columnKey: string): Promise<boolean> {
    const repo = await this.repo;
    if (typeof repo.hasEnabledMessagingTriggerRules !== "function") return true;
    try {
      return await repo.hasEnabledMessagingTriggerRules(ctx, boardId, columnKey);
    } catch (error) {
      console.warn("[board stage back-sync] messaging rules unreadable — moving without the stage", boardId, error);
      return true;
    }
  }

  async deleteItem(ctx: Ctx, boardId: string, itemId: string): Promise<void> {
    await this.requireEditableBoard(ctx, boardId);
    await this.requireActiveItem(ctx, itemId);
    const repo = await this.repo;
    if (await repo.deleteItem(ctx, boardId, itemId)) return;
    const alreadyDeleted = (await repo.listDeletedItems(ctx, boardId)).some((item) => item.id === itemId);
    if (!alreadyDeleted) throw new NotFoundError("아이템을 찾을 수 없습니다");
  }

  async restoreItem(ctx: Ctx, boardId: string, itemId: string): Promise<ItemWithValues> {
    await this.requireEditableBoard(ctx, boardId);
    const repo = await this.repo;
    const restored = await repo.restoreItem(ctx, boardId, itemId);
    if (restored) return this.getItem(ctx, boardId, itemId);
    const active = await repo.getItem(ctx, itemId);
    if (!active || active.board_id !== boardId) throw new NotFoundError("휴지통에서 항목을 찾을 수 없습니다");
    return this.getItem(ctx, boardId, itemId);
  }

  /**
   * 셀 인라인 편집 — 검증 훅 통과분만 저장하고, 실패분은 `errors` 로 돌려준다.
   * (관대 정책: 한 셀이 틀려도 나머지는 저장된다. 무결성 필드 오류만 throw.)
   *
   * D68~D70: 저장된 값이 "조작 열"(move_rule_jsonb 를 가진 컬럼)의 값이고 그 값이
   * 이동 규칙에 걸리면, 값 저장과 **같은 호출 안에서** 아이템의 group_id 도 옮긴다
   * (별도 API 왕복이 없다 — "저장했더니 카드가 안 옮겨갔다"는 사고를 원천 차단).
   * 여러 조작 열이 한 번에 바뀌면 나중 키가 이긴다(패치 순서 = 마지막이 최종 상태).
   *
   * 되돌리기: 쓰기 **전** 값과 group_id 를 스냅샷해 `undo` 로 돌려준다.
   * 호출부는 이걸 그대로 `undoCells()` 에 넘기면 된다.
   *
   * 2026-10-06 — 그룹을 옮기는 값의 실패를 뭉개지 않는다(`writeValuesWithRuleMove`).
   *   · 행을 옮길 권한이 없으면(전체 범위 아님) 그 칸만 사유와 함께 돌려주고 나머지는 저장한다.
   *     값만 바뀌는 단계는 예전처럼 저장된다.
   *   · 다른 사용자가 먼저 순서를 바꿔 버전이 낡았으면 다시 읽고 «한 번만» 다시 시도한다.
   *   · 옮길 그룹이 없으면 값만 저장하고 그 사실을 알린다.
   */
  async setCells(
    ctx: Ctx,
    boardId: string,
    itemId: string,
    patch: Record<string, CellValue>,
    requestId = crypto.randomUUID(),
  ): Promise<SetCellsResult> {
    const detail = await this.requireEditableBoardDetail(ctx, boardId);
    await this.requireActiveItem(ctx, itemId);
    const before = await this.getItem(ctx, boardId, itemId);

    const validated = this.validateValues(detail.columns, patch, true);
    const gate = this.gateRuleMove(ctx, detail.columns, before.group_id, validated.values);
    const values = gate.values;
    const errors = [...validated.errors, ...gate.errors];
    const writtenKeys = Object.keys(values);
    if (writtenKeys.length === 0) {
      return { item: await this.getItem(ctx, boardId, itemId), errors, notices: [], undo: null };
    }

    // 되돌리기용 이전 값 스냅샷 — 실제 쓰기 전에 떠 둔다.
    const beforeValues = (await this.getItem(ctx, boardId, itemId)).values;
    const undo: CellEditUndo = {
      values: Object.fromEntries(writtenKeys.map((k) => [k, beforeValues[k] ?? null])),
      group_id: before.group_id,
    };

    // 알림(값만 저장)은 errors 에 섞지 않는다 — 저장은 성공했다(검토 P3).
    const notices = await this.writeValuesWithRuleMove(ctx, boardId, itemId, detail, before.group_id, values, requestId);

    return { item: await this.getItem(ctx, boardId, itemId), errors, notices, undo };
  }

  /**
   * 행을 옮길 수 없는 사람(전체 범위 아님)이 «그룹을 옮기는 값» 을 고르면 그 칸만 빼고 사유를 돌려준다.
   *
   * 왜 미리 보나: RPC 관문(`row move permission denied`)에 걸리면 값도 그룹도 통째로 롤백되고
   * 「항목을 저장하지 못했어요」 만 남았다. 값만 저장하고 행을 두면 단계와 그룹이 어긋난다.
   * 그래서 그 칸은 저장하지 않고 이유를 말한다. 값만 바뀌는 단계(규칙 없음)는 그대로 저장된다.
   */
  private gateRuleMove(
    ctx: Ctx,
    columns: readonly BoardColumn[],
    beforeGroupId: string | null,
    values: Record<string, CellValue>,
  ): { values: Record<string, CellValue>; errors: CellError[] } {
    const decided = ruleMoveTarget(columns, values);
    if (!decided || decided.target === beforeGroupId || canMoveRows(ctx)) return { values, errors: [] };
    const byKey = new Map(columns.map((column) => [column.key, column]));
    const kept: Record<string, CellValue> = {};
    const errors: CellError[] = [];
    for (const [key, value] of Object.entries(values)) {
      const column = byKey.get(key);
      const resolved = column ? resolveMoveTarget(column, value) : null;
      if (column && resolved !== null && resolved !== beforeGroupId) {
        errors.push({ key, label: column.label, message: ROW_MOVE_FAILURE_MESSAGES.permission });
      } else kept[key] = value;
    }
    return { values: kept, errors };
  }

  /**
   * 값 쓰기 — 이동 규칙이 다른 그룹을 가리키면 값과 위치를 한 트랜잭션으로 같이 쓴다.
   * 돌려주는 것은 «저장은 됐지만 알릴 것» (옮길 그룹이 없어 값만 저장한 경우)뿐이다.
   *
   * 낡은 버전(`row move stale version`)만 «한 번» 다시 시도한다. 실패한 시도는 통째로 롤백되어
   * receipt 도 남기지 않으므로 같은 requestId 로 다시 보내도 안전하다. 목적지는 새로 읽은
   * 규칙·행 위치로 다시 계산한다. 그 밖의(전송·알 수 없는) 오류는 다시 시도하지 않는다 —
   * 실제로는 커밋됐는데 응답만 잃은 경우 다른 버전으로 보내면 «replay conflict» 가 된다.
   */
  private async writeValuesWithRuleMove(
    ctx: Ctx,
    boardId: string,
    itemId: string,
    detail: BoardDetail,
    beforeGroupId: string | null,
    values: Record<string, CellValue>,
    requestId: string,
  ): Promise<CellError[]> {
    const repo = await this.repo;
    const valueOnly = async (decidedKey: string, columns: readonly BoardColumn[]): Promise<CellError[]> => {
      await repo.setValues(ctx, itemId, values);
      const label = columns.find((column) => column.key === decidedKey)?.label ?? decidedKey;
      return [{ key: decidedKey, label, message: ROW_MOVE_VALUE_ONLY_NOTICE }];
    };
    const attempt = async (current: BoardDetail, groupId: string | null): Promise<CellError[] | "stale"> => {
      const decided = ruleMoveTarget(current.columns, values);
      if (!decided || decided.target === groupId) {
        await repo.setValues(ctx, itemId, values);
        return [];
      }
      if (!current.groups.some((group) => group.id === decided.target)) return valueOnly(decided.key, current.columns);
      try {
        await repo.setValuesAndMoveAtomic(ctx, boardId, {
          itemId,
          targetGroupId: decided.target,
          beforeItemId: null,
          expectedVersion: current.board.row_order_version ?? 0,
          requestId,
          values,
        });
        return [];
      } catch (error) {
        const failure = classifyRowMoveFailure(error);
        if (failure === "stale") return "stale";
        if (failure === "target_missing") return valueOnly(decided.key, current.columns);
        throw toRowMoveError(error);
      }
    };

    const first = await attempt(detail, beforeGroupId);
    if (first !== "stale") return first;
    const fresh = await this.getBoardDetail(ctx, boardId);
    const moved = await repo.getItem(ctx, itemId);
    if (!moved || moved.board_id !== boardId) throw new NotFoundError("아이템을 찾을 수 없습니다");
    const second = await attempt(fresh, moved.group_id);
    if (second === "stale") throw new UserFacingActionError(ROW_MOVE_FAILURE_MESSAGES.stale);
    return second;
  }

  /**
   * 쌍원자 저장 — 지역 쌍처럼 "둘 다 아니면 둘 다 아니다"가 필요한 자리 전용.
   * 기존 `setCells()` 의 부분저장 계약은 그대로 둔다(관대 정책 유지).
   *
   * 첫 쓰기 전에 끝내는 검사: 요청키 누락·컬럼 미존재·readonly·source·값 검증
   * errors. 하나라도 실패하면 쓰지 않는다. 쓰기는 `repo.setValues` 단일
   * upsert(이동이 있으면 기존 `setValuesAndMoveAtomic` RPC)로 한 번만 나간다.
   *
   * 쓰기 호출이 실패하면 재조회로 실제 반영 범위를 가려 `committed` 에 담는다.
   * 값은 이미 반영됐는데 `items.updated_at` touch 같은 후처리가 실패한 경우를
   * "둘 다 미저장"이라 꾸미지 않고, 실패한 후처리를 무시해 성공으로 돌리지도
   * 않는다 — 범위를 분명히 한 errors 로 닫는다.
   */
  async setCellsStrict(
    ctx: Ctx,
    boardId: string,
    itemId: string,
    patch: Record<string, CellValue>,
    requestId = crypto.randomUUID(),
    requiredKeys: readonly string[] = [],
  ): Promise<SetCellsStrictResult> {
    const detail = await this.requireEditableBoardDetail(ctx, boardId);
    const before = await this.getItem(ctx, boardId, itemId);
    const byKey = new Map(detail.columns.map((c) => [c.key, c]));
    const preErrors: CellError[] = [];

    for (const required of requiredKeys) {
      if (!(required in patch)) {
        const col = byKey.get(required);
        preErrors.push({
          key: required,
          label: col?.label ?? required,
          message: "함께 저장할 값이 빠져 저장하지 않았습니다",
        });
      }
    }
    for (const key of Object.keys(patch)) {
      if (!byKey.has(key)) {
        preErrors.push({ key, label: key, message: "컬럼을 찾을 수 없어 저장하지 않았습니다" });
      }
    }
    if (preErrors.length > 0) {
      return { item: before, errors: preErrors, notices: [], undo: null, committed: "none", commitDetail: null };
    }

    // 무결성 필드 throw 는 여기서 나간다 — 아직 쓰지 않았으므로 원자성이 깨지지 않는다.
    const { values, errors } = this.validateValues(detail.columns, patch, true);
    if (errors.length > 0) {
      return { item: before, errors, notices: [], undo: null, committed: "none", commitDetail: null };
    }
    const writtenKeys = Object.keys(values);
    if (writtenKeys.length === 0) {
      return { item: before, errors, notices: [], undo: null, committed: "none", commitDetail: null };
    }
    // 행을 옮길 수 없는 사람이 그룹을 옮기는 값을 섞으면 «하나도» 쓰지 않는다(쌍원자 계약).
    const gate = this.gateRuleMove(ctx, detail.columns, before.group_id, values);
    if (gate.errors.length > 0) {
      return { item: before, errors: gate.errors, notices: [], undo: null, committed: "none", commitDetail: null };
    }

    const beforeValues = (await this.getItem(ctx, boardId, itemId)).values;
    const undo: CellEditUndo = {
      values: Object.fromEntries(writtenKeys.map((k) => [k, beforeValues[k] ?? null])),
      group_id: before.group_id,
    };

    let notices: CellError[] = [];
    try {
      notices = await this.writeValuesWithRuleMove(ctx, boardId, itemId, detail, before.group_id, values, requestId);
    } catch (error) {
      // 쓰기 실패 뒤 실제 반영 범위를 재조회로 가린다 — 추측으로 "미저장"이라 하지 않는다.
      let reread: ItemWithValues;
      try {
        reread = await this.getItem(ctx, boardId, itemId);
      } catch {
        const message = "저장 결과를 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.";
        return {
          item: before,
          errors: writtenKeys.map((key) => ({ key, label: byKey.get(key)?.label ?? key, message })),
          notices: [],
          undo: null,
          committed: "unknown",
          commitDetail: message,
        };
      }
      const appliedKeys = writtenKeys.filter(
        (key) => compareCells(reread.values[key] ?? null, values[key] ?? null) === 0,
      );
      const committed: StrictCellCommit =
        appliedKeys.length === 0 ? "none" : appliedKeys.length === writtenKeys.length ? "all" : "partial";
      const scope =
        committed === "all"
          ? "값은 저장됐으나 마무리 확인에 실패했습니다"
          : committed === "partial"
            ? `일부 값만 저장됐습니다(${appliedKeys.length}/${writtenKeys.length})`
            : "저장하지 못했습니다";
      const detailMessage = error instanceof Error && error.message ? ` (${error.message})` : "";
      const message = `${scope}${detailMessage} 화면을 새로고침해 확인해 주세요.`;
      const failedKeys = writtenKeys.filter((key) => !appliedKeys.includes(key));
      const scopeErrors: CellError[] =
        committed === "none"
          ? writtenKeys.map((key) => ({
              key,
              label: byKey.get(key)?.label ?? key,
              message,
            }))
          : [
              {
                key: (failedKeys[0] ?? appliedKeys[0] ?? writtenKeys[0]) as string,
                label: byKey.get((failedKeys[0] ?? appliedKeys[0] ?? writtenKeys[0]) as string)?.label ??
                  ((failedKeys[0] ?? appliedKeys[0] ?? writtenKeys[0]) as string),
                message,
              },
            ];
      return {
        item: reread,
        errors: scopeErrors,
        notices: [],
        undo: appliedKeys.length > 0
          ? {
              values: Object.fromEntries(appliedKeys.map((k) => [k, beforeValues[k] ?? null])),
              group_id: before.group_id,
            }
          : null,
        committed,
        commitDetail: message,
      };
    }

    // 쓰기는 성공했으나 최종 재조회가 안 되면 성공도 미저장도 단정하지 않는다.
    // generic unsaved로 떨어뜨리면 "아무것도 안 저장됐다"며 중복 쓰기를 부르고,
    // 성공으로 꾸미면 확인 안 된 값을 확정한다 — committed:"unknown"으로 닫고
    // 호출부는 초안을 보존한 채 재조회 뒤 재시도해야 한다.
    try {
      return {
        item: await this.getItem(ctx, boardId, itemId),
        // 값은 전부 저장됐다 — 실패가 아니다. 옮길 그룹이 없어 행만 두었으면 그 알림은 notices 로만 싣는다
        // (errors 에 섞으면 호출부가 성공을 실패로 표시한다 — 검토 P3).
        errors: [],
        notices,
        undo,
        committed: "all",
        commitDetail: null,
      };
    } catch (rereadError) {
      const cause = rereadError instanceof Error && rereadError.message ? ` (${rereadError.message})` : "";
      const message =
        `저장됐을 수 있으나 방금 저장값을 확인하지 못했습니다${cause} ` +
        `화면을 새로고침해 확인한 뒤 다시 시도해 주세요(확인 전에는 다시 저장하지 마세요).`;
      const key = (requiredKeys[0] ?? writtenKeys[0]) as string;
      return {
        item: before,
        errors: [
          {
            key,
            label: byKey.get(key)?.label ?? key,
            message,
          },
        ],
        notices,
        undo,
        committed: "unknown",
        commitDetail: message,
      };
    }
  }

  /**
   * `setCells()` 가 돌려준 `undo` 를 그대로 적용해 편집 직전 상태로 되돌린다.
   * 값·group_id 를 **명시 복원**한다(이동 규칙 재평가에 기대지 않는다 — 이유는
   * `CellEditUndo` 주석 참고). 검증은 다시 하지 않는다 — 그 값들은 이미 한 번
   * 통과한 값이다.
   */
  async undoCells(
    ctx: Ctx,
    boardId: string,
    itemId: string,
    undo: CellEditUndo,
  ): Promise<ItemWithValues> {
    const board = await this.requireEditableBoard(ctx, boardId);
    await this.getItem(ctx, boardId, itemId);
    if (
      undo.group_id !== null &&
      !(await (await this.repo).listGroups(ctx, boardId)).some((group) => group.id === undo.group_id)
    ) {
      throw new NotFoundError("그룹을 찾을 수 없습니다");
    }
    const repo = await this.repo;
    const current = await repo.getItem(ctx, itemId);
    if (current?.group_id !== undo.group_id) {
      await repo.setValuesAndMoveAtomic(ctx, boardId, {
        itemId,
        targetGroupId: undo.group_id,
        beforeItemId: null,
        expectedVersion: board.row_order_version ?? 0,
        requestId: crypto.randomUUID(),
        values: undo.values,
      });
    } else if (Object.keys(undo.values).length > 0) await repo.setValues(ctx, itemId, undo.values);
    return this.getItem(ctx, boardId, itemId);
  }

  /**
   * 칸반 그룹핑 — groupBy 가 컬럼 key 면 그 select 값 기준, 아니면 board_groups 기준.
   * 빈 그룹도 반환(칸반 컬럼 유지).
   */
  async kanban(
    ctx: Ctx,
    boardId: string,
    groupBy?: string,
  ): Promise<KanbanLane[]> {
    return this.kanbanFromSnapshot(await this.loadPageSnapshot(ctx, boardId), groupBy);
  }

  /** 이미 읽은 화면 스냅샷만 그룹핑한다 — 저장소 왕복은 0회다. */
  kanbanFromSnapshot(snapshot: BoardPageSnapshot, groupBy?: string): KanbanLane[] {
    const { detail, items } = snapshot;

    const col = groupBy ? detail.columns.find((c) => c.key === groupBy) : undefined;
    if (col && (col.type === "select" || col.type === "multiselect")) {
      const options = col.options_jsonb?.options ?? [];
      const lanes = options.map((o) => ({
        key: o.id,
        label: o.label,
        color: o.color ?? null,
        items: items.filter((i) => {
          const v = i.values[col.key];
          return Array.isArray(v)
            ? v.some((entry) => typeof entry === "string" && entry === o.id)
            : v === o.id;
        }),
      }));
      lanes.push({
        key: "",
        label: "미지정",
        color: null,
        items: items.filter((i) => isEmptyCell(i.values[col.key] ?? null)),
      });
      return lanes;
    }

    // 기본: board_groups 기준
    const lanes = detail.groups.map((g) => ({
      key: g.id,
      label: g.name,
      color: g.color,
      items: items.filter((i) => i.group_id === g.id),
    }));
    lanes.push({
      key: "",
      label: "미지정",
      color: null,
      items: items.filter((i) => i.group_id === null),
    });
    return lanes;
  }

  /** 테이블 정렬(컬럼 key 기준). 빈값은 뒤로. */
  sortItems(items: ItemWithValues[], columnKey: string, dir: "asc" | "desc" = "asc") {
    const sorted = [...items].sort((a, b) =>
      compareCells(a.values[columnKey] ?? null, b.values[columnKey] ?? null),
    );
    return dir === "asc" ? sorted : sorted.reverse();
  }

  // ── 내부 ──
  private async compose(ctx: Ctx, items: BoardItem[], detail: BoardDetail): Promise<ItemWithValues[]> {
    if (items.length === 0) return [];
    const columnKeys = new Set(detail.columns.map((column) => column.key));
    const boardLayout = resolveBoardDetailLayout(
      detail.board.source,
      detail.board.detail_layout_jsonb,
      detail.columns,
    );
    const groupLayouts = new Map(
      detail.groups.map((group) => [
        group.id,
        resolveDetailLayout(boardLayout, group.detail_layout_jsonb).entries,
      ]),
    );
    const boardDetailKeys = new Set(
      boardLayout.filter((entry) => entry.source === "detail").map((entry) => entry.key),
    );
    const groupDetailKeys = new Map(
      [...groupLayouts].map(([groupId, layout]) => [
        groupId,
        new Set(layout.filter((entry) => entry.source === "detail").map((entry) => entry.key)),
      ]),
    );
    const itemById = new Map(items.map((item) => [item.id, item]));
    const values = await (await this.repo).listValues(ctx, items.map((i) => i.id));
    const byItem = new Map<string, Record<string, CellValue>>();
    const statusesByItem = new Map<string, Record<string, "normalized" | "needs_review">>();
    for (const v of values) {
      const item = itemById.get(v.item_id);
      const detailKeys = item?.group_id ? groupDetailKeys.get(item.group_id) ?? boardDetailKeys : boardDetailKeys;
      if (!columnKeys.has(v.column_key) && !detailKeys.has(v.column_key)) continue; // 삭제·미배치 잔여값 무시
      const bag = byItem.get(v.item_id) ?? {};
      bag[v.column_key] = v.value_jsonb;
      byItem.set(v.item_id, bag);
      if (v.phone_normalization_status === "needs_review") {
        const statuses = statusesByItem.get(v.item_id) ?? {};
        statuses[v.column_key] = "needs_review";
        statusesByItem.set(v.item_id, statuses);
      }
    }
    return items.map((i) => ({ ...i, values: byItem.get(i.id) ?? {}, value_statuses: statusesByItem.get(i.id) ?? {} }));
  }

  // ── 저장뷰(board_views · 003) ────────────────────────────────

  /** 보드의 뷰 목록 — 공유뷰 ∪ 내 개인뷰(가시성은 repo 가 적용). */
  async listViews(ctx: Ctx, boardId: string): Promise<BoardView[]> {
    await this.requireBoard(ctx, boardId);
    return (await this.repo).listViews(ctx, boardId);
  }

  /**
   * 기본 뷰 — 규약: shared 우선 → name ASC → id ASC.
   * `board_views` 에 created_at/is_default 가 없어 확정된 결정적 규약(기획2 OQ-4 재판정).
   * T05 `lib/custom/views.ts` 의 `pickDefaultView` 를 그대로 재사용한다(2중 구현 금지).
   */
  async getDefaultView(ctx: Ctx, boardId: string): Promise<BoardView | null> {
    return pickDefaultView(await this.listViews(ctx, boardId));
  }

  async createView(ctx: Ctx, boardId: string, input: NewView): Promise<BoardView> {
    await this.requireBoard(ctx, boardId);
    return (await this.repo).createView(ctx, boardId, input);
  }

  async updateView(ctx: Ctx, viewId: string, patch: ViewPatch): Promise<BoardView> {
    const view = await (await this.repo).updateView(ctx, viewId, patch);
    if (!view) throw new NotFoundError("뷰를 찾을 수 없습니다");
    return view;
  }

  async deleteView(ctx: Ctx, viewId: string): Promise<void> {
    if (!await (await this.repo).deleteView(ctx, viewId)) throw new NotFoundError("뷰를 찾을 수 없습니다");
  }

  /** 보드 존재·가시성 확인(뷰는 시스템 보드에서도 허용 — 구조 편집이 아니므로). */
  private async requireBoard(ctx: Ctx, boardId: string): Promise<Board> {
    const board = await (await this.repo).getBoard(ctx, boardId);
    if (!board) throw new NotFoundError("보드를 찾을 수 없습니다");
    return board;
  }

  /**
   * 셀 검증 훅 — 쓰기 경로의 단일 관문(기획2 판정 2026-07-21).
   *
   * 정책:
   * - **기본 = 관대 + 인라인 피드백**(먼데이 파리티). 형식이 틀린 값은 **저장하지 않고**
   *   `errors` 로 돌려보내 사용자가 그 자리서 고치게 한다. 나머지 정상 값은 정상 저장.
   * - ⛔ 조용히 null 로 수렴시키지 않는다(데이터 유실 금지).
   * - **엄격 예외 = 무결성 필드**(`isIntegrityField`): 정산 generated column 이 의존하므로
   *   틀린 값이면 흘리지 않고 하드 거부(throw)한다.
   * - **읽기 전용 칸**(`col.is_readonly`, 목업 개정 ④): 값의 형식과 무관하게 **모든** 쓰기를
   *   errors 로 되돌린다(throw 아님 — 사용자가 실수로 클릭했을 뿐 무결성 위협은 아니다).
   */
  private validateValues(
    columns: BoardColumn[],
    patch: Record<string, CellValue>,
    enforceReadOnlySource = false,
  ): { values: Record<string, CellValue>; errors: CellError[] } {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const values: Record<string, CellValue> = {};
    const errors: CellError[] = [];

    for (const [key, raw] of Object.entries(patch)) {
      const col = byKey.get(key);
      if (!col) continue; // 정의되지 않은 컬럼은 무시(EAV 오염 방지)
      if (enforceReadOnlySource && !isSourceEditable(col.source)) {
        errors.push({ key, label: col.label, message: "자동으로 채워지는 칸은 직접 바꿀 수 없습니다" });
        continue;
      }
      // 손으로 못 고치는 칸(목업 개정 ④) — 값의 형식과 무관하게 편집 자체를 막는다.
      // isIntegrityField 와는 다른 축: 저건 "형식이 틀리면 거부", 이건 "형식과 무관하게 항상 거부".
      if (col.is_readonly) {
        errors.push({
          key,
          label: col.label,
          message: "자동 계산되는 칸이라 손으로 고칠 수 없습니다",
        });
        continue;
      }
      const options: FieldOption[] | null = col.options_jsonb?.options ?? null;
      const res = validateCell(col.type, raw, options);

      if (res.ok) {
        values[key] = res.value;
        continue;
      }
      const message = res.error ?? "값을 해석할 수 없습니다";
      // 무결성 필드는 관대 정책의 예외 — 잘못된 값이 정산 수식에 흘러들면 안 된다.
      if (isIntegrityField(col.key)) {
        throw new BoardRuleError(`${col.label}: ${message}`);
      }
      errors.push({ key, label: col.label, message });
    }
    return { values, errors };
  }

  /** 시스템 보드는 구조/데이터 편집 금지(정책자금은 deals 화면에서). */
  private async requireEditableBoard(ctx: Ctx, boardId: string): Promise<Board> {
    const board = await (await this.repo).getBoard(ctx, boardId);
    if (!board) throw new NotFoundError("보드를 찾을 수 없습니다");
    if (board.is_system)
      throw new BoardRuleError(
        "시스템 보드는 편집할 수 없습니다 — 정책자금 파이프라인은 딜 화면에서 관리합니다",
      );
    return board;
  }

  private async requireEditableBoardDetail(ctx: Ctx, boardId: string): Promise<BoardDetail> {
    await this.requireEditableBoard(ctx, boardId);
    return this.getBoardDetail(ctx, boardId);
  }
}
