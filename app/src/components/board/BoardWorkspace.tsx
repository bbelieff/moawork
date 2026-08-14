"use client";

/**
 * 보드 화면 셸 — 헤더 1줄 + 도구줄 1줄 + **블록 리스트** (PLAN-002 WO-2).
 *
 * 이 파일이 갖는 상태는 세 가지뿐이다:
 *  ① 필터(클라이언트 전용 — 서버에 저장하지 않는다. 저장 뷰는 WO-3 범위)
 *  ② 지금 끌고 있는 행 id (그룹을 가로질러 놓을 수 있어야 하므로 여기서 든다)
 *  ③ 서버 상태의 **낙관적 겹침**(useOptimistic) — 드롭한 순간 화면이 먼저 움직이고,
 *    서버 액션이 revalidate 하면 서버 값으로 자연스럽게 대체된다.
 *
 * 드래그 인덱스의 함정: 화면에 보이는 행은 필터를 통과한 일부다. 그래서 GroupTable 이
 * 올려주는 인덱스는 **보이는 목록 기준**이고, 여기서 그룹 전체 기준으로 환산한 뒤에야
 * 서버로 보낸다(`toFullIndex`). 이 환산을 빼먹으면 필터가 걸린 상태의 드롭이 엉뚱한
 * 자리에 꽂힌다.
 *
 * 정렬 칩이 켜져 있는 동안에는 행 드래그를 잠근다 — 보이는 순서가 저장된 순서가 아니라서
 * "여기 놓았는데 저기 꽂히는" 거짓말이 되기 때문이다.
 */

import {
  startTransition,
  useCallback,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Board, BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";
import type { CellFlash } from "@/lib/boards/cellFlash";
import {
  moveRowAction,
  setGroupColumnOrderAction,
} from "@/app/(app)/boards/actions";
import { BoardHeader } from "./BoardHeader";
import { BoardToolbar } from "./BoardToolbar";
import { GroupBlock } from "./GroupBlock";
import { GroupTable } from "./GroupTable";
import { ContactPipelineAction } from "@/components/crm/ContactPipelineAction";
import { CONTACT_TAB_SOURCE } from "@/lib/default-tabs/types";
import { buildBlocks } from "./blocks";
import {
  groupKeyOf,
  reorderColumnKeys,
  resolveColumnOrder,
  type GroupColumnOrder,
} from "./layout";
import {
  applyFilters,
  assigneeOptions,
  EMPTY_FILTERS,
  limitColumns,
  type BoardFilterState,
} from "./filters";

interface RowMove {
  itemId: string;
  groupId: string | null;
  /** 그룹 **전체** 기준 삽입 위치. */
  index: number;
}

/** 낙관적 행 이동 — 서버의 moveRowAction 과 같은 규칙(그룹 내 재색인)을 화면에서 미리 흉내낸다. */
function rowMoveReducer(rows: ItemWithValues[], move: RowMove): ItemWithValues[] {
  const moving = rows.find((r) => r.id === move.itemId);
  if (!moving) return rows;

  const targetKey = groupKeyOf(move.groupId);
  const rest = rows.filter((r) => r.id !== move.itemId);
  const siblings = rest
    .filter((r) => groupKeyOf(r.group_id) === targetKey)
    .sort((a, b) => a.sort_order - b.sort_order);

  const at = Math.max(0, Math.min(move.index, siblings.length));
  siblings.splice(at, 0, { ...moving, group_id: move.groupId });

  const renumbered = siblings.map((r, i) => ({ ...r, sort_order: i }));
  const others = rest.filter((r) => groupKeyOf(r.group_id) !== targetKey);
  // 순서는 buildBlocks 가 sort_order 로 다시 세우므로 배열 순서는 의미가 없다.
  return [...others, ...renumbered];
}

interface ColumnOrderPatch {
  groupKey: string;
  keys: string[];
}

function columnOrderReducer(
  state: GroupColumnOrder,
  patch: ColumnOrderPatch,
): GroupColumnOrder {
  return { ...state, [patch.groupKey]: patch.keys };
}

export function BoardWorkspace({
  board,
  columns,
  groups,
  rows,
  columnOrder,
  cellFlash,
  assigneeLabels,
  backSlot,
  viewSlot,
  canEditItems = false,
  canDeleteItems = false,
  canManageColumns = false,
}: {
  board: Board;
  columns: BoardColumn[];
  groups: BoardGroup[];
  rows: ItemWithValues[];
  /** 그룹별 컬럼 배치 오버라이드(서버 저장분). */
  columnOrder: GroupColumnOrder;
  cellFlash: CellFlash | null;
  /** 사용자 id → 표시 이름. 담당자 탭·칩에 UUID 가 그대로 나오지 않게 한다. */
  assigneeLabels: Record<string, string>;
  /** 헤더 1줄 안에 얹을 화면 고유 컨트롤(뒤로가기·뷰 전환) — 줄을 늘리지 않기 위한 슬롯. */
  backSlot?: ReactNode;
  viewSlot?: ReactNode;
  canEditItems?: boolean;
  canDeleteItems?: boolean;
  canManageColumns?: boolean;
}) {
  const [filters, setFilters] = useState<BoardFilterState>(EMPTY_FILTERS);
  /*
   * 끌고 있는 행: ref 가 정본(드롭 판정), state 는 표시(반투명·드롭 안내문)용.
   * dragstart 와 drop 사이에 리렌더가 끼지 않아도 드롭이 성립해야 한다.
   */
  const dragRowRef = useRef<string | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);

  const [optimisticRows, moveRowOptimistic] = useOptimistic(rows, rowMoveReducer);
  const [optimisticOrder, setOrderOptimistic] = useOptimistic(columnOrder, columnOrderReducer);

  const readOnly = board.is_system || !canEditItems;
  const sortActive = filters.sortKey !== "";
  const rowDragEnabled = !readOnly && !sortActive;

  const blocks = useMemo(() => buildBlocks(groups, optimisticRows), [groups, optimisticRows]);
  const people = useMemo(() => assigneeOptions(rows, assigneeLabels), [rows, assigneeLabels]);

  const matched = useMemo(
    () => applyFilters(optimisticRows, columns, filters).length,
    [optimisticRows, columns, filters],
  );

  /** 도구줄 담당자 필터 ↔ 헤더 담당자 탭의 단일 소스. null = 전체. */
  const pickAssignee = (value: string | null) =>
    setFilters((f) => ({ ...f, assignees: value === null ? [] : [value] }));

  const handleColumnDrop = (
    groupKey: string,
    /** 그 그룹의 **전체** 컬럼 순서(컬럼수 제한 적용 전). */
    fullColumns: BoardColumn[],
    draggedKey: string,
    targetKey: string,
  ) => {
    const keys = reorderColumnKeys(fullColumns, draggedKey, targetKey);
    startTransition(async () => {
      setOrderOptimistic({ groupKey, keys });
      const fd = new FormData();
      fd.set("boardId", board.id);
      fd.set("groupKey", groupKey);
      fd.set("order", keys.join(","));
      await setGroupColumnOrderAction(fd);
    });
  };

  /**
   * 보이는 목록 기준 인덱스 → 그룹 전체 기준 인덱스.
   * 드롭 지점의 바로 아래 행(anchor)이 전체 목록에서 몇 번째인지로 환산한다.
   * 목록 끝에 놓았으면 anchor 가 없으므로 전체 길이가 된다.
   */
  const toFullIndex = (
    fullRows: readonly ItemWithValues[],
    visibleRows: readonly ItemWithValues[],
    visibleIndex: number,
    movingId: string,
  ): number => {
    const anchor = visibleRows[visibleIndex];
    const withoutMoving = fullRows.filter((r) => r.id !== movingId);
    if (!anchor) return withoutMoving.length;
    const at = withoutMoving.findIndex((r) => r.id === anchor.id);
    return at < 0 ? withoutMoving.length : at;
  };

  const startRowDrag = useCallback((itemId: string) => {
    dragRowRef.current = itemId;
    setDragRowId(itemId);
  }, []);

  const endRowDrag = useCallback(() => {
    dragRowRef.current = null;
    setDragRowId(null);
  }, []);

  const canDropRow = useCallback(
    () => rowDragEnabled && dragRowRef.current !== null,
    [rowDragEnabled],
  );

  const handleRowDrop = (
    groupId: string | null,
    fullRows: readonly ItemWithValues[],
    visibleRows: readonly ItemWithValues[],
    visibleIndex: number,
  ) => {
    const itemId = dragRowRef.current;
    endRowDrag();
    if (!itemId || !rowDragEnabled) return;

    const index = toFullIndex(fullRows, visibleRows, visibleIndex, itemId);
    startTransition(async () => {
      moveRowOptimistic({ itemId, groupId, index });
      const fd = new FormData();
      fd.set("boardId", board.id);
      fd.set("itemId", itemId);
      fd.set("groupId", groupId ?? "");
      fd.set("index", String(index));
      await moveRowAction(fd);
    });
  };

  return (
    /*
     * 원칙 2·8 — 인위적 max-width 없이 뷰포트 폭을 그대로 쓴다.
     * 세로 여백(gap-3)은 "그룹 사이 구획"이라는 위계 표현으로만 쓴다(원칙 10).
     */
    <div className="flex w-full flex-col gap-3">
      <BoardHeader
        boardId={board.id}
        icon={board.icon}
        name={board.name}
        description={board.description}
        people={people}
        selected={filters.assignees}
        onSelect={pickAssignee}
        groups={groups}
        readOnly={readOnly}
        backSlot={backSlot}
        viewSlot={viewSlot}
      />

      <BoardToolbar
        columns={columns}
        filters={filters}
        onChange={setFilters}
        matched={matched}
        total={optimisticRows.length}
        people={people}
      />

      {readOnly && (
        <p className="rounded-lg border border-mw-line bg-mw-tint-blue px-3 py-2 text-xs text-mw-body">
          시스템 보드입니다. 정책자금 파이프라인의 딜·정산은 전용 화면에서 관리합니다(구조 편집 불가).
        </p>
      )}

      {sortActive && !readOnly && (
        <p className="text-xs text-mw-sub">
          정렬이 켜져 있어 행 드래그를 잠갔습니다. 직접 배치하려면 정렬을 «기본 순서»로 되돌리세요.
        </p>
      )}

      {blocks.length === 0 ? (
        /* 원칙 5 — 화면 전체를 차지하는 빈 상태 금지. 한 줄 + 다음 행동. */
        <p className="rounded-xl border border-dashed border-mw-line px-3 py-4 text-xs text-mw-sub">
          그룹이 없습니다. 아래 «그룹 추가»로 첫 그룹을 만드세요.
        </p>
      ) : (
        blocks.map((block) => {
          const fullColumns = resolveColumnOrder(columns, optimisticOrder[block.key]);
          const shown = limitColumns(fullColumns, filters.columnLimit);
          const visibleRows = applyFilters(block.rows, columns, filters);

          return (
            <GroupBlock
              key={block.key}
              name={block.name}
              color={block.color}
              columns={shown}
              rows={visibleRows}
              presetName={`${board.name}-${block.name}`}
              presetChanged={Boolean(optimisticOrder[block.key]?.length)}
            >
              <GroupTable
                boardId={board.id}
                groupId={block.group?.id ?? null}
                columns={shown}
                rows={visibleRows}
                readOnly={readOnly}
                canDeleteItems={!board.is_system && canDeleteItems}
                canManageColumns={!board.is_system && canManageColumns}
                rowDragEnabled={rowDragEnabled}
                cellFlash={cellFlash}
                onColumnDrop={(draggedKey, targetKey) =>
                  handleColumnDrop(block.key, fullColumns, draggedKey, targetKey)
                }
                dragRowId={rowDragEnabled ? dragRowId : null}
                canDropRow={canDropRow}
                onRowDragStart={startRowDrag}
                onRowDragEnd={endRowDrag}
                onRowDrop={(index) =>
                  handleRowDrop(block.group?.id ?? null, block.rows, visibleRows, index)
                }
                renderRowAction={board.source === CONTACT_TAB_SOURCE ? (row) => row.values.work_move === "업무관리 이동" ? (
                  <ContactPipelineAction
                    dealId={null}
                    kind="contact_to_work"
                    requestId={row.id}
                    initialCompanyName={row.title}
                    initialValues={{
                      bizNo: String(row.values.biz_no ?? row.values.biz_reg_no ?? ""),
                      ceoName: String(row.values.rep_name ?? ""),
                      bizType: String(row.values.biz_reg_type ?? ""),
                      industry: String(row.values.industry ?? ""),
                      regionSido: String(row.values.sido ?? ""),
                      regionSigungu: String(row.values.sigungu ?? ""),
                      phone: String(row.values.phone ?? ""),
                      foundedOn: String(row.values.founded_year ?? ""),
                      revenue: String(row.values.revenue ?? ""),
                    }}
                  />
                ) : null : undefined}
              />
            </GroupBlock>
          );
        })
      )}
    </div>
  );
}
