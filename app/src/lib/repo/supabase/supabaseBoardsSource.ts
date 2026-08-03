import type { SupabaseClient } from "@supabase/supabase-js";
import type { Board, BoardCellValue, BoardColumn, BoardGroup, BoardItem, CellValue, FileCapableItemWithValues } from "@/lib/boards/types";
import type { Ctx, FieldType } from "@/lib/types";
import { validateCell } from "@/lib/boards/cells";

export class SupabaseBoardsError extends Error {
  constructor(operation: string, detail: string) {
    super(`보드 ${operation} 실패: ${detail}`);
    this.name = "SupabaseBoardsError";
  }
}

type ColumnSeed = { key: string; label: string; type: FieldType; options?: { id: string; label: string; color?: string }[]; width?: number };

export const NEWCUST_SOURCE = "newcust.monday.v1";
const NEWCUST_INITIALIZING_SOURCE = `${NEWCUST_SOURCE}:initializing`;
function scopedUuid(orgId: string, discriminator: number): string {
  const compact = orgId.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) throw new SupabaseBoardsError("초기화", "조직 ID 형식이 올바르지 않습니다.");
  const tail = ((Number.parseInt(compact.at(-1)!, 16) ^ discriminator) & 15).toString(16);
  const value = `${compact.slice(0, -1)}${tail}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
export const NEWCUST_COLUMNS: readonly ColumnSeed[] = [
  { key: "applied_on", label: "신청일", type: "date", width: 130 },
  { key: "ad_name", label: "광고명", type: "text", width: 160 },
  { key: "business_type", label: "사업자 유형", type: "text", width: 140 },
  { key: "company_name", label: "회사명", type: "text", width: 180 },
  { key: "company_revenue", label: "매출액", type: "number", width: 140 },
  { key: "contact", label: "연락처", type: "phone", width: 160 },
  { key: "files", label: "파일", type: "file", width: 140 },
  { key: "owner_name", label: "대표자명", type: "text", width: 140 },
  { key: "address", label: "주소", type: "text", width: 220 },
  { key: "contact_status", label: "연락 상태", type: "select", options: [{ id: "new", label: "신규", color: "#c4c4c4" }, { id: "contacted", label: "연락 완료", color: "#579bfc" }] },
  { key: "proposal_status", label: "제안 상태", type: "select", options: [{ id: "pending", label: "검토 중", color: "#fdab3d" }, { id: "sent", label: "제안 완료", color: "#00c875" }] },
  { key: "expected_revenue", label: "예상 매출", type: "number", width: 140 },
  { key: "priority", label: "우선순위", type: "select", options: [{ id: "high", label: "높음", color: "#e2445c" }, { id: "medium", label: "보통", color: "#fdab3d" }, { id: "low", label: "낮음", color: "#00c875" }] },
  { key: "next_contact", label: "다음 연락일", type: "date", width: 150 },
  { key: "legacy_email", label: "이메일", type: "email", width: 180 },
  { key: "legacy_note", label: "메모", type: "longtext", width: 220 },
  { key: "legacy_stage_name", label: "기존 단계", type: "text", width: 140 },
] as const;

export type NewcustSnapshot = {
  board: Board;
  groups: BoardGroup[];
  columns: BoardColumn[];
  items: FileCapableItemWithValues[];
  views: Array<{ id: string; name: string; kind: string; sort_jsonb: unknown[]; visible_columns_jsonb: unknown[]; filters_jsonb: Record<string, unknown> }>;
};

export class SupabaseBoardsSource {
  constructor(private readonly db: SupabaseClient) {}

  private fail(operation: string, error: { message?: string } | null): never {
    throw new SupabaseBoardsError(operation, error?.message ?? "알 수 없는 오류");
  }

  async ensureNewcustBoard(ctx: Ctx): Promise<NewcustSnapshot> {
    const existing = await this.db.from("boards").select("*").eq("org_id", ctx.org.id).eq("source", NEWCUST_SOURCE).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (existing.error) this.fail("조회", existing.error);
    let board = existing.data as Board | null;
    if (!board) {
      const created = await this.db.from("boards").upsert({ id: scopedUuid(ctx.org.id, 1), org_id: ctx.org.id, name: "신규업체", description: "새로 문의한 업체와 다음 연락을 한눈에 관리합니다.", icon: "🔥", source: NEWCUST_INITIALIZING_SOURCE, created_by: ctx.user.id }, { onConflict: "id", ignoreDuplicates: true }).select("*").maybeSingle();
      if (created.error) this.fail("생성", created.error);
      if (created.data) board = created.data as Board;
      else {
        const concurrent = await this.db.from("boards").select("*").eq("org_id", ctx.org.id).eq("id", scopedUuid(ctx.org.id, 1)).single();
        if (concurrent.error) this.fail("동시 생성 조회", concurrent.error);
        board = concurrent.data as Board;
      }
      const group = await this.db.from("board_groups").upsert({ id: scopedUuid(ctx.org.id, 2), org_id: ctx.org.id, board_id: board.id, name: "신규 문의", color: "#579bfc", sort_order: 0 }, { onConflict: "id", ignoreDuplicates: true });
      if (group.error) this.fail("기본 그룹 생성", group.error);
      const columns = await this.db.from("board_columns").upsert(NEWCUST_COLUMNS.map((column, index) => ({ org_id: ctx.org.id, board_id: board!.id, key: column.key, label: column.label, type: column.type, options_jsonb: column.options ? { options: column.options } : null, sort_order: index, width: column.width ?? null })), { onConflict: "board_id,key", ignoreDuplicates: true });
      if (columns.error) this.fail("기본 컬럼 생성", columns.error);
      const finalized = await this.db.from("boards").update({ source: NEWCUST_SOURCE }).eq("org_id", ctx.org.id).eq("id", board.id).eq("source", NEWCUST_INITIALIZING_SOURCE).select("*").maybeSingle();
      if (finalized.error) this.fail("초기화 완료", finalized.error);
      if (finalized.data) board = finalized.data as Board;
    }
    // A prior request may have stopped after creating only part of the defaults.
    // Heal that partial bootstrap on every entry without replacing user data.
    const [groups, columns] = await Promise.all([
      this.db.from("board_groups").select("id").eq("org_id", ctx.org.id).eq("board_id", board.id).limit(1),
      this.db.from("board_columns").select("key").eq("org_id", ctx.org.id).eq("board_id", board.id),
    ]);
    if (groups.error) this.fail("기본 그룹 확인", groups.error);
    if (columns.error) this.fail("기본 컬럼 확인", columns.error);
    if (!groups.data?.length) {
      const result = await this.db.from("board_groups").upsert({ id: scopedUuid(ctx.org.id, 2), org_id: ctx.org.id, board_id: board.id, name: "신규 문의", color: "#579bfc", sort_order: 0 }, { onConflict: "id", ignoreDuplicates: true });
      if (result.error) this.fail("기본 그룹 복구", result.error);
    }
    // Column bootstrap is a single atomic insert when the deterministic board is
    // first created. Never recreate absent columns here: deleting even the last
    // default column must survive refresh.
    return this.load(ctx, board.id);
  }

  async load(ctx: Ctx, boardId: string): Promise<NewcustSnapshot> {
    const [boardResult, groupsResult, columnsResult, itemsResult, viewsResult] = await Promise.all([
      this.db.from("boards").select("*").eq("org_id", ctx.org.id).eq("id", boardId).single(),
      this.db.from("board_groups").select("*").eq("org_id", ctx.org.id).eq("board_id", boardId).order("sort_order"),
      this.db.from("board_columns").select("*").eq("org_id", ctx.org.id).eq("board_id", boardId).order("sort_order"),
      this.db.from("items").select("*").eq("org_id", ctx.org.id).eq("board_id", boardId).order("sort_order"),
      this.db.from("board_views").select("id,name,kind,sort_jsonb,visible_columns_jsonb,filters_jsonb").eq("org_id", ctx.org.id).eq("board_id", boardId).or(`user_id.eq.${ctx.user.id},shared.eq.true`),
    ]);
    if (boardResult.error) this.fail("조회", boardResult.error);
    if (groupsResult.error) this.fail("그룹 조회", groupsResult.error);
    if (columnsResult.error) this.fail("컬럼 조회", columnsResult.error);
    if (itemsResult.error) this.fail("항목 조회", itemsResult.error);
    if (viewsResult.error) this.fail("view query", viewsResult.error);
    const rawItems = (itemsResult.data ?? []) as BoardItem[];
    let values: { item_id: string; column_key: string; value_jsonb: BoardCellValue }[] = [];
    if (rawItems.length) {
      const result = await this.db.from("item_values").select("item_id,column_key,value_jsonb").eq("org_id", ctx.org.id).in("item_id", rawItems.map((item) => item.id));
      if (result.error) this.fail("셀 조회", result.error);
      values = result.data ?? [];
    }
    return {
      board: boardResult.data as Board,
      groups: (groupsResult.data ?? []) as BoardGroup[],
      columns: (columnsResult.data ?? []) as BoardColumn[],
      items: rawItems.map((item) => ({ ...item, values: Object.fromEntries(values.filter((value) => value.item_id === item.id).map((value) => [value.column_key, value.value_jsonb])) })),
      views: (viewsResult.data ?? []) as NewcustSnapshot["views"],
    };
  }

  private async assertBoard(ctx: Ctx, boardId: string): Promise<void> {
    const board = await this.db.from("boards").select("id").eq("org_id", ctx.org.id).eq("id", boardId).eq("source", NEWCUST_SOURCE).maybeSingle();
    if (board.error) this.fail("권한 확인", board.error);
    if (!board.data) throw new SupabaseBoardsError("권한 확인", "신규업체 보드를 찾을 수 없습니다.");
  }

  async createItem(ctx: Ctx, boardId: string, groupId: string, title: string): Promise<void> {
    await this.assertBoard(ctx, boardId);
    const group = await this.db.from("board_groups").select("id").eq("org_id", ctx.org.id).eq("board_id", boardId).eq("id", groupId).maybeSingle();
    if (group.error) this.fail("그룹 확인", group.error);
    if (!group.data) throw new SupabaseBoardsError("업체 추가", "그룹을 찾을 수 없습니다.");
    const result = await this.db.from("items").insert({ org_id: ctx.org.id, board_id: boardId, group_id: groupId, title, assigned_to: ctx.user.id });
    if (result.error) this.fail("업체 추가", result.error);
  }

  async updateItem(ctx: Ctx, boardId: string, itemId: string, patch: { title?: string; assigned_to?: string | null; group_id?: string }): Promise<void> {
    await this.assertBoard(ctx, boardId);
    if (patch.assigned_to) {
      const member = await this.db.from("org_members").select("user_id").eq("org_id", ctx.org.id).eq("user_id", patch.assigned_to).eq("status", "active").maybeSingle();
      if (member.error) this.fail("담당자 확인", member.error);
      if (!member.data) throw new SupabaseBoardsError("업체 수정", "같은 조직의 활성 멤버만 담당자로 지정할 수 있습니다.");
    }
    const result = await this.db.from("items").update({ ...patch, updated_at: new Date().toISOString() }).eq("org_id", ctx.org.id).eq("board_id", boardId).eq("id", itemId).select("id").maybeSingle();
    if (result.error) this.fail("업체 수정", result.error);
    if (!result.data) throw new SupabaseBoardsError("업체 수정", "업체를 찾을 수 없습니다.");
  }

  async setCell(ctx: Ctx, boardId: string, itemId: string, key: string, raw: string): Promise<void> {
    await this.assertBoard(ctx, boardId);
    const [item, column] = await Promise.all([
      this.db.from("items").select("id").eq("org_id", ctx.org.id).eq("board_id", boardId).eq("id", itemId).maybeSingle(),
      this.db.from("board_columns").select("*").eq("org_id", ctx.org.id).eq("board_id", boardId).eq("key", key).maybeSingle(),
    ]);
    if (item.error) this.fail("업체 확인", item.error);
    if (column.error) this.fail("컬럼 확인", column.error);
    if (!item.data || !column.data) throw new SupabaseBoardsError("셀 저장", "업체 또는 컬럼을 찾을 수 없습니다.");
    const actual = column.data as BoardColumn;
    const candidate: CellValue = actual.type === "number" && raw ? Number(raw) : raw || null;
    const checked = validateCell(actual.type, candidate, actual.options_jsonb?.options);
    if (!checked.ok) throw new SupabaseBoardsError("셀 저장", checked.error ?? "값을 확인해 주세요.");
    const result = await this.db.from("item_values").upsert({ org_id: ctx.org.id, item_id: itemId, column_key: key, value_jsonb: checked.value }, { onConflict: "item_id,column_key" });
    if (result.error) this.fail("셀 저장", result.error);
  }

  async addColumn(ctx: Ctx, boardId: string, input: { label: string; type: FieldType }): Promise<void> {
    await this.assertBoard(ctx, boardId);
    const count = await this.db.from("board_columns").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id).eq("board_id", boardId);
    if (count.error) this.fail("컬럼 확인", count.error);
    const key = `custom_${Date.now().toString(36)}`;
    const options = input.type === "select" ? { options: [{ id: "option_1", label: "옵션 1", color: "#579bfc" }] } : null;
    const result = await this.db.from("board_columns").insert({ org_id: ctx.org.id, board_id: boardId, key, label: input.label, type: input.type, options_jsonb: options, sort_order: count.count ?? 0 });
    if (result.error) this.fail("컬럼 추가", result.error);
  }

  async renameColumn(ctx: Ctx, boardId: string, columnId: string, label: string): Promise<void> {
    await this.assertBoard(ctx, boardId);
    const result = await this.db.from("board_columns").update({ label }).eq("org_id", ctx.org.id).eq("board_id", boardId).eq("id", columnId).select("id").maybeSingle();
    if (result.error) this.fail("컬럼 이름 변경", result.error);
    if (!result.data) throw new SupabaseBoardsError("컬럼 이름 변경", "컬럼을 찾을 수 없습니다.");
  }

  async deleteColumn(ctx: Ctx, boardId: string, column: BoardColumn): Promise<void> {
    await this.assertBoard(ctx, boardId);
    const actual = await this.db.from("board_columns").select("key").eq("org_id", ctx.org.id).eq("board_id", boardId).eq("id", column.id).maybeSingle();
    if (actual.error) this.fail("컬럼 확인", actual.error);
    if (!actual.data || actual.data.key !== column.key) throw new SupabaseBoardsError("컬럼 삭제", "컬럼을 찾을 수 없습니다.");
    const result = await this.db.from("board_columns").delete().eq("org_id", ctx.org.id).eq("board_id", boardId).eq("id", column.id);
    if (result.error) this.fail("컬럼 삭제", result.error);
    // Values become unreachable as soon as the column is gone. Cleanup happens
    // afterwards so a cleanup failure cannot leave a visible column with lost data.
    const items = await this.db.from("items").select("id").eq("org_id", ctx.org.id).eq("board_id", boardId);
    if (items.error) return;
    const ids = (items.data ?? []).map((item) => item.id);
    if (ids.length) {
      const values = await this.db.from("item_values").delete().eq("org_id", ctx.org.id).eq("column_key", column.key).in("item_id", ids);
      if (values.error) return;
    }
  }

  async addGroup(ctx: Ctx, boardId: string, name: string): Promise<void> {
    await this.assertBoard(ctx, boardId);
    const count = await this.db.from("board_groups").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id).eq("board_id", boardId);
    const result = await this.db.from("board_groups").insert({ org_id: ctx.org.id, board_id: boardId, name, color: "#00c875", sort_order: count.count ?? 0 });
    if (result.error) this.fail("그룹 추가", result.error);
  }

  async createView(ctx: Ctx, boardId: string, input: { name: string; kind: string; sort: string; groupBy: string; visibleColumns: string[] }): Promise<void> {
    await this.assertBoard(ctx, boardId);
    if (!["table", "kanban", "calendar"].includes(input.kind)) throw new SupabaseBoardsError("view save", "unsupported view");
    const result = await this.db.from("board_views").insert({ org_id: ctx.org.id, board_id: boardId, user_id: ctx.user.id, name: input.name, kind: input.kind, filters_jsonb: { groupBy: input.groupBy }, sort_jsonb: input.sort ? [{ key: input.sort }] : [], visible_columns_jsonb: input.visibleColumns, shared: false });
    if (result.error) this.fail("view save", result.error);
  }

  async importItems(ctx: Ctx, boardId: string, groupId: string, titles: string[]): Promise<string[]> {
    await this.assertBoard(ctx, boardId);
    const group = await this.db.from("board_groups").select("id").eq("org_id", ctx.org.id).eq("board_id", boardId).eq("id", groupId).maybeSingle();
    if (group.error) this.fail("CSV 그룹 확인", group.error);
    if (!group.data) throw new SupabaseBoardsError("CSV 가져오기", "그룹을 찾을 수 없습니다.");
    const result = await this.db.from("items").insert(titles.map((title, index) => ({ org_id: ctx.org.id, board_id: boardId, group_id: groupId, title, assigned_to: ctx.user.id, sort_order: index }))).select("id");
    if (result.error) this.fail("CSV 가져오기", result.error);
    return (result.data ?? []).map((item) => item.id);
  }

  async deleteImportedItems(ctx: Ctx, boardId: string, itemIds: string[]): Promise<void> {
    await this.assertBoard(ctx, boardId);
    if (!itemIds.length) return;
    const result = await this.db.from("items").delete().eq("org_id", ctx.org.id).eq("board_id", boardId).in("id", itemIds);
    if (result.error) this.fail("CSV 되돌리기", result.error);
  }
}
