/**
 * 003 임의 보드 엔진 — 로컬(인메모리) 어댑터. (T02b · ADR-0003)
 * 포트: `@/lib/boards/store`. 저장소: 공용 `db()` (repo/local/store.ts 확장분).
 * Supabase 연결 후 SupabaseBoardsRepo 로 교체(포트 뒤 스왑).
 */

import type { Ctx } from "@/lib/types";
import { isManager } from "@/lib/auth/roles";
import type {
  Board,
  BoardColumn,
  BoardGroup,
  BoardItem,
  BoardView,
  CellValue,
  ItemValue,
} from "@/lib/boards/types";
import type {
  BoardPatch,
  BoardsRepo,
  ColumnPatch,
  ItemPatch,
  NewBoard,
  NewColumn,
  NewGroup,
  NewItem,
  NewView,
} from "@/lib/boards/store";
import { db } from "./store";

function now(): string {
  return new Date().toISOString();
}

/** 담당범위: owner/admin 또는 scope='all' → 전체, member+assigned → 본인 것만. */
function canSeeAll(ctx: Ctx): boolean {
  return isManager(ctx.role) || ctx.scope === "all";
}

/** 라벨 → 컬럼 key slug(유니코드 보존). 보드 내 유일성은 호출측에서 보장. */
export function slugifyKey(label: string): string {
  const base = label.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "");
  return base === "" ? "col" : base;
}

export class LocalBoardsRepo implements BoardsRepo {
  // ── 보드 ──
  listBoards(ctx: Ctx): Board[] {
    return db()
      .boards.filter((b) => b.org_id === ctx.org.id)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  getBoard(ctx: Ctx, id: string): Board | undefined {
    return db().boards.find((b) => b.id === id && b.org_id === ctx.org.id);
  }

  createBoard(ctx: Ctx, input: NewBoard): Board {
    const ts = now();
    const board: Board = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? null,
      is_system: false,
      source: null,
      sort_order: db().boards.filter((b) => b.org_id === ctx.org.id).length,
      created_by: ctx.user.id,
      created_at: ts,
      updated_at: ts,
    };
    db().boards.push(board);
    return board;
  }

  updateBoard(ctx: Ctx, id: string, patch: BoardPatch): Board | undefined {
    const b = this.getBoard(ctx, id);
    if (!b) return undefined;
    Object.assign(b, patch);
    b.updated_at = now();
    return b;
  }

  deleteBoard(ctx: Ctx, id: string): boolean {
    const b = this.getBoard(ctx, id);
    if (!b) return false;
    const d = db();
    d.boards = d.boards.filter((x) => x.id !== id);
    const itemIds = d.boardItems.filter((i) => i.board_id === id).map((i) => i.id);
    d.boardItems = d.boardItems.filter((i) => i.board_id !== id);
    d.itemValues = d.itemValues.filter((v) => !itemIds.includes(v.item_id));
    d.boardColumns = d.boardColumns.filter((c) => c.board_id !== id);
    d.boardGroups = d.boardGroups.filter((g) => g.board_id !== id);
    d.boardViews = d.boardViews.filter((v) => v.board_id !== id);
    return true;
  }

  // ── 그룹 ──
  listGroups(ctx: Ctx, boardId: string): BoardGroup[] {
    return db()
      .boardGroups.filter((g) => g.org_id === ctx.org.id && g.board_id === boardId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  createGroup(ctx: Ctx, boardId: string, input: NewGroup): BoardGroup {
    const group: BoardGroup = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      board_id: boardId,
      name: input.name,
      color: input.color ?? null,
      sort_order: this.listGroups(ctx, boardId).length,
    };
    db().boardGroups.push(group);
    return group;
  }

  deleteGroup(ctx: Ctx, id: string): boolean {
    const d = db();
    const g = d.boardGroups.find((x) => x.id === id && x.org_id === ctx.org.id);
    if (!g) return false;
    d.boardGroups = d.boardGroups.filter((x) => x.id !== id);
    // 003: on delete set null
    for (const it of d.boardItems) if (it.group_id === id) it.group_id = null;
    return true;
  }

  // ── 컬럼 ──
  listColumns(ctx: Ctx, boardId: string): BoardColumn[] {
    return db()
      .boardColumns.filter((c) => c.org_id === ctx.org.id && c.board_id === boardId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  createColumn(ctx: Ctx, boardId: string, input: NewColumn): BoardColumn {
    const existing = this.listColumns(ctx, boardId);
    // (board_id, key) unique — 충돌 시 접미사.
    const base = input.key?.trim() || slugifyKey(input.label);
    let key = base;
    let n = 2;
    while (existing.some((c) => c.key === key)) key = `${base}_${n++}`;

    const col: BoardColumn = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      board_id: boardId,
      key,
      label: input.label,
      type: input.type,
      options_jsonb: input.options ? { options: input.options } : null,
      sort_order: existing.length,
      width: input.width ?? null,
    };
    db().boardColumns.push(col);
    return col;
  }

  updateColumn(ctx: Ctx, id: string, patch: ColumnPatch): BoardColumn | undefined {
    const c = db().boardColumns.find((x) => x.id === id && x.org_id === ctx.org.id);
    if (!c) return undefined;
    if (patch.label !== undefined) c.label = patch.label;
    if (patch.sort_order !== undefined) c.sort_order = patch.sort_order;
    if (patch.width !== undefined) c.width = patch.width;
    if (patch.options !== undefined)
      c.options_jsonb = patch.options ? { options: patch.options } : null;
    return c;
  }

  deleteColumn(ctx: Ctx, id: string): boolean {
    const d = db();
    const c = d.boardColumns.find((x) => x.id === id && x.org_id === ctx.org.id);
    if (!c) return false;
    d.boardColumns = d.boardColumns.filter((x) => x.id !== id);
    // 컬럼 삭제 시 해당 키의 셀 값 정리(EAV 고아 방지).
    d.itemValues = d.itemValues.filter((v) => v.column_key !== c.key);
    return true;
  }

  // ── 아이템(담당범위) ──
  listItems(ctx: Ctx, boardId: string): BoardItem[] {
    const all = db()
      .boardItems.filter((i) => i.org_id === ctx.org.id && i.board_id === boardId)
      .sort((a, b) => a.sort_order - b.sort_order);
    return canSeeAll(ctx) ? all : all.filter((i) => i.assigned_to === ctx.user.id);
  }

  getItem(ctx: Ctx, id: string): BoardItem | undefined {
    const i = db().boardItems.find((x) => x.id === id && x.org_id === ctx.org.id);
    if (!i) return undefined;
    return canSeeAll(ctx) || i.assigned_to === ctx.user.id ? i : undefined;
  }

  createItem(ctx: Ctx, boardId: string, input: NewItem): BoardItem {
    // member+assigned 는 타인에게 배정 불가 → 본인으로 강제.
    const assigned = canSeeAll(ctx) ? (input.assigned_to ?? null) : ctx.user.id;
    const ts = now();
    const item: BoardItem = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      board_id: boardId,
      group_id: input.group_id ?? null,
      title: input.title,
      assigned_to: assigned,
      sort_order: db().boardItems.filter((i) => i.board_id === boardId).length,
      created_at: ts,
      updated_at: ts,
    };
    db().boardItems.push(item);
    if (input.values) this.setValues(ctx, item.id, input.values);
    return item;
  }

  updateItem(ctx: Ctx, id: string, patch: ItemPatch): BoardItem | undefined {
    const i = this.getItem(ctx, id);
    if (!i) return undefined;
    const { assigned_to, ...rest } = patch;
    Object.assign(i, rest);
    if (assigned_to !== undefined && canSeeAll(ctx)) i.assigned_to = assigned_to;
    i.updated_at = now();
    return i;
  }

  deleteItem(ctx: Ctx, id: string): boolean {
    const i = this.getItem(ctx, id);
    if (!i) return false;
    const d = db();
    d.boardItems = d.boardItems.filter((x) => x.id !== id);
    d.itemValues = d.itemValues.filter((v) => v.item_id !== id);
    return true;
  }

  // ── 셀 값 ──
  listValues(ctx: Ctx, itemIds: string[]): ItemValue[] {
    const set = new Set(itemIds);
    return db().itemValues.filter((v) => v.org_id === ctx.org.id && set.has(v.item_id));
  }

  setValues(ctx: Ctx, itemId: string, patch: Record<string, CellValue>): void {
    if (!this.getItem(ctx, itemId)) return; // 가시성 없는 아이템은 무시
    const d = db();
    for (const [column_key, value_jsonb] of Object.entries(patch)) {
      const existing = d.itemValues.find(
        (v) => v.item_id === itemId && v.column_key === column_key,
      );
      if (existing) existing.value_jsonb = value_jsonb;
      else d.itemValues.push({ org_id: ctx.org.id, item_id: itemId, column_key, value_jsonb });
    }
    const item = d.boardItems.find((i) => i.id === itemId);
    if (item) item.updated_at = now();
  }

  // ── 뷰 ──
  listViews(ctx: Ctx, boardId: string): BoardView[] {
    return db().boardViews.filter(
      (v) =>
        v.org_id === ctx.org.id &&
        v.board_id === boardId &&
        (v.shared || v.user_id === ctx.user.id || v.user_id === null),
    );
  }

  createView(ctx: Ctx, boardId: string, input: NewView): BoardView {
    const view: BoardView = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      board_id: boardId,
      user_id: ctx.user.id,
      name: input.name,
      kind: input.kind,
      filters_jsonb: input.filters ?? {},
      sort_jsonb: input.sort ?? [],
      visible_columns_jsonb: input.visibleColumns ?? [],
      shared: input.shared ?? false,
    };
    db().boardViews.push(view);
    return view;
  }

  deleteView(ctx: Ctx, id: string): boolean {
    const d = db();
    const v = d.boardViews.find((x) => x.id === id && x.org_id === ctx.org.id);
    if (!v) return false;
    d.boardViews = d.boardViews.filter((x) => x.id !== id);
    return true;
  }
}

// 프로세스 단일 인스턴스(공유 db() 사용).
const globalBoardsRepo = globalThis as unknown as { __moaworkBoardsRepo?: BoardsRepo };

export function getBoardsRepo(): BoardsRepo {
  if (!globalBoardsRepo.__moaworkBoardsRepo) {
    globalBoardsRepo.__moaworkBoardsRepo = new LocalBoardsRepo();
  }
  return globalBoardsRepo.__moaworkBoardsRepo;
}
