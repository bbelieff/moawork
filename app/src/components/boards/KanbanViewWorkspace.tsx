"use client";

/**
 * 칸반 보기 — #845 6단계. 표와 같은 보기 줄(뷰 탭 · 보기 조건 칩 · 저장 · 찾기)을 쓴다.
 *
 * 레인은 서버가 권한·상담 단계로 걸러 넘긴다. 보기 조건(찾기·골라 보기·담당·줄 세우기)은
 * 여기서 바로 적용한다 — 주소(mwFilters)에 남으므로 새로고침해도 그대로다.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import {
  activeFilterCount,
  assigneeOptions,
  BOARD_FILTER_QUERY_KEY,
  EMPTY_FILTERS,
  encodeBoardFilters,
  type BoardFilterState,
} from "@/components/board/filters";
import { BoardViewBar } from "@/components/board/BoardViewBar";
import {
  applySavedKanbanView,
  NEW_LEAD_SAVED_FILTER_PROJECTION,
  presentNewLeadSavedFilters,
} from "@/lib/view/board-saved";
import { GenericBoardKanban, type KanbanLane } from "./GenericBoardKanban";

const NO_LABELS: Readonly<Record<string, string>> = {};

export function KanbanViewWorkspace({
  boardId,
  currentUserId,
  lanes,
  items,
  columns,
  canonicalNewLead = false,
  initialFilters = EMPTY_FILTERS,
  groupBy,
  groupByOptions,
  assigneeLabels = NO_LABELS,
  activeViewId = null,
  calendarAvailable = false,
  loadSavedViews = false,
  readOnly,
  rowOrderVersion,
  canMoveRows,
  canManageSections,
  isSystem,
  children,
}: {
  boardId: string;
  currentUserId: string;
  /** 권한·상담 단계로만 거른 레인(보기 조건은 아직 안 걸림). */
  lanes: KanbanLane[];
  /** 사람 범위까지 적용한 이 화면의 행 — 보기 조건을 거는 대상. */
  items: readonly ItemWithValues[];
  /** 화면 칸(신규리드는 합성 칸 key). */
  columns: readonly BoardColumn[];
  canonicalNewLead?: boolean;
  /** 주소의 mwFilters(서버에서 읽은 것) — 첫 화면부터 같은 조건으로 그린다. */
  initialFilters?: BoardFilterState;
  groupBy: string;
  groupByOptions: readonly { key: string; label: string }[];
  assigneeLabels?: Readonly<Record<string, string>>;
  activeViewId?: string | null;
  calendarAvailable?: boolean;
  loadSavedViews?: boolean;
  readOnly: boolean;
  rowOrderVersion: number;
  canMoveRows: boolean;
  canManageSections: boolean;
  isSystem: boolean;
  /** 보기 줄과 칸반 사이(예: 목록 칸 이름 고치기 줄). */
  children?: ReactNode;
}) {
  const [filters, setFilters] = useState<BoardFilterState>(() =>
    canonicalNewLead ? presentNewLeadSavedFilters(initialFilters) : initialFilters);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeFilterCount(filters) === 0) url.searchParams.delete(BOARD_FILTER_QUERY_KEY);
    else url.searchParams.set(BOARD_FILTER_QUERY_KEY, encodeBoardFilters(filters));
    window.history.replaceState(window.history.state, "", url);
  }, [filters]);

  const projection = canonicalNewLead ? NEW_LEAD_SAVED_FILTER_PROJECTION : undefined;
  const allLanes = useMemo(
    () => applySavedKanbanView(lanes, items, columns, EMPTY_FILTERS, projection),
    [columns, items, lanes, projection],
  );
  const shownLanes = useMemo(
    () => applySavedKanbanView(lanes, items, columns, filters, projection),
    [columns, filters, items, lanes, projection],
  );
  const total = allLanes.reduce((sum, lane) => sum + lane.items.length, 0);
  const matched = shownLanes.reduce((sum, lane) => sum + lane.items.length, 0);
  const people = useMemo(() => assigneeOptions(items, assigneeLabels), [assigneeLabels, items]);

  return (
    <>
      <BoardViewBar
        boardId={boardId}
        currentUserId={currentUserId}
        mode="kanban"
        filters={filters}
        onChange={setFilters}
        groupBy={groupBy}
        groupByOptions={groupByOptions}
        columns={columns}
        rows={items}
        people={people}
        matched={matched}
        total={total}
        canonicalNewLead={canonicalNewLead}
        loadSavedViews={loadSavedViews}
        activeViewId={activeViewId}
        calendarAvailable={calendarAvailable}
        defaultCalendarFieldKey={columns.find((column) => column.type === "date")?.key ?? null}
      />
      {children}
      <GenericBoardKanban
        boardId={boardId}
        lanes={shownLanes}
        groupBy={groupBy}
        readOnly={readOnly}
        rowOrderVersion={rowOrderVersion}
        canMoveRows={canMoveRows}
        canManageSections={canManageSections}
        isSystem={isSystem}
      />
    </>
  );
}
