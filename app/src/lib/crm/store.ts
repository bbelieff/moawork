/**
 * 스토어 포트 + 인메모리 어댑터 (T02).
 *
 * CrmStore = 영속성 포트. 모든 메서드는 orgId 로 **앱 레이어 스코핑**한다
 * (DB 레벨 RLS 는 T03 가 추가; 이 계층은 그와 독립적으로 테넌트 격리).
 * 인메모리 어댑터는 참조 구현이자 테스트/개발용. 운영 어댑터는 postgrest.ts.
 */

import type {
  Board,
  BoardColumn,
  ColumnValue,
  Item,
  PipelineStage,
  SavedView,
  CellValue,
  ColumnType,
  ColumnSettings,
  ViewConfig,
} from "./types";

// ── 입력 타입 (id/타임스탬프는 스토어가 생성) ─────────────

export interface NewBoard {
  name: string;
  description?: string;
}
export interface NewStage {
  key: string;
  label: string;
  position: number;
  color?: string;
  isTerminal: boolean;
}
export interface NewColumn {
  key: string;
  title: string;
  type: ColumnType;
  position: number;
  settings?: ColumnSettings;
}
export interface NewItem {
  name: string;
  stageId: string | null;
  position: number;
}
export interface BoardPatch {
  name?: string;
  description?: string | null;
  archived?: boolean;
}
export interface ItemPatch {
  name?: string;
  stageId?: string | null;
  completedAt?: string | null;
  position?: number;
}
export interface NewView {
  name: string;
  config: ViewConfig;
  isDefault: boolean;
}
export interface ViewPatch {
  name?: string;
  config?: ViewConfig;
  isDefault?: boolean;
}

export interface CrmStore {
  // boards (+ 기본 stages/columns 원자적 프로비저닝)
  createBoard(
    orgId: string,
    userId: string | null,
    board: NewBoard,
    stages: NewStage[],
    columns: NewColumn[],
  ): Promise<{ board: Board; stages: PipelineStage[]; columns: BoardColumn[] }>;
  listBoards(orgId: string): Promise<Board[]>;
  getBoard(orgId: string, boardId: string): Promise<Board | null>;
  updateBoard(orgId: string, boardId: string, patch: BoardPatch): Promise<Board | null>;
  deleteBoard(orgId: string, boardId: string): Promise<boolean>;

  listStages(orgId: string, boardId: string): Promise<PipelineStage[]>;
  listColumns(orgId: string, boardId: string): Promise<BoardColumn[]>;

  // items
  createItem(orgId: string, userId: string | null, boardId: string, item: NewItem): Promise<Item>;
  listItems(orgId: string, boardId: string): Promise<Item[]>;
  getItem(orgId: string, itemId: string): Promise<Item | null>;
  updateItem(orgId: string, itemId: string, patch: ItemPatch): Promise<Item | null>;
  deleteItem(orgId: string, itemId: string): Promise<boolean>;

  // column values
  listValues(orgId: string, itemIds: string[]): Promise<ColumnValue[]>;
  setValues(orgId: string, itemId: string, patch: Record<string, CellValue>): Promise<void>;

  // saved views
  createView(orgId: string, userId: string | null, boardId: string, view: NewView): Promise<SavedView>;
  listViews(orgId: string, boardId: string): Promise<SavedView[]>;
  getView(orgId: string, viewId: string): Promise<SavedView | null>;
  updateView(orgId: string, viewId: string, patch: ViewPatch): Promise<SavedView | null>;
  deleteView(orgId: string, viewId: string): Promise<boolean>;
}

export interface InMemoryOptions {
  /** 결정적 테스트를 위한 id/시각 주입. */
  genId?: () => string;
  now?: () => string;
}

/** 인메모리 어댑터 — 참조 구현 + 개발/테스트. */
export class InMemoryCrmStore implements CrmStore {
  private boards = new Map<string, Board>();
  private stages = new Map<string, PipelineStage>();
  private columns = new Map<string, BoardColumn>();
  private items = new Map<string, Item>();
  private values = new Map<string, ColumnValue>(); // key: itemId::columnId
  private views = new Map<string, SavedView>();

  private seq = 0;
  private readonly genId: () => string;
  private readonly now: () => string;

  constructor(opts: InMemoryOptions = {}) {
    this.genId = opts.genId ?? (() => `id-${++this.seq}`);
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private valKey(itemId: string, columnId: string): string {
    return `${itemId}::${columnId}`;
  }

  async createBoard(
    orgId: string,
    userId: string | null,
    board: NewBoard,
    stages: NewStage[],
    columns: NewColumn[],
  ) {
    const ts = this.now();
    const b: Board = {
      id: this.genId(),
      orgId,
      name: board.name,
      description: board.description ?? null,
      position: this.boards.size,
      archived: false,
      createdBy: userId,
      createdAt: ts,
      updatedAt: ts,
    };
    this.boards.set(b.id, b);

    const createdStages = stages.map((s) => {
      const row: PipelineStage = {
        id: this.genId(),
        orgId,
        boardId: b.id,
        key: s.key,
        label: s.label,
        position: s.position,
        color: s.color ?? null,
        isTerminal: s.isTerminal,
        createdAt: ts,
      };
      this.stages.set(row.id, row);
      return row;
    });

    const createdColumns = columns.map((c) => {
      const row: BoardColumn = {
        id: this.genId(),
        orgId,
        boardId: b.id,
        key: c.key,
        title: c.title,
        type: c.type,
        settings: c.settings ?? {},
        position: c.position,
        createdAt: ts,
        updatedAt: ts,
      };
      this.columns.set(row.id, row);
      return row;
    });

    return { board: b, stages: createdStages, columns: createdColumns };
  }

  async listBoards(orgId: string) {
    return [...this.boards.values()]
      .filter((b) => b.orgId === orgId && !b.archived)
      .sort((a, b) => a.position - b.position);
  }

  async getBoard(orgId: string, boardId: string) {
    const b = this.boards.get(boardId);
    return b && b.orgId === orgId ? b : null;
  }

  async updateBoard(orgId: string, boardId: string, patch: BoardPatch) {
    const b = await this.getBoard(orgId, boardId);
    if (!b) return null;
    const next: Board = {
      ...b,
      name: patch.name ?? b.name,
      description: patch.description === undefined ? b.description : patch.description,
      archived: patch.archived ?? b.archived,
      updatedAt: this.now(),
    };
    this.boards.set(boardId, next);
    return next;
  }

  async deleteBoard(orgId: string, boardId: string) {
    const b = await this.getBoard(orgId, boardId);
    if (!b) return false;
    this.boards.delete(boardId);
    // cascade
    for (const [id, s] of this.stages) if (s.boardId === boardId) this.stages.delete(id);
    for (const [id, c] of this.columns) if (c.boardId === boardId) this.columns.delete(id);
    for (const [id, v] of this.views) if (v.boardId === boardId) this.views.delete(id);
    const itemIds: string[] = [];
    for (const [id, it] of this.items)
      if (it.boardId === boardId) {
        itemIds.push(id);
        this.items.delete(id);
      }
    for (const [k, cv] of this.values) if (itemIds.includes(cv.itemId)) this.values.delete(k);
    return true;
  }

  async listStages(orgId: string, boardId: string) {
    return [...this.stages.values()]
      .filter((s) => s.orgId === orgId && s.boardId === boardId)
      .sort((a, b) => a.position - b.position);
  }

  async listColumns(orgId: string, boardId: string) {
    return [...this.columns.values()]
      .filter((c) => c.orgId === orgId && c.boardId === boardId)
      .sort((a, b) => a.position - b.position);
  }

  async createItem(orgId: string, userId: string | null, boardId: string, item: NewItem) {
    const ts = this.now();
    const row: Item = {
      id: this.genId(),
      orgId,
      boardId,
      stageId: item.stageId,
      name: item.name,
      position: item.position,
      createdBy: userId,
      createdAt: ts,
      updatedAt: ts,
      completedAt: null,
    };
    this.items.set(row.id, row);
    return row;
  }

  async listItems(orgId: string, boardId: string) {
    return [...this.items.values()]
      .filter((i) => i.orgId === orgId && i.boardId === boardId)
      .sort((a, b) => a.position - b.position);
  }

  async getItem(orgId: string, itemId: string) {
    const i = this.items.get(itemId);
    return i && i.orgId === orgId ? i : null;
  }

  async updateItem(orgId: string, itemId: string, patch: ItemPatch) {
    const i = await this.getItem(orgId, itemId);
    if (!i) return null;
    const next: Item = {
      ...i,
      name: patch.name ?? i.name,
      stageId: patch.stageId === undefined ? i.stageId : patch.stageId,
      completedAt: patch.completedAt === undefined ? i.completedAt : patch.completedAt,
      position: patch.position ?? i.position,
      updatedAt: this.now(),
    };
    this.items.set(itemId, next);
    return next;
  }

  async deleteItem(orgId: string, itemId: string) {
    const i = await this.getItem(orgId, itemId);
    if (!i) return false;
    this.items.delete(itemId);
    for (const [k, cv] of this.values) if (cv.itemId === itemId) this.values.delete(k);
    return true;
  }

  async listValues(orgId: string, itemIds: string[]) {
    const set = new Set(itemIds);
    return [...this.values.values()].filter((v) => v.orgId === orgId && set.has(v.itemId));
  }

  async setValues(orgId: string, itemId: string, patch: Record<string, CellValue>) {
    const item = await this.getItem(orgId, itemId);
    if (!item) return;
    const cols = await this.listColumns(orgId, item.boardId);
    const byKey = new Map(cols.map((c) => [c.key, c]));
    const ts = this.now();
    for (const [key, value] of Object.entries(patch)) {
      const col = byKey.get(key);
      if (!col) continue; // 알 수 없는 컬럼 무시
      const row: ColumnValue = { itemId, columnId: col.id, orgId, value, updatedAt: ts };
      this.values.set(this.valKey(itemId, col.id), row);
    }
  }

  async createView(orgId: string, userId: string | null, boardId: string, view: NewView) {
    const ts = this.now();
    const row: SavedView = {
      id: this.genId(),
      orgId,
      boardId,
      name: view.name,
      config: view.config,
      isDefault: view.isDefault,
      createdBy: userId,
      position: [...this.views.values()].filter((v) => v.boardId === boardId).length,
      createdAt: ts,
      updatedAt: ts,
    };
    this.views.set(row.id, row);
    return row;
  }

  async listViews(orgId: string, boardId: string) {
    return [...this.views.values()]
      .filter((v) => v.orgId === orgId && v.boardId === boardId)
      .sort((a, b) => a.position - b.position);
  }

  async getView(orgId: string, viewId: string) {
    const v = this.views.get(viewId);
    return v && v.orgId === orgId ? v : null;
  }

  async updateView(orgId: string, viewId: string, patch: ViewPatch) {
    const v = await this.getView(orgId, viewId);
    if (!v) return null;
    const next: SavedView = {
      ...v,
      name: patch.name ?? v.name,
      config: patch.config ?? v.config,
      isDefault: patch.isDefault ?? v.isDefault,
      updatedAt: this.now(),
    };
    this.views.set(viewId, next);
    return next;
  }

  async deleteView(orgId: string, viewId: string) {
    const v = await this.getView(orgId, viewId);
    if (!v) return false;
    this.views.delete(viewId);
    return true;
  }
}
