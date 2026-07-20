/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PostgREST 어댑터 (T02) — Supabase REST(PostgREST) 기반 CrmStore 운영 구현.
 * 의존성 없이 전역 fetch 사용. 순수 쿼리 빌더(buildFilterQuery/restPath)는 단위테스트.
 *
 * 서버 전용: service_role 키로 접근(RLS 우회) + 앱 레이어 org 스코핑.
 * (T03 가 DB 레벨 RLS 정책으로 심화하면, 사용자 JWT 전달 방식으로 전환 가능.)
 *
 * 트랜잭션 주의: PostgREST 는 다중 문장 트랜잭션이 없다. createBoard 의 board→stages→
 * columns 는 순차 insert 다. 운영 강화 시 Postgres RPC(function) 로 원자화 권장.
 */

import type {
  Board,
  BoardColumn,
  ColumnValue,
  Item,
  PipelineStage,
  SavedView,
  CellValue,
} from "./types";
import type {
  BoardPatch,
  CrmStore,
  ItemPatch,
  NewBoard,
  NewColumn,
  NewItem,
  NewStage,
  NewView,
  ViewPatch,
} from "./store";

// ── 순수 쿼리 빌더 ────────────────────────────────────────

/** PostgREST 필터 맵을 쿼리 문자열로 인코딩. { org_id: "eq.x" } → "org_id=eq.x". */
export function buildFilterQuery(filters: Record<string, string>, extra: Record<string, string> = {}): string {
  const parts: string[] = [];
  for (const [col, expr] of Object.entries(filters)) {
    parts.push(`${encodeURIComponent(col)}=${encodeURIComponent(expr)}`);
  }
  for (const [k, v] of Object.entries(extra)) {
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.join("&");
}

/** REST 경로 조립: base + /rest/v1/table?query. */
export function restPath(base: string, table: string, query: string): string {
  const root = base.replace(/\/+$/, "");
  const q = query ? `?${query}` : "";
  return `${root}/rest/v1/${table}${q}`;
}

/** `in` 필터 값 조립: ["a","b"] → "in.(a,b)". */
export function inList(values: string[]): string {
  return `in.(${values.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")})`;
}

// ── 행 매핑 (snake_case DB ↔ camelCase 도메인) ────────────

function mapBoard(r: any): Board {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    description: r.description ?? null,
    position: r.position,
    archived: r.archived,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function mapStage(r: any): PipelineStage {
  return {
    id: r.id,
    orgId: r.org_id,
    boardId: r.board_id,
    key: r.key,
    label: r.label,
    position: r.position,
    color: r.color ?? null,
    isTerminal: r.is_terminal,
    createdAt: r.created_at,
  };
}
function mapColumn(r: any): BoardColumn {
  return {
    id: r.id,
    orgId: r.org_id,
    boardId: r.board_id,
    key: r.key,
    title: r.title,
    type: r.type,
    settings: r.settings ?? {},
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function mapItem(r: any): Item {
  return {
    id: r.id,
    orgId: r.org_id,
    boardId: r.board_id,
    stageId: r.stage_id ?? null,
    name: r.name,
    position: r.position,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at ?? null,
  };
}
function mapValue(r: any): ColumnValue {
  return { itemId: r.item_id, columnId: r.column_id, orgId: r.org_id, value: r.value, updatedAt: r.updated_at };
}
function mapView(r: any): SavedView {
  return {
    id: r.id,
    orgId: r.org_id,
    boardId: r.board_id,
    name: r.name,
    config: r.config ?? { filters: [], sorts: [] },
    isDefault: r.is_default,
    createdBy: r.created_by ?? null,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface PostgrestConfig {
  url: string;
  /** service_role 키(서버 전용). */
  serviceKey: string;
  fetchImpl?: typeof fetch;
}

/** Supabase PostgREST 기반 CrmStore. */
export class PostgrestCrmStore implements CrmStore {
  private readonly f: typeof fetch;

  constructor(private readonly cfg: PostgrestConfig) {
    this.f = cfg.fetchImpl ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.cfg.serviceKey,
      Authorization: `Bearer ${this.cfg.serviceKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private async req<T>(
    method: string,
    table: string,
    query: string,
    body?: unknown,
    prefer?: string,
  ): Promise<T> {
    // prefer 미지정 시 return=representation(파싱). 명시 시 그 값 사용(파싱 생략).
    const preferHeader = prefer ?? "return=representation";
    const parse = prefer === undefined;
    const url = restPath(this.cfg.url, table, query);
    const res = await this.f(url, {
      method,
      headers: this.headers({ Prefer: preferHeader }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`PostgREST ${method} ${table} 실패: ${res.status} ${text}`);
    }
    if (!parse || res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // boards
  async createBoard(
    orgId: string,
    userId: string | null,
    board: NewBoard,
    stages: NewStage[],
    columns: NewColumn[],
  ) {
    const [b] = await this.req<any[]>("POST", "boards", "", {
      org_id: orgId,
      name: board.name,
      description: board.description ?? null,
      created_by: userId,
    });
    const boardId = b.id;
    const stageRows = stages.map((s) => ({
      org_id: orgId,
      board_id: boardId,
      key: s.key,
      label: s.label,
      position: s.position,
      color: s.color ?? null,
      is_terminal: s.isTerminal,
    }));
    const colRows = columns.map((c) => ({
      org_id: orgId,
      board_id: boardId,
      key: c.key,
      title: c.title,
      type: c.type,
      position: c.position,
      settings: c.settings ?? {},
    }));
    const [insertedStages, insertedCols] = await Promise.all([
      stageRows.length ? this.req<any[]>("POST", "pipeline_stages", "", stageRows) : Promise.resolve([]),
      colRows.length ? this.req<any[]>("POST", "board_columns", "", colRows) : Promise.resolve([]),
    ]);
    return {
      board: mapBoard(b),
      stages: insertedStages.map(mapStage),
      columns: insertedCols.map(mapColumn),
    };
  }

  async listBoards(orgId: string) {
    const q = buildFilterQuery({ org_id: `eq.${orgId}`, archived: "eq.false" }, { order: "position.asc" });
    return (await this.req<any[]>("GET", "boards", q)).map(mapBoard);
  }

  async getBoard(orgId: string, boardId: string) {
    const q = buildFilterQuery({ org_id: `eq.${orgId}`, id: `eq.${boardId}` });
    const rows = await this.req<any[]>("GET", "boards", q);
    return rows[0] ? mapBoard(rows[0]) : null;
  }

  async updateBoard(orgId: string, boardId: string, patch: BoardPatch) {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.archived !== undefined) body.archived = patch.archived;
    const q = buildFilterQuery({ org_id: `eq.${orgId}`, id: `eq.${boardId}` });
    const rows = await this.req<any[]>("PATCH", "boards", q, body);
    return rows[0] ? mapBoard(rows[0]) : null;
  }

  async deleteBoard(orgId: string, boardId: string) {
    const q = buildFilterQuery({ org_id: `eq.${orgId}`, id: `eq.${boardId}` });
    const rows = await this.req<any[]>("DELETE", "boards", q);
    return rows.length > 0;
  }

  async listStages(orgId: string, boardId: string) {
    const q = buildFilterQuery(
      { org_id: `eq.${orgId}`, board_id: `eq.${boardId}` },
      { order: "position.asc" },
    );
    return (await this.req<any[]>("GET", "pipeline_stages", q)).map(mapStage);
  }

  async listColumns(orgId: string, boardId: string) {
    const q = buildFilterQuery(
      { org_id: `eq.${orgId}`, board_id: `eq.${boardId}` },
      { order: "position.asc" },
    );
    return (await this.req<any[]>("GET", "board_columns", q)).map(mapColumn);
  }

  // items
  async createItem(orgId: string, userId: string | null, boardId: string, item: NewItem) {
    const [row] = await this.req<any[]>("POST", "items", "", {
      org_id: orgId,
      board_id: boardId,
      stage_id: item.stageId,
      name: item.name,
      position: item.position,
      created_by: userId,
    });
    return mapItem(row);
  }

  async listItems(orgId: string, boardId: string) {
    const q = buildFilterQuery(
      { org_id: `eq.${orgId}`, board_id: `eq.${boardId}` },
      { order: "position.asc" },
    );
    return (await this.req<any[]>("GET", "items", q)).map(mapItem);
  }

  async getItem(orgId: string, itemId: string) {
    const q = buildFilterQuery({ org_id: `eq.${orgId}`, id: `eq.${itemId}` });
    const rows = await this.req<any[]>("GET", "items", q);
    return rows[0] ? mapItem(rows[0]) : null;
  }

  async updateItem(orgId: string, itemId: string, patch: ItemPatch) {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.stageId !== undefined) body.stage_id = patch.stageId;
    if (patch.completedAt !== undefined) body.completed_at = patch.completedAt;
    if (patch.position !== undefined) body.position = patch.position;
    const q = buildFilterQuery({ org_id: `eq.${orgId}`, id: `eq.${itemId}` });
    const rows = await this.req<any[]>("PATCH", "items", q, body);
    return rows[0] ? mapItem(rows[0]) : null;
  }

  async deleteItem(orgId: string, itemId: string) {
    const q = buildFilterQuery({ org_id: `eq.${orgId}`, id: `eq.${itemId}` });
    const rows = await this.req<any[]>("DELETE", "items", q);
    return rows.length > 0;
  }

  // column values
  async listValues(orgId: string, itemIds: string[]) {
    if (itemIds.length === 0) return [];
    const q = buildFilterQuery({ org_id: `eq.${orgId}`, item_id: inList(itemIds) });
    return (await this.req<any[]>("GET", "column_values", q)).map(mapValue);
  }

  async setValues(orgId: string, itemId: string, patch: Record<string, CellValue>) {
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    // 아이템의 보드 컬럼을 조회해 key→column_id 매핑
    const item = await this.getItem(orgId, itemId);
    if (!item) return;
    const cols = await this.listColumns(orgId, item.boardId);
    const byKey = new Map(cols.map((c) => [c.key, c.id]));
    const rows = keys
      .filter((k) => byKey.has(k))
      .map((k) => ({ item_id: itemId, column_id: byKey.get(k), org_id: orgId, value: patch[k] }));
    if (rows.length === 0) return;
    // upsert: PK(item_id,column_id) 충돌 시 병합. Prefer resolution=merge-duplicates.
    await this.req(
      "POST",
      "column_values",
      buildFilterQuery({}, { on_conflict: "item_id,column_id" }),
      rows,
      "resolution=merge-duplicates",
    );
  }

  // views
  async createView(orgId: string, userId: string | null, boardId: string, view: NewView) {
    const [row] = await this.req<any[]>("POST", "saved_views", "", {
      org_id: orgId,
      board_id: boardId,
      name: view.name,
      config: view.config,
      is_default: view.isDefault,
      created_by: userId,
    });
    return mapView(row);
  }

  async listViews(orgId: string, boardId: string) {
    const q = buildFilterQuery(
      { org_id: `eq.${orgId}`, board_id: `eq.${boardId}` },
      { order: "position.asc" },
    );
    return (await this.req<any[]>("GET", "saved_views", q)).map(mapView);
  }

  async getView(orgId: string, viewId: string) {
    const q = buildFilterQuery({ org_id: `eq.${orgId}`, id: `eq.${viewId}` });
    const rows = await this.req<any[]>("GET", "saved_views", q);
    return rows[0] ? mapView(rows[0]) : null;
  }

  async updateView(orgId: string, viewId: string, patch: ViewPatch) {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.config !== undefined) body.config = patch.config;
    if (patch.isDefault !== undefined) body.is_default = patch.isDefault;
    const q = buildFilterQuery({ org_id: `eq.${orgId}`, id: `eq.${viewId}` });
    const rows = await this.req<any[]>("PATCH", "saved_views", q, body);
    return rows[0] ? mapView(rows[0]) : null;
  }

  async deleteView(orgId: string, viewId: string) {
    const q = buildFilterQuery({ org_id: `eq.${orgId}`, id: `eq.${viewId}` });
    const rows = await this.req<any[]>("DELETE", "saved_views", q);
    return rows.length > 0;
  }
}
