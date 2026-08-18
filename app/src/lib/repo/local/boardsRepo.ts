/**
 * 003 임의 보드 엔진 — 로컬(인메모리) 어댑터. (T02b · ADR-0003)
 * 포트: `@/lib/boards/store`. 저장소: 공용 `db()` (repo/local/store.ts 확장분).
 * Supabase 연결 후 SupabaseBoardsRepo 로 교체(포트 뒤 스왑).
 */

import type { Ctx } from "@/lib/types";
import { isManager } from "@/lib/auth/roles";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type {
  Board,
  BoardColumn,
  BoardGroup,
  BoardItem,
  BoardView,
  CellValue,
  ItemValue,
} from "@/lib/boards/types";
import { isSectionPresetSource } from "@/lib/presets/section-presets";
import { normalizeDetailLayout, type DetailLayoutEntry } from "@/lib/boards/detail-layout";
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
  ViewPatch,
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

export class LocalBoardsRepo {
  // ── 보드 ──
  listBoards(ctx: Ctx): Board[] {
    return db()
      .boards.filter((b) => b.org_id === ctx.org.id && !isSectionPresetSource(b.source))
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  listSectionPresetBoards(ctx: Ctx): Board[] {
    return db()
      .boards.filter((b) => b.org_id === ctx.org.id && isSectionPresetSource(b.source))
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
      source: input.source ?? null,
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

  setBoardDetailLayout(ctx: Ctx, id: string, layout: DetailLayoutEntry[]): Board | undefined {
    const board = this.getBoard(ctx, id);
    if (!board) return undefined;
    board.detail_layout_jsonb = normalizeDetailLayout(layout);
    board.updated_at = now();
    return board;
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

  setGroupDetailLayout(
    ctx: Ctx,
    id: string,
    layout: DetailLayoutEntry[] | null,
  ): BoardGroup | undefined {
    const group = db().boardGroups.find((candidate) => candidate.id === id && candidate.org_id === ctx.org.id);
    if (!group) return undefined;
    group.detail_layout_jsonb = layout === null ? null : normalizeDetailLayout(layout);
    return group;
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
      source: input.source ?? "in",
      rightPinned: input.rightPinned ?? false,
      options_jsonb: input.options ? { options: input.options } : null,
      sort_order: existing.length,
      width: input.width ?? null,
      move_rule_jsonb: input.moveRule ?? null,
      is_readonly: input.readOnly ?? false,
    };
    db().boardColumns.push(col);
    return col;
  }

  updateColumn(ctx: Ctx, id: string, patch: ColumnPatch): BoardColumn | undefined {
    const c = db().boardColumns.find((x) => x.id === id && x.org_id === ctx.org.id);
    if (!c) return undefined;
    if (patch.label !== undefined) c.label = patch.label;
    if (patch.source !== undefined) c.source = patch.source;
    if (patch.rightPinned !== undefined) c.rightPinned = patch.rightPinned;
    if (patch.sort_order !== undefined) c.sort_order = patch.sort_order;
    if (patch.width !== undefined) c.width = patch.width;
    if (patch.options !== undefined)
      c.options_jsonb = patch.options ? { options: patch.options } : null;
    if (patch.moveRule !== undefined) c.move_rule_jsonb = patch.moveRule;
    if (patch.readOnly !== undefined) c.is_readonly = patch.readOnly;
    return c;
  }

  /**
   * 컬럼 정의만 지운다 — 셀 값(`itemValues`)은 남긴다 (BBE-177).
   * 근거와 배경은 supabase 어댑터의 같은 메서드 주석에 적었다. 두 어댑터가 어긋나면
   * 로컬 폴백에서만 값이 사라져 재현이 안 되는 차이가 생기므로 동작을 맞춰 둔다.
   */
  deleteColumn(ctx: Ctx, id: string): boolean {
    const d = db();
    const c = d.boardColumns.find((x) => x.id === id && x.org_id === ctx.org.id);
    if (!c) return false;
    d.boardColumns = d.boardColumns.filter((x) => x.id !== id);
    return true;
  }

  // ── 아이템(담당범위) ──
  listItems(ctx: Ctx, boardId: string): BoardItem[] {
    const all = db()
      .boardItems.filter((i) => i.org_id === ctx.org.id && i.board_id === boardId && !i.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order);
    return canSeeAll(ctx) ? all : all.filter((i) => i.assigned_to === ctx.user.id);
  }

  listDeletedItems(ctx: Ctx, boardId: string): BoardItem[] {
    const all = db()
      .boardItems.filter((i) => i.org_id === ctx.org.id && i.board_id === boardId && Boolean(i.deleted_at))
      .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
    return canSeeAll(ctx) ? all : all.filter((i) => i.assigned_to === ctx.user.id);
  }

  getItem(ctx: Ctx, id: string): BoardItem | undefined {
    const i = db().boardItems.find((x) => x.id === id && x.org_id === ctx.org.id && !x.deleted_at);
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
      deleted_at: null,
      deleted_by: null,
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

  deleteItem(ctx: Ctx, boardId: string, id: string): boolean {
    const i = this.getItem(ctx, id);
    if (i?.board_id !== boardId) return false;
    if (!i) return false;
    i.deleted_at = now();
    i.deleted_by = ctx.user.id;
    i.updated_at = now();
    return true;
  }

  restoreItem(ctx: Ctx, boardId: string, id: string): BoardItem | undefined {
    const i = db().boardItems.find(
      (candidate) => candidate.id === id
        && candidate.board_id === boardId
        && candidate.org_id === ctx.org.id
        && Boolean(candidate.deleted_at),
    );
    if (!i || (!canSeeAll(ctx) && i.assigned_to !== ctx.user.id)) return undefined;
    i.deleted_at = null;
    i.deleted_by = null;
    i.updated_at = now();
    return i;
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

  /** 단건 조회 — 가시성 규칙은 listViews 와 동일(공유뷰 ∪ 내 개인뷰). */
  getView(ctx: Ctx, id: string): BoardView | undefined {
    return db().boardViews.find(
      (v) =>
        v.id === id &&
        v.org_id === ctx.org.id &&
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

  updateView(ctx: Ctx, id: string, patch: ViewPatch): BoardView | undefined {
    const v = db().boardViews.find(
      (candidate) =>
        candidate.id === id &&
        candidate.org_id === ctx.org.id &&
        candidate.user_id === ctx.user.id,
    );
    if (!v) return undefined;
    if (patch.name !== undefined) v.name = patch.name;
    if (patch.kind !== undefined) v.kind = patch.kind;
    if (patch.filters !== undefined) v.filters_jsonb = patch.filters;
    if (patch.sort !== undefined) v.sort_jsonb = patch.sort;
    if (patch.visibleColumns !== undefined) v.visible_columns_jsonb = patch.visibleColumns;
    if (patch.shared !== undefined) v.shared = patch.shared;
    return v;
  }

  deleteView(ctx: Ctx, id: string): boolean {
    const d = db();
    const v = d.boardViews.find(
      (x) => x.id === id && x.org_id === ctx.org.id && x.user_id === ctx.user.id,
    );
    if (!v) return false;
    d.boardViews = d.boardViews.filter((x) => x.id !== id);
    return true;
  }
}

// 프로세스 단일 인스턴스(공유 db() 사용) — 환경 미설정 테스트/오프라인 전용.
const globalBoardsRepo = globalThis as unknown as { __moaworkBoardsRepo?: BoardsRepo };

/** Keep the deterministic local store synchronous while exposing the production async port. */
export function toAsyncBoardsRepo(local: LocalBoardsRepo): BoardsRepo {
  return new Proxy(local, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => Reflect.apply(value, target, args);
    },
  }) as unknown as BoardsRepo;
}

export async function getBoardsRepo(): Promise<BoardsRepo> {
  // ★ 반드시 `hasSupabaseEnv()` 와 같은 조건이어야 한다.
  // 전에는 URL 하나만 봤다. ANON_KEY 없이 URL 만 설정된 상태에서는 이 분기가 Supabase 쪽으로
  // 가고 `createClient()` 가 곧바로 throw 한다 — 가드를 세워 둔 화면까지 500 이 된다.
  if (hasSupabaseEnv()) {
    const [{ createClient }, { SupabaseBoardsRepo }] = await Promise.all([
      import("@/lib/supabase/server"),
      import("@/lib/repo/supabase/boardsRepo"),
    ]);
    return new SupabaseBoardsRepo(await createClient());
  }
  if (!globalBoardsRepo.__moaworkBoardsRepo) {
    globalBoardsRepo.__moaworkBoardsRepo = toAsyncBoardsRepo(new LocalBoardsRepo());
  }
  return globalBoardsRepo.__moaworkBoardsRepo;
}
